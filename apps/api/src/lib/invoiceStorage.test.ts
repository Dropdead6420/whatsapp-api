import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getInvoiceStorageDir,
  invoicePdfPath,
  invoicePdfPublicUrl,
} from "./invoiceStorage";

const PRIOR_ENV = process.env.INVOICE_STORAGE_DIR;

afterEach(() => {
  if (PRIOR_ENV === undefined) delete process.env.INVOICE_STORAGE_DIR;
  else process.env.INVOICE_STORAGE_DIR = PRIOR_ENV;
});

beforeEach(() => {
  delete process.env.INVOICE_STORAGE_DIR;
});

describe("getInvoiceStorageDir", () => {
  it("defaults to /tmp/nexaflow-invoices when no env is set", () => {
    expect(getInvoiceStorageDir()).toBe("/tmp/nexaflow-invoices");
  });

  it("honors INVOICE_STORAGE_DIR when set", () => {
    process.env.INVOICE_STORAGE_DIR = "/mnt/disk/inv";
    expect(getInvoiceStorageDir()).toBe("/mnt/disk/inv");
  });

  it("treats whitespace-only env as unset", () => {
    process.env.INVOICE_STORAGE_DIR = "   ";
    expect(getInvoiceStorageDir()).toBe("/tmp/nexaflow-invoices");
  });

  it("trims a valid env value", () => {
    process.env.INVOICE_STORAGE_DIR = "  /opt/inv  ";
    expect(getInvoiceStorageDir()).toBe("/opt/inv");
  });
});

describe("invoicePdfPath", () => {
  it("returns <storage>/<tenantId>/<invoiceId>.pdf", () => {
    process.env.INVOICE_STORAGE_DIR = "/storage";
    expect(
      invoicePdfPath({ tenantId: "t_abc123", invoiceId: "inv_xyz789" }),
    ).toBe("/storage/t_abc123/inv_xyz789.pdf");
  });

  it("rejects tenantId with path-traversal chars", () => {
    expect(() =>
      invoicePdfPath({ tenantId: "../etc", invoiceId: "x" }),
    ).toThrow(/Invalid tenantId/);
  });

  it("rejects tenantId with forward slashes", () => {
    expect(() =>
      invoicePdfPath({ tenantId: "a/b", invoiceId: "x" }),
    ).toThrow(/Invalid tenantId/);
  });

  it("rejects invoiceId with path-traversal chars", () => {
    expect(() =>
      invoicePdfPath({ tenantId: "t", invoiceId: "../passwd" }),
    ).toThrow(/Invalid invoiceId/);
  });

  it("rejects empty ids", () => {
    expect(() => invoicePdfPath({ tenantId: "", invoiceId: "x" })).toThrow(
      /Invalid tenantId/,
    );
    expect(() => invoicePdfPath({ tenantId: "x", invoiceId: "" })).toThrow(
      /Invalid invoiceId/,
    );
  });

  it("accepts cuid-shaped ids (letters + digits)", () => {
    process.env.INVOICE_STORAGE_DIR = "/x";
    expect(
      invoicePdfPath({
        tenantId: "clxxxabc123",
        invoiceId: "clyyy456def",
      }),
    ).toBe("/x/clxxxabc123/clyyy456def.pdf");
  });

  it("accepts ids with hyphens + underscores", () => {
    process.env.INVOICE_STORAGE_DIR = "/x";
    expect(
      invoicePdfPath({
        tenantId: "tenant-1_a",
        invoiceId: "inv_2026-06",
      }),
    ).toBe("/x/tenant-1_a/inv_2026-06.pdf");
  });
});

describe("invoicePdfPublicUrl", () => {
  it("returns the customer-route shape", () => {
    expect(invoicePdfPublicUrl("inv_42")).toBe(
      "/api/v1/customer/wallets/invoices/inv_42/pdf",
    );
  });
});
