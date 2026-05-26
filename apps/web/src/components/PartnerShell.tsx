"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";

interface MenuConfig {
  Dashboard?: string;
  Customers?: string;
  Wallet?: string;
  Whitelabel?: string;
  Theme?: string;
  Menu?: string;
  Products?: string;
  Tickets?: string;
  Channels?: string;
  AI?: string;
  Team?: string;
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

  useEffect(() => {
    // Load branding, theme, and custom menus
    const storedTheme = localStorage.getItem("nexaflow_theme") as any;
    if (storedTheme) setTheme(storedTheme);
    
    const storedMenu = localStorage.getItem("nexaflow_menu_config");
    if (storedMenu) {
      try {
        setMenuConfig(JSON.parse(storedMenu));
      } catch {
        setMenuConfig({});
      }
    }

    const storedLogo = localStorage.getItem("nexaflow_brand_logo");
    if (storedLogo) setBrandLogo(storedLogo);

    const storedName = localStorage.getItem("nexaflow_brand_name");
    if (storedName) setBrandName(storedName);

    const storedColor = localStorage.getItem("nexaflow_brand_primary");
    if (storedColor) setPrimaryColor(storedColor);
  }, []);

  const toggleTheme = () => {
    const themes: ("dark" | "light" | "glass" | "sunset")[] = ["dark", "light", "glass", "sunset"];
    const nextIdx = (themes.indexOf(theme) + 1) % themes.length;
    const nextTheme = themes[nextIdx];
    setTheme(nextTheme);
    localStorage.setItem("nexaflow_theme", nextTheme);
    // Dispatch a custom event to notify child components of the theme change
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  const navItems = [
    { href: "/partner/dashboard", label: menuConfig.Dashboard || "Dashboard", icon: "📊" },
    { href: "/partner/customers", label: menuConfig.Customers || "Customers", icon: "👥" },
    { href: "/partner/wallet", label: menuConfig.Wallet || "Wallet & Recharge", icon: "💳" },
    { href: "/partner/whitelabel", label: menuConfig.Whitelabel || "White-label Setup", icon: "🏷️" },
    { href: "/partner/theme", label: menuConfig.Theme || "Theme Builder", icon: "🎨" },
    { href: "/partner/menu", label: menuConfig.Menu || "UI/Menu Manager", icon: "⚙️" },
    { href: "/partner/products", label: menuConfig.Products || "Product Manager", icon: "📦" },
    { href: "/partner/tickets", label: menuConfig.Tickets || "Support Tickets", icon: "🎫" },
    { href: "/partner/channels", label: menuConfig.Channels || "WhatsApp Channels", icon: "💬" },
    { href: "/partner/ai", label: menuConfig.AI || "AI Growth Center", icon: "✦" },
    { href: "/partner/team", label: menuConfig.Team || "Team Status", icon: "🏢" },
  ];

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
      <header className={`sticky top-0 z-40 flex h-14 items-center justify-between border-b px-6 transition-all duration-300 ${style.header}`}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-semibold">
            {brandLogo ? (
              <img src={brandLogo} alt="Logo" className="h-6 w-auto rounded" />
            ) : (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-white font-bold bg-indigo-600 animate-pulse">
                ✦
              </span>
            )}
            <span className="tracking-tight">{brandName}</span>
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

      {/* Sidebar + Main Body wrapper */}
      <div className="flex flex-1">
        {/* Sidebar Nav */}
        <aside className={`w-64 border-r flex flex-col justify-between shrink-0 transition-colors duration-300 ${style.sidebar}`}>
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
        <main className={`flex-1 overflow-y-auto p-8 transition-colors duration-300 ${style.main}`}>
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
