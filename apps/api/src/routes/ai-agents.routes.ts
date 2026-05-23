import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, Permissions } from "@nexaflow/shared";
import {
  requireAuth,
  requireTenantScope,
  RequestWithAuth,
} from "../middleware/auth";
import { requirePermission } from "../middleware/rbac";
import { requireFeature } from "../services/features.service";
import { extractRequestMeta, logAudit } from "../services/audit.service";
import {
  archiveAgent,
  createAgent,
  deleteAgent,
  disableAgent,
  getAgent,
  listAgents,
  publishAgent,
  updateAgent,
} from "../services/aiAgent.service";
import { runAgent } from "../services/aiAgentRunner.service";

// T-052 slice 1: CRUD + lifecycle endpoints for the AI Agent Builder.
// Slice 2 owns the runtime (agent run loop with KB grounding + tool
// dispatch); slice 3 hooks the agent into flow nodes + inbound routing.

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("aiAgents"));
router.use(requirePermission(Permissions.AI_AGENT_MANAGE));

const knowledgeScopeSchema = z
  .object({
    categories: z.array(z.string()).max(16).optional(),
    tags: z.array(z.string()).max(32).optional(),
    topK: z.number().int().min(1).max(20).optional(),
  })
  .optional();

const listSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "DISABLED", "ARCHIVED", "ALL"]).optional(),
  search: z.string().trim().max(200).optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
  persona: z.string().trim().min(1).max(8_000),
  provider: z.enum(["openai", "anthropic"]).optional(),
  model: z.string().trim().max(80).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(4096).optional(),
  knowledgeScope: knowledgeScopeSchema,
  tools: z.array(z.string()).max(16).optional(),
  fallbackBehavior: z
    .enum(["ESCALATE_TO_HUMAN", "SEND_TEMPLATE", "SILENT"])
    .optional(),
  fallbackTemplateId: z.string().trim().max(120).optional(),
});

const updateSchema = createSchema.partial();

// GET /api/v1/ai-agents
router.get(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const q = listSchema.parse(req.query);
      const result = await listAgents(req.tenantId!, q);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/ai-agents
router.post(
  "/",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = createSchema.parse(req.body);
      const agent = await createAgent(req.tenantId!, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "AiAgent",
        resourceId: agent.id,
        newValues: {
          name: agent.name,
          provider: agent.provider,
          model: agent.model,
          status: agent.status,
        },
        ...extractRequestMeta(req),
      });
      res.status(201).json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/v1/ai-agents/:id
router.get(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const agent = await getAgent(req.tenantId!, req.params.id);
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/v1/ai-agents/:id
router.patch(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = updateSchema.parse(req.body);
      if (Object.keys(body).length === 0) {
        throw new ApiError(
          ErrorCodes.BAD_REQUEST,
          400,
          "PATCH body must include at least one field.",
        );
      }
      const agent = await updateAgent(req.tenantId!, req.params.id, body);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AiAgent",
        resourceId: agent.id,
        newValues: { fieldsUpdated: Object.keys(body) },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/ai-agents/:id/publish — DRAFT|DISABLED → ACTIVE
router.post(
  "/:id/publish",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const agent = await publishAgent(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AiAgent",
        resourceId: agent.id,
        newValues: { lifecycle: "ACTIVE" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/ai-agents/:id/disable — ACTIVE → DISABLED
router.post(
  "/:id/disable",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const agent = await disableAgent(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AiAgent",
        resourceId: agent.id,
        newValues: { lifecycle: "DISABLED" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/ai-agents/:id/archive — * → ARCHIVED (terminal)
router.post(
  "/:id/archive",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const agent = await archiveAgent(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "UPDATE",
        resource: "AiAgent",
        resourceId: agent.id,
        newValues: { lifecycle: "ARCHIVED" },
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: agent });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/ai-agents/:id/test — test-drive an agent without
// touching production conversations. Operators paste a sample
// conversation, the runner executes against the configured agent
// (must be ACTIVE) and returns the reply + KB citations + tool calls.
// Wallet-billed exactly like a real run so prompt iteration costs are
// visible.
const testSchema = z.object({
  conversation: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8_000),
      }),
    )
    .min(1)
    .max(50),
  context: z.record(z.string()).optional(),
});

router.post(
  "/:id/test",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = testSchema.parse(req.body);
      const result = await runAgent({
        tenantId: req.tenantId!,
        agentId: req.params.id,
        conversation: body.conversation,
        context: body.context,
      });
      // No audit log for test runs — they don't change state, and an
      // operator iterating on a persona shouldn't pollute the audit
      // trail with dozens of entries. The AiUsage row is the financial
      // record (wallet was debited inside runAgent).
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/v1/ai-agents/:id
router.delete(
  "/:id",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      await deleteAgent(req.tenantId!, req.params.id);
      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "DELETE",
        resource: "AiAgent",
        resourceId: req.params.id,
        ...extractRequestMeta(req),
      });
      res.json({ success: true, data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
