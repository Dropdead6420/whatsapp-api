import { describe, expect, it } from "vitest";
import {
  LAUNCH_CURRENCIES,
  normalizeCurrencyCodes,
  normalizeCurrencyUpsertInput,
} from "./currencySettings.service";

describe("currency settings helpers", () => {
  it("normalizes and dedupes currency codes", () => {
    expect(normalizeCurrencyCodes(["usd", "INR", "usd", " eur "])).toEqual([
      "EUR",
      "INR",
      "USD",
    ]);
  });

  it("normalizes currency upsert input", () => {
    const out = normalizeCurrencyUpsertInput({
      code: "gbp",
      name: " British Pound ",
      symbol: " £ ",
      minorUnit: 2,
      displayOrder: 50,
    });
    expect(out).toMatchObject({
      code: "GBP",
      name: "British Pound",
      symbol: "£",
      minorUnit: 2,
      displayOrder: 50,
      isActive: true,
      isLaunchCurrency: false,
    });
  });

  it("rejects invalid minor units", () => {
    expect(() =>
      normalizeCurrencyUpsertInput({
        code: "USD",
        name: "Dollar",
        symbol: "$",
        minorUnit: -1,
      }),
    ).toThrow(/minorUnit/);
    expect(() =>
      normalizeCurrencyUpsertInput({
        code: "USD",
        name: "Dollar",
        symbol: "$",
        minorUnit: 9,
      }),
    ).toThrow(/minorUnit/);
  });

  it("keeps the launch set required by the final PDF", () => {
    expect(LAUNCH_CURRENCIES.map((c) => c.code)).toEqual([
      "INR",
      "USD",
      "CAD",
      "AED",
      "GBP",
      "EUR",
      "AUD",
      "SGD",
    ]);
  });
});
