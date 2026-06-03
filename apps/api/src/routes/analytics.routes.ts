import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { ApiError, ErrorCodes, UserRole } from "@nexaflow/shared";
import { requireAuth, RequestWithAuth } from "../middleware/auth";
import {
  analyticsSummaryToCsvRows,
  csvRowsToString,
} from "../services/analyticsExport.service";
import { analyticsSummaryToPdf } from "../services/analyticsPdf.service";
import {
  getPlatformSummary,
  getTenantSummary,
} from "../services/analyticsSummary.service";
import {
  getReportScheduleForContext,
  runReportScheduleNow,
  saveReportScheduleForContext,
} from "../services/analyticsReportSchedule.service";

const router = Router();
router.use(requireAuth);

const reportScheduleSchema = z.object({
  enabled: z.boolean(),
  recipientEmail: z.string().email().max(320),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  format: z.enum(["CSV", "PDF"]),
});

async function getSummaryForRequest(req: RequestWithAuth) {
  if (req.userRole === UserRole.SUPER_ADMIN) return getPlatformSummary();
  if (!req.tenantId) {
    throw new ApiError(
      ErrorCodes.MULTI_TENANT_VIOLATION,
      400,
      "Tenant context required for analytics.",
    );
  }
  return getTenantSummary(req.tenantId);
}

router.get(
  "/summary",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const summary = await getSummaryForRequest(req);
      res.json({ success: true, data: summary });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/report-schedule",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const schedule = await getReportScheduleForContext({
        userRole: req.userRole,
        tenantId: req.tenantId,
      });
      res.json({ success: true, data: schedule });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  "/report-schedule",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const body = reportScheduleSchema.parse(req.body);
      const schedule = await saveReportScheduleForContext({
        userRole: req.userRole,
        tenantId: req.tenantId,
        userId: req.userId,
        ...body,
      });
      res.json({ success: true, data: schedule });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/report-schedule/run-now",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const schedule = await runReportScheduleNow({
        userRole: req.userRole,
        tenantId: req.tenantId,
      });
      res.json({ success: true, data: schedule });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/export.csv",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const summary = await getSummaryForRequest(req);
      const csv = csvRowsToString(
        analyticsSummaryToCsvRows(summary as unknown as Record<string, unknown>),
      );
      const stamp = new Date().toISOString().slice(0, 10);
      res
        .status(200)
        .setHeader("Content-Type", "text/csv; charset=utf-8")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="nexaflow-analytics-${summary.scope}-${stamp}.csv"`,
        )
        .send(csv);
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/export.pdf",
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const summary = await getSummaryForRequest(req);
      const pdf = analyticsSummaryToPdf(summary as unknown as Record<string, unknown>);
      const stamp = new Date().toISOString().slice(0, 10);
      res
        .status(200)
        .setHeader("Content-Type", "application/pdf")
        .setHeader(
          "Content-Disposition",
          `attachment; filename="nexaflow-analytics-${summary.scope}-${stamp}.pdf"`,
        )
        .send(pdf);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
