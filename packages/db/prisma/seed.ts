import { PrismaClient, PlanName, UserRole, UserStatus, TenantType, TenantStatus } from "@prisma/client";
import bcryptjs from "bcryptjs";

const prisma = new PrismaClient();

const PLANS: Array<{
  name: PlanName;
  displayName: string;
  priceInPaisa: number;
  messageQuota: number;
  contactLimit: number;
  agentLimit: number;
  aiCreditsPerMonth: number;
  campaignLimit: number;
  chatbotEnabled: boolean;
  adsIntegrationEnabled: boolean;
  creativeStudioEnabled: boolean;
  apiAccessEnabled: boolean;
}> = [
  {
    name: "STARTER",
    displayName: "Starter",
    priceInPaisa: 99_900,
    messageQuota: 5_000,
    contactLimit: 1_000,
    agentLimit: 1,
    aiCreditsPerMonth: 100,
    campaignLimit: 10,
    chatbotEnabled: false,
    adsIntegrationEnabled: false,
    creativeStudioEnabled: false,
    apiAccessEnabled: false,
  },
  {
    name: "GROWTH",
    displayName: "Growth",
    priceInPaisa: 299_900,
    messageQuota: 25_000,
    contactLimit: 5_000,
    agentLimit: 3,
    aiCreditsPerMonth: 500,
    campaignLimit: 50,
    chatbotEnabled: true,
    adsIntegrationEnabled: false,
    creativeStudioEnabled: true,
    apiAccessEnabled: false,
  },
  {
    name: "PRO",
    displayName: "Pro",
    priceInPaisa: 799_900,
    messageQuota: 100_000,
    contactLimit: 25_000,
    agentLimit: 10,
    aiCreditsPerMonth: 2_000,
    campaignLimit: 200,
    chatbotEnabled: true,
    adsIntegrationEnabled: true,
    creativeStudioEnabled: true,
    apiAccessEnabled: true,
  },
  {
    name: "ENTERPRISE",
    displayName: "Enterprise",
    priceInPaisa: 1_499_900,
    messageQuota: 300_000,
    contactLimit: 75_000,
    agentLimit: 25,
    aiCreditsPerMonth: 5_000,
    campaignLimit: 1_000,
    chatbotEnabled: true,
    adsIntegrationEnabled: true,
    creativeStudioEnabled: true,
    apiAccessEnabled: true,
  },
];

async function seedPlans() {
  for (const plan of PLANS) {
    const existing = await prisma.plan.findFirst({ where: { name: plan.name } });
    if (existing) {
      await prisma.plan.update({
        where: { id: existing.id },
        data: { ...plan, billingCycle: "monthly" },
      });
    } else {
      await prisma.plan.create({ data: { ...plan, billingCycle: "monthly" } });
    }
  }
  console.log(`✓ Seeded ${PLANS.length} plans`);
}

async function seedSuperAdmin() {
  const email = (process.env.SEED_SUPER_ADMIN_EMAIL ?? "admin@nexaflow.local").toLowerCase();
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? "ChangeMe!123";

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    console.log(`✓ Super admin already exists: ${email}`);
    return;
  }

  const platform = await prisma.tenant.upsert({
    where: { domain: "platform.nexaflow.local" },
    update: {},
    create: {
      name: "NexaFlow Platform",
      type: TenantType.DIRECT,
      status: TenantStatus.ACTIVE,
      domain: "platform.nexaflow.local",
    },
  });

  await prisma.user.create({
    data: {
      email,
      name: "Platform Admin",
      password: await bcryptjs.hash(password, 12),
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: new Date(),
      tenantId: platform.id,
    },
  });

  console.log(`✓ Super admin created: ${email} / ${password}`);
  console.log(`  (Override via SEED_SUPER_ADMIN_EMAIL and SEED_SUPER_ADMIN_PASSWORD env vars)`);
}

async function main() {
  await seedPlans();
  await seedSuperAdmin();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
