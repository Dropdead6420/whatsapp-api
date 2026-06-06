import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

// =====================================================================
// CDP unified timeline (Complete Planning PDF §2.12 / Phase 9). Merges a
// contact's cross-source activity — WhatsApp conversations, calls,
// appointments and leads — into one chronological feed. Pure merge/sort is
// split out for unit testing; the DB layer fetches each source scoped to
// the contact (which is verified to belong to the caller's tenant).
// =====================================================================

export type TimelineEventType = "conversation" | "call" | "appointment" | "lead";

export interface TimelineEvent {
  type: TimelineEventType;
  at: Date;
  title: string;
  detail?: string;
  sourceId: string;
}

/** Drop events with no timestamp, sort newest-first, cap to `limit`. Pure. */
export function mergeTimeline(events: TimelineEvent[], limit = 50): TimelineEvent[] {
  return events
    .filter((e) => e.at instanceof Date && !Number.isNaN(e.at.getTime()))
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export async function getContactTimeline(
  tenantId: string,
  contactId: string,
  limit = 50,
): Promise<{ contactId: string; events: TimelineEvent[] }> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true },
  });
  if (!contact) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
  }

  const [conversations, calls, appointments, leads] = await Promise.all([
    prisma.conversation.findMany({
      where: { contactId },
      select: { id: true, lastMessageAt: true, createdAt: true },
      orderBy: { lastMessageAt: "desc" },
      take: 50,
    }),
    prisma.callLog.findMany({
      where: { tenantId, contactId },
      select: { id: true, direction: true, status: true, durationSeconds: true, startedAt: true, createdAt: true },
      orderBy: { startedAt: "desc" },
      take: 50,
    }),
    prisma.appointment.findMany({
      where: { contactId },
      select: { id: true, status: true, scheduledAt: true },
      orderBy: { scheduledAt: "desc" },
      take: 50,
    }),
    prisma.lead.findMany({
      where: { contactId },
      select: { id: true, title: true, status: true, value: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const events: TimelineEvent[] = [
    ...conversations.map((c) => ({
      type: "conversation" as const,
      at: c.lastMessageAt ?? c.createdAt,
      title: "WhatsApp conversation",
      sourceId: c.id,
    })),
    ...calls.map((c) => ({
      type: "call" as const,
      at: c.startedAt ?? c.createdAt,
      title: `${c.direction === "INBOUND" ? "Inbound" : "Outbound"} call`,
      detail: `${c.status.toLowerCase().replace(/_/g, " ")} · ${c.durationSeconds}s`,
      sourceId: c.id,
    })),
    ...appointments.map((a) => ({
      type: "appointment" as const,
      at: a.scheduledAt,
      title: "Appointment",
      detail: a.status,
      sourceId: a.id,
    })),
    ...leads.map((l) => ({
      type: "lead" as const,
      at: l.createdAt,
      title: `Lead: ${l.title}`,
      detail: l.value != null ? `${l.status} · ${l.value}` : l.status,
      sourceId: l.id,
    })),
  ];

  return { contactId, events: mergeTimeline(events, limit) };
}
