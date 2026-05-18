import { prisma } from "@nexaflow/db";
import { ApiError, MessageDirection, MessageStatus } from "@nexaflow/shared";
import { sendWhatsAppText } from "../whatsapp.service";
import { canSendNow, recordSend } from "../sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "../billing.service";
import { pickNextAgent } from "../routing.service";
import { suggestReplies } from "../ai.service";
import {
  FlowNode,
  NodeHandler,
  NodeRunResult,
  FlowRuntimeError,
} from "./types";

// ----------------------------------------------------------------------------
// Variable interpolation helper — replaces {{var.path}} in strings.
// ----------------------------------------------------------------------------

function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = (path as string).split(".");
    let cur: unknown = vars;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        return "";
      }
    }
    return cur === null || cur === undefined ? "" : String(cur);
  });
}

function getConfig<T>(node: FlowNode, key: string, fallback?: T): T {
  const v = node.config?.[key];
  return (v === undefined ? fallback : v) as T;
}

// ----------------------------------------------------------------------------
// START — no-op, just routes to next
// ----------------------------------------------------------------------------

const startHandler: NodeHandler = {
  type: "START",
  label: "Start",
  async run(node) {
    return { nextNodeId: node.next ?? null };
  },
};

// ----------------------------------------------------------------------------
// END — terminates the flow
// ----------------------------------------------------------------------------

const endHandler: NodeHandler = {
  type: "END",
  label: "End",
  async run() {
    return { nextNodeId: null, status: "COMPLETED" };
  },
};

// ----------------------------------------------------------------------------
// MESSAGE — send a WhatsApp text to the contact
// ----------------------------------------------------------------------------

const messageHandler: NodeHandler = {
  type: "MESSAGE",
  label: "Send WhatsApp message",
  async run(node, ctx): Promise<NodeRunResult> {
    const template = getConfig<string>(node, "text", "");
    if (!template) {
      throw new FlowRuntimeError("MESSAGE node missing 'text' config", node.id);
    }
    const text = interpolate(template, ctx.vars);

    if (!ctx.contactId) {
      throw new FlowRuntimeError("MESSAGE requires a contactId", node.id);
    }

    const contact = await prisma.contact.findUnique({
      where: { id: ctx.contactId },
    });
    if (!contact || contact.optedOut) {
      // Soft-skip: don't crash the run, just mark it.
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "contact opted out or missing" },
      };
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: { wabaPhoneNumber: true, wabaAccessToken: true },
    });
    if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
      // No WABA: log to conversation as OUTBOUND with status FAILED but don't crash.
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "WABA not configured" },
      };
    }

    const gate = await canSendNow(ctx.tenantId);
    if (!gate.allowed) {
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: `throttled: ${gate.reason}` },
      };
    }

    // Wallet pre-check — soft skip when unfunded so the flow can keep walking.
    try {
      await assertCanAffordMessage(ctx.tenantId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 402) {
        return {
          nextNodeId: node.next ?? null,
          trail: { skipped: `unfunded: ${err.message}` },
        };
      }
      throw err;
    }

    try {
      const metaMessageId = await sendWhatsAppText({
        phoneNumberId: tenant.wabaPhoneNumber,
        accessToken: tenant.wabaAccessToken,
        to: contact.phoneNumber.replace(/^\+/, ""),
        body: text,
      });
      await recordSend(ctx.tenantId);
      await debitMessage(ctx.tenantId, metaMessageId, {
        reason: `Flow MESSAGE node ${node.id}`,
      });

      const convo =
        ctx.conversationId ??
        (
          await prisma.conversation.upsert({
            where: {
              id:
                (
                  await prisma.conversation.findFirst({
                    where: {
                      tenantId: ctx.tenantId,
                      contactId: contact.id,
                      isActive: true,
                    },
                    select: { id: true },
                  })
                )?.id ?? "____none____",
            },
            update: { lastMessageAt: new Date() },
            create: {
              tenantId: ctx.tenantId,
              contactId: contact.id,
              isActive: true,
              lastMessageAt: new Date(),
            },
          })
        ).id;

      await prisma.message.create({
        data: {
          conversationId: convo,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: text,
          metaMessageId,
          aiGenerated: false,
        },
      });

      return {
        nextNodeId: node.next ?? null,
        vars: { lastSentMessage: text },
        trail: { sent: true, chars: text.length },
      };
    } catch (err) {
      if (err instanceof ApiError) {
        return {
          nextNodeId: node.next ?? null,
          trail: { error: err.message, code: err.code },
        };
      }
      throw err;
    }
  },
};

// ----------------------------------------------------------------------------
// CONDITION — evaluates a simple JSON-logic style condition, returns a branch
// ----------------------------------------------------------------------------

interface ConditionRule {
  /** Variable path like "triggerText" or "vars.score" */
  path: string;
  op: "equals" | "contains" | "startsWith" | "gt" | "lt" | "exists";
  value?: string | number | boolean;
  /** Node id to go to when the rule matches. */
  goto: string;
}

const conditionHandler: NodeHandler = {
  type: "CONDITION",
  label: "Branch on condition",
  async run(node, ctx): Promise<NodeRunResult> {
    const rules = getConfig<ConditionRule[]>(node, "rules", []);
    const fallback = getConfig<string | undefined>(node, "default", node.next);

    const lookup = (path: string): unknown => {
      const parts = path.split(".");
      let cur: unknown = { ...ctx.vars, triggerText: ctx.triggerText };
      for (const p of parts) {
        if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
          cur = (cur as Record<string, unknown>)[p];
        } else {
          return undefined;
        }
      }
      return cur;
    };

    for (const rule of rules) {
      const value = lookup(rule.path);
      const matches = (() => {
        switch (rule.op) {
          case "equals":
            return String(value).toLowerCase() === String(rule.value).toLowerCase();
          case "contains":
            return String(value ?? "")
              .toLowerCase()
              .includes(String(rule.value).toLowerCase());
          case "startsWith":
            return String(value ?? "")
              .toLowerCase()
              .startsWith(String(rule.value).toLowerCase());
          case "gt":
            return Number(value) > Number(rule.value);
          case "lt":
            return Number(value) < Number(rule.value);
          case "exists":
            return value !== undefined && value !== null && value !== "";
        }
      })();
      if (matches) {
        return { nextNodeId: rule.goto, trail: { matched: rule } };
      }
    }
    return { nextNodeId: fallback ?? null, trail: { matched: null } };
  },
};

// ----------------------------------------------------------------------------
// DELAY — suspends the run until `resumeAt`
// ----------------------------------------------------------------------------

const delayHandler: NodeHandler = {
  type: "DELAY",
  label: "Wait",
  async run(node): Promise<NodeRunResult> {
    const seconds = getConfig<number>(node, "seconds", 60);
    const resumeAt = new Date(Date.now() + Math.max(1, seconds) * 1000);
    return {
      nextNodeId: node.next ?? null,
      waitUntil: resumeAt,
      trail: { delaySeconds: seconds, resumeAt: resumeAt.toISOString() },
    };
  },
};

// ----------------------------------------------------------------------------
// ADD_TAG — tags the current contact
// ----------------------------------------------------------------------------

const addTagHandler: NodeHandler = {
  type: "ADD_TAG",
  label: "Add tag to contact",
  async run(node, ctx): Promise<NodeRunResult> {
    const tag = getConfig<string>(node, "tag", "");
    if (!tag || !ctx.contactId) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "missing tag or contact" } };
    }
    const c = await prisma.contact.findUnique({ where: { id: ctx.contactId } });
    if (!c) return { nextNodeId: node.next ?? null };
    if (c.tags.includes(tag)) {
      return { nextNodeId: node.next ?? null, trail: { tagAlreadyPresent: true } };
    }
    await prisma.contact.update({
      where: { id: c.id },
      data: { tags: [...c.tags, tag] },
    });
    return { nextNodeId: node.next ?? null, trail: { tagged: tag } };
  },
};

// ----------------------------------------------------------------------------
// AGENT_TRANSFER — assigns conversation to a real agent (round-robin)
// ----------------------------------------------------------------------------

const agentTransferHandler: NodeHandler = {
  type: "AGENT_TRANSFER",
  label: "Transfer to human agent",
  async run(node, ctx): Promise<NodeRunResult> {
    if (!ctx.conversationId) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "no conversation" } };
    }
    const agentId = await pickNextAgent(ctx.tenantId);
    if (!agentId) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "no eligible agent" } };
    }
    await prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { agentId },
    });
    return {
      nextNodeId: node.next ?? null,
      vars: { assignedAgentId: agentId },
      trail: { transferredTo: agentId },
    };
  },
};

// ----------------------------------------------------------------------------
// AI_RESPONSE — generates a reply suggestion and (optionally) sends it
// ----------------------------------------------------------------------------

const aiResponseHandler: NodeHandler = {
  type: "AI_RESPONSE",
  label: "Generate AI reply",
  async run(node, ctx): Promise<NodeRunResult> {
    if (!ctx.conversationId || !ctx.contactId) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "no conversation context" } };
    }
    const autoSend = getConfig<boolean>(node, "autoSend", false);
    const conversation = await prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      include: {
        contact: { select: { name: true } },
        tenant: { select: { name: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          take: 30,
          select: { direction: true, content: true },
        },
      },
    });
    if (!conversation || conversation.messages.length === 0) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "no messages" } };
    }
    try {
      const suggestions = await suggestReplies(ctx.tenantId, {
        conversationContext: conversation.messages.map((m) => ({
          direction: m.direction as "INBOUND" | "OUTBOUND",
          content: m.content,
        })),
        contactName: conversation.contact.name,
        businessName: conversation.tenant.name,
      });
      const chosen = suggestions[0];
      if (!chosen) {
        return { nextNodeId: node.next ?? null, trail: { skipped: "no suggestion" } };
      }
      if (autoSend) {
        // Dispatch through the MESSAGE node logic by mutating config.
        // Cheaper than re-implementing: call messageHandler directly.
        const synthetic: FlowNode = {
          id: `${node.id}:autosend`,
          type: "MESSAGE",
          config: { text: chosen.text },
          next: node.next,
        };
        const result = await messageHandler.run(synthetic, ctx);
        return {
          ...result,
          vars: { aiSuggestion: chosen.text },
          trail: { ...(result.trail ?? {}), aiAutoSent: true },
        };
      }
      return {
        nextNodeId: node.next ?? null,
        vars: { aiSuggestion: chosen.text, aiSuggestions: suggestions },
        trail: { suggested: chosen.tone },
      };
    } catch (err) {
      // Likely missing ANTHROPIC_API_KEY — graceful degrade.
      return {
        nextNodeId: node.next ?? null,
        trail: { aiError: (err as Error).message },
      };
    }
  },
};

// ----------------------------------------------------------------------------
// WEBHOOK — POSTs the run context to an external URL, captures response in vars
// ----------------------------------------------------------------------------

interface WebhookConfig {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: Record<string, unknown> | string;
  timeoutMs?: number;
  /** Path to map the JSON response into. Default "webhookResponse". */
  responseVar?: string;
}

const webhookHandler: NodeHandler = {
  type: "WEBHOOK",
  label: "Call external webhook",
  async run(node, ctx): Promise<NodeRunResult> {
    const cfg = (node.config ?? {}) as unknown as WebhookConfig;
    if (!cfg.url) {
      throw new FlowRuntimeError("WEBHOOK node missing 'url' config", node.id);
    }
    const method = cfg.method ?? "POST";
    const timeout = Math.min(cfg.timeoutMs ?? 5000, 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const url = interpolate(cfg.url, ctx.vars);
      const interpolatedBody =
        typeof cfg.body === "string"
          ? interpolate(cfg.body, ctx.vars)
          : cfg.body
            ? cfg.body
            : { vars: ctx.vars, contactId: ctx.contactId };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cfg.headers ?? {}),
        },
        body:
          method === "GET" || method === "DELETE"
            ? undefined
            : typeof interpolatedBody === "string"
              ? interpolatedBody
              : JSON.stringify(interpolatedBody),
        signal: controller.signal,
      });
      let parsed: unknown = null;
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        parsed = await res.json().catch(() => null);
      } else {
        parsed = await res.text().catch(() => null);
      }
      const varKey = cfg.responseVar ?? "webhookResponse";
      return {
        nextNodeId: node.next ?? null,
        vars: { [varKey]: parsed, webhookStatus: res.status },
        trail: { status: res.status, url },
      };
    } catch (err) {
      return {
        nextNodeId: node.next ?? null,
        vars: { webhookError: (err as Error).message },
        trail: { error: (err as Error).message },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};

// ----------------------------------------------------------------------------
// Registry
// ----------------------------------------------------------------------------

export const nodeRegistry: Record<string, NodeHandler> = {
  START: startHandler,
  END: endHandler,
  MESSAGE: messageHandler,
  CONDITION: conditionHandler,
  DELAY: delayHandler,
  ADD_TAG: addTagHandler,
  AGENT_TRANSFER: agentTransferHandler,
  AI_RESPONSE: aiResponseHandler,
  WEBHOOK: webhookHandler,
};

export function listNodeTypes(): Array<{ type: string; label: string }> {
  return Object.values(nodeRegistry).map((h) => ({ type: h.type, label: h.label }));
}
