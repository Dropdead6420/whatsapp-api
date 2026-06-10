"use client";

// AdGrowly — CMS Manager (planning PDF §4). SUPER_ADMIN-curated site content
// (pages, blogs, FAQs, testimonials, legal, SEO meta). Backed by module 7:
// /api/v1/admin/cms. Public surface reads published rows at /api/v1/public/cms.

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

const TYPES = ["PAGE", "BLOG", "FAQ", "TESTIMONIAL", "LEGAL", "SEO_META"] as const;
const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

interface Content {
  id: string;
  type: string;
  slug: string;
  locale: string;
  title: string;
  excerpt: string | null;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  sortOrder: number;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-200",
  PUBLISHED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ARCHIVED: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function CmsPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [items, setItems] = useState<Content[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [type, setType] = useState<string>("PAGE");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState("en");
  const [excerpt, setExcerpt] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [sortOrder, setSortOrder] = useState("0");

  async function refresh() {
    try {
      setErr(null);
      const q = typeFilter ? `?type=${typeFilter}` : "";
      setItems(await api.get<Content[]>(`/api/v1/admin/cms${q}`));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load content (Super Admin only).");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user, typeFilter]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/cms", {
        type,
        title: title.trim(),
        slug: slug.trim() || undefined,
        locale: locale.trim() || undefined,
        excerpt: excerpt.trim() || undefined,
        body: bodyText.trim() || undefined,
        sortOrder: Number(sortOrder) || 0,
      });
      setTitle("");
      setSlug("");
      setExcerpt("");
      setBodyText("");
      setNotice("Content created (draft).");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to create content.");
    }
  }

  async function setStatus(id: string, status: string) {
    try {
      await api.patch(`/api/v1/admin/cms/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to update status.");
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this content?")) return;
    try {
      await api.delete(`/api/v1/admin/cms/${id}`);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to delete.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Super Admin</p>
        <h1 className="text-2xl font-semibold text-slate-950">CMS Manager</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Manage landing/pricing pages, blogs, FAQs, testimonials, legal pages and SEO meta. Published content is served on the public site.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      <div className="grid gap-6 lg:grid-cols-[340px,1fr]">
        <form onSubmit={create} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">New content</h2>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Type
            <select value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={240} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-slate-700">
              Slug (optional)
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="auto from title" className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Locale
              <input value={locale} onChange={(e) => setLocale(e.target.value)} maxLength={10} className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
          </div>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Excerpt
            <input value={excerpt} onChange={(e) => setExcerpt(e.target.value)} maxLength={1000} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Body
            <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={4} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Sort order
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Create draft</button>
        </form>

        <div>
          <div className="mb-3 flex items-center gap-2">
            <label className="text-sm font-medium text-slate-700">Filter type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
              <option value="">All</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            {items.length === 0 && <p className="text-sm text-slate-500">No content yet.</p>}
            {items.map((c) => (
              <div key={c.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{c.title}</span>
                    <span className="ml-2 text-xs text-slate-400">{c.type} · /{c.slug} · {c.locale}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[c.status]}`}>{c.status}</span>
                    <button onClick={() => void remove(c.id)} className="text-xs text-slate-400 hover:text-red-600">Delete</button>
                  </div>
                </div>
                {c.excerpt && <p className="mt-1 text-sm text-slate-500">{c.excerpt}</p>}
                <div className="mt-3 flex gap-2">
                  {c.status !== "PUBLISHED" && (
                    <button onClick={() => void setStatus(c.id, "PUBLISHED")} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Publish</button>
                  )}
                  {c.status === "PUBLISHED" && (
                    <button onClick={() => void setStatus(c.id, "DRAFT")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Unpublish</button>
                  )}
                  {c.status !== "ARCHIVED" && (
                    <button onClick={() => void setStatus(c.id, "ARCHIVED")} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Archive</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
