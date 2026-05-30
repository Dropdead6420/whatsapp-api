import { runTenantLlmJson } from "../ai.service";
import { FlowDefinition, FlowNode } from "./types";

type GeneratedTrigger =
  | "keyword"
  | "message_received"
  | "manual"
  | "lead_created"
  | "tag_added"
  | "appointment_booked";

export interface GeneratedFlowDraft {
  name: string;
  description: string;
  trigger: GeneratedTrigger;
  triggerKeywords: string[];
  definition: FlowDefinition;
  aiUsed: boolean;
  aiFallbackReason?: string;
}

interface AiFlowDraft {
  name?: unknown;
  description?: unknown;
  trigger?: unknown;
  triggerKeywords?: unknown;
  nodes?: unknown;
}

const ALLOWED_NODE_TYPES = new Set([
  "START",
  "MESSAGE",
  "SEND_TEMPLATE",
  "CREATE_LEAD",
  "CONDITION",
  "DELAY",
  "ADD_TAG",
  "AGENT_TRANSFER",
  "AI_RESPONSE",
  "WAIT_FOR_REPLY",
  "END",
]);

const TRIGGERS: GeneratedTrigger[] = [
  "keyword",
  "message_received",
  "manual",
  "lead_created",
  "tag_added",
  "appointment_booked",
];

function clampText(value: unknown, fallback: string, max = 240): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed.slice(0, max) : fallback;
}

function slugifyId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9_ -]/g, "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .slice(0, 48);
  return id || fallback;
}

function uniqueId(base: string, seen: Set<string>): string {
  let id = base;
  let i = 2;
  while (seen.has(id)) {
    id = `${base}_${i}`;
    i += 1;
  }
  seen.add(id);
  return id;
}

function inferTrigger(prompt: string): GeneratedTrigger {
  const p = prompt.toLowerCase();
  if (p.includes("lead created") || p.includes("new lead")) return "lead_created";
  if (p.includes("appointment booked") || p.includes("booking confirmed")) {
    return "appointment_booked";
  }
  if (p.includes("any message") || p.includes("every message")) return "message_received";
  if (p.includes("manual")) return "manual";
  return "keyword";
}

function inferKeywords(prompt: string): string[] {
  const quoted = Array.from(prompt.matchAll(/["']([^"']{2,40})["']/g)).map((m) => m[1]);
  const p = prompt.toLowerCase();
  const candidates = [
    ...quoted,
    p.includes("price") || p.includes("pricing") ? "price" : "",
    p.includes("book") || p.includes("appointment") ? "book" : "",
    p.includes("support") || p.includes("help") ? "help" : "",
    p.includes("demo") ? "demo" : "",
    p.includes("quote") ? "quote" : "",
    p.includes("offer") || p.includes("discount") ? "offer" : "",
  ];
  const normalized = candidates
    .map((kw) => kw.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim())
    .filter(Boolean)
    .map((kw) => kw.slice(0, 40));
  return Array.from(new Set(normalized)).slice(0, 8);
}

function inferTag(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("price") || p.includes("pricing")) return "price_inquiry";
  if (p.includes("book") || p.includes("appointment")) return "booking_interest";
  if (p.includes("support") || p.includes("help")) return "support_request";
  if (p.includes("demo")) return "demo_interest";
  if (p.includes("quote")) return "quote_request";
  return "ai_flow_generated";
}

function inferReply(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("price") || p.includes("pricing")) {
    return "Hi! Thanks for asking. I can share pricing and help you choose the right option. What service are you interested in?";
  }
  if (p.includes("book") || p.includes("appointment")) {
    return "Hi! I can help you book an appointment. Please share your preferred date, time, and service.";
  }
  if (p.includes("support") || p.includes("help")) {
    return "Hi! Thanks for reaching out. Please share a few details and our team will help you shortly.";
  }
  if (p.includes("demo")) {
    return "Hi! I can help you with a quick demo. Please share your business name and the workflow you want to automate.";
  }
  return "Hi! Thanks for your message. I have noted your request and our team will follow up shortly.";
}

function buildFallbackDraft(prompt: string, reason?: string): GeneratedFlowDraft {
  const trigger = inferTrigger(prompt);
  const triggerKeywords = trigger === "keyword" ? inferKeywords(prompt) : [];
  const tag = inferTag(prompt);
  const nodes: FlowNode[] = [
    {
      id: "start",
      type: "START",
      isEntry: true,
      config: {},
      next: "reply",
    },
    {
      id: "reply",
      type: "MESSAGE",
      config: { text: inferReply(prompt) },
      next: "tag_contact",
    },
    {
      id: "tag_contact",
      type: "ADD_TAG",
      config: { tag },
      next: prompt.toLowerCase().includes("lead") ? "create_lead" : "done",
    },
  ];
  if (prompt.toLowerCase().includes("lead")) {
    nodes.push({
      id: "create_lead",
      type: "CREATE_LEAD",
      config: {
        title: "Workflow lead from {{contact.name}}",
        description: `Generated from prompt: ${prompt.slice(0, 160)}`,
      },
      next: "done",
    });
  }
  nodes.push({ id: "done", type: "END", config: {} });

  return {
    name: nameFromPrompt(prompt),
    description: `Generated from plain English: ${prompt.slice(0, 180)}`,
    trigger,
    triggerKeywords,
    definition: { nodes, edges: deriveEdges(nodes) },
    aiUsed: false,
    aiFallbackReason: reason,
  };
}

function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(when|if|create|build|make)\s+/i, "");
  if (!cleaned) return "AI generated flow";
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`.slice(0, 80);
}

function deriveEdges(nodes: FlowNode[]) {
  const edges: Array<{ from: string; to: string; label?: string }> = [];
  for (const node of nodes) {
    if (node.next) edges.push({ from: node.id, to: node.next });
    if (node.branches) {
      for (const [label, to] of Object.entries(node.branches)) {
        edges.push({ from: node.id, to, label });
      }
    }
  }
  return edges;
}

function normalizeKeywords(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : fallback;
  const cleaned = raw
    .map((kw) => (typeof kw === "string" ? kw : ""))
    .map((kw) => kw.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().slice(0, 40))
    .filter(Boolean);
  return Array.from(new Set(cleaned)).slice(0, 20);
}

function normalizeNode(rawNode: unknown, seen: Set<string>): FlowNode | null {
  if (!rawNode || typeof rawNode !== "object") return null;
  const source = rawNode as Record<string, unknown>;
  const type = clampText(source.type, "", 40).toUpperCase();
  if (!ALLOWED_NODE_TYPES.has(type)) return null;
  const id = uniqueId(slugifyId(source.id, type.toLowerCase()), seen);
  const rawConfig =
    source.config && typeof source.config === "object"
      ? (source.config as Record<string, unknown>)
      : {};
  const config: Record<string, unknown> = {};

  if (type === "MESSAGE") {
    config.text = clampText(rawConfig.text, "Hi! Thanks for your message.", 1200);
  } else if (type === "ADD_TAG") {
    config.tag = slugifyId(rawConfig.tag, "ai_flow_generated");
  } else if (type === "CREATE_LEAD") {
    config.title = clampText(rawConfig.title, "Workflow lead", 120);
    config.description = clampText(rawConfig.description, "Created by generated flow.", 500);
  } else if (type === "DELAY") {
    const seconds = Number(rawConfig.seconds ?? 60);
    config.seconds = Number.isFinite(seconds) ? Math.max(1, Math.min(604800, seconds)) : 60;
  } else if (type === "SEND_TEMPLATE") {
    config.templateName = clampText(rawConfig.templateName, "", 120);
    config.languageCode = clampText(rawConfig.languageCode, "en", 12);
    config.bodyParams = Array.isArray(rawConfig.bodyParams) ? rawConfig.bodyParams.slice(0, 10) : [];
  } else if (type === "AGENT_TRANSFER") {
    config.reason = clampText(rawConfig.reason, "Generated flow handoff", 200);
  } else if (type === "AI_RESPONSE") {
    config.prompt = clampText(rawConfig.prompt, "Reply helpfully and briefly.", 500);
    config.autoSend = rawConfig.autoSend === true;
  } else if (type === "WAIT_FOR_REPLY") {
    config.timeoutSeconds = Math.max(60, Math.min(604800, Number(rawConfig.timeoutSeconds ?? 86400)));
  } else if (type === "CONDITION") {
    const rules = Array.isArray(rawConfig.rules) ? rawConfig.rules.slice(0, 8) : [];
    config.rules = rules
      .map((rule) => {
        if (!rule || typeof rule !== "object") return null;
        const r = rule as Record<string, unknown>;
        return {
          path: clampText(r.path, "triggerText", 80),
          op: clampText(r.op, "contains", 20),
          value: r.value,
          goto: slugifyId(r.goto, "done"),
        };
      })
      .filter(Boolean);
    config.default = slugifyId(rawConfig.default, "done");
  }

  return {
    id,
    type,
    isEntry: source.isEntry === true || type === "START",
    config,
    next: typeof source.next === "string" ? slugifyId(source.next, "") : undefined,
    branches:
      source.branches && typeof source.branches === "object"
        ? Object.fromEntries(
            Object.entries(source.branches as Record<string, unknown>)
              .filter(([, value]) => typeof value === "string")
              .map(([key, value]) => [key.slice(0, 40), slugifyId(value, "")]),
          )
        : undefined,
  };
}

function normalizeAiDraft(prompt: string, parsed: AiFlowDraft): GeneratedFlowDraft {
  const fallback = buildFallbackDraft(prompt);
  const seen = new Set<string>();
  const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : [])
    .map((node) => normalizeNode(node, seen))
    .filter((node): node is FlowNode => Boolean(node));

  if (!nodes.some((node) => node.type === "START" || node.isEntry)) {
    nodes.unshift({
      id: uniqueId("start", seen),
      type: "START",
      isEntry: true,
      config: {},
      next: nodes[0]?.id ?? "done",
    });
  }
  if (!nodes.some((node) => node.type === "END")) {
    nodes.push({ id: uniqueId("done", seen), type: "END", config: {} });
  }

  const ids = new Set(nodes.map((node) => node.id));
  const endId = nodes.find((node) => node.type === "END")?.id ?? "done";
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.type === "END") {
      node.next = undefined;
      node.branches = undefined;
      continue;
    }
    if (node.next && !ids.has(node.next)) node.next = undefined;
    if (!node.next && !node.branches) node.next = nodes[i + 1]?.id ?? endId;
    if (node.branches) {
      node.branches = Object.fromEntries(
        Object.entries(node.branches).filter(([, target]) => ids.has(target)),
      );
      if (Object.keys(node.branches).length === 0) node.branches = undefined;
    }
  }

  return {
    name: clampText(parsed.name, fallback.name, 120),
    description: clampText(parsed.description, fallback.description, 2000),
    trigger: TRIGGERS.includes(parsed.trigger as GeneratedTrigger)
      ? (parsed.trigger as GeneratedTrigger)
      : fallback.trigger,
    triggerKeywords: normalizeKeywords(parsed.triggerKeywords, fallback.triggerKeywords),
    definition: { nodes, edges: deriveEdges(nodes) },
    aiUsed: true,
  };
}

export async function generateFlowFromPrompt(args: {
  tenantId: string;
  prompt: string;
  useAi?: boolean;
}): Promise<GeneratedFlowDraft> {
  const prompt = args.prompt.trim();
  if (args.useAi === false) return buildFallbackDraft(prompt);

  try {
    const parsed = await runTenantLlmJson<AiFlowDraft>({
      tenantId: args.tenantId,
      feature: "flow_plain_english",
      system:
        "You convert WhatsApp automation requests into safe NexaFlow flow JSON. Return strict JSON only. Prefer simple, short flows.",
      prompt: [
        "Create an inactive WhatsApp automation flow from this request.",
        `Request: ${prompt}`,
        "",
        "Supported node types and configs:",
        '- START: {"next":"node_id"}',
        '- MESSAGE: {"text":"message with {{triggerText}} variables"}',
        '- ADD_TAG: {"tag":"snake_case_tag"}',
        '- CREATE_LEAD: {"title":"...","description":"..."}',
        '- DELAY: {"seconds":60}',
        '- AGENT_TRANSFER: {"reason":"..."}',
        '- AI_RESPONSE: {"prompt":"...","autoSend":false}',
        '- WAIT_FOR_REPLY: {"timeoutSeconds":86400}',
        '- END: {}',
        "",
        "Return JSON shape:",
        '{"name":"...","description":"...","trigger":"keyword|message_received|manual|lead_created|tag_added|appointment_booked","triggerKeywords":["..."],"nodes":[{"id":"start","type":"START","isEntry":true,"config":{},"next":"reply"}]}',
      ].join("\n"),
      maxTokens: 1200,
      temperature: 0.2,
    });
    return normalizeAiDraft(prompt, parsed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "AI unavailable";
    return buildFallbackDraft(prompt, reason);
  }
}
