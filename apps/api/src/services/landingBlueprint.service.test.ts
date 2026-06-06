import { describe, expect, it } from "vitest";
import {
  buildLandingBlueprint,
  featuresForIndustry,
} from "./landingBlueprint.service";
import { normalizeBlocks } from "./landingPage.service";

describe("featuresForIndustry", () => {
  it("returns industry-specific blurbs when known", () => {
    const f = featuresForIndustry("Restaurant");
    expect(f).toHaveLength(3);
    expect(f[0].title).toBe("Fresh every day");
  });
  it("falls back to generic blurbs", () => {
    const f = featuresForIndustry("widgets");
    expect(f).toHaveLength(3);
    expect(f[0].title).toBe("Quality you can trust");
  });
});

describe("buildLandingBlueprint", () => {
  it("produces hero/features/cta/contact in order", () => {
    const bp = buildLandingBlueprint({ businessName: "Acme" });
    expect(bp.title).toBe("Acme");
    expect(bp.blocks.map((b) => b.type)).toEqual(["hero", "features", "cta", "contact"]);
    expect(bp.blocks[0].props.headline).toBe("Acme");
  });

  it("uses the description verbatim as the hero subheadline", () => {
    const bp = buildLandingBlueprint({ businessName: "Acme", description: "We fix taps fast." });
    expect(bp.blocks[0].props.subheadline).toBe("We fix taps fast.");
  });

  it("derives a subheadline from industry + city when no description", () => {
    const bp = buildLandingBlueprint({ businessName: "Acme", industry: "Plumbing", city: "Pune" });
    expect(String(bp.blocks[0].props.subheadline)).toContain("Plumbing");
    expect(String(bp.blocks[0].props.subheadline)).toContain("Pune");
  });

  it("maps the goal to the CTA label", () => {
    const bookings = buildLandingBlueprint({ businessName: "Acme", primaryGoal: "bookings" });
    expect(bookings.blocks[0].props.ctaLabel).toBe("Book an Appointment");
    expect(bookings.blocks[2].props.buttonLabel).toBe("Book an Appointment");
    const sales = buildLandingBlueprint({ businessName: "Acme", primaryGoal: "sales" });
    expect(sales.blocks[0].props.ctaLabel).toBe("Shop Now");
  });

  it("passes the phone into the contact block", () => {
    const bp = buildLandingBlueprint({ businessName: "Acme", phone: "+919876543210" });
    const contact = bp.blocks[3];
    expect(contact.type).toBe("contact");
    expect(contact.props.phone).toBe("+919876543210");
  });

  it("generates blocks that pass the page block validator", () => {
    const bp = buildLandingBlueprint({ businessName: "Acme", industry: "salon" });
    const normalized = normalizeBlocks(bp.blocks);
    expect(normalized).toHaveLength(4);
  });
});
