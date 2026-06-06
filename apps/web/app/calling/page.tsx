"use client";

// Calling (Complete Planning PDF §2.21). Virtual-number registry + call log
// with AI summaries. Live placement/transcription via a telephony provider
// is a follow-up; this surfaces logging + numbers.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface CallLog {
  id: string;
  direction: string;
  status: string;
  fromNumber: string;
  toNumber: string;
  durationLabel: string;
  aiSummary: string | null;
  startedAt: string | null;
}

interface VirtualNumber {
  id: string;
  phoneNumber: string;
  label: string | null;
  capabilities: string[];
  status: string;
}

export default function CallingPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [numbers, setNumbers] = useState<VirtualNumber[]>([]);
  const [phone, setPhone] = useState("");
  const [numLabel, setNumLabel] = useState("");
  const [direction, setDirection] = useState("OUTBOUND");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [duration, setDuration] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setCalls(await api.get<CallLog[]>("/api/v1/calling/calls"));
      setNumbers(await api.get<VirtualNumber[]>("/api/v1/calling/numbers"));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load calling data.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function addNumber(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/calling/numbers", { phoneNumber: phone.trim(), label: numLabel.trim() || undefined });
      setPhone("");
      setNumLabel("");
      setNotice("Number added.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to add number.");
    }
  }

  async function logCall(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/calling/calls", {
        direction,
        fromNumber: from.trim(),
        toNumber: to.trim(),
        durationSeconds: duration,
      });
      setFrom("");
      setTo("");
      setDuration(0);
      setNotice("Call logged.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to log call.");
    }
  }

  async function releaseNumber(id: string) {
    try {
      await api.post(`/api/v1/calling/numbers/${id}/release`, {});
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to release number.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Calling</p>
        <h1 className="text-2xl font-semibold text-slate-950">Calls &amp; numbers</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Manage your virtual numbers and review call history with AI summaries.
        </p>
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>
      )}

      <section className="mb-6 rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Virtual numbers</h2>
        <form onSubmit={addNumber} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">
            Number (E.164)
            <input value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="+14155552671" className="mt-1 block w-48 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Label
            <input value={numLabel} onChange={(e) => setNumLabel(e.target.value)} className="mt-1 block w-44 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Add</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {numbers.length === 0 ? (
            <li className="py-3 text-sm text-slate-500">No numbers yet.</li>
          ) : numbers.map((n) => (
            <li key={n.id} className="flex items-center justify-between py-2 text-sm">
              <span className="font-mono text-slate-800">{n.phoneNumber}{n.label ? ` · ${n.label}` : ""}</span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${n.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{n.status}</span>
                {n.status === "ACTIVE" && (
                  <button onClick={() => void releaseNumber(n.id)} className="rounded-md border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Release</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Call log</h2>
        <form onSubmit={logCall} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium text-slate-700">
            Direction
            <select value={direction} onChange={(e) => setDirection(e.target.value)} className="mt-1 block rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="OUTBOUND">OUTBOUND</option>
              <option value="INBOUND">INBOUND</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            From
            <input value={from} onChange={(e) => setFrom(e.target.value)} required className="mt-1 block w-40 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            To
            <input value={to} onChange={(e) => setTo(e.target.value)} required className="mt-1 block w-40 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Duration (s)
            <input type="number" min={0} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1 block w-24 rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Log call</button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">When</th>
                <th className="px-3 py-2 font-semibold">Direction</th>
                <th className="px-3 py-2 font-semibold">Parties</th>
                <th className="px-3 py-2 font-semibold">Duration</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {calls.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No calls logged yet.</td></tr>
              ) : calls.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 text-slate-600">{c.startedAt ? new Date(c.startedAt).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2 text-slate-700">{c.direction}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{c.fromNumber} → {c.toNumber}</td>
                  <td className="px-3 py-2 text-slate-600">{c.durationLabel}</td>
                  <td className="px-3 py-2 text-slate-600">{c.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </DashboardShell>
  );
}
