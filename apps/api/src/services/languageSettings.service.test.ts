import { TextDirection } from "@nexaflow/db";
import { describe, expect, it } from "vitest";
import {
  LAUNCH_LANGUAGES,
  isRtlLanguageCode,
  normalizeLanguageCodes,
  normalizeLanguageUpsertInput,
} from "./languageSettings.service";

describe("language settings helpers", () => {
  it("normalizes and dedupes language codes", () => {
    expect(normalizeLanguageCodes(["HI", "en", "hi", " ur "])).toEqual([
      "en",
      "hi",
      "ur",
    ]);
  });

  it("detects RTL languages from launch metadata and base subtags", () => {
    expect(isRtlLanguageCode("ur")).toBe(true);
    expect(isRtlLanguageCode("ar-AE")).toBe(true);
    expect(isRtlLanguageCode("hi")).toBe(false);
    expect(isRtlLanguageCode(undefined)).toBe(false);
  });

  it("normalizes language upsert input", () => {
    const out = normalizeLanguageUpsertInput({
      code: "AR",
      name: " Arabic ",
      nativeName: " العربية ",
      displayOrder: 50,
    });
    expect(out).toMatchObject({
      code: "ar",
      name: "Arabic",
      nativeName: "العربية",
      direction: TextDirection.RTL,
      displayOrder: 50,
      isActive: true,
      isLaunchLanguage: false,
    });
  });

  it("rejects invalid language codes and display orders", () => {
    expect(() =>
      normalizeLanguageUpsertInput({
        code: "english",
        name: "English",
        nativeName: "English",
      }),
    ).toThrow(/Language code/);
    expect(() =>
      normalizeLanguageUpsertInput({
        code: "en",
        name: "English",
        nativeName: "English",
        displayOrder: -1,
      }),
    ).toThrow(/displayOrder/);
  });

  it("keeps the 13 launch languages required by the final PDF", () => {
    expect(LAUNCH_LANGUAGES.map((l) => l.code)).toEqual([
      "en",
      "hi",
      "ur",
      "bn",
      "ar",
      "fr",
      "es",
      "de",
      "pa",
      "ta",
      "te",
      "mr",
      "gu",
    ]);
  });
});
