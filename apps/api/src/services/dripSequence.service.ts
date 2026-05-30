import { Worker } from "bullmq";
import {
  prisma,
  DripSequenceStatus,
  DripSequenceTrigger,
  DripEnrollmentStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { z } from "zod";
import {
  getDripQueue,
  getQueueConnection,
  QueueNames,
  trackWorker,
  type DripJobData,
} from "../lib/queue";
import { sendWhatsAppTemplate } from "./whatsapp.service";
import { decryptTokenIfNeeded } from "../lib/tokenCrypto";
import { canSendNow, recordSend } from "./sendThrottle.service";
import { assertCanAffordMessage, debitMessage } from "./billing.service";
import {
  ComplianceScope,
  complianceStopMessage,
  enforceCompliance,
  runComplianceCheck,
} from "./compliance.service";
import { MessageDirection, MessageStatus } from "@nexaflow/shared";

// ----------------------------------------------------------------------------
// Step schema. A drip sequence is an ordered list of these. Stored as JSON
// on DripSequence.steps so we can iterate cheaply during dispatch.
// ----------------------------------------------------------------------------

export const dripStepSchema = z.object({
  // Delay (hours) BEFORE this step fires. Step 0's delay is the wait
  // between enrollment and the first send.
  delayHours: z.number().int().min(0).max(24 * 30),
  templateId: z.string().cuid(),
  languageCode: z.string().min(2).max(10).default("en_US"),
  // Optional ordered list of body-variable substitutions. The template
  // body is rendered with these positional params by Meta.
  bodyParams: z.array(z.string().max(400)).max(20).optional(),
});

export type DripStep = z.infer<typeof dripStepSchema>;

export const dripStepsSchema = z.array(dripStepSchema).min(1).max(20);

function parseSteps(steps: unknown): DripStep[] {
  const result = dripStepsSchema.safeParse(steps);
  if (!result.success) return [];
  return result.data;
}

// ----------------------------------------------------------------------------
// CRUD helpers
// ----------------------------------------------------------------------------

export const createDripSequenceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(800).optional(),
  trigger: z.nativeEnum(DripSequenceTrigger).default(DripSequenceTrigger.MANUAL),
  triggerTag: z.string().trim().min(1).max(80).optional(),
  steps: dripStepsSchema,
});

export const updateDripSequenceSchema = createDripSequenceSchema
  .partial()
  .extend({
    status: z.nativeEnum(DripSequenceStatus).optional(),
  });

async function assertTemplatesBelongToTenant(
  tenantId: string,
  templateIds: string[],
) {
  if (templateIds.length === 0) return;
  const found = await prisma.whatsAppTemplate.findMany({
    where: { id: { in: templateIds }, tenantId },
    select: { id: true },
  });
  const foundIds = new Set(found.map((t) => t.id));
  const missing = templateIds.filter((id) => !foundIds.has(id));
  if (missing.length > 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      `Templates not found or not in this tenant: ${missing.join(", ")}`,
    );
  }
}

export async function createDripSequence(
  tenantId: string,
  input: z.infer<typeof createDripSequenceSchema>,
) {
  if (input.trigger === DripSequenceTrigger.TAG_ADDED && !input.triggerTag) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "triggerTag is required when trigger=TAG_ADDED.",
    );
  }
  await assertTemplatesBelongToTenant(
    tenantId,
    input.steps.map((s) => s.templateId),
  );

  // Compliance Firewall pass on each step's template body. We fetch all
  // templates in one query (already-validated to belong to the tenant)
  // and run each through enforceCompliance — any enforced verdict
  // throws and aborts the entire sequence creation. The check is
  // skippable in MANUAL mode at the tenant level via complianceMode.
  const templates = await prisma.whatsAppTemplate.findMany({
    where: {
      tenantId,
      id: { in: input.steps.map((s) => s.templateId) },
    },
    select: { id: true, bodyText: true },
  });
  const bodyById = new Map(templates.map((t) => [t.id, t.bodyText]));
  for (const step of input.steps) {
    const bodyText = bodyById.get(step.templateId);
    if (!bodyText) continue;
    await enforceCompliance({
      tenantId,
      scope: ComplianceScope.DRIP_STEP,
      content: bodyText,
      heuristicsOnly: true,
    });
  }

  return prisma.dripSequence.create({
    data: {
      tenantId,
      name: input.name,
      description: input.description,
      trigger: input.trigger,
      triggerTag:
        input.trigger === DripSequenceTrigger.TAG_ADDED ? input.triggerTag : null,
      steps: input.steps,
    },
  });
}

export async function updateDripSequence(
  tenantId: string,
  id: string,
  input: z.infer<typeof updateDripSequenceSchema>,
) {
  const existing = await prisma.dripSequence.findFirst({
    where: { id, tenantId },
  });
  if (!existing) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Drip sequence not found.");
  }

  if (input.steps) {
    await assertTemplatesBelongToTenant(
      tenantId,
      input.steps.map((s) => s.templateId),
    );
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.trigger !== undefined) data.trigger = input.trigger;
  if (input.triggerTag !== undefined) {
    data.triggerTag = input.trigger === DripSequenceTrigger.TAG_ADDED ? input.triggerTag : null;
  }
  if (input.steps !== undefined) data.steps = input.steps;
  if (input.status !== undefined) data.status = input.status;

  return prisma.dripSequence.update({ where: { id }, data });
}

export async function listDripSequences(tenantId: string) {
  return prisma.dripSequence.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      _count: { select: { enrollments: true } },
    },
  });
}

export async function getDripSequence(tenantId: string, id: string) {
  const sequence = await prisma.dripSequence.findFirst({
    where: { id, tenantId },
    include: { _count: { select: { enrollments: true } } },
  });
  if (!sequence) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Drip sequence not found.");
  }
  return sequence;
}

// ----------------------------------------------------------------------------
// Enrollment
// ----------------------------------------------------------------------------

export async function enrollContact(args: {
  tenantId: string;
  sequenceId: string;
  contactId: string;
}) {
  const sequence = await prisma.dripSequence.findFirst({
    where: { id: args.sequenceId, tenantId: args.tenantId },
  });
  if (!sequence) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Drip sequence not found.");
  }
  if (sequence.status !== DripSequenceStatus.ACTIVE) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Drip sequence is not ACTIVE.",
    );
  }
  const steps = parseSteps(sequence.steps);
  if (steps.length === 0) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Drip sequence has no steps.",
    );
  }

  const contact = await prisma.contact.findFirst({
    where: { id: args.contactId, tenantId: args.tenantId },
    select: { id: true, optedOut: true },
  });
  if (!contact) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
  }
  if (contact.optedOut) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Contact has opted out; cannot enroll.",
    );
  }

  // Idempotent: if a row already exists, return it instead of throwing
  // (re-enrolling is an explicit cancel+enroll operation).
  const existing = await prisma.dripEnrollment.findUnique({
    where: {
      sequenceId_contactId: {
        sequenceId: sequence.id,
        contactId: contact.id,
      },
    },
  });
  if (existing) return existing;

  const nextStepAt = new Date(Date.now() + steps[0].delayHours * 3600_000);
  return prisma.dripEnrollment.create({
    data: {
      tenantId: args.tenantId,
      sequenceId: sequence.id,
      contactId: contact.id,
      currentStep: 0,
      status: DripEnrollmentStatus.RUNNING,
      nextStepAt,
    },
  });
}

export async function cancelEnrollment(args: {
  tenantId: string;
  enrollmentId: string;
}) {
  const enrollment = await prisma.dripEnrollment.findFirst({
    where: { id: args.enrollmentId, tenantId: args.tenantId },
  });
  if (!enrollment) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Enrollment not found.");
  }
  return prisma.dripEnrollment.update({
    where: { id: enrollment.id },
    data: { status: DripEnrollmentStatus.CANCELLED, nextStepAt: null },
  });
}

export async function listEnrollments(args: {
  tenantId: string;
  sequenceId: string;
}) {
  await getDripSequence(args.tenantId, args.sequenceId); // 404 check
  return prisma.dripEnrollment.findMany({
    where: { sequenceId: args.sequenceId, tenantId: args.tenantId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      contact: { select: { id: true, name: true, phoneNumber: true } },
    },
    take: 200,
  });
}

// ----------------------------------------------------------------------------
// Auto-enrollment hooks (slice 2). Called from contact-mutation paths to
// drop a contact into any sequence whose trigger matches. Both helpers are
// tolerant — a failure in this path should never block the contact write
// that called us. Worst case we log + drop.
// ----------------------------------------------------------------------------

async function safeEnroll(args: {
  tenantId: string;
  sequenceId: string;
  contactId: string;
  reason: string;
}): Promise<void> {
  try {
    await enrollContact(args);
  } catch (err) {
    console.warn(
      `[drip] auto-enroll skipped (${args.reason}) sequence=${args.sequenceId} contact=${args.contactId}: ${(err as Error).message}`,
    );
  }
}

/**
 * Fires after a Contact (or batch) is created in the tenant. Enrolls each
 * contact in every ACTIVE sequence whose trigger=CONTACT_CREATED.
 *
 * Note: this runs synchronously inside the request that created the
 * contact. The work is O(sequences × contacts) DB writes; with sub-100
 * sequences per tenant and bulk imports already bounded by their batch
 * size, this is fine. If a tenant ever has a huge sequence catalog +
 * bulk-imports, move this onto its own queue.
 */
export async function enrollContactsForCreatedTrigger(
  tenantId: string,
  contactIds: string[],
): Promise<void> {
  if (contactIds.length === 0) return;
  const sequences = await prisma.dripSequence.findMany({
    where: {
      tenantId,
      status: DripSequenceStatus.ACTIVE,
      trigger: DripSequenceTrigger.CONTACT_CREATED,
    },
    select: { id: true },
  });
  if (sequences.length === 0) return;
  for (const seq of sequences) {
    for (const contactId of contactIds) {
      await safeEnroll({
        tenantId,
        sequenceId: seq.id,
        contactId,
        reason: "CONTACT_CREATED",
      });
    }
  }
}

/**
 * Fires after a Contact's tags array gained new entries. Enrolls the
 * contact in every ACTIVE sequence whose trigger=TAG_ADDED + triggerTag
 * matches one of the newly-added tags.
 */
export async function enrollContactForAddedTags(args: {
  tenantId: string;
  contactId: string;
  addedTags: string[];
}): Promise<void> {
  if (args.addedTags.length === 0) return;
  const sequences = await prisma.dripSequence.findMany({
    where: {
      tenantId: args.tenantId,
      status: DripSequenceStatus.ACTIVE,
      trigger: DripSequenceTrigger.TAG_ADDED,
      triggerTag: { in: args.addedTags },
    },
    select: { id: true, triggerTag: true },
  });
  if (sequences.length === 0) return;
  for (const seq of sequences) {
    await safeEnroll({
      tenantId: args.tenantId,
      sequenceId: seq.id,
      contactId: args.contactId,
      reason: `TAG_ADDED:${seq.triggerTag}`,
    });
  }
}

// ----------------------------------------------------------------------------
// Dispatch — fires the current step for one enrollment, then schedules the
// next or marks COMPLETED.
// ----------------------------------------------------------------------------

export async function processEnrollment(enrollmentId: string): Promise<void> {
  const enrollment = await prisma.dripEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      sequence: { select: { id: true, status: true, steps: true } },
      contact: { select: { id: true, phoneNumber: true, optedOut: true } },
    },
  });
  if (!enrollment) return;
  if (enrollment.status !== DripEnrollmentStatus.RUNNING) return;
  if (enrollment.sequence.status === DripSequenceStatus.PAUSED) {
    // Sequence-level pause — leave the enrollment as-is, scan picks it up
    // again when the operator un-pauses.
    return;
  }
  if (enrollment.contact.optedOut) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.CANCELLED,
        nextStepAt: null,
        lastError: "Contact opted out.",
      },
    });
    return;
  }

  const steps = parseSteps(enrollment.sequence.steps);
  const step = steps[enrollment.currentStep];
  if (!step) {
    // Sequence shape changed under us — nothing left to do.
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: { status: DripEnrollmentStatus.COMPLETED, nextStepAt: null },
    });
    return;
  }

  // Load the template + tenant in a single hop (audience+billing checks).
  const tenant = await prisma.tenant.findUnique({
    where: { id: enrollment.tenantId },
  });
  if (!tenant || !tenant.wabaPhoneNumber || !tenant.wabaAccessToken) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: "Tenant has no WABA connection.",
      },
    });
    return;
  }
  const accessToken = decryptTokenIfNeeded(tenant.wabaAccessToken);
  if (!accessToken) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: "Tenant WABA token decrypt failed.",
      },
    });
    return;
  }

  const template = await prisma.whatsAppTemplate.findFirst({
    where: { id: step.templateId, tenantId: enrollment.tenantId },
  });
  if (!template) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: `Template ${step.templateId} no longer exists in this tenant.`,
      },
    });
    return;
  }

  const compliance = await runComplianceCheck({
    tenantId: enrollment.tenantId,
    scope: ComplianceScope.DRIP_STEP,
    refId: enrollment.id,
    content: template.bodyText,
    useAi: true,
  });
  if (!compliance.decision.allowed) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: complianceStopMessage(compliance),
      },
    });
    return;
  }

  // Send-rate gate (per-tenant, per-phone). If we're throttled, defer
  // 60s and let the scan pick us up again.
  const throttleOpts = { phoneNumberId: tenant.wabaPhoneNumber };
  const gate = await canSendNow(enrollment.tenantId, throttleOpts);
  if (!gate.allowed) {
    const deferMs = gate.retryAfterMs ?? 60_000;
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: { nextStepAt: new Date(Date.now() + deferMs) },
    });
    return;
  }

  // Billing — if the wallet won't cover the cost, mark FAILED rather
  // than retry forever (operator will see lastError and recharge).
  try {
    await assertCanAffordMessage(enrollment.tenantId);
  } catch (err) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: (err as Error).message,
      },
    });
    return;
  }

  let metaMessageId: string | null = null;
  try {
    metaMessageId = await sendWhatsAppTemplate({
      tenantId: enrollment.tenantId,
      phoneNumberId: tenant.wabaPhoneNumber,
      accessToken,
      to: enrollment.contact.phoneNumber.replace(/^\+/, ""),
      templateName: template.name,
      languageCode: step.languageCode ?? template.language ?? "en_US",
      bodyParams: step.bodyParams,
    });
    await recordSend(enrollment.tenantId, throttleOpts);
    await debitMessage(enrollment.tenantId, metaMessageId, {
      reason: `DripSequence ${enrollment.sequence.id} step ${enrollment.currentStep + 1}`,
    });
  } catch (err) {
    await prisma.dripEnrollment.update({
      where: { id: enrollment.id },
      data: {
        failedCount: { increment: 1 },
        status: DripEnrollmentStatus.FAILED,
        nextStepAt: null,
        lastError: (err as Error).message,
      },
    });
    return;
  }

  // Mirror the campaign service: upsert the conversation + log the message
  // so the inbox shows the drip-driven send in context.
  try {
    const existingConvo = await prisma.conversation.findFirst({
      where: {
        tenantId: enrollment.tenantId,
        contactId: enrollment.contact.id,
        isActive: true,
      },
      select: { id: true },
    });
    const convo = existingConvo
      ? await prisma.conversation.update({
          where: { id: existingConvo.id },
          data: { lastMessageAt: new Date() },
        })
      : await prisma.conversation.create({
          data: {
            tenantId: enrollment.tenantId,
            contactId: enrollment.contact.id,
            isActive: true,
            lastMessageAt: new Date(),
          },
        });
    await prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: MessageDirection.OUTBOUND,
        status: MessageStatus.SENT,
        content: template.bodyText,
        templateId: template.id,
        metaMessageId,
      },
    });
  } catch (err) {
    // Non-fatal: the send succeeded, only the inbox log failed.
    console.error(
      `[drip:${enrollment.id}] message log failed:`,
      (err as Error).message,
    );
  }

  const nextIndex = enrollment.currentStep + 1;
  const isFinal = nextIndex >= steps.length;
  const data: Record<string, unknown> = {
    currentStep: nextIndex,
    sentCount: { increment: 1 },
    lastStepAt: new Date(),
    lastError: null,
  };
  if (isFinal) {
    data.status = DripEnrollmentStatus.COMPLETED;
    data.nextStepAt = null;
  } else {
    const nextDelayMs = steps[nextIndex].delayHours * 3600_000;
    data.nextStepAt = new Date(Date.now() + nextDelayMs);
  }
  await prisma.dripEnrollment.update({
    where: { id: enrollment.id },
    data,
  });
}

async function scanDueEnrollments(): Promise<number> {
  const due = await prisma.dripEnrollment.findMany({
    where: {
      status: DripEnrollmentStatus.RUNNING,
      nextStepAt: { lte: new Date() },
    },
    select: { id: true },
    // Keep batch size bounded so one scan can finish under the next tick.
    take: 200,
  });
  for (const row of due) {
    try {
      await processEnrollment(row.id);
    } catch (err) {
      // Defensive: never let one bad enrollment kill the scan.
      console.error(
        `[drip-worker] processEnrollment(${row.id}) threw:`,
        (err as Error).message,
      );
    }
  }
  return due.length;
}

// ----------------------------------------------------------------------------
// Worker lifecycle — single BullMQ scheduler that pings every minute and
// processes due enrollments. Hosting is the same as the campaign worker.
// ----------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 60_000;
const SCAN_JOB_NAME = "scan";

let dripWorker: Worker<DripJobData> | null = null;

export async function startDripWorker(): Promise<void> {
  if (dripWorker) return;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.warn(
      "[drip-worker] database unavailable; worker not started. Start Postgres and restart the API.",
    );
    return;
  }

  const q = getDripQueue();
  try {
    await q.removeJobScheduler(SCAN_JOB_NAME).catch(() => undefined);
    await q.upsertJobScheduler(
      SCAN_JOB_NAME,
      { every: SCAN_INTERVAL_MS },
      { name: SCAN_JOB_NAME, data: { kind: "scan" } },
    );
  } catch (err) {
    console.warn(
      "[drip-worker] could not register scan scheduler (Redis unavailable?)",
      (err as Error).message,
    );
    return;
  }

  dripWorker = new Worker<DripJobData>(
    QueueNames.DRIP_DISPATCH,
    async (job) => {
      if (job.name === SCAN_JOB_NAME) {
        const processed = await scanDueEnrollments();
        return { processed };
      }
      return { skipped: true };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );

  dripWorker.on("failed", (job, err) => {
    console.error(
      `[drip-worker] job ${job?.id} (${job?.name}) failed:`,
      err.message,
    );
  });

  trackWorker(dripWorker);
}

export function stopDripWorker(): void {
  if (!dripWorker) return;
  void dripWorker.close();
  dripWorker = null;
}
