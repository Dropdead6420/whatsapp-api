import {
  prisma,
  SupportTicketPriority,
  SupportTicketSenderType,
  SupportTicketStatus,
} from "@nexaflow/db";
import { ApiError, ErrorCodes, TenantType } from "@nexaflow/shared";

// ----------------------------------------------------------------------------
// Tenant scoping helpers
// ----------------------------------------------------------------------------

/**
 * Returns the list of child tenant IDs owned by a partner. We use this to
 * scope partner-facing queries: a partner sees tickets raised by any
 * customer tenant under their reseller umbrella.
 */
async function childTenantIdsForPartner(partnerTenantId: string): Promise<string[]> {
  const rows = await prisma.tenant.findMany({
    where: { parentTenantId: partnerTenantId, type: TenantType.BUSINESS },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** Throws 404 if the ticket isn't visible to the partner. */
async function assertPartnerCanSeeTicket(
  partnerTenantId: string,
  ticketId: string,
) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, tenantId: true, tenant: { select: { parentTenantId: true } } },
  });
  if (!ticket || ticket.tenant.parentTenantId !== partnerTenantId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Support ticket not found.");
  }
  return ticket;
}

/** Throws 404 if the ticket isn't owned by the given customer tenant. */
async function assertCustomerOwnsTicket(tenantId: string, ticketId: string) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, tenantId: true },
  });
  if (!ticket || ticket.tenantId !== tenantId) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Support ticket not found.");
  }
  return ticket;
}

// ----------------------------------------------------------------------------
// Partner-side reads (white-label admin viewing all child-tenant tickets)
// ----------------------------------------------------------------------------

export interface PartnerTicketListFilter {
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
}

export async function listPartnerTickets(
  partnerTenantId: string,
  filter: PartnerTicketListFilter = {},
) {
  const childIds = await childTenantIdsForPartner(partnerTenantId);
  if (childIds.length === 0) return [];

  return prisma.supportTicket.findMany({
    where: {
      tenantId: { in: childIds },
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      tenant: { select: { id: true, name: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function getPartnerTicket(
  partnerTenantId: string,
  ticketId: string,
) {
  await assertPartnerCanSeeTicket(partnerTenantId, ticketId);
  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      tenant: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "asc" },
        // Internal notes are partner-only — included here, filtered out
        // in the customer-side serializer below.
      },
    },
  });
}

export async function partnerReplyToTicket(args: {
  partnerTenantId: string;
  partnerUserId: string;
  ticketId: string;
  content: string;
  internalNote?: boolean;
}) {
  await assertPartnerCanSeeTicket(args.partnerTenantId, args.ticketId);
  const content = args.content.trim();
  if (!content) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Reply content cannot be empty.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const message = await tx.supportTicketMessage.create({
      data: {
        ticketId: args.ticketId,
        senderType: SupportTicketSenderType.PARTNER,
        senderUserId: args.partnerUserId,
        content,
        internalNote: Boolean(args.internalNote),
      },
    });
    if (!args.internalNote) {
      await tx.supportTicket.update({
        where: { id: args.ticketId },
        data: {
          status: SupportTicketStatus.PENDING_CUSTOMER,
          lastRepliedByUserId: args.partnerUserId,
          lastRepliedAt: message.createdAt,
        },
      });
    }
    return message;
  });
}

export async function updatePartnerTicket(args: {
  partnerTenantId: string;
  ticketId: string;
  status?: SupportTicketStatus;
  priority?: SupportTicketPriority;
}) {
  await assertPartnerCanSeeTicket(args.partnerTenantId, args.ticketId);

  const data: {
    status?: SupportTicketStatus;
    priority?: SupportTicketPriority;
    resolvedAt?: Date | null;
    closedAt?: Date | null;
  } = {};
  if (args.status) {
    data.status = args.status;
    if (args.status === SupportTicketStatus.RESOLVED) {
      data.resolvedAt = new Date();
    } else if (args.status === SupportTicketStatus.CLOSED) {
      data.closedAt = new Date();
    } else if (
      args.status === SupportTicketStatus.OPEN ||
      args.status === SupportTicketStatus.NEW
    ) {
      // Re-opening clears resolution/closure stamps so the timeline
      // reflects the current state.
      data.resolvedAt = null;
      data.closedAt = null;
    }
  }
  if (args.priority) data.priority = args.priority;

  return prisma.supportTicket.update({ where: { id: args.ticketId }, data });
}

// ----------------------------------------------------------------------------
// Customer-side (BUSINESS tenant creating + reading their own tickets)
// ----------------------------------------------------------------------------

export async function listCustomerTickets(tenantId: string) {
  return prisma.supportTicket.findMany({
    where: { tenantId },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: { _count: { select: { messages: true } } },
  });
}

export async function getCustomerTicket(tenantId: string, ticketId: string) {
  await assertCustomerOwnsTicket(tenantId, ticketId);
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      messages: {
        // Customers must never see partner-only internal notes.
        where: { internalNote: false },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return ticket;
}

export async function createCustomerTicket(args: {
  tenantId: string;
  createdByUserId: string;
  subject: string;
  priority?: SupportTicketPriority;
  initialMessage: string;
}) {
  const subject = args.subject.trim();
  const initialMessage = args.initialMessage.trim();
  if (!subject || !initialMessage) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Subject and initial message are required.",
    );
  }

  return prisma.supportTicket.create({
    data: {
      tenantId: args.tenantId,
      subject,
      priority: args.priority ?? SupportTicketPriority.MEDIUM,
      status: SupportTicketStatus.NEW,
      createdByUserId: args.createdByUserId,
      messages: {
        create: {
          senderType: SupportTicketSenderType.CUSTOMER,
          senderUserId: args.createdByUserId,
          content: initialMessage,
        },
      },
    },
    include: { messages: true },
  });
}

export async function customerReplyToTicket(args: {
  tenantId: string;
  userId: string;
  ticketId: string;
  content: string;
}) {
  await assertCustomerOwnsTicket(args.tenantId, args.ticketId);
  const content = args.content.trim();
  if (!content) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Reply content cannot be empty.",
    );
  }

  return prisma.$transaction(async (tx) => {
    const message = await tx.supportTicketMessage.create({
      data: {
        ticketId: args.ticketId,
        senderType: SupportTicketSenderType.CUSTOMER,
        senderUserId: args.userId,
        content,
        // Customer reply is never an internal note.
        internalNote: false,
      },
    });
    // Customer reply re-opens a pending-customer ticket and bumps the
    // partner-side queue ordering.
    await tx.supportTicket.update({
      where: { id: args.ticketId },
      data: { status: SupportTicketStatus.OPEN },
    });
    return message;
  });
}
