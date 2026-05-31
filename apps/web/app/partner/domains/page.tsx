"use client";

// Partner Domain Health (PRD-v2 §5, Sprint 5 slice 2).
//
// Surfaces the scheduled DNS/SSL drift monitor (Sprint 5 slice 1) on the
// partner UI. Read-only: lists every white-label domain the partner owns
// with its current state, last sample's outcome, the current failing
// streak, and a small recent-history slice. "Refresh now" forces one scan
// tick for partners who just fixed a registrar record and don't want to
// wait the 6-hour cadence.

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

type DomainStatus =
  | "PENDING_DNS"
  | "DNS_FOUND"
  | "TXT_VERIFIED"
  | "SSL_PENDING"
  | "SSL_ACTIVE"
  | "LIVE"
  | "FAILED"
  | "SUSPENDED";

type DomainHealthOutcome = "OK" | "DNS_DRIFT" | "SSL_FAILED" | "UNREACHABLE";

interface RecentSample {
  outcome: DomainHealthOutcome;
  observedAt: string;
  error: string | null;
}

interface DomainHealthRow {
  domainId: string;
  domain: string;
  status: DomainStatus;
  partnerTenantId: string | null;
  tenantId: string;
  lastOutcome: DomainHealthOutcome | null;
  lastObservedAt: string | null;
  failingStreak: number;
  recent: RecentSample[];
}

interface ScanResult {
  scanned: number;
  escalated: number;
}

interface Explanation {
  domainId: string;
  outcome: DomainHealthOutcome | "UNKNOWN";
  summary: string;
  steps: string[];
  source: "ai" | "fallback";
}

const STATUS_TONE: Record<DomainStatus, string> = {
  LIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  SSL_ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-800",
  TXT_VERIFIED: "border-sky-200 bg-sky-50 text-sky-800",
  SSL_PENDING: "border-amber-200 bg-amber-50 text-amber-800",
  DNS_FOUND: "border-amber-200 bg-amber-50 text-amber-800",
  PENDING_DNS: "border-slate-200 bg-slate-50 text-slate-600",
  FAILED: "border-rose-200 bg-rose-50 text-rose-800",
  SUSPENDED: "border-slate-300 bg-slate-100 text-slate-600",
};

const OUTCOME_META: Record<
  DomainHealthOutcome,
  { label: string; tone: string; dot: string }
> = {
  OK: {
    label: "Healthy",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  DNS_DRIFT: {
    label: "DNS drift",
    tone: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  SSL_FAILED: {
    label: "SSL failed",
    tone: "border-rose-200 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
  UNREACHABLE: {
    label: "Unreachable",
    tone: "border-orange-200 bg-orange-50 text-orange-800",
    dot: "bg-orange-500",
  },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function PartnerDomainsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [rows, setRows] = useState<DomainHealthRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, Explanation | "loading">
  >({});

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<DomainHealthRow[]>(
        "/api/v1/partner/domains/health",
      );
      setRows(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to load domain health.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const explain = async (domainId: string) => {
    setExplanations((prev) => ({ ...prev, [domainId]: "loading" }));
    setErr(null);
    try {
      const result = await api.post<Explanation>(
        `/api/v1/partner/domains/${domainId}/explain`,
      );
      setExplanations((prev) => ({ ...prev, [domainId]: result }));
    } catch (e) {
      setExplanations((prev) => {
        const next = { ...prev };
        delete next[domainId];
        return next;
      });
      setErr(e instanceof ApiClientError ? e.message : "Failed to load explanation.");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setErr(null);
    setNotice(null);
    try {
      const result = await api.post<ScanResult>(
        "/api/v1/partner/domains/health/refresh",
      );
      setNotice(
        `Scanned ${result.scanned} domain${result.scanned === 1 ? "" : "s"}` +
          (result.escalated > 0
            ? ` · ${result.escalated} escalated to platform monitor`
            : ""),
      );
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to refresh health.",
      );
    } finally {
      setRefreshing(false);
    }
  };

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const totals = rows.reduce(
    (acc, r) => {
      const o = r.lastOutcome ?? "OK";
      acc[o] = (acc[o] ?? 0) + 1;
      return acc;
    },
    { OK: 0, DNS_DRIFT: 0, SSL_FAILED: 0, UNREACHABLE: 0 } as Record<
      DomainHealthOutcome,
      number
    >,
  );
  const atRiskCount = rows.filter(
    (r) => r.failingStreak >= 1 && r.lastOutcome !== "OK",
  ).length;

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            White-label automation
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Domain health
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            Scheduled DNS/SSL drift monitor for your white-label domains.
            Background scan runs every 6 hours; tap <em>Refresh now</em> to
            force a tick. Sustained drift (3 consecutive non-OK samples) or
            any SSL failure auto-escalates to the platform triage queue.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleRefresh()}
          disabled={refreshing || busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
        >
          {refreshing ? "Scanning…" : "Refresh now"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Healthy" value={totals.OK} tone="emerald" />
        <StatCard label="DNS drift" value={totals.DNS_DRIFT} tone="amber" />
        <StatCard label="SSL failed" value={totals.SSL_FAILED} tone="rose" />
        <StatCard label="Unreachable" value={totals.UNREACHABLE} tone="orange" />
      </div>

      {atRiskCount > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {atRiskCount} domain{atRiskCount === 1 ? "" : "s"} currently failing.
          Fix the registrar record or cert; the next scan will clear the
          escalation automatically once probes go green.
        </div>
      )}

      {!busy && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          You haven't added any white-label domains yet. Add one in{" "}
          <strong>White-label Setup</strong> and verify DNS to start monitoring.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Domain</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last probe</th>
                <th className="px-4 py-3">Streak</th>
                <th className="px-4 py-3">Recent history</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr key={row.domainId} className="align-top hover:bg-slate-50/70">
                  <td className="px-4 py-4">
                    <div className="font-mono text-sm font-medium text-slate-950">
                      {row.domain}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Tenant <span className="font-mono">{row.tenantId.slice(0, 12)}…</span>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[row.status]}`}
                    >
                      {row.status.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {row.lastOutcome ? (
                      <OutcomeBadge outcome={row.lastOutcome} />
                    ) : (
                      <span className="text-xs text-slate-400">no samples yet</span>
                    )}
                    <div className="mt-1 text-xs text-slate-500">
                      {timeAgo(row.lastObservedAt)}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    {row.failingStreak === 0 ? (
                      <span className="text-xs text-emerald-700">healthy</span>
                    ) : (
                      <span
                        className={`text-sm font-semibold ${row.failingStreak >= 3 ? "text-rose-700" : "text-amber-700"}`}
                      >
                        {row.failingStreak}× failing
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    {row.recent.length === 0 ? (
                      <span className="text-xs text-slate-400">—</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {row.recent.map((s, i) => (
                          <span
                            key={i}
                            title={`${s.outcome} · ${new Date(s.observedAt).toLocaleString()}${s.error ? ` · ${s.error}` : ""}`}
                            className={`inline-block h-2.5 w-2.5 rounded-full ${OUTCOME_META[s.outcome].dot}`}
                          />
                        ))}
                      </div>
                    )}
                    {row.recent[0]?.error && (
                      <div className="mt-2 max-w-xs truncate text-xs text-rose-700">
                        {row.recent[0].error}
                      </div>
                    )}
                    {row.failingStreak > 0 && row.lastOutcome && row.lastOutcome !== "OK" && (
                      <div className="mt-2">
                        {explanations[row.domainId] === "loading" ? (
                          <span className="text-xs text-slate-500">
                            Diagnosing…
                          </span>
                        ) : explanations[row.domainId] ? (
                          <ExplanationPanel
                            explanation={explanations[row.domainId] as Explanation}
                            onClose={() =>
                              setExplanations((prev) => {
                                const next = { ...prev };
                                delete next[row.domainId];
                                return next;
                              })
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => void explain(row.domainId)}
                            className="rounded-md border border-indigo-200 bg-white px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                          >
                            ✦ Explain this error
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {busy && rows.length === 0 && (
        <div className="mt-4 text-center text-sm text-slate-500">
          Loading domain health…
        </div>
      )}
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "amber" | "rose" | "orange";
}) {
  const tones = {
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
    orange: "border-orange-200 bg-orange-50",
  } as const;
  const nums = {
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    rose: "text-rose-800",
    orange: "text-orange-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${nums[tone]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ExplanationPanel({
  explanation,
  onClose,
}: {
  explanation: Explanation;
  onClose: () => void;
}) {
  return (
    <div className="mt-1 max-w-md rounded-md border border-indigo-200 bg-indigo-50/60 p-3 text-xs">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase tracking-wide text-indigo-700">
          {explanation.source === "ai" ? "AI diagnosis" : "Suggested fix"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-slate-500 hover:text-slate-700"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      <p className="text-slate-800">{explanation.summary}</p>
      {explanation.steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-slate-700">
          {explanation.steps.map((step, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {step}
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[10px] text-slate-500">
        Suggestion only — nothing has been changed on the domain.
      </p>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: DomainHealthOutcome }) {
  const meta = OUTCOME_META[outcome];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.tone}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}
