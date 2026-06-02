// Tests for the invoice PDF renderer's pure path.
//
// We don't actually drive the pdfkit path here — it's exercised in
// integration / production. These tests pin:
//   - buildStubBodyLines (what the fallback PDF shows)
//   - renderInvoicePdf produces a Buffer that's recognizably a PDF
//     (starts with %PDF-1.4) regardless of which branch ran

import { describe, expect, it } from "vitest";
import {
  buildStubBodyLines,
  renderInvoicePdf,
} from "./invoicePdfRenderer.service";

// Minimal Invoice fixture — only the fields the renderer touches.
function fixtureInvoice(overrides: Partial<MockInvoice> = {}): MockInvoice {
  return {
    id: "inv_42",
    tenantId: "t_abc",
    invoiceNumber: "INV-2606-0001",
    amountInPaisa: 100_000, // ₹1,000
    subtotalInPaisa: 100_000,
    taxInPaisa: 0,
    currency: "INR",
    status: "paid",
    paymentOrderId: "po_42",
    rechargeRequestId: null,
    createdAt: new Date("2026-06-02T10:00:00Z"),
    paidAt: new Date("2026-06-02T10:01:00Z"),
    pdfUrl: null,
    ...overrides,
  };
}

interface MockInvoice {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  amountInPaisa: number;
  subtotalInPaisa: number;
  taxInPaisa: number;
  currency: string;
  status: string;
  paymentOrderId: string | null;
  rechargeRequestId: string | null;
  createdAt: Date;
  paidAt: Date | null;
  pdfUrl: string | null;
}

describe("buildStubBodyLines", () => {
  it("includes invoice number, total, tenant id", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
      tenantName: "Acme Corp",
    });
    const text = lines.join(" | ");
    expect(text).toContain("INV-2606-0001");
    expect(text).toContain("Acme Corp");
    expect(text).toContain("t_abc");
    expect(text).toContain("INR 1000.00");
  });

  it("uses tenant id when no tenant name supplied", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
    });
    expect(lines.some((l) => l.includes("t_abc"))).toBe(true);
  });

  it("references the payment order when set", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
    });
    expect(lines.some((l) => l.includes("po_42"))).toBe(true);
  });

  it("references the recharge request when that's the source instead", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice({
        paymentOrderId: null,
        rechargeRequestId: "rr_99",
      }) as never,
    });
    const text = lines.join(" | ");
    expect(text).toContain("rr_99");
    expect(text).not.toContain("po_42");
  });

  it("issuer defaults to NexaFlow AI", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
    });
    expect(lines[0]).toContain("NexaFlow AI");
  });

  it("issuer can be overridden", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
      issuerName: "WebnifyLabs",
    });
    expect(lines[0]).toContain("WebnifyLabs");
  });

  it("date is ISO-formatted (UTC) so the line stays stable across timezones", () => {
    const lines = buildStubBodyLines({
      invoice: fixtureInvoice() as never,
    });
    expect(lines.some((l) => l.includes("2026-06-02"))).toBe(true);
  });
});

describe("renderInvoicePdf", () => {
  it("returns a Buffer that begins with the PDF magic bytes", async () => {
    const buf = await renderInvoicePdf({
      invoice: fixtureInvoice() as never,
    });
    expect(buf).toBeInstanceOf(Buffer);
    const head = buf.slice(0, 8).toString("utf-8");
    expect(head.startsWith("%PDF-1.")).toBe(true);
  });

  it("includes the invoice number in the byte stream", async () => {
    const buf = await renderInvoicePdf({
      invoice: fixtureInvoice() as never,
    });
    expect(buf.toString("latin1")).toContain("INV-2606-0001");
  });

  it("ends with the %%EOF trailer", async () => {
    const buf = await renderInvoicePdf({
      invoice: fixtureInvoice() as never,
    });
    const tail = buf.slice(-8).toString("utf-8");
    expect(tail).toContain("%%EOF");
  });
});
