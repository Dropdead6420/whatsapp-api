"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api } from "../../../src/lib/api";

interface PartnerDashboard {
  partnerName: string;
  customers: number;
  activeCustomers: number;
  contacts: number;
  messagesMonth: number;
  aiCostInCentsThisMonth: number;
  walletBalanceCredits: number;
  creditLimitCredits: number;
  demosExpiringSoon: number;
}

export default function PartnerDashboardPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [data, setData] = useState<PartnerDashboard | null>(null);

  useEffect(() => {
    if (!user) return;
    api.get<PartnerDashboard>("/api/v1/partner/dashboard").then(setData).catch(() => setData(null));
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">{data?.partnerName ?? "Partner"} dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Customers, usage, and wallet at a glance.
        </p>
      </header>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={String(data?.customers ?? "—")} />
        <Stat label="Active" value={String(data?.activeCustomers ?? "—")} />
        <Stat label="Contacts (all clients)" value={String(data?.contacts ?? "—")} />
        <Stat label="Messages this month" value={String(data?.messagesMonth ?? "—")} />
        <Stat
          label="Wallet balance"
          value={data ? `${data.walletBalanceCredits} credits` : "—"}
        />
        <Stat
          label="Credit limit"
          value={data ? `${data.creditLimitCredits} credits` : "—"}
        />
        <Stat
          label="AI spend (month)"
          value={
            data
              ? `₹${(data.aiCostInCentsThisMonth / 100).toFixed(0)}`
              : "—"
          }
        />
        <Stat label="Demos expiring (7d)" value={String(data?.demosExpiringSoon ?? 0)} />
      </div>
    </PartnerShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}
