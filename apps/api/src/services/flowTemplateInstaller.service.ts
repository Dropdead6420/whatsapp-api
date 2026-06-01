// ============================================================================
// Automation Marketplace AI Installer (PRD-v2 §8)
//
// PRD §8: "Automation Marketplace With AI Installer: installs and customizes
// templates for industries automatically."
//
// The deterministic install path already exists in flow-templates.routes.ts
// — copy the template definition verbatim, create a ChatbotFlow. This
// module adds an *AI-customized* variant: same flow, same graph
// structure, but text-bearing node fields are rewritten by Claude to
// match the tenant's industry + business name + voice.
//
// Critical safety invariant: the LLM can ONLY edit text fields on
// already-existing nodes. It can never:
//   - add or remove nodes
//   - rewire edges (`next` / `branches`)
//   - change a node's `type` or `id`
//   - move node positions
//
// applyTextOverrides enforces this by walking the original definition
// and looking up each node's text fields in the LLM-returned map. Any
// extra nodes the model invents are dropped; any structural change is
// ignored. On any LLM failure / empty response, the original
// definition is returned unchanged. This is the same generate-then-
// approve discipline as ADR-030/033/035/038.
// ============================================================================

import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { prisma } from "@nexaflow/db";

// The text fields we know how to rewrite. Adding a new flow node with
// a new text-bearing field means adding it to this list — until then
// the LLM rewrite leaves it untouched.
const REWRITABLE_FIELDS = ["text", "body", "prompt", "question"] as const;
type RewritableField = (typeof REWRITABLE_FIELDS)[number];

interface FlowNode {
  id: string;
  type: string;
  next?: string;
  branches?: Record<string, string>;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

interface FlowDefinition {
  nodes: FlowNode[];
  edges?: unknown[];
}

/**
 * Pull the text-bearing fields from each node so the LLM has the exact
 * shape it needs to rewrite. Returns a map keyed by node id → { field: value }.
 */
export function extractTextSurface(
  def: FlowDefinition,
): Record<string, Partial<Record<RewritableField, string>>> {
  const surface: Record<string, Partial<Record<RewritableField, string>>> = {};
  for (const node of def.nodes) {
    const data = node.data ?? {};
    const fields: Partial<Record<RewritableField, string>> = {};
    let any = false;
    for (const key of REWRITABLE_FIELDS) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) {
        fields[key] = value;
        any = true;
      }
    }
    if (any) surface[node.id] = fields;
  }
  return surface;
}

/**
 * Apply LLM-returned overrides to the original definition. The graph
 * structure (ids, types, edges, positions) is preserved exactly; only
 * `data.<rewritable-field>` strings can be replaced.
 *
 * Pure function — exported for unit tests.
 */
export function applyTextOverrides(
  def: FlowDefinition,
  overrides: Record<string, Partial<Record<RewritableField, string>>>,
): FlowDefinition {
  const safeOverrides: typeof overrides = {};
  const knownNodeIds = new Set(def.nodes.map((n) => n.id));
  for (const [nodeId, fields] of Object.entries(overrides)) {
    // Drop any "node id" the model invented.
    if (!knownNodeIds.has(nodeId)) continue;
    const cleanFields: Partial<Record<RewritableField, string>> = {};
    for (const key of REWRITABLE_FIELDS) {
      const value = fields[key];
      if (typeof value === "string" && value.trim()) {
        // Clamp to 1024 chars so a runaway model can't bloat a node.
        cleanFields[key] = value.trim().slice(0, 1024);
      }
    }
    if (Object.keys(cleanFields).length > 0) {
      safeOverrides[nodeId] = cleanFields;
    }
  }

  return {
    ...def,
    nodes: def.nodes.map((node) => {
      const fields = safeOverrides[node.id];
      if (!fields) return node;
      const nextData = { ...(node.data ?? {}) };
      for (const key of REWRITABLE_FIELDS) {
        if (fields[key]) {
          nextData[key] = fields[key]!;
        }
      }
      return { ...node, data: nextData };
    }),
  };
}

export interface FlowCustomizationResult {
  definition: FlowDefinition;
  source: "ai" | "fallback";
}

/**
 * Ask Claude to rewrite the template's text fields for the tenant's
 * industry + business name. On any failure, returns the original
 * definition (`source: "fallback"`).
 *
 * Billed to the tenant via runTenantLlmJson.
 */
export async function aiCustomizeFlowTemplate(args: {
  tenantId: string;
  industry: string;
  businessName: string;
  templateName: string;
  definition: FlowDefinition;
}): Promise<FlowCustomizationResult> {
  const surface = extractTextSurface(args.definition);
  if (Object.keys(surface).length === 0) {
    // Template has no text-bearing nodes — nothing to customize. Skip
    // the LLM call entirely so we don't burn credits on a no-op.
    return { definition: args.definition, source: "fallback" };
  }

  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const llm = await runTenantLlmJson<{
      overrides?: Record<string, Partial<Record<string, string>>>;
    }>({
      tenantId: args.tenantId,
      feature: "flow_template_ai_install",
      system:
        "You are a WhatsApp automation copywriter customizing a flow template " +
        "for a specific business. The template has named text fields on each " +
        "node; rewrite them to fit the business's industry + name. " +
        "Constraints:\n" +
        " - Keep every node id from the input.\n" +
        " - Do NOT add, remove, or reorder nodes.\n" +
        " - Do NOT invent new node ids.\n" +
        " - Only change the TEXT of the listed fields. Skip a field if " +
        "you have no improvement.\n" +
        " - Each rewritten value must stay under 1024 characters.\n" +
        " - Keep variable placeholders (e.g. {{1}}, {{name}}) intact.\n" +
        " - Tone: warm + concrete + no emoji spam.\n" +
        'Return JSON: {"overrides":{"<nodeId>":{"<field>":"<new value>",...},...}}',
      prompt: JSON.stringify({
        templateName: args.templateName,
        industry: args.industry,
        businessName: args.businessName,
        nodes: surface,
      }),
      maxTokens: 1600,
      temperature: 0.4,
    });

    if (!llm.overrides || typeof llm.overrides !== "object") {
      return { definition: args.definition, source: "fallback" };
    }
    const customized = applyTextOverrides(
      args.definition,
      llm.overrides as Parameters<typeof applyTextOverrides>[1],
    );
    return { definition: customized, source: "ai" };
  } catch (err) {
    console.error("[flow-template-installer] LLM customization failed:", err);
    return { definition: args.definition, source: "fallback" };
  }
}

/**
 * High-level install entry-point. Loads template + tenant, runs the
 * customizer, returns the (possibly-rewritten) definition for the
 * caller to validate + persist. The caller (the route) still owns
 * the structural validation + ChatbotFlow insert, so the deterministic
 * install path and the AI install path share one create flow.
 */
export async function loadCustomizedDefinition(args: {
  tenantId: string;
  templateSlug: string;
}): Promise<{
  templateName: string;
  templateDescription: string | null;
  result: FlowCustomizationResult;
}> {
  const [template, tenant] = await Promise.all([
    prisma.flowTemplate.findFirst({
      where: { slug: args.templateSlug, isPublic: true },
    }),
    prisma.tenant.findUnique({
      where: { id: args.tenantId },
      select: { name: true },
    }),
  ]);
  if (!template) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found.");
  }
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }
  const definition = JSON.parse(template.definition) as FlowDefinition;
  const result = await aiCustomizeFlowTemplate({
    tenantId: args.tenantId,
    industry: template.industry,
    businessName: tenant.name,
    templateName: template.name,
    definition,
  });
  return {
    templateName: template.name,
    templateDescription: template.description,
    result,
  };
}
