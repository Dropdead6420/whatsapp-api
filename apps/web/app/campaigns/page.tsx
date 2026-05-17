"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface Campaign {
  id: string;
  name: string;
  status: string;
  type: string;
  totalContacts: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  createdAt: string;
  template: { id: string; name: string };
}

export default function CampaignsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<Campaign[]>("/api/v1/campaigns")
      .then(setCampaigns)
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : "Failed to load"));
  }, [user]);

  async function send(id: string) {
    if (!confirm("Dispatch this campaign now?")) return;
    try {
      await api.post(`/api/v1/campaigns/${id}/send`);
      const fresh = await api.get<Campaign[]>("/api/v1/campaigns");
      setCampaigns(fresh);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed");
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        <p className="text-sm text-slate-500">
          Schedule, dispatch, and track WhatsApp broadcasts.
        </p>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Sent / Total</th>
              <th className="px-4 py-3 text-right">Delivered</th>
              <th className="px-4 py-3 text-right">Read</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {campaigns.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-slate-600">{c.template.name}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  {c.sentCount} / {c.totalContacts}
                </td>
                <td className="px-4 py-3 text-right">{c.deliveredCount}</td>
                <td className="px-4 py-3 text-right">{c.readCount}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right">
                  {(c.status === "DRAFT" || c.status === "SCHEDULED") && (
                    <button
                      onClick={() => send(c.id)}
                      className="rounded-md border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50"
                    >
                      Send now
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && !err && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  No campaigns yet. Create a template first, then a campaign via API.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
