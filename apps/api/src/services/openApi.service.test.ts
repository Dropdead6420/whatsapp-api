import { describe, expect, it } from "vitest";
import { buildPublicOpenApiSpec } from "./openApi.service";

describe("buildPublicOpenApiSpec", () => {
  it("builds an OpenAPI 3 spec for the public API surface", () => {
    const spec = buildPublicOpenApiSpec({ serverUrl: "https://api.example.com/" });

    expect(spec.openapi).toBe("3.0.3");
    expect(spec.servers[0].url).toBe("https://api.example.com");
    expect(spec.paths["/api/public/v1/status"].get.summary).toMatch(/validate/i);
    expect(spec.paths["/api/public/v1/contacts"].post.requestBody.required).toBe(
      true,
    );
    expect(spec.paths["/api/public/v1/leads/{id}"].patch.summary).toBe(
      "Update lead",
    );
    expect(spec.components.securitySchemes.bearerApiKey.type).toBe("http");
    expect(spec.components.securitySchemes.headerApiKey.name).toBe(
      "X-NexaFlow-API-Key",
    );
  });
});
