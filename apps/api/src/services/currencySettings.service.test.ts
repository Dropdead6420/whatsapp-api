import { describe, expect, it } from "vitest";
import {
  LAUNCH_CURRENCIES,
  defaultLocaleForCurrency,
  normalizeCurrencyCodes,
  normalizeCurrencyUpsertInput,
  resolveAllowedCurrencyCodes,
  resolveCurrencyPreference,
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

  it("resolves allowed currencies against the active platform list", () => {
    expect(
      resolveAllowedCurrencyCodes({
        allowedCurrencies: ["usd", "cad", "jpy"],
        activeCurrencyCodes: ["INR", "USD", "CAD"],
        defaultCurrencyCode: "INR",
      }),
    ).toEqual(["CAD", "USD"]);
  });

  it("falls back to the default or INR when partner allowed currencies are inactive", () => {
    expect(
      resolveAllowedCurrencyCodes({
        allowedCurrencies: ["JPY"],
        activeCurrencyCodes: ["INR", "USD"],
        defaultCurrencyCode: "USD",
      }),
    ).toEqual(["USD"]);

    expect(
      resolveAllowedCurrencyCodes({
        allowedCurrencies: ["JPY"],
        activeCurrencyCodes: ["INR", "USD"],
        defaultCurrencyCode: "CAD",
      }),
    ).toEqual(["INR"]);
  });

  it("chooses a saved preference only when the currency is allowed", () => {
    expect(
      resolveCurrencyPreference({
        requestedCurrencyCode: "usd",
        defaultCurrencyCode: "INR",
        allowedCurrencies: ["INR", "USD"],
      }),
    ).toBe("USD");
    expect(
      resolveCurrencyPreference({
        requestedCurrencyCode: "EUR",
        defaultCurrencyCode: "INR",
        allowedCurrencies: ["INR", "USD"],
      }),
    ).toBe("INR");
  });

  it("maps known launch currencies to stable display locales", () => {
    expect(defaultLocaleForCurrency("inr")).toBe("en-IN");
    expect(defaultLocaleForCurrency("USD")).toBe("en-US");
    expect(defaultLocaleForCurrency("AED")).toBe("en-AE");
    expect(defaultLocaleForCurrency("ZZZ")).toBe("en");
  });
});
