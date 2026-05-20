import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

/**
 * White-Label Service - Partner branding customization
 * 
 * Purpose: Partners can customize the appearance of their customer portals
 * with custom logos, colors, fonts, and CSS.
 * 
 * Multi-tenancy: Branding is unique per tenant, accessed via branding relation
 * Security: Only tenant owners can update their branding
 */

export interface BrandingInput {
  logoUrl?: string;
  logoSquareUrl?: string;
  faviconUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  fontFamily?: string;
  fontUrl?: string;
  customCss?: string;
}

/**
 * Get branding for a tenant
 * - Returns default branding if none exists
 * - Creates branding record on first access
 */
export async function getBranding(tenantId: string) {
  let branding = await prisma.branding.findUnique({
    where: { tenantId },
  });

  // Create default branding if not exists
  if (!branding) {
    branding = await prisma.branding.create({
      data: {
        tenantId,
        primaryColor: "#0066cc",
        secondaryColor: "#f0f0f0",
        accentColor: "#ff6600",
        fontFamily: "Inter",
      },
    });
  }

  return branding;
}

/**
 * Update branding for a tenant
 */
export async function updateBranding(
  tenantId: string,
  input: BrandingInput
): Promise<any> {
  // Validate tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Tenant not found.");
  }

  // Validate color inputs if provided
  if (input.primaryColor && !isValidColor(input.primaryColor)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid primaryColor format. Use hex color (e.g., #0066cc)."
    );
  }
  if (input.secondaryColor && !isValidColor(input.secondaryColor)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid secondaryColor format. Use hex color (e.g., #f0f0f0)."
    );
  }
  if (input.accentColor && !isValidColor(input.accentColor)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid accentColor format. Use hex color (e.g., #ff6600)."
    );
  }

  // Validate URLs if provided
  if (input.logoUrl && !isValidUrl(input.logoUrl)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid logoUrl format. Must be a valid URL."
    );
  }
  if (input.logoSquareUrl && !isValidUrl(input.logoSquareUrl)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid logoSquareUrl format. Must be a valid URL."
    );
  }
  if (input.faviconUrl && !isValidUrl(input.faviconUrl)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid faviconUrl format. Must be a valid URL."
    );
  }
  if (input.fontUrl && !isValidUrl(input.fontUrl)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Invalid fontUrl format. Must be a valid URL."
    );
  }

  // Ensure branding record exists
  await getBranding(tenantId);

  // Update branding
  const updated = await prisma.branding.update({
    where: { tenantId },
    data: {
      logoUrl: input.logoUrl ?? undefined,
      logoSquareUrl: input.logoSquareUrl ?? undefined,
      faviconUrl: input.faviconUrl ?? undefined,
      primaryColor: input.primaryColor ?? undefined,
      secondaryColor: input.secondaryColor ?? undefined,
      accentColor: input.accentColor ?? undefined,
      fontFamily: input.fontFamily ?? undefined,
      fontUrl: input.fontUrl ?? undefined,
      customCss: input.customCss ?? undefined,
    },
  });

  return updated;
}

/**
 * Reset specific branding field to default
 */
export async function resetBrandingField(
  tenantId: string,
  field: keyof BrandingInput
): Promise<any> {
  // Ensure branding record exists
  await getBranding(tenantId);

  const defaults: Record<keyof BrandingInput, any> = {
    logoUrl: null,
    logoSquareUrl: null,
    faviconUrl: null,
    primaryColor: "#0066cc",
    secondaryColor: "#f0f0f0",
    accentColor: "#ff6600",
    fontFamily: "Inter",
    fontUrl: null,
    customCss: null,
  };

  const updated = await prisma.branding.update({
    where: { tenantId },
    data: {
      [field]: defaults[field],
    },
  });

  return updated;
}

/**
 * Generate CSS variables from branding
 * Used by frontend to inject dynamic styles
 */
export function generateBrandingCss(branding: any): string {
  const css = `
:root {
  --color-primary: ${branding.primaryColor};
  --color-secondary: ${branding.secondaryColor};
  --color-accent: ${branding.accentColor};
  --font-family: "${branding.fontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  ${branding.fontUrl ? `--font-url: url('${branding.fontUrl}');` : ""}
}

@font-face {
  ${branding.fontUrl ? `src: url('${branding.fontUrl}');` : ""}
  font-family: "${branding.fontFamily}";
}

body {
  font-family: var(--font-family);
}

${branding.customCss || ""}
  `.trim();

  return css;
}

/**
 * Delete all branding data (reset to defaults)
 */
export async function deleteBranding(tenantId: string): Promise<void> {
  await prisma.branding.delete({
    where: { tenantId },
  });
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function isValidColor(color: string): boolean {
  // Check for valid hex color (#RRGGBB or #RGB)
  return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}
