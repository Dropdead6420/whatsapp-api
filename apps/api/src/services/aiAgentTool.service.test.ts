import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  leadCreate: vi.fn(),
  contactFindFirst: vi.fn(),
  contactUpdate: vi.fn(),
  serviceFindFirst: vi.fn(),
  appointmentCreate: vi.fn(),
  conversationUpdate: vi.fn(),
  whatsAppTemplateFindFirst: vi.fn(),
  pickNextAgent: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    lead: { create: mocks.leadCreate },
    contact: {
      findFirst: mocks.contactFindFirst,
      update: mocks.contactUpdate,
    },
    service: { findFirst: mocks.serviceFindFirst },
    appointment: { create: mocks.appointmentCreate },
    conversation: { update: mocks.conversationUpdate },
    whatsAppTemplate: { findFirst: mocks.whatsAppTemplateFindFirst },
  },
  LeadStatus: { NEW: "NEW" },
}));

vi.mock("./routing.service", () => ({
  pickNextAgent: mocks.pickNextAgent,
}));

import { dispatchAgentTool } from "./aiAgentTool.service";

const ALL_TOOLS = [
  "CREATE_LEAD",
  "ADD_TAG",
  "BOOK_APPOINTMENT",
  "TRANSFER_TO_HUMAN",
  "LOOKUP_CONTACT",
  "LOOKUP_ORDER",
  "SEND_TEMPLATE",
];

const baseCtx = {
  tenantId: "tenant_1",
  contactId: "contact_1",
  conversationId: "conv_1",
  allowedTools: ALL_TOOLS,
};

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
});

describe("aiAgentTool.dispatchAgentTool", () => {
  it("rejects tools NOT in ctx.allowedTools (defense-in-depth)", async () => {
    const out = await dispatchAgentTool(
      { ...baseCtx, allowedTools: ["ADD_TAG"] },
      { tool: "CREATE_LEAD", arguments: {} },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/not in the agent's allowlist/);
    expect(mocks.leadCreate).not.toHaveBeenCalled();
  });

  it("rejects unknown tool keys", async () => {
    const out = await dispatchAgentTool(
      { ...baseCtx, allowedTools: ["MYSTERY_TOOL"] },
      { tool: "MYSTERY_TOOL", arguments: {} },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/no registered handler/);
  });

  // ---- CREATE_LEAD ----
  it("CREATE_LEAD writes a NEW lead with title + description", async () => {
    mocks.leadCreate.mockResolvedValue({
      id: "lead_1",
      title: "Sid wants pricing",
    });
    const out = await dispatchAgentTool(baseCtx, {
      tool: "CREATE_LEAD",
      arguments: { title: "Sid wants pricing", notes: "From WhatsApp DM" },
    });
    expect(out.ok).toBe(true);
    expect(mocks.leadCreate).toHaveBeenCalledTimes(1);
    const args = mocks.leadCreate.mock.calls[0][0];
    expect(args.data.tenantId).toBe("tenant_1");
    expect(args.data.contactId).toBe("contact_1");
    expect(args.data.status).toBe("NEW");
    // notes maps to schema's `description` field
    expect(args.data.description).toBe("From WhatsApp DM");
    expect(out.ok === true && out.result.leadId).toBe("lead_1");
  });

  it("CREATE_LEAD fails fast when no contactId in context", async () => {
    const out = await dispatchAgentTool(
      { ...baseCtx, contactId: null },
      { tool: "CREATE_LEAD", arguments: { title: "X" } },
    );
    expect(out.ok).toBe(false);
    expect(mocks.leadCreate).not.toHaveBeenCalled();
  });

  // ---- ADD_TAG ----
  it("ADD_TAG appends the tag when not already present", async () => {
    mocks.contactFindFirst.mockResolvedValue({
      id: "contact_1",
      tags: ["existing"],
    });
    mocks.contactUpdate.mockResolvedValue({});
    const out = await dispatchAgentTool(baseCtx, {
      tool: "ADD_TAG",
      arguments: { tag: "interested" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.alreadyPresent).toBe(false);
    expect(mocks.contactUpdate).toHaveBeenCalledWith({
      where: { id: "contact_1" },
      data: { tags: ["existing", "interested"] },
    });
  });

  it("ADD_TAG is idempotent when the tag is already present", async () => {
    mocks.contactFindFirst.mockResolvedValue({
      id: "contact_1",
      tags: ["interested"],
    });
    const out = await dispatchAgentTool(baseCtx, {
      tool: "ADD_TAG",
      arguments: { tag: "interested" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.alreadyPresent).toBe(true);
    expect(mocks.contactUpdate).not.toHaveBeenCalled();
  });

  it("ADD_TAG refuses when the contact belongs to another tenant", async () => {
    // findFirst returns null because the where{id, tenantId} doesn't match
    mocks.contactFindFirst.mockResolvedValue(null);
    const out = await dispatchAgentTool(baseCtx, {
      tool: "ADD_TAG",
      arguments: { tag: "interested" },
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/tenant scope/);
  });

  // ---- BOOK_APPOINTMENT ----
  it("BOOK_APPOINTMENT validates serviceId is tenant-scoped before creating", async () => {
    // Wrong tenant: findFirst returns null
    mocks.serviceFindFirst.mockResolvedValue(null);
    const out = await dispatchAgentTool(baseCtx, {
      tool: "BOOK_APPOINTMENT",
      arguments: {
        serviceId: "service_X",
        scheduledAt: "2026-06-01T10:00:00Z",
      },
    });
    expect(out.ok).toBe(false);
    expect(mocks.appointmentCreate).not.toHaveBeenCalled();
  });

  it("BOOK_APPOINTMENT happy path writes scheduledAt + durationMinutes", async () => {
    mocks.serviceFindFirst.mockResolvedValue({
      id: "service_1",
      tenantId: "tenant_1",
      durationMinutes: 45,
    });
    mocks.appointmentCreate.mockResolvedValue({
      id: "appt_1",
      scheduledAt: new Date("2026-06-01T10:00:00Z"),
      durationMinutes: 45,
    });
    const out = await dispatchAgentTool(baseCtx, {
      tool: "BOOK_APPOINTMENT",
      arguments: {
        serviceId: "service_1",
        startAt: "2026-06-01T10:00:00Z", // model used legacy `startAt`
      },
    });
    expect(out.ok).toBe(true);
    expect(mocks.appointmentCreate.mock.calls[0][0].data.scheduledAt).toBeInstanceOf(
      Date,
    );
    expect(mocks.appointmentCreate.mock.calls[0][0].data.source).toBe(
      "WHATSAPP_FLOW",
    );
    expect(out.ok === true && out.result.appointmentId).toBe("appt_1");
  });

  it("BOOK_APPOINTMENT rejects unparseable scheduledAt", async () => {
    const out = await dispatchAgentTool(baseCtx, {
      tool: "BOOK_APPOINTMENT",
      arguments: { serviceId: "s1", scheduledAt: "not-a-date" },
    });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toMatch(/ISO datetime/);
  });

  // ---- TRANSFER_TO_HUMAN ----
  it("TRANSFER_TO_HUMAN assigns conversation to the next eligible agent", async () => {
    mocks.pickNextAgent.mockResolvedValue("user_42");
    mocks.conversationUpdate.mockResolvedValue({});
    const out = await dispatchAgentTool(baseCtx, {
      tool: "TRANSFER_TO_HUMAN",
      arguments: {},
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.assignedAgentId).toBe("user_42");
    expect(mocks.conversationUpdate).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { agentId: "user_42" },
    });
  });

  it("TRANSFER_TO_HUMAN fails when no agent is available", async () => {
    mocks.pickNextAgent.mockResolvedValue(null);
    const out = await dispatchAgentTool(baseCtx, {
      tool: "TRANSFER_TO_HUMAN",
      arguments: {},
    });
    expect(out.ok).toBe(false);
    expect(mocks.conversationUpdate).not.toHaveBeenCalled();
  });

  // ---- LOOKUP_CONTACT ----
  it("LOOKUP_CONTACT returns the contact when found by phone", async () => {
    mocks.contactFindFirst.mockResolvedValue({
      id: "contact_X",
      name: "Sid",
      phoneNumber: "+1",
      email: null,
      tags: ["vip"],
    });
    const out = await dispatchAgentTool(baseCtx, {
      tool: "LOOKUP_CONTACT",
      arguments: { phone: "+1" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.found).toBe(true);
    expect(out.ok === true && out.result.id).toBe("contact_X");
  });

  it("LOOKUP_CONTACT returns {found:false} when nothing matches", async () => {
    mocks.contactFindFirst.mockResolvedValue(null);
    const out = await dispatchAgentTool(baseCtx, {
      tool: "LOOKUP_CONTACT",
      arguments: { phone: "+999" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.found).toBe(false);
  });

  // ---- LOOKUP_ORDER ----
  it("LOOKUP_ORDER returns controlled not-implemented (no integration yet)", async () => {
    const out = await dispatchAgentTool(baseCtx, {
      tool: "LOOKUP_ORDER",
      arguments: { orderId: "ORD-1" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.found).toBe(false);
    expect(out.ok === true && out.result.reason).toMatch(/integration/);
  });

  // ---- SEND_TEMPLATE ----
  it("SEND_TEMPLATE only resolves the template (does not actually send)", async () => {
    mocks.whatsAppTemplateFindFirst.mockResolvedValue({
      id: "tpl_1",
      name: "welcome",
      status: "APPROVED",
    });
    const out = await dispatchAgentTool(baseCtx, {
      tool: "SEND_TEMPLATE",
      arguments: { templateName: "welcome" },
    });
    expect(out.ok).toBe(true);
    expect(out.ok === true && out.result.templateId).toBe("tpl_1");
    // Note text reminds operators to use the SEND_TEMPLATE flow node
    expect(out.ok === true && out.result.note).toMatch(/flow node/);
  });

  it("SEND_TEMPLATE fails when the template isn't in the tenant scope", async () => {
    mocks.whatsAppTemplateFindFirst.mockResolvedValue(null);
    const out = await dispatchAgentTool(baseCtx, {
      tool: "SEND_TEMPLATE",
      arguments: { templateName: "missing" },
    });
    expect(out.ok).toBe(false);
  });
});
