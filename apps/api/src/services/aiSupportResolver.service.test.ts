import { describe, expect, it } from "vitest";
import {
  buildTicketTranscript,
  fallbackTicketReply,
  latestCustomerMessage,
  type TicketMessageLike,
} from "./aiSupportResolver.service";

function msg(
  p: Partial<TicketMessageLike> & { senderType: string; content: string },
): TicketMessageLike {
  return { internalNote: false, createdAt: new Date(), ...p };
}

describe("buildTicketTranscript", () => {
  it("labels customer / partner / system roles", () => {
    const t = buildTicketTranscript([
      msg({ senderType: "CUSTOMER", content: "My campaign won't send" }),
      msg({ senderType: "PARTNER", content: "Looking into it" }),
      msg({ senderType: "SYSTEM", content: "Ticket reopened" }),
    ]);
    expect(t).toContain("Customer: My campaign won't send");
    expect(t).toContain("Partner: Looking into it");
    expect(t).toContain("System: Ticket reopened");
  });

  it("marks internal notes distinctly so the model treats them as private", () => {
    const t = buildTicketTranscript([
      msg({ senderType: "PARTNER", content: "check their WABA limit", internalNote: true }),
    ]);
    expect(t).toContain("Partner (internal note): check their WABA limit");
  });

  it("caps to the most recent 30 messages", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      msg({ senderType: "CUSTOMER", content: `m${i}` }),
    );
    const t = buildTicketTranscript(many);
    expect(t).toContain("m39");
    expect(t).toContain("m10");
    expect(t).not.toContain("m9\n");
    expect(t.split("\n")).toHaveLength(30);
  });

  it("truncates very long messages", () => {
    const t = buildTicketTranscript([
      msg({ senderType: "CUSTOMER", content: "x".repeat(5000) }),
    ]);
    // "Customer: " prefix + 2000 chars
    expect(t.length).toBeLessThan(2100);
  });

  it("returns empty string for no messages", () => {
    expect(buildTicketTranscript([])).toBe("");
  });
});

describe("latestCustomerMessage", () => {
  it("returns the last CUSTOMER message, ignoring later partner replies", () => {
    const result = latestCustomerMessage([
      msg({ senderType: "CUSTOMER", content: "first" }),
      msg({ senderType: "CUSTOMER", content: "second" }),
      msg({ senderType: "PARTNER", content: "ack" }),
    ]);
    expect(result).toBe("second");
  });

  it("returns null when there is no customer message", () => {
    expect(
      latestCustomerMessage([msg({ senderType: "PARTNER", content: "hi" })]),
    ).toBeNull();
  });

  it("returns null on an empty thread", () => {
    expect(latestCustomerMessage([])).toBeNull();
  });
});

describe("fallbackTicketReply", () => {
  it("greets by name when supplied", () => {
    const r = fallbackTicketReply({ subject: "Billing", customerName: "Acme" });
    expect(r.startsWith("Hi Acme,")).toBe(true);
    expect(r).toContain("Billing");
  });

  it("uses a generic greeting without a name", () => {
    const r = fallbackTicketReply({ subject: "Login issue" });
    expect(r.startsWith("Hi,")).toBe(true);
  });

  it("never references internal notes or invents specifics", () => {
    const r = fallbackTicketReply({ subject: "X", customerName: "Y" });
    expect(r.toLowerCase()).not.toContain("internal");
    expect(r).not.toMatch(/\$\d|refund|ticket #/i);
  });
});
