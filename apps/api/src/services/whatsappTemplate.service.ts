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

// Composer sub-types within a category (drive which builder/preview is used).
export const TEMPLATE_TYPES = ["CUSTOM", "CATALOGUE", "FLOWS", "ORDER_DETAILS", "CAROUSEL", "OTP"] as const;
export type TemplateType = (typeof TEMPLATE_TYPES)[number];

// Catalogue templates choose one of these formats.
export const CATALOG_FORMATS = ["CATALOG_MESSAGE", "MPM"] as const;
export type CatalogFormat = (typeof CATALOG_FORMATS)[number];

// Authentication code-delivery methods (the OTP button's behaviour).
export const OTP_TYPES = ["COPY_CODE", "ONE_TAP", "ZERO_TAP"] as const;
export type OtpType = (typeof OTP_TYPES)[number];

export const BUTTON_TYPES = [
  "QUICK_REPLY",
  "URL",
  "PHONE_NUMBER",
  "COPY_CODE",
  "FLOW",
  // Marketing sub-type buttons — text-only, system-driven action:
  "CATALOG", // "View catalog" (Catalogue → Catalog Message)
  "MPM", // "View items" (Catalogue → Multi-Product Message)
  "ORDER_DETAILS", // "Review and Pay" (Order Details)
  "OTP", // Authentication code-delivery button (carries otpType)
] as const;
export type TemplateButtonType = (typeof BUTTON_TYPES)[number];

// Button types that carry no extra field beyond their label and are limited to
// one per template (they map to a single system action).
const SINGLETON_TEXT_BUTTONS: readonly string[] = ["CATALOG", "MPM", "ORDER_DETAILS"];

export interface TemplateButton {
  type: TemplateButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  offerCode?: string;
  flowId?: string;
  otpType?: OtpType;
}

export interface CarouselCard {
  headerType: HeaderType;
  headerMediaUrl?: string;
  bodyText: string;
  buttons: TemplateButton[];
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
  const singles: Record<string, number> = {};

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
    } else if (type === "OTP") {
      // Authentication code-delivery button. otpType drives the behaviour;
      // default to COPY_CODE (always supported). At most one per template.
      const ot = String(item?.otpType ?? "COPY_CODE").trim().toUpperCase();
      btn.otpType = (OTP_TYPES as readonly string[]).includes(ot) ? (ot as OtpType) : "COPY_CODE";
      singles.OTP = (singles.OTP ?? 0) + 1;
      if (singles.OTP > 1) return bad("Only 1 OTP button is allowed.");
    } else if (SINGLETON_TEXT_BUTTONS.includes(type)) {
      // CATALOG / MPM / ORDER_DETAILS — text-only, at most one per template.
      singles[type] = (singles[type] ?? 0) + 1;
      if (singles[type] > 1) {
        return bad(`Only 1 ${type.toLowerCase().replace(/_/g, " ")} button is allowed.`);
      }
    }
    out.push(btn);
  }
  return out;
}

/** Normalize a composer sub-type; unknown/empty → CUSTOM. */
export function normalizeTemplateType(value: unknown): TemplateType {
  const v = String(value ?? "").trim().toUpperCase();
  return (TEMPLATE_TYPES as readonly string[]).includes(v) ? (v as TemplateType) : "CUSTOM";
}

/** Normalize a catalogue format; unknown/empty → CATALOG_MESSAGE. */
export function normalizeCatalogFormat(value: unknown): CatalogFormat {
  const v = String(value ?? "").trim().toUpperCase();
  return (CATALOG_FORMATS as readonly string[]).includes(v) ? (v as CatalogFormat) : "CATALOG_MESSAGE";
}

/**
 * Validate + normalize carousel cards (Carousel templates): 1–10 cards, each
 * with an optional media/text header, a non-empty body (≤160 chars, Meta's
 * per-card limit) and its own button set (reusing validateTemplateButtons).
 * Throws ApiError(400) on violation; returns [] when there are no cards.
 */
export function validateCarousel(raw: unknown): CarouselCard[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return bad("carousel must be an array of cards.");
  if (raw.length === 0) return [];
  if (raw.length > 10) return bad("A carousel can have at most 10 cards.");

  return (raw as Array<Record<string, unknown>>).map((card, i) => {
    const headerType = normalizeHeaderType(card?.headerType);
    const bodyText = String(card?.bodyText ?? "").trim();
    if (!bodyText) return bad(`Carousel card ${i + 1} needs body text.`);
    if (bodyText.length > 160) return bad(`Carousel card ${i + 1} body must be 160 characters or fewer.`);
    const headerMediaUrl = String(card?.headerMediaUrl ?? "").trim();
    if (headerType !== "NONE" && headerType !== "TEXT" && headerMediaUrl && !/^https?:\/\/\S+$/.test(headerMediaUrl)) {
      return bad(`Carousel card ${i + 1} media must be a valid http(s) URL.`);
    }
    const out: CarouselCard = {
      headerType,
      bodyText,
      buttons: validateTemplateButtons(card?.buttons),
    };
    if (headerType !== "NONE" && headerType !== "TEXT" && headerMediaUrl) out.headerMediaUrl = headerMediaUrl;
    return out;
  });
}
