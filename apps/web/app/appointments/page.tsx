"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type Status = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

interface Appointment {
  id: string;
  scheduledAt: string;
  durationMinutes: number;
  status: Status;
  notes: string | null;
  source: string;
  confirmationSentAt: string | null;
  reminderSentAt: string | null;
  postVisitSentAt: string | null;
  contact: { id: string; name: string; phoneNumber: string };
  service: { id: string; name: string; priceInPaisa: number };
}

const STATUS_STYLES: Record<Status, string> = {
  PENDING: "bg-amber-50 text-amber-800",
  CONFIRMED: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-600",
  COMPLETED: "bg-blue-50 text-blue-700",
  NO_SHOW: "bg-red-50 text-red-700",
};

const STATUS_LABELS: Record<Status, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  NO_SHOW: "No show",
};

function formatDateTime(d: string): string {
  return new Date(d).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function groupByDate(items: Appointment[]): Array<[string, Appointment[]]> {
  const groups = new Map<string, Appointment[]>();
  for (const a of items) {
    const key = new Date(a.scheduledAt).toDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  return [...groups.entries()];
}

export default function AppointmentsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"],
  });
  const [items, setItems] = useState<Appointment[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"upcoming" | "today" | "all">("upcoming");

  async function refresh() {
    try {
      let qs = "?limit=100";
      const now = new Date();
      if (filter === "upcoming") {
        qs += `&from=${now.toISOString()}`;
      } else if (filter === "today") {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        const end = new Date(now);
        end.setHours(23, 59, 59, 999);
        qs += `&from=${start.toISOString()}&to=${end.toISOString()}`;
      }
      const data = await api.get<Appointment[]>(`/api/v1/appointments${qs}`);
      setItems(data);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Load failed");
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user, filter]);

  async function setStatus(id: string, status: Status) {
    try {
      await api.patch(`/api/v1/appointments/${id}`, { status });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  const grouped = groupByDate(items);

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Appointments</h1>
          <p className="text-sm text-slate-500">
            All bookings from your public page and admin creations.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-slate-200 bg-white text-xs">
          {(["upcoming", "today", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 ${
                filter === f
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f === "upcoming" ? "Upcoming" : f === "today" ? "Today" : "All"}
            </button>
          ))}
        </div>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {grouped.length === 0 && !err && (
        <div className="rounded-lg border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
          No appointments in this view. Share your public booking link from the{" "}
          <a className="text-emerald-700 hover:underline" href="/services">
            Services
          </a>{" "}
          page.
        </div>
      )}

      <div className="space-y-6">
        {grouped.map(([day, apps]) => (
          <section key={day}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
              {day}
            </h2>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2">Time</th>
                    <th className="px-4 py-2">Customer</th>
                    <th className="px-4 py-2">Service</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Reminder</th>
                    <th className="px-4 py-2">Post-visit</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {apps.map((a) => (
                    <tr key={a.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {new Date(a.scheduledAt).toLocaleTimeString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {a.durationMinutes} min
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{a.contact.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {a.contact.phoneNumber}
                        </div>
                      </td>
                      <td className="px-4 py-3">{a.service.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLES[a.status]}`}
                        >
                          {STATUS_LABELS[a.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {a.reminderSentAt
                          ? `sent ${new Date(a.reminderSentAt).toLocaleTimeString()}`
                          : a.status === "CONFIRMED"
                            ? "auto-sent 24h before"
                            : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {a.postVisitSentAt
                          ? `sent ${new Date(a.postVisitSentAt).toLocaleTimeString()}`
                          : a.status === "COMPLETED"
                            ? "queued"
                            : a.status === "CONFIRMED"
                              ? "after visit"
                              : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {user.role !== "AGENT" && (
                          <div className="flex justify-end gap-1">
                            {a.status === "PENDING" && (
                              <button
                                onClick={() => setStatus(a.id, "CONFIRMED")}
                                className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-700"
                              >
                                Confirm
                              </button>
                            )}
                            {(a.status === "PENDING" ||
                              a.status === "CONFIRMED") && (
                              <button
                                onClick={() => setStatus(a.id, "CANCELLED")}
                                className="rounded-md border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            )}
                            {a.status === "CONFIRMED" && (
                              <button
                                onClick={() => setStatus(a.id, "COMPLETED")}
                                className="rounded-md border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50"
                              >
                                Done
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </DashboardShell>
  );
}
