import { Worker } from "bullmq";
import { prisma } from "@nexaflow/db";
import { sendWhatsAppText } from "./whatsapp.service";
import { canSendNow, recordSend } from "./sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "./billing.service";
import { ApiError } from "@nexaflow/shared";
import {
  getAppointmentQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type AppointmentJobData,
} from "../lib/queue";

/**
 * Background worker for appointment confirmations + reminders.
 *
 * - Confirmation: when an appointment flips to CONFIRMED and we haven't sent
 *   a confirmation yet, send a WhatsApp message and stamp confirmationSentAt.
 * - Reminder: when an appointment is in [now+22h, now+26h], send a reminder
 *   if we haven't already.
 *
 * The worker degrades gracefully when WhatsApp isn't configured for the
 * tenant — it just logs and skips. This lets the booking flow be usable even
 * before WABA credentials are wired up.
 */

function formatDateTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

async function sendAppointmentMessage(
  appointmentId: string,
  kind: "confirmation" | "reminder",
): Promise<boolean> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      contact: { select: { phoneNumber: true, name: true, optedOut: true } },
      service: { select: { name: true } },
      tenant: {
        select: {
          name: true,
          wabaPhoneNumber: true,
          wabaAccessToken: true,
        },
      },
    },
  });
  if (!appt) return false;
  if (appt.contact.optedOut) return false;
  if (!appt.tenant.wabaPhoneNumber || !appt.tenant.wabaAccessToken) {
    // No WhatsApp configured — degrade silently.
    return false;
  }

  const when = formatDateTime(appt.scheduledAt);
  const body =
    kind === "confirmation"
      ? `Hi ${appt.contact.name}! Your ${appt.service.name} booking at ${appt.tenant.name} is confirmed for ${when}. Reply CANCEL if you need to change it.`
      : `Reminder: your ${appt.service.name} at ${appt.tenant.name} is coming up on ${when}. See you soon! Reply CANCEL to reschedule.`;

  try {
    // Respect tenant quota — appointment messages count too.
    const gate = await canSendNow(appt.tenantId, {
      phoneNumberId: appt.tenant.wabaPhoneNumber,
    });
    if (!gate.allowed) {
      console.warn(`[appointments] ${kind} throttled for ${appt.id}: ${gate.reason}`);
      return false; // Don't stamp confirmationSentAt/reminderSentAt; retry next tick.
    }
    // Wallet pre-check — if the tenant can't afford, leave the appt timer
    // alone so it retries after a top-up.
    try {
      await assertCanAffordMessage(appt.tenantId);
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 402) {
        console.warn(`[appointments] ${kind} unfunded for ${appt.id}: ${err.message}`);
        return false;
      }
      throw err;
    }
    const metaMessageId = await sendWhatsAppText({
      phoneNumberId: appt.tenant.wabaPhoneNumber,
      accessToken: appt.tenant.wabaAccessToken,
      to: appt.contact.phoneNumber.replace(/^\+/, ""),
      body,
    });
    await recordSend(appt.tenantId, {
      phoneNumberId: appt.tenant.wabaPhoneNumber,
    });
    await debitMessage(appt.tenantId, metaMessageId, {
      reason: `Appointment ${kind} for ${appt.id}`,
    });
    return true;
  } catch (err) {
    console.error(`[appointments] ${kind} send failed`, appt.id, err);
    return false;
  }
}

async function dispatchConfirmations(): Promise<void> {
  const due = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMED",
      confirmationSentAt: null,
      scheduledAt: { gt: new Date() }, // don't bother confirming past appts
    },
    select: { id: true },
    take: 20,
  });
  for (const a of due) {
    const ok = await sendAppointmentMessage(a.id, "confirmation");
    if (ok) {
      await prisma.appointment.update({
        where: { id: a.id },
        data: { confirmationSentAt: new Date() },
      });
    }
  }
}

async function dispatchReminders(): Promise<void> {
  // Look for CONFIRMED appointments in the [now+22h, now+26h] window.
  const now = Date.now();
  const window = await prisma.appointment.findMany({
    where: {
      status: "CONFIRMED",
      reminderSentAt: null,
      scheduledAt: {
        gte: new Date(now + 22 * 60 * 60 * 1000),
        lte: new Date(now + 26 * 60 * 60 * 1000),
      },
    },
    select: { id: true },
    take: 50,
  });
  for (const a of window) {
    const ok = await sendAppointmentMessage(a.id, "reminder");
    if (ok) {
      await prisma.appointment.update({
        where: { id: a.id },
        data: { reminderSentAt: new Date() },
      });
    }
  }
}

// ----------------------------------------------------------------------------
// BullMQ worker — replaces the old setInterval. A single repeatable "scan"
// job runs every SCAN_INTERVAL_MS; the worker tick dispatches confirmations
// then reminders. Idempotent at the DB level (confirmationSentAt /
// reminderSentAt stamps), so a duplicate tick from a race is safe.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const SCAN_JOB_NAME = "scan";

let appointmentWorker: Worker<AppointmentJobData> | null = null;

export async function startAppointmentWorker(): Promise<void> {
  if (appointmentWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[appointment-worker] database unavailable; worker not started.",
    );
    return;
  }

  const q = getAppointmentQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[appointment-worker] could not register scan scheduler (Redis unavailable?)",
      (err as Error).message,
    );
    return;
  }

  appointmentWorker = new Worker<AppointmentJobData>(
    QueueNames.APPOINTMENT_DISPATCH,
    async () => {
      await dispatchConfirmations();
      await dispatchReminders();
    },
    {
      connection: getQueueConnection(),
      concurrency: 1,
    },
  );

  appointmentWorker.on("failed", (job, err) => {
    console.error(
      `[appointment-worker] job ${job?.id} failed:`,
      err?.message,
    );
  });
  appointmentWorker.on("error", (err) => {
    console.error("[appointment-worker] worker error:", err.message);
  });

  trackWorker(appointmentWorker);
}

export function stopAppointmentWorker(): void {
  if (appointmentWorker) {
    void appointmentWorker.close();
    appointmentWorker = null;
  }
}
