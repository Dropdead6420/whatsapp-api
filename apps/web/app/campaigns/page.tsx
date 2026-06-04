"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useI18n } from "../../src/i18n/I18nProvider";

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
  const { t } = useI18n();
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
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : t("campaigns.loadFailed")));
  }, [user]);

  async function send(id: string) {
    if (!confirm(t("campaigns.confirmSend"))) return;
    try {
      await api.post(`/api/v1/campaigns/${id}/send`);
      const fresh = await api.get<Campaign[]>("/api/v1/campaigns");
      setCampaigns(fresh);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("campaigns.sendFailed"));
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">{t("campaigns.title")}</h1>
        <p className="text-sm text-slate-500">{t("campaigns.subtitle")}</p>
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
              <th className="px-4 py-3">{t("campaigns.colName")}</th>
              <th className="px-4 py-3">{t("campaigns.colTemplate")}</th>
              <th className="px-4 py-3">{t("campaigns.colStatus")}</th>
              <th className="px-4 py-3 text-right">{t("campaigns.colSentTotal")}</th>
              <th className="px-4 py-3 text-right">{t("campaigns.colDelivered")}</th>
              <th className="px-4 py-3 text-right">{t("campaigns.colRead")}</th>
              <th className="px-4 py-3">{t("campaigns.colCreated")}</th>
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
                      {t("campaigns.sendNow")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && !err && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                  {t("campaigns.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
