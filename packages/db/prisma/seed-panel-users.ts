import {
  PrismaClient,
  SubscriptionStatus,
  TenantStatus,
  TenantType,
  UserRole,
  UserStatus,
} from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

const password =
  process.env.SEED_PANEL_PASSWORD ??
  process.env.SEED_SUPER_ADMIN_PASSWORD ??
  "ChangeMe!123";

const panelUsers = [
  {
    email: process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@medscub.in",
    name: "Platform Admin",
    role: UserRole.SUPER_ADMIN,
    tenant: "platform",
    team: false,
  },
  {
    email: process.env.SEED_PARTNER_ADMIN_EMAIL ?? "partner@medscub.in",
    name: "Partner Admin",
    role: UserRole.WHITE_LABEL_ADMIN,
    tenant: "partner",
    team: false,
  },
  {
    email: process.env.SEED_BUSINESS_ADMIN_EMAIL ?? "business@medscub.in",
    name: "Business Admin",
    role: UserRole.BUSINESS_ADMIN,
    tenant: "business",
    team: false,
  },
  {
    email: process.env.SEED_TEAM_LEAD_EMAIL ?? "teamlead@medscub.in",
    name: "Team Lead",
    role: UserRole.TEAM_LEAD,
    tenant: "business",
    team: true,
  },
  {
    email: process.env.SEED_AGENT_EMAIL ?? "agent@medscub.in",
    name: "Support Agent",
    role: UserRole.AGENT,
    tenant: "business",
    team: true,
  },
] as const;

async function upsertTenant(args: {
  name: string;
  domain: string;
  type: TenantType;
  parentTenantId?: string | null;
  messageQuotaPerMonth?: number;
}) {
  return prisma.tenant.upsert({
    where: { domain: args.domain },
    update: {
      name: args.name,
      type: args.type,
      status: TenantStatus.ACTIVE,
      parentTenantId: args.parentTenantId ?? null,
      messageQuotaPerMonth: args.messageQuotaPerMonth ?? 100_000,
      contactLimit: 25_000,
      agentLimit: 25,
      aiCreditsPerMonth: 5_000,
      campaignLimit: 1_000,
    },
    create: {
      name: args.name,
      domain: args.domain,
      type: args.type,
      status: TenantStatus.ACTIVE,
      parentTenantId: args.parentTenantId ?? null,
      messageQuotaPerMonth: args.messageQuotaPerMonth ?? 100_000,
      contactLimit: 25_000,
      agentLimit: 25,
      aiCreditsPerMonth: 5_000,
      campaignLimit: 1_000,
    },
  });
}

async function ensureTeam(tenantId: string) {
  const name = "Front Desk Team";
  const existing = await prisma.team.findFirst({ where: { tenantId, name } });
  if (existing) return existing;
  return prisma.team.create({
    data: { tenantId, name, description: "Seeded demo team for live panel access." },
  });
}

async function ensureWallet(tenantId: string, balanceCredits: number, creditLimit: number) {
  return prisma.wallet.upsert({
    where: { tenantId },
    update: {
      balanceCredits,
      creditLimit,
      lowBalanceThreshold: 500,
      status: "ACTIVE",
    },
    create: {
      tenantId,
      balanceCredits,
      creditLimit,
      lowBalanceThreshold: 500,
      status: "ACTIVE",
    },
  });
}

async function ensureSubscription(tenantId: string, planName: "PRO" | "ENTERPRISE") {
  const plan = await prisma.plan.findFirst({ where: { name: planName } });
  if (!plan) return null;

  const currentPeriodStart = new Date();
  const currentPeriodEnd = new Date(currentPeriodStart);
  currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

  const existing = await prisma.subscription.findFirst({
    where: { tenantId, status: SubscriptionStatus.ACTIVE },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return prisma.subscription.update({
      where: { id: existing.id },
      data: { planId: plan.id, currentPeriodStart, currentPeriodEnd },
    });
  }

  return prisma.subscription.create({
    data: {
      tenantId,
      planId: plan.id,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
    },
  });
}

async function upsertUser(args: {
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  assignedTeamId?: string | null;
}) {
  const normalizedEmail = args.email.toLowerCase();
  const passwordHash = await bcryptjs.hash(password, 12);
  const existing = await prisma.user.findFirst({ where: { email: normalizedEmail } });

  const data = {
    name: args.name,
    password: passwordHash,
    role: args.role,
    tenantId: args.tenantId,
    assignedTeamId: args.assignedTeamId ?? null,
    status: UserStatus.ACTIVE,
    emailVerified: new Date(),
  };

  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data,
    });
  }

  return prisma.user.create({
    data: {
      email: normalizedEmail,
      ...data,
    },
  });
}

async function main() {
  const platform = await upsertTenant({
    name: "NexaFlow Platform",
    domain: "platform.nexaflow.local",
    type: TenantType.DIRECT,
    messageQuotaPerMonth: 300_000,
  });

  const partner = await upsertTenant({
    name: process.env.SEED_PARTNER_TENANT_NAME ?? "Medscub Partner Demo",
    domain: process.env.SEED_PARTNER_TENANT_DOMAIN ?? "partner.demo.medscub.local",
    type: TenantType.WHITE_LABEL,
    messageQuotaPerMonth: 300_000,
  });

  const business = await upsertTenant({
    name: process.env.SEED_BUSINESS_TENANT_NAME ?? "Cutz & Bangs Demo Business",
    domain: process.env.SEED_BUSINESS_TENANT_DOMAIN ?? "cutz-bangs.demo.medscub.local",
    type: TenantType.BUSINESS,
    parentTenantId: partner.id,
    messageQuotaPerMonth: 100_000,
  });

  const team = await ensureTeam(business.id);

  await ensureWallet(partner.id, 50_000, 100_000);
  await ensureWallet(business.id, 25_000, 50_000);
  await ensureSubscription(partner.id, "ENTERPRISE");
  await ensureSubscription(business.id, "PRO");

  await prisma.branding.upsert({
    where: { tenantId: partner.id },
    update: {
      primaryColor: "#0f172a",
      secondaryColor: "#e2e8f0",
      accentColor: "#10b981",
      fontFamily: "Inter",
    },
    create: {
      tenantId: partner.id,
      primaryColor: "#0f172a",
      secondaryColor: "#e2e8f0",
      accentColor: "#10b981",
      fontFamily: "Inter",
    },
  });

  const tenants = { platform, partner, business };
  const users = [];

  for (const panelUser of panelUsers) {
    const tenant = tenants[panelUser.tenant];
    users.push(
      await upsertUser({
        email: panelUser.email,
        name: panelUser.name,
        role: panelUser.role,
        tenantId: tenant.id,
        assignedTeamId: panelUser.team ? team.id : null,
      }),
    );
  }

  console.log("✓ Seeded panel users");
  for (const user of users) {
    console.log(`  ${user.role}: ${user.email}`);
  }
  console.log("  Password: value of SEED_PANEL_PASSWORD (or SEED_SUPER_ADMIN_PASSWORD)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
