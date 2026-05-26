"use client";

// Partner menu config — REAL backend integration.
//
// Replaces the Gemini localStorage mock. Menu overrides now persist
// to Tenant.partnerMenuConfig so the same labels/visibility show up
// for every team member and every browser the partner uses.

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface MenuItem {
  key: string;
  label: string;
  icon: string;
  enabled: boolean;
  category: "Core" | "Growth" | "AI Studio" | "Settings";
}

const DEFAULTS: MenuItem[] = [
  { key: "Dashboard", label: "Dashboard", icon: "📊", enabled: true, category: "Core" },
  { key: "Customers", label: "Customers", icon: "👥", enabled: true, category: "Core" },
  { key: "Wallet", label: "Wallet & Recharge", icon: "💳", enabled: true, category: "Core" },
  { key: "Whitelabel", label: "White-label Setup", icon: "🏷️", enabled: true, category: "Settings" },
  { key: "Theme", label: "Theme Builder", icon: "🎨", enabled: true, category: "Settings" },
  { key: "Menu", label: "UI/Menu Manager", icon: "⚙️", enabled: true, category: "Settings" },
  { key: "Products", label: "Portfolio Catalog", icon: "📦", enabled: true, category: "Growth" },
  { key: "Tickets", label: "Support Tickets", icon: "🎫", enabled: true, category: "Core" },
  { key: "Channels", label: "WhatsApp Channels", icon: "💬", enabled: true, category: "Growth" },
  { key: "AI", label: "AI overview", icon: "✦", enabled: true, category: "AI Studio" },
  { key: "Team", label: "Team", icon: "🏢", enabled: true, category: "Core" },
];

interface ServerConfig {
  items: Array<{ key: string; label: string; icon: string; enabled: boolean }>;
}

function mergeWithDefaults(serverItems: ServerConfig["items"]): MenuItem[] {
  const byKey = new Map(serverItems.map((i) => [i.key, i]));
  return DEFAULTS.map((d) => {
    const override = byKey.get(d.key);
    return override
      ? { ...d, label: override.label, icon: override.icon, enabled: override.enabled }
      : d;
  });
}

export default function PartnerMenuPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });

  const [items, setItems] = useState<MenuItem[]>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function loadConfig() {
    setErr(null);
    try {
      const data = await api.get<ServerConfig | null>("/api/v1/partner/menu-config");
      if (data?.items) {
        setItems(mergeWithDefaults(data.items));
      } else {
        setItems(DEFAULTS);
      }
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to load menu config: ${e.message}`
          : "Failed to load menu config.",
      );
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (user) void loadConfig();
  }, [user]);

  function patch(key: string, updates: Partial<MenuItem>) {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, ...updates } : i)),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        items: items.map(({ key, label, icon, enabled }) => ({
          key,
          label,
          icon,
          enabled,
        })),
      };
      await api.put("/api/v1/partner/menu-config", payload);
      setSavedAt(new Date());
      // PartnerShell listens for this event to refetch its nav.
      window.dispatchEvent(new Event("nexaflow-menu-change"));
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? `Failed to save: ${e.message}`
          : "Failed to save menu config.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    if (!confirm("Reset all sidebar labels and visibility to defaults?")) return;
    setItems(DEFAULTS);
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Menu manager
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Rename, re-icon, or hide nav items in your partner portal. Changes
            persist across your team and every browser.
          </p>
        </div>
        {savedAt && (
          <span className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            Saved at {savedAt.toLocaleTimeString()}
          </span>
        )}
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {!loaded && (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Loading saved menu config…
        </div>
      )}

      {loaded && (
        <form onSubmit={handleSave} className="space-y-6">
          {(["Core", "Growth", "AI Studio", "Settings"] as const).map((cat) => {
            const inCat = items.filter((i) => i.category === cat);
            if (inCat.length === 0) return null;
            return (
              <section
                key={cat}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  {cat}
                </h2>
                <div className="space-y-3">
                  {inCat.map((item) => (
                    <div
                      key={item.key}
                      className="flex flex-col gap-3 rounded-md border border-slate-100 bg-slate-50 p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) =>
                            patch(item.key, { enabled: e.target.checked })
                          }
                          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span>{item.icon}</span>
                            <span>{item.key}</span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-500">
                            /partner/{item.key.toLowerCase()}
                          </div>
                        </div>
                      </div>

                      {item.enabled ? (
                        <div className="flex flex-wrap gap-2">
                          <label className="block text-[10px] font-medium text-slate-600">
                            Icon
                            <input
                              type="text"
                              value={item.icon}
                              onChange={(e) =>
                                patch(item.key, { icon: e.target.value.slice(0, 4) })
                              }
                              maxLength={4}
                              className="mt-1 w-12 rounded border border-slate-300 px-2 py-1 text-center text-xs"
                            />
                          </label>
                          <label className="block text-[10px] font-medium text-slate-600">
                            Label
                            <input
                              type="text"
                              value={item.label}
                              onChange={(e) =>
                                patch(item.key, { label: e.target.value })
                              }
                              maxLength={40}
                              className="mt-1 w-48 rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          </label>
                        </div>
                      ) : (
                        <span className="self-start rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 sm:self-center">
                          Hidden
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          <div className="flex items-center justify-between border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={handleReset}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Reset to defaults
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save menu config"}
            </button>
          </div>
        </form>
      )}
    </PartnerShell>
  );
}
