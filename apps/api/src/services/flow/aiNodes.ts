import { prisma } from "@nexaflow/db";
import {
  classifyIntent,
  extractStructuredData,
  runTenantLlmJson,
  summarizeConversation,
} from "../ai.service";
import { FlowNode, NodeHandler, NodeRunResult } from "./types";

function getConfig<T>(node: FlowNode, key: string, fallback?: T): T {
  const v = node.config?.[key];
  return (v === undefined ? fallback : v) as T;
}

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

// AI_CLASSIFY_INTENT — picks one label from `labels` to route on.
// Uses the validated classifyIntent helper so the model can never
// invent a new label (out-of-list outputs are snapped to "unknown").
const aiClassifyIntentHandler: NodeHandler = {
  type: "AI_CLASSIFY_INTENT",
  label: "AI classify intent",
  async run(node, ctx): Promise<NodeRunResult> {
    const text =
      interpolate(getConfig<string>(node, "text", ""), ctx.vars) ||
      ctx.triggerText ||
      String(ctx.vars.lastReplyText ?? "");
    if (!text.trim()) {
      return {
        nextNodeId:
          node.branches?.unknown ?? node.branches?.default ?? node.next ?? null,
        vars: { aiIntent: "unknown", aiIntentConfidence: 0 },
        trail: { intent: "unknown", reason: "empty input" },
      };
    }
    const labels = getConfig<string[]>(node, "labels", [
      "general",
      "sales",
      "support",
    ]);
    const result = await classifyIntent(ctx.tenantId, {
      text,
      intents: labels,
      context: getConfig<string>(node, "context", "") || undefined,
    });
    const goto =
      node.branches?.[result.intent] ??
      node.branches?.default ??
      node.next ??
      null;
    return {
      nextNodeId: goto,
      vars: {
        aiIntent: result.intent,
        aiIntentConfidence: result.confidence,
      },
      trail: { intent: result.intent, confidence: result.confidence },
    };
  },
};

// AI_SUMMARIZE — pulls the last N conversation messages and writes a
// 2-4 sentence summary + 3-7 bullets. When no conversation is in scope,
// summarizes the configured `text` instead.
const aiSummarizeHandler: NodeHandler = {
  type: "AI_SUMMARIZE",
  label: "AI summarize",
  async run(node, ctx): Promise<NodeRunResult> {
    const outVar = getConfig<string>(node, "outputVar", "aiSummary");
    let messages: Array<{ direction: "INBOUND" | "OUTBOUND"; content: string }> =
      [];

    if (ctx.conversationId) {
      const rows = await prisma.message.findMany({
        where: { conversationId: ctx.conversationId },
        orderBy: { createdAt: "asc" },
        take: getConfig<number>(node, "lookback", 40),
        select: { direction: true, content: true },
      });
      messages = rows.map((m) => ({
        direction: m.direction as "INBOUND" | "OUTBOUND",
        content: m.content,
      }));
    } else {
      const text =
        interpolate(getConfig<string>(node, "text", ""), ctx.vars) ||
        ctx.triggerText ||
        "";
      if (text.trim()) messages = [{ direction: "INBOUND", content: text }];
    }

    if (messages.length === 0) {
      return {
        nextNodeId: node.next ?? null,
        vars: { [outVar]: "" },
        trail: { skipped: "no content" },
      };
    }

    const result = await summarizeConversation(ctx.tenantId, {
      messages,
      focus: getConfig<string>(node, "focus", "") || undefined,
    });
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: result.summary, [`${outVar}Bullets`]: result.bullets },
      trail: { chars: result.summary.length, bullets: result.bullets.length },
    };
  },
};

// AI_EXTRACT_DATA — pulls a typed dictionary out of free-form text.
// Splats each field as its own ctx variable (`extracted_<field>`) so
// downstream CONDITION nodes can reference them directly via {{...}}.
const aiExtractDataHandler: NodeHandler = {
  type: "AI_EXTRACT_DATA",
  label: "AI extract data",
  async run(node, ctx): Promise<NodeRunResult> {
    const text =
      interpolate(getConfig<string>(node, "text", ""), ctx.vars) ||
      ctx.triggerText ||
      "";

    // `fields` accepts two editor shapes for ergonomics:
    //   - string[]:                ["name", "email"]
    //   - Record<string, string>:  {name: "...", ...}
    const rawFields = node.config?.fields;
    let fieldsDict: Record<string, string> = {};
    if (Array.isArray(rawFields)) {
      for (const f of rawFields as unknown[]) {
        if (typeof f === "string" && f.trim()) {
          fieldsDict[f] = `Extract the customer's ${f}.`;
        }
      }
    } else if (rawFields && typeof rawFields === "object") {
      for (const [k, v] of Object.entries(rawFields as Record<string, unknown>)) {
        if (typeof v === "string") fieldsDict[k] = v;
      }
    }
    if (Object.keys(fieldsDict).length === 0) {
      fieldsDict = {
        name: "Customer's full name.",
        email: "Customer's email address.",
        phone: "Customer's phone number including country code if mentioned.",
      };
    }

    const out = await extractStructuredData(ctx.tenantId, {
      text,
      fields: fieldsDict,
    });
    const outVar = getConfig<string>(node, "outputVar", "aiExtracted");
    const splat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out)) {
      splat[`extracted_${k}`] = v;
    }
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: out, ...splat },
      trail: {
        fields: Object.keys(out),
        present: Object.values(out).filter((v) => v !== null).length,
      },
    };
  },
};

const aiTranslateHandler: NodeHandler = {
  type: "AI_TRANSLATE",
  label: "AI translate",
  async run(node, ctx): Promise<NodeRunResult> {
    const text = interpolate(getConfig<string>(node, "text", ""), ctx.vars);
    const targetLang = getConfig<string>(node, "targetLanguage", "en");
    const parsed = await runTenantLlmJson<{ translation: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_translate",
      prompt: `Translate to ${targetLang}:\n${text}\nReturn {"translation":"..."}`,
      maxTokens: 400,
    });
    const outVar = getConfig<string>(node, "outputVar", "aiTranslation");
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: parsed.translation },
    };
  },
};

const aiComplianceCheckHandler: NodeHandler = {
  type: "AI_COMPLIANCE_CHECK",
  label: "AI compliance check",
  async run(node, ctx): Promise<NodeRunResult> {
    const text = interpolate(getConfig<string>(node, "text", ""), ctx.vars);
    const parsed = await runTenantLlmJson<{ risk: string; reason?: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_compliance_check",
      prompt: `Rate spam/compliance risk (low|medium|high) for WhatsApp marketing:\n${text}\nReturn {"risk":"low|medium|high","reason":"..."}`,
      maxTokens: 150,
    });
    const highRisk = parsed.risk === "high";
    if (highRisk) {
      return {
        nextNodeId: null,
        status: "ABORTED",
        trail: { risk: parsed.risk, reason: parsed.reason },
      };
    }
    return {
      nextNodeId: node.next ?? null,
      vars: { complianceRisk: parsed.risk },
      trail: { risk: parsed.risk },
    };
  },
};

const waitForReplyHandler: NodeHandler = {
  type: "WAIT_FOR_REPLY",
  label: "Wait for reply",
  async run(node): Promise<NodeRunResult> {
    return {
      nextNodeId: node.next ?? null,
      waitForReply: true,
      trail: { waiting: true },
    };
  },
};

const switchHandler: NodeHandler = {
  type: "SWITCH",
  label: "Switch",
  async run(node, ctx): Promise<NodeRunResult> {
    const field = getConfig<string>(node, "field", "triggerText");
    const parts = field.split(".");
    let cur: unknown = { ...ctx.vars, triggerText: ctx.triggerText };
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[p];
      } else {
        cur = undefined;
        break;
      }
    }
    const key = String(cur ?? "").toLowerCase();
    const goto = node.branches?.[key] ?? node.branches?.default ?? node.next ?? null;
    return { nextNodeId: goto, trail: { field, key } };
  },
};

const filterHandler: NodeHandler = {
  type: "FILTER",
  label: "Filter contact",
  async run(node, ctx): Promise<NodeRunResult> {
    if (!ctx.contactId) {
      return { nextNodeId: null, status: "ABORTED", trail: { reason: "no contact" } };
    }
    const requireTag = getConfig<string>(node, "requireTag", "");
    const contact = await prisma.contact.findUnique({ where: { id: ctx.contactId } });
    if (!contact) {
      return { nextNodeId: null, status: "ABORTED" };
    }
    if (requireTag && !contact.tags.includes(requireTag)) {
      return { nextNodeId: null, status: "ABORTED", trail: { missingTag: requireTag } };
    }
    return { nextNodeId: node.next ?? null, trail: { passed: true } };
  },
};

export const aiFlowNodeHandlers: Record<string, NodeHandler> = {
  AI_CLASSIFY_INTENT: aiClassifyIntentHandler,
  AI_SUMMARIZE: aiSummarizeHandler,
  AI_EXTRACT_DATA: aiExtractDataHandler,
  AI_TRANSLATE: aiTranslateHandler,
  AI_COMPLIANCE_CHECK: aiComplianceCheckHandler,
  WAIT_FOR_REPLY: waitForReplyHandler,
  SWITCH: switchHandler,
  FILTER: filterHandler,
};
