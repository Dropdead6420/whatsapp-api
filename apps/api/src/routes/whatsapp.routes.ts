import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  MessageDirection,
  MessageStatus,
  MetaWebhookBody,
  Permissions,
} from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  verifyMetaWebhookSubscription,
} from "../services/whatsapp.service";
import { pickNextAgent } from "../services/routing.service";
import { scoreLead } from "../services/ai.service";
import { assertCanSend, recordSend } from "../services/sendThrottle.service";
import { findFlowForInbound, startFlowRun } from "../services/flow/engine";
import { emitWebhookEvent } from "../services/webhook.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  getWhatsAppConfig,
  syncWhatsAppBusinessStatus,
  updateWhatsAppConfig,
} from "../services/whatsappConfig.service";

const router = Router();

// ----------------------------------------------------------------------------
// PUBLIC: Meta webhook verification (GET) + delivery (POST)
// Mounted before auth middleware in index.ts via a separate path.
// ----------------------------------------------------------------------------

export const webhookRouter = Router();

webhookRouter.get("/", (req: Request, res: Response) => {
  const challenge = verifyMetaWebhookSubscription(
    req.query["hub.mode"] as string | undefined,
    req.query["hub.verify_token"] as string | undefined,
    req.query["hub.challenge"] as string | undefined,
  );
  if (challenge) {
    res.status(200).send(challenge);
    return;
  }
  res.status(403).send("Forbidden");
});

webhookRouter.post("/", async (req: Request, res: Response) => {
  // Always 200 to Meta first so they stop retrying; process async.
  res.status(200).send("EVENT_RECEIVED");

  try {
    const body = req.body as MetaWebhookBody;
    if (!body?.entry) return;

    for (const entry of body.entry) {
      for (const change of entry.changes ?? []) {
        const phoneNumberId = change.value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const tenant = await prisma.tenant.findFirst({
          where: { wabaPhoneNumber: phoneNumberId },
        });
        if (!tenant) continue;

        // Inbound messages
        for (const msg of change.value.messages ?? []) {
          const profileName =
            change.value.contacts?.find((c) => c.wa_id === msg.from)?.profile.name ??
            msg.from;

          const contactExisted = await prisma.contact.findUnique({
            where: {
              tenantId_phoneNumber: {
                tenantId: tenant.id,
                phoneNumber: `+${msg.from}`,
              },
            },
            select: { id: true, aiScore: true },
          });

          const contact = await prisma.contact.upsert({
            where: {
              tenantId_phoneNumber: {
                tenantId: tenant.id,
                phoneNumber: `+${msg.from}`,
              },
            },
            update: { lastInteractionAt: new Date() },
            create: {
              tenantId: tenant.id,
              phoneNumber: `+${msg.from}`,
              name: profileName,
              tags: [],
              lastInteractionAt: new Date(),
            },
          });

          const existingConvo = await prisma.conversation.findFirst({
            where: {
              tenantId: tenant.id,
              contactId: contact.id,
              isActive: true,
            },
            select: { id: true, agentId: true },
          });

          // Auto-assign on new conversations or when no agent is on it.
          let assignedAgentId = existingConvo?.agentId ?? null;
          if (!assignedAgentId) {
            assignedAgentId = await pickNextAgent(tenant.id);
          }

          const now = new Date();
          const conversation = await prisma.conversation.upsert({
            where: { id: existingConvo?.id ?? "____none____" },
            update: {
              lastMessageAt: now,
              lastInboundAt: now,
              agentId: assignedAgentId ?? undefined,
              // A new inbound after the previous SLA was breached resets the
              // timer; clear so the SLA worker can re-evaluate.
              slaBreachedAt: null,
            },
            create: {
              tenantId: tenant.id,
              contactId: contact.id,
              lastMessageAt: now,
              lastInboundAt: now,
              isActive: true,
              agentId: assignedAgentId ?? undefined,
            },
          });

          const inboundBody = msg.text?.body ?? `[${msg.type}]`;
          const inboundMessage = await prisma.message.create({
            data: {
              conversationId: conversation.id,
              direction: MessageDirection.INBOUND,
              status: MessageStatus.DELIVERED,
              content: inboundBody,
              deliveredAt: new Date(),
            },
          });

          // Emit MESSAGE_RECEIVED to subscribed webhooks (fire-and-forget).
          void emitWebhookEvent(tenant.id, "MESSAGE_RECEIVED", {
            conversationId: conversation.id,
            contactId: contact.id,
            messageId: inboundMessage.id,
            phoneNumber: contact.phoneNumber,
            content: inboundBody,
          });

          // Meta-compliance: respect STOP/UNSUBSCRIBE/CANCEL keywords instantly.
          // Per WhatsApp Business Policy, ignoring opt-outs is a quality-rating
          // killer and can suspend the WABA.
          const OPT_OUT_KEYWORDS = new Set([
            "STOP",
            "UNSUBSCRIBE",
            "CANCEL",
            "STOP ALL",
          ]);
          if (
            msg.text?.body &&
            OPT_OUT_KEYWORDS.has(msg.text.body.trim().toUpperCase())
          ) {
            const fresh = await prisma.contact.findUnique({
              where: { id: contact.id },
              select: { optedOut: true },
            });
            if (!fresh?.optedOut) {
              await prisma.contact.update({
                where: { id: contact.id },
                data: { optedOut: true, optedOutAt: new Date() },
              });
              // Close the conversation so we don't keep nudging or auto-assigning.
              await prisma.conversation.update({
                where: { id: conversation.id },
                data: { isActive: false },
              });
              console.log(
                `[whatsapp:opt-out] ${contact.phoneNumber} marked opted-out via keyword "${msg.text.body.trim()}"`,
              );
            }
          }

          // Flow trigger: if any active flow matches a keyword in the inbound,
          // start a run. Skipped if the contact just opted out (handled above).
          if (msg.text?.body) {
            const freshContact = await prisma.contact.findUnique({
              where: { id: contact.id },
              select: { optedOut: true },
            });
            if (!freshContact?.optedOut) {
              try {
                const flowId = await findFlowForInbound(tenant.id, msg.text.body);
                if (flowId) {
                  void startFlowRun({
                    tenantId: tenant.id,
                    flowId,
                    contactId: contact.id,
                    conversationId: conversation.id,
                    triggerText: msg.text.body,
                  });
                }
              } catch (err) {
                console.error("[whatsapp:flow-trigger]", err);
              }
            }
          }

          // Auto-score on first-ever inbound from a brand-new contact.
          // Skips silently if Anthropic key isn't set — never blocks webhook.
          const isFirstInbound = !contactExisted;
          if (isFirstInbound) {
            void (async () => {
              try {
                const ageDays = Math.floor(
                  (Date.now() - contact.createdAt.getTime()) / 86_400_000,
                );
                const result = await scoreLead(tenant.id, {
                  contactName: contact.name,
                  tags: contact.tags,
                  customFields: {},
                  daysSinceCreated: ageDays,
                  daysSinceLastInteraction: 0,
                  inboundMessages: 1,
                  outboundMessages: 0,
                  openLeadsCount: 0,
                  leadTitles: [],
                });
                await prisma.contact.update({
                  where: { id: contact.id },
                  data: {
                    aiScore: Math.max(0, Math.min(1, result.probability)),
                  },
                });
              } catch (err) {
                // Don't surface — the AI key may not be configured.
                console.warn(
                  "[whatsapp:auto-score] skipped:",
                  (err as Error).message,
                );
              }
            })();
          }
        }

        // Delivery status updates
        for (const status of change.value.statuses ?? []) {
          const mapped: Record<string, MessageStatus | undefined> = {
            sent: MessageStatus.SENT,
            delivered: MessageStatus.DELIVERED,
            read: MessageStatus.READ,
            failed: MessageStatus.FAILED,
          };
          const next = mapped[status.status];
          if (!next) continue;
          const existing = await prisma.message.findUnique({
            where: { metaMessageId: status.id },
            select: {
              id: true,
              status: true,
              campaignId: true,
              deliveredAt: true,
              readAt: true,
            },
          });
          if (!existing) continue;

          const eventAt = Number.isFinite(Number(status.timestamp))
            ? new Date(Number(status.timestamp) * 1000)
            : new Date();
          const wasDelivered =
            existing.status === MessageStatus.DELIVERED ||
            existing.status === MessageStatus.READ;
          const wasRead = existing.status === MessageStatus.READ;

          await prisma.message.update({
            where: { id: existing.id },
            data: {
              status: next,
              deliveredAt:
                (next === MessageStatus.DELIVERED || next === MessageStatus.READ) &&
                !existing.deliveredAt
                  ? eventAt
                  : undefined,
              readAt:
                next === MessageStatus.READ && !existing.readAt ? eventAt : undefined,
              failureReason:
                next === MessageStatus.FAILED ? "Failed by Meta delivery status" : undefined,
            },
          });

          if (existing.campaignId) {
            const campaignData: { deliveredCount?: { increment: number }; readCount?: { increment: number } } = {};
            if (
              (next === MessageStatus.DELIVERED || next === MessageStatus.READ) &&
              !wasDelivered
            ) {
              campaignData.deliveredCount = { increment: 1 };
            }
            if (next === MessageStatus.READ && !wasRead) {
              campaignData.readCount = { increment: 1 };
            }
            if (Object.keys(campaignData).length > 0) {
              await prisma.campaign.update({
                where: { id: existing.campaignId },
                data: campaignData,
              });
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[whatsapp:webhook] processing error", err);
  }
});

// ----------------------------------------------------------------------------
// AUTHENTICATED: send text / template message
// ----------------------------------------------------------------------------

router.use(requireAuth, requireTenantScope);

const sendTextSchema = z.object({
  contactId: z.string().cuid(),
  body: z.string().min(1).max(4096),
});

const sendTemplateSchema = z.object({
  contactId: z.string().cuid(),
  templateName: z.string().min(1).max(100),
  languageCode: z.string().min(2).max(10).default("en_US"),
  bodyParams: z.array(z.string()).max(20).optional(),
});

const configSchema = z.object({
  wabaId: z.string().trim().max(120).nullable().optional(),
  phoneNumberId: z.string().trim().max(120).nullable().optional(),
  accessToken: z.string().trim().min(10).max(5000).nullable().optional(),
  clearAccessToken: z.boolean().optional(),
});

async function getTenantWabaConfig(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant?.wabaPhoneNumber || !tenant?.wabaAccessToken) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "WhatsApp Business API is not configured for this tenant.",
    );
  }
  return {
    phoneNumberId: tenant.wabaPhoneNumber,
    accessToken: tenant.wabaAccessToken,
  };
}

router.get(
  "/config",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const config = await getWhatsAppConfig(req.tenantId!);
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/config",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = configSchema.parse(req.body);
      const config = await updateWhatsAppConfig(req.tenantId!, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WhatsAppConfig",
        resourceId: req.tenantId!,
        newValues: {
          wabaId: body.wabaId,
          phoneNumberId: body.phoneNumberId,
          accessTokenChanged: body.accessToken !== undefined || body.clearAccessToken === true,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/config/sync",
  requirePermission(Permissions.WABA_CONFIGURE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const config = await syncWhatsAppBusinessStatus(req.tenantId!);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "WhatsAppQuality",
        resourceId: req.tenantId!,
        newValues: {
          qualityRating: config.qualityRating,
          messagingLimitTier: config.messagingLimitTier,
          accountStatus: config.accountStatus,
          lastSyncError: config.lastSyncError,
        },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: config });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/send-text",
  requirePermission(Permissions.CAMPAIGN_SEND),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = sendTextSchema.parse(req.body);
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, tenantId: req.tenantId, optedOut: false },
      });
      if (!contact) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "Contact not found or has opted out.",
        );
      }

      await assertCanSend(req.tenantId!);
      const config = await getTenantWabaConfig(req.tenantId!);
      const metaMessageId = await sendWhatsAppText({
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        to: contact.phoneNumber.replace(/^\+/, ""),
        body: body.body,
      });
      await recordSend(req.tenantId!);

      const conversation = await prisma.conversation.upsert({
        where: {
          id: (
            await prisma.conversation.findFirst({
              where: {
                tenantId: req.tenantId!,
                contactId: contact.id,
                isActive: true,
              },
              select: { id: true },
            })
          )?.id ?? "____none____",
        },
        update: { lastMessageAt: new Date() },
        create: {
          tenantId: req.tenantId!,
          contactId: contact.id,
          isActive: true,
          lastMessageAt: new Date(),
        },
      });

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: body.body,
          metaMessageId,
        },
      });

      res.json({ success: true, data: { messageId: message.id, metaMessageId } });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/send-template",
  requirePermission(Permissions.CAMPAIGN_SEND),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = sendTemplateSchema.parse(req.body);
      const contact = await prisma.contact.findFirst({
        where: { id: body.contactId, tenantId: req.tenantId, optedOut: false },
      });
      if (!contact) {
        throw new ApiError(
          ErrorCodes.NOT_FOUND,
          404,
          "Contact not found or has opted out.",
        );
      }
      await assertCanSend(req.tenantId!);
      const config = await getTenantWabaConfig(req.tenantId!);
      const metaMessageId = await sendWhatsAppTemplate({
        phoneNumberId: config.phoneNumberId,
        accessToken: config.accessToken,
        to: contact.phoneNumber.replace(/^\+/, ""),
        templateName: body.templateName,
        languageCode: body.languageCode,
        bodyParams: body.bodyParams,
      });
      await recordSend(req.tenantId!);

      const conversation = await prisma.conversation.upsert({
        where: {
          id:
            (
              await prisma.conversation.findFirst({
                where: {
                  tenantId: req.tenantId!,
                  contactId: contact.id,
                  isActive: true,
                },
                select: { id: true },
              })
            )?.id ?? "____none____",
        },
        update: { lastMessageAt: new Date() },
        create: {
          tenantId: req.tenantId!,
          contactId: contact.id,
          isActive: true,
          lastMessageAt: new Date(),
        },
      });

      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.OUTBOUND,
          status: MessageStatus.SENT,
          content: `[Template: ${body.templateName}]`,
          metaMessageId,
        },
      });

      res.json({ success: true, data: { messageId: message.id, metaMessageId } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
