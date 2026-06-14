import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// WhatsApp template components — pure validation/normalization for the
// Meta-style template builder (category, header type, typed buttons). No DB
// here so the rules are unit-testable; the route persists the cleaned shape.
// =====================================================================

export const TEMPLATE_CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const HEADER_TYPES = ["NONE", "TEXT", "IMAGE", "VIDEO", "DOCUMENT"] as const;
export type HeaderType = (typeof HEADER_TYPES)[number];

export const BUTTON_TYPES = ["QUICK_REPLY", "URL", "PHONE_NUMBER", "COPY_CODE", "FLOW"] as const;
export type TemplateButtonType = (typeof BUTTON_TYPES)[number];

export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  offerCode?: string;
  flowId?: string;
}

const bad = (msg: string): never => {
  throw new ApiError(ErrorCodes.BAD_REQUEST, 400, msg);
};

/** Normalize a category to Meta's three buckets (case-insensitive). */
export function normalizeTemplateCategory(value: unknown): TemplateCategory {
  const v = String(value ?? "").trim().toUpperCase();
  return (TEMPLATE_CATEGORIES as readonly string[]).includes(v) ? (v as TemplateCategory) : "MARKETING";
}

/** Normalize a header type; unknown/empty → NONE. */
export function normalizeHeaderType(value: unknown): HeaderType {
  const v = String(value ?? "").trim().toUpperCase();
  return (HEADER_TYPES as readonly string[]).includes(v) ? (v as HeaderType) : "NONE";
}

/**
 * Validate + normalize template buttons against Meta's component rules:
 * ≤10 total, ≤1 phone, ≤2 URL, ≤1 copy-code; each needs non-empty text ≤25
 * chars and its type-specific field. Throws ApiError(400) on violation;
 * returns the cleaned array (empty when none).
 */
export function validateTemplateButtons(raw: unknown): TemplateButton[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return bad("buttons must be an array.");
  if (raw.length > 10) return bad("A template can have at most 10 buttons.");

  const out: TemplateButton[] = [];
  let phone = 0;
  let url = 0;
  let copy = 0;

  for (const item of raw as Array<Record<string, unknown>>) {
    const type = String(item?.type ?? "").trim().toUpperCase();
    if (!(BUTTON_TYPES as readonly string[]).includes(type)) return bad(`Unknown button type: ${type || "(empty)"}.`);
    const text = String(item?.text ?? "").trim();
    if (!text) return bad("Each button needs a label.");
    if (text.length > 25) return bad("Button labels must be 25 characters or fewer.");

    const btn: TemplateButton = { type: type as TemplateButtonType, text };
    if (type === "URL") {
      const u = String(item?.url ?? "").trim();
      if (!/^https?:\/\/\S+$/.test(u)) return bad("URL buttons need a valid http(s) link.");
      btn.url = u;
      if (++url > 2) return bad("At most 2 URL buttons are allowed.");
    } else if (type === "PHONE_NUMBER") {
      const p = String(item?.phoneNumber ?? "").trim();
      if (!/^\+?[1-9]\d{6,14}$/.test(p)) return bad("Phone buttons need a valid number (E.164).");
      btn.phoneNumber = p;
      if (++phone > 1) return bad("Only 1 phone-number button is allowed.");
    } else if (type === "COPY_CODE") {
      const c = String(item?.offerCode ?? "").trim();
      if (!c || c.length > 15) return bad("Copy-code buttons need an offer code of 1–15 characters.");
      btn.offerCode = c;
      if (++copy > 1) return bad("Only 1 copy-code button is allowed.");
    } else if (type === "FLOW") {
      const f = String(item?.flowId ?? "").trim();
      if (f) btn.flowId = f;
    }
    out.push(btn);
  }
  return out;
}
