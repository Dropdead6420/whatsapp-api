"use client";

import { Copy, Plus, RefreshCcw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { ApiClientError, api } from "../../../src/lib/api";

interface DemoTenantRow {
  id: string;
  tenantId: string;
  expiresAt: string;
  renewalCount: number;
  createdAt: string;
  tenant: {
    name: string;
    status: string;
    _count: { contacts: number; users: number };
  };
}

interface DemoCreateResult {
  tenantId: string;
  demoTenantId: string;
  demoUrl: string;
  expiresAt: string;
  credentials: { email: string; password: string };
  renewalCount: number;
}

interface DemoRecommendation {
  demoId: string;
  tenantName: string;
  score: number;
  stage: "COLD" | "NURTURE" | "WARM" | "HOT" | "EXPIRED";
  recommendedAction:
    | "CONVERT_NOW"
    | "SCHEDULE_CALL"
    | "EXTEND_DEMO"
    | "NUDGE_USAGE"
    | "REACTIVATE_DEMO"
    | "ARCHIVE";
  subject: string;
  message: string;
  reasoning: string;
  aiUsed: boolean;
  aiFallbackReason?: string;
  signals: {
    daysToExpire: number;
    contacts: number;
    users: number;
    campaigns: number;
    messages: number;
    inboundMessages: number;
  };
}

interface DemoSeedPlan {
  industry?: string;
  contacts?: Array<{
    name: string;
    phoneNumber: string;
    email?: string;
    tags?: string[];
  }>;
  templates?: Array<{
    name: string;
    bodyText: string;
    category?: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    headerText?: string;
    footerText?: string;
    language?: string;
  }>;
  campaignName?: string;
  leadTitle?: string;
  leadValue?: number;
  agentPersona?: {
    name: string;
    role: string;
    systemPrompt: string;
  };
  welcomeMessage?: string;
}

interface DemoBlueprintResult {
  blueprint: DemoSeedPlan;
  source: "ai" | "fallback";
  rationale?: string;
}

export default function PartnerDemosPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [demos, setDemos] = useState<DemoTenantRow[]>([]);
  const [recommendations, setRecommendations] = useState<Record<string, DemoRecommendation>>({});
  const [created, setCreated] = useState<DemoCreateResult | null>(null);
  const [demoName, setDemoName] = useState("");
  const [brief, setBrief] = useState({
    prospectName: "",
    industry: "salon",
    goals: "",
    scale: "",
    channels: "WhatsApp",
    language: "en",
  });
  const [blueprint, setBlueprint] = useState<DemoBlueprintResult | null>(null);
  const [blueprintJson, setBlueprintJson] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      setErr(null);
      const data = await api.get<DemoTenantRow[]>("/api/v1/partner/demo?limit=50");
      setDemos(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load demos");
    }
  }

  useEffect(() => {
    if (user) void load();
  }, [user]);

  async function createDemo() {
    if (!demoName.trim()) return;
    setBusy("create");
    setErr(null);
    try {
      const result = await api.post<DemoCreateResult>("/api/v1/partner/demo/create", {
        demoName: demoName.trim(),
        expiryDays: 30,
      });
      setCreated(result);
      setDemoName("");
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to create demo");
    } finally {
      setBusy(null);
    }
  }

  async function generateBlueprint() {
    if (!brief.prospectName.trim() || !brief.industry.trim()) return;
    setBusy("blueprint");
    setErr(null);
    try {
      const result = await api.post<DemoBlueprintResult>("/api/v1/partner/demo/blueprint", {
        prospectName: brief.prospectName.trim(),
        industry: brief.industry.trim(),
        goals: brief.goals.trim() || undefined,
        scale: brief.scale.trim() || undefined,
        channels: brief.channels.trim() || undefined,
        language: brief.language.trim() || "en",
      });
      setBlueprint(result);
      setBlueprintJson(JSON.stringify(result.blueprint, null, 2));
      if (!demoName.trim()) {
        setDemoName(`${brief.prospectName.trim()} Demo`);
      }
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to generate demo blueprint");
    } finally {
      setBusy(null);
    }
  }

  async function createBlueprintDemo() {
    if (!blueprintJson.trim()) return;
    setBusy("create-blueprint");
    setErr(null);
    try {
      const parsed = JSON.parse(blueprintJson) as DemoSeedPlan;
      const result = await api.post<DemoCreateResult>(
        "/api/v1/partner/demo/create-with-blueprint",
        {
          demoName: demoName.trim() || `${brief.prospectName.trim() || "Prospect"} Demo`,
          expiryDays: 30,
          blueprint: parsed,
        },
      );
      setCreated(result);
      setDemoName("");
      setBlueprint(null);
      setBlueprintJson("");
      await load();
    } catch (e) {
      if (e instanceof SyntaxError) {
        setErr("Blueprint JSON is invalid. Fix the JSON before creating the demo.");
      } else {
        setErr(e instanceof ApiClientError ? e.message : "Failed to create blueprint demo");
      }
    } finally {
      setBusy(null);
    }
  }

  async function recommend(id: string) {
    setBusy(id);
    setErr(null);
    try {
      const rec = await api.post<DemoRecommendation>(
        `/api/v1/partner/demo/${id}/recommend-conversion`,
        { useAi: true },
      );
      setRecommendations((prev) => ({ ...prev, [id]: rec }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to recommend follow-up");
    } finally {
      setBusy(null);
    }
  }

  async function renew(id: string) {
    setBusy(`renew:${id}`);
    setErr(null);
    try {
      await api.post(`/api/v1/partner/demo/${id}/renew`, { expiryDays: 30 });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to renew demo");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this demo workspace? This cannot be undone.")) return;
    setBusy(`delete:${id}`);
    setErr(null);
    try {
      await api.delete(`/api/v1/partner/demo/${id}`);
      setRecommendations((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to delete demo");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-center text-sm text-slate-500">Loading demos...</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <div className="mb-8 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-300">Automation-first</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Demo-to-Paid Engine</h1>
          <p className="mt-1 text-sm text-slate-400">
            Track sandbox activity, score conversion readiness, and generate the next partner follow-up.
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <input
            value={demoName}
            onChange={(e) => setDemoName(e.target.value)}
            placeholder="Prospect workspace name"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 sm:w-72"
          />
          <button
            onClick={createDemo}
            disabled={busy === "create" || !demoName.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-500 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Create
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-violet-500/20 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/40 p-5 shadow-xl shadow-slate-950/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-200">
              <Sparkles className="h-3.5 w-3.5" />
              AI Demo Builder
            </div>
            <h2 className="mt-3 text-lg font-black tracking-tight text-white">
              Generate a tailored demo workspace from a prospect brief
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Build contacts, templates, a starter campaign, lead example, and AI agent persona before creating the sandbox.
            </p>
          </div>
          {blueprint && (
            <span className="w-fit rounded-full border border-slate-700 bg-slate-950/50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Source: {blueprint.source}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.85fr_1.15fr]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-300">
              Prospect name
              <input
                value={brief.prospectName}
                onChange={(e) => setBrief((prev) => ({ ...prev, prospectName: e.target.value }))}
                placeholder="Cutz & Bangs"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="text-xs font-semibold text-slate-300">
              Industry
              <input
                value={brief.industry}
                onChange={(e) => setBrief((prev) => ({ ...prev, industry: e.target.value }))}
                placeholder="salon, clinic, real estate"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="text-xs font-semibold text-slate-300 sm:col-span-2">
              Goals
              <textarea
                value={brief.goals}
                onChange={(e) => setBrief((prev) => ({ ...prev, goals: e.target.value }))}
                placeholder="Book appointments, recover missed leads, send reminders..."
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="text-xs font-semibold text-slate-300">
              Scale
              <input
                value={brief.scale}
                onChange={(e) => setBrief((prev) => ({ ...prev, scale: e.target.value }))}
                placeholder="2 branches, 5 agents"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <label className="text-xs font-semibold text-slate-300">
              Channels
              <input
                value={brief.channels}
                onChange={(e) => setBrief((prev) => ({ ...prev, channels: e.target.value }))}
                placeholder="WhatsApp, Instagram"
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
              />
            </label>
            <button
              onClick={generateBlueprint}
              disabled={busy === "blueprint" || !brief.prospectName.trim() || !brief.industry.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500 disabled:opacity-50 sm:col-span-2"
            >
              <Sparkles className="h-4 w-4" />
              {busy === "blueprint" ? "Generating..." : "Generate blueprint"}
            </button>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
            {blueprint ? (
              <div className="space-y-4">
                <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                  <div>
                    <h3 className="text-sm font-bold text-white">
                      {blueprint.blueprint.campaignName ?? "Demo blueprint"}
                    </h3>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      {blueprint.rationale ?? "Review the generated plan, edit JSON if needed, then create the sandbox."}
                    </p>
                  </div>
                  <button
                    onClick={createBlueprintDemo}
                    disabled={busy === "create-blueprint" || !blueprintJson.trim()}
                    className="inline-flex w-fit items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    {busy === "create-blueprint" ? "Creating..." : "Create from blueprint"}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <BlueprintMetric
                    label="Contacts"
                    value={blueprint.blueprint.contacts?.length ?? 0}
                  />
                  <BlueprintMetric
                    label="Templates"
                    value={blueprint.blueprint.templates?.length ?? 0}
                  />
                  <BlueprintMetric
                    label="Lead value"
                    value={blueprint.blueprint.leadValue ?? 0}
                  />
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    {(blueprint.blueprint.templates ?? []).slice(0, 3).map((template) => (
                      <div key={template.name} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                        <div className="text-xs font-bold text-white">{template.name}</div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{template.bodyText}</p>
                      </div>
                    ))}
                  </div>
                  <textarea
                    value={blueprintJson}
                    onChange={(e) => setBlueprintJson(e.target.value)}
                    spellCheck={false}
                    rows={9}
                    className="min-h-56 w-full resize-y rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-80 items-center justify-center rounded-lg border border-dashed border-slate-800 p-6 text-center">
                <div>
                  <Sparkles className="mx-auto h-8 w-8 text-violet-300" />
                  <h3 className="mt-3 text-sm font-bold text-white">Blueprint preview appears here</h3>
                  <p className="mt-1 max-w-md text-xs leading-5 text-slate-400">
                    Generate a prospect-specific demo before provisioning, or use the quick create box above for the default seed.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {err && (
        <div className="mb-5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {err}
        </div>
      )}

      {created && (
        <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-sm text-emerald-100">
          <div className="mb-2 font-semibold">Demo created. Save these one-time credentials.</div>
          <div className="grid gap-2 md:grid-cols-3">
            <Copyable label="URL" value={created.demoUrl} />
            <Copyable label="Email" value={created.credentials.email} />
            <Copyable label="Password" value={created.credentials.password} />
          </div>
        </div>
      )}

      <div className="grid gap-5">
        {demos.map((demo) => {
          const rec = recommendations[demo.id];
          const daysLeft = Math.ceil((new Date(demo.expiresAt).getTime() - Date.now()) / 86_400_000);
          return (
            <div key={demo.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-xl shadow-slate-950/20">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-bold text-white">{demo.tenant.name}</h2>
                    <span className={daysLeft < 0 ? "rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-300" : "rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300"}>
                      {daysLeft < 0 ? "Expired" : `${daysLeft} days left`}
                    </span>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">
                      {demo.tenant.status}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                    <span>{demo.tenant._count.users} user(s)</span>
                    <span>{demo.tenant._count.contacts} contact(s)</span>
                    <span>Renewed {demo.renewalCount}/2</span>
                    <span>Created {new Date(demo.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => recommend(demo.id)}
                    disabled={busy === demo.id}
                    className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    Score
                  </button>
                  <button
                    onClick={() => renew(demo.id)}
                    disabled={busy === `renew:${demo.id}` || demo.renewalCount >= 2}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Renew
                  </button>
                  <button
                    onClick={() => remove(demo.id)}
                    disabled={busy === `delete:${demo.id}`}
                    className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>

              {rec && (
                <div className="mt-5 grid gap-4 border-t border-slate-800 pt-5 lg:grid-cols-[220px_1fr]">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Conversion score</div>
                    <div className="mt-2 text-4xl font-black text-white">{rec.score}</div>
                    <div className="mt-1 text-sm font-semibold text-indigo-300">{rec.stage.replace("_", " ")}</div>
                    <div className="mt-4 h-2 rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${rec.score}%` }} />
                    </div>
                    <div className="mt-3 text-xs text-slate-400">
                      {rec.signals.messages} messages, {rec.signals.campaigns} campaigns, {rec.signals.inboundMessages} inbound.
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-xs font-semibold text-indigo-300">
                        {rec.recommendedAction.replaceAll("_", " ")}
                      </span>
                      {rec.aiUsed ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-300">AI polished</span>
                      ) : (
                        <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-300">rules-based</span>
                      )}
                    </div>
                    <h3 className="mt-3 text-base font-bold text-white">{rec.subject}</h3>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-300">{rec.message}</p>
                    <p className="mt-3 text-xs leading-5 text-slate-500">{rec.reasoning}</p>
                    {rec.aiFallbackReason && (
                      <p className="mt-2 text-xs text-amber-300">AI fallback: {rec.aiFallbackReason}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {demos.length === 0 && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-10 text-center text-sm text-slate-400">
            No demo workspaces yet. Create one for a prospect above.
          </div>
        )}
      </div>
    </PartnerShell>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(value)}
      className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-950/30 px-3 py-2 text-left"
    >
      <span className="min-w-0">
        <span className="block text-[10px] uppercase tracking-wider text-emerald-300/70">{label}</span>
        <span className="block truncate font-mono text-xs text-emerald-50">{value}</span>
      </span>
      <Copy className="h-4 w-4 shrink-0 text-emerald-300" />
    </button>
  );
}

function BlueprintMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-black text-white">
        {value.toLocaleString()}
      </div>
    </div>
  );
}
