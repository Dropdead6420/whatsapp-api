import { beforeEach, describe, expect, it, vi } from "vitest";

// T-052 slice 4 — inbound auto-reply helper. We mock the runner, the
// default-agent lookup, the WhatsApp send, the throttle, and wallet
// debit so we can exercise each gate independently.

const mocks = vi.hoisted(() => ({
  tenantFindUnique: vi.fn(),
  contactFindUnique: vi.fn(),
  messageFindMany: vi.fn(),
  messageCreate: vi.fn(),
  runAgent: vi.fn(),
  getDefaultAgent: vi.fn(),
  sendWhatsAppText: vi.fn(),
  canSendNow: vi.fn(),
  recordSend: vi.fn(),
  assertCanAffordMessage: vi.fn(),
  debitMessage: vi.fn(),
  decryptTokenIfNeeded: vi.fn(),
  dispatchAgentTool: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    tenant: { findUnique: mocks.tenantFindUnique },
    contact: { findUnique: mocks.contactFindUnique },
    message: {
      findMany: mocks.messageFindMany,
      create: mocks.messageCreate,
    },
  },
}));

vi.mock("./aiAgentRunner.service", () => ({ runAgent: mocks.runAgent }));
vi.mock("./aiAgent.service", () => ({ getDefaultAgent: mocks.getDefaultAgent }));
vi.mock("./whatsapp", () => ({ sendWhatsAppText: mocks.sendWhatsAppText }));
vi.mock("./sendThrottle.service", () => ({
  canSendNow: mocks.canSendNow,
  recordSend: mocks.recordSend,
}));
vi.mock("./billing.service", () => ({
  assertCanAffordMessage: mocks.assertCanAffordMessage,
  debitMessage: mocks.debitMessage,
}));
vi.mock("../lib/tokenCrypto", () => ({
  decryptTokenIfNeeded: mocks.decryptTokenIfNeeded,
}));
vi.mock("./aiAgentTool.service", () => ({
  dispatchAgentTool: mocks.dispatchAgentTool,
}));

import { maybeRunDefaultAgentReply } from "./aiAgentInbound.service";

const baseInput = {
  tenantId: "tenant_1",
  contactId: "contact_1",
  conversationId: "conv_1",
  text: "what hours are you open?",
};

const tenantOk = {
  aiAgentAutoReply: true,
  wabaPhoneNumber: "phone_1",
  wabaAccessToken: "enc:token",
};

const agentOk = {
  id: "agent_1",
  name: "Sales Bot",
  status: "ACTIVE",
};

const contactOk = { phoneNumber: "+1555", optedOut: false };

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  // Sensible defaults — each gate test overrides as needed.
  mocks.tenantFindUnique.mockResolvedValue(tenantOk);
  mocks.getDefaultAgent.mockResolvedValue(agentOk);
  mocks.contactFindUnique.mockResolvedValue(contactOk);
  mocks.messageFindMany.mockResolvedValue([
    { direction: "INBOUND", content: "what hours" },
  ]);
  mocks.canSendNow.mockResolvedValue({ allowed: true });
  mocks.assertCanAffordMessage.mockResolvedValue(undefined);
  mocks.decryptTokenIfNeeded.mockReturnValue("decrypted-token");
  mocks.sendWhatsAppText.mockResolvedValue("meta_msg_1");
  mocks.recordSend.mockResolvedValue(undefined);
  mocks.debitMessage.mockResolvedValue(undefined);
  mocks.messageCreate.mockResolvedValue({});
  mocks.runAgent.mockResolvedValue({
    reply: "We are open 9-5 Mon-Fri",
    toolCalls: [],
    citations: [],
    escalated: false,
    escalationBehavior: null,
    modelUsed: "m",
    providerUsed: "anthropic",
    reason: "ok",
  });
});

describe("maybeRunDefaultAgentReply — gates", () => {
  it("skips when tenant.aiAgentAutoReply is false", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      ...tenantOk,
      aiAgentAutoReply: false,
    });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out).toEqual({ fired: false, reason: "skipped_autoreply_off" });
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("skips when no default agent is configured", async () => {
    mocks.getDefaultAgent.mockResolvedValue(null);
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out).toEqual({ fired: false, reason: "skipped_no_default_agent" });
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("skips when contact is opted out", async () => {
    mocks.contactFindUnique.mockResolvedValue({
      ...contactOk,
      optedOut: true,
    });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.fired).toBe(false);
    expect(out.reason).toBe("skipped_contact_opted_out");
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("skips when WABA isn't configured", async () => {
    mocks.tenantFindUnique.mockResolvedValue({
      ...tenantOk,
      wabaPhoneNumber: null,
    });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_no_waba");
    expect(mocks.runAgent).not.toHaveBeenCalled();
  });

  it("skips when throttled", async () => {
    mocks.canSendNow.mockResolvedValue({ allowed: false, reason: "rate-limit" });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_throttled");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("skips when wallet has 402 (unfunded)", async () => {
    const { ApiError } = await import("@nexaflow/shared");
    mocks.assertCanAffordMessage.mockRejectedValue(
      new ApiError("PAYMENT_REQUIRED" as never, 402, "Wallet empty"),
    );
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_unfunded");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("skips when token decryption fails", async () => {
    mocks.decryptTokenIfNeeded.mockReturnValue(null);
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_token_decrypt_failed");
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("skips when the agent escalates instead of replying", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: null,
      toolCalls: [],
      citations: [],
      escalated: true,
      escalationBehavior: "ESCALATE_TO_HUMAN",
      modelUsed: null,
      providerUsed: null,
      reason: "fallback_llm_error",
    });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_agent_escalated");
    expect(out.fired).toBe(false);
    expect(mocks.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it("skips when the agent returns an empty reply (no tool, no text)", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "   ",
      toolCalls: [],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("skipped_agent_empty_reply");
  });

  it("marks send_failed when sendWhatsAppText throws", async () => {
    mocks.sendWhatsAppText.mockRejectedValue(new Error("meta 500"));
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.reason).toBe("send_failed");
    // recordSend / debitMessage must NOT run on send failure
    expect(mocks.recordSend).not.toHaveBeenCalled();
    expect(mocks.debitMessage).not.toHaveBeenCalled();
  });
});

describe("maybeRunDefaultAgentReply — happy path", () => {
  it("sends the reply and writes an OUTBOUND aiGenerated Message", async () => {
    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.fired).toBe(true);
    expect(out.reason).toBe("ok_sent");
    expect(out.reply).toBe("We are open 9-5 Mon-Fri");
    expect(out.metaMessageId).toBe("meta_msg_1");
    expect(out.agentId).toBe("agent_1");

    // Phone number stripped of + per Meta API rules
    expect(mocks.sendWhatsAppText.mock.calls[0][0].to).toBe("1555");
    expect(mocks.sendWhatsAppText.mock.calls[0][0].body).toBe(
      "We are open 9-5 Mon-Fri",
    );

    expect(mocks.recordSend).toHaveBeenCalledTimes(1);
    expect(mocks.debitMessage).toHaveBeenCalledWith(
      "tenant_1",
      "meta_msg_1",
      { reason: expect.stringContaining("Sales Bot") },
    );

    const msgData = mocks.messageCreate.mock.calls[0][0].data;
    expect(msgData.direction).toBe("OUTBOUND");
    expect(msgData.aiGenerated).toBe(true);
    expect(msgData.content).toBe("We are open 9-5 Mon-Fri");
  });

  it("dispatches tool calls (in background) when the agent returns any", async () => {
    mocks.runAgent.mockResolvedValue({
      reply: "noted",
      toolCalls: [{ tool: "CREATE_LEAD", arguments: { title: "Sid" } }],
      citations: [],
      escalated: false,
      escalationBehavior: null,
      modelUsed: "m",
      providerUsed: "anthropic",
      reason: "ok",
    });
    mocks.dispatchAgentTool.mockResolvedValue({
      ok: true,
      tool: "CREATE_LEAD",
      result: { leadId: "lead_1" },
    });

    const out = await maybeRunDefaultAgentReply(baseInput);
    expect(out.fired).toBe(true);
    // Tool dispatch is fire-and-forget — let the microtask queue drain
    // so the mock's call count stabilizes before we assert.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mocks.dispatchAgentTool).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchAgentTool.mock.calls[0][0].tenantId).toBe("tenant_1");
    expect(mocks.dispatchAgentTool.mock.calls[0][0].allowedTools).toEqual([
      "CREATE_LEAD",
    ]);
  });

  it("synthesizes a conversation from the input text when no Message rows exist", async () => {
    mocks.messageFindMany.mockResolvedValue([]); // empty conversation
    await maybeRunDefaultAgentReply(baseInput);
    expect(mocks.runAgent.mock.calls[0][0].conversation).toEqual([
      { role: "user", content: "what hours are you open?" },
    ]);
  });
});
