"use client";

// Partner theme builder — REAL backend integration.
//
// Wires to the existing Branding model (whitelabel.service.ts +
// /api/v1/partner/whitelabel routes). The Branding row is unique per
// tenant; saves persist across browsers + devices.
//
// Theme presets ("dark / glass / sunset / light") map to color triples
// applied to primary + secondary + accent at once. The preset itself
// isn't persisted — only the resulting colors are. Operators start
// from a preset and tweak.

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface Branding {
  id: string;
  tenantId: string;
  logoUrl: string | null;
  logoSquareUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string;
  fontUrl: string | null;
  customCss: string | null;
}

const PRESETS: Record<
  "dark" | "glass" | "sunset" | "light",
  { primary: string; secondary: string; accent: string; label: string }
> = {
  dark:   { primary: "#6366f1", secondary: "#1e293b", accent: "#10b981", label: "Indigo Dark" },
  glass:  { primary: "#0ea5e9", secondary: "#f8fafc", accent: "#8b5cf6", label: "Glass Blue" },
  sunset: { primary: "#f97316", secondary: "#fef3c7", accent: "#dc2626", label: "Sunset Warm" },
  light:  { primary: "#0066cc", secondary: "#f0f0f0", accent: "#ff6600", label: "Classic Light" },
};

const FONTS = ["Inter", "Outfit", "Roboto", "DM Sans", "Plus Jakarta Sans"];

const COLOR_REGEX = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;

export default function ThemeBuilderPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [branding, setBranding] = useState<Branding | null>(null);
  const [draft, setDraft] = useState<{
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    fontFamily: string;
  }>({
    primaryColor: "#0066cc",
    secondaryColor: "#f0f0f0",
    accentColor: "#ff6600",
    fontFamily: "Inter",
  });

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      const data = await api.get<Branding>("/api/v1/partner/whitelabel");
      setBranding(data);
      setDraft({
        primaryColor: data.primaryColor,
        secondaryColor: data.secondaryColor,
        accentColor: data.accentColor,
        fontFamily: data.fontFamily,
      });
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load branding: ${e.message}`
          : "Failed to load branding.",
      );
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  function applyPreset(key: keyof typeof PRESETS) {
    const p = PRESETS[key];
    setDraft((d) => ({
      ...d,
      primaryColor: p.primary,
      secondaryColor: p.secondary,
      accentColor: p.accent,
    }));
    setNotice(`Loaded preset "${p.label}". Click Save theme to persist.`);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!COLOR_REGEX.test(draft.primaryColor)) {
      setErr("Primary color must be a valid hex like #6366f1");
      return;
    }
    if (!COLOR_REGEX.test(draft.secondaryColor)) {
      setErr("Secondary color must be a valid hex like #f0f0f0");
      return;
    }
    if (!COLOR_REGEX.test(draft.accentColor)) {
      setErr("Accent color must be a valid hex like #10b981");
      return;
    }
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const updated = await api.put<Branding>(
        "/api/v1/partner/whitelabel",
        draft,
      );
      setBranding(updated);
      setNotice("Theme saved. New colors apply to all dashboards on next reload.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefaults() {
    if (!window.confirm("Reset theme to platform defaults? This clears your custom colors + font.")) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<{ branding?: Branding }>(
        "/api/v1/partner/whitelabel/reset",
        {},
      );
      if (result.branding) {
        setBranding(result.branding);
        setDraft({
          primaryColor: result.branding.primaryColor,
          secondaryColor: result.branding.secondaryColor,
          accentColor: result.branding.accentColor,
          fontFamily: result.branding.fontFamily,
        });
      } else {
        // Endpoint shape may vary; refetch to be safe.
        await refresh();
      }
      setNotice("Reset to defaults.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  // Live preview from `draft` so operators see changes as they tweak.
  const previewStyle = useMemo(
    () => ({
      "--preview-primary": draft.primaryColor,
      "--preview-secondary": draft.secondaryColor,
      "--preview-accent": draft.accentColor,
      "--preview-font": draft.fontFamily,
    }) as React.CSSProperties,
    [draft],
  );

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const hasUnsavedChanges =
    branding !== null &&
    (draft.primaryColor !== branding.primaryColor ||
      draft.secondaryColor !== branding.secondaryColor ||
      draft.accentColor !== branding.accentColor ||
      draft.fontFamily !== branding.fontFamily);

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Theme builder</h1>
          <p className="mt-1 text-sm text-slate-600">
            Customize colors + font for every dashboard your customers see.
            Saves persist server-side; changes apply on the next page load.
          </p>
        </div>
        {hasUnsavedChanges && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            unsaved
          </span>
        )}
      </header>

      {(err || notice) && (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-sm ${
            err
              ? "border border-red-200 bg-red-50 text-red-700"
              : "border border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {err ?? notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        {/* Form */}
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Presets</h2>
          <p className="mt-1 text-xs text-slate-600">
            Starting points. After applying, tweak the colors below before saving.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map((key) => {
              const p = PRESETS[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="flex items-center gap-3 rounded-md border border-slate-200 p-3 text-left text-sm hover:border-slate-400"
                >
                  <div className="flex gap-1">
                    <span className="h-6 w-6 rounded" style={{ background: p.primary }} />
                    <span className="h-6 w-6 rounded" style={{ background: p.secondary }} />
                    <span className="h-6 w-6 rounded" style={{ background: p.accent }} />
                  </div>
                  <div>
                    <div className="font-medium">{p.label}</div>
                    <div className="font-mono text-[9px] text-slate-500">
                      {p.primary} / {p.secondary} / {p.accent}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <form onSubmit={save} className="mt-6 space-y-4 border-t border-slate-100 pt-5">
            <h2 className="text-base font-semibold text-slate-900">Custom</h2>

            <div className="grid gap-3 sm:grid-cols-3">
              <ColorInput
                label="Primary"
                value={draft.primaryColor}
                onChange={(v) => setDraft((d) => ({ ...d, primaryColor: v }))}
              />
              <ColorInput
                label="Secondary"
                value={draft.secondaryColor}
                onChange={(v) => setDraft((d) => ({ ...d, secondaryColor: v }))}
              />
              <ColorInput
                label="Accent"
                value={draft.accentColor}
                onChange={(v) => setDraft((d) => ({ ...d, accentColor: v }))}
              />
            </div>

            <label className="block text-xs font-medium text-slate-700">
              Font family
              <select
                value={draft.fontFamily}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, fontFamily: e.target.value }))
                }
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                {FONTS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[10px] text-slate-500">
                Loaded via Google Fonts. Custom font URL goes on the
                white-label builder page.
              </span>
            </label>

            <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
              <button
                type="submit"
                disabled={busy || !hasUnsavedChanges}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow hover:bg-emerald-700 disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save theme"}
              </button>
              <button
                type="button"
                onClick={() => void resetToDefaults()}
                disabled={busy}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              >
                Reset to defaults
              </button>
            </div>
          </form>
        </section>

        {/* Live preview */}
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Live preview
          </div>
          <div className="space-y-3 p-4" style={previewStyle}>
            <div className="rounded-md p-4" style={{ background: draft.primaryColor }}>
              <div
                className="text-sm font-semibold"
                style={{ color: "#fff", fontFamily: draft.fontFamily }}
              >
                Welcome back
              </div>
              <div
                className="mt-0.5 text-xs"
                style={{
                  color: "rgba(255,255,255,0.85)",
                  fontFamily: draft.fontFamily,
                }}
              >
                Inbox · Campaigns · Wallet
              </div>
            </div>
            <div
              className="rounded-md p-4 text-sm"
              style={{
                background: draft.secondaryColor,
                color: "#0f172a",
                fontFamily: draft.fontFamily,
              }}
            >
              Secondary surface — used for cards + side panels. Body copy should
              read here without strain.
            </div>
            <button
              type="button"
              className="w-full rounded-md py-2 text-sm font-semibold text-white"
              style={{
                background: draft.accentColor,
                fontFamily: draft.fontFamily,
              }}
            >
              Accent call-to-action
            </button>
            <div
              className="rounded-md border border-slate-200 p-3 text-xs text-slate-700"
              style={{ fontFamily: draft.fontFamily }}
            >
              <div className="font-semibold">Inline message</div>
              <div className="mt-1 text-slate-500">
                Body text uses the chosen font family. Pairs cleanly with the
                primary header above.
              </div>
            </div>
          </div>
          {branding && (
            <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-[10px] text-slate-500">
              Saved theme:{" "}
              <span className="font-mono">{branding.primaryColor}</span> ·{" "}
              <span className="font-mono">{branding.secondaryColor}</span> ·{" "}
              <span className="font-mono">{branding.accentColor}</span> ·{" "}
              {branding.fontFamily}
            </div>
          )}
        </section>
      </div>
    </PartnerShell>
  );
}

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-700">
      {label}
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={COLOR_REGEX.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded border border-slate-200"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#6366f1"
          className="flex-1 rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
        />
      </div>
    </label>
  );
}
