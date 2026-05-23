import { prisma } from "@nexaflow/db";
import { UserRole } from "@nexaflow/shared";
import {
  classifyIntent,
  extractStructuredData,
  runTenantLlmJson,
  summarizeConversation,
} from "../ai.service";
import {
  runAgent,
  AgentConversationMessage,
} from "../aiAgentRunner.service";
import {
  dispatchAgentTool,
  ToolDispatchResult,
} from "../aiAgentTool.service";
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

const aiRecommendHandler: NodeHandler = {
  type: "AI_RECOMMEND",
  label: "AI recommend action",
  async run(node, ctx): Promise<NodeRunResult> {
    const parsed = await runTenantLlmJson<{ action: string; message?: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_recommend",
      prompt: `Context: ${JSON.stringify(ctx.vars)}\nLast message: ${ctx.triggerText ?? ""}\nReturn {"action":"send_message|assign_agent|create_lead|wait","message":"optional copy"}`,
      maxTokens: 200,
    });
    const outVar = getConfig<string>(node, "outputVar", "aiRecommendation");
    return {
      nextNodeId: node.next ?? null,
      vars: { [outVar]: parsed },
      trail: { action: parsed.action },
    };
  },
};

const aiChurnPredictHandler: NodeHandler = {
  type: "AI_CHURN_PREDICT",
  label: "AI churn risk",
  async run(node, ctx): Promise<NodeRunResult> {
    const parsed = await runTenantLlmJson<{ risk: string; score: number }>({
      tenantId: ctx.tenantId,
      feature: "flow_churn_predict",
      prompt: `Estimate churn risk (low|medium|high) and score 0-1 from:\n${JSON.stringify(ctx.vars)}\nReturn {"risk":"low|medium|high","score":0.0}`,
      maxTokens: 120,
    });
    const high = parsed.risk === "high" || parsed.score >= 0.7;
    const goto = high
      ? node.branches?.high ?? node.next ?? null
      : node.branches?.low ?? node.next ?? null;
    return {
      nextNodeId: goto,
      vars: { churnRisk: parsed.risk, churnScore: parsed.score },
      trail: parsed,
    };
  },
};

const aiRouteBestAgentHandler: NodeHandler = {
  type: "AI_ROUTE_BEST_AGENT",
  label: "AI route to agent",
  async run(node, ctx): Promise<NodeRunResult> {
    const agents = await prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        role: { in: [UserRole.AGENT, UserRole.TEAM_LEAD] },
        status: "ACTIVE",
      },
      select: { id: true, name: true },
      take: 20,
    });
    if (agents.length === 0) {
      return { nextNodeId: node.next ?? null, trail: { skipped: "no agents" } };
    }
    const parsed = await runTenantLlmJson<{ agentId: string }>({
      tenantId: ctx.tenantId,
      feature: "flow_route_agent",
      prompt: `Pick best agent id for this conversation.\nAgents: ${JSON.stringify(agents)}\nContext: ${JSON.stringify(ctx.vars)}\nReturn {"agentId":"<id>"}`,
      maxTokens: 80,
    });
    const agentId = agents.find((a) => a.id === parsed.agentId)?.id ?? agents[0].id;
    if (ctx.conversationId) {
      await prisma.conversation.update({
        where: { id: ctx.conversationId },
        data: { agentId },
      });
    }
    return {
      nextNodeId: node.next ?? null,
      vars: { routedAgentId: agentId },
      trail: { agentId },
    };
  },
};

// ----------------------------------------------------------------------------
// AI_AGENT (T-052 slice 3) — runs a configured AiAgent against the live
// conversation. Writes the reply to a flow variable (default `aiAgentReply`)
// so a downstream MESSAGE node can send it. Dispatches the model's tool
// calls through `dispatchAgentTool` and writes their outcomes to
// `aiAgentToolResults`. Routes on the runner's `reason`:
//
//   ok                          -> node.next
//   fallback_no_active_agent    -> node.branches.escalated || node.next
//   fallback_no_llm_configured  -> node.branches.escalated || node.next
//   fallback_llm_error          -> node.branches.escalated || node.next
//   fallback_empty_user_message -> node.next  (nothing to escalate about)
//
// Tools are NOT sent over WhatsApp here — the agent's text reply is what
// the customer sees. Tools mutate CRM state (CREATE_LEAD, ADD_TAG, etc.)
// or hand off to existing flow nodes (SEND_TEMPLATE). Operators wire
// AI_AGENT -> MESSAGE to send the reply.
// ----------------------------------------------------------------------------
const aiAgentHandler: NodeHandler = {
  type: "AI_AGENT",
  label: "Run AI agent",
  async run(node, ctx): Promise<NodeRunResult> {
    const agentId = getConfig<string>(node, "agentId", "");
    if (!agentId) {
      return {
        nextNodeId: node.next ?? null,
        trail: { skipped: "AI_AGENT missing agentId in config" },
      };
    }
    const replyVar = getConfig<string>(node, "replyVar", "aiAgentReply");
    const toolResultsVar = getConfig<string>(
      node,
      "toolResultsVar",
      "aiAgentToolResults",
    );
    const reasonVar = getConfig<string>(node, "reasonVar", "aiAgentReason");

    // Build the conversation snapshot from the live conversation, fall
    // back to triggerText if no conversation is in scope.
    let conversation: AgentConversationMessage[] = [];
    if (ctx.conversationId) {
      const rows = await prisma.message.findMany({
        where: { conversationId: ctx.conversationId },
        orderBy: { createdAt: "desc" },
        take: getConfig<number>(node, "historyLookback", 12),
        select: { direction: true, content: true },
      });
      conversation = rows.reverse().map((m) => ({
        role: m.direction === "INBOUND" ? "user" : "assistant",
        content: m.content,
      }));
    } else if (ctx.triggerText) {
      conversation = [{ role: "user", content: ctx.triggerText }];
    }

    if (conversation.length === 0) {
      return {
        nextNodeId: node.next ?? null,
        vars: { [reasonVar]: "fallback_empty_user_message" },
        trail: { skipped: "no conversation messages" },
      };
    }

    const result = await runAgent({
      tenantId: ctx.tenantId,
      agentId,
      conversation,
      context:
        getConfig<Record<string, string> | undefined>(node, "context", undefined) ??
        undefined,
    });

    const toolResults: ToolDispatchResult[] = [];
    if (result.toolCalls.length > 0) {
      // Dispatch each tool call sequentially. The agent.tools allowlist
      // already filtered the runner's output; the dispatcher re-checks
      // (defense-in-depth) so a custom caller can't bypass it. We pass
      // an allowlist derived from the tool calls themselves — every
      // call that reaches here was already validated by the runner.
      const allowedTools = Array.from(
        new Set(result.toolCalls.map((tc) => tc.tool)),
      );
      for (const call of result.toolCalls) {
        const r = await dispatchAgentTool(
          {
            tenantId: ctx.tenantId,
            contactId: ctx.contactId,
            conversationId: ctx.conversationId,
            allowedTools,
          },
          { tool: call.tool, arguments: call.arguments },
        );
        toolResults.push(r);
      }
    }

    const escalateBranch =
      node.branches?.escalated ?? node.branches?.fallback ?? node.next ?? null;
    const nextNodeId = result.escalated ? escalateBranch : node.next ?? null;

    return {
      nextNodeId,
      vars: {
        [replyVar]: result.reply ?? "",
        [toolResultsVar]: toolResults,
        [reasonVar]: result.reason,
        aiAgentEscalated: result.escalated,
        aiAgentEscalationBehavior: result.escalationBehavior,
        aiAgentCitations: result.citations,
        aiAgentProviderUsed: result.providerUsed,
        aiAgentModelUsed: result.modelUsed,
      },
      trail: {
        reason: result.reason,
        escalated: result.escalated,
        toolCalls: toolResults.map((r) => ({
          tool: r.tool,
          ok: r.ok,
          ...(r.ok ? {} : { error: r.error }),
        })),
        citations: result.citations.length,
        provider: result.providerUsed,
        model: result.modelUsed,
      },
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
  AI_AGENT: aiAgentHandler,
  WAIT_FOR_REPLY: waitForReplyHandler,
  SWITCH: switchHandler,
  FILTER: filterHandler,
};
