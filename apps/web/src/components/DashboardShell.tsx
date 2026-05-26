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
      { href: "/missing-features", label: "🔮 Labs & Backlog", roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"] },
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
    <div className="flex min-h-screen bg-slate-950 text-white font-sans overflow-x-hidden antialiased">
      <aside className="hidden w-64 shrink-0 border-r border-white/5 bg-slate-950/80 backdrop-blur-xl md:flex md:flex-col relative z-20">
        <div className="flex h-16 items-center gap-3 border-b border-white/5 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white font-black shadow-md shadow-emerald-500/20 animate-pulse-glow">
            N
          </div>
          <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent font-extrabold text-base tracking-wide">
            NexaFlow AI
          </span>
        </div>
        
        <nav className="flex-1 space-y-4 p-4 text-xs overflow-y-auto max-h-[calc(100vh-160px)]">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-1.5">
              {section.label && (
                <div className="px-3 pb-1.5 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
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
                      className={`block rounded-xl px-3.5 py-2 font-semibold tracking-wide transition-all duration-200 ${
                        active
                          ? "bg-gradient-to-r from-emerald-500/10 to-teal-500/5 text-emerald-400 border border-emerald-500/20 shadow-sm shadow-emerald-500/5"
                          : "text-slate-400 hover:bg-white/5 hover:text-slate-100 border border-transparent"
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
        
        <div className="border-t border-white/5 p-4 text-xs">
          <div className="truncate font-semibold text-slate-200">{user.name}</div>
          <div className="truncate text-[10px] text-slate-500 mt-0.5">{user.email}</div>
          <div className="mt-2.5">
            <span className="inline-block rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-[8px] font-bold text-emerald-400 uppercase tracking-widest">
              {user.role}
            </span>
          </div>
          <button
            onClick={signOut}
            className="mt-4.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-bold hover:bg-white/10 hover:text-white transition-all text-slate-300 hover:border-white/20 active:scale-95"
          >
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-cosmic-glow relative">
        <div className="absolute inset-0 bg-radial-glow opacity-30 pointer-events-none" />
        <div className="mx-auto max-w-7xl px-8 py-10 relative min-h-screen z-10">
          {children}
        </div>
      </main>

      {/* Global AI Assistant Floating widget */}
      <AiAssistantOverlay />
    </div>
  );
}
