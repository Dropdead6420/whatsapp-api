"use client";

// SuperAdmin — AI Settings / AI Control Center.
// Global request defaults live alongside the existing workload routing matrix.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { DashboardShell } from "../../src/components/DashboardShell";
import {
  ADMIN_SETTINGS_NAV,
  SettingsConsoleFrame,
  SettingsStatusPill,
} from "../../src/components/SettingsConsoleFrame";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Route {
  workload: string;
  label: string;
  group: "text" | "qr" | "media" | "embeddings";
  description: string;
  enabled: boolean;
  provider: string;
  model: string;
}

interface AiGlobalSettings {
  enabled: boolean;
  defaultProvider: string;
  textModel: string;
  embeddingsModel: string;
  defaultLanguage: string;
  defaultTone: string;
  creativity: string;
  maxInputLength: number;
  maxOutputLength: number;
  updatedAt?: string;
}

interface ProviderConfig {
  id: string;
  provider: string;
  kind: string;
  label: string;
  hasKey: boolean;
  defaultModel: string | null;
  isDefault: boolean;
  status: string;
}

const GROUPS: { key: Route["group"]; title: string; blurb: string }[] = [
  {
    key: "text",
    title: "Text & Reasoning",
    blurb: "Content, text, chat and code workloads.",
  },
  {
    key: "qr",
    title: "QR Generation",
    blurb: "QR-controlled generation has its own provider route.",
  },
  {
    key: "media",
    title: "Media Generation",
    blurb: "Image, video and voice usually deserve their own provider path.",
  },
  {
    key: "embeddings",
    title: "Embeddings",
    blurb: "Search, similarity, retrieval and indexing.",
  },
];

const DEFAULT_SETTINGS: AiGlobalSettings = {
  enabled: true,
  defaultProvider: "OpenAI",
  textModel: "gpt-5.4",
  embeddingsModel: "text-embedding-3-small",
  defaultLanguage: "English",
  defaultTone: "Friendly",
  creativity: "Economic",
  maxInputLength: 100,
  maxOutputLength: 2000,
};

export default function AiRoutingPage() {
  const { user, features, products, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [settings, setSettings] = useState<AiGlobalSettings>(DEFAULT_SETTINGS);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySettings, setBusySettings] = useState(false);
  const [busyRoutes, setBusyRoutes] = useState(false);

  const providerCards = useMemo(() => {
    const defaults = [
      {
        label: "Default provider",
        value: settings.defaultProvider,
        hint: "Primary stack for uncategorized tasks.",
      },
      {
        label: "Text baseline",
        value: settings.textModel,
        hint: "General reasoning, writing, and fallback generation.",
      },
      {
        label: "Embeddings",
        value: settings.embeddingsModel,
        hint: "Search, similarity, retrieval, and indexing.",
      },
    ];
    return defaults;
  }, [settings]);

  async function load() {
    setErr(null);
    try {
      const [nextSettings, nextRoutes] = await Promise.all([
        api.get<AiGlobalSettings>("/api/v1/admin/ai-routing/settings"),
        api.get<Route[]>("/api/v1/admin/ai-routing"),
      ]);
      setSettings(nextSettings);
      setRoutes(nextRoutes);
      try {
        setProviders(
          await api.get<ProviderConfig[]>("/api/v1/ai-providers?includeDisabled=true"),
        );
      } catch {
        setProviders([]);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load AI settings.");
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user]);

  function setCell(workload: string, patch: Partial<Route>) {
    setRoutes((prev) =>
      prev.map((route) =>
        route.workload === workload ? { ...route, ...patch } : route,
      ),
    );
  }

  async function saveSettings() {
    setBusySettings(true);
    setErr(null);
    setNotice(null);
    try {
      const saved = await api.put<AiGlobalSettings>(
        "/api/v1/admin/ai-routing/settings",
        settings,
      );
      setSettings(saved);
      setNotice("Global AI settings saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save AI settings.");
    } finally {
      setBusySettings(false);
    }
  }

  async function saveRoutes() {
    setBusyRoutes(true);
    setErr(null);
    setNotice(null);
    try {
      await api.put("/api/v1/admin/ai-routing", {
        routes: routes.map((route) => ({
          workload: route.workload,
          enabled: route.enabled,
          provider: route.provider,
          model: route.model,
        })),
      });
      setNotice("AI workload routing saved.");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to save AI routing.");
    } finally {
      setBusyRoutes(false);
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell
      user={user}
      features={features}
      products={products}
      signOut={signOut}
    >
      <SettingsConsoleFrame activeKey="ai" navItems={ADMIN_SETTINGS_NAV}>
        {err && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {err}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                AI Control Center
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                Choose one strong default stack, keep provider keys organized,
                and route each workload only when it benefits from a different
                model family.
              </p>
            </div>
            <SettingsStatusPill
              enabled={settings.enabled}
              label={settings.enabled ? "Enabled" : "Paused"}
            />
          </div>

          <div className="space-y-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-950">
                  {settings.enabled
                    ? "AI infrastructure is active"
                    : "AI infrastructure is paused"}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  Global status controls platform defaults. Workload-level
                  toggles below still remain visible for planning.
                </p>
              </div>
              <fieldset className="flex gap-6 rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <legend className="sr-only">Global AI status</legend>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={settings.enabled}
                    onChange={() =>
                      setSettings((current) => ({ ...current, enabled: true }))
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Enable
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="radio"
                    checked={!settings.enabled}
                    onChange={() =>
                      setSettings((current) => ({ ...current, enabled: false }))
                    }
                    className="h-4 w-4 accent-emerald-600"
                  />
                  Disable
                </label>
              </fieldset>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {providerCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-lg border border-slate-200 bg-white p-4"
                >
                  <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
                    {card.label}
                  </p>
                  <div className="mt-3 text-sm font-semibold text-slate-950">
                    {card.value}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    {card.hint}
                  </p>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
                General configuration
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                Set the default language, writing style, creativity level, and
                safe working limits for AI requests across the admin workspace.
              </p>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <SelectField
                  label="Default Provider"
                  value={settings.defaultProvider}
                  options={["OpenAI", "Anthropic", "Gemini", "DeepSeek", "Grok", "Custom"]}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, defaultProvider: value }))
                  }
                />
                <InputField
                  label="Text baseline model"
                  value={settings.textModel}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, textModel: value }))
                  }
                />
                <InputField
                  label="Embeddings model"
                  value={settings.embeddingsModel}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, embeddingsModel: value }))
                  }
                />
                <SelectField
                  label="Default Language"
                  value={settings.defaultLanguage}
                  options={["English", "Hindi", "Hinglish", "Arabic", "Spanish"]}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, defaultLanguage: value }))
                  }
                />
                <SelectField
                  label="Default Tone Of Voice"
                  value={settings.defaultTone}
                  options={["Friendly", "Professional", "Luxury", "Direct", "Playful"]}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, defaultTone: value }))
                  }
                />
                <SelectField
                  label="Default Creativity"
                  value={settings.creativity}
                  options={["Economic", "Balanced", "Creative", "Experimental"]}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, creativity: value }))
                  }
                />
                <NumberField
                  label="Maximum Input Length"
                  value={settings.maxInputLength}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, maxInputLength: value }))
                  }
                />
                <NumberField
                  label="Maximum Output Length"
                  value={settings.maxOutputLength}
                  onChange={(value) =>
                    setSettings((current) => ({ ...current, maxOutputLength: value }))
                  }
                />
              </div>

              <button
                type="button"
                onClick={() => void saveSettings()}
                disabled={busySettings}
                className="mt-5 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {busySettings ? "Saving..." : "Save global settings"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Provider credentials
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Only fill the providers you actually plan to route traffic to.
                Empty credentials can remain unused.
              </p>
            </div>
            <Link
              href="/secret-vault"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Open Secret Vault
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
            {providers.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                No provider configs yet. Use Secret Vault and AI Provider Hub to
                add encrypted keys and fallback chains.
              </div>
            )}
            {providers.map((provider) => (
              <div key={provider.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      {provider.label}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-slate-400">
                      {provider.provider} · {provider.kind}
                    </p>
                  </div>
                  <SettingsStatusPill
                    enabled={provider.status === "ACTIVE"}
                    label={provider.status}
                  />
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  {provider.hasKey ? "Encrypted key linked." : "Using env fallback or no key."}
                  {provider.defaultModel ? ` Default model: ${provider.defaultModel}.` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Workload routing matrix
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                Per-workload overrides for provider and model routing.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void saveRoutes()}
              disabled={busyRoutes}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyRoutes ? "Saving..." : "Save routing"}
            </button>
          </div>

          <div className="space-y-5 p-5">
            {GROUPS.map((group) => {
              const rows = routes.filter((route) => route.group === group.key);
              if (rows.length === 0) return null;
              return (
                <div key={group.key} className="rounded-lg border border-slate-200">
                  <div className="border-b border-slate-100 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.28em] text-slate-500">
                      {group.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">{group.blurb}</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {rows.map((route) => (
                      <div
                        key={route.workload}
                        className="grid gap-3 p-4 lg:grid-cols-[1fr_140px_180px_220px]"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-950">
                            {route.label}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {route.description}
                          </p>
                        </div>
                        <select
                          value={route.enabled ? "enable" : "disable"}
                          onChange={(event) =>
                            setCell(route.workload, {
                              enabled: event.target.value === "enable",
                            })
                          }
                          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
                        >
                          <option value="enable">Enable</option>
                          <option value="disable">Disable</option>
                        </select>
                        <input
                          value={route.provider}
                          onChange={(event) =>
                            setCell(route.workload, {
                              provider: event.target.value,
                            })
                          }
                          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
                        />
                        <input
                          value={route.model}
                          onChange={(event) =>
                            setCell(route.workload, { model: event.target.value })
                          }
                          className="h-10 rounded-lg border border-slate-200 px-3 text-sm"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </SettingsConsoleFrame>
    </DashboardShell>
  );
}

function InputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-slate-700">{label}</span>
      <input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-semibold text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-200 px-3 outline-none focus:border-emerald-500"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
