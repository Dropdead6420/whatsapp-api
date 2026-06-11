"use client";

import Link from "next/link";
import {
  Bot,
  CreditCard,
  ExternalLink,
  Globe,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { DashboardShell } from "../../../src/components/DashboardShell";
import {
  CUSTOMER_SETTINGS_NAV,
  SettingsConsoleFrame,
  SettingsStatusPill,
} from "../../../src/components/SettingsConsoleFrame";
import { useAuth } from "../../../src/hooks/useAuth";

export default function DashboardSettingsPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
  });

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell
      user={user}
      features={features}
      products={products}
      signOut={signOut}
    >
      <SettingsConsoleFrame
        activeKey="general"
        navItems={CUSTOMER_SETTINGS_NAV}
        eyebrow="Workspace settings"
        title="Settings"
        description="Manage business defaults, billing links, AI access, WhatsApp configuration, integrations, and security from one workspace."
        pagesCount={CUSTOMER_SETTINGS_NAV.length}
        workspaceLabel={user.role === "SUPER_ADMIN" ? "Platform workspace" : "Customer workspace"}
      >
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Workspace profile
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Your account, active role, and tenant access in this workspace.
              </p>
            </div>
            <SettingsStatusPill enabled label={user.role} />
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-3">
            <InfoCard label="User" value={user.name} hint={user.email} />
            <InfoCard label="Role" value={user.role.replace(/_/g, " ")} hint="Access is controlled by RBAC." />
            <InfoCard label="Tenant" value={user.tenantId ?? "Platform"} hint="All business data stays tenant-scoped." />
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <SettingsLinkCard
            icon={CreditCard}
            title="Plan & billing"
            description="Review the active plan, request plan changes, and compare account limits."
            href="/dashboard/billing"
            status="Open"
          />
          <SettingsLinkCard
            icon={WalletCards}
            title="Wallet & payments"
            description="Recharge wallet credits, configure auto-recharge, and inspect ledger activity."
            href="/dashboard/wallet"
            status="Open"
          />
          <SettingsLinkCard
            icon={Globe}
            title="WhatsApp & integrations"
            description="Connect WhatsApp, webhooks, API keys, and other customer-side integrations."
            href="/dashboard/integrations"
            status="Open"
          />
          <SettingsLinkCard
            icon={Bot}
            title="AI workspace"
            description="Manage AI agents, knowledge base, AI Studio access, and automation behavior."
            href="/ai-agents"
            status={features?.aiAgents === false ? "Disabled" : "Enabled"}
          />
          <SettingsLinkCard
            icon={ShieldCheck}
            title="Security"
            description="Manage two-factor authentication and account protection controls."
            href="/security"
            status="Open"
          />
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">
            Module access
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Feature flags and product access are enforced server-side. This view
            mirrors what the current tenant can see.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries({
              "AI Studio": features?.aiStudio,
              Campaigns: features?.campaigns,
              Flows: features?.flows,
              Webhooks: features?.webhooks,
              Appointments: features?.appointments,
              Inbox: products?.inbox,
            }).map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between rounded-lg border border-slate-200 p-3"
              >
                <span className="text-sm font-semibold text-slate-700">{label}</span>
                <SettingsStatusPill enabled={value !== false} />
              </div>
            ))}
          </div>
        </section>
      </SettingsConsoleFrame>
    </DashboardShell>
  );
}

function InfoCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-slate-400">
        {label}
      </p>
      <p className="mt-3 truncate text-sm font-semibold text-slate-950">
        {value}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

function SettingsLinkCard({
  icon: Icon,
  title,
  description,
  href,
  status,
}: {
  icon: typeof CreditCard;
  title: string;
  description: string;
  href: string;
  status: string;
}) {
  const enabled = status !== "Disabled";
  return (
    <Link
      href={href}
      className="group rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
          <Icon className="h-5 w-5" />
        </span>
        <SettingsStatusPill enabled={enabled} label={status} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      <span className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
        Open settings
        <ExternalLink className="h-4 w-4" />
      </span>
    </Link>
  );
}
