import { prisma, LeadStatus } from "@nexaflow/db";
import { pickNextAgent } from "./routing.service";

// T-052 slice 3: AI Agent tool dispatch.
//
// The runner (slice 2) returns `toolCalls: [{tool, arguments}]` without
// executing anything. This service is the bridge: given a tool key +
// arguments, it calls the appropriate existing service or writes the
// appropriate Prisma record. It NEVER bypasses the agent's allowlist —
// the caller MUST pass `allowedTools` (from `agent.tools`) and we
// reject anything outside it as defense in depth, even though the
// runner already filters.
//
// Design — every handler:
//   - Is tenant-scoped (only writes to ctx.tenantId; refuses if the
//     requested entity belongs to a different tenant)
//   - Returns `{ok: true, result}` or `{ok: false, error: string}`
//     — no throws into the caller. The flow node catches this and
//     puts the result into a flow variable so downstream nodes can
//     branch on success/failure.
//   - Is side-effect-only on the happy path. We don't currently send
//     WhatsApp messages from tools (the agent's text reply handles
//     the "what we say"; tools handle the "what we do"). SEND_TEMPLATE
//     is the lone exception and intentionally minimal.
//
// Adding a new tool: extend `ALLOWED_TOOLS` in aiAgent.service AND add
// a case below. Failing to do both yields a "Tool X is not in the
// agent's allowlist" error from this dispatcher, surfacing the gap
// at write-time rather than at run-time.

export interface ToolDispatchContext {
  tenantId: string;
  contactId: string | null;
  conversationId: string | null;
  allowedTools: string[];
}

export interface ToolDispatchInput {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolDispatchSuccess {
  ok: true;
  tool: string;
  result: Record<string, unknown>;
}

export interface ToolDispatchFailure {
  ok: false;
  tool: string;
  error: string;
}

export type ToolDispatchResult = ToolDispatchSuccess | ToolDispatchFailure;

function readString(args: Record<string, unknown>, key: string): string | null {
  const v = args[key];
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length ? trimmed : null;
}

function fail(tool: string, error: string): ToolDispatchFailure {
  return { ok: false, tool, error };
}
function ok(tool: string, result: Record<string, unknown>): ToolDispatchSuccess {
  return { ok: true, tool, result };
}

// --------------------------------------------------------------------------
// Tool implementations
// --------------------------------------------------------------------------

async function createLead(
  ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  if (!ctx.contactId) {
    return fail("CREATE_LEAD", "No contact in context.");
  }
  const title = readString(args, "title") ?? "Lead from AI agent";
  // Schema uses `description`, not `notes` — accept either arg name
  // from the model since training data leans on "notes".
  const description = readString(args, "description") ?? readString(args, "notes");
  try {
    const lead = await prisma.lead.create({
      data: {
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        title,
        status: LeadStatus.NEW,
        ...(description ? { description } : {}),
      },
    });
    return ok("CREATE_LEAD", { leadId: lead.id, title: lead.title });
  } catch (err) {
    return fail(
      "CREATE_LEAD",
      err instanceof Error ? err.message : "Failed to create lead.",
    );
  }
}

async function addTag(
  ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  if (!ctx.contactId) return fail("ADD_TAG", "No contact in context.");
  const tag = readString(args, "tag");
  if (!tag) return fail("ADD_TAG", "Missing 'tag' argument.");
  // Reuse the contact model directly (mirrors flow ADD_TAG handler).
  const contact = await prisma.contact.findFirst({
    where: { id: ctx.contactId, tenantId: ctx.tenantId },
  });
  if (!contact) return fail("ADD_TAG", "Contact not found in tenant scope.");
  if (contact.tags.includes(tag)) {
    return ok("ADD_TAG", { tag, alreadyPresent: true });
  }
  await prisma.contact.update({
    where: { id: contact.id },
    data: { tags: [...contact.tags, tag] },
  });
  return ok("ADD_TAG", { tag, alreadyPresent: false });
}

async function bookAppointment(
  ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  if (!ctx.contactId) {
    return fail("BOOK_APPOINTMENT", "No contact in context.");
  }
  const serviceId = readString(args, "serviceId");
  // Accept both arg names: schema uses `scheduledAt`, but the model
  // training data biases toward `startAt`. Either is fine.
  const scheduledAtRaw =
    readString(args, "scheduledAt") ?? readString(args, "startAt");
  if (!serviceId) {
    return fail("BOOK_APPOINTMENT", "Missing 'serviceId' argument.");
  }
  if (!scheduledAtRaw) {
    return fail("BOOK_APPOINTMENT", "Missing 'scheduledAt' (or 'startAt') argument.");
  }
  const scheduledAt = new Date(scheduledAtRaw);
  if (Number.isNaN(scheduledAt.getTime())) {
    return fail("BOOK_APPOINTMENT", "'scheduledAt' must be an ISO datetime.");
  }
  // Tenant-scope check — the service must belong to the same tenant or
  // the agent could book against another tenant's services.
  const service = await prisma.service.findFirst({
    where: { id: serviceId, tenantId: ctx.tenantId },
  });
  if (!service) {
    return fail(
      "BOOK_APPOINTMENT",
      "Service not found or belongs to another tenant.",
    );
  }
  const durationMinutes =
    typeof args.durationMinutes === "number"
      ? Math.floor(args.durationMinutes)
      : service.durationMinutes;
  try {
    const appointment = await prisma.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        contactId: ctx.contactId,
        serviceId: service.id,
        scheduledAt,
        durationMinutes,
        status: "PENDING",
        source: "WHATSAPP_FLOW",
        notes: readString(args, "notes") ?? undefined,
      },
    });
    return ok("BOOK_APPOINTMENT", {
      appointmentId: appointment.id,
      scheduledAt: appointment.scheduledAt.toISOString(),
      durationMinutes: appointment.durationMinutes,
    });
  } catch (err) {
    return fail(
      "BOOK_APPOINTMENT",
      err instanceof Error ? err.message : "Failed to create appointment.",
    );
  }
}

async function transferToHuman(
  ctx: ToolDispatchContext,
  _args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  if (!ctx.conversationId) {
    return fail("TRANSFER_TO_HUMAN", "No conversation in context.");
  }
  const agentId = await pickNextAgent(ctx.tenantId);
  if (!agentId) {
    return fail("TRANSFER_TO_HUMAN", "No eligible human agent available.");
  }
  await prisma.conversation.update({
    where: { id: ctx.conversationId },
    data: { agentId },
  });
  return ok("TRANSFER_TO_HUMAN", { assignedAgentId: agentId });
}

async function lookupContact(
  ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  const phone = readString(args, "phone");
  const email = readString(args, "email");
  if (!phone && !email) {
    return fail("LOOKUP_CONTACT", "Provide 'phone' or 'email'.");
  }
  const contact = await prisma.contact.findFirst({
    where: {
      tenantId: ctx.tenantId,
      ...(phone ? { phoneNumber: phone } : {}),
      ...(email ? { email } : {}),
    },
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      tags: true,
    },
  });
  if (!contact) return ok("LOOKUP_CONTACT", { found: false });
  return ok("LOOKUP_CONTACT", { found: true, ...contact });
}

async function lookupOrder(
  _ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  // We don't have an Order model yet (T-051+T-052 don't require it). This
  // returns a controlled "not implemented" response so the model can
  // gracefully escalate rather than seeing a 500. When an integrations
  // slice adds Shopify/WooCommerce, this becomes a real lookup.
  const orderId = readString(args, "orderId");
  if (!orderId) return fail("LOOKUP_ORDER", "Missing 'orderId' argument.");
  return ok("LOOKUP_ORDER", {
    found: false,
    reason: "Order lookup is not connected to an e-commerce integration yet.",
  });
}

async function sendTemplate(
  ctx: ToolDispatchContext,
  args: Record<string, unknown>,
): Promise<ToolDispatchResult> {
  const templateName = readString(args, "templateName");
  if (!templateName) {
    return fail("SEND_TEMPLATE", "Missing 'templateName' argument.");
  }
  // Tool dispatch only verifies the template exists for this tenant.
  // Actually firing the WhatsApp template send is handled by the
  // existing SEND_TEMPLATE flow node — operators wire AI_AGENT → SEND_TEMPLATE
  // when they want the agent to trigger one. Doing the send here would
  // duplicate the WABA / throttle / wallet plumbing.
  const template = await prisma.whatsAppTemplate.findFirst({
    where: { tenantId: ctx.tenantId, name: templateName },
    select: { id: true, name: true, status: true },
  });
  if (!template) {
    return fail("SEND_TEMPLATE", `Template "${templateName}" not found.`);
  }
  return ok("SEND_TEMPLATE", {
    templateId: template.id,
    templateName: template.name,
    status: template.status,
    note: "Template resolved; wire AI_AGENT → SEND_TEMPLATE flow node to actually send.",
  });
}

// --------------------------------------------------------------------------
// Public dispatcher
// --------------------------------------------------------------------------

const TOOL_REGISTRY: Record<
  string,
  (ctx: ToolDispatchContext, args: Record<string, unknown>) => Promise<ToolDispatchResult>
> = {
  CREATE_LEAD: createLead,
  ADD_TAG: addTag,
  BOOK_APPOINTMENT: bookAppointment,
  TRANSFER_TO_HUMAN: transferToHuman,
  LOOKUP_CONTACT: lookupContact,
  LOOKUP_ORDER: lookupOrder,
  SEND_TEMPLATE: sendTemplate,
};

export async function dispatchAgentTool(
  ctx: ToolDispatchContext,
  input: ToolDispatchInput,
): Promise<ToolDispatchResult> {
  const toolKey = input.tool.toUpperCase();

  // Defense-in-depth: even though the runner filters tool calls against
  // the agent's allowlist, the dispatcher independently rejects anything
  // not on `ctx.allowedTools`. The two layers exist so an operator who
  // calls dispatchAgentTool directly (e.g. from a custom flow node)
  // can't accidentally bypass the agent's permissions.
  if (!ctx.allowedTools.includes(toolKey)) {
    return fail(toolKey, `Tool ${toolKey} is not in the agent's allowlist.`);
  }
  const impl = TOOL_REGISTRY[toolKey];
  if (!impl) {
    return fail(toolKey, `Tool ${toolKey} has no registered handler.`);
  }
  try {
    return await impl(ctx, input.arguments ?? {});
  } catch (err) {
    return fail(toolKey, err instanceof Error ? err.message : String(err));
  }
}

export const __test__ = { TOOL_REGISTRY };
