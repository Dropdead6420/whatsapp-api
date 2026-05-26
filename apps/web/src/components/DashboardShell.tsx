"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import { AiAssistantOverlay } from "./AiAssistantOverlay";

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
      { href: "/inbox", label: "Inbox", roles: ["AGENT", "TEAM_LEAD", "BUSINESS_ADMIN"] },
    ],
  },
  {
    label: "Partner & White Label",
    items: [
      { href: "/white-label", label: "Agency Panel", roles: ["WHITE_LABEL_ADMIN", "SUPER_ADMIN"] },
      { href: "/wallet", label: "Wallet & Top-up", roles: ["WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"] },
    ],
  },
  {
    label: "AI",
    items: [
      { href: "/autopilot", label: "✦ Campaign Autopilot", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "autopilot" },
      { href: "/ai-agent", label: "AI Agent Builder", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/ai-segment", label: "Smart Segments", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "smartSegment" },
      { href: "/ai-studio", label: "Copy Studio", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "aiStudio" },
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
    label: "Growth & Channels",
    items: [
      { href: "/contacts", label: "Contacts", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/leads", label: "Leads", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/campaigns", label: "Campaigns", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "campaigns" },
      { href: "/products", label: "WhatsApp Catalog", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/channels", label: "Channel Manager", roles: ["BUSINESS_ADMIN"] },
      { href: "/whatsapp-settings", label: "WhatsApp Meta", roles: ["BUSINESS_ADMIN"] },
      { href: "/canned-replies", label: "Canned Replies", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/webhooks", label: "Webhooks", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"], feature: "webhooks" },
    ],
  },
  {
    label: "Account & System",
    items: [
      { href: "/plans", label: "Plans & Add-ons", roles: ["BUSINESS_ADMIN", "TEAM_LEAD"] },
      { href: "/support", label: "Support Tickets", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"] },
      { href: "/design-system", label: "🎨 UI Design System", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"] },
    ],
  },
  {
    label: "Platform Admin",
    items: [
      { href: "/tenants", label: "Tenants", roles: ["SUPER_ADMIN"] },
      { href: "/billing", label: "Billing Controls", roles: ["SUPER_ADMIN"] },
      { href: "/platform-health", label: "Health Services", roles: ["SUPER_ADMIN"] },
      { href: "/audit-logs", label: "Audit Logs", roles: ["SUPER_ADMIN"] },
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
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500 text-white font-bold">
            N
          </span>
          <span className="bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent font-extrabold text-base">
            NexaFlow AI
          </span>
        </div>
        <nav className="flex-1 space-y-4 p-3 text-xs overflow-y-auto max-h-[calc(100vh-140px)]">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-1">
              {section.label && (
                <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block rounded-md px-2.5 py-1.5 font-medium transition-all ${
                        active
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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
          <div className="truncate text-[10px] text-slate-400">{user.email}</div>
          <div className="mt-1">
            <span className="inline-block rounded bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-700 uppercase tracking-wide">
              {user.role}
            </span>
          </div>
          <button
            onClick={signOut}
            className="mt-3 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs font-semibold hover:bg-slate-50 transition-all text-slate-700"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-slate-50/50">
        <div className="mx-auto max-w-7xl px-6 py-8 relative min-h-screen">
          {children}
        </div>
      </main>

      {/* Global AI Assistant Floating widget */}
      <AiAssistantOverlay />
    </div>
  );
}
