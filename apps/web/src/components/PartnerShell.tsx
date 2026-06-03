"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useCallback, useEffect, useState } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";
import { Menu, X } from "lucide-react";
import { api } from "../lib/api";

interface MenuItemOverride {
  label?: string;
  icon?: string;
  enabled: boolean;
}

type MenuConfig = Partial<
  Record<
    | "Dashboard"
    | "Customers"
    | "Demos"
    | "Proposals"
    | "Wallet"
    | "Whitelabel"
    | "Domains"
    | "Theme"
    | "Menu"
    | "Products"
    | "Tickets"
    | "Channels"
    | "AI"
    | "Team",
    MenuItemOverride
  >
>;

interface ServerMenuConfig {
  items: Array<{ key: string; label: string; icon: string; enabled: boolean }>;
}

export function PartnerShell({
  user,
  signOut,
  children,
}: {
  user: AuthUserPublic;
  signOut: () => void;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  
  // Theme settings (loaded from localStorage or default to dark)
  const [theme, setTheme] = useState<"dark" | "light" | "glass" | "sunset">("dark");
  const [menuConfig, setMenuConfig] = useState<MenuConfig>({});
  const [brandLogo, setBrandLogo] = useState<string>("");
  const [brandName, setBrandName] = useState<string>("Partner Portal");
  const [primaryColor, setPrimaryColor] = useState<string>("#6366f1"); // Indigo
  const [mobileOpen, setMobileOpen] = useState(false);

  const loadMenuConfig = useCallback(async () => {
    try {
      const data = await api.get<ServerMenuConfig | null>(
        "/api/v1/partner/menu-config",
      );
      if (data?.items) {
        const next: MenuConfig = {};
        for (const item of data.items) {
          (next as Record<string, MenuItemOverride>)[item.key] = {
            label: item.label,
            icon: item.icon,
            enabled: item.enabled,
          };
        }
        setMenuConfig(next);
      } else {
        setMenuConfig({});
      }
    } catch {
      // Non-fatal: shell renders default labels.
      setMenuConfig({});
    }
  }, []);

  useEffect(() => {
    const storedTheme = localStorage.getItem("nexaflow_theme") as
      | "dark"
      | "light"
      | "glass"
      | "sunset"
      | null;
    if (storedTheme) setTheme(storedTheme);

    void loadMenuConfig();

    const storedLogo = localStorage.getItem("nexaflow_brand_logo");
    if (storedLogo) setBrandLogo(storedLogo);

    const storedName = localStorage.getItem("nexaflow_brand_name");
    if (storedName) setBrandName(storedName);

    const storedColor = localStorage.getItem("nexaflow_brand_primary");
    if (storedColor) setPrimaryColor(storedColor);

    // /partner/menu dispatches this after a successful save.
    const handler = () => void loadMenuConfig();
    window.addEventListener("nexaflow-menu-change", handler);
    return () => window.removeEventListener("nexaflow-menu-change", handler);
  }, [loadMenuConfig]);

  const toggleTheme = () => {
    const themes: ("dark" | "light" | "glass" | "sunset")[] = ["dark", "light", "glass", "sunset"];
    const nextIdx = (themes.indexOf(theme) + 1) % themes.length;
    const nextTheme = themes[nextIdx];
    setTheme(nextTheme);
    localStorage.setItem("nexaflow_theme", nextTheme);
    // Dispatch a custom event to notify child components of the theme change
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  const DEFAULT_NAV: Array<{
    key: keyof MenuConfig;
    href: string;
    label: string;
    icon: string;
  }> = [
    { key: "Dashboard", href: "/partner/dashboard", label: "Dashboard", icon: "📊" },
    { key: "Customers", href: "/partner/customers", label: "Customers", icon: "👥" },
    { key: "Demos", href: "/partner/demos", label: "Demo-to-Paid", icon: "🚀" },
    { key: "Proposals", href: "/partner/proposals", label: "Proposals", icon: "📄" },
    { key: "Wallet", href: "/partner/wallet", label: "Wallet & Recharge", icon: "💳" },
    { key: "Whitelabel", href: "/partner/whitelabel", label: "White-label Setup", icon: "🏷️" },
    { key: "Domains", href: "/partner/domains", label: "Domain Health", icon: "🌐" },
    { key: "Theme", href: "/partner/theme", label: "Theme Builder", icon: "🎨" },
    { key: "Menu", href: "/partner/menu", label: "UI/Menu Manager", icon: "⚙️" },
    { key: "Products", href: "/partner/products", label: "Portfolio Catalog", icon: "📦" },
    { key: "Tickets", href: "/partner/tickets", label: "Support Tickets", icon: "🎫" },
    { key: "Channels", href: "/partner/channels", label: "WhatsApp Channels", icon: "💬" },
    { key: "AI", href: "/partner/ai", label: "AI overview", icon: "✦" },
    { key: "Team", href: "/partner/team", label: "Team", icon: "🏢" },
  ];

  const navItems = DEFAULT_NAV.filter((item) => {
    const override = menuConfig[item.key];
    return override?.enabled !== false; // undefined => keep default-enabled
  }).map((item) => {
    const override = menuConfig[item.key];
    return {
      href: item.href,
      label: override?.label || item.label,
      icon: override?.icon || item.icon,
    };
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Helper classes depending on theme
  const getThemeClasses = () => {
    switch (theme) {
      case "dark":
        return {
          wrapper: "bg-slate-950 text-slate-100 dark-theme",
          sidebar: "bg-slate-900 border-slate-800 text-slate-300",
          sidebarHeader: "border-slate-800",
          navActive: "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30",
          navHover: "hover:bg-slate-800/80 hover:text-white",
          main: "bg-slate-950 text-slate-100",
          footer: "border-slate-800 text-slate-400 bg-slate-900/40",
          header: "bg-slate-900/80 border-slate-800 backdrop-blur-md",
        };
      case "glass":
        return {
          wrapper: "bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 text-slate-100 glass-theme",
          sidebar: "bg-white/5 border-white/10 text-slate-300 backdrop-blur-xl",
          sidebarHeader: "border-white/10",
          navActive: "bg-indigo-500/20 border border-indigo-500/40 text-white shadow-xl shadow-indigo-500/10",
          navHover: "hover:bg-white/10 hover:text-white",
          main: "bg-transparent text-slate-100",
          footer: "border-white/10 text-slate-400 bg-white/5 backdrop-blur-md",
          header: "bg-white/5 border-white/10 backdrop-blur-xl",
        };
      case "sunset":
        return {
          wrapper: "bg-gradient-to-tr from-slate-950 via-purple-950 to-rose-950 text-rose-100 sunset-theme",
          sidebar: "bg-slate-900/80 border-rose-900/30 text-rose-200 backdrop-blur-md",
          sidebarHeader: "border-rose-900/30",
          navActive: "bg-gradient-to-r from-rose-600 to-amber-500 text-white shadow-lg shadow-rose-600/20",
          navHover: "hover:bg-rose-950/40 hover:text-white",
          main: "bg-transparent text-rose-100",
          footer: "border-rose-900/30 text-rose-300 bg-slate-900/60",
          header: "bg-slate-900/60 border-rose-900/30 backdrop-blur-md",
        };
      case "light":
      default:
        return {
          wrapper: "bg-slate-50 text-slate-900 light-theme",
          sidebar: "bg-white border-slate-200 text-slate-600",
          sidebarHeader: "border-slate-200",
          navActive: "bg-indigo-50 font-medium text-indigo-700 border-l-4 border-indigo-600",
          navHover: "hover:bg-slate-50 hover:text-slate-900",
          main: "bg-slate-50 text-slate-900",
          footer: "border-slate-200 text-slate-500 bg-white",
          header: "bg-white border-slate-200",
        };
    }
  };

  const style = getThemeClasses();

  return (
    <div className={`flex min-h-screen flex-col font-sans transition-all duration-500 ${style.wrapper}`}>
      
      {/* Top Header Navigation */}
      <header className={`sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 transition-all duration-300 sm:px-6 ${style.header}`}>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-200 transition hover:bg-slate-800 md:hidden"
            aria-label="Open partner navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 font-semibold">
            {brandLogo ? (
              <img src={brandLogo} alt="Logo" className="h-6 w-auto rounded" />
            ) : (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white font-bold bg-indigo-600 animate-pulse">
                ✦
              </span>
            )}
            <span className="truncate tracking-tight">{brandName}</span>
          </div>
          <span className="hidden rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 border border-emerald-500/20 sm:inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping"></span>
            Agency Portal Live
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Stats Summary */}
          <div className="hidden items-center gap-4 text-xs md:flex">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Total Margin</div>
              <div className="font-semibold text-emerald-400">+15% Markup</div>
            </div>
            <div className="h-8 w-px bg-slate-800"></div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Wallet Balance</div>
              <div className="font-semibold text-indigo-400">4,520 Credits</div>
            </div>
          </div>

          <div className="h-8 w-px bg-slate-800 hidden md:block"></div>

          {/* Theme Quick Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-300 transition-transform duration-300 hover:scale-105 hover:bg-slate-800"
            title="Toggle Premium Themes"
          >
            {theme === "dark" && "🌙"}
            {theme === "glass" && "🔮"}
            {theme === "sunset" && "🌇"}
            {theme === "light" && "☀️"}
          </button>

          {/* User Profile Summary */}
          <div className="flex items-center gap-2">
            <div className="hidden text-right text-xs sm:block">
              <div className="font-semibold">{user.name}</div>
              <div className="text-[10px] text-slate-400">Partner Admin</div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 text-xs font-bold text-white uppercase">
              {user.name.substring(0, 2)}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            aria-label="Close partner navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className={`relative flex h-full w-[min(86vw,320px)] flex-col justify-between border-r shadow-2xl transition-colors duration-300 ${style.sidebar}`}
          >
            <div className={`flex h-14 items-center justify-between border-b px-4 ${style.sidebarHeader}`}>
              <div className="flex min-w-0 items-center gap-2 font-semibold">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
                  ✦
                </span>
                <span className="truncate">{brandName}</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/50 bg-slate-800/40 text-slate-200"
                aria-label="Close partner navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-4">
              <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Agency Controls
              </div>
              <nav className="space-y-1">
                {navItems.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all duration-300 ${
                        active ? style.navActive : `text-slate-400 ${style.navHover}`
                      }`}
                    >
                      <span className="text-base">{item.icon}</span>
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className={`border-t p-4 transition-colors duration-300 ${style.footer}`}>
              <div className="truncate text-sm font-medium text-slate-300">{user.email}</div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-indigo-400">
                {user.role} Account
              </div>
              <button
                type="button"
                onClick={signOut}
                className="mt-3 flex w-full items-center justify-center rounded-md border border-slate-700 bg-slate-800/40 py-1.5 text-center text-xs font-semibold text-slate-300 transition-all duration-300 hover:border-red-900/50 hover:bg-red-950/20 hover:text-red-400"
              >
                Sign Out Account
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Sidebar + Main Body wrapper */}
      <div className="flex min-w-0 flex-1">
        {/* Sidebar Nav */}
        <aside className={`hidden w-64 shrink-0 flex-col justify-between border-r transition-colors duration-300 md:flex ${style.sidebar}`}>
          <div className="flex-1 overflow-y-auto py-4 px-3">
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Agency Controls
            </div>
            <nav className="space-y-1">
              {navItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-300 ${
                      active ? style.navActive : `text-slate-400 ${style.navHover}`
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Footer Details */}
          <div className={`p-4 border-t transition-colors duration-300 ${style.footer}`}>
            <div className="truncate font-medium text-sm text-slate-300">{user.email}</div>
            <div className="mt-1 text-[10px] uppercase tracking-wide text-indigo-400 font-semibold">
              {user.role} Account
            </div>
            <button
              type="button"
              onClick={signOut}
              className="mt-3 flex w-full items-center justify-center rounded-md border border-slate-700 bg-slate-800/40 py-1.5 text-center text-xs font-semibold text-slate-300 transition-all duration-300 hover:bg-red-950/20 hover:border-red-900/50 hover:text-red-400"
            >
              Sign Out Account
            </button>
          </div>
        </aside>

        {/* Content Portal */}
        <main className={`min-w-0 flex-1 overflow-y-auto p-4 pb-8 transition-colors duration-300 sm:p-6 lg:p-8 ${style.main}`}>
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
