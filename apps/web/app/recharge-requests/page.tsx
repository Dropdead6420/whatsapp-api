"use client";

// SuperAdmin queue for manual bank-transfer recharge requests
// (Claude FINAL §4, slice 7). Pending requests are surfaced
// soonest-first with proof URL, reference, and approve/reject
// actions inline. Approval books a CREDIT_ALLOCATION on the
// customer wallet via the same ledger path as Razorpay.

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type Status = "PENDING" | "APPROVED" | "REJECTED";

interface RechargeRequest {
  id: string;
  tenantId: string;
  amount: number;
  currency: string;
  status: Status;
  proofUrl: string | null;
  reference: string | null;
  customerNote: string | null;
  adminNotes: string | null;
  createdAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
  ledgerTransactionId: string | null;
}

const STATUSES: Status[] = ["PENDING", "APPROVED", "REJECTED"];

const STATUS_META: Record<Status, { label: string; tone: string }> = {
  PENDING: { label: "Pending", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  APPROVED: { label: "Approved", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  REJECTED: { label: "Rejected", tone: "bg-rose-50 text-rose-700 border-rose-200" },
};

function formatRupees(paise: number, currency: string): string {
  // Display all integer amounts as their major-unit equivalent.
  const major = paise / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString("en-IN")}`;
  }
}

export default function RechargeRequestsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [statusFilter, setStatusFilter] = useState<Status>("PENDING");
  const [requests, setRequests] = useState<RechargeRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<Record<string, "approve" | "reject" | undefined>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<RechargeRequest[]>(
        `/api/v1/admin/recharge-requests?status=${statusFilter}`,
      );
      setRequests(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to load recharge requests.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (user) void load();
  }, [user, statusFilter]);

  const counts = useMemo(() => {
    const c = { PENDING: 0, APPROVED: 0, REJECTED: 0 } as Record<Status, number>;
    for (const r of requests) c[r.status] += 1;
    return c;
  }, [requests]);

  const decide = async (id: string, kind: "approve" | "reject") => {
    setActing((m) => ({ ...m, [id]: kind }));
    setErr(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {};
      const note = (notes[id] ?? "").trim();
      if (note) body.adminNotes = note;
      await api.post(`/api/v1/admin/recharge-requests/${id}/${kind}`, body);
      setNotice(
        kind === "approve"
          ? "Request approved. Wallet credited."
          : "Request rejected.",
      );
      setNotes((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : `Failed to ${kind} the request.`,
      );
    } finally {
      setActing((m) => ({ ...m, [id]: undefined }));
    }
  };

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Wallet · Manual bank transfer
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Recharge requests
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Customer-filed NEFT/IMPS/UPI recharges awaiting review. Approve to
            credit the wallet; the action is recorded in the same audit trail
            as Razorpay payments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                statusFilter === s
                  ? "bg-slate-900 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {STATUS_META[s].label}
              {statusFilter === s && requests.length > 0 ? ` (${counts[s]})` : ""}
            </button>
          ))}
          <button
            onClick={() => void load()}
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-5 py-3 text-xs font-medium uppercase tracking-wide text-slate-500">
          {requests.length} {STATUS_META[statusFilter].label.toLowerCase()} request
          {requests.length === 1 ? "" : "s"}
        </header>
        {requests.length === 0 ? (
          <div className="px-5 py-8 text-sm text-slate-500">
            {busy
              ? "Loading…"
              : statusFilter === "PENDING"
                ? "Nothing awaiting review."
                : `No ${STATUS_META[statusFilter].label.toLowerCase()} requests.`}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {requests.map((r) => {
              const isActing = acting[r.id];
              return (
                <li key={r.id} className="px-5 py-4">
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-slate-950">
                          {formatRupees(r.amount, r.currency)}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${STATUS_META[r.status].tone}`}
                        >
                          {STATUS_META[r.status].label}
                        </span>
                        <span className="text-xs text-slate-500">
                          tenant <code className="font-mono">{r.tenantId}</code>
                        </span>
                        <span className="text-xs text-slate-400">
                          · {new Date(r.createdAt).toLocaleString()}
                        </span>
                      </div>
                      {r.reference && (
                        <p className="text-xs text-slate-600">
                          <span className="font-medium uppercase tracking-wide text-slate-400">
                            Ref:{" "}
                          </span>
                          <code className="font-mono">{r.reference}</code>
                        </p>
                      )}
                      {r.proofUrl && (
                        <p className="text-xs">
                          <span className="font-medium uppercase tracking-wide text-slate-400">
                            Proof:{" "}
                          </span>
                          <a
                            href={r.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="break-all text-sky-700 underline hover:text-sky-900"
                          >
                            {r.proofUrl}
                          </a>
                        </p>
                      )}
                      {r.customerNote && (
                        <p className="text-xs italic text-slate-600">
                          {r.customerNote}
                        </p>
                      )}
                      {r.adminNotes && r.status !== "PENDING" && (
                        <p className="text-xs text-slate-600">
                          <span className="font-medium uppercase tracking-wide text-slate-400">
                            Admin notes:{" "}
                          </span>
                          {r.adminNotes}
                        </p>
                      )}
                      {r.ledgerTransactionId && (
                        <p className="text-[10px] text-slate-400">
                          Ledger txn{" "}
                          <code className="font-mono">{r.ledgerTransactionId}</code>
                        </p>
                      )}
                    </div>

                    {r.status === "PENDING" && (
                      <div className="w-full max-w-sm space-y-2 lg:w-auto">
                        <textarea
                          value={notes[r.id] ?? ""}
                          onChange={(e) =>
                            setNotes((m) => ({ ...m, [r.id]: e.target.value }))
                          }
                          placeholder="Admin note (optional — audited)"
                          rows={2}
                          maxLength={1024}
                          className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
                          disabled={Boolean(isActing)}
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void decide(r.id, "approve")}
                            disabled={Boolean(isActing)}
                            className="rounded-md bg-emerald-700 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {isActing === "approve" ? "Approving…" : "Approve & credit"}
                          </button>
                          <button
                            onClick={() => void decide(r.id, "reject")}
                            disabled={Boolean(isActing)}
                            className="rounded-md border border-rose-300 bg-white px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                          >
                            {isActing === "reject" ? "Rejecting…" : "Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Approval cannot be performed during impersonation — exit
        impersonation first so the audit log attributes the credit to you.
      </p>
    </DashboardShell>
  );
}
