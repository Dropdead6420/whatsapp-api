"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import {
  BarChart3,
  Bell,
  Bot,
  ArrowRightLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Headphones,
  Inbox,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Plug,
  Plus,
  Search,
  Settings,
  Sparkles,
  UserCircle,
  Users,
  WalletCards,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { activeHrefFromPath, isActiveRoute } from "../lib/navActive";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { useI18n } from "../i18n/I18nProvider";

type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "TEAM_LEAD"
  | "AGENT";

export interface AppNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: RoleName[];
  feature?: string;
  activeRoutes?: string[];
}

interface AppNavSection {
  label?: string;
  items: AppNavItem[];
}

const BUSINESS_ROLES: RoleName[] = ["BUSINESS_ADMIN", "TEAM_LEAD"];
const INBOX_ROLES: RoleName[] = ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"];
const ALL_DASHBOARD_ROLES: RoleName[] = [
  "SUPER_ADMIN",
  "WHITE_LABEL_ADMIN",
  "BUSINESS_ADMIN",
  "TEAM_LEAD",
  "AGENT",
];

export const APP_NAV_SECTIONS: AppNavSection[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        roles: ALL_DASHBOARD_ROLES,
      },
      {
        href: "/onboarding",
        label: "Setup Wizard",
        icon: ClipboardList,
        roles: BUSINESS_ROLES,
      },
      {
        href: "/dashboard/inbox",
        label: "Inbox",
        icon: Inbox,
        roles: INBOX_ROLES,
        activeRoutes: ["/inbox", "/agent/inbox"],
      },
      {
        href: "/follow-ups",
        label: "Follow-ups",
        icon: ClipboardList,
        roles: INBOX_ROLES,
      },
      {
        href: "/dashboard/contacts",
        label: "Contacts",
        icon: Users,
        roles: BUSINESS_ROLES,
        activeRoutes: ["/contacts"],
      },
      {
        href: "/dashboard/campaigns",
        label: "Campaigns",
        icon: Megaphone,
        roles: BUSINESS_ROLES,
        feature: "campaigns",
        activeRoutes: ["/campaigns"],
      },
      {
        href: "/dashboard/templates",
        label: "Templates",
        icon: FileText,
        roles: BUSINESS_ROLES,
        activeRoutes: ["/templates"],
      },
    ],
  },
  {
    label: "Automation",
    items: [
      {
        href: "/dashboard/chatbot-builder",
        label: "Chatbot Builder",
        icon: MessageSquare,
        roles: BUSINESS_ROLES,
        feature: "flows",
        activeRoutes: ["/flows"],
      },
      {
        href: "/dashboard/workflow-builder",
        label: "Workflow Builder",
        icon: Workflow,
        roles: BUSINESS_ROLES,
        activeRoutes: ["/drip-sequences"],
      },
      {
        href: "/dashboard/ai-agents",
        label: "AI Agents",
        icon: Bot,
        roles: BUSINESS_ROLES,
        feature: "aiAgents",
        activeRoutes: ["/ai-agents"],
      },
      {
        href: "/ai-studio",
        label: "AI Studio",
        icon: Sparkles,
        roles: BUSINESS_ROLES,
        feature: "aiStudio",
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/dashboard/wallet",
        label: "Wallet / Recharge",
        icon: WalletCards,
        roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", "BUSINESS_ADMIN"],
        activeRoutes: ["/wallets"],
      },
      {
        href: "/dashboard/billing",
        label: "Plan / Billing",
        icon: CreditCard,
        roles: ["WHITE_LABEL_ADMIN", "BUSINESS_ADMIN"],
      },
      {
        href: "/dashboard/analytics",
        label: "Analytics",
        icon: BarChart3,
        roles: ["SUPER_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"],
      },
      {
        href: "/team-performance",
        label: "Team Performance",
        icon: UserCircle,
        roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
      },
      {
        href: "/dashboard/integrations",
        label: "Integrations",
        icon: Plug,
        roles: BUSINESS_ROLES,
        activeRoutes: ["/developer", "/webhooks", "/whatsapp-settings"],
      },
      {
        href: "/dashboard/settings",
        label: "Settings",
        icon: Settings,
        roles: ALL_DASHBOARD_ROLES,
      },
      {
        href: "/dashboard/support",
        label: "Support",
        icon: LifeBuoy,
        roles: ALL_DASHBOARD_ROLES,
      },
    ],
  },
  {
    label: "More",
    items: [
      {
        href: "/leads",
        label: "Leads",
        icon: CreditCard,
        roles: BUSINESS_ROLES,
      },
      {
        href: "/canned-replies",
        label: "Canned Replies",
        icon: MessageSquare,
        roles: BUSINESS_ROLES,
      },
      {
        href: "/compliance",
        label: "Compliance",
        icon: Headphones,
        roles: ["SUPER_ADMIN", "BUSINESS_ADMIN", "TEAM_LEAD"],
        feature: "complianceFirewall",
      },
    ],
  },
  {
    label: "Platform",
    items: [
      {
        href: "/tenants",
        label: "Tenants",
        icon: Users,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/billing",
        label: "Plans & Billing",
        icon: CreditCard,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/platform-health",
        label: "Health",
        icon: BarChart3,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/platform-monitor",
        label: "Monitor",
        icon: Bell,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/recharge-requests",
        label: "Recharge requests",
        icon: WalletCards,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/payments",
        label: "Payments",
        icon: CreditCard,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/rates",
        label: "WhatsApp rates",
        icon: ClipboardList,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/currency-rates",
        label: "Currency rates",
        icon: Coins,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/languages",
        label: "Languages",
        icon: Languages,
        roles: ["SUPER_ADMIN"],
      },
      {
        href: "/number-migrations",
        label: "Number migrations",
        icon: ArrowRightLeft,
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    label: "Partner",
    items: [
      {
        href: "/partner/dashboard",
        label: "Partner Dashboard",
        icon: LayoutDashboard,
        roles: ["WHITE_LABEL_ADMIN"],
      },
      {
        href: "/partner/customers",
        label: "Customers",
        icon: Users,
        roles: ["WHITE_LABEL_ADMIN"],
      },
      {
        href: "/domains",
        label: "Domains",
        icon: Plug,
        roles: ["WHITE_LABEL_ADMIN", "SUPER_ADMIN"],
      },
    ],
  },
];

const BOTTOM_NAV_ITEMS = [
  "/dashboard",
  "/dashboard/inbox",
  "/dashboard/campaigns",
  "/dashboard/contacts",
  "/dashboard/wallet",
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// Route-match scoring lives in src/lib/navActive.ts so it can be
// unit-tested in isolation — see navActive.test.ts for the pinned
// rules (exact > prefix, longest-wins, /dashboard blocklist).

function filterSections(
  user: AuthUserPublic,
  features?: Record<string, boolean> | null,
) {
  const isFeatureOn = (key?: string) =>
    !key || !features || features[key] !== false;

  return APP_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        item.roles.includes(user.role as RoleName) && isFeatureOn(item.feature),
    ),
  })).filter((section) => section.items.length > 0);
}

function pageTitleFromPath(pathname: string, sections: AppNavSection[]) {
  for (const section of sections) {
    const item = section.items.find((entry) => isActiveRoute(pathname, entry));
    if (item) return item.label;
  }
  return "Dashboard";
}

export function NavItem({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: AppNavItem;
  active: boolean;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      data-nav-href={item.href}
      data-nav-active={active ? "true" : "false"}
      onClick={onNavigate}
      className={cn(
        "group flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
        collapsed && "justify-center px-0",
        active
          ? "bg-slate-950 text-white shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 flex-none",
          active ? "text-emerald-300" : "text-slate-400 group-hover:text-slate-700",
        )}
      />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

export function Sidebar({
  sections,
  activeHref,
  collapsed,
  onToggleCollapsed,
  user,
  signOut,
}: {
  sections: AppNavSection[];
  activeHref: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  user: AuthUserPublic;
  signOut: () => void;
}) {
  return (
    <aside
      className={cn(
        "hidden border-r border-slate-200 bg-white/95 backdrop-blur md:fixed md:inset-y-0 md:left-0 md:z-30 md:flex md:flex-col",
        collapsed ? "md:w-20" : "md:w-72",
      )}
    >
      <div
        className={cn(
          "flex h-16 items-center border-b border-slate-200 px-4",
          collapsed ? "justify-center" : "justify-between gap-3",
        )}
      >
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-white">
            N
          </span>
          {!collapsed && (
            <span className="truncate text-sm font-black text-slate-950">
              NexaFlow AI
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand sidebar"
          className="mx-auto mt-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {sections.map((section, sectionIndex) => (
          <div key={section.label ?? sectionIndex}>
            {section.label && !collapsed && (
              <div className="px-3 pb-2 text-[11px] font-bold uppercase text-slate-400">
                {section.label}
              </div>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavItem
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-3">
        <SidebarUserCard collapsed={collapsed} user={user} signOut={signOut} />
      </div>
    </aside>
  );
}

function SidebarUserCard({
  collapsed,
  user,
  signOut,
}: {
  collapsed: boolean;
  user: AuthUserPublic;
  signOut: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={signOut}
        title="Log out"
        className="flex h-10 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
      >
        <LogOut className="h-4 w-4" />
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-700 shadow-sm">
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">
            {user.name}
          </div>
          <div className="truncate text-xs text-slate-500">{user.email}</div>
        </div>
      </div>
      <button
        type="button"
        onClick={signOut}
        className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-950"
      >
        <LogOut className="h-3.5 w-3.5" />
        Log out
      </button>
    </div>
  );
}

export function MobileDrawer({
  open,
  sections,
  activeHref,
  onClose,
  user,
  signOut,
}: {
  open: boolean;
  sections: AppNavSection[];
  activeHref: string | null;
  onClose: () => void;
  user: AuthUserPublic;
  signOut: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close navigation overlay"
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-slate-950/45 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        )}
      />
      <aside
        className={cn(
          "relative flex h-full w-[min(88vw,22rem)] flex-col bg-white shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-slate-200 px-4">
          <Link href="/dashboard" onClick={onClose} className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-base font-black text-white">
              N
            </span>
            <span className="text-sm font-black text-slate-950">NexaFlow AI</span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-950"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {sections.map((section, sectionIndex) => (
            <div key={section.label ?? sectionIndex}>
              {section.label && (
                <div className="px-3 pb-2 text-[11px] font-bold uppercase text-slate-400">
                  {section.label}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavItem
                    key={item.href}
                    item={item}
                    active={item.href === activeHref}
                    onNavigate={onClose}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 text-xs text-slate-500">
            Signed in as <span className="font-semibold text-slate-800">{user.name}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              signOut();
            }}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>
    </div>
  );
}

export function Topbar({
  title,
  user,
  onOpenMenu,
  signOut,
}: {
  title: string;
  user: AuthUserPublic;
  onOpenMenu: () => void;
  signOut: () => void;
}) {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/90 backdrop-blur">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 md:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-black text-slate-950 sm:text-lg">
            {title}
          </div>
          <div className="hidden text-xs text-slate-500 sm:block">
            {user.role.replaceAll("_", " ").toLowerCase()}
          </div>
        </div>

        <div className="hidden min-w-[15rem] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm lg:flex">
          <Search className="h-4 w-4 text-slate-400" />
          <span>{t("common.searchPlaceholder")}</span>
        </div>

        <Link
          href="/dashboard/campaigns"
          className="hidden h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 lg:inline-flex"
        >
          <Plus className="h-4 w-4" />
          Quick campaign
        </Link>

        <Link
          href="/dashboard/wallet"
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:border-emerald-300 md:hidden"
        >
          <WalletCards className="h-4 w-4" />
          Wallet
        </Link>

        <button
          type="button"
          aria-label="Notifications"
          className="hidden h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:bg-slate-100 md:inline-flex"
        >
          <Bell className="h-4 w-4" />
        </button>

        <LocaleSwitcher className="hidden md:inline-flex" />

        <UserMenu user={user} signOut={signOut} />
      </div>
    </header>
  );
}

export function UserMenu({
  user,
  signOut,
}: {
  user: AuthUserPublic;
  signOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Open profile menu"
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100"
      >
        <UserCircle className="h-5 w-5" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-3 py-2">
            <div className="truncate text-sm font-semibold text-slate-950">
              {user.name}
            </div>
            <div className="truncate text-xs text-slate-500">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="mt-1 flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function BottomNav({
  items,
  activeHref,
}: {
  items: AppNavItem[];
  activeHref: string | null;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
      <div className="mx-auto grid h-16 max-w-md grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === activeHref;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg text-[11px] font-semibold",
                active ? "text-slate-950" : "text-slate-500 hover:text-slate-900",
              )}
            >
              <Icon
                className={cn(
                  "h-5 w-5",
                  active ? "text-emerald-600" : "text-slate-400",
                )}
              />
              <span className="max-w-full truncate">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({
  user,
  features,
  signOut,
  children,
}: {
  user: AuthUserPublic;
  features?: Record<string, boolean> | null;
  signOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sections = useMemo(() => filterSections(user, features), [features, user]);
  const flatItems = sections.flatMap((section) => section.items);
  const title = pageTitleFromPath(pathname, sections);
  const activeHref = activeHrefFromPath(pathname, sections);
  const bottomItems = BOTTOM_NAV_ITEMS.map((href) =>
    flatItems.find((item) => item.href === href),
  ).filter(Boolean) as AppNavItem[];

  return (
    <div className="min-h-screen bg-slate-50" data-active-href={activeHref ?? ""}>
      <ImpersonationBanner />
      <Sidebar
        sections={sections}
        activeHref={activeHref}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        user={user}
        signOut={signOut}
      />
      <MobileDrawer
        open={drawerOpen}
        sections={sections}
        activeHref={activeHref}
        onClose={() => setDrawerOpen(false)}
        user={user}
        signOut={signOut}
      />

      <div className={cn("min-h-screen", sidebarCollapsed ? "md:pl-20" : "md:pl-72")}>
        <Topbar
          title={title}
          user={user}
          onOpenMenu={() => setDrawerOpen(true)}
          signOut={signOut}
        />
        <main className="mx-auto max-w-7xl px-4 pb-28 pt-5 sm:px-6 lg:px-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav items={bottomItems} activeHref={activeHref} />
    </div>
  );
}
