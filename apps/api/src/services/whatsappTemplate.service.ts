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

// Meta's documented authoring limits (characters), surfaced for reuse.
export const TEMPLATE_LIMITS = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonText: 25,
  carouselCardBody: 160,
} as const;

/** Distinct {{n}} variable numbers in a string, ascending. */
function variableNumbers(text: string): number[] {
  const nums = new Set<number>();
  for (const m of String(text).matchAll(/\{\{\s*(\d+)\s*\}\}/g)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}

/**
 * Enforce Meta's authoring policy on template text (beyond simple max-length),
 * so we reject locally what Meta would reject on submission:
 *   - body required, ≤1024 chars, and not only variables/whitespace
 *   - body variables {{n}} numbered sequentially from 1 with no gaps, and no
 *     two variables placed directly next to each other
 *   - header TEXT ≤60 chars with at most one variable
 *   - footer ≤60 chars with no variables
 * Throws ApiError(400) on the first violation.
 */
export function assertTemplateContentPolicy(input: {
  headerType?: string | null;
  headerText?: string | null;
  bodyText: string;
  footerText?: string | null;
}): void {
  const body = String(input.bodyText ?? "");
  if (!body.trim()) bad("Body text is required.");
  if (body.length > TEMPLATE_LIMITS.body) bad(`Body must be ${TEMPLATE_LIMITS.body} characters or fewer.`);
  if (!body.replace(/\{\{\s*\d+\s*\}\}/g, "").trim()) bad("Body must contain text, not only variables.");
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(body)) {
    bad("Body cannot have two variables next to each other — add text between them.");
  }
  variableNumbers(body).forEach((n, i) => {
    if (n !== i + 1) bad("Body variables must be numbered sequentially starting at {{1}} with no gaps.");
  });

  if (String(input.headerType ?? "").trim().toUpperCase() === "TEXT") {
    const header = String(input.headerText ?? "");
    if (header.length > TEMPLATE_LIMITS.headerText) bad(`Header text must be ${TEMPLATE_LIMITS.headerText} characters or fewer.`);
    if (variableNumbers(header).length > 1) bad("Header text can contain at most 1 variable.");
  }

  const footer = String(input.footerText ?? "");
  if (footer.length > TEMPLATE_LIMITS.footer) bad(`Footer must be ${TEMPLATE_LIMITS.footer} characters or fewer.`);
  if (variableNumbers(footer).length > 0) bad("Footer cannot contain variables.");
}

// =====================================================================
// Sync: map a Meta message-template (Graph API shape) into our row shape.
// Pure + defensive so it can be unit-tested; the route persists the result.
// =====================================================================

export interface MappedMetaTemplate {
  name: string;
  language: string;
  category: TemplateCategory;
  templateType: TemplateType;
  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED" | "FLAGGED";
  headerType: HeaderType;
  headerText: string | null;
  headerMediaUrl: string | null;
  bodyText: string;
  footerText: string | null;
  buttons: TemplateButton[];
}

/** Map Meta's template status string to our TemplateStatus value. */
function mapMetaStatus(value: unknown): MappedMetaTemplate["status"] {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "APPROVED") return "APPROVED";
  if (v === "REJECTED") return "REJECTED";
  if (v === "PENDING" || v === "SUBMITTED" || v === "IN_APPEAL" || v === "PENDING_DELETION") return "SUBMITTED";
  if (v === "PAUSED" || v === "DISABLED" || v === "FLAGGED") return "FLAGGED";
  return "DRAFT";
}

/** Map a single Meta button object to our TemplateButton (null if unknown). */
function mapMetaButton(raw: Record<string, unknown>): TemplateButton | null {
  const type = String(raw?.type ?? "").trim().toUpperCase();
  const text = String(raw?.text ?? "").trim();
  switch (type) {
    case "QUICK_REPLY":
      return { type: "QUICK_REPLY", text: text || "Quick reply" };
    case "URL":
      return { type: "URL", text: text || "Visit website", url: String(raw?.url ?? "").trim() };
    case "PHONE_NUMBER":
      return { type: "PHONE_NUMBER", text: text || "Call", phoneNumber: String(raw?.phone_number ?? "").trim() };
    case "COPY_CODE":
      return { type: "COPY_CODE", text: text || "Copy code", offerCode: String(raw?.example ?? "").trim() || undefined };
    case "FLOW":
      return { type: "FLOW", text: text || "Open", flowId: String(raw?.flow_id ?? "").trim() || undefined };
    case "CATALOG":
      return { type: "CATALOG", text: text || "View catalog" };
    case "MPM":
      return { type: "MPM", text: text || "View items" };
    case "ORDER_DETAILS":
      return { type: "ORDER_DETAILS", text: text || "Review and Pay" };
    case "OTP": {
      const ot = String(raw?.otp_type ?? "COPY_CODE").trim().toUpperCase();
      return {
        type: "OTP",
        text: text || "Copy code",
        otpType: (OTP_TYPES as readonly string[]).includes(ot) ? (ot as OtpType) : "COPY_CODE",
      };
    }
    default:
      return null;
  }
}

export function mapMetaTemplate(raw: unknown): MappedMetaTemplate {
  const t = (raw ?? {}) as Record<string, unknown>;
  const components = Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>) : [];

  let headerType: HeaderType = "NONE";
  let headerText: string | null = null;
  let headerMediaUrl: string | null = null;
  let bodyText = "";
  let footerText: string | null = null;
  let buttons: TemplateButton[] = [];
  let hasCarousel = false;

  for (const c of components) {
    const ctype = String(c?.type ?? "").trim().toUpperCase();
    if (ctype === "HEADER") {
      headerType = normalizeHeaderType(c?.format);
      if (headerType === "TEXT") {
        headerText = String(c?.text ?? "").trim() || null;
      } else if (headerType !== "NONE") {
        const ex = c?.example as Record<string, unknown> | undefined;
        const handle = Array.isArray(ex?.header_handle) ? ex?.header_handle[0] : undefined;
        headerMediaUrl = handle ? String(handle) : null;
      }
    } else if (ctype === "BODY") {
      bodyText = String(c?.text ?? "").trim();
    } else if (ctype === "FOOTER") {
      footerText = String(c?.text ?? "").trim() || null;
    } else if (ctype === "BUTTONS") {
      const bs = Array.isArray(c?.buttons) ? (c.buttons as Array<Record<string, unknown>>) : [];
      buttons = bs.map(mapMetaButton).filter((b): b is TemplateButton => b !== null);
    } else if (ctype === "CAROUSEL") {
      hasCarousel = true;
    }
  }

  const category = normalizeTemplateCategory(t.category);
  let templateType: TemplateType = "CUSTOM";
  if (hasCarousel) templateType = "CAROUSEL";
  else if (category === "AUTHENTICATION") templateType = "OTP";
  else if (buttons.some((b) => b.type === "CATALOG" || b.type === "MPM")) templateType = "CATALOGUE";
  else if (buttons.some((b) => b.type === "ORDER_DETAILS")) templateType = "ORDER_DETAILS";
  else if (buttons.some((b) => b.type === "FLOW")) templateType = "FLOWS";

  return {
    name: String(t.name ?? "").trim(),
    language: String(t.language ?? "en_US").trim() || "en_US",
    category,
    templateType,
    status: mapMetaStatus(t.status),
    headerType,
    headerText,
    headerMediaUrl,
    bodyText,
    footerText,
    buttons,
  };
}
