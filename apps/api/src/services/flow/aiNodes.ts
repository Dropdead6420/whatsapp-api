import { prisma } from "@nexaflow/db";
import { runTenantLlmJson } from "../ai.service";
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

const aiClassifyIntentHandler: NodeHandler = {
  type: "AI_CLASSIFY_INTENT",
  label: "AI classify intent",
  async run(node, ctx): Promise<NodeRunResult> {
    const text =
      getConfig<string>(node, "text", "") ||
      ctx.triggerText ||
      String(ctx.vars.lastReplyText ?? "");
    if (!text.trim()) {
      return { nextNodeId: node.branches?.default ?? node.next ?? null };
    }
    const labels = getConfig<string[]>(node, "labels", ["general", "sales", "support"]);
    const parsed = await runTenantLlmJson<{ intent: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_classify_intent",
      system: "Classify user intent. Return JSON only.",
      prompt: `Message: "${text}"\nLabels: ${labels.join(", ")}\nReturn {"intent":"<one label>"}`,
      maxTokens: 120,
    });
    const intent = parsed.intent?.toLowerCase() ?? "general";
    const goto = node.branches?.[intent] ?? node.branches?.default ?? node.next ?? null;
    return {
      nextNodeId: goto,
      vars: { aiIntent: intent },
      trail: { intent },
    };
  },
};

const aiSummarizeHandler: NodeHandler = {
  type: "AI_SUMMARIZE",
  label: "AI summarize",
  async run(node, ctx): Promise<NodeRunResult> {
    const text = getConfig<string>(node, "text", "") || ctx.triggerText || "";
    const parsed = await runTenantLlmJson<{ summary: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_summarize",
      prompt: `Summarize in 2 sentences:\n${text}\nReturn {"summary":"..."}`,
      maxTokens: 200,
    });
    const outVar = getConfig<string>(node, "outputVar", "aiSummary");
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: parsed.summary },
      trail: { chars: parsed.summary?.length ?? 0 },
    };
  },
};

const aiExtractDataHandler: NodeHandler = {
  type: "AI_EXTRACT_DATA",
  label: "AI extract data",
  async run(node, ctx): Promise<NodeRunResult> {
    const text = getConfig<string>(node, "text", "") || ctx.triggerText || "";
    const fields = getConfig<string[]>(node, "fields", ["name", "email", "phone"]);
    const parsed = await runTenantLlmJson<{ data: Record<string, string> }>({
      tenantId: ctx.tenantId,
      feature: "flow_extract_data",
      prompt: `Extract ${fields.join(", ")} from:\n${text}\nReturn {"data":{${fields.map((f) => `"${f}":""`).join(",")}}}`,
      maxTokens: 300,
    });
    const outVar = getConfig<string>(node, "outputVar", "aiExtracted");
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: parsed.data ?? {} },
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
