import { prisma } from "@nexaflow/db";
import {
  classifyIntent,
  extractStructuredData,
  generateRecommendations,
  predictChurnRisk,
  routeBestAgent,
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
      // Pull the LAST N messages, not the first N. Old conversations
      // can have hundreds of messages; the agent needs the recent
      // context, not the original greeting. `desc + take` then reverse
      // so the AI sees them in chronological order.
      const rows = await prisma.message.findMany({
        where: { conversationId: ctx.conversationId },
        orderBy: { createdAt: "desc" },
        take: getConfig<number>(node, "lookback", 40),
        select: { direction: true, content: true },
      });
      messages = rows.reverse().map((m) => ({
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

// AI_RECOMMEND — picks the best catalog items for a customer's
// expressed need. Catalog comes from node.config.items (explicit) or
// is pulled from the Service table for the tenant (auto). Writes
// `aiRecommendations` (array) into ctx.vars.
const aiRecommendHandler: NodeHandler = {
  type: "AI_RECOMMEND",
  label: "AI recommend",
  async run(node, ctx): Promise<NodeRunResult> {
    const context =
      interpolate(getConfig<string>(node, "context", ""), ctx.vars) ||
      ctx.triggerText ||
      "";
    const topK = getConfig<number>(node, "topK", 3);
    const outVar = getConfig<string>(node, "outputVar", "aiRecommendations");

    // Resolve catalog: explicit `items` config wins, else fall back to
    // active Services for the tenant (most common use case for the
    // built-in catalog).
    const explicitItems = node.config?.items;
    let items: Array<{
      id: string;
      name: string;
      description?: string;
      priceLabel?: string;
    }> = [];
    if (Array.isArray(explicitItems)) {
      for (const raw of explicitItems as unknown[]) {
        if (raw && typeof raw === "object") {
          const r = raw as Record<string, unknown>;
          if (typeof r.id === "string" && typeof r.name === "string") {
            items.push({
              id: r.id,
              name: r.name,
              description:
                typeof r.description === "string" ? r.description : undefined,
              priceLabel:
                typeof r.priceLabel === "string" ? r.priceLabel : undefined,
            });
          }
        }
      }
    } else {
      const services = await prisma.service.findMany({
        where: { tenantId: ctx.tenantId, isActive: true },
        select: {
          id: true,
          name: true,
          description: true,
          priceInPaisa: true,
        },
        take: 60,
      });
      items = services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? undefined,
        // Currency lives on Tenant; the catalog summary uses INR as the
        // platform default. A future iteration can pull tenant.currency
        // when that field is added.
        priceLabel:
          typeof s.priceInPaisa === "number" && s.priceInPaisa > 0
            ? `INR ${(s.priceInPaisa / 100).toFixed(2)}`
            : undefined,
      }));
    }

    const { recommendations } = await generateRecommendations(ctx.tenantId, {
      context,
      items,
      topK,
    });
    return {
      nextNodeId: node.next ?? null,
      vars: {
        [outVar]: recommendations,
        // Convenience: first recommendation's id, for downstream
        // MESSAGE template / CONDITION nodes.
        [`${outVar}TopId`]: recommendations[0]?.id ?? null,
      },
      trail: {
        count: recommendations.length,
        ids: recommendations.map((r) => r.id),
      },
    };
  },
};

// AI_CHURN_PREDICT — derives engagement signals from Contact +
// Conversation history and asks the model for a 30-day churn risk.
// Writes `churnRiskScore` (0..1) and `churnRiskBand` ("low"|"medium"
// |"high") into ctx.vars. CONDITION nodes can branch on the band.
const aiChurnPredictHandler: NodeHandler = {
  type: "AI_CHURN_PREDICT",
  label: "AI churn predict",
  async run(node, ctx): Promise<NodeRunResult> {
    if (!ctx.contactId) {
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "no contact context" },
      };
    }
    const contact = await prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: {
        createdAt: true,
        optedOut: true,
        conversations: {
          select: { lastInboundAt: true, lastOutboundAt: true },
          orderBy: { lastMessageAt: "desc" },
          take: 1,
        },
        _count: {
          select: {
            conversations: true,
            leads: { where: { status: { notIn: ["CLOSED_WON", "CLOSED_LOST"] } } },
          },
        },
      },
    });
    if (!contact) {
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "contact not found" },
      };
    }

    // Aggregate inbound/outbound counts cheaply via a parallel groupBy.
    const [inboundAgg, outboundAgg] = await Promise.all([
      prisma.message.count({
        where: {
          conversation: { contactId: ctx.contactId },
          direction: "INBOUND",
        },
      }),
      prisma.message.count({
        where: {
          conversation: { contactId: ctx.contactId },
          direction: "OUTBOUND",
        },
      }),
    ]);

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const lastInbound = contact.conversations[0]?.lastInboundAt ?? null;
    const lastOutbound = contact.conversations[0]?.lastOutboundAt ?? null;
    const result = await predictChurnRisk(ctx.tenantId, {
      daysSinceLastInbound: lastInbound
        ? Math.floor((now - lastInbound.getTime()) / dayMs)
        : null,
      daysSinceLastOutbound: lastOutbound
        ? Math.floor((now - lastOutbound.getTime()) / dayMs)
        : null,
      totalInboundMessages: inboundAgg,
      totalOutboundMessages: outboundAgg,
      daysSinceCreated: Math.floor(
        (now - contact.createdAt.getTime()) / dayMs,
      ),
      hasOpenLead: contact._count.leads > 0,
      optedOut: contact.optedOut,
    });

    const outVar = getConfig<string>(node, "outputVar", "churnRisk");
    const goto =
      node.branches?.[result.riskBand] ??
      node.branches?.default ??
      node.next ??
      null;
    return {
      nextNodeId: goto,
      vars: {
        [`${outVar}Score`]: result.riskScore,
        [`${outVar}Band`]: result.riskBand,
        [`${outVar}Reasoning`]: result.reasoning,
      },
      trail: { score: result.riskScore, band: result.riskBand },
    };
  },
};

// AI_ROUTE_BEST_AGENT — picks an eligible agent for the current
// conversation. Falls back to the existing round-robin picker when
// the model returns null (no candidate fits) or when no agents are
// available. Writes the chosen agentId into ctx.vars and assigns
// the conversation in-flight.
const aiRouteBestAgentHandler: NodeHandler = {
  type: "AI_ROUTE_BEST_AGENT",
  label: "AI route to best agent",
  async run(node, ctx): Promise<NodeRunResult> {
    const outVar = getConfig<string>(node, "outputVar", "routedAgentId");
    if (!ctx.conversationId) {
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "no conversation context" },
      };
    }
    const ticketText =
      interpolate(getConfig<string>(node, "ticketText", ""), ctx.vars) ||
      ctx.triggerText ||
      "";

    // The back-relation on User is named `conversations`
    // (not `assignedConversations` — common naming pitfall). We can't
    // filter a count on a relation directly in select, so issue a
    // single groupBy for active-load.
    const agents = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: "ACTIVE",
        role: { in: ["AGENT", "TEAM_LEAD"] },
      },
      select: { id: true, name: true },
      take: 50,
    });
    const loadByAgent = await prisma.conversation.groupBy({
      by: ["agentId"],
      where: {
        tenantId: ctx.tenantId,
        isActive: true,
        agentId: { in: agents.map((a) => a.id) },
      },
      _count: { _all: true },
    });
    const loadMap = new Map<string, number>(
      loadByAgent.map((row) => [row.agentId as string, row._count._all]),
    );

    const { agentId, reasoning } = await routeBestAgent(ctx.tenantId, {
      ticketText,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        activeConversations: loadMap.get(a.id) ?? 0,
      })),
      preferences:
        getConfig<string>(node, "preferences", "") || undefined,
    });

    if (agentId) {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { agentId },
      });
    }
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: agentId, [`${outVar}Reasoning`]: reasoning },
      trail: { agentId, reasoning, candidates: agents.length },
    };
  },
};

export const aiFlowNodeHandlers: Record<string, NodeHandler> = {
  AI_CLASSIFY_INTENT: aiClassifyIntentHandler,
  AI_SUMMARIZE: aiSummarizeHandler,
  AI_EXTRACT_DATA: aiExtractDataHandler,
  AI_TRANSLATE: aiTranslateHandler,
  AI_COMPLIANCE_CHECK: aiComplianceCheckHandler,
  AI_RECOMMEND: aiRecommendHandler,
  AI_CHURN_PREDICT: aiChurnPredictHandler,
  AI_ROUTE_BEST_AGENT: aiRouteBestAgentHandler,
  WAIT_FOR_REPLY: waitForReplyHandler,
  SWITCH: switchHandler,
  FILTER: filterHandler,
};
