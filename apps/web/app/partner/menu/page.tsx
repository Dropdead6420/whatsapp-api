"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";

interface MenuItem {
  key: string;
  defaultLabel: string;
  currentLabel: string;
  icon: string;
  enabled: boolean;
  category: "Core" | "Growth" | "AI Studio" | "Settings";
}

export default function MenuManagerPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Initial configuration items list
    const defaults: MenuItem[] = [
      { key: "Dashboard", defaultLabel: "Dashboard", currentLabel: "Dashboard", icon: "📊", enabled: true, category: "Core" },
      { key: "Customers", defaultLabel: "Customers", currentLabel: "Customers", icon: "👥", enabled: true, category: "Core" },
      { key: "Wallet", defaultLabel: "Wallet", currentLabel: "Wallet & Recharge", icon: "💳", enabled: true, category: "Core" },
      { key: "Whitelabel", defaultLabel: "White-label Setup", currentLabel: "White-label Setup", icon: "🏷️", enabled: true, category: "Settings" },
      { key: "Theme", defaultLabel: "Theme Builder", currentLabel: "Theme Builder", icon: "🎨", enabled: true, category: "Settings" },
      { key: "Menu", defaultLabel: "UI/Menu Manager", currentLabel: "UI/Menu Manager", icon: "⚙️", enabled: true, category: "Settings" },
      { key: "Products", defaultLabel: "Product Manager", currentLabel: "Product Manager", icon: "📦", enabled: true, category: "Growth" },
      { key: "Tickets", defaultLabel: "Support Tickets", currentLabel: "Support Tickets", icon: "🎫", enabled: true, category: "Core" },
      { key: "Channels", defaultLabel: "WhatsApp Channels", currentLabel: "WhatsApp Channels", icon: "💬", enabled: true, category: "Growth" },
      { key: "AI", defaultLabel: "AI Growth Center", currentLabel: "AI Growth Center", icon: "✦", enabled: true, category: "AI Studio" },
      { key: "Team", defaultLabel: "Team Status", currentLabel: "Team Status", icon: "🏢", enabled: true, category: "Core" },
    ];

    const storedMenu = localStorage.getItem("nexaflow_menu_config_full");
    if (storedMenu) {
      try {
        setMenuItems(JSON.parse(storedMenu));
      } catch (e) {
        setMenuItems(defaults);
      }
    } else {
      setMenuItems(defaults);
    }
  }, []);

  const handleToggle = (key: string) => {
    const updated = menuItems.map((item) =>
      item.key === key ? { ...item, enabled: !item.enabled } : item
    );
    setMenuItems(updated);
  };

  const handleLabelChange = (key: string, newLabel: string) => {
    const updated = menuItems.map((item) =>
      item.key === key ? { ...item, currentLabel: newLabel } : item
    );
    setMenuItems(updated);
  };

  const handleIconChange = (key: string, newIcon: string) => {
    const updated = menuItems.map((item) =>
      item.key === key ? { ...item, icon: newIcon } : item
    );
    setMenuItems(updated);
  };

  const handleSaveMenu = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Create short config mapping for PartnerShell
    const shortMap: Record<string, string> = {};
    menuItems.forEach((item) => {
      if (item.enabled) {
        shortMap[item.key] = item.currentLabel;
      }
    });

    localStorage.setItem("nexaflow_menu_config", JSON.stringify(shortMap));
    localStorage.setItem("nexaflow_menu_config_full", JSON.stringify(menuItems));

    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);

    alert("Sub-tenant UI navigation layouts and labels updated.");
    window.dispatchEvent(new Event("nexaflow-theme-change"));
  };

  const handleResetDefaults = () => {
    if (confirm("Reset all sidebar labels and features back to platform defaults?")) {
      localStorage.removeItem("nexaflow_menu_config");
      localStorage.removeItem("nexaflow_menu_config_full");
      window.location.reload();
    }
  };

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading Menu Manager…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">UI & Sidebar Menu Manager</h1>
        <p className="text-sm text-slate-400">
          Rename sidebar items, choose menu icons, and enable or disable features for your reselled child clients.
        </p>
      </header>

      {success && (
        <div className="mb-6 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-xs font-semibold text-emerald-400">
          ✓ Navigation menu configs updated successfully. Sidebars updated immediately!
        </div>
      )}

      <form onSubmit={handleSaveMenu} className="space-y-6">
        {/* Category grouped boxes */}
        {["Core", "Growth", "AI Studio", "Settings"].map((cat) => {
          const items = menuItems.filter((item) => item.category === cat);
          if (items.length === 0) return null;

          return (
            <section key={cat} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 backdrop-blur-md">
              <h2 className="text-sm font-bold text-indigo-400 uppercase tracking-wider mb-4">{cat} Nav Modules</h2>
              
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-lg bg-slate-950/40 p-4 border border-slate-800 transition-all duration-300 hover:border-slate-800 hover:bg-slate-950"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={() => handleToggle(item.key)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-indigo-600 focus:ring-indigo-500 accent-indigo-500 cursor-pointer"
                      />
                      <div>
                        <div className="font-bold text-xs text-white flex items-center gap-1.5">
                          <span>{item.icon}</span>
                          <span>{item.defaultLabel}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Key pointer: /partner/{item.key.toLowerCase()}</div>
                      </div>
                    </div>

                    {item.enabled && (
                      <div className="flex flex-wrap gap-2 items-center">
                        <label className="block text-[10px] text-slate-400">
                          Custom Icon Emo
                          <input
                            type="text"
                            value={item.icon}
                            onChange={(e) => handleIconChange(item.key, e.target.value)}
                            className="mt-1 w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-xs text-slate-200"
                          />
                        </label>
                        <label className="block text-[10px] text-slate-400">
                          Rename Sidebar Label
                          <input
                            type="text"
                            value={item.currentLabel}
                            onChange={(e) => handleLabelChange(item.key, e.target.value)}
                            className="mt-1 w-44 rounded border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-200"
                          />
                        </label>
                      </div>
                    )}

                    {!item.enabled && (
                      <span className="text-[10px] bg-rose-500/10 text-rose-400 px-2.5 py-0.5 rounded border border-rose-500/20 font-semibold self-start sm:self-center">
                        HIDDEN FROM CLIENTS
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {/* Triggers */}
        <div className="flex items-center justify-between border-t border-slate-800 pt-6">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="rounded-lg border border-rose-900/50 bg-rose-950/20 text-rose-400 px-4 py-2 text-xs font-semibold hover:bg-rose-950/40 transition-all duration-300"
          >
            Reset Default Sidebar Settings
          </button>
          
          <button
            type="submit"
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 transition-all duration-300"
          >
            Apply Sidebar Menu Toggles
          </button>
        </div>
      </form>
    </PartnerShell>
  );
}
