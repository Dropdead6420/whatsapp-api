"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useI18n } from "../../src/i18n/I18nProvider";

type ComplianceMode = "MANUAL" | "ASSISTED" | "AUTOPILOT";
type ComplianceScope = "CAMPAIGN" | "DRIP_STEP" | "TEMPLATE" | "REPLY";
type ComplianceVerdict = "PASS" | "REVIEW" | "BLOCK";

interface ComplianceViolation {
  code: string;
  severity: "info" | "warn" | "violation";
  detail: string;
}

interface ComplianceCheck {
  id: string;
  scope: ComplianceScope;
  refId: string | null;
  content: string;
  verdict: ComplianceVerdict;
  score: number;
  violations: ComplianceViolation[] | unknown;
  rewrite: string | null;
  reasoning: string | null;
  mode: ComplianceMode;
  overridden: boolean;
  createdAt: string;
  decision?: {
    allowed: boolean;
    requiresOverride: boolean;
    blocked: boolean;
    reason: string | null;
  };
}

interface CheckResult {
  check: ComplianceCheck;
  cached: boolean;
  decision: NonNullable<ComplianceCheck["decision"]>;
}

interface ChecksResponse {
  items: ComplianceCheck[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

type ModeConfig = {
  default: ComplianceMode;
  CAMPAIGN?: ComplianceMode;
  DRIP_STEP?: ComplianceMode;
  TEMPLATE?: ComplianceMode;
  REPLY?: ComplianceMode;
};

const MODES: ComplianceMode[] = ["MANUAL", "ASSISTED", "AUTOPILOT"];
const SCOPES: ComplianceScope[] = ["CAMPAIGN", "DRIP_STEP", "TEMPLATE", "REPLY"];

export default function CompliancePage() {
  const { t } = useI18n();
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [mode, setMode] = useState<ModeConfig | null>(null);
  const [items, setItems] = useState<ComplianceCheck[]>([]);
  const [scope, setScope] = useState<ComplianceScope>("CAMPAIGN");
  const [content, setContent] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [checking, setChecking] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [latest, setLatest] = useState<CheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    try {
      const [nextMode, checks] = await Promise.all([
        api.get<ModeConfig>("/api/v1/compliance/mode"),
        api.get<ChecksResponse>("/api/v1/compliance/checks?limit=50"),
      ]);
      setMode(nextMode);
      setItems(checks.items);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("compliance.loadFailed"));
    }
  }

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user]);

  async function updateDefaultMode(next: ComplianceMode) {
    setSavingMode(true);
    setErr(null);
    try {
      const saved = await api.patch<ModeConfig>("/api/v1/compliance/mode", {
        default: next,
      });
      setMode(saved);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("compliance.modeFailed"));
    } finally {
      setSavingMode(false);
    }
  }

  async function submitCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) return;
    setChecking(true);
    setLatest(null);
    setErr(null);
    try {
      const result = await api.post<CheckResult>("/api/v1/compliance/check", {
        scope,
        content,
        useAi,
      });
      setLatest(result);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("compliance.checkFailed"));
    } finally {
      setChecking(false);
    }
  }

  async function overrideCheck(check: ComplianceCheck) {
    const reason = window.prompt(t("compliance.overridePrompt"));
    if (!reason?.trim()) return;
    setErr(null);
    try {
      await api.post(`/api/v1/compliance/checks/${check.id}/override`, {
        reason,
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("compliance.overrideFailed"));
    }
  }

  const currentModeCopy = useMemo(() => {
    switch (mode?.default) {
      case "MANUAL":
        return t("compliance.modeCopyManual");
      case "AUTOPILOT":
        return t("compliance.modeCopyAutopilot");
      default:
        return t("compliance.modeCopyAssisted");
    }
  }, [mode?.default, t]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t("compliance.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("compliance.subtitle")}</p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{t("compliance.defaultMode")}</h2>
            <p className="mt-1 text-sm text-slate-500">{currentModeCopy}</p>
          </div>
          <div className="flex rounded-md border border-slate-200 bg-slate-50 p-1">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={savingMode}
                onClick={() => void updateDefaultMode(m)}
                className={`rounded px-3 py-1.5 text-xs font-medium ${
                  mode?.default === m
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-white"
                }`}
              >
                {t("compliance.mode." + m)}
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">{t("compliance.manualCheck")}</h2>
          <form className="mt-4 space-y-4" onSubmit={submitCheck}>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">{t("compliance.scopeLabel")}</span>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as ComplianceScope)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              >
                {SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {t("compliance.scope." + s)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">{t("compliance.content")}</span>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                placeholder={t("compliance.contentPlaceholder")}
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
              />
              {t("compliance.includeAi")}
            </label>
            <button
              type="submit"
              disabled={checking || !content.trim()}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {checking ? t("compliance.checking") : t("compliance.runCheck")}
            </button>
          </form>

          {latest && (
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className={verdictClass(latest.check.verdict)}>
                  {latest.check.verdict}
                </span>
                <span className="text-slate-500">
                  {t("compliance.scoreValue", { n: latest.check.score })}
                </span>
              </div>
              <p className="mt-2 text-slate-600">{latest.check.reasoning}</p>
              {latest.check.rewrite && (
                <p className="mt-2 rounded bg-white p-2 text-slate-700">
                  {latest.check.rewrite}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{t("compliance.recentChecks")}</h2>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              {t("compliance.refresh")}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("compliance.colVerdict")}</th>
                  <th className="px-4 py-3">{t("compliance.scopeLabel")}</th>
                  <th className="px-4 py-3">{t("compliance.colScore")}</th>
                  <th className="px-4 py-3">{t("compliance.colContent")}</th>
                  <th className="px-4 py-3">{t("compliance.colReason")}</th>
                  <th className="px-4 py-3">{t("compliance.colAction")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((check) => (
                  <tr key={check.id} className="align-top">
                    <td className="px-4 py-3">
                      <span className={verdictClass(check.verdict)}>
                        {check.verdict}
                      </span>
                      {check.overridden && (
                        <div className="mt-1 text-xs text-amber-700">{t("compliance.overridden")}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {t("compliance.scope." + check.scope)}
                      {check.refId && <div className="text-xs text-slate-400">{check.refId}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{check.score}</td>
                    <td className="max-w-xs px-4 py-3 text-slate-700">
                      <div className="line-clamp-3">{check.content}</div>
                      {formatViolations(check.violations).length > 0 && (
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          {formatViolations(check.violations).slice(0, 2).map((v, idx) => (
                            <div key={`${check.id}-${idx}`}>{v.detail}</div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="max-w-sm px-4 py-3 text-slate-600">
                      <div className="line-clamp-4">{check.reasoning ?? "—"}</div>
                      {check.rewrite && (
                        <div className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-800">
                          {check.rewrite}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {check.verdict === "REVIEW" &&
                      check.mode === "ASSISTED" &&
                      !check.overridden ? (
                        <button
                          type="button"
                          onClick={() => void overrideCheck(check)}
                          className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
                        >
                          {t("compliance.override")}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      {t("compliance.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function verdictClass(verdict: ComplianceVerdict): string {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold";
  if (verdict === "PASS") return `${base} bg-emerald-50 text-emerald-700`;
  if (verdict === "REVIEW") return `${base} bg-amber-50 text-amber-700`;
  return `${base} bg-red-50 text-red-700`;
}

function formatViolations(raw: unknown): ComplianceViolation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ComplianceViolation => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.detail === "string";
    })
    .map((item) => ({
      code: String(item.code ?? "risk"),
      severity:
        item.severity === "info" ||
        item.severity === "warn" ||
        item.severity === "violation"
          ? item.severity
          : "warn",
      detail: item.detail,
    }));
}
