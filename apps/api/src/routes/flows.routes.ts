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
import { startFlowRun } from "../services/flow/engine";
import { listNodeTypes, nodeRegistry } from "../services/flow/nodes";
import { requireFeature } from "../services/features.service";

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("flows"));

const flowNodeSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.string().min(1).max(40),
  isEntry: z.boolean().optional(),
  config: z.record(z.unknown()).default({}),
  next: z.string().optional(),
  branches: z.record(z.string()).optional(),
});

const flowDefinitionSchema = z.object({
  nodes: z.array(flowNodeSchema).min(1).max(200),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
});

const createFlowSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  trigger: z
    .enum([
      "keyword",
      "message_received",
      "manual",
      "lead_created",
      "tag_added",
      "appointment_booked",
    ])
    .default("keyword"),
  triggerKeywords: z.array(z.string().min(1).max(40)).max(20).default([]),
  definition: flowDefinitionSchema,
  isActive: z.boolean().default(false),
});

const updateFlowSchema = createFlowSchema.partial();

function validateFlowDefinition(def: z.infer<typeof flowDefinitionSchema>): void {
  const ids = new Set(def.nodes.map((n) => n.id));
  if (ids.size !== def.nodes.length) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Node ids must be unique within a flow.");
  }
  const hasEntry =
    def.nodes.some((n) => n.isEntry) || def.nodes.some((n) => n.type === "START");
  if (!hasEntry) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Flow must have one START node or a node marked isEntry.",
    );
  }
  for (const node of def.nodes) {
    if (!nodeRegistry[node.type]) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Unknown node type "${node.type}" on node "${node.id}".`,
      );
    }
    if (node.next && !ids.has(node.next)) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Node "${node.id}" .next references unknown id "${node.next}".`,
      );
    }
    if (node.branches) {
      for (const [k, target] of Object.entries(node.branches)) {
        if (!ids.has(target)) {
          throw new ApiError(
            ErrorCodes.BAD_REQUEST,
            400,
            `Node "${node.id}" branch "${k}" → unknown id "${target}".`,
          );
        }
      }
    }
  }
}

// GET /flows
router.get("/", requirePermission(Permissions.FLOW_PUBLISH), async (req: RequestWithAuth, res, next) => {
  try {
    const items = await prisma.chatbotFlow.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        trigger: true,
        triggerKeywords: true,
        updatedAt: true,
        createdAt: true,
      },
    });
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
});

// GET /flows/node-types — registry for the UI
router.get("/node-types", async (_req, res, next) => {
  try {
    res.json({ success: true, data: listNodeTypes() });
  } catch (err) {
    next(err);
  }
});

// GET /flows/:id
router.get(
  "/:id",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const flow = await prisma.chatbotFlow.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!flow) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Flow not found.");
      }
      let definition: unknown = null;
      try {
        definition = {
          nodes: JSON.parse(flow.nodes),
          edges: flow.edges ? JSON.parse(flow.edges) : [],
        };
      } catch {
        definition = null;
      }
      res.json({ success: true, data: { ...flow, definition } });
    } catch (err) {
      next(err);
    }
  },
);

// POST /flows
router.post(
  "/",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createFlowSchema.parse(req.body);
      validateFlowDefinition(body.definition);
      const created = await prisma.chatbotFlow.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name,
          description: body.description,
          isActive: body.isActive,
          trigger: body.trigger,
          triggerKeywords: body.triggerKeywords,
          nodes: JSON.stringify(body.definition.nodes),
          edges: body.definition.edges
            ? JSON.stringify(body.definition.edges)
            : null,
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "ChatbotFlow",
        resourceId: created.id,
        newValues: { name: created.name, isActive: created.isActive },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /flows/:id
router.patch(
  "/:id",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateFlowSchema.parse(req.body);
      const existing = await prisma.chatbotFlow.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Flow not found.");
      }
      if (body.definition) {
        validateFlowDefinition(body.definition);
      }
      const updated = await prisma.chatbotFlow.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          description: body.description,
          isActive: body.isActive,
          trigger: body.trigger,
          triggerKeywords: body.triggerKeywords,
          nodes: body.definition
            ? JSON.stringify(body.definition.nodes)
            : undefined,
          edges: body.definition
            ? body.definition.edges
              ? JSON.stringify(body.definition.edges)
              : null
            : undefined,
        },
      });
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "ChatbotFlow",
        resourceId: updated.id,
        oldValues: { isActive: existing.isActive },
        newValues: body,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /flows/:id
router.delete(
  "/:id",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.chatbotFlow.findFirst({
        where: { id: req.params.id, tenantId: req.tenantId },
      });
      if (!existing) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Flow not found.");
      }
      await prisma.chatbotFlow.delete({ where: { id: existing.id } });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

// POST /flows/:id/test-run — run the flow with optional contact + initial vars
const testRunSchema = z.object({
  contactId: z.string().cuid().optional(),
  triggerText: z.string().max(2000).optional(),
  vars: z.record(z.unknown()).optional(),
});

router.post(
  "/:id/test-run",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = testRunSchema.parse(req.body);
      const runId = await startFlowRun({
        tenantId: req.tenantId!,
        flowId: req.params.id,
        contactId: body.contactId ?? null,
        triggerText: body.triggerText,
        initialVars: body.vars,
      });
      // Wait briefly so the test response reflects synchronous progress.
      await new Promise((r) => setTimeout(r, 600));
      const run = await prisma.flowRun.findUnique({ where: { id: runId } });
      res.status(201).json({ success: true, data: run });
    } catch (err) {
      next(err);
    }
  },
);

// GET /flows/:id/runs — list recent runs of this flow
router.get(
  "/:id/runs",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const runs = await prisma.flowRun.findMany({
        where: { tenantId: req.tenantId, flowId: req.params.id },
        orderBy: { startedAt: "desc" },
        take: 25,
      });
      res.json({ success: true, data: runs });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
