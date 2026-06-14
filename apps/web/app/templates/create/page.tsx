"use client";

// Guided WhatsApp Template builder (2-step wizard), modeled on Meta's
// own template composer:
//
//   Step 1 — pick a category (Marketing / Utility / Authentication) and a
//            template type, with a live preview of what each produces.
//   Step 2 — compose the components (header, body with formatting + variables,
//            footer, typed buttons) against a live phone preview, then submit.
//
// Posts to POST /api/v1/templates with the richer component fields
// (headerType / headerMediaUrl / buttons) the backend now accepts. The
// inline quick-create form on /templates still exists for power users; this
// is the friendly, preview-driven path.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../src/hooks/useAuth";
import { DashboardShell } from "../../../src/components/DashboardShell";
import { api, ApiClientError } from "../../../src/lib/api";

type Category = "MARKETING" | "UTILITY" | "AUTHENTICATION";
type HeaderType = "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE" | "FLOW";

interface DraftButton {
  id: number;
  type: ButtonType;
  text: string;
  url?: string;
  phoneNumber?: string;
  offerCode?: string;
  flowId?: string;
}

// Template types per category. Only the wired ones are selectable; the rest
// mirror Meta's composer for visual parity but are flagged "Soon" because the
// backend models the standard component shape (header/body/footer/buttons),
// not the bespoke Catalogue/Carousel/Flow structures yet.
const TEMPLATE_TYPES: Record<
  Category,
  Array<{ id: string; label: string; desc: string; enabled: boolean }>
> = {
  MARKETING: [
    { id: "CUSTOM", label: "Custom", desc: "Promotions, offers and announcements with optional media and buttons.", enabled: true },
    { id: "CATALOGUE", label: "Catalogue", desc: "Showcase products from your catalogue.", enabled: false },
    { id: "FLOWS", label: "Flows", desc: "Collect responses with an interactive flow.", enabled: false },
    { id: "ORDER_DETAILS", label: "Order Details", desc: "Send an itemised order with payment.", enabled: false },
    { id: "CAROUSEL", label: "Carousel", desc: "Up to 10 swipeable cards.", enabled: false },
  ],
  UTILITY: [
    { id: "CUSTOM", label: "Custom", desc: "Order updates, alerts and account notifications.", enabled: true },
    { id: "FLOWS", label: "Flows", desc: "Interactive flow for utility journeys.", enabled: false },
    { id: "ORDER_STATUS", label: "Order Status", desc: "Structured order status update.", enabled: false },
    { id: "ORDER_DETAILS", label: "Order Details", desc: "Itemised order details.", enabled: false },
  ],
  AUTHENTICATION: [
    { id: "OTP", label: "One-time passcode", desc: "Deliver a verification code with a copy-code button.", enabled: true },
  ],
};

const LANGUAGES = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "hi", label: "Hindi" },
  { code: "es_ES", label: "Spanish (Spain)" },
  { code: "es", label: "Spanish" },
  { code: "pt_BR", label: "Portuguese (Brazil)" },
  { code: "ar", label: "Arabic" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "id", label: "Indonesian" },
  { code: "ms", label: "Malay" },
  { code: "ta", label: "Tamil" },
];

const HEADER_OPTIONS: Array<{ value: HeaderType; label: string }> = [
  { value: "NONE", label: "None" },
  { value: "TEXT", label: "Text" },
  { value: "IMAGE", label: "Image" },
  { value: "VIDEO", label: "Video" },
  { value: "DOCUMENT", label: "Document" },
];

const BUTTON_MENU: Array<{ type: ButtonType; label: string; icon: string; defaultText: string }> = [
  { type: "QUICK_REPLY", label: "Custom (quick reply)", icon: "💬", defaultText: "Stop promotions" },
  { type: "URL", label: "Visit website", icon: "🔗", defaultText: "Visit website" },
  { type: "PHONE_NUMBER", label: "Call phone number", icon: "📞", defaultText: "Call us" },
  { type: "COPY_CODE", label: "Copy offer code", icon: "📋", defaultText: "Copy code" },
  { type: "FLOW", label: "Complete flow", icon: "➡️", defaultText: "Get started" },
];

function presetBody(category: Category, type: string): string {
  if (category === "AUTHENTICATION" || type === "OTP") {
    return "{{1}} is your verification code. For your security, do not share this code.";
  }
  if (category === "UTILITY") {
    return "Hi {{1}}, your order #{{2}} has been confirmed and will be delivered by {{3}}.";
  }
  return "Hi {{1}}, we're running a special offer just for you. Use code {{2}} for 20% off this week!";
}

/** Distinct {{n}} placeholders found in a string, ascending. */
function placeholders(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\{\{(\d+)\}\}/g)) found.add(m[1]);
  return [...found].sort((a, b) => Number(a) - Number(b));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Render WhatsApp-flavoured markdown (*bold* _italic_ ~strike~ ```mono```)
// to safe HTML, substituting sample values for {{n}} (or a chip when blank).
function renderWhatsApp(text: string, samples: Record<string, string>): string {
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]+?)```/g, '<code class="rounded bg-black/10 px-1 font-mono text-[11px]">$1</code>');
  html = html.replace(/\*(\S(?:[\s\S]*?\S)?)\*/g, "<strong>$1</strong>");
  html = html.replace(/_(\S(?:[\s\S]*?\S)?)_/g, "<em>$1</em>");
  html = html.replace(/~(\S(?:[\s\S]*?\S)?)~/g, "<del>$1</del>");
  html = html.replace(/\{\{(\d+)\}\}/g, (_m, n: string) =>
    samples[n]?.trim()
      ? escapeHtml(samples[n])
      : `<span class="rounded bg-amber-100 px-1 text-[11px] font-medium text-amber-800">{{${n}}}</span>`,
  );
  return html.replace(/\n/g, "<br/>");
}

export default function CreateTemplatePage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const router = useRouter();

  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<Category>("MARKETING");
  const [templateType, setTemplateType] = useState<string>("CUSTOM");

  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en_US");
  const [headerType, setHeaderType] = useState<HeaderType>("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerMediaUrl, setHeaderMediaUrl] = useState("");
  const [bodyText, setBodyText] = useState(presetBody("MARKETING", "CUSTOM"));
  const [footerText, setFooterText] = useState("");
  const [buttons, setButtons] = useState<DraftButton[]>([]);
  const [samples, setSamples] = useState<Record<string, string>>({});

  const [btnMenuOpen, setBtnMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const nextBtnId = useRef(1);

  const types = TEMPLATE_TYPES[category];

  function pickCategory(next: Category) {
    setCategory(next);
    const firstEnabled = TEMPLATE_TYPES[next].find((t) => t.enabled);
    const nextType = firstEnabled?.id ?? "CUSTOM";
    setTemplateType(nextType);
    // Only reseed the body if the operator hasn't diverged from a preset yet.
    setBodyText((cur) => (isPreset(cur) ? presetBody(next, nextType) : cur));
    if (next === "AUTHENTICATION") setHeaderType("NONE");
  }

  function isPreset(text: string): boolean {
    return (
      text === presetBody("MARKETING", "CUSTOM") ||
      text === presetBody("UTILITY", "CUSTOM") ||
      text === presetBody("AUTHENTICATION", "OTP")
    );
  }

  // --- Body formatting helpers (wrap selection, or append marker pair) ------
  function wrapSelection(marker: string, endMarker = marker) {
    const el = bodyRef.current;
    if (!el) {
      setBodyText((b) => b + marker + endMarker);
      return;
    }
    const start = el.selectionStart ?? bodyText.length;
    const end = el.selectionEnd ?? bodyText.length;
    const before = bodyText.slice(0, start);
    const sel = bodyText.slice(start, end) || "text";
    const after = bodyText.slice(end);
    const next = `${before}${marker}${sel}${endMarker}${after}`;
    setBodyText(next);
    // Restore a sensible caret/selection after React re-renders.
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + marker.length;
      el.selectionEnd = start + marker.length + sel.length;
    });
  }

  function addVariable() {
    const used = placeholders(bodyText + " " + headerText).map(Number);
    const next = used.length ? Math.max(...used) + 1 : 1;
    setBodyText((b) => `${b}{{${next}}}`);
  }

  // --- Buttons --------------------------------------------------------------
  function addButton(type: ButtonType) {
    setBtnMenuOpen(false);
    setErr(null);
    if (buttons.length >= 10) return setErr("A template can have at most 10 buttons.");
    if (type === "PHONE_NUMBER" && buttons.some((b) => b.type === "PHONE_NUMBER"))
      return setErr("Only 1 phone-number button is allowed.");
    if (type === "URL" && buttons.filter((b) => b.type === "URL").length >= 2)
      return setErr("At most 2 website buttons are allowed.");
    if (type === "COPY_CODE" && buttons.some((b) => b.type === "COPY_CODE"))
      return setErr("Only 1 copy-code button is allowed.");
    const preset = BUTTON_MENU.find((m) => m.type === type)!;
    setButtons((bs) => [...bs, { id: nextBtnId.current++, type, text: preset.defaultText }]);
  }

  function updateButton(id: number, patch: Partial<DraftButton>) {
    setButtons((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  function removeButton(id: number) {
    setButtons((bs) => bs.filter((b) => b.id !== id));
  }

  const allPlaceholders = useMemo(
    () => placeholders(`${headerText} ${bodyText}`),
    [headerText, bodyText],
  );

  // --- Submit ---------------------------------------------------------------
  async function submit() {
    setErr(null);
    const cleanName = name.trim();
    if (!/^[a-z0-9_]+$/.test(cleanName))
      return setErr("Template name must be lowercase letters, digits, or underscores.");
    if (!bodyText.trim()) return setErr("Body text is required.");
    if (headerType === "TEXT" && !headerText.trim())
      return setErr("Add header text or set the header to None.");
    if (headerType !== "NONE" && headerType !== "TEXT" && headerMediaUrl && !/^https?:\/\/\S+$/.test(headerMediaUrl))
      return setErr("Header media must be a valid http(s) URL (or leave it blank).");

    const payloadButtons = buttons.map((b) => {
      const base: Record<string, unknown> = { type: b.type, text: b.text.trim() };
      if (b.type === "URL") base.url = b.url?.trim();
      if (b.type === "PHONE_NUMBER") base.phoneNumber = b.phoneNumber?.trim();
      if (b.type === "COPY_CODE") base.offerCode = b.offerCode?.trim();
      if (b.type === "FLOW" && b.flowId?.trim()) base.flowId = b.flowId.trim();
      return base;
    });

    setBusy(true);
    try {
      await api.post("/api/v1/templates", {
        name: cleanName,
        category,
        language,
        headerType,
        headerText: headerType === "TEXT" ? headerText.trim() || undefined : undefined,
        headerMediaUrl:
          headerType !== "NONE" && headerType !== "TEXT" && headerMediaUrl.trim()
            ? headerMediaUrl.trim()
            : undefined,
        bodyText: bodyText.trim(),
        footerText: footerText.trim() || undefined,
        buttons: payloadButtons.length ? payloadButtons : undefined,
      });
      router.push("/templates");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create template.");
      setBusy(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <nav className="mb-1 text-xs text-slate-400">
            <Link href="/templates" className="hover:text-slate-600">
              WhatsApp Templates
            </Link>{" "}
            / <span className="text-slate-600">Create Template</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">Create Template</h1>
        </div>
        <StepBadge step={step} />
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {step === 1 ? (
        <Step1
          category={category}
          templateType={templateType}
          types={types}
          onCategory={pickCategory}
          onType={setTemplateType}
          onContinue={() => {
            setBodyText((cur) => (isPreset(cur) ? presetBody(category, templateType) : cur));
            setStep(2);
          }}
          onCancel={() => router.push("/templates")}
          previewBody={presetBody(category, templateType)}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
          {/* Builder */}
          <section className="space-y-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-700">
                Template Name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                  placeholder="ramadan_sale_2026"
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
                />
                <span className="mt-0.5 block text-[10px] text-slate-400">
                  Lowercase letters, digits, underscores.
                </span>
              </label>
              <label className="block text-xs font-medium text-slate-700">
                Language
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label} ({l.code})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Header */}
            <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Header</span>
                <span className="text-[10px] text-slate-400">Optional</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[140px,1fr]">
                <select
                  value={headerType}
                  onChange={(e) => setHeaderType(e.target.value as HeaderType)}
                  className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {HEADER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                {headerType === "TEXT" && (
                  <input
                    maxLength={60}
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Big news from {{1}}"
                    className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                )}
                {headerType !== "NONE" && headerType !== "TEXT" && (
                  <input
                    value={headerMediaUrl}
                    onChange={(e) => setHeaderMediaUrl(e.target.value)}
                    placeholder={`https://… sample ${headerType.toLowerCase()} URL (optional)`}
                    className="rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                )}
              </div>
            </div>

            {/* Body */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Body</span>
                <div className="flex items-center gap-1">
                  <FmtBtn label="B" title="Bold" onClick={() => wrapSelection("*")} bold />
                  <FmtBtn label="I" title="Italic" onClick={() => wrapSelection("_")} italic />
                  <FmtBtn label="S" title="Strikethrough" onClick={() => wrapSelection("~")} strike />
                  <FmtBtn label="</>" title="Monospace" onClick={() => wrapSelection("```")} mono />
                  <button
                    type="button"
                    onClick={addVariable}
                    className="ml-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100"
                  >
                    + Add Variable
                  </button>
                </div>
              </div>
              <textarea
                ref={bodyRef}
                rows={6}
                maxLength={1024}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              />
              <span className="mt-0.5 block text-right text-[10px] text-slate-400">
                {bodyText.length} / 1024
              </span>
            </div>

            {/* Footer */}
            <label className="block text-xs font-medium text-slate-700">
              Footer <span className="font-normal text-slate-400">(optional)</span>
              <input
                maxLength={60}
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Reply STOP to opt out"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <span className="mt-0.5 block text-right text-[10px] text-slate-400">
                {footerText.length} / 60
              </span>
            </label>

            {/* Buttons */}
            <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">Buttons</span>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setBtnMenuOpen((o) => !o)}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                  >
                    + Add a button
                  </button>
                  {btnMenuOpen && (
                    <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
                      {BUTTON_MENU.map((m) => (
                        <button
                          key={m.type}
                          type="button"
                          onClick={() => addButton(m.type)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
                        >
                          <span>{m.icon}</span>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {buttons.length === 0 ? (
                <p className="mt-2 text-[11px] text-slate-400">
                  No buttons. Add quick replies, a website link, a call button or a copy-code button.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {buttons.map((b) => (
                    <li key={b.id} className="rounded border border-slate-200 bg-white p-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {BUTTON_MENU.find((m) => m.type === b.type)?.icon}{" "}
                          {b.type.replace("_", " ")}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeButton(b.id)}
                          className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                        <input
                          maxLength={25}
                          value={b.text}
                          onChange={(e) => updateButton(b.id, { text: e.target.value })}
                          placeholder="Button label"
                          className="rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                        />
                        {b.type === "URL" && (
                          <input
                            value={b.url ?? ""}
                            onChange={(e) => updateButton(b.id, { url: e.target.value })}
                            placeholder="https://example.com"
                            className="rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <input
                            value={b.phoneNumber ?? ""}
                            onChange={(e) => updateButton(b.id, { phoneNumber: e.target.value })}
                            placeholder="+919812345678"
                            className="rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        )}
                        {b.type === "COPY_CODE" && (
                          <input
                            maxLength={15}
                            value={b.offerCode ?? ""}
                            onChange={(e) => updateButton(b.id, { offerCode: e.target.value })}
                            placeholder="SAVE20"
                            className="rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        )}
                        {b.type === "FLOW" && (
                          <input
                            value={b.flowId ?? ""}
                            onChange={(e) => updateButton(b.id, { flowId: e.target.value })}
                            placeholder="Flow ID (optional)"
                            className="rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                          />
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Sample values for placeholders → drives the preview */}
            {allPlaceholders.length > 0 && (
              <div className="rounded-md border border-slate-100 bg-slate-50/60 p-3">
                <span className="text-xs font-semibold text-slate-700">Sample values</span>
                <p className="text-[10px] text-slate-400">
                  Used only to preview how variables look. Not saved.
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {allPlaceholders.map((n) => (
                    <label key={n} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <span className="font-mono">{`{{${n}}}`}</span>
                      <input
                        value={samples[n] ?? ""}
                        onChange={(e) => setSamples((s) => ({ ...s, [n]: e.target.value }))}
                        placeholder="sample"
                        className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </section>

          {/* Live phone preview */}
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <PhonePreview
              headerType={headerType}
              headerText={headerText}
              bodyHtml={renderWhatsApp(bodyText, samples)}
              footerText={footerText}
              buttons={buttons}
            />
          </aside>
        </div>
      )}
    </DashboardShell>
  );
}

// ===========================================================================
// Step 1 — category + type selection with a preview.
// ===========================================================================
function Step1({
  category,
  templateType,
  types,
  onCategory,
  onType,
  onContinue,
  onCancel,
  previewBody,
}: {
  category: Category;
  templateType: string;
  types: Array<{ id: string; label: string; desc: string; enabled: boolean }>;
  onCategory: (c: Category) => void;
  onType: (t: string) => void;
  onContinue: () => void;
  onCancel: () => void;
  previewBody: string;
}) {
  const cats: Array<{ id: Category; label: string; desc: string }> = [
    { id: "MARKETING", label: "Marketing", desc: "Promotions, offers, product announcements." },
    { id: "UTILITY", label: "Utility", desc: "Order updates, alerts, account notifications." },
    { id: "AUTHENTICATION", label: "Authentication", desc: "One-time passcodes and verification." },
  ];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">Category</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {cats.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onCategory(c.id)}
              className={`rounded-lg border p-3 text-left transition ${
                category === c.id
                  ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                  : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="text-sm font-semibold text-slate-800">{c.label}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{c.desc}</div>
            </button>
          ))}
        </div>

        <h2 className="mt-5 text-sm font-semibold text-slate-800">Template type</h2>
        <div className="mt-2 space-y-2">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={!t.enabled}
              onClick={() => t.enabled && onType(t.id)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition ${
                templateType === t.id
                  ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500"
                  : t.enabled
                    ? "border-slate-200 hover:border-slate-300"
                    : "cursor-not-allowed border-slate-100 bg-slate-50 opacity-60"
              }`}
            >
              <span
                className={`mt-0.5 grid h-4 w-4 place-items-center rounded-full border ${
                  templateType === t.id ? "border-emerald-600" : "border-slate-300"
                }`}
              >
                {templateType === t.id && <span className="h-2 w-2 rounded-full bg-emerald-600" />}
              </span>
              <span className="flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
                  {t.label}
                  {!t.enabled && (
                    <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                      Soon
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-slate-500">{t.desc}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="rounded-md bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700"
          >
            Continue
          </button>
        </div>
      </section>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <PhonePreview
          headerType="NONE"
          headerText=""
          bodyHtml={renderWhatsApp(previewBody, {})}
          footerText=""
          buttons={[]}
        />
      </aside>
    </div>
  );
}

// ===========================================================================
// Shared pieces
// ===========================================================================
function StepBadge({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      {[1, 2].map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span
            className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold ${
              step >= (s as 1 | 2)
                ? "bg-emerald-600 text-white"
                : "bg-slate-200 text-slate-500"
            }`}
          >
            {s}
          </span>
          <span className={step === s ? "font-medium text-slate-700" : "text-slate-400"}>
            {s === 1 ? "Type" : "Compose"}
          </span>
          {s === 1 && <span className="text-slate-300">———</span>}
        </div>
      ))}
    </div>
  );
}

function FmtBtn({
  label,
  title,
  onClick,
  bold,
  italic,
  strike,
  mono,
}: {
  label: string;
  title: string;
  onClick: () => void;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  mono?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`h-6 w-7 rounded border border-slate-200 bg-white text-[11px] text-slate-700 hover:bg-slate-100 ${
        bold ? "font-bold" : ""
      } ${italic ? "italic" : ""} ${strike ? "line-through" : ""} ${mono ? "font-mono" : ""}`}
    >
      {label}
    </button>
  );
}

function PhonePreview({
  headerType,
  headerText,
  bodyHtml,
  footerText,
  buttons,
}: {
  headerType: HeaderType;
  headerText: string;
  bodyHtml: string;
  footerText: string;
  buttons: DraftButton[];
}) {
  const mediaLabel: Record<string, string> = {
    IMAGE: "🖼️  Image",
    VIDEO: "🎬  Video",
    DOCUMENT: "📄  Document",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-100 p-4 shadow-sm">
      <div className="mb-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
        Preview
      </div>
      <div className="mx-auto max-w-xs rounded-2xl bg-[#e5ddd5] p-3">
        <div className="rounded-lg rounded-tl-none bg-white p-2.5 shadow-sm">
          {headerType === "TEXT" && headerText.trim() && (
            <div className="mb-1 text-sm font-semibold text-slate-900">{headerText}</div>
          )}
          {headerType !== "NONE" && headerType !== "TEXT" && (
            <div className="mb-1.5 grid h-24 place-items-center rounded-md bg-slate-100 text-xs text-slate-400">
              {mediaLabel[headerType]}
            </div>
          )}
          <div
            className="whitespace-pre-wrap break-words text-[13px] leading-snug text-slate-800"
            dangerouslySetInnerHTML={{ __html: bodyHtml || "<span class='text-slate-300'>Body preview…</span>" }}
          />
          {footerText.trim() && (
            <div className="mt-1 text-[11px] text-slate-400">{footerText}</div>
          )}
          <div className="mt-1 text-right text-[9px] text-slate-400">12:30 PM</div>
        </div>
        {buttons.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {buttons.map((b) => (
              <div
                key={b.id}
                className="rounded-lg bg-white py-1.5 text-center text-[12px] font-medium text-[#1f8aff] shadow-sm"
              >
                {b.type === "URL" && "🔗 "}
                {b.type === "PHONE_NUMBER" && "📞 "}
                {b.type === "COPY_CODE" && "📋 "}
                {b.type === "FLOW" && "➡️ "}
                {b.text || "Button"}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
