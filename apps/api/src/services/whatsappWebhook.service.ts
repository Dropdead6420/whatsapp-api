import crypto from "node:crypto";
import { prisma } from "@nexaflow/db";
import { MessageDirection, MessageStatus } from "@nexaflow/shared";

function hasConfiguredSecret(secret: string | undefined): secret is string {
  return Boolean(
    secret &&
      !secret.startsWith("your_") &&
      secret !== "meta_app_secret_placeholder",
  );
}

export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  opts: {
    secret?: string;
    nodeEnv?: string;
  } = {},
): boolean {
  const secret = opts.secret ?? process.env.META_APP_SECRET;
  const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;

  if (!hasConfiguredSecret(secret)) {
    return nodeEnv !== "production";
  }
  if (!rawBody || rawBody.length === 0) return false;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const sigBuf = Buffer.from(signatureHeader, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expectedBuf.length) return false;

  try {
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function hasProcessedMetaMessage(
  metaMessageId: string | null | undefined,
): Promise<boolean> {
  if (!metaMessageId) return false;
  const existing = await prisma.message.findUnique({
    where: { metaMessageId },
    select: { id: true },
  });
  return Boolean(existing);
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export async function createInboundMessageOnce(input: {
  conversationId: string;
  content: string;
  metaMessageId?: string | null;
}) {
  try {
    return await prisma.message.create({
      data: {
        conversationId: input.conversationId,
        direction: MessageDirection.INBOUND,
        status: MessageStatus.DELIVERED,
        content: input.content,
        deliveredAt: new Date(),
        metaMessageId: input.metaMessageId ?? null,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return null;
    }
    throw err;
  }
}
