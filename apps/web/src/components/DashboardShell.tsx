"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";

type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "TEAM_LEAD"
  | "AGENT";

interface NavItem {
  href: string;
  label: string;
  roles: RoleName[];
  /** Optional tenant feature key — item is hidden when the feature is disabled. */
  feature?: string;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/onboarding", label: "Get started", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/inbox", label: "Inbox", roles: ["AGENT", "TEAM_LEAD", "BUSINESS_ADMIN"] },
    ],
  },
  {
    label: "AI",
    items: [
      { href: "/autopilot", label: "✦ Campaign Autopilot", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "autopilot" },
      { href: "/ai-segment", label: "Smart Segments", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "smartSegment" },
      { href: "/ai-studio", label: "Copy Studio", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "aiStudio" },
      { href: "/knowledge-base", label: "Knowledge Base", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "knowledgeBase" },
      { href: "/ai-agents", label: "AI Agents", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "aiAgents" },
      { href: "/flows", label: "Flows", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "flows" },
    ],
  },
  {
    label: "Bookings",
    items: [
      { href: "/services", label: "Services", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "appointments" },
      { href: "/appointments", label: "Appointments", roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"], feature: "appointments" },
    ],
  },
  {
    label: "Growth",
    items: [
      { href: "/contacts", label: "Contacts", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/leads", label: "Leads", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/pipelines", label: "Pipeline", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/campaigns", label: "Campaigns", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "campaigns" },
      { href: "/drip-sequences", label: "Drip Sequences", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/meta-ads", label: "Meta Ads", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/google-ads", label: "Google Ads", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/compliance", label: "Compliance", roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "SUPER_ADMIN"], feature: "complianceFirewall" },
      { href: "/templates", label: "Templates", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/whatsapp-settings", label: "WhatsApp", roles: ["BUSINESS_ADMIN"] },
      { href: "/canned-replies", label: "Canned Replies", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/webhooks", label: "Webhooks", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "webhooks" },
    ],
  },
  {
    label: "Developer",
    items: [
      { href: "/developer", label: "API Keys", roles: ["BUSINESS_ADMIN"], feature: "developerPortal" },
    ],
  },
  {
    label: "Partner",
    items: [
      { href: "/partner/dashboard", label: "Partner dashboard", roles: ["WHITE_LABEL_ADMIN"] },
      { href: "/partner/customers", label: "Customers", roles: ["WHITE_LABEL_ADMIN"] },
      { href: "/partner/team", label: "Team", roles: ["WHITE_LABEL_ADMIN"] },
    ],
  },
  {
    label: "White Label",
    items: [
      { href: "/domains", label: "Domains", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN"] },
      { href: "/wallets", label: "Wallets", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN"] },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/tenants", label: "Tenants", roles: ["SUPER_ADMIN"] },
      { href: "/billing", label: "Billing", roles: ["SUPER_ADMIN"] },
      { href: "/platform-health", label: "Health", roles: ["SUPER_ADMIN"] },
      { href: "/audit-logs", label: "Audit Logs", roles: ["SUPER_ADMIN"] },
      {
        href: "/provider-routes",
        label: "Provider Routes",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
];

export function DashboardShell({
  user,
  features,
  signOut,
  children,
}: {
  user: AuthUserPublic;
  /** Per-tenant feature flags. Missing key or undefined → feature is ON. */
  features?: Record<string, boolean> | null;
  signOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const isFeatureOn = (key?: string) =>
    !key || !features || features[key] !== false;
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.roles.includes(user.role as RoleName) && isFeatureOn(item.feature),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 text-sm font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-white">
            N
          </span>
          NexaFlow AI
        </div>
        <nav className="flex-1 space-y-4 p-3 text-sm">
          {sections.map((section, idx) => (
            <div key={idx}>
              {section.label && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {section.label}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block rounded-md px-3 py-2 ${
                        active
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          <div className="truncate font-medium text-slate-700">{user.name}</div>
          <div className="truncate">{user.email}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">{user.role}</div>
          <button
            onClick={signOut}
            className="mt-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium hover:bg-slate-50"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
