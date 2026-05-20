"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

interface ServiceHealth {
  name: string;
  status: "ok" | "error";
  latencyMs: number;
  detail?: string;
}

interface PlatformHealth {
  overall: "ok" | "degraded";
  checkedAt: string;
  services: ServiceHealth[];
}

interface QueueDepth {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

interface QueueHealth {
  checkedAt: string;
  queues: QueueDepth[];
}

interface FailedQueueJob {
  id: string;
  name: string;
  attemptsMade: number;
  attempts: number | null;
  failedReason: string | null;
  timestamp: string | null;
  processedOn: string | null;
  finishedOn: string | null;
  dataPreview: string;
  stacktrace: string[];
}

interface FailedJobsResponse {
  queue: string;
  checkedAt: string;
  jobs: FailedQueueJob[];
}

export default function PlatformHealthPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [queueHealth, setQueueHealth] = useState<QueueHealth | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [queueAction, setQueueAction] = useState<string | null>(null);
  const [failedJobs, setFailedJobs] = useState<FailedJobsResponse | null>(null);
  const [failedJobsLoading, setFailedJobsLoading] = useState(false);

  async function loadHealth() {
    setRefreshing(true);
    setErr(null);
    try {
      const [next, queues] = await Promise.all([
        api.get<PlatformHealth>("/api/v1/admin/health"),
        api.get<QueueHealth>("/api/v1/admin/queues"),
      ]);
      setHealth(next);
      setQueueHealth(queues);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load health");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    void loadHealth();
  }, [user]);

  async function cleanQueue(queue: QueueDepth, state: "failed" | "completed") {
    const count = state === "failed" ? queue.failed : queue.completed;
    if (count === 0) return;
    const confirmed = window.confirm(
      `Clean ${count} ${state} job${count === 1 ? "" : "s"} from ${formatQueueName(queue.name)}?`,
    );
    if (!confirmed) return;
    const key = `${queue.name}:${state}:clean`;
    setQueueAction(key);
    setErr(null);
    try {
      await api.post(`/api/v1/admin/queues/${queue.name}/clean`, {
        state,
        graceHours: 0,
        limit: Math.min(count, 5000),
      });
      await loadHealth();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : `Failed to clean ${state} jobs`);
    } finally {
      setQueueAction(null);
    }
  }

  async function retryFailed(queue: QueueDepth) {
    if (queue.failed === 0) return;
    const count = Math.min(queue.failed, 100);
    const confirmed = window.confirm(
      `Retry up to ${count} failed job${count === 1 ? "" : "s"} from ${formatQueueName(queue.name)}?`,
    );
    if (!confirmed) return;
    const key = `${queue.name}:failed:retry`;
    setQueueAction(key);
    setErr(null);
    try {
      await api.post(`/api/v1/admin/queues/${queue.name}/retry-failed`, { count });
      await loadHealth();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to retry queue jobs");
    } finally {
      setQueueAction(null);
    }
  }

  async function loadFailedJobs(queue: QueueDepth) {
    if (queue.failed === 0) return;
    setFailedJobsLoading(true);
    setErr(null);
    try {
      const next = await api.get<FailedJobsResponse>(
        `/api/v1/admin/queues/${queue.name}/failed?limit=25`,
      );
      setFailedJobs(next);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load failed jobs");
    } finally {
      setFailedJobsLoading(false);
    }
  }

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading...</div>;
  }

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Platform Health</h1>
          <p className="mt-1 text-sm text-slate-500">
            Live checks for the core services required to run NexaFlow.
          </p>
        </div>
        <button
          onClick={() => void loadHealth()}
          disabled={refreshing}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {refreshing ? "Checking..." : "Refresh"}
        </button>
      </header>

      {err && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {err}
        </div>
      )}

      <section className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Overall
          </div>
          <div
            className={`mt-2 text-2xl font-semibold ${
              health?.overall === "ok" ? "text-emerald-700" : "text-amber-700"
            }`}
          >
            {health?.overall ?? "-"}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Services
          </div>
          <div className="mt-2 text-2xl font-semibold">
            {health?.services.filter((service) => service.status === "ok").length ?? "-"}
            <span className="text-base text-slate-400">
              /{health?.services.length ?? "-"}
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Last Check
          </div>
          <div className="mt-2 text-sm font-medium text-slate-700">
            {health ? formatDateTime(health.checkedAt) : "-"}
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Service</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Latency</th>
              <th className="px-4 py-3">Detail</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {health?.services.map((service) => (
              <tr key={service.name}>
                <td className="px-4 py-3 font-medium capitalize">{service.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      service.status === "ok"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-red-50 text-red-700"
                    }`}
                  >
                    {service.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{service.latencyMs}ms</td>
                <td className="px-4 py-3 text-slate-500">{service.detail ?? "Healthy"}</td>
              </tr>
            ))}
            {!health && !err && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-slate-500">
                  Loading health checks.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Queue Health</h2>
            <p className="text-sm text-slate-500">
              BullMQ backlog across workers. Failed or delayed growth needs attention.
            </p>
          </div>
          <div className="text-xs text-slate-500">
            {queueHealth ? `Checked ${formatDateTime(queueHealth.checkedAt)}` : ""}
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Queue</th>
                <th className="px-4 py-3">Waiting</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Delayed</th>
                <th className="px-4 py-3">Failed</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Signal</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {queueHealth?.queues.map((queue) => (
                <tr key={queue.name}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {formatQueueName(queue.name)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{queue.waiting}</td>
                  <td className="px-4 py-3 text-slate-600">{queue.active}</td>
                  <td className="px-4 py-3 text-slate-600">{queue.delayed}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        queue.failed > 0
                          ? "font-semibold text-red-700"
                          : "text-slate-600"
                      }
                    >
                      {queue.failed}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{queue.completed}</td>
                  <td className="px-4 py-3">
                    <QueueSignal queue={queue} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void loadFailedJobs(queue)}
                        disabled={queue.failed === 0 || failedJobsLoading}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {failedJobsLoading && failedJobs?.queue === queue.name
                          ? "Loading..."
                          : "View failed"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void retryFailed(queue)}
                        disabled={queue.failed === 0 || queueAction !== null}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {queueAction === `${queue.name}:failed:retry` ? "Retrying..." : "Retry failed"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void cleanQueue(queue, "failed")}
                        disabled={queue.failed === 0 || queueAction !== null}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {queueAction === `${queue.name}:failed:clean` ? "Cleaning..." : "Clean failed"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void cleanQueue(queue, "completed")}
                        disabled={queue.completed === 0 || queueAction !== null}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {queueAction === `${queue.name}:completed:clean`
                          ? "Cleaning..."
                          : "Clean completed"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!queueHealth && !err && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    Loading queue depth.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {failedJobs && (
        <section className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Failed Jobs: {formatQueueName(failedJobs.queue)}
              </h2>
              <p className="text-xs text-slate-500">
                Showing latest {failedJobs.jobs.length} failures. Checked {formatDateTime(failedJobs.checkedAt)}.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFailedJobs(null)}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
            >
              Close
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {failedJobs.jobs.map((job) => (
              <article key={job.id} className="p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-950">{job.name}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                        {job.id}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-red-700">
                      {job.failedReason ?? "No failure reason recorded."}
                    </p>
                  </div>
                  <div className="text-xs text-slate-500">
                    Attempts {job.attemptsMade}/{job.attempts ?? "-"}
                    {job.finishedOn ? ` · Finished ${formatDateTime(job.finishedOn)}` : ""}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Job Data
                    </div>
                    <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                      {job.dataPreview || "{}"}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                      Stack Trace
                    </div>
                    <pre className="max-h-52 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100">
                      {job.stacktrace.length > 0
                        ? job.stacktrace.join("\n\n")
                        : "No stack trace recorded."}
                    </pre>
                  </div>
                </div>
              </article>
            ))}
            {failedJobs.jobs.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                No failed jobs found for this queue.
              </div>
            )}
          </div>
        </section>
      )}
    </DashboardShell>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString();
}

function formatQueueName(value: string): string {
  return value
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function QueueSignal({ queue }: { queue: QueueDepth }) {
  const backlog = queue.waiting + queue.active + queue.delayed;
  const isBad = queue.failed > 0;
  const isBusy = backlog > 0;
  const label = isBad ? "Needs review" : isBusy ? "Processing" : "Clear";
  const className = isBad
    ? "bg-red-50 text-red-700"
    : isBusy
      ? "bg-amber-50 text-amber-700"
      : "bg-emerald-50 text-emerald-700";

  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
