"use client";

// AdGrowly — Reputation (planning PDF §2/§3). View Google reviews, generate an
// AI reply draft (generate-then-approve) and send it. Backed by module 2:
// /api/v1/gmb/reviews (+ /summary, /:id/draft-reply, /:id/reply).

import { FormEvent, useEffect, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

interface Review {
  id: string;
  authorName: string | null;
  rating: number;
  comment: string | null;
  status: "NEW" | "REPLIED" | "FLAGGED";
  replyText: string | null;
}

interface Summary {
  count: number;
  average: number;
  unanswered: number;
  distribution: Record<string, number>;
}

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-amber-50 text-amber-700 border-amber-200",
  REPLIED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  FLAGGED: "bg-slate-100 text-slate-600 border-slate-200",
};

function Stars({ n }: { n: number }) {
  return <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(Math.max(0, 5 - n))}</span>;
}

export default function GmbReputationPage() {
  const { user, features, loading, signOut } = useAuth({ required: true });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // compact "log a review" form (no live Google sync yet)
  const [locationId, setLocationId] = useState("");
  const [rating, setRating] = useState(5);
  const [author, setAuthor] = useState("");
  const [comment, setComment] = useState("");

  async function refresh() {
    try {
      setErr(null);
      const [list, sum] = await Promise.all([
        api.get<Review[]>("/api/v1/gmb/reviews"),
        api.get<Summary>("/api/v1/gmb/reviews/summary"),
      ]);
      setReviews(list);
      setSummary(sum);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to load reviews.");
    }
  }

  useEffect(() => {
    if (user) void refresh();
  }, [user]);

  async function addReview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/gmb/reviews", {
        locationId: locationId.trim(),
        rating,
        authorName: author.trim() || undefined,
        comment: comment.trim() || undefined,
      });
      setAuthor("");
      setComment("");
      setNotice("Review logged.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to log review.");
    }
  }

  async function draft(id: string) {
    setErr(null);
    try {
      const res = await api.post<{ reply: string }>(`/api/v1/gmb/reviews/${id}/draft-reply`, {});
      setDrafts((d) => ({ ...d, [id]: res.reply }));
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to draft a reply.");
    }
  }

  async function send(id: string) {
    const text = (drafts[id] ?? "").trim();
    if (!text) return;
    setErr(null);
    try {
      await api.post(`/api/v1/gmb/reviews/${id}/reply`, { text });
      setDrafts((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
      setNotice("Reply sent.");
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Unable to send reply.");
    }
  }

  if (loading || !user) {
    return <div className="p-8 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6">
        <p className="text-sm font-medium text-emerald-700">Google Business</p>
        <h1 className="text-2xl font-semibold text-slate-950">Reputation</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Read reviews, generate an AI reply draft, edit it and send. Replies are always reviewed before sending.
        </p>
      </div>

      {err && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}
      {notice && <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Reviews</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.count}</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Average rating</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.average}★</p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Awaiting reply</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{summary.unanswered}</p>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px,1fr]">
        <form onSubmit={addReview} className="h-fit rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold text-slate-950">Log a review</h2>
          <p className="mt-1 text-xs text-slate-500">Until live Google sync is connected, add reviews manually.</p>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Location ID
            <input value={locationId} onChange={(e) => setLocationId(e.target.value)} required className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Rating
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
              {[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} star{r > 1 ? "s" : ""}</option>)}
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Author
            <input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={160} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Comment
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <button type="submit" className="mt-4 w-full rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700">Log review</button>
        </form>

        <div className="space-y-3">
          {reviews.length === 0 && <p className="text-sm text-slate-500">No reviews yet.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-sm">
                  <Stars n={r.rating} /> <span className="font-medium text-slate-800">{r.authorName ?? "Anonymous"}</span>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{r.status}</span>
              </div>
              {r.comment && <p className="mt-2 text-sm text-slate-600">{r.comment}</p>}

              {r.status === "REPLIED" && r.replyText ? (
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-700">Reply:</span> {r.replyText}
                </div>
              ) : (
                <div className="mt-3">
                  {drafts[r.id] === undefined ? (
                    <button onClick={() => void draft(r.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      Draft AI reply
                    </button>
                  ) : (
                    <div>
                      <textarea
                        value={drafts[r.id]}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        rows={3}
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => void send(r.id)} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700">Send reply</button>
                        <button onClick={() => void draft(r.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Regenerate</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </DashboardShell>
  );
}
