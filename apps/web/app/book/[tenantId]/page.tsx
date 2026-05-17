"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API_BASE } from "../../../src/lib/api";

interface TenantPublic {
  id: string;
  name: string;
  logoUrl: string | null;
  brandColors: string | null;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceInPaisa: number;
}

interface Colors {
  primary?: string;
  secondary?: string;
  accent?: string;
}

function parseColors(raw: string | null): Colors {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Colors;
  } catch {
    return {};
  }
}

function formatPrice(paisa: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paisa / 100);
}

// Round a date up to the next 15-minute slot in local time, +1h from now.
function defaultSlotIso(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PublicBookingPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId;

  const [tenant, setTenant] = useState<TenantPublic | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [serviceId, setServiceId] = useState("");
  const [scheduledAtLocal, setScheduledAtLocal] = useState(defaultSlotIso());
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    scheduledAt: string;
    serviceName: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/public/booking/${tenantId}`);
        const json = await res.json();
        if (!res.ok || !json.success) {
          setLoadErr(json.error?.message ?? "Could not load booking page.");
          return;
        }
        setTenant(json.data.tenant);
        setServices(json.data.services);
        if (json.data.services.length > 0) {
          setServiceId(json.data.services[0].id);
        }
      } catch (e) {
        setLoadErr("Network error. Try again in a moment.");
      }
    })();
  }, [tenantId]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const scheduledAtIso = new Date(scheduledAtLocal).toISOString();
      const res = await fetch(`${API_BASE}/public/booking/${tenantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          scheduledAt: scheduledAtIso,
          name: name.trim(),
          phoneNumber: phoneNumber.trim(),
          email: email.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error?.message ?? "Booking failed. Please try again.");
        return;
      }
      setConfirmation({
        scheduledAt: json.data.scheduledAt,
        serviceName: json.data.serviceName,
        message: json.data.message,
      });
    } catch {
      setError("Network error. Try again in a moment.");
    } finally {
      setSubmitting(false);
    }
  }

  const colors = parseColors(tenant?.brandColors ?? null);
  const primary = colors.primary ?? "#10B981";
  const secondary = colors.secondary ?? "#1E293B";

  if (loadErr) {
    return (
      <div className="flex min-h-full items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center">
          <h1 className="text-lg font-semibold">Booking page not available</h1>
          <p className="mt-2 text-sm text-slate-600">{loadErr}</p>
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex min-h-full items-center justify-center p-6 text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      <header
        className="px-6 py-10 text-center text-white"
        style={{ background: secondary }}
      >
        {tenant.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={tenant.logoUrl}
            alt={tenant.name}
            className="mx-auto mb-3 h-14 w-14 rounded-md bg-white object-contain p-1"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-md text-xl font-bold"
            style={{ background: primary, color: "white" }}
          >
            {tenant.name.charAt(0).toUpperCase()}
          </div>
        )}
        <h1 className="text-2xl font-semibold">{tenant.name}</h1>
        <p className="mt-1 text-sm text-slate-300">Book your appointment online</p>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10">
        {confirmation ? (
          <div className="rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
            <div
              className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full text-white"
              style={{ background: primary }}
            >
              ✓
            </div>
            <h2 className="text-xl font-semibold">Booking received</h2>
            <p className="mt-2 text-sm text-slate-600">{confirmation.message}</p>
            <div className="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="font-medium">{confirmation.serviceName}</div>
              <div className="mt-1 text-slate-600">
                {new Date(confirmation.scheduledAt).toLocaleString(undefined, {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ) : services.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            {tenant.name} hasn't published any services yet. Check back soon.
          </div>
        ) : (
          <form
            onSubmit={submit}
            className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700">
                Service
              </label>
              <div className="mt-2 space-y-2">
                {services.map((s) => (
                  <label
                    key={s.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors ${
                      serviceId === s.id
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="service"
                      checked={serviceId === s.id}
                      onChange={() => setServiceId(s.id)}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-sm font-medium" style={{ color: primary }}>
                          {formatPrice(s.priceInPaisa)}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500">
                        {s.durationMinutes} min
                        {s.description ? ` · ${s.description}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">
                Date & time
              </label>
              <input
                type="datetime-local"
                required
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
                min={defaultSlotIso()}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  Your name
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">
                  WhatsApp number
                </label>
                <input
                  required
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="+919876543210"
                  pattern="^\+?[1-9]\d{6,14}$"
                  className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">
                Email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">
                Notes (optional)
              </label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything we should know?"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !serviceId}
              className="w-full rounded-md px-5 py-3 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: primary }}
            >
              {submitting ? "Booking…" : "Book appointment"}
            </button>

            <p className="text-center text-[11px] text-slate-500">
              You'll get a WhatsApp confirmation once {tenant.name} confirms.
            </p>
          </form>
        )}
      </main>

      <footer className="py-6 text-center text-[11px] text-slate-400">
        Powered by NexaFlow AI
      </footer>
    </div>
  );
}
