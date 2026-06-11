import { renderPrompt, type PromptVars } from "./aiPromptTemplate.service";

// =====================================================================
// AdGrowly GMB — AI prompt binding (planning PDF: "no hardcoded AI prompts").
// Maps each AI feature to its admin-managed AiPromptTemplate key (module 6) and
// renders the template when one is configured + active, falling back to the
// feature's deterministic draft otherwise. This lets the GMB AI features pull
// their prompt from Super Admin without changing their route contracts. Pure +
// unit-tested; the LLM gateway call layers on top of `renderWithFallback`.
// =====================================================================

/** Canonical AiPromptTemplate keys per GMB AI feature (admin-curated). */
export const GMB_PROMPT_KEYS = {
  reviewReply: "gmb.review_reply",
  postCaption: "gmb.post_caption",
  description: "gmb.description_optimizer",
  keywordIdeas: "gmb.keyword_finder",
  rankingAdvice: "gmb.ranking_advisor",
  image: "gmb.image_generator",
  report: "gmb.report",
} as const;

export type GmbPromptKey = (typeof GMB_PROMPT_KEYS)[keyof typeof GMB_PROMPT_KEYS];

/** Variables for the `gmb.review_reply` template, derived from a review. */
export function reviewReplyVariables(input: {
  authorName?: string | null;
  rating: number;
  businessName: string;
  comment?: string | null;
}): PromptVars {
  const firstName = (input.authorName ?? "").trim().split(/\s+/)[0] || "there";
  return {
    author: firstName,
    rating: input.rating,
    business: input.businessName.trim() || "our team",
    comment: (input.comment ?? "").trim(),
  };
}

/** Variables for the `gmb.post_caption` template, derived from post inputs. */
export function postCaptionVariables(input: {
  businessName: string;
  topic?: string | null;
  tone?: string | null;
}): PromptVars {
  return {
    business: input.businessName.trim() || "our business",
    topic: (input.topic ?? "").trim(),
    tone: (input.tone ?? "friendly").trim(),
  };
}

export interface PromptTemplateLike {
  template: string;
  isActive: boolean;
}

export interface RenderedPrompt {
  text: string;
  source: "template" | "fallback";
  missing: string[];
}

/**
 * Render the admin-managed template when it exists, is active and non-empty;
 * otherwise return the deterministic fallback the feature already produces.
 * `missing` lists placeholders left unfilled (caller may refuse to send).
 */
export function renderWithFallback(
  template: PromptTemplateLike | null | undefined,
  vars: PromptVars,
  fallback: string,
): RenderedPrompt {
  if (template && template.isActive && template.template.trim()) {
    const rendered = renderPrompt(template.template, vars);
    return { text: rendered.text, source: "template", missing: rendered.missing };
  }
  return { text: fallback, source: "fallback", missing: [] };
}
