// ============================================================================
// Invoice service (Claude FINAL §4, slice 9)
//
// Auto-creates an Invoice row when a wallet recharge succeeds, so
// customers have something to download / hand to their finance team.
// PDF generation lives in a separate worker (next slice); for now
// pdfUrl stays null and the customer sees the row + totals only.
//
// Invoice numbers are tenant-local + month-stable: INV-YYMM-{seq},
// where seq is the order of recharge invoices for that tenant in
// that calendar month. Format is human-readable and orderable,
// matches typical SaaS conventions.
// ============================================================================

import fs from "node:fs/promises";
import path from "node:path";
import {
  prisma,
  type Invoice,
  type PaymentOrder,
  type RechargeRequest,
} from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import {
  invoicePdfPath,
  invoicePdfPublicUrl,
} from "../lib/invoiceStorage";
import { renderInvoicePdf } from "./invoicePdfRenderer.service";

// ---- Pure helpers (unit-tested) -------------------------------------------

/**
 * Returns the YYMM portion of an invoice number for a given date.
 * UTC-anchored so the same recharge generates the same prefix
 * regardless of the server's timezone.
 */
export function formatInvoiceMonthPrefix(date: Date): string {
  const yy = String(date.getUTCFullYear() % 100).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}

/**
 * Builds the final invoice number from a month prefix + a sequence
 * number. seq is zero-padded to 4 digits so lexicographic order
 * matches numeric order through 9999.
 */
export function buildInvoiceNumber(monthPrefix: string, seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invoice sequence must be a positive integer.",
    );
  }
  if (!/^\d{4}$/.test(monthPrefix)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invoice month prefix must be 4 digits (YYMM).",
    );
  }
  return `INV-${monthPrefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * Computes the next sequence number given a list of existing invoice
 * numbers in the same tenant+month window. Used by the DB layer to
 * pick a starting candidate before retrying on UNIQUE conflict.
 *
 * Robust to weird existing numbers: only "INV-YYMM-NNNN"-shaped
 * numbers contribute; anything else is ignored.
 */
export function nextInvoiceSequence(args: {
  monthPrefix: string;
  existingNumbers: ReadonlyArray<string>;
}): number {
  let maxSeq = 0;
  const prefix = `INV-${args.monthPrefix}-`;
  for (const num of args.existingNumbers) {
    if (!num.startsWith(prefix)) continue;
    const tail = num.slice(prefix.length);
    const parsed = Number.parseInt(tail, 10);
    if (Number.isInteger(parsed) && parsed > maxSeq) maxSeq = parsed;
  }
  return maxSeq + 1;
}

// ---- DB layer -------------------------------------------------------------

/**
 * Allocates the next invoice number for (tenantId, current month).
 * Retries up to 3 times on UNIQUE conflict (concurrent invoice
 * creation for the same tenant + month).
 */
async function allocateInvoiceNumber(args: {
  tenantId: string;
  now?: Date;
  client?: typeof prisma | Parameters<typeof prisma.$transaction>[0] extends (tx: infer T) => unknown ? T : never;
}): Promise<string> {
  const now = args.now ?? new Date();
  const monthPrefix = formatInvoiceMonthPrefix(now);

  // Existing same-month invoice numbers for this tenant. Read inside
  // the caller's transaction when possible so we hold the row-set
  // visibility window.
  const existing = await prisma.invoice.findMany({
    where: {
      tenantId: args.tenantId,
      invoiceNumber: { startsWith: `INV-${monthPrefix}-` },
    },
    select: { invoiceNumber: true },
  });
  const seq = nextInvoiceSequence({
    monthPrefix,
    existingNumbers: existing.map((e) => e.invoiceNumber),
  });
  return buildInvoiceNumber(monthPrefix, seq);
}

interface BaseInvoiceInputs {
  tenantId: string;
  amountInPaisa: number;
  currency: string;
  paidAt?: Date;
  /** When to stamp dueAt — for recharge invoices, "now" since it's
   *  already paid. Subscription invoices set this differently. */
  dueAt?: Date;
}

/**
 * Reservation-loop-style create: pick a number, try to insert; on
 * P2002 (unique conflict), recompute and retry up to 3 times.
 */
async function createInvoiceWithRetry(args: BaseInvoiceInputs & {
  paymentOrderId?: string | null;
  rechargeRequestId?: string | null;
  status: "paid" | "draft" | "failed";
}): Promise<Invoice> {
  const now = new Date();
  for (let attempt = 0; attempt < 3; attempt++) {
    const invoiceNumber = await allocateInvoiceNumber({
      tenantId: args.tenantId,
      now,
    });
    try {
      return await prisma.invoice.create({
        data: {
          tenantId: args.tenantId,
          invoiceNumber,
          amountInPaisa: args.amountInPaisa,
          subtotalInPaisa: args.amountInPaisa,
          taxInPaisa: 0,
          currency: args.currency,
          status: args.status,
          paymentOrderId: args.paymentOrderId ?? null,
          rechargeRequestId: args.rechargeRequestId ?? null,
          dueAt: args.dueAt ?? now,
          paidAt: args.paidAt ?? null,
        },
      });
    } catch (err) {
      // Retry only on a unique-violation; bubble everything else.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }
  throw new ApiError(
    ErrorCodes.INTERNAL_SERVER_ERROR,
    500,
    "Could not allocate an invoice number after 3 retries.",
  );
}

/**
 * Idempotent: a re-trigger for the same PaymentOrder returns the
 * existing invoice rather than creating a duplicate. Callers (e.g.
 * the Razorpay webhook on a delayed retry) are protected from
 * double-billing the audit log.
 */
export async function createInvoiceForPaymentOrder(
  order: Pick<
    PaymentOrder,
    "id" | "tenantId" | "amount" | "currency" | "paidAt"
  >,
): Promise<Invoice> {
  const existing = await prisma.invoice.findFirst({
    where: { paymentOrderId: order.id },
  });
  if (existing) return existing;

  const created = await createInvoiceWithRetry({
    tenantId: order.tenantId,
    amountInPaisa: order.amount,
    currency: order.currency,
    paymentOrderId: order.id,
    status: "paid",
    paidAt: order.paidAt ?? new Date(),
  });

  // Fire-and-forget PDF generation. Wrapped in catch so a renderer
  // hiccup never bubbles back to the wallet credit path; the
  // customer's download route will regenerate on demand if the
  // pdfUrl never got stamped here.
  generateAndStoreInvoicePdf(created).catch((err) => {
    console.warn(
      `[invoice] PDF generation failed for ${created.id}:`,
      (err as Error).message,
    );
  });
  return created;
}

/**
 * Same idempotency pattern for manual bank transfer approval.
 */
export async function createInvoiceForRechargeRequest(
  request: Pick<
    RechargeRequest,
    "id" | "tenantId" | "amount" | "currency" | "approvedAt"
  >,
): Promise<Invoice> {
  const existing = await prisma.invoice.findFirst({
    where: { rechargeRequestId: request.id },
  });
  if (existing) return existing;

  const created = await createInvoiceWithRetry({
    tenantId: request.tenantId,
    amountInPaisa: request.amount,
    currency: request.currency,
    rechargeRequestId: request.id,
    status: "paid",
    paidAt: request.approvedAt ?? new Date(),
  });

  generateAndStoreInvoicePdf(created).catch((err) => {
    console.warn(
      `[invoice] PDF generation failed for ${created.id}:`,
      (err as Error).message,
    );
  });
  return created;
}

/**
 * Render the invoice PDF + write to disk + stamp pdfUrl on the row.
 * Fire-and-forget from the caller — failures here must not propagate
 * back to the wallet credit path.
 */
export async function generateAndStoreInvoicePdf(
  invoice: Invoice,
  args: { tenantName?: string | null } = {},
): Promise<Invoice> {
  const filePath = invoicePdfPath({
    tenantId: invoice.tenantId,
    invoiceId: invoice.id,
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  const buffer = await renderInvoicePdf({
    invoice,
    tenantName: args.tenantName ?? null,
  });
  await fs.writeFile(filePath, buffer);

  return prisma.invoice.update({
    where: { id: invoice.id },
    data: { pdfUrl: invoicePdfPublicUrl(invoice.id) },
  });
}

/**
 * Re-renders an existing invoice on demand — used when the customer
 * hits the download route and pdfUrl was never stamped (PDF
 * generation failed during the original credit path). Caller has
 * already verified tenant scope.
 */
export async function loadInvoicePdfBytes(invoice: Invoice): Promise<Buffer> {
  const filePath = invoicePdfPath({
    tenantId: invoice.tenantId,
    invoiceId: invoice.id,
  });
  try {
    return await fs.readFile(filePath);
  } catch {
    // File doesn't exist yet — generate on demand. Write-through so
    // the next request is fast.
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const buffer = await renderInvoicePdf({ invoice });
    await fs.writeFile(filePath, buffer);
    return buffer;
  }
}

export async function listInvoicesForTenant(args: {
  tenantId: string;
  limit?: number;
}): Promise<Invoice[]> {
  return prisma.invoice.findMany({
    where: { tenantId: args.tenantId },
    orderBy: { createdAt: "desc" },
    take: Math.min(args.limit ?? 100, 200),
  });
}
