import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { CallDirection, CallStatus, VirtualNumberStatus } from "@nexaflow/db";
import { Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  deleteCall,
  getCall,
  listCalls,
  logCall,
  regenerateSummary,
  updateCall,
} from "../services/calling.service";
import {
  addNumber,
  getNumber,
  listNumbers,
  releaseNumber,
  updateNumber,
} from "../services/virtualNumber.service";

// Calling — call-log routes (Complete Planning PDF §2.21). Tenant-scoped,
// gated by CALL_MANAGE. Mutations audited.

const router = Router();
router.use(requireAuth, requireTenantScope, requirePermission(Permissions.CALL_MANAGE));

const listSchema = z.object({
  contactId: z.string().trim().max(64).optional(),
  direction: z.nativeEnum(CallDirection).optional(),
});

const logSchema = z.object({
  direction: z.nativeEnum(CallDirection),
  status: z.nativeEnum(CallStatus).optional(),
  fromNumber: z.string().trim().min(1).max(40),
  toNumber: z.string().trim().min(1).max(40),
  contactId: z.string().trim().max(64).optional(),
  durationSeconds: z.number().int().min(0).max(86400).optional(),
  recordingUrl: z.string().url().max(500).optional(),
  transcript: z.string().max(20000).optional(),
  startedAt: z.string().datetime().optional(),
});

const updateSchema = z
  .object({
    status: z.nativeEnum(CallStatus).optional(),
    transcript: z.string().max(20000).nullable().optional(),
    aiSummary: z.string().max(2000).nullable().optional(),
    recordingUrl: z.string().url().max(500).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/calls", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const query = listSchema.parse(req.query);
    res.json({ success: true, data: await listCalls(req.tenantId!, query) });
  } catch (err) {
    next(err);
  }
});

router.post("/calls", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = logSchema.parse(req.body);
    const call = await logCall(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "CallLog",
      resourceId: call.id,
      newValues: { direction: call.direction, status: call.status },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
});

router.get("/calls/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getCall(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/calls/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const call = await updateCall(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "CallLog",
      resourceId: call.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
});

router.post("/calls/:id/summary", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const call = await regenerateSummary(req.tenantId!, req.params.id);
    res.json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
});

router.delete("/calls/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    await deleteCall(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "DELETE",
      resource: "CallLog",
      resourceId: req.params.id,
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: { deleted: true } });
  } catch (err) {
    next(err);
  }
});

// --- Virtual number registry (Phase 11) -----------------------------------

const numberListSchema = z.object({ status: z.nativeEnum(VirtualNumberStatus).optional() });

const capabilityArray = z.array(z.enum(["voice", "sms", "whatsapp"])).max(3);

const addNumberSchema = z.object({
  phoneNumber: z.string().trim().min(5).max(40),
  label: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().max(8).optional(),
  provider: z.string().trim().max(40).optional(),
  capabilities: capabilityArray.optional(),
  secretId: z.string().cuid().nullable().optional(),
});

const updateNumberSchema = z
  .object({
    label: z.string().trim().max(120).nullable().optional(),
    countryCode: z.string().trim().max(8).nullable().optional(),
    provider: z.string().trim().max(40).nullable().optional(),
    capabilities: capabilityArray.optional(),
    secretId: z.string().cuid().nullable().optional(),
    status: z.nativeEnum(VirtualNumberStatus).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "PATCH body must include a field." });

router.get("/numbers", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const { status } = numberListSchema.parse(req.query);
    res.json({ success: true, data: await listNumbers(req.tenantId!, status) });
  } catch (err) {
    next(err);
  }
});

router.post("/numbers", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = addNumberSchema.parse(req.body);
    const number = await addNumber(req.tenantId!, { ...body, createdByUserId: req.userId });
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "CREATE",
      resource: "VirtualNumber",
      resourceId: number.id,
      newValues: { phoneNumber: number.phoneNumber },
      ...extractRequestMeta(req),
    });
    res.status(201).json({ success: true, data: number });
  } catch (err) {
    next(err);
  }
});

router.get("/numbers/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await getNumber(req.tenantId!, req.params.id) });
  } catch (err) {
    next(err);
  }
});

router.patch("/numbers/:id", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const body = updateNumberSchema.parse(req.body);
    const number = await updateNumber(req.tenantId!, req.params.id, body);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "VirtualNumber",
      resourceId: number.id,
      newValues: { fieldsUpdated: Object.keys(body) },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: number });
  } catch (err) {
    next(err);
  }
});

router.post("/numbers/:id/release", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const number = await releaseNumber(req.tenantId!, req.params.id);
    await logAudit({
      tenantId: req.tenantId!,
      userId: req.userId!,
      action: "UPDATE",
      resource: "VirtualNumber",
      resourceId: number.id,
      newValues: { released: true },
      ...extractRequestMeta(req),
    });
    res.json({ success: true, data: number });
  } catch (err) {
    next(err);
  }
});

export default router;
