import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// AdGrowly / platform — Credit Engine (planning PDF §4). SUPER_ADMIN defines
// the credit cost of each AI/usage action; the app prices actions by reading
// the active rules (no hardcoded credit rules). Pure cost-resolution helpers
// are unit-tested; CRUD is platform-scoped.
// =====================================================================

/** Suggested action keys for the admin UI. Costs stay admin-defined. */
export const KNOWN_CREDIT_ACTIONS: { action: string; label: string }[] = [
  { action: "ai.review_reply", label: "AI review reply" },
  { action: "ai.post", label: "AI post generation" },
  { action: "ai.caption", label: "AI caption generation" },
  { action: "ai.image", label: "AI image generation" },
  { action: "ai.description", label: "AI description optimization" },
  { action: "ai.keyword_ideas", label: "AI keyword ideas" },
  { action: "ai.report", label: "AI report / monthly report" },
  { action: "ranking.check", label: "Local ranking check" },
  { action: "sms.send", label: "SMS send" },
  { action: "whatsapp.send", label: "WhatsApp send" },
];

/** Normalize an action key: trimmed, lowercased, dotted. */
export function normalizeActionKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

interface RuleLike {
  action: string;
  cost: number;
  isActive: boolean;
}

/** Resolve the credit cost of an action from active rules; null if unknown. */
export function resolveCost(rules: RuleLike[], action: string): number | null {
  const key = normalizeActionKey(action);
  const rule = rules.find((r) => r.isActive && r.action === key);
  return rule ? rule.cost : null;
}

/** Build an `{ action: cost }` map from active rules. */
export function buildCostMap(rules: RuleLike[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of rules) if (r.isActive) map[r.action] = r.cost;
  return map;
}

export interface EstimateItem {
  action: string;
  qty?: number;
}

export interface CostEstimate {
  total: number;
  lines: { action: string; qty: number; cost: number; subtotal: number }[];
  unknown: string[];
}

/** Estimate the total credit cost of a batch of actions. */
export function estimateCost(rules: RuleLike[], items: EstimateItem[]): CostEstimate {
  const lines: CostEstimate["lines"] = [];
  const unknown: string[] = [];
  let total = 0;
  for (const item of items) {
    const qty = Math.max(1, Math.trunc(item.qty ?? 1));
    const cost = resolveCost(rules, item.action);
    if (cost === null) {
      const key = normalizeActionKey(item.action);
      if (!unknown.includes(key)) unknown.push(key);
      continue;
    }
    const subtotal = cost * qty;
    total += subtotal;
    lines.push({ action: normalizeActionKey(item.action), qty, cost, subtotal });
  }
  return { total, lines, unknown };
}

interface RuleRow {
  id: string;
  action: string;
  label: string;
  description: string | null;
  cost: number;
  isActive: boolean;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSafeRule(row: RuleRow) {
  return {
    id: row.id,
    action: row.action,
    label: row.label,
    description: row.description,
    cost: row.cost,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------
// DB-backed operations (platform-scoped — SUPER_ADMIN)
// ---------------------------------------------------------------------

export async function listRules(activeOnly = false) {
  const rows = await prisma.creditRule.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: { action: "asc" },
  });
  return rows.map(toSafeRule);
}

export async function getCostMap() {
  const rows = await prisma.creditRule.findMany({ where: { isActive: true } });
  return buildCostMap(rows);
}

async function findOrThrow(id: string) {
  const row = await prisma.creditRule.findUnique({ where: { id } });
  if (!row) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Credit rule not found.");
  return row;
}

export interface CreateRuleInput {
  action: string;
  label: string;
  description?: string;
  cost: number;
  isActive?: boolean;
  updatedByUserId?: string;
}

export async function createRule(input: CreateRuleInput) {
  const action = normalizeActionKey(input.action);
  if (!action) throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "An action key is required.");
  if (!Number.isInteger(input.cost) || input.cost < 0) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Cost must be a non-negative integer.");
  }
  const existing = await prisma.creditRule.findUnique({ where: { action }, select: { id: true } });
  if (existing) {
    throw new ApiError(ErrorCodes.CONFLICT, 409, `A rule for "${action}" already exists.`);
  }
  const row = await prisma.creditRule.create({
    data: {
      action,
      label: input.label.trim(),
      description: input.description?.trim() || null,
      cost: input.cost,
      isActive: input.isActive ?? true,
      updatedByUserId: input.updatedByUserId ?? null,
    },
  });
  return toSafeRule(row);
}

export async function getRule(id: string) {
  return toSafeRule(await findOrThrow(id));
}

export interface UpdateRuleInput {
  label?: string;
  description?: string | null;
  cost?: number;
  isActive?: boolean;
  updatedByUserId?: string;
}

export async function updateRule(id: string, input: UpdateRuleInput) {
  const current = await findOrThrow(id);
  if (input.cost !== undefined && (!Number.isInteger(input.cost) || input.cost < 0)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Cost must be a non-negative integer.");
  }
  const row = await prisma.creditRule.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      updatedByUserId: input.updatedByUserId ?? current.updatedByUserId,
    },
  });
  return toSafeRule(row);
}

export async function deleteRule(id: string) {
  await findOrThrow(id);
  await prisma.creditRule.delete({ where: { id } });
}
