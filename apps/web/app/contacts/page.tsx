"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/hooks/useAuth";
import { DashboardShell } from "../../src/components/DashboardShell";
import { api, ApiClientError, API_BASE, tokenStore } from "../../src/lib/api";

type LifecycleStage =
  | "LEAD"
  | "PROSPECT"
  | "CUSTOMER"
  | "REPEAT_CUSTOMER"
  | "VIP"
  | "CHURNED";

const STAGE_STYLES: Record<LifecycleStage, string> = {
  LEAD: "bg-slate-100 text-slate-700",
  PROSPECT: "bg-blue-50 text-blue-700",
  CUSTOMER: "bg-emerald-50 text-emerald-700",
  REPEAT_CUSTOMER: "bg-emerald-100 text-emerald-800",
  VIP: "bg-amber-100 text-amber-800",
  CHURNED: "bg-red-50 text-red-700",
};

const STAGE_LABELS: Record<LifecycleStage, string> = {
  LEAD: "Lead",
  PROSPECT: "Prospect",
  CUSTOMER: "Customer",
  REPEAT_CUSTOMER: "Repeat",
  VIP: "VIP",
  CHURNED: "Churned",
};

interface Contact {
  id: string;
  phoneNumber: string;
  name: string;
  email: string | null;
  tags: string[];
  optedOut: boolean;
  optedOutAt: string | null;
  lifecycleStage: LifecycleStage;
  createdAt: string;
}

export default function ContactsPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["BUSINESS_ADMIN", "TEAM_LEAD", "AGENT"],
  });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);

  async function refresh() {
    try {
      const list = await api.get<Contact[]>("/api/v1/contacts?limit=100");
      setContacts(list);
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed to load");
    }
  }

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function setStage(contactId: string, stage: LifecycleStage) {
    try {
      await api.patch(`/api/v1/contacts/${contactId}`, { lifecycleStage: stage });
      setContacts((cs) =>
        cs.map((c) => (c.id === contactId ? { ...c, lifecycleStage: stage } : c)),
      );
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Update failed");
    }
  }

  async function reOptIn(contactId: string, name: string) {
    if (
      !confirm(
        `Re-opt-in ${name}? Only do this if you have explicit consent from the customer. Marketing without consent violates Meta Commerce Policy.`,
      )
    )
      return;
    try {
      await api.patch(`/api/v1/contacts/${contactId}`, { optedOut: false });
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Re-opt-in failed");
    }
  }

  async function downloadCsv() {
    const token = tokenStore.getAccess();
    if (!token) return;
    const res = await fetch(`${API_BASE}/api/v1/contacts/export.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      setErr(`Export failed (${res.status})`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !user) return <div className="p-10 text-sm text-slate-500">Loading…</div>;

  return (
    <DashboardShell user={user} signOut={signOut}>
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-slate-500">{contacts.length} total</p>
        </div>
        <div className="flex gap-2">
          {user.role !== "AGENT" && (
            <button
              onClick={downloadCsv}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              ⬇ Export CSV
            </button>
          )}
          {user.role !== "AGENT" && (
            <button
              onClick={() => setShowImport(true)}
              className="rounded-md border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
            >
              ⬆ Bulk import
            </button>
          )}
          {user.role !== "AGENT" && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {showCreate ? "Cancel" : "+ New contact"}
            </button>
          )}
        </div>
      </header>

      {showCreate && (
        <CreateContactForm onSaved={() => { setShowCreate(false); refresh(); }} />
      )}

      {showImport && (
        <BulkImportDrawer
          onClose={() => setShowImport(false)}
          onDone={() => { setShowImport(false); refresh(); }}
        />
      )}

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
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Tags</th>
              <th className="px-4 py-3">Opt-out</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-3 font-medium">
                  {c.name}
                  {c.email && (
                    <div className="text-[11px] text-slate-500">{c.email}</div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{c.phoneNumber}</td>
                <td className="px-4 py-3">
                  {user.role !== "AGENT" ? (
                    <select
                      value={c.lifecycleStage}
                      onChange={(e) =>
                        setStage(c.id, e.target.value as LifecycleStage)
                      }
                      className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLES[c.lifecycleStage]} border-0 focus:ring-1 focus:ring-emerald-500`}
                    >
                      {(Object.keys(STAGE_LABELS) as LifecycleStage[]).map((s) => (
                        <option key={s} value={s}>
                          {STAGE_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLES[c.lifecycleStage]}`}
                    >
                      {STAGE_LABELS[c.lifecycleStage]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.tags.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.optedOut ? (
                    <div className="space-y-1">
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        Opted out
                      </span>
                      {c.optedOutAt && (
                        <div className="text-[11px] text-slate-500">
                          {new Date(c.optedOutAt).toLocaleDateString()}
                        </div>
                      )}
                      {user.role !== "AGENT" && (
                        <button
                          onClick={() => reOptIn(c.id, c.name)}
                          className="block text-[11px] text-emerald-700 hover:underline"
                          title="Only re-opt-in with explicit consent (Meta policy)"
                        >
                          Re-opt-in
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500">Subscribed</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {contacts.length === 0 && !err && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                  No contacts yet. Add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </DashboardShell>
  );
}

function CreateContactForm({ onSaved }: { onSaved: () => void }) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const tags = tagsInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await api.post("/api/v1/contacts", {
        phoneNumber: phone.trim(),
        name: name.trim(),
        email: email.trim() || undefined,
        tags,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mb-6 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-5"
    >
      <input
        placeholder="+919876543210"
        required
        pattern="^\+?[1-9]\d{6,14}$"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Full name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Email (optional)"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        placeholder="Tags (comma)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      {err && (
        <div className="md:col-span-5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {err}
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bulk CSV import drawer.
//
// Flow:
//   1. Operator pastes CSV OR uploads a .csv file.
//   2. We parse rows (native parser — no library), detect a header row.
//   3. Operator confirms column mapping (which column is phone / name / email / tags).
//      We auto-pick by header name when obvious.
//   4. Preview shows valid + invalid rows (and WHY invalid).
//   5. Confirm sends valid rows to POST /contacts/bulk-import.
//   6. Result panel: created + skipped (duplicates) + invalid counts.
//
// Validation here matches the backend's bulkImportSchema (phone E.164-ish,
// name 1-120 chars, optional email, optional tags). The backend ALSO
// validates — UI checks are just for early feedback.
// ---------------------------------------------------------------------------

type ImportField = "phoneNumber" | "name" | "email" | "tags" | "_ignore";

interface ParsedRow {
  raw: string[];
  /** post-mapping fields */
  phoneNumber: string;
  name: string;
  email: string;
  tags: string[];
  errors: string[];
}

const FIELD_LABELS: Record<ImportField, string> = {
  phoneNumber: "Phone (E.164, e.g. +15551234567)",
  name: "Name",
  email: "Email (optional)",
  tags: "Tags (semicolon-separated, optional)",
  _ignore: "— ignore —",
};

function autoMapHeader(header: string): ImportField {
  const h = header.trim().toLowerCase();
  if (
    /^(phone|mobile|whatsapp|wa|number|tel|msisdn|contact)\b/.test(h) ||
    h.includes("phone") ||
    h.includes("mobile")
  ) {
    return "phoneNumber";
  }
  if (/^(name|full[\s_-]?name|customer|contact[\s_-]?name)/.test(h)) {
    return "name";
  }
  if (/^email|mail/.test(h)) return "email";
  if (/^tag|label|categor/.test(h)) return "tags";
  return "_ignore";
}

function parseCsv(text: string): string[][] {
  // Simple CSV: handle quoted fields with embedded commas. No multi-line
  // quoted fields (rare in contact lists). Strip BOM.
  const cleaned = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === ",") {
          fields.push(cur.trim());
          cur = "";
        } else if (ch === '"') {
          inQuotes = true;
        } else {
          cur += ch;
        }
      }
    }
    fields.push(cur.trim());
    rows.push(fields);
  }
  return rows;
}

function normalizePhone(raw: string): string {
  // Strip everything except digits and a leading +. If the input has
  // no + but starts with country code (1, 91, etc.) we don't guess —
  // the backend's E.164 check will reject it and the operator sees why.
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  return (hasPlus ? "+" : "") + digits;
}

function validateRow(row: ParsedRow): string[] {
  const errors: string[] = [];
  if (!row.phoneNumber) {
    errors.push("phone is empty");
  } else if (!/^\+?\d{8,15}$/.test(row.phoneNumber)) {
    errors.push("phone must be 8–15 digits, optional leading +");
  }
  if (!row.name) {
    errors.push("name is empty");
  } else if (row.name.length > 120) {
    errors.push("name exceeds 120 chars");
  }
  if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
    errors.push("email is not valid");
  }
  return errors;
}

function BulkImportDrawer({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"paste" | "map" | "preview" | "done">("paste");
  const [csvText, setCsvText] = useState("");
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [parsed, setParsed] = useState<ParsedRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    invalid: number;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
    };
    reader.readAsText(file);
  }

  function goToMap() {
    const rows = parseCsv(csvText);
    if (rows.length === 0) {
      setErr("No rows found. Paste CSV text or upload a file.");
      return;
    }
    setRawRows(rows);
    setMapping(rows[0].map((h) => autoMapHeader(h)));
    setErr(null);
    setStep("map");
  }

  function goToPreview() {
    const dataRows = hasHeader ? rawRows.slice(1) : rawRows;
    const idx: Record<ImportField, number> = {
      phoneNumber: mapping.indexOf("phoneNumber"),
      name: mapping.indexOf("name"),
      email: mapping.indexOf("email"),
      tags: mapping.indexOf("tags"),
      _ignore: -1,
    };
    if (idx.phoneNumber < 0 || idx.name < 0) {
      setErr("Map at least one column to Phone and one to Name.");
      return;
    }
    const out: ParsedRow[] = dataRows.map((cols) => {
      const phoneRaw = idx.phoneNumber >= 0 ? cols[idx.phoneNumber] ?? "" : "";
      const nameRaw = idx.name >= 0 ? cols[idx.name] ?? "" : "";
      const emailRaw = idx.email >= 0 ? cols[idx.email] ?? "" : "";
      const tagsRaw = idx.tags >= 0 ? cols[idx.tags] ?? "" : "";
      const row: ParsedRow = {
        raw: cols,
        phoneNumber: normalizePhone(phoneRaw),
        name: nameRaw.trim().slice(0, 120),
        email: emailRaw.trim(),
        tags: tagsRaw
          .split(/[;,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        errors: [],
      };
      row.errors = validateRow(row);
      return row;
    });
    setParsed(out);
    setErr(null);
    setStep("preview");
  }

  async function commit() {
    const valid = parsed.filter((r) => r.errors.length === 0);
    const invalid = parsed.length - valid.length;
    if (valid.length === 0) {
      setErr("No valid rows to import. Fix the errors above and retry.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // Chunk at 500 rows per request — backend cap is 1000, this stays well under.
      const chunkSize = 500;
      let created = 0;
      let skipped = 0;
      for (let i = 0; i < valid.length; i += chunkSize) {
        const chunk = valid.slice(i, i + chunkSize);
        const resp = await api.post<{ created: number; skipped: number }>(
          "/api/v1/contacts/bulk-import",
          {
            contacts: chunk.map((r) => ({
              phoneNumber: r.phoneNumber,
              name: r.name,
              email: r.email || undefined,
              tags: r.tags.length ? r.tags : undefined,
            })),
          },
        );
        created += resp.created;
        skipped += resp.skipped;
      }
      setResult({ created, skipped, invalid });
      setStep("done");
    } catch (e) {
      setErr(e instanceof ApiClientError ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-900">
            Bulk import contacts
            <span className="ml-2 text-xs font-normal text-slate-500">
              Step {step === "paste" ? 1 : step === "map" ? 2 : step === "preview" ? 3 : 4} of 4
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </header>

        {err && (
          <div className="mx-4 mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {err}
          </div>
        )}

        {step === "paste" && (
          <div className="space-y-4 px-4 py-4">
            <div>
              <label className="block text-xs font-medium text-slate-700">
                Upload .csv file
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFile}
                  className="mt-1 block w-full text-xs"
                />
              </label>
            </div>
            <div className="text-center text-[10px] uppercase tracking-wide text-slate-400">
              or
            </div>
            <label className="block text-xs font-medium text-slate-700">
              Paste CSV (first row should be the header)
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                rows={10}
                placeholder={"phone,name,email,tags\n+15551234567,Sid,sid@example.com,vip;trial\n+919876543210,Anjali,,prospect"}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-emerald-500 focus:outline-none"
              />
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={goToMap}
                disabled={!csvText.trim()}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Next: map columns →
              </button>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-3 px-4 py-4">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              First row is a header (skip it when importing)
            </label>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    {rawRows[0]?.map((col, i) => (
                      <th key={i} className="border-b border-slate-200 px-2 py-2 text-left">
                        <div className="font-mono text-[10px] text-slate-500">
                          column {i + 1}
                        </div>
                        <div className="font-semibold">{col}</div>
                        <select
                          value={mapping[i] ?? "_ignore"}
                          onChange={(e) =>
                            setMapping((m) => {
                              const next = [...m];
                              next[i] = e.target.value as ImportField;
                              return next;
                            })
                          }
                          className="mt-1 w-full rounded border border-slate-300 px-1 py-1 text-[10px]"
                        >
                          {(Object.keys(FIELD_LABELS) as ImportField[]).map((f) => (
                            <option key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(hasHeader ? rawRows.slice(1, 4) : rawRows.slice(0, 4)).map(
                    (row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="max-w-[180px] truncate border-b border-slate-100 px-2 py-1.5 text-slate-700"
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <div className="border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                Showing first 3 data rows for preview (out of {hasHeader ? rawRows.length - 1 : rawRows.length} total)
              </div>
            </div>
            <div className="flex justify-between gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => setStep("paste")}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={goToPreview}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Next: validate → preview
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3 px-4 py-4">
            {(() => {
              const ok = parsed.filter((r) => r.errors.length === 0);
              const bad = parsed.filter((r) => r.errors.length > 0);
              return (
                <>
                  <div className="flex gap-3 text-xs">
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
                      {ok.length} valid
                    </span>
                    {bad.length > 0 && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-800">
                        {bad.length} invalid
                      </span>
                    )}
                  </div>
                  {bad.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-red-200 bg-red-50 p-2 text-[11px]">
                      <div className="mb-1 font-semibold text-red-800">
                        Invalid rows (will be skipped)
                      </div>
                      <ul className="space-y-1">
                        {bad.slice(0, 10).map((r, i) => (
                          <li key={i} className="text-red-700">
                            <span className="font-mono">{r.raw.join(", ").slice(0, 80)}</span>{" "}
                            — {r.errors.join("; ")}
                          </li>
                        ))}
                        {bad.length > 10 && (
                          <li className="italic">…and {bad.length - 10} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                  <div className="max-h-60 overflow-y-auto rounded-md border border-slate-200">
                    <table className="min-w-full text-xs">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="border-b border-slate-200 px-2 py-1 text-left">Phone</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-left">Name</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-left">Email</th>
                          <th className="border-b border-slate-200 px-2 py-1 text-left">Tags</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ok.slice(0, 50).map((r, i) => (
                          <tr key={i}>
                            <td className="border-b border-slate-100 px-2 py-1 font-mono">{r.phoneNumber}</td>
                            <td className="border-b border-slate-100 px-2 py-1">{r.name}</td>
                            <td className="border-b border-slate-100 px-2 py-1">{r.email || "—"}</td>
                            <td className="border-b border-slate-100 px-2 py-1">{r.tags.join(", ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ok.length > 50 && (
                      <div className="border-t border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                        Showing first 50 of {ok.length} valid rows. All will be imported.
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between gap-2 border-t border-slate-200 pt-3">
                    <button
                      type="button"
                      onClick={() => setStep("map")}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      ← Back
                    </button>
                    <button
                      type="button"
                      onClick={() => void commit()}
                      disabled={busy || ok.length === 0}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {busy ? "Importing…" : `Import ${ok.length} contacts`}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3 px-4 py-6 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-lg text-white">
              ✓
            </div>
            <h3 className="text-sm font-semibold text-slate-900">Import complete</h3>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                <div className="text-lg font-semibold text-emerald-800">{result.created}</div>
                <div className="text-emerald-700">Created</div>
              </div>
              <div className="rounded border border-amber-200 bg-amber-50 p-2">
                <div className="text-lg font-semibold text-amber-800">{result.skipped}</div>
                <div className="text-amber-700">Duplicates skipped</div>
              </div>
              <div className="rounded border border-red-200 bg-red-50 p-2">
                <div className="text-lg font-semibold text-red-800">{result.invalid}</div>
                <div className="text-red-700">Invalid (not sent)</div>
              </div>
            </div>
            <div className="border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={onDone}
                className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
