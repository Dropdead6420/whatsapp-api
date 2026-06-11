"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ChevronRight,
  FileText,
  LayoutGrid,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export interface SettingsNavItem {
  key: string;
  label: string;
  href: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export const ADMIN_SETTINGS_NAV: SettingsNavItem[] = [
  { key: "general", label: "General settings", href: "/dashboard/settings" },
  { key: "mail", label: "Mail Server", href: "/partner/whitelabel" },
  { key: "credits", label: "Credits", href: "/credit-rules" },
  { key: "payments", label: "Payment Gateways", href: "/payments" },
  { key: "ai", label: "AI Settings", href: "/ai-routing" },
  { key: "auth", label: "Authentication Rules", href: "/security" },
  { key: "files", label: "File Manager", href: "/cms" },
  { key: "google", label: "Google Analytics", href: "/google-monitor" },
  { key: "marketplace", label: "Marketplace", href: "/products" },
  { key: "static", label: "Static pages", href: "/cms" },
  { key: "affiliate", label: "Affiliate", href: "/partner-overview" },
  { key: "captcha", label: "Captcha", href: "/dashboard/settings" },
  { key: "crons", label: "Crons", href: "/platform-monitor" },
  { key: "cache", label: "Cache", href: "/platform-health" },
  { key: "system", label: "System information", href: "/platform-health" },
];

export const CUSTOMER_SETTINGS_NAV: SettingsNavItem[] = [
  { key: "general", label: "General settings", href: "/dashboard/settings" },
  { key: "billing", label: "Plan & billing", href: "/dashboard/billing" },
  { key: "wallet", label: "Wallet & payments", href: "/dashboard/wallet" },
  { key: "whatsapp", label: "WhatsApp settings", href: "/whatsapp-settings" },
  { key: "ai", label: "AI workspace", href: "/ai-agents" },
  { key: "integrations", label: "Integrations", href: "/dashboard/integrations" },
  { key: "security", label: "Security", href: "/security" },
  { key: "support", label: "Support", href: "/dashboard/support" },
];

export function SettingsStatusPill({
  enabled,
  label,
}: {
  enabled: boolean;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-[11px] font-black uppercase tracking-[0.24em]",
        enabled
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500",
      )}
    >
      {label ?? (enabled ? "Enabled" : "Disabled")}
    </span>
  );
}

export function SettingsConsoleFrame({
  activeKey,
  navItems,
  children,
  title = "Settings",
  eyebrow = "Admin settings",
  description = "Configure shared admin modules, platform defaults, and account controls from one workspace.",
  pagesCount = 15,
  workspaceLabel = "Shared admin control surface",
}: {
  activeKey: string;
  navItems: SettingsNavItem[];
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  description?: string;
  pagesCount?: number;
  workspaceLabel?: string;
}) {
  const pathname = usePathname() ?? "";

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-slate-100 bg-gradient-to-r from-emerald-50 via-white to-sky-50 p-6 shadow-sm md:p-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_260px] lg:items-center">
          <div className="flex items-start gap-4">
            <span className="inline-flex h-12 w-12 flex-none items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <SlidersHorizontal className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.32em] text-slate-500">
                {eyebrow}
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                {title}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                {description}
              </p>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-lg border border-slate-100 bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.32em] text-slate-500">
                  Settings pages
                </p>
                <FileText className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-3 text-2xl font-semibold text-slate-950">
                {pagesCount}
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-black uppercase tracking-[0.32em] text-slate-500">
                  Workspace
                </p>
                <LayoutGrid className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-3 text-sm font-semibold text-slate-950">
                {workspaceLabel}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="h-fit rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
          <div className="px-2 pb-3 text-xs font-black uppercase tracking-[0.32em] text-slate-500">
            System
          </div>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const active =
                item.key === activeKey ||
                pathname === item.href ||
                pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.key}
                  href={item.disabled ? pathname : item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex h-11 items-center justify-between rounded-lg px-3 text-sm font-semibold transition",
                    active
                      ? "border border-emerald-200 bg-emerald-50 text-slate-950"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                    item.disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  <span className="truncate">{item.label}</span>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4",
                      active
                        ? "rounded-full bg-emerald-200 p-0.5 text-emerald-700"
                        : "text-slate-400",
                    )}
                  />
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">{children}</div>
      </div>
    </div>
  );
}
