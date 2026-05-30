"use client";

// Compliance Firewall dashboard (PRD-v2 Sprint 2 slice 1).
//
// Lists every pre-send check the firewall has made for the tenant, with
// verdict, score, mode at decision time, and whether an operator
// overrode a non-PASS verdict. Operators can run an ad-hoc check from
// the bottom panel to preview a draft before pasting it into a campaign.

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Scope = "CAMPAIGN" | "DRIP_STEP" | "TEMPLATE" | "REPLY";
type Verdict = "PASS" | "REVIEW" | "BLOCK";
type Mode = "MANUAL" | "ASSISTED" | "AUTOPILOT";

interface ComplianceRow {
  id: string;
  scope: Scope;
  refId: string | null;
  content: string;
  verdict: Verdict;
  score: number;
  mode: Mode;
  overridden: boolean;
  createdAt: string;
}

interface Violation {
  code: string;
  severity: "low" | "medium" | "high";
  detail: string;
}

interface CheckResult {
  id: string;
  verdict: Verdict;
  score: number;
  violations: Violation[];
  rewrite: string | null;
  reasoning: string | null;
  mode: Mode;
  enforced: boolean;
}

const VERDICT_COLOR: Record<Verdict, string> = {
  PASS: "bg-emerald-100 text-emerald-800",
  REVIEW: "bg-amber-100 text-amber-800",
  BLOCK: "bg-red-100 text-red-800",
};

const SEVERITY_COLOR: Record<Violation["severity"], string> = {
  low: "text-slate-600",
  medium: "text-amber-700",
  high: "text-red-700",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CompliancePage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "WHITE_LABEL_ADMIN", "SUPER_ADMIN"],
  });

  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);

  const [draftContent, setDraftContent] = useState(
    "URGENT! Get 50% off — limited time! Click here to claim before it's gone! 💸💸💸",
  );
  const [draftScope, setDraftScope] = useState<Scope>("CAMPAIGN");
  const [checking, setChecking] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setListErr(null);
    try {
      const data = await api.get<ComplianceRow[]>(
        "/api/v1/ai/compliance-checks?limit=100",
      );
      setRows(data);
    } catch (e) {
      setListErr(
        e instanceof ApiClientError
          ? `Failed to load checks: ${e.message}`
          : "Failed to load checks.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function handleCheck(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setCheckErr(null);
    setResult(null);
    try {
      const data = await api.post<CheckResult>(
        "/api/v1/ai/compliance-check",
        {
          content: draftContent,
          scope: draftScope,
        },
      );
      setResult(data);
      await load();
    } catch (e) {
      setCheckErr(
        e instanceof ApiClientError ? e.message : "Check failed.",
      );
    } finally {
      setChecking(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  const totals = {
    pass: rows.filter((r) => r.verdict === "PASS").length,
    review: rows.filter((r) => r.verdict === "REVIEW").length,
    block: rows.filter((r) => r.verdict === "BLOCK").length,
    overridden: rows.filter((r) => r.overridden).length,
  };

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Compliance Firewall
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Pre-send safety checks for every outbound campaign, drip step,
            template, and agent reply. Two-layer review: deterministic
            heuristics + Claude policy review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {listErr && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {listErr}
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Passed" value={totals.pass} accent="emerald" />
        <StatCard label="Review needed" value={totals.review} accent="amber" />
        <StatCard label="Blocked" value={totals.block} accent="red" />
        <StatCard
          label="Overridden"
          value={totals.overridden}
          accent="slate"
        />
      </div>

      {/* Inline checker */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            Check a draft
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Paste any outbound copy to see what the firewall would do.
            Heuristic checks run on the server; the LLM review only runs
            when heuristics pass.
          </p>
        </div>
        <form onSubmit={handleCheck} className="space-y-3 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <textarea
              value={draftContent}
              onChange={(e) => setDraftContent(e.target.value)}
              rows={4}
              maxLength={4000}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              placeholder="Outbound message body…"
              required
            />
            <select
              value={draftScope}
              onChange={(e) => setDraftScope(e.target.value as Scope)}
              className="self-start rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="CAMPAIGN">Campaign</option>
              <option value="DRIP_STEP">Drip step</option>
              <option value="TEMPLATE">Template</option>
              <option value="REPLY">Agent reply</option>
            </select>
          </div>

          {checkErr && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {checkErr}
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={checking || !draftContent.trim()}
              className="rounded-md bg-emerald-600 px-5 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {checking ? "Checking…" : "Run check"}
            </button>
          </div>
        </form>

        {result && (
          <div className="border-t border-slate-200 px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VERDICT_COLOR[result.verdict]}`}
                >
                  {result.verdict}
                </span>
                <span className="text-sm font-mono text-slate-700">
                  risk {result.score}/100
                </span>
                <span className="text-xs text-slate-500">
                  mode: {result.mode}
                </span>
                {result.enforced && (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-red-800">
                    enforced
                  </span>
                )}
              </div>
            </div>

            {result.reasoning && (
              <p className="mt-2 text-xs italic text-slate-600">
                {result.reasoning}
              </p>
            )}

            {result.violations.length > 0 && (
              <ul className="mt-3 space-y-1">
                {result.violations.map((v, idx) => (
                  <li key={idx} className="text-xs">
                    <span
                      className={`font-mono font-semibold ${SEVERITY_COLOR[v.severity]}`}
                    >
                      {v.code}
                    </span>
                    <span className="text-slate-700"> — {v.detail}</span>
                  </li>
                ))}
              </ul>
            )}

            {result.rewrite && (
              <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Suggested rewrite
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-emerald-900">
                  {result.rewrite}
                </p>
                <button
                  type="button"
                  onClick={() => setDraftContent(result.rewrite!)}
                  className="mt-2 text-xs font-semibold text-emerald-800 hover:text-emerald-900"
                >
                  Use rewrite
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Recent checks */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {rows.length === 0 && !refreshing && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            No compliance checks yet. Run a check above or wait for a
            campaign to be created.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Verdict</th>
                  <th className="px-3 py-2 font-semibold">Scope</th>
                  <th className="px-3 py-2 font-semibold">Content</th>
                  <th className="px-3 py-2 text-right font-semibold">Score</th>
                  <th className="px-3 py-2 font-semibold">Mode</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${VERDICT_COLOR[row.verdict]}`}
                      >
                        {row.verdict}
                      </span>
                      {row.overridden && (
                        <span className="ml-1 rounded bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
                          OVERRIDE
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-700">
                      {row.scope}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-md truncate text-xs text-slate-700">
                        {row.content}
                      </div>
                      {row.refId && (
                        <div className="font-mono text-[10px] text-slate-500">
                          ref:{row.refId}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-700">
                      {row.score}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {row.mode}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-slate-500">
                      {formatDateTime(row.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Slice 1:</strong> the firewall is callable as an endpoint
        and visible here. Slice 2 wires it inline into the campaign
        creation flow + drip step validation + agent reply path so blocks
        actually halt sends before they hit Meta.
      </div>
    </DashboardShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald" | "amber" | "red";
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    red: "border-red-200 bg-red-50",
  } as const;
  const numColor = {
    slate: "text-slate-900",
    emerald: "text-emerald-800",
    amber: "text-amber-800",
    red: "text-red-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${accents[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-2xl font-semibold ${numColor[accent]}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
