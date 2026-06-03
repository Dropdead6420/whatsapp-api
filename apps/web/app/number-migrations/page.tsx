"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError } from "../../src/lib/api";

type MigrationStatus =
  | "PENDING_ELIGIBILITY"
  | "ELIGIBLE"
  | "NOT_ELIGIBLE"
  | "OTP_REQUESTED"
  | "OTP_VERIFIED"
  | "MIGRATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

interface TenantOption {
  id: string;
  name: string;
}

interface StatusMeta {
  status: MigrationStatus;
  live: boolean;
  cancellable: boolean;
  nextActionLabel: string | null;
  allowedNextStatuses: MigrationStatus[];
}

interface NumberMigration {
  id: string;
  tenantId: string;
  tenant: TenantOption;
  phoneNumber: string;
  targetWabaId: string | null;
  status: MigrationStatus;
  statusReason: string | null;
  eligibilityCheckedAt: string | null;
  otpRequestedAt: string | null;
  otpVerifiedAt: string | null;
  releasedAt: string | null;
  webhookUpdatedAt: string | null;
  templatesSyncedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResult {
  items: NumberMigration[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const STATUS_LABEL: Record<MigrationStatus, string> = {
  PENDING_ELIGIBILITY: "Pending eligibility",
  ELIGIBLE: "Eligible",
  NOT_ELIGIBLE: "Not eligible",
  OTP_REQUESTED: "OTP requested",
  OTP_VERIFIED: "OTP verified",
  MIGRATING: "Migrating",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

const STATUS_CLASS: Record<MigrationStatus, string> = {
  PENDING_ELIGIBILITY: "border-slate-200 bg-slate-100 text-slate-700",
  ELIGIBLE: "border-blue-200 bg-blue-50 text-blue-700",
  NOT_ELIGIBLE: "border-amber-200 bg-amber-50 text-amber-700",
  OTP_REQUESTED: "border-purple-200 bg-purple-50 text-purple-700",
  OTP_VERIFIED: "border-indigo-200 bg-indigo-50 text-indigo-700",
  MIGRATING: "border-orange-200 bg-orange-50 text-orange-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  FAILED: "border-red-200 bg-red-50 text-red-700",
  CANCELLED: "border-slate-200 bg-slate-50 text-slate-500",
};

const STEP_ORDER: MigrationStatus[] = [
  "PENDING_ELIGIBILITY",
  "ELIGIBLE",
  "OTP_REQUESTED",
  "OTP_VERIFIED",
  "MIGRATING",
  "COMPLETED",
];

function fmt(iso: string | null): string {
  if (!iso) return "not yet";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: MigrationStatus) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_CLASS[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function nextForwardStatus(meta?: StatusMeta): MigrationStatus | null {
  if (!meta) return null;
  return (
    meta.allowedNextStatuses.find(
      (status) => status !== "FAILED" && status !== "CANCELLED",
    ) ?? null
  );
}

export default function NumberMigrationsPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [items, setItems] = useState<NumberMigration[]>([]);
  const [statuses, setStatuses] = useState<StatusMeta[]>([]);
  const [formTenantId, setFormTenantId] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | MigrationStatus>("ALL");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [targetWabaId, setTargetWabaId] = useState("");
  const [busy, setBusy] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusByKey = useMemo(() => {
    return Object.fromEntries(statuses.map((item) => [item.status, item])) as Record<
      MigrationStatus,
      StatusMeta
    >;
  }, [statuses]);

  const loadTenants = useCallback(async () => {
    const rows = await api.get<TenantOption[]>("/api/v1/tenants?limit=100");
    setTenants(rows);
    setFormTenantId((current) => current || rows[0]?.id || "");
  }, []);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (tenantFilter) params.set("tenantId", tenantFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const [list, statusList] = await Promise.all([
        api.get<ListResult>(`/api/v1/admin/number-migrations?${params.toString()}`),
        api.get<StatusMeta[]>("/api/v1/admin/number-migrations/statuses"),
      ]);
      setItems(list.items);
      setStatuses(statusList);
    } catch (e) {
      setErr(
        e instanceof ApiClientError
          ? e.message
          : "Failed to load number migrations.",
      );
    } finally {
      setBusy(false);
    }
  }, [tenantFilter, statusFilter]);

  useEffect(() => {
    if (user) void loadTenants();
  }, [user, loadTenants]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function createMigration(event: FormEvent) {
    event.preventDefault();
    if (!formTenantId) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post("/api/v1/admin/number-migrations", {
        tenantId: formTenantId,
        phoneNumber,
        targetWabaId: targetWabaId || null,
      });
      setPhoneNumber("");
      setTargetWabaId("");
      setNotice("Migration created. Start with the eligibility check.");
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiClientError ? e.message : "Failed to create migration.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function transition(
    migration: NumberMigration,
    status: MigrationStatus,
    reason?: string,
  ) {
    setMutatingId(migration.id);
    setErr(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/admin/number-migrations/${migration.id}/transition`, {
        status,
        reason: reason || null,
      });
      setNotice(`${migration.phoneNumber} moved to ${STATUS_LABEL[status]}.`);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to update status.");
    } finally {
      setMutatingId(null);
    }
  }

  async function resendOtp(migration: NumberMigration) {
    setMutatingId(migration.id);
    setErr(null);
    setNotice(null);
    try {
      await api.post(`/api/v1/admin/number-migrations/${migration.id}/resend-otp`, {
        reason: "Operator resent OTP",
      });
      setNotice(`OTP resend recorded for ${migration.phoneNumber}.`);
      await load();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to resend OTP.");
    } finally {
      setMutatingId(null);
    }
  }

  if (loading || !user) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="space-y-5">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="text-xl font-black text-slate-950">
                WhatsApp number migrations
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Track BSP cutover readiness, OTP verification, migration progress,
                webhook update, and template sync for customer WhatsApp numbers.
              </p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
              Manual control surface. Meta API adapters can attach to the same
              workflow later.
            </div>
          </div>

          <form
            onSubmit={createMigration}
            className="mt-5 grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]"
          >
            <label className="text-sm font-semibold text-slate-700">
              Tenant
              <select
                value={formTenantId}
                onChange={(event) => setFormTenantId(event.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-emerald-500"
              >
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Phone number
              <input
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+919876543210"
                className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
              />
            </label>
            <label className="text-sm font-semibold text-slate-700">
              Target WABA
              <input
                value={targetWabaId}
                onChange={(event) => setTargetWabaId(event.target.value)}
                placeholder="optional"
                className="mt-1 h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-emerald-500"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !formTenantId || !phoneNumber}
              className="mt-6 h-11 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300 md:mt-7"
            >
              Create
            </button>
          </form>
        </section>

        {(err || notice) && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm font-semibold ${
              err
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {err ?? notice}
          </div>
        )}

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-950">Migration queue</h2>
              <p className="text-sm text-slate-500">
                {busy ? "Refreshing..." : `${items.length} visible migration(s)`}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={tenantFilter}
                onChange={(event) => setTenantFilter(event.target.value)}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500"
              >
                <option value="">All tenants</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "ALL" | MigrationStatus)
                }
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500"
              >
                <option value="ALL">All statuses</option>
                {Object.keys(STATUS_LABEL).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status as MigrationStatus]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="divide-y divide-slate-100">
            {items.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-500">
                No migrations yet. Create one from the form above.
              </div>
            )}
            {items.map((migration) => {
              const meta = statusByKey[migration.status];
              const nextStatus = nextForwardStatus(meta);
              const currentStep = STEP_ORDER.indexOf(migration.status);
              return (
                <article key={migration.id} className="p-4">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-black text-slate-950">
                          {migration.phoneNumber}
                        </div>
                        {statusBadge(migration.status)}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">
                        {migration.tenant.name}
                        {migration.targetWabaId
                          ? ` → target WABA ${migration.targetWabaId}`
                          : " → no target WABA set"}
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-6">
                        {STEP_ORDER.map((step, index) => {
                          const done =
                            migration.status === "COMPLETED" ||
                            (currentStep >= 0 && index <= currentStep);
                          return (
                            <div
                              key={step}
                              className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${
                                done
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-400"
                              }`}
                            >
                              {STATUS_LABEL[step]}
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-3">
                        <div>Eligibility: {fmt(migration.eligibilityCheckedAt)}</div>
                        <div>OTP requested: {fmt(migration.otpRequestedAt)}</div>
                        <div>OTP verified: {fmt(migration.otpVerifiedAt)}</div>
                        <div>Released: {fmt(migration.releasedAt)}</div>
                        <div>Webhook: {fmt(migration.webhookUpdatedAt)}</div>
                        <div>Templates: {fmt(migration.templatesSyncedAt)}</div>
                      </div>

                      {migration.statusReason && (
                        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          {migration.statusReason}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 xl:w-72 xl:justify-end">
                      {nextStatus && (
                        <button
                          type="button"
                          disabled={mutatingId === migration.id}
                          onClick={() => transition(migration, nextStatus)}
                          className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-xs font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
                        >
                          {meta?.nextActionLabel ?? `Move to ${STATUS_LABEL[nextStatus]}`}
                        </button>
                      )}
                      {migration.status === "OTP_REQUESTED" && (
                        <button
                          type="button"
                          disabled={mutatingId === migration.id}
                          onClick={() => resendOtp(migration)}
                          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
                        >
                          Resend OTP
                        </button>
                      )}
                      {meta?.cancellable && (
                        <button
                          type="button"
                          disabled={mutatingId === migration.id}
                          onClick={() =>
                            transition(migration, "CANCELLED", "Cancelled by operator")
                          }
                          className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      )}
                      {meta?.cancellable && (
                        <button
                          type="button"
                          disabled={mutatingId === migration.id}
                          onClick={() =>
                            transition(
                              migration,
                              "FAILED",
                              "Marked failed by operator",
                            )
                          }
                          className="inline-flex h-9 items-center rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100"
                        >
                          Fail
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}
