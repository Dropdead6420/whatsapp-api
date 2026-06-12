"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import {
  BarChart3,
  Bell,
  Bot,
  ChevronLeft,
  ChevronRight,
  Contact2,
  CreditCard,
  Gauge,
  GitBranch,
  Home,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  MessageSquare,
  Plug,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  UserCircle2,
  Users,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
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
  shortLabel?: string;
  icon: LucideIcon;
  roles: RoleName[];
  /** Optional tenant feature key — item is hidden when the feature is disabled. */
  feature?: string;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const ALL_ROLES: RoleName[] = [
  "SUPER_ADMIN",
  "WHITE_LABEL_ADMIN",
  "BUSINESS_ADMIN",
  "TEAM_LEAD",
  "AGENT",
];

const BUSINESS_ROLES: RoleName[] = ["BUSINESS_ADMIN", "TEAM_LEAD"];

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        shortLabel: "Home",
        icon: Home,
        roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", ...BUSINESS_ROLES],
      },
      {
        href: "/setup-wizard",
        label: "Setup Wizard",
        shortLabel: "Setup",
        icon: ShieldCheck,
        roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", ...BUSINESS_ROLES],
      },
      {
        href: "/inbox",
        label: "Inbox",
        icon: Inbox,
        roles: ["AGENT", "TEAM_LEAD", "BUSINESS_ADMIN"],
      },
      {
        href: "/contacts",
        label: "Contacts",
        icon: Contact2,
        roles: BUSINESS_ROLES,
      },
    ],
  },
  {
    label: "Automation",
    items: [
      {
        href: "/campaigns",
        label: "Campaigns",
        shortLabel: "Campaigns",
        icon: Send,
        roles: BUSINESS_ROLES,
        feature: "campaigns",
      },
      {
        href: "/templates",
        label: "Templates",
        shortLabel: "Templates",
        icon: MessageSquare,
        roles: BUSINESS_ROLES,
      },
      {
        href: "/chatbot-builder",
        label: "Chatbot Builder",
        shortLabel: "Chatbot",
        icon: Bot,
        roles: BUSINESS_ROLES,
        feature: "flows",
      },
      {
        href: "/flows",
        label: "Workflow Builder",
        shortLabel: "Flows",
        icon: GitBranch,
        roles: BUSINESS_ROLES,
        feature: "flows",
      },
      {
        href: "/ai-agent",
        label: "AI Agents",
        shortLabel: "Agents",
        icon: Sparkles,
        roles: BUSINESS_ROLES,
      },
    ],
  },
  {
    label: "Business",
    items: [
      {
        href: "/wallet",
        label: "Wallet / Recharge",
        shortLabel: "Wallet",
        icon: WalletCards,
        roles: ["WHITE_LABEL_ADMIN", ...BUSINESS_ROLES],
      },
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
        roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", ...BUSINESS_ROLES],
      },
      {
        href: "/integrations",
        label: "Integrations",
        shortLabel: "Apps",
        icon: Plug,
        roles: ["SUPER_ADMIN", "WHITE_LABEL_ADMIN", ...BUSINESS_ROLES],
      },
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        roles: ALL_ROLES,
      },
      {
        href: "/support",
        label: "Support",
        icon: LifeBuoy,
        roles: ALL_ROLES,
      },
    ],
  },
  {
    label: "Growth & Channels",
    items: [
      { href: "/leads", label: "Leads", icon: Gauge, roles: BUSINESS_ROLES },
      {
        href: "/products",
        label: "WhatsApp Catalog",
        shortLabel: "Catalog",
        icon: Store,
        roles: BUSINESS_ROLES,
      },
      { href: "/channels", label: "Channel Manager", shortLabel: "Channels", icon: Plug, roles: ["BUSINESS_ADMIN"] },
      { href: "/whatsapp-settings", label: "WhatsApp Meta", shortLabel: "Meta", icon: MessageSquare, roles: ["BUSINESS_ADMIN"] },
      { href: "/canned-replies", label: "Canned Replies", shortLabel: "Replies", icon: MessageSquare, roles: BUSINESS_ROLES },
      { href: "/webhooks", label: "Webhooks", icon: GitBranch, roles: BUSINESS_ROLES, feature: "webhooks" },
    ],
  },
  {
    label: "Bookings",
    items: [
      { href: "/services", label: "Services", icon: Store, roles: BUSINESS_ROLES, feature: "appointments" },
      { href: "/appointments", label: "Appointments", icon: Users, roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"], feature: "appointments" },
    ],
  },
  {
    label: "Partner & Platform",
    items: [
      { href: "/white-label", label: "Agency Panel", shortLabel: "Agency", icon: Users, roles: ["WHITE_LABEL_ADMIN", "SUPER_ADMIN"] },
      { href: "/plans", label: "Plans & Add-ons", shortLabel: "Plans", icon: CreditCard, roles: BUSINESS_ROLES },
      { href: "/tenants", label: "Tenants", icon: Users, roles: ["SUPER_ADMIN"] },
      { href: "/billing", label: "Billing Controls", shortLabel: "Billing", icon: CreditCard, roles: ["SUPER_ADMIN"] },
      { href: "/platform-health", label: "Health Services", shortLabel: "Health", icon: Gauge, roles: ["SUPER_ADMIN"] },
      { href: "/audit-logs", label: "Audit Logs", shortLabel: "Audit", icon: ShieldCheck, roles: ["SUPER_ADMIN"] },
      { href: "/missing-features", label: "Labs & Backlog", shortLabel: "Labs", icon: Sparkles, roles: ALL_ROLES },
      { href: "/design-system", label: "UI Design System", shortLabel: "Design", icon: Sparkles, roles: ALL_ROLES },
    ],
  },
];

const MOBILE_BOTTOM_KEYS = ["/dashboard", "/inbox", "/campaigns", "/contacts", "/wallet"];

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isFeatureOn = (key?: string) =>
    !key || !features || features[key] !== false;

  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) =>
            item.roles.includes(user.role as RoleName) && isFeatureOn(item.feature),
        ),
      })).filter((section) => section.items.length > 0),
    [features, user.role],
  );

  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  const activeItem = useMemo(
    () =>
      [...flatItems]
        .sort((a, b) => b.href.length - a.href.length)
        .find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)),
    [flatItems, pathname],
  );

  const bottomItems = useMemo(
    () =>
      MOBILE_BOTTOM_KEYS.map((href) => flatItems.find((item) => item.href === href)).filter(
        Boolean,
      ) as NavItem[],
    [flatItems],
  );

  const pageTitle = activeItem?.label ?? "NexaFlow AI";
  const sidebarWidthClass = collapsed ? "md:ml-20" : "md:ml-72";
  const sidebarPanelClass = collapsed ? "md:w-20" : "md:w-72";

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-slate-950 text-white font-sans overflow-x-hidden antialiased">
      <DesktopSidebar
        collapsed={collapsed}
        sections={sections}
        pathname={pathname}
        sidebarPanelClass={sidebarPanelClass}
        user={user}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onSignOut={signOut}
      />

      <MobileDrawer
        open={mobileOpen}
        sections={sections}
        pathname={pathname}
        user={user}
        onClose={() => setMobileOpen(false)}
        onSignOut={signOut}
      />

      <div className={`min-h-screen transition-[margin] duration-300 ${sidebarWidthClass}`}>
        <Topbar
          title={pageTitle}
          user={user}
          onOpenMobileNav={() => setMobileOpen(true)}
          onSignOut={signOut}
        />

        <main className="bg-cosmic-glow relative min-h-[calc(100vh-64px)] overflow-hidden">
          <div className="absolute inset-0 bg-radial-glow opacity-30 pointer-events-none" />
          <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:px-8 md:pb-12 md:pt-8 lg:px-10 relative min-h-[calc(100vh-64px)] z-10">
            {children}
          </div>
        </main>
      </div>

      <BottomNav items={bottomItems} pathname={pathname} />
      <AiAssistantOverlay />
    </div>
  );
}

function DesktopSidebar({
  collapsed,
  sections,
  pathname,
  sidebarPanelClass,
  user,
  onToggleCollapsed,
  onSignOut,
}: {
  collapsed: boolean;
  sections: NavSection[];
  pathname: string;
  sidebarPanelClass: string;
  user: AuthUserPublic;
  onToggleCollapsed: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden shrink-0 border-r border-white/5 bg-slate-950/90 shadow-2xl shadow-black/30 backdrop-blur-xl transition-[width] duration-300 md:flex md:flex-col ${sidebarPanelClass}`}
    >
      <div className={`flex h-16 items-center border-b border-white/5 px-4 ${collapsed ? "justify-center" : "justify-between"}`}>
        <Link href="/dashboard" className="flex min-w-0 items-center gap-3">
          <BrandMark />
          {!collapsed && (
            <span className="truncate bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent font-extrabold text-base tracking-wide">
              NexaFlow AI
            </span>
          )}
        </Link>
        {!collapsed && (
          <button
            onClick={onToggleCollapsed}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-slate-400 transition hover:border-emerald-400/30 hover:bg-emerald-400/10 hover:text-emerald-300"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggleCollapsed}
          className="mx-auto mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-2 text-slate-400 transition hover:border-emerald-400/30 hover:bg-emerald-400/10 hover:text-emerald-300"
          aria-label="Expand sidebar"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 text-xs">
        {sections.map((section, idx) => (
          <div key={idx} className="space-y-1.5">
            {section.label && !collapsed && (
              <div className="px-3 pb-1 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                {section.label}
              </div>
            )}
            <div className="space-y-1">
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  pathname={pathname}
                  collapsed={collapsed}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <UserPanel user={user} collapsed={collapsed} onSignOut={onSignOut} />
    </aside>
  );
}

function MobileDrawer({
  open,
  sections,
  pathname,
  user,
  onClose,
  onSignOut,
}: {
  open: boolean;
  sections: NavSection[];
  pathname: string;
  user: AuthUserPublic;
  onClose: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm transition-opacity md:hidden ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-[60] flex w-[min(86vw,22rem)] flex-col border-r border-white/10 bg-slate-950 shadow-2xl shadow-black/50 transition-transform duration-300 md:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
          <Link href="/dashboard" className="flex items-center gap-3" onClick={onClose}>
            <BrandMark />
            <span className="font-extrabold tracking-wide text-white">NexaFlow AI</span>
          </Link>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-slate-300 transition hover:bg-white/10"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-5 text-sm">
          {sections.map((section, idx) => (
            <div key={idx} className="space-y-2">
              {section.label && (
                <div className="px-2 text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                  {section.label}
                </div>
              )}
              <div className="space-y-1">
                {section.items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} onClick={onClose} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <UserPanel user={user} onSignOut={onSignOut} />
      </aside>
    </>
  );
}

function Topbar({
  title,
  user,
  onOpenMobileNav,
  onSignOut,
}: {
  title: string;
  user: AuthUserPublic;
  onOpenMobileNav: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="sticky top-0 z-30 h-16 border-b border-white/5 bg-slate-950/85 backdrop-blur-xl">
      <div className="flex h-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onOpenMobileNav}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-2 text-slate-200 transition hover:bg-white/10 md:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-white sm:text-base">{title}</div>
            <div className="hidden text-xs text-slate-500 sm:block">
              {user.role.replaceAll("_", " ").toLowerCase()} workspace
            </div>
          </div>
        </div>

        <div className="hidden min-w-[18rem] flex-1 justify-center md:flex">
          <div className="flex w-full max-w-md items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <span>Search contacts, campaigns, conversations...</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/wallet"
            className="hidden items-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400/15 sm:flex"
          >
            <WalletCards className="h-4 w-4" />
            Wallet
          </Link>
          <button className="hidden rounded-2xl border border-white/10 bg-white/[0.03] p-2 text-slate-300 transition hover:bg-white/10 md:block" aria-label="Notifications">
            <Bell className="h-5 w-5" />
          </button>
          <UserMenu user={user} onSignOut={onSignOut} />
        </div>
      </div>
    </header>
  );
}

function BottomNav({ items, pathname }: { items: NavItem[]; pathname: string }) {
  if (items.length === 0) return null;
  return (
    <nav className="fixed inset-x-3 bottom-3 z-40 rounded-3xl border border-white/10 bg-slate-950/90 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl md:hidden">
      <div className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-h-[3.35rem] flex-col items-center justify-center gap-1 rounded-2xl px-1 text-[10px] font-bold transition ${
                active
                  ? "bg-emerald-400/15 text-emerald-300"
                  : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-200"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate">{item.shortLabel ?? item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  collapsed = false,
  onClick,
}: {
  item: NavItem;
  pathname: string;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  const active = isActivePath(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 font-semibold tracking-wide transition-all duration-200 ${
        collapsed ? "justify-center" : ""
      } ${
        active
          ? "border-emerald-500/20 bg-gradient-to-r from-emerald-500/15 to-teal-500/5 text-emerald-300 shadow-sm shadow-emerald-500/10"
          : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-slate-100"
      }`}
    >
      <Icon className={`h-4.5 w-4.5 shrink-0 ${active ? "text-emerald-300" : "text-slate-500"}`} />
      {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
    </Link>
  );
}

function UserPanel({
  user,
  collapsed = false,
  onSignOut,
}: {
  user: AuthUserPublic;
  collapsed?: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="border-t border-white/5 p-4 text-xs">
      <div className={`flex items-center gap-3 ${collapsed ? "justify-center" : ""}`}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-sm font-black text-emerald-300">
          {(user.name || user.email || "U").charAt(0).toUpperCase()}
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate font-semibold text-slate-200">{user.name}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500">{user.email}</div>
          </div>
        )}
      </div>
      {!collapsed && (
        <>
          <div className="mt-3">
            <span className="inline-block rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-emerald-400">
              {user.role}
            </span>
          </div>
          <button
            onClick={onSignOut}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-bold text-slate-300 transition-all hover:border-white/20 hover:bg-white/10 hover:text-white active:scale-95"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </>
      )}
    </div>
  );
}

function UserMenu({
  user,
  onSignOut,
}: {
  user: AuthUserPublic;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2 text-slate-200 transition hover:bg-white/10 sm:px-3"
        aria-label="Open user menu"
      >
        <UserCircle2 className="h-5 w-5" />
        <span className="hidden max-w-[8rem] truncate text-xs font-bold sm:block">
          {user.name || "Profile"}
        </span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-3xl border border-white/10 bg-slate-950 p-3 text-xs shadow-2xl shadow-black/50">
          <div className="rounded-2xl bg-white/[0.04] p-3">
            <div className="font-bold text-white">{user.name}</div>
            <div className="mt-1 truncate text-slate-500">{user.email}</div>
          </div>
          <button
            onClick={onSignOut}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 font-bold text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 font-black text-white shadow-lg shadow-emerald-500/20">
      N
    </div>
  );
}

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}
