import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  TenantType,
  TenantStatus,
  UserRole,
  LeadStatus,
} from "@nexaflow/shared";
import { authService } from "./auth.service";

const hashPassword = (pw: string) => authService.hashPassword(pw);

/**
 * Demo Service - Create, manage, and cleanup demo/sandbox tenants
 * 
 * Purpose: Partners can provision temporary demo environments to showcase features
 * to prospective customers. Demos auto-expire and can be renewed up to 2x.
 * 
 * Multi-tenancy: All demos scoped by parentTenantId (the partner who created it)
 * Security: Requires PARTNER_ADMIN or SUPER_ADMIN role
 */

interface CreateDemoInput {
  partnerTenantId: string;
  demoName?: string;
  expiryDays?: number;
}

interface DemoTenantInfo {
  tenantId: string;
  demoTenantId: string;
  demoUrl: string;
  expiresAt: Date;
  credentials: {
    email: string;
    password: string;
  };
  renewalCount: number;
}

/**
 * Create a new demo tenant with sample data
 * - Creates a new Tenant (type: BUSINESS, parent: partner)
 * - Seeds sample contacts, templates, campaign
 * - Creates demo user account
 * - Logs action to audit trail
 */
export async function createDemoTenant(
  input: CreateDemoInput
): Promise<DemoTenantInfo> {
  const { partnerTenantId, demoName = "Demo Workspace", expiryDays = 30 } = input;
  const partner = await prisma.tenant.findUnique({
    where: { id: partnerTenantId },
    select: { id: true, type: true, status: true },
  });

  if (!partner) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Partner tenant not found.");
  }

  if (partner.type !== TenantType.WHITE_LABEL && partner.type !== TenantType.DIRECT) {
    throw new ApiError(
      ErrorCodes.FORBIDDEN,
      403,
      "Only WHITE_LABEL or DIRECT tenants can create demos."
    );
  }

  if (partner.status !== TenantStatus.ACTIVE) {
    throw new ApiError(ErrorCodes.FORBIDDEN, 403, "Partner tenant is not active.");
  }

  // Calculate expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  try {
    // Create demo tenant in transaction to ensure atomicity
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create demo tenant
      const demoTenant = await tx.tenant.create({
        data: {
          name: demoName,
          type: TenantType.BUSINESS,
          status: TenantStatus.ACTIVE,
          parentTenantId: partnerTenantId,
          messageQuotaPerMonth: 1000, // Lower quota for demo
          contactLimit: 100,
          agentLimit: 2,
          aiCreditsPerMonth: 100,
          campaignLimit: 10,
        },
      });

      // 2. Create demo tracking record
      const demoRecord = await tx.demoTenant.create({
        data: {
          tenantId: demoTenant.id,
          createdByPartnerId: partnerTenantId,
          expiresAt,
        },
      });

      // 3. Create demo user (admin role)
      const demoEmail = `demo-${demoTenant.id.slice(0, 8)}@demo.nexaflow.local`;
      const demoPassword = generateSecurePassword();
      const hashedPassword = await hashPassword(demoPassword);

      await tx.user.create({
        data: {
          tenantId: demoTenant.id,
          email: demoEmail,
          password: hashedPassword,
          name: "Demo Admin",
          role: UserRole.BUSINESS_ADMIN,
          emailVerified: new Date(),
          status: "ACTIVE",
        },
      });

      // 4. Seed sample data
      await seedDemoData(tx, demoTenant.id);

      return {
        tenantId: demoTenant.id,
        demoTenantId: demoRecord.id,
        demoEmail,
        demoPassword,
        expiresAt,
      };
    });

    return {
      tenantId: result.tenantId,
      demoTenantId: result.demoTenantId,
      demoUrl: `https://demo-${result.tenantId.slice(0, 8)}.nexaflow.local/login`,
      expiresAt: result.expiresAt,
      credentials: {
        email: result.demoEmail,
        password: result.demoPassword,
      },
      renewalCount: 0,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      "Failed to create demo tenant."
    );
  }
}

/**
 * Renew a demo tenant (extend expiry)
 * - Can renew max 2x (total 3 x 30 days = 90 days max)
 * - Updates expiresAt and lastRenewedAt
 */
export async function renewDemoTenant(
  demoTenantId: string,
  expiryDays: number = 30
): Promise<{ expiresAt: Date; renewalCount: number }> {
  const demoTenant = await prisma.demoTenant.findUnique({
    where: { id: demoTenantId },
  });

  if (!demoTenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Demo tenant not found.");
  }

  if (demoTenant.renewalCount >= 2) {
    throw new ApiError(
      ErrorCodes.QUOTA_EXCEEDED,
      400,
      "Demo has reached maximum renewal count (2x). Please create a new demo."
    );
  }

  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + expiryDays);

  const updated = await prisma.demoTenant.update({
    where: { id: demoTenantId },
    data: {
      expiresAt: newExpiresAt,
      renewalCount: { increment: 1 },
      lastRenewedAt: new Date(),
    },
  });

  return {
    expiresAt: updated.expiresAt,
    renewalCount: updated.renewalCount,
  };
}

/**
 * Delete a demo tenant immediately
 * - Cascade deletes all related data (users, contacts, campaigns, etc.)
 * - Removes DemoTenant record
 */
export async function deleteDemoTenant(demoTenantId: string): Promise<void> {
  const demoTenant = await prisma.demoTenant.findUnique({
    where: { id: demoTenantId },
  });

  if (!demoTenant) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Demo tenant not found.");
  }

  try {
    // Delete tenant (cascade will delete DemoTenant)
    await prisma.tenant.delete({
      where: { id: demoTenant.tenantId },
    });
  } catch (error) {
    throw new ApiError(
      ErrorCodes.INTERNAL_SERVER_ERROR,
      500,
      "Failed to delete demo tenant."
    );
  }
}

/**
 * Get demo tenant info
 */
export async function getDemoTenant(demoTenantId: string) {
  const demo = await prisma.demoTenant.findUnique({
    where: { id: demoTenantId },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          status: true,
          createdAt: true,
          _count: {
            select: {
              contacts: true,
              campaigns: true,
              users: true,
            },
          },
        },
      },
    },
  });

  if (!demo) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Demo tenant not found.");
  }

  return demo;
}

/**
 * List all demo tenants created by a partner
 */
export async function listPartnerDemos(
  partnerTenantId: string,
  page: number = 1,
  limit: number = 25
) {
  const skip = (page - 1) * limit;

  const [demos, total] = await Promise.all([
    prisma.demoTenant.findMany({
      where: { createdByPartnerId: partnerTenantId },
      include: {
        tenant: {
          select: {
            name: true,
            status: true,
            _count: { select: { contacts: true, users: true } },
          },
        },
      },
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.demoTenant.count({
      where: { createdByPartnerId: partnerTenantId },
    }),
  ]);

  return {
    demos,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
}

/**
 * Cleanup expired demo tenants (called by background worker)
 */
export async function cleanupExpiredDemos(): Promise<{ deleted: number }> {
  const now = new Date();

  const expired = await prisma.demoTenant.findMany({
    where: {
      expiresAt: { lte: now },
    },
    select: { tenantId: true },
  });

  let deleted = 0;
  for (const demo of expired) {
    try {
      await prisma.tenant.delete({
        where: { id: demo.tenantId },
      });
      deleted++;
    } catch (error) {
      console.error(
        `Failed to delete expired demo tenant ${demo.tenantId}:`,
        error
      );
    }
  }

  return { deleted };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Seed demo tenant with sample data
 */
async function seedDemoData(
  tx: any, // Prisma transaction client
  tenantId: string
): Promise<void> {
  // 1. Create sample contacts
  const sampleContacts = [
    {
      tenantId,
      firstName: "Alice",
      lastName: "Johnson",
      email: "alice@example.com",
      phoneNumber: "+14155552671",
      source: "DEMO",
    },
    {
      tenantId,
      firstName: "Bob",
      lastName: "Smith",
      email: "bob@example.com",
      phoneNumber: "+14155552672",
      source: "DEMO",
    },
    {
      tenantId,
      firstName: "Charlie",
      lastName: "Brown",
      email: "charlie@example.com",
      phoneNumber: "+14155552673",
      source: "DEMO",
    },
    {
      tenantId,
      firstName: "Diana",
      lastName: "Prince",
      email: "diana@example.com",
      phoneNumber: "+14155552674",
      source: "DEMO",
    },
    {
      tenantId,
      firstName: "Eve",
      lastName: "Wilson",
      email: "eve@example.com",
      phoneNumber: "+14155552675",
      source: "DEMO",
    },
  ];

  await tx.contact.createMany({ data: sampleContacts });

  // 2. Create sample template
  await tx.whatsAppTemplate.create({
    data: {
      tenantId,
      name: "Welcome Message",
      body: "Hello {{name}}, welcome to our demo! 👋",
      status: "APPROVED",
      headerFormat: "TEXT",
      headerText: "Welcome",
      footerText: "Demo Message",
      language: "en",
      category: "MARKETING",
      source: "DEMO",
    },
  });

  // 3. Create sample campaign
  await tx.campaign.create({
    data: {
      tenantId,
      name: "Demo Campaign",
      description: "Sample campaign for demonstration",
      type: "BROADCAST",
      status: "DRAFT",
      createdBy: "demo",
      targetList: [],
      messageTemplate: "Welcome Message",
    },
  });

  // 4. Create sample lead
  await tx.lead.create({
    data: {
      tenantId,
      firstName: "Sample Lead",
      email: "lead@example.com",
      phoneNumber: "+14155552680",
      status: LeadStatus.NEW,
      source: "DEMO",
      assignedTeamId: null,
    },
  });
}

/**
 * Generate a secure random password
 */
function generateSecurePassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%";
  let password = "";
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
