"use client";

// Partner channels — REAL backend integration.
//
// Lists every child tenant's WhatsApp connection state. Read-only:
// partners can't directly manage a customer's WABA (Meta requires
// the customer to authorize their own number); we surface the status
// so a partner can spot broken connections + nudge customers.
//
// The previous version hard-coded "waba-01"/"waba-02" entries in
// localStorage. This rewrite pulls real data from
// GET /api/v1/partner/channels.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface Channel {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "INACTIVE" | "TRIAL";
  wabaPhoneNumber: string | null;
  wabaId: string | null;
  wabaBusinessName: string | null;
  wabaBusinessVertical: string | null;
  wabaTokenExpiresAt: string | null;
  wabaBusinessProfileSyncedAt: string | null;
  isConnected: boolean;
  tokenExpiringSoon: boolean;
  tokenExpired: boolean;
  createdAt: string;
  _count: { conversations: number; contacts: number };
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function statusBadge(c: Channel): { color: string; label: string } {
  if (!c.isConnected) return { color: "bg-slate-200 text-slate-700", label: "Not connected" };
  if (c.tokenExpired) return { color: "bg-red-100 text-red-800", label: "Token expired" };
  if (c.tokenExpiringSoon) return { color: "bg-amber-100 text-amber-800", label: "Token expiring soon" };
  if (c.status !== "ACTIVE") return { color: "bg-amber-100 text-amber-800", label: c.status };
  return { color: "bg-emerald-100 text-emerald-800", label: "Connected" };
}

export default function ChannelManagerPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [channels, setChannels] = useState<Channel[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "connected" | "issues">("all");

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const data = await api.get<Channel[]>("/api/v1/partner/channels");
      setChannels(data);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load channels: ${e.message}`
          : "Failed to load channels.",
      );
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  const filteredChannels =
    filter === "all"
      ? channels
      : filter === "connected"
        ? channels.filter(
            (c) =>
              c.isConnected && !c.tokenExpired && !c.tokenExpiringSoon && c.status === "ACTIVE",
          )
        : channels.filter(
            (c) =>
              !c.isConnected ||
              c.tokenExpired ||
              c.tokenExpiringSoon ||
              c.status !== "ACTIVE",
          );

  const stats = {
    total: channels.length,
    connected: channels.filter(
      (c) =>
        c.isConnected && !c.tokenExpired && !c.tokenExpiringSoon && c.status === "ACTIVE",
    ).length,
    issues: channels.filter(
      (c) =>
        !c.isConnected ||
        c.tokenExpired ||
        c.tokenExpiringSoon ||
        c.status !== "ACTIVE",
    ).length,
  };

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            WhatsApp channels
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            One row per customer tenant. Connections are managed by each
            customer via Meta Embedded Signup — this is the partner&apos;s
            read-only health board.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={busy}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* Stat cards */}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total tenants" value={stats.total} accent="slate" />
        <StatCard
          label="Healthy connections"
          value={stats.connected}
          accent="emerald"
        />
        <StatCard
          label="Need attention"
          value={stats.issues}
          accent={stats.issues > 0 ? "red" : "slate"}
        />
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-2 text-xs">
        {(["all", "connected", "issues"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 font-medium ${
              filter === f
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {f === "all" ? "All" : f === "connected" ? "Healthy" : "Need attention"}
          </button>
        ))}
      </div>

      {/* Channel table */}
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        {filteredChannels.length === 0 && !busy && (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {channels.length === 0
              ? "No customer tenants yet. Onboard your first customer via the Customers page."
              : "No channels match this filter."}
          </div>
        )}
        {filteredChannels.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-semibold">Tenant</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Phone number</th>
                  <th className="px-3 py-2 font-semibold">Business</th>
                  <th className="px-3 py-2 font-semibold">Token</th>
                  <th className="px-3 py-2 text-right font-semibold">Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredChannels.map((c) => {
                  const badge = statusBadge(c);
                  const tokenDays = daysUntil(c.wabaTokenExpiresAt);
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <Link
                          href={`/partner/customers`}
                          className="font-medium text-slate-900 hover:text-emerald-700"
                        >
                          {c.name}
                        </Link>
                        <div className="font-mono text-[10px] text-slate-500">
                          {c.id.slice(0, 12)}…
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.color}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-700">
                        {c.wabaPhoneNumber ?? (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-700">
                        {c.wabaBusinessName ? (
                          <>
                            <div className="font-medium">{c.wabaBusinessName}</div>
                            {c.wabaBusinessVertical && (
                              <div className="text-[10px] text-slate-500">
                                {c.wabaBusinessVertical}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {tokenDays === null ? (
                          <span className="text-slate-400">No expiry tracked</span>
                        ) : tokenDays < 0 ? (
                          <span className="font-medium text-red-700">
                            Expired {Math.abs(tokenDays)}d ago
                          </span>
                        ) : tokenDays < 14 ? (
                          <span className="font-medium text-amber-700">
                            Expires in {tokenDays}d
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Expires in {tokenDays}d
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-slate-600">
                        <div>
                          {c._count.conversations.toLocaleString()} convos
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {c._count.contacts.toLocaleString()} contacts
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <strong>Note:</strong> WhatsApp connections must be authorized by
        each customer directly (via Meta Embedded Signup on{" "}
        <span className="font-mono">/whatsapp-settings</span> inside their own
        dashboard). Partners can&apos;t connect on behalf of customers; this
        page shows the current state across your portfolio so you can spot
        and remediate broken connections.
      </div>
    </PartnerShell>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "slate" | "emerald" | "red";
}) {
  const accents = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    red: "border-red-200 bg-red-50",
  } as const;
  const numColor = {
    slate: "text-slate-900",
    emerald: "text-emerald-800",
    red: "text-red-800",
  } as const;
  return (
    <div className={`rounded-lg border p-4 ${accents[accent]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 font-mono text-2xl font-semibold ${numColor[accent]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
