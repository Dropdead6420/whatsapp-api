import { describe, expect, it } from "vitest";
import {
  DEFAULT_GLOBAL_AI_SETTINGS,
  DEFAULT_WORKLOADS,
  mergeRoutesWithDefaults,
  normalizeGlobalAiSettings,
} from "./aiWorkloadRouting.service";

describe("DEFAULT_WORKLOADS", () => {
  it("covers the AI Center workloads with unique keys", () => {
    const keys = DEFAULT_WORKLOADS.map((w) => w.workload);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["content", "text", "chat", "code", "qr", "image", "video", "voice", "embeddings"]) {
      expect(keys).toContain(k);
    }
  });
  it("routes QR to Replicate's controlnet model", () => {
    const qr = DEFAULT_WORKLOADS.find((w) => w.workload === "qr")!;
    expect(qr.provider).toBe("Replicate");
    expect(qr.model).toContain("qr_code_controlnet");
  });
});

describe("mergeRoutesWithDefaults", () => {
  it("returns the full default matrix when nothing is stored", () => {
    expect(mergeRoutesWithDefaults([])).toEqual(DEFAULT_WORKLOADS);
  });

  it("overlays stored overrides onto the matching workload only", () => {
    const merged = mergeRoutesWithDefaults([{ workload: "image", enabled: false, provider: "OpenAI", model: "dall-e-4" }]);
    const image = merged.find((w) => w.workload === "image")!;
    expect(image).toMatchObject({ enabled: false, provider: "OpenAI", model: "dall-e-4" });
    // untouched workloads keep their defaults
    expect(merged.find((w) => w.workload === "chat")!.provider).toBe("OpenAI");
    expect(merged).toHaveLength(DEFAULT_WORKLOADS.length);
  });

  it("falls back to the default provider/model when an override is blank", () => {
    const merged = mergeRoutesWithDefaults([{ workload: "chat", enabled: true, provider: "  ", model: "  " }]);
    const chat = merged.find((w) => w.workload === "chat")!;
    expect(chat.provider).toBe("OpenAI");
    expect(chat.model).toBe("GPT-5.4");
  });
});

describe("normalizeGlobalAiSettings", () => {
  it("falls back to the default provider/model/tone when strings are blank", () => {
    expect(
      normalizeGlobalAiSettings({
        defaultProvider: " ",
        textModel: " ",
        embeddingsModel: " ",
        defaultTone: "",
      }),
    ).toMatchObject({
      defaultProvider: DEFAULT_GLOBAL_AI_SETTINGS.defaultProvider,
      textModel: DEFAULT_GLOBAL_AI_SETTINGS.textModel,
      embeddingsModel: DEFAULT_GLOBAL_AI_SETTINGS.embeddingsModel,
      defaultTone: DEFAULT_GLOBAL_AI_SETTINGS.defaultTone,
    });
  });

  it("clamps global AI length limits to a safe positive range", () => {
    expect(
      normalizeGlobalAiSettings({
        maxInputLength: -10,
        maxOutputLength: 999_999,
      }),
    ).toMatchObject({
      maxInputLength: 1,
      maxOutputLength: 200_000,
    });
  });
});
