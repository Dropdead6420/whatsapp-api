"use client";

// SuperAdmin language control (Final Currency/Language PDF §9).
// Backed by /api/v1/admin/languages. Lets operators manage launch
// languages, tenant defaults, and translation-job queue rows.

import { useEffect, useMemo, useState } from "react";
import { DashboardShell } from "../../src/components/DashboardShell";
import { useAuth } from "../../src/hooks/useAuth";
import { api, ApiClientError } from "../../src/lib/api";

type Direction = "LTR" | "RTL";
type SourceType =
  | "TEMPLATE"
  | "CAMPAIGN"
  | "CHATBOT_FLOW"
  | "LANDING_PAGE"
  | "INBOX_MESSAGE"
  | "KNOWLEDGE_BASE"
  | "PORTAL_KEY";

interface LanguageRow {
  code: string;
  name: string;
  nativeName: string;
  direction: Direction;
  isActive: boolean;
  isLaunchLanguage: boolean;
  displayOrder: number;
  updatedAt: string;
}

interface TranslationJobRow {
  id: string;
  tenantId: string;
  sourceType: SourceType;
  sourceId: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
  status: "PENDING" | "RUNNING" | "PREVIEW_READY" | "APPROVED" | "PUBLISHED" | "FAILED";
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TranslationJobsResponse {
  items: TranslationJobRow[];
  total: number;
  limit: number;
  offset: number;
}

interface LanguageForm {
  code: string;
  name: string;
  nativeName: string;
  direction: Direction;
  isActive: boolean;
  isLaunchLanguage: boolean;
  displayOrder: string;
}

interface TenantSettingForm {
  tenantId: string;
  languageCode: string;
  locale: string;
  allowAutoTranslate: boolean;
  requireApprovalForSensitive: boolean;
}

interface PartnerSettingForm {
  partnerTenantId: string;
  defaultLanguageCode: string;
  allowedLanguages: string;
  allowCustomerOverride: boolean;
}

interface JobForm {
  tenantId: string;
  sourceType: SourceType;
  sourceId: string;
  sourceLanguageCode: string;
  targetLanguageCode: string;
}

const EMPTY_LANGUAGE_FORM: LanguageForm = {
  code: "",
  name: "",
  nativeName: "",
  direction: "LTR",
  isActive: true,
  isLaunchLanguage: false,
  displayOrder: "100",
};

const EMPTY_TENANT_FORM: TenantSettingForm = {
  tenantId: "",
  languageCode: "en",
  locale: "en-IN",
  allowAutoTranslate: true,
  requireApprovalForSensitive: true,
};

const EMPTY_PARTNER_FORM: PartnerSettingForm = {
  partnerTenantId: "",
  defaultLanguageCode: "en",
  allowedLanguages: "en",
  allowCustomerOverride: true,
};

const EMPTY_JOB_FORM: JobForm = {
  tenantId: "",
  sourceType: "TEMPLATE",
  sourceId: "",
  sourceLanguageCode: "en",
  targetLanguageCode: "hi",
};

const SOURCE_TYPES: SourceType[] = [
  "TEMPLATE",
  "CAMPAIGN",
  "CHATBOT_FLOW",
  "LANDING_PAGE",
  "INBOX_MESSAGE",
  "KNOWLEDGE_BASE",
  "PORTAL_KEY",
];

export default function LanguagesPage() {
  const { user, features, loading, signOut } = useAuth({
    required: true,
    roles: ["SUPER_ADMIN"],
  });

  const [languages, setLanguages] = useState<LanguageRow[]>([]);
  const [jobs, setJobs] = useState<TranslationJobRow[]>([]);
  const [jobTotal, setJobTotal] = useState(0);
  const [activeOnly, setActiveOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [languageForm, setLanguageForm] = useState<LanguageForm>(EMPTY_LANGUAGE_FORM);
  const [tenantForm, setTenantForm] = useState<TenantSettingForm>(EMPTY_TENANT_FORM);
  const [partnerForm, setPartnerForm] = useState<PartnerSettingForm>(EMPTY_PARTNER_FORM);
  const [jobForm, setJobForm] = useState<JobForm>(EMPTY_JOB_FORM);
  const [saving, setSaving] = useState(false);

  const loadLanguages = async () => {
    setBusy(true);
    setErr(null);
    try {
      const suffix = activeOnly ? "?activeOnly=true" : "";
      const rows = await api.get<LanguageRow[]>(`/api/v1/admin/languages${suffix}`);
      setLanguages(rows);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load languages");
    } finally {
      setBusy(false);
    }
  };

  const loadJobs = async () => {
    try {
      const data = await api.get<TranslationJobsResponse>("/api/v1/admin/languages/jobs?limit=12");
      setJobs(data.items);
      setJobTotal(data.total);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load translation jobs");
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadLanguages();
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeOnly]);

  const activeCount = useMemo(
    () => languages.filter((language) => language.isActive).length,
    [languages],
  );
  const launchCount = useMemo(
    () => languages.filter((language) => language.isLaunchLanguage).length,
    [languages],
  );
  const rtlCount = useMemo(
    () => languages.filter((language) => language.direction === "RTL").length,
    [languages],
  );

  const languageOptions = languages.length
    ? languages
    : [{ code: "en", name: "English" }, { code: "hi", name: "Hindi" }, { code: "ar", name: "Arabic" }];

  const editLanguage = (language: LanguageRow) => {
    setLanguageForm({
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      direction: language.direction,
      isActive: language.isActive,
      isLaunchLanguage: language.isLaunchLanguage,
      displayOrder: String(language.displayOrder),
    });
    setNotice(null);
    setErr(null);
  };

  const saveLanguage = async () => {
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const displayOrder = Number(languageForm.displayOrder);
      if (!Number.isInteger(displayOrder) || displayOrder < 0) {
        setErr("Display order must be a positive integer.");
        return;
      }
      await api.post<LanguageRow>("/api/v1/admin/languages", {
        code: languageForm.code,
        name: languageForm.name,
        nativeName: languageForm.nativeName,
        direction: languageForm.direction,
        isActive: languageForm.isActive,
        isLaunchLanguage: languageForm.isLaunchLanguage,
        displayOrder,
      });
      setNotice("Language saved.");
      setLanguageForm(EMPTY_LANGUAGE_FORM);
      await loadLanguages();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to save language");
    } finally {
      setSaving(false);
    }
  };

  const seedLaunchLanguages = async () => {
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const rows = await api.post<LanguageRow[]>("/api/v1/admin/languages/seed-launch");
      setLanguages(rows);
      setNotice("Launch languages seeded.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to seed launch languages");
    } finally {
      setSaving(false);
    }
  };

  const saveCustomerDefaults = async () => {
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/admin/languages/settings/customer/${tenantForm.tenantId}`, {
        languageCode: tenantForm.languageCode,
        locale: tenantForm.locale,
        allowAutoTranslate: tenantForm.allowAutoTranslate,
        requireApprovalForSensitive: tenantForm.requireApprovalForSensitive,
      });
      setNotice("Customer language defaults saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to save customer language defaults");
    } finally {
      setSaving(false);
    }
  };

  const savePartnerDefaults = async () => {
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      await api.patch(`/api/v1/admin/languages/settings/partner/${partnerForm.partnerTenantId}`, {
        defaultLanguageCode: partnerForm.defaultLanguageCode,
        allowedLanguages: partnerForm.allowedLanguages
          .split(",")
          .map((code) => code.trim())
          .filter(Boolean),
        allowCustomerOverride: partnerForm.allowCustomerOverride,
      });
      setNotice("Partner language defaults saved.");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to save partner language defaults");
    } finally {
      setSaving(false);
    }
  };

  const createJob = async () => {
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      await api.post<TranslationJobRow>("/api/v1/admin/languages/jobs", {
        tenantId: jobForm.tenantId,
        sourceType: jobForm.sourceType,
        sourceId: jobForm.sourceId,
        sourceLanguageCode: jobForm.sourceLanguageCode,
        targetLanguageCode: jobForm.targetLanguageCode,
      });
      setNotice("Translation job queued.");
      setJobForm((form) => ({ ...EMPTY_JOB_FORM, tenantId: form.tenantId }));
      await loadJobs();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to queue translation job");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <DashboardShell user={user} features={features} signOut={signOut}>
      <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
            Platform · Localization
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Languages
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Control launch languages, RTL metadata, customer defaults, partner
            language rules, and the translation job ledger for templates,
            campaigns, chatbot flows, and portal copy.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => void seedLaunchLanguages()}
            disabled={saving}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
          >
            Seed launch set
          </button>
          <button
            onClick={() => void loadLanguages()}
            disabled={busy}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Active languages" value={activeCount} helper={`${languages.length} total`} />
        <MetricCard label="Launch languages" value={launchCount} helper="PDF launch set target: 13" />
        <MetricCard label="RTL languages" value={rtlCount} helper="Arabic + Urdu by default" />
      </div>

      {err && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {err}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Language master</h2>
              <p className="mt-1 text-xs text-slate-500">
                Enable, retire, and order platform-supported languages.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(event) => setActiveOnly(event.target.checked)}
              />
              Active only
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Language</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3">Launch</th>
                  <th className="px-4 py-3">Order</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {languages.map((language) => (
                  <tr key={language.code} className={language.isActive ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-950">
                        {language.name}{" "}
                        <span className="text-xs font-semibold uppercase text-slate-400">
                          {language.code}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">{language.nativeName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          language.direction === "RTL"
                            ? "bg-indigo-50 text-indigo-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {language.direction}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {language.isLaunchLanguage ? "Launch" : "Custom"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {language.displayOrder}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge active={language.isActive} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => editLanguage(language)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {languages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {busy ? "Loading…" : "No languages yet. Seed the launch set."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-6">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Add or edit language</h2>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <Input label="Code" value={languageForm.code} onChange={(value) => setLanguageForm((form) => ({ ...form, code: value.toLowerCase() }))} placeholder="en" maxLength={16} />
              <Input label="English name" value={languageForm.name} onChange={(value) => setLanguageForm((form) => ({ ...form, name: value }))} placeholder="English" />
              <Input label="Native name" value={languageForm.nativeName} onChange={(value) => setLanguageForm((form) => ({ ...form, nativeName: value }))} placeholder="English" />
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">
                  <span className="mb-1 block font-medium text-slate-700">Direction</span>
                  <select
                    value={languageForm.direction}
                    onChange={(event) => setLanguageForm((form) => ({ ...form, direction: event.target.value as Direction }))}
                    className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="LTR">LTR</option>
                    <option value="RTL">RTL</option>
                  </select>
                </label>
                <Input label="Order" value={languageForm.displayOrder} onChange={(value) => setLanguageForm((form) => ({ ...form, displayOrder: value }))} inputMode="numeric" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={languageForm.isActive}
                  onChange={(event) => setLanguageForm((form) => ({ ...form, isActive: event.target.checked }))}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={languageForm.isLaunchLanguage}
                  onChange={(event) => setLanguageForm((form) => ({ ...form, isLaunchLanguage: event.target.checked }))}
                />
                Launch language
              </label>
              <button
                onClick={() => void saveLanguage()}
                disabled={saving}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save language"}
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Tenant defaults</h2>
            <div className="mt-4 space-y-3">
              <Input label="Customer tenant ID" value={tenantForm.tenantId} onChange={(value) => setTenantForm((form) => ({ ...form, tenantId: value }))} placeholder="tenant cuid" />
              <div className="grid grid-cols-2 gap-3">
                <LanguageSelect
                  label="Language"
                  value={tenantForm.languageCode}
                  options={languageOptions}
                  onChange={(value) => setTenantForm((form) => ({ ...form, languageCode: value }))}
                />
                <Input label="Locale" value={tenantForm.locale} onChange={(value) => setTenantForm((form) => ({ ...form, locale: value }))} placeholder="en-IN" />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={tenantForm.allowAutoTranslate}
                  onChange={(event) => setTenantForm((form) => ({ ...form, allowAutoTranslate: event.target.checked }))}
                />
                Allow auto-translate
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={tenantForm.requireApprovalForSensitive}
                  onChange={(event) => setTenantForm((form) => ({ ...form, requireApprovalForSensitive: event.target.checked }))}
                />
                Sensitive copy needs approval
              </label>
              <button
                onClick={() => void saveCustomerDefaults()}
                disabled={saving || !tenantForm.tenantId.trim()}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Save customer defaults
              </button>
            </div>
          </section>
        </aside>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-950">Partner language policy</h2>
          <div className="mt-4 space-y-3">
            <Input label="Partner tenant ID" value={partnerForm.partnerTenantId} onChange={(value) => setPartnerForm((form) => ({ ...form, partnerTenantId: value }))} placeholder="white-label tenant cuid" />
            <LanguageSelect
              label="Default language"
              value={partnerForm.defaultLanguageCode}
              options={languageOptions}
              onChange={(value) => setPartnerForm((form) => ({ ...form, defaultLanguageCode: value }))}
            />
            <Input label="Allowed languages" value={partnerForm.allowedLanguages} onChange={(value) => setPartnerForm((form) => ({ ...form, allowedLanguages: value }))} placeholder="en,hi,ar" />
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={partnerForm.allowCustomerOverride}
                onChange={(event) => setPartnerForm((form) => ({ ...form, allowCustomerOverride: event.target.checked }))}
              />
              Customers may override partner default
            </label>
            <button
              onClick={() => void savePartnerDefaults()}
              disabled={saving || !partnerForm.partnerTenantId.trim()}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Save partner policy
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Translation jobs</h2>
              <p className="mt-1 text-xs text-slate-500">
                Queue translation work for templates, campaigns, chatbot flows, and portal keys.
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
              {jobTotal} total
            </span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input label="Tenant ID" value={jobForm.tenantId} onChange={(value) => setJobForm((form) => ({ ...form, tenantId: value }))} placeholder="tenant cuid" />
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-700">Source type</span>
              <select
                value={jobForm.sourceType}
                onChange={(event) => setJobForm((form) => ({ ...form, sourceType: event.target.value as SourceType }))}
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                {SOURCE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Source ID" value={jobForm.sourceId} onChange={(value) => setJobForm((form) => ({ ...form, sourceId: value }))} placeholder="template id, flow id, key id" />
            <div className="grid grid-cols-2 gap-3">
              <LanguageSelect
                label="From"
                value={jobForm.sourceLanguageCode}
                options={languageOptions}
                onChange={(value) => setJobForm((form) => ({ ...form, sourceLanguageCode: value }))}
              />
              <LanguageSelect
                label="To"
                value={jobForm.targetLanguageCode}
                options={languageOptions}
                onChange={(value) => setJobForm((form) => ({ ...form, targetLanguageCode: value }))}
              />
            </div>
          </div>
          <button
            onClick={() => void createJob()}
            disabled={saving || !jobForm.tenantId.trim() || !jobForm.sourceId.trim()}
            className="mt-4 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Queue translation job
          </button>

          <div className="mt-5 overflow-hidden rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Job</th>
                  <th className="px-3 py-2">Target</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-900">
                        {job.sourceType.replaceAll("_", " ")}
                      </div>
                      <div className="max-w-[220px] truncate text-xs text-slate-500">
                        {job.sourceId}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {job.sourceLanguageCode} → {job.targetLanguageCode}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-600">
                        {job.status.replaceAll("_", " ")}
                      </span>
                    </td>
                  </tr>
                ))}
                {jobs.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                      No translation jobs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
      />
    </label>
  );
}

function LanguageSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ code: string; name: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
      >
        {options.map((language) => (
          <option key={language.code} value={language.code}>
            {language.code} · {language.name}
          </option>
        ))}
      </select>
    </label>
  );
}
