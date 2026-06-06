import { prisma, ProductAccessSource, TenantStatus, TenantType } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export interface ResolvedProductAccess {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  routeHref: string | null;
  featureKey: string | null;
  icon: string | null;
  enabled: boolean;
  globalEnabled: boolean;
  limits: unknown | null;
  source: ProductAccessSource;
  disabledReason: string | null;
  addOns?: Array<{
    key: string;
    name: string;
    description: string | null;
    priceInPaisa: number;
    billingCycle: string;
    isActive: boolean;
  }>;
}

interface TenantAccessContext {
  id: string;
  type: TenantType | string;
  parentTenantId: string | null;
  featuresEnabled: string | null;
}

interface ProductLike {
  id: string;
  key: string;
  name: string;
  category: string;
  description: string | null;
  routeHref: string | null;
  featureKey: string | null;
  icon: string | null;
  isGlobalEnabled: boolean;
  addOns?: Array<{
    key: string;
    name: string;
    description: string | null;
    priceInPaisa: number;
    billingCycle: string;
    isActive: boolean;
  }>;
}

interface AccessLike {
  productId: string;
  enabled: boolean;
  limits: unknown | null;
  source: ProductAccessSource;
  expiresAt?: Date | string | null;
}

function parseLegacyFeatures(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function isExpired(access: AccessLike | undefined, now: Date): boolean {
  if (!access?.expiresAt) return false;
  return new Date(access.expiresAt).getTime() <= now.getTime();
}

export function resolveProductAccessForTenantContext({
  tenant,
  products,
  partnerAccesses,
  customerAccesses,
  now = new Date(),
}: {
  tenant: TenantAccessContext;
  products: ProductLike[];
  partnerAccesses: AccessLike[];
  customerAccesses: AccessLike[];
  now?: Date;
}): ResolvedProductAccess[] {
  const legacy = parseLegacyFeatures(tenant.featuresEnabled);
  const partnerByProduct = new Map(
    partnerAccesses.map((access) => [access.productId, access]),
  );
  const customerByProduct = new Map(
    customerAccesses.map((access) => [access.productId, access]),
  );
  const isChildCustomer = Boolean(tenant.parentTenantId);

  return products.map((product) => {
    const partnerAccess = partnerByProduct.get(product.id);
    const customerAccess = customerByProduct.get(product.id);

    let enabled = true;
    let source: ProductAccessSource = ProductAccessSource.GLOBAL;
    let disabledReason: string | null = null;
    let limits: unknown | null = null;

    if (!product.isGlobalEnabled) {
      enabled = false;
      source = ProductAccessSource.GLOBAL;
      disabledReason = "Product is disabled globally.";
    } else if (isChildCustomer) {
      source = partnerAccess?.source ?? ProductAccessSource.GLOBAL;
      limits = partnerAccess?.limits ?? null;
      if (!partnerAccess) {
        enabled = false;
        disabledReason = "Partner access is not enabled.";
      } else if (!partnerAccess.enabled || isExpired(partnerAccess, now)) {
        enabled = false;
        disabledReason = "Partner access is disabled.";
      }
    }

    if (enabled && customerAccess) {
      source = customerAccess.source;
      limits = customerAccess.limits ?? limits;
      if (!customerAccess.enabled || isExpired(customerAccess, now)) {
        enabled = false;
        disabledReason = "Customer access is disabled.";
      }
    }

    if (enabled && product.featureKey && legacy[product.featureKey] === false) {
      enabled = false;
      source = ProductAccessSource.LEGACY;
      disabledReason = "Disabled by legacy feature flag.";
    }

    return {
      id: product.id,
      key: product.key,
      name: product.name,
      category: product.category,
      description: product.description,
      routeHref: product.routeHref,
      featureKey: product.featureKey,
      icon: product.icon,
      enabled,
      globalEnabled: product.isGlobalEnabled,
      limits,
      source,
      disabledReason,
      addOns: product.addOns,
    };
  });
}

export async function listTenantProductAccess(
  tenantId: string,
): Promise<ResolvedProductAccess[]> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      type: true,
      parentTenantId: true,
      featuresEnabled: true,
    },
  });
  if (!tenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Customer not found.");
  }

  const [products, customerAccesses, partnerAccesses] = await Promise.all([
    prisma.product.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        addOns: {
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: {
            key: true,
            name: true,
            description: true,
            priceInPaisa: true,
            billingCycle: true,
            isActive: true,
          },
        },
      },
    }),
    prisma.customerProductAccess.findMany({
      where: { customerTenantId: tenantId },
      select: {
        productId: true,
        enabled: true,
        limits: true,
        source: true,
        expiresAt: true,
      },
    }),
    tenant.parentTenantId
      ? prisma.partnerProductAccess.findMany({
          where: { partnerTenantId: tenant.parentTenantId },
          select: {
            productId: true,
            enabled: true,
            limits: true,
            source: true,
            expiresAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  return resolveProductAccessForTenantContext({
    tenant,
    products,
    partnerAccesses,
    customerAccesses,
  });
}

export async function getTenantProductFeatureAccess(
  tenantId: string,
): Promise<Record<string, boolean>> {
  const products = await listTenantProductAccess(tenantId);
  const out: Record<string, boolean> = {};
  for (const product of products) {
    if (!product.featureKey) continue;
    out[product.featureKey] = (out[product.featureKey] ?? false) || product.enabled;
  }
  return out;
}

export async function assertProductEnabled(
  tenantId: string,
  productKey: string,
): Promise<ResolvedProductAccess> {
  const products = await listTenantProductAccess(tenantId);
  const product = products.find((entry) => entry.key === productKey);
  if (!product) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Product not found.");
  }
  if (!product.enabled) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      `${product.name} is not enabled for this customer.`,
    );
  }
  return product;
}

export async function findActiveProductByKey(productKey: string) {
  const product = await prisma.product.findUnique({
    where: { key: productKey },
  });
  if (!product || !product.isGlobalEnabled) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Product not available.");
  }
  return product;
}

export async function assertPartnerOwnsCustomer(
  partnerTenantId: string,
  customerTenantId: string,
) {
  const customer = await prisma.tenant.findFirst({
    where: {
      id: customerTenantId,
      parentTenantId: partnerTenantId,
      type: TenantType.BUSINESS,
      status: { not: TenantStatus.DELETED },
    },
    select: { id: true, name: true, parentTenantId: true },
  });
  if (!customer) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Customer is not managed by this partner.",
    );
  }
  return customer;
}

export async function assertPartnerCanGrantProduct(
  partnerTenantId: string,
  productKey: string,
) {
  const product = await findActiveProductByKey(productKey);
  const access = await prisma.partnerProductAccess.findUnique({
    where: {
      partnerTenantId_productId: {
        partnerTenantId,
        productId: product.id,
      },
    },
  });
  if (!access) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "This product is not enabled for your partner account.",
    );
  }
  if (access && !access.enabled) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "This product is disabled for your partner account.",
    );
  }
  if (access?.expiresAt && access.expiresAt.getTime() <= Date.now()) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "This partner product access has expired.",
    );
  }
  return { product, partnerAccess: access };
}
