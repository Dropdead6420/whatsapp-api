import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageDirection, MessageStatus } from "@nexaflow/shared";

const mocks = vi.hoisted(() => ({
  messageFindUnique: vi.fn(),
  messageCreate: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    message: {
      findUnique: mocks.messageFindUnique,
      create: mocks.messageCreate,
    },
  },
}));

describe("whatsappWebhook.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies a valid Meta signature using the raw request body", async () => {
    const { verifyMetaSignature } = await import("./whatsappWebhook.service");
    const rawBody = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }));
    const secret = "test_meta_secret";
    const signature =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    expect(
      verifyMetaSignature(rawBody, signature, {
        secret,
        nodeEnv: "production",
      }),
    ).toBe(true);
  });

  it("rejects missing or invalid signatures when the secret is configured", async () => {
    const { verifyMetaSignature } = await import("./whatsappWebhook.service");
    const rawBody = Buffer.from("{}");

    expect(
      verifyMetaSignature(rawBody, undefined, {
        secret: "test_meta_secret",
        nodeEnv: "production",
      }),
    ).toBe(false);
    expect(
      verifyMetaSignature(rawBody, "sha256=bad", {
        secret: "test_meta_secret",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("allows local dev without a real Meta secret but fails closed in production", async () => {
    const { verifyMetaSignature } = await import("./whatsappWebhook.service");
    const rawBody = Buffer.from("{}");

    expect(
      verifyMetaSignature(rawBody, undefined, {
        secret: "your_meta_app_secret",
        nodeEnv: "development",
      }),
    ).toBe(true);
    expect(
      verifyMetaSignature(rawBody, undefined, {
        secret: "your_meta_app_secret",
        nodeEnv: "production",
      }),
    ).toBe(false);
  });

  it("detects already-processed Meta message ids before side effects", async () => {
    mocks.messageFindUnique.mockResolvedValue({ id: "msg_existing" });

    const { hasProcessedMetaMessage } = await import(
      "./whatsappWebhook.service"
    );

    await expect(hasProcessedMetaMessage("wamid.123")).resolves.toBe(true);
    expect(mocks.messageFindUnique).toHaveBeenCalledWith({
      where: { metaMessageId: "wamid.123" },
      select: { id: true },
    });
  });

  it("creates only one inbound message when Meta replays the same provider id", async () => {
    mocks.messageCreate
      .mockResolvedValueOnce({ id: "msg_1" })
      .mockRejectedValueOnce({ code: "P2002" });

    const { createInboundMessageOnce } = await import(
      "./whatsappWebhook.service"
    );

    await expect(
      createInboundMessageOnce({
        conversationId: "convo_1",
        content: "hello",
        metaMessageId: "wamid.123",
      }),
    ).resolves.toEqual({ id: "msg_1" });
    await expect(
      createInboundMessageOnce({
        conversationId: "convo_1",
        content: "hello",
        metaMessageId: "wamid.123",
      }),
    ).resolves.toBeNull();

    expect(mocks.messageCreate).toHaveBeenCalledTimes(2);
    expect(mocks.messageCreate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        conversationId: "convo_1",
        direction: MessageDirection.INBOUND,
        status: MessageStatus.DELIVERED,
        content: "hello",
        metaMessageId: "wamid.123",
      }),
    });
  });
});
