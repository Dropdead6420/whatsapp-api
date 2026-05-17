"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "facebook_ad", label: "Facebook Ad" },
  { value: "google_ad", label: "Google Search Ad" },
  { value: "instagram_caption", label: "Instagram Caption" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
] as const;

const TONES = [
  { value: "professional", label: "Professional" },
  { value: "friendly", label: "Friendly" },
  { value: "casual", label: "Casual" },
  { value: "urgent", label: "Urgent" },
  { value: "playful", label: "Playful" },
] as const;

interface Variant {
  id: string;
  text: string;
}

export default function AiStudioPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [prompt, setPrompt] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]["value"]>("whatsapp");
  const [tone, setTone] = useState<(typeof TONES)[number]["value"]>("friendly");
  const [audience, setAudience] = useState("");
  const [variants, setVariants] = useState<Variant[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const data = await api.post<{ variants: Variant[] }>("/api/v1/ai/copy", {
        prompt,
        channel,
        tone,
        audienceDescription: audience || undefined,
        variantCount: 3,
      });
      setVariants(data.variants);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">AI Creative Studio</h1>
        <p className="mt-1 text-sm text-slate-500">
          Describe what you want to say. Claude writes the copy in your tone.
        </p>
      </header>

      <form
        onSubmit={generate}
        className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-3"
      >
        <div className="md:col-span-3">
          <label className="block text-sm font-medium text-slate-700">
            What's the message?
          </label>
          <textarea
            required
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Promote our weekend salon sale: 20% off all hair services, valid Sat-Sun only."
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Channel</label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as typeof channel)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {CHANNELS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">Tone</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value as typeof tone)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {TONES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Audience (optional)
          </label>
          <input
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. young professionals, Dwarka"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="md:col-span-3 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {busy ? "Generating…" : "Generate 3 variants"}
          </button>
        </div>
      </form>

      {err && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {variants.length > 0 && (
        <section className="mt-6 space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
            Variants
          </h2>
          {variants.map((v, i) => (
            <div
              key={v.id}
              className="rounded-lg border border-slate-200 bg-white p-4 text-sm"
            >
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-emerald-700">
                Variant {i + 1}
              </div>
              <p className="whitespace-pre-wrap">{v.text}</p>
              <button
                onClick={() => navigator.clipboard.writeText(v.text)}
                className="mt-3 rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
              >
                Copy
              </button>
            </div>
          ))}
        </section>
      )}
    </DashboardShell>
  );
}
