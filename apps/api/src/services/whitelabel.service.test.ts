import { beforeEach, describe, expect, it, vi } from "vitest";

// Backfill tests for Codex's Phase 4 white-label service (no coverage
// at ship). Covers the validation rules + the auto-create-default
// path + the reset semantics + the CSS generator.

const mocks = vi.hoisted(() => ({
  brandingFindUnique: vi.fn(),
  brandingCreate: vi.fn(),
  brandingUpdate: vi.fn(),
  brandingDelete: vi.fn(),
  tenantFindUnique: vi.fn(),
}));

vi.mock("@nexaflow/db", () => ({
  prisma: {
    branding: {
      findUnique: mocks.brandingFindUnique,
      create: mocks.brandingCreate,
      update: mocks.brandingUpdate,
      delete: mocks.brandingDelete,
    },
    tenant: { findUnique: mocks.tenantFindUnique },
  },
}));

const defaultBranding = {
  id: "br_1",
  tenantId: "t_1",
  logoUrl: null,
  primaryColor: "#0066cc",
  secondaryColor: "#f0f0f0",
  accentColor: "#ff6600",
  fontFamily: "Inter",
  fontUrl: null,
  customCss: null,
};

describe("whitelabel.service", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === "function" && "mockReset" in m) m.mockReset();
    });
  });

  // -- getBranding -----------------------------------------------------------

  it("getBranding: returns the existing row when present", async () => {
    mocks.brandingFindUnique.mockResolvedValue(defaultBranding);
    const { getBranding } = await import("./whitelabel.service");
    const result = await getBranding("t_1");
    expect(result).toEqual(defaultBranding);
    expect(mocks.brandingCreate).not.toHaveBeenCalled();
  });

  it("getBranding: creates a default row with platform colors when none exists", async () => {
    mocks.brandingFindUnique.mockResolvedValue(null);
    mocks.brandingCreate.mockResolvedValue(defaultBranding);
    const { getBranding } = await import("./whitelabel.service");
    await getBranding("t_1");
    expect(mocks.brandingCreate).toHaveBeenCalledTimes(1);
    const args = mocks.brandingCreate.mock.calls[0][0];
    expect(args.data).toMatchObject({
      tenantId: "t_1",
      primaryColor: "#0066cc",
      secondaryColor: "#f0f0f0",
      accentColor: "#ff6600",
      fontFamily: "Inter",
    });
  });

  // -- updateBranding: validation --------------------------------------------

  it("updateBranding: 404s when the tenant doesn't exist", async () => {
    mocks.tenantFindUnique.mockResolvedValue(null);
    const { updateBranding } = await import("./whitelabel.service");
    await expect(
      updateBranding("missing", { primaryColor: "#abcdef" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.brandingUpdate).not.toHaveBeenCalled();
  });

  it("updateBranding: rejects non-hex color values", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    const { updateBranding } = await import("./whitelabel.service");
    await expect(
      updateBranding("t_1", { primaryColor: "red" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /primaryColor/,
    });
    await expect(
      updateBranding("t_1", { secondaryColor: "0066cc" /* no hash */ }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /secondaryColor/,
    });
    await expect(
      updateBranding("t_1", { accentColor: "#GGGGGG" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: /accentColor/,
    });
    expect(mocks.brandingUpdate).not.toHaveBeenCalled();
  });

  it("updateBranding: accepts both 3- and 6-digit hex shorthand", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.brandingFindUnique.mockResolvedValue(defaultBranding);
    mocks.brandingUpdate.mockResolvedValue({
      ...defaultBranding,
      primaryColor: "#abc",
    });
    const { updateBranding } = await import("./whitelabel.service");
    await expect(
      updateBranding("t_1", { primaryColor: "#abc" }),
    ).resolves.toMatchObject({ primaryColor: "#abc" });
  });

  it("updateBranding: rejects malformed URLs (logoUrl, faviconUrl, fontUrl)", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.brandingFindUnique.mockResolvedValue(defaultBranding);
    mocks.brandingUpdate.mockResolvedValue(defaultBranding);
    const { updateBranding } = await import("./whitelabel.service");
    await expect(
      updateBranding("t_1", { logoUrl: "not-a-url" }),
    ).rejects.toMatchObject({ statusCode: 400, message: /logoUrl/ });
    await expect(
      updateBranding("t_1", { faviconUrl: "ftp//x.y" /* missing colon */ }),
    ).rejects.toMatchObject({ statusCode: 400, message: /faviconUrl/ });
    // Empty string is falsy → skipped, not rejected.
    await expect(updateBranding("t_1", { fontUrl: "" })).resolves.toBeDefined();
  });

  // -- updateBranding: persist -----------------------------------------------

  it("updateBranding: ensures a row exists then applies the update", async () => {
    mocks.tenantFindUnique.mockResolvedValue({ id: "t_1" });
    mocks.brandingFindUnique.mockResolvedValue(null); // forces auto-create
    mocks.brandingCreate.mockResolvedValue(defaultBranding);
    mocks.brandingUpdate.mockResolvedValue({
      ...defaultBranding,
      primaryColor: "#112233",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    const { updateBranding } = await import("./whitelabel.service");
    const result = await updateBranding("t_1", {
      primaryColor: "#112233",
      logoUrl: "https://cdn.example.com/logo.png",
    });
    expect(mocks.brandingCreate).toHaveBeenCalledTimes(1); // auto-create
    expect(mocks.brandingUpdate).toHaveBeenCalledTimes(1);
    expect(result.primaryColor).toBe("#112233");
  });

  // -- resetBrandingField ----------------------------------------------------

  it("resetBrandingField: writes the platform default for the field", async () => {
    mocks.brandingFindUnique.mockResolvedValue(defaultBranding);
    mocks.brandingUpdate.mockImplementation(async ({ data }) => ({
      ...defaultBranding,
      ...data,
    }));
    const { resetBrandingField } = await import("./whitelabel.service");

    await resetBrandingField("t_1", "primaryColor");
    expect(mocks.brandingUpdate.mock.calls[0][0].data).toEqual({
      primaryColor: "#0066cc",
    });

    await resetBrandingField("t_1", "logoUrl");
    expect(mocks.brandingUpdate.mock.calls[1][0].data).toEqual({
      logoUrl: null,
    });

    await resetBrandingField("t_1", "fontFamily");
    expect(mocks.brandingUpdate.mock.calls[2][0].data).toEqual({
      fontFamily: "Inter",
    });
  });

  // -- generateBrandingCss ---------------------------------------------------

  it("generateBrandingCss: emits a :root block with the right CSS variables", async () => {
    const { generateBrandingCss } = await import("./whitelabel.service");
    const css = generateBrandingCss({
      primaryColor: "#112233",
      secondaryColor: "#445566",
      accentColor: "#778899",
      fontFamily: "Lato",
      fontUrl: null,
      customCss: ".banner { display: none; }",
    });
    expect(css).toContain("--color-primary: #112233;");
    expect(css).toContain("--color-secondary: #445566;");
    expect(css).toContain("--color-accent: #778899;");
    expect(css).toContain('"Lato"');
    expect(css).toContain(".banner { display: none; }");
  });

  it("generateBrandingCss: omits the font-url line when fontUrl is null", async () => {
    const { generateBrandingCss } = await import("./whitelabel.service");
    const css = generateBrandingCss({
      primaryColor: "#000",
      secondaryColor: "#000",
      accentColor: "#000",
      fontFamily: "Inter",
      fontUrl: null,
      customCss: "",
    });
    expect(css).not.toMatch(/--font-url/);
    // @font-face block exists but `src:` is empty.
    expect(css).toContain("@font-face");
  });

  // -- deleteBranding --------------------------------------------------------

  it("deleteBranding: removes the row for the tenant", async () => {
    mocks.brandingDelete.mockResolvedValue({});
    const { deleteBranding } = await import("./whitelabel.service");
    await deleteBranding("t_1");
    expect(mocks.brandingDelete).toHaveBeenCalledWith({
      where: { tenantId: "t_1" },
    });
  });
});
