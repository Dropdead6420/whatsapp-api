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
import { nodeRegistry } from "../services/flow/nodes";
import { requireFeature } from "../services/features.service";
import { loadCustomizedDefinition } from "../services/flowTemplateInstaller.service";

const router = Router();
router.use(requireAuth, requireTenantScope, requireFeature("flows"));

// GET /api/v1/flow-templates
router.get("/", async (_req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const templates = await prisma.flowTemplate.findMany({
      where: { isPublic: true },
      orderBy: [{ industry: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        description: true,
        createdAt: true,
      },
    });
    res.json({ success: true, data: templates });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/flow-templates/:slug
router.get("/:slug", async (req: RequestWithAuth, res: Response, next: NextFunction) => {
  try {
    const tpl = await prisma.flowTemplate.findFirst({
      where: { slug: req.params.slug, isPublic: true },
    });
    if (!tpl) {
      throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found.");
    }
    res.json({
      success: true,
      data: {
        ...tpl,
        definition: JSON.parse(tpl.definition),
      },
    });
  } catch (err) {
    next(err);
  }
});

const installSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  trigger: z
    .enum([
      "keyword",
      "message_received",
      "manual",
      "lead_created",
      "tag_added",
      "appointment_booked",
    ])
    .optional(),
  triggerKeywords: z.array(z.string().min(1).max(40)).max(20).optional(),
});

function validateInstalledDefinition(def: {
  nodes: Array<{ id: string; type: string; next?: string; branches?: Record<string, string> }>;
}): void {
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const node of def.nodes) {
    if (!nodeRegistry[node.type]) {
      throw new ApiError(
        ErrorCodes.BAD_REQUEST,
        400,
        `Template uses unsupported node type "${node.type}".`,
      );
    }
    if (node.next && !ids.has(node.next)) {
      throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Broken link from node "${node.id}".`);
    }
  }
}

// POST /api/v1/flow-templates/:slug/install
router.post(
  "/:slug/install",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = installSchema.parse(req.body ?? {});
      const tpl = await prisma.flowTemplate.findFirst({
        where: { slug: req.params.slug, isPublic: true },
      });
      if (!tpl) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Template not found.");
      }

      const definition = JSON.parse(tpl.definition) as {
        nodes: Array<{ id: string; type: string; next?: string; branches?: Record<string, string> }>;
        edges?: unknown[];
      };
      validateInstalledDefinition(definition);

      const flow = await prisma.chatbotFlow.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name ?? tpl.name,
          description: tpl.description,
          trigger: body.trigger ?? "manual",
          triggerKeywords: body.triggerKeywords ?? [],
          nodes: JSON.stringify(definition.nodes),
          edges: definition.edges ? JSON.stringify(definition.edges) : null,
          isActive: false,
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "ChatbotFlow",
        resourceId: flow.id,
        newValues: { fromTemplate: tpl.slug, name: flow.name },
        ...extractRequestMeta(req),
      });

      res.status(201).json({
        success: true,
        data: {
          flowId: flow.id,
          name: flow.name,
          editUrl: `/flows/${flow.id}/edit`,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/v1/flow-templates/:slug/install-with-ai
//
// Automation Marketplace AI Installer (PRD §8). Same as /install but
// asks Claude to rewrite the template's text-bearing node fields for
// the tenant's industry + business name. The LLM never touches graph
// structure — the existing validateInstalledDefinition pass still runs
// to enforce that. On LLM failure, falls back to the original
// definition (`source: "fallback"`).
router.post(
  "/:slug/install-with-ai",
  requirePermission(Permissions.FLOW_PUBLISH),
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = installSchema.parse(req.body ?? {});
      const { templateName, templateDescription, result } =
        await loadCustomizedDefinition({
          tenantId: req.tenantId!,
          templateSlug: req.params.slug,
        });

      // Structural validation runs on the (possibly-rewritten)
      // definition. The customizer guarantees structure is preserved
      // but this is a belt-and-suspenders check identical to the
      // /install path — same validator, same error surface.
      validateInstalledDefinition(result.definition);

      const flow = await prisma.chatbotFlow.create({
        data: {
          tenantId: req.tenantId!,
          name: body.name ?? templateName,
          description: templateDescription,
          trigger: body.trigger ?? "manual",
          triggerKeywords: body.triggerKeywords ?? [],
          nodes: JSON.stringify(result.definition.nodes),
          edges: result.definition.edges
            ? JSON.stringify(result.definition.edges)
            : null,
          isActive: false,
        },
      });

      await logAudit({
        tenantId: req.tenantId!,
        userId: req.userId!,
        action: "CREATE",
        resource: "ChatbotFlow",
        resourceId: flow.id,
        newValues: {
          fromTemplate: req.params.slug,
          name: flow.name,
          aiCustomized: result.source === "ai",
        },
        ...extractRequestMeta(req),
      });

      res.status(201).json({
        success: true,
        data: {
          flowId: flow.id,
          name: flow.name,
          editUrl: `/flows/${flow.id}/edit`,
          source: result.source,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
