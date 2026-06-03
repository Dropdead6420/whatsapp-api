import { describe, expect, it } from "vitest";
import {
  convertMicros,
  normalizeCurrencyRateInput,
  serializeCurrencyRate,
  type CurrencyRateCreateInput,
} from "./currency.service";

const base: CurrencyRateCreateInput = {
  baseCurrency: "usd",
  quoteCurrency: "inr",
  rateMicros: 83_000_000, // 1 USD = 83 INR
};

describe("convertMicros", () => {
  it("converts base→quote with the rate (1 USD = 83 INR)", () => {
    // 2 USD in micros = 2_000_000 ; ×83 → 166 INR in micros
    expect(convertMicros(2_000_000n, 83_000_000n)).toBe(166_000_000n);
  });
  it("is identity at rate 1.0", () => {
    expect(convertMicros(1_234_567n, 1_000_000n)).toBe(1_234_567n);
  });
  it("ceil-rounds sub-unit fractions up", () => {
    // 1 micro × 1.5 rate = 1.5 micros → ceil → 2
    expect(convertMicros(1n, 1_500_000n)).toBe(2n);
  });
  it("returns 0 for a zero amount", () => {
    expect(convertMicros(0n, 83_000_000n)).toBe(0n);
  });
  it("rejects a non-positive rate", () => {
    expect(() => convertMicros(1_000_000n, 0n)).toThrow(/rateMicros must be positive/);
    expect(() => convertMicros(1_000_000n, -5n)).toThrow(/rateMicros must be positive/);
  });
});

describe("normalizeCurrencyRateInput", () => {
  it("uppercases currencies and coerces rate to bigint", () => {
    const out = normalizeCurrencyRateInput(base);
    expect(out.baseCurrency).toBe("USD");
    expect(out.quoteCurrency).toBe("INR");
    expect(out.rateMicros).toBe(83_000_000n);
    expect(out.isActive).toBe(true);
    expect(out.effectiveTo).toBeNull();
    expect(out.effectiveFrom).toBeInstanceOf(Date);
  });

  it("accepts a string rate", () => {
    expect(
      normalizeCurrencyRateInput({ ...base, rateMicros: "90000000" }).rateMicros,
    ).toBe(90_000_000n);
  });

  it("rejects identical base and quote", () => {
    expect(() =>
      normalizeCurrencyRateInput({ ...base, quoteCurrency: "USD" }),
    ).toThrow(/must differ/);
  });

  it("rejects a non-positive rate", () => {
    expect(() => normalizeCurrencyRateInput({ ...base, rateMicros: 0 })).toThrow(
      /rateMicros must be positive/,
    );
  });

  it("rejects a bad currency code", () => {
    expect(() =>
      normalizeCurrencyRateInput({ ...base, baseCurrency: "dollars" }),
    ).toThrow(/3-letter ISO/);
  });

  it("rejects effectiveTo on or before effectiveFrom", () => {
    expect(() =>
      normalizeCurrencyRateInput({
        ...base,
        effectiveFrom: "2026-02-01T00:00:00Z",
        effectiveTo: "2026-01-01T00:00:00Z",
      }),
    ).toThrow(/effectiveTo must be after effectiveFrom/);
  });

  it("rejects an invalid date", () => {
    expect(() =>
      normalizeCurrencyRateInput({ ...base, effectiveFrom: "nope" }),
    ).toThrow(/not a valid date/);
  });
});

describe("serializeCurrencyRate", () => {
  it("renders BigInt rateMicros as a string", () => {
    const out = serializeCurrencyRate({
      id: "c1",
      rateMicros: 83_000_000n,
      baseCurrency: "USD",
    });
    expect(out.rateMicros).toBe("83000000");
    expect(out.baseCurrency).toBe("USD");
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
