"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

export default function ThemeBuilderPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  // Local storage themes
  const [activeTheme, setActiveTheme] = useState<"dark" | "glass" | "sunset" | "light">("dark");
  const [primaryColor, setPrimaryColor] = useState<string>("#6366f1");
  const [secondaryColor, setSecondaryColor] = useState<string>("#10b981");
  const [fontFamily, setFontFamily] = useState<"Inter" | "Outfit" | "Roboto">("Inter");

  useEffect(() => {
    const storedTheme = localStorage.getItem("nexaflow_theme") as any || "dark";
    setActiveTheme(storedTheme);

    const storedPrim = localStorage.getItem("nexaflow_brand_primary") || "#6366f1";
    setPrimaryColor(storedPrim);

    const storedSec = localStorage.getItem("nexaflow_brand_secondary") || "#10b981";
    setSecondaryColor(storedSec);

    const storedFont = localStorage.getItem("nexaflow_brand_font") as any || "Inter";
    setFontFamily(storedFont);
  }, []);

  const handleSaveTheme = (themeName: "dark" | "glass" | "sunset" | "light") => {
    setActiveTheme(themeName);
    localStorage.setItem("nexaflow_theme", themeName);
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  const handleApplyConfigs = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem("nexaflow_brand_primary", primaryColor);
    localStorage.setItem("nexaflow_brand_secondary", secondaryColor);
    localStorage.setItem("nexaflow_brand_font", fontFamily);
    
    alert("Appearance structures and client interface theme assets updated.");
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  // Preview helper values
  const getPreviewClasses = () => {
    const fontClass = fontFamily === "Outfit" ? "font-serif tracking-wide" : fontFamily === "Roboto" ? "font-mono" : "font-sans";
    
    switch (activeTheme) {
      case "dark":
        return {
          wrapper: `bg-slate-950 text-slate-100 border-slate-800 ${fontClass}`,
          sidebar: "bg-slate-900 border-slate-800 text-slate-400",
          card: "bg-slate-900 border-slate-800",
          textMuted: "text-slate-400",
          button: "bg-indigo-600 hover:bg-indigo-500 text-white"
        };
      case "glass":
        return {
          wrapper: `bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 text-slate-100 border-white/10 ${fontClass}`,
          sidebar: "bg-white/5 border-white/10 text-slate-400 backdrop-blur-md",
          card: "bg-white/5 border-white/10 backdrop-blur-md",
          textMuted: "text-slate-400",
          button: "bg-indigo-500/20 border border-indigo-500/40 text-white"
        };
      case "sunset":
        return {
          wrapper: `bg-gradient-to-tr from-slate-950 via-purple-950 to-rose-950 text-rose-100 border-rose-900/30 ${fontClass}`,
          sidebar: "bg-slate-900/80 border-rose-900/30 text-rose-300",
          card: "bg-slate-900/60 border-rose-900/30",
          textMuted: "text-rose-300/80",
          button: "bg-gradient-to-r from-rose-600 to-amber-500 text-white"
        };
      case "light":
      default:
        return {
          wrapper: `bg-slate-50 text-slate-900 border-slate-200 ${fontClass}`,
          sidebar: "bg-white border-slate-200 text-slate-500",
          card: "bg-white border-slate-200 shadow-sm",
          textMuted: "text-slate-500",
          button: "bg-indigo-600 hover:bg-indigo-500 text-white"
        };
    }
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Theme Center…</div>;
  }

  const p = getPreviewClasses();

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Appearance & Theme Builder</h1>
        <p className="text-sm text-slate-400">
          Customize colors, fonts, presets, and branding visuals, then inspect live mock sandbox outputs.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Preset selectors and picker */}
        <div className="space-y-6">
          {/* Preset Cards */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
            <h2 className="text-sm font-bold text-white mb-4">Choose Client Interface Preset Theme</h2>
            
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                onClick={() => handleSaveTheme("dark")}
                className={`rounded-lg border p-4 text-left transition-all duration-300 ${
                  activeTheme === "dark" ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="font-bold text-xs text-white">Sleek Dark Mode 🌙</div>
                <div className="text-[10px] text-slate-400 mt-1">Deep slate panels, calibrated contrast, high-profile accents.</div>
              </button>

              <button
                onClick={() => handleSaveTheme("glass")}
                className={`rounded-lg border p-4 text-left transition-all duration-300 ${
                  activeTheme === "glass" ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="font-bold text-xs text-white">V2 Glassmorphism 🔮</div>
                <div className="text-[10px] text-slate-400 mt-1"> Frosted backdrop filters, transparent borders, soft gradients.</div>
              </button>

              <button
                onClick={() => handleSaveTheme("sunset")}
                className={`rounded-lg border p-4 text-left transition-all duration-300 ${
                  activeTheme === "sunset" ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="font-bold text-xs text-white">Sunset Flare 🌇</div>
                <div className="text-[10px] text-slate-400 mt-1">Gradients connecting purple, rose, and warm gold highlights.</div>
              </button>

              <button
                onClick={() => handleSaveTheme("light")}
                className={`rounded-lg border p-4 text-left transition-all duration-300 ${
                  activeTheme === "light" ? "border-indigo-500 bg-indigo-500/10" : "border-slate-800 bg-slate-950/40"
                }`}
              >
                <div className="font-bold text-xs text-white">Modern Crisp Light ☀️</div>
                <div className="text-[10px] text-slate-400 mt-1">Clean white sheets, fine borders, indigo highlighted markers.</div>
              </button>
            </div>
          </section>

          {/* Form picks */}
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
            <h2 className="text-sm font-bold text-white mb-4">Harmonious Custom Color & Typography Setup</h2>
            
            <form onSubmit={handleApplyConfigs} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-400">
                  Primary Accent Color (HEX)
                  <div className="flex gap-2 mt-1">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded border border-slate-700 bg-slate-950 p-1"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 font-mono"
                    />
                  </div>
                </label>

                <label className="block text-xs font-semibold text-slate-400">
                  Secondary Support Color (HEX)
                  <div className="flex gap-2 mt-1">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="h-8 w-8 cursor-pointer rounded border border-slate-700 bg-slate-950 p-1"
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 font-mono"
                    />
                  </div>
                </label>
              </div>

              <label className="block text-xs font-semibold text-slate-400">
                Core typography styling
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none"
                >
                  <option value="Inter">Inter font - default modern tech layout</option>
                  <option value="Outfit">Outfit font - elegant rounded aesthetic</option>
                  <option value="Roboto">Roboto mono font - robust industrial setup</option>
                </select>
              </label>

              <button
                type="submit"
                className="w-full rounded-lg bg-indigo-600 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 transition-all duration-300"
              >
                Apply Custom Palette Variables
              </button>
            </form>
          </section>
        </div>

        {/* Live Mock Sandbox preview */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md flex flex-col">
          <div className="mb-4">
            <h2 className="text-base font-bold text-white">Client Portal Live Mock Sandbox</h2>
            <p className="text-xs text-slate-400">Instantly previews how sub-tenants see their dashboard.</p>
          </div>

          {/* Sandbox Wrapper Container */}
          <div className={`flex-1 rounded-xl border p-4 flex flex-col justify-between min-h-[22rem] transition-all duration-500 ${p.wrapper}`}>
            {/* Mock Header */}
            <div className="flex justify-between items-center border-b border-inherit pb-2 mb-3">
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span style={{ backgroundColor: primaryColor }} className="h-5 w-5 rounded text-[10px] text-white flex items-center justify-center">
                  ✦
                </span>
                <span>NexaFlow Custom Workspace</span>
              </div>
              <span className="text-[8px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                CLIENT DEMO
              </span>
            </div>

            {/* Mock Dashboard Area */}
            <div className="grid gap-3 sm:grid-cols-3 flex-1 mb-3">
              {/* Mock Sidebar */}
              <div className={`rounded-lg border border-inherit p-2 space-y-1.5 ${p.sidebar}`}>
                <div className="text-[8px] font-bold uppercase tracking-wider">Growth Hub</div>
                <div style={{ backgroundColor: `${primaryColor}20`, color: primaryColor, borderLeftColor: primaryColor }} className="rounded px-2 py-1 text-[9px] font-semibold border-l-2">
                  Campaign Autopilot
                </div>
                <div className="rounded px-2 py-1 text-[9px] hover:bg-slate-800/40">Team Chats</div>
                <div className="rounded px-2 py-1 text-[9px] hover:bg-slate-800/40">Appointments</div>
              </div>

              {/* Mock Main Panel */}
              <div className="col-span-2 space-y-2 flex flex-col justify-between">
                {/* Mock broadcast card */}
                <div className={`rounded-lg border border-inherit p-3 ${p.card}`}>
                  <div className="flex justify-between items-start gap-1">
                    <div>
                      <div className="text-[10px] font-bold">Autopilot campaign status</div>
                      <div className={`text-[8px] ${p.textMuted}`}>Salon win-back schedule targeting churn.</div>
                    </div>
                    <span style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }} className="rounded px-1.5 py-0.5 text-[8px] font-semibold">
                      95% Match
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mt-3">
                    <div style={{ width: "70%", backgroundColor: primaryColor }} className="h-full rounded-full"></div>
                  </div>
                </div>

                {/* Mock action card */}
                <div className={`rounded-lg border border-inherit p-3 flex justify-between items-center ${p.card}`}>
                  <div>
                    <div className="text-[9px] font-bold">Verify WABA limits</div>
                    <div className={`text-[8px] ${p.textMuted}`}>Tier 2 quota verification.</div>
                  </div>
                  <button className={`rounded px-2 py-1 text-[9px] font-bold transition-all duration-300 ${p.button}`}>
                    Configure
                  </button>
                </div>
              </div>
            </div>

            {/* Mock Footer info */}
            <div className={`text-[8px] border-t border-inherit pt-2 flex justify-between ${p.textMuted}`}>
              <span>© 2026 Reselled Customer Brand Platform</span>
              <span>Running SLA: 15m</span>
            </div>
          </div>
        </section>
      </div>
    </PartnerShell>
  );
}
