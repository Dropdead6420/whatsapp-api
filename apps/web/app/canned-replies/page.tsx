"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";
import { useAutoSave } from "../../src/hooks/useAutoSave";
import { useI18n } from "../../src/i18n/I18nProvider";

interface CannedReply {
  id: string;
  shortcut: string;
  title: string;
  body: string;
}

export default function CannedRepliesPage() {
  const { t } = useI18n();
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD"],
  });
  const [items, setItems] = useState<CannedReply[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const userScope = `${user?.tenantId ?? "anon"}:${user?.id ?? "anon"}`;
  const [form, setForm, formStatus, clearForm] = useAutoSave<{
    shortcut: string;
    title: string;
    body: string;
  }>(
    `canned-replies-form:${userScope}`,
    { shortcut: "/", title: "", body: "" },
    {
      isEmpty: (v) => {
        const f = v as { shortcut: string; title: string; body: string } | null;
        return !f || (f.shortcut === "/" && !f.title?.trim() && !f.body?.trim());
      },
    },
  );
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const data = await api.get<CannedReply[]>("/api/v1/canned-replies");
      setItems(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("cannedReplies.loadFailed"));
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.post("/api/v1/canned-replies", {
        shortcut: form.shortcut,
        title: form.title,
        body: form.body,
      });
      setShowForm(false);
      clearForm();
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("cannedReplies.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("cannedReplies.confirmDelete"))) return;
    try {
      await api.delete(`/api/v1/canned-replies/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : t("cannedReplies.deleteFailed"));
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">{t("common.loading")}</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{t("cannedReplies.title")}</h1>
          <p className="text-sm text-slate-500">
            {t("cannedReplies.descPre")}
            <code className="rounded bg-slate-100 px-1 text-xs">/shortcut</code>
            {t("cannedReplies.descPost")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showForm && formStatus !== "idle" && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                formStatus === "saving"
                  ? "bg-slate-100 text-slate-600"
                  : "bg-emerald-50 text-emerald-700"
              }`}
              title="Form auto-saved locally"
            >
              <span
                className={
                  formStatus === "saving"
                    ? "h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
                    : "h-1.5 w-1.5 rounded-full bg-emerald-500"
                }
              />
              {formStatus === "saving" ? t("cannedReplies.saving") : t("cannedReplies.saved")}
            </span>
          )}
          <button
            onClick={() => setShowForm((s) => !s)}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {showForm ? t("cannedReplies.cancel") : t("cannedReplies.newReply")}
          </button>
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-6 grid gap-3 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-3"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">
              {t("cannedReplies.colShortcut")}
            </label>
            <input
              required
              value={form.shortcut}
              onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))}
              placeholder={t("cannedReplies.phShortcut")}
              pattern="^/[a-z0-9_-]+$"
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">
              {t("cannedReplies.labelTitle")}
            </label>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder={t("cannedReplies.phTitle")}
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="md:col-span-1">
            <label className="block text-sm font-medium text-slate-700">&nbsp;</label>
            <button
              type="submit"
              disabled={busy}
              className="mt-1 w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {busy ? t("cannedReplies.saving") : t("cannedReplies.save")}
            </button>
          </div>
          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-slate-700">Body</label>
            <textarea
              required
              rows={3}
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              placeholder="We're open Mon–Sat, 10am–8pm. Closed Sundays."
              className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{t("cannedReplies.colShortcut")}</th>
              <th className="px-4 py-3">{t("cannedReplies.labelTitle")}</th>
              <th className="px-4 py-3">{t("cannedReplies.labelBody")}</th>
              <th className="px-4 py-3 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-mono text-xs">{r.shortcut}</td>
                <td className="px-4 py-3 font-medium">{r.title}</td>
                <td className="px-4 py-3 text-slate-600 line-clamp-2 max-w-md">
                  {r.body}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => remove(r.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {t("cannedReplies.delete")}
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && !err && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                  {t("cannedReplies.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}
