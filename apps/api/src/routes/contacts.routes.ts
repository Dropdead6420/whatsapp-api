import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { logAudit, extractRequestMeta } from "../services/audit.service";

const router = Router();
router.use(requireAuth, requireTenantScope);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, "Phone number must be E.164 (e.g. +919876543210)");

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().min(1).max(80).optional(),
  tag: z.string().trim().optional(),
  optedOut: z.coerce.boolean().optional(),
});

const createSchema = z.object({
  phoneNumber: phoneSchema,
  name: z.string().min(1).max(120),
  email: z.string().email().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  customFields: z.record(z.unknown()).optional(),
});

const lifecycleStages = [
  "LEAD",
  "PROSPECT",
  "CUSTOMER",
  "REPEAT_CUSTOMER",
  "VIP",
  "CHURNED",
] as const;

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().nullable().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  customFields: z.record(z.unknown()).optional(),
  optedOut: z.boolean().optional(),
  lifecycleStage: z.enum(lifecycleStages).optional(),
});

const bulkImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        phoneNumber: phoneSchema,
        name: z.string().min(1).max(120),
        email: z.string().email().optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .min(1)
    .max(1000),
});

// GET /contacts
router.get("/", requirePermission(Permissions.CONTACT_READ), async (req: RequestWithAuth, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const where: Record<string, unknown> = { tenantId: req.tenantId };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: "insensitive" } },
        { phoneNumber: { contains: q.search } },
        { email: { contains: q.search, mode: "insensitive" } },
      ];
    }
    if (q.tag) where.tags = { has: q.tag };
    if (typeof q.optedOut === "boolean") where.optedOut = q.optedOut;

    const [total, items] = await prisma.$transaction([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        page: q.page,
        limit: q.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / q.limit)),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /contacts/export.csv — must be before /:id to win Express matching
function csvEscape(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

router.get(
  "/export.csv",
  requirePermission(Permissions.CONTACT_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const contacts = await prisma.contact.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: "desc" },
        take: 50_000,
      });

      const header = [
        "id",
        "name",
        "phoneNumber",
        "email",
        "tags",
        "lifecycleStage",
        "optedOut",
        "aiScore",
        "lastInteractionAt",
        "createdAt",
      ];
      const lines: string[] = [header.join(",")];

      for (const c of contacts) {
        lines.push(
          [
            csvEscape(c.id),
            csvEscape(c.name),
            csvEscape(c.phoneNumber),
            csvEscape(c.email),
            csvEscape(c.tags.join("|")),
            csvEscape(c.lifecycleStage),
            csvEscape(c.optedOut ? "true" : "false"),
            csvEscape(c.aiScore?.toString() ?? ""),
            csvEscape(c.lastInteractionAt?.toISOString() ?? ""),
            csvEscape(c.createdAt.toISOString()),
          ].join(","),
        );
      }

      const csv = lines.join("\n");
      const filename = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(csv);
    } catch (err) {
      next(err);
    }
  },
);

// POST /contacts
router.post(
  "/",
  requirePermission(Permissions.CONTACT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const existing = await prisma.contact.findUnique({
        where: {
          tenantId_phoneNumber: {
            tenantId: req.tenantId!,
            phoneNumber: body.phoneNumber,
          },
        },
      });
      if (existing) {
        throw new ApiError(
          ErrorCodes.CONFLICT,
          409,
          "Contact with this phone number already exists.",
        );
      }

      const contact = await prisma.contact.create({
        data: {
          tenantId: req.tenantId!,
          phoneNumber: body.phoneNumber,
          name: body.name,
          email: body.email,
          tags: body.tags,
          customFields: body.customFields ? JSON.stringify(body.customFields) : null,
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Contact",
        resourceId: contact.id,
        newValues: { phoneNumber: contact.phoneNumber, name: contact.name },
        ...extractRequestMeta(req),
      });

      res.status(201).json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  },
);

// GET /contacts/:id
router.get(
  "/:id",
  requirePermission(Permissions.CONTACT_READ),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const contact = await prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
        include: {
          leads: { orderBy: { createdAt: "desc" }, take: 10 },
          conversations: { orderBy: { lastMessageAt: "desc" }, take: 5 },
        },
      });
      if (!contact) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }
      res.json({ success: true, data: contact });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /contacts/:id
router.patch(
  "/:id",
  requirePermission(Permissions.CONTACT_CREATE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }
      const updated = await prisma.contact.update({
        where: { id: existing.id },
        data: {
          ...body,
          customFields: body.customFields ? JSON.stringify(body.customFields) : undefined,
          optedOutAt:
            body.optedOut === true
              ? new Date()
              : body.optedOut === false
                ? null
                : undefined,
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "Contact",
        resourceId: updated.id,
        oldValues: { name: existing.name, tags: existing.tags },
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /contacts/:id
router.delete(
  "/:id",
  requirePermission(Permissions.CONTACT_DELETE),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.contact.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Contact not found.");
      }
      await prisma.contact.delete({ where: { id: existing.id } });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "Contact",
        resourceId: existing.id,
        oldValues: { phoneNumber: existing.phoneNumber, name: existing.name },
        ...extractRequestMeta(req),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /contacts/bulk-import — JSON array import (CSV parsing happens client-side)
router.post(
  "/bulk-import",
  requirePermission(Permissions.CONTACT_IMPORT),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const { contacts } = bulkImportSchema.parse(req.body);
      const phoneNumbers = contacts.map((c) => c.phoneNumber);
      const existing = await prisma.contact.findMany({
        where: { tenantId: req.tenantId, phoneNumber: { in: phoneNumbers } },
        select: { phoneNumber: true },
      });
      const existingSet = new Set(existing.map((c) => c.phoneNumber));
      const toCreate = contacts.filter((c) => !existingSet.has(c.phoneNumber));

      if (toCreate.length === 0) {
        res.json({
          success: true,
          data: { created: 0, skipped: contacts.length },
        });
        return;
      }

      const result = await prisma.contact.createMany({
        data: toCreate.map((c) => ({
          tenantId: req.tenantId!,
          phoneNumber: c.phoneNumber,
          name: c.name,
          email: c.email ?? null,
          tags: c.tags ?? [],
        })),
        skipDuplicates: true,
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "Contact",
        newValues: { count: result.count, source: "bulk-import" },
        ...extractRequestMeta(req),
      });

      res.status(201).json({
        success: true,
        data: { created: result.count, skipped: contacts.length - result.count },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
