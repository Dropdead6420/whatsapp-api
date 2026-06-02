// ============================================================================
// Invoice storage helpers (Claude FINAL §4, slice 12)
//
// Disk-backed by default at INVOICE_STORAGE_DIR. The download route
// streams files from this path; in production this should point to a
// volume mount or a tmpfs that's snapshotted to R2/S3 nightly.
//
// Why local disk first: a real object-store integration is its own
// slice (R2/S3 client, signed URLs, bucket lifecycle). Local disk
// lets the customer-facing Download button work end-to-end on a
// single VPS; the R2 swap is a backend-only change later.
//
// Path layout: <root>/<tenantId>/<invoiceId>.pdf
//   - Tenant prefix limits blast radius if someone misuses the
//     download route (it still tenant-scopes via Prisma; this is
//     defense-in-depth).
//   - One file per invoice keeps the directory shallow.
// ============================================================================

import path from "node:path";

const DEFAULT_DIR = "/tmp/nexaflow-invoices";

export function getInvoiceStorageDir(): string {
  const raw = process.env.INVOICE_STORAGE_DIR?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_DIR;
}

/**
 * Returns the absolute disk path where an invoice's PDF lives.
 *
 * Validates both ids to avoid path traversal — only `[A-Za-z0-9_-]`
 * are allowed (matching Prisma cuid + our other id shapes). Anything
 * else throws synchronously so the caller never accidentally writes
 * to /etc.
 */
export function invoicePdfPath(args: {
  tenantId: string;
  invoiceId: string;
}): string {
  if (!/^[A-Za-z0-9_-]+$/.test(args.tenantId)) {
    throw new Error("Invalid tenantId for invoice storage path.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(args.invoiceId)) {
    throw new Error("Invalid invoiceId for invoice storage path.");
  }
  return path.join(
    getInvoiceStorageDir(),
    args.tenantId,
    `${args.invoiceId}.pdf`,
  );
}

/**
 * The pdfUrl we stamp on the Invoice row. Customers fetch this via
 * the customer-wallets route; the route does its own tenant-scope
 * check before streaming the file.
 */
export function invoicePdfPublicUrl(invoiceId: string): string {
  return `/api/v1/customer/wallets/invoices/${invoiceId}/pdf`;
}
