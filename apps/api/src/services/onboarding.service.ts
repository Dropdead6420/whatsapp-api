import { prisma } from "@nexaflow/db";
import { MessageDirection } from "@nexaflow/shared";

// Onboarding status: computed from existing tables, not persisted.
//
// We track 4 steps that move a fresh tenant from "signed up but empty"
// to "actually using the product". Each step "completes" based on a
// counted condition in an existing table — no new column, no schema
// migration. This means:
//   - Onboarding state is always consistent with reality (no stale
//     flag that says "done" when a tenant deleted everything).
//   - Re-running the wizard after deleting data shows the right state.
//   - No backfill needed for existing tenants — they auto-complete
//     past steps based on data they already have.
//
// The cost: a few `count()` queries per status check. All indexed
// (tenantId is on every model) so this stays sub-ms even for big
// tenants.

export type OnboardingStepKey =
  | "connect_whatsapp"
  | "import_contacts"
  | "create_agent"
  | "send_message";

export interface OnboardingStep {
  key: OnboardingStepKey;
  title: string;
  description: string;
  /** What the operator clicks next; relative path the web can route to. */
  ctaHref: string;
  ctaLabel: string;
  done: boolean;
  /** Free-form context the UI may surface (e.g. "3 contacts imported"). */
  detail: string | null;
}

export interface OnboardingStatus {
  steps: OnboardingStep[];
  completedSteps: number;
  totalSteps: number;
  completed: boolean;
}

export async function getOnboardingStatus(
  tenantId: string,
): Promise<OnboardingStatus> {
  // Run the four count queries in parallel. Each is a small index
  // hit; total wall-clock should be <5ms even on a loaded cluster.
  const [tenant, contactCount, activeAgentCount, outboundCount] =
    await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { wabaAccessToken: true, wabaPhoneNumber: true },
      }),
      prisma.contact.count({ where: { tenantId } }),
      prisma.aiAgent.count({
        where: { tenantId, status: "ACTIVE" },
      }),
      prisma.message.count({
        where: {
          conversation: { tenantId },
          direction: MessageDirection.OUTBOUND,
        },
      }),
    ]);

  const whatsappConnected = Boolean(
    tenant?.wabaAccessToken && tenant?.wabaPhoneNumber,
  );

  const steps: OnboardingStep[] = [
    {
      key: "connect_whatsapp",
      title: "Connect WhatsApp Business",
      description:
        "Link a WABA + phone number so the platform can send and receive messages.",
      ctaHref: "/whatsapp-settings",
      ctaLabel: whatsappConnected ? "Manage connection" : "Connect now",
      done: whatsappConnected,
      detail: whatsappConnected
        ? "Connection active"
        : "Required before any messages can be sent",
    },
    {
      key: "import_contacts",
      title: "Import your first contacts",
      description:
        "Upload a CSV or add contacts manually. Required before sending campaigns.",
      ctaHref: "/contacts",
      ctaLabel: contactCount > 0 ? "View contacts" : "Add contacts",
      done: contactCount > 0,
      detail:
        contactCount > 0
          ? `${contactCount.toLocaleString()} contact${contactCount === 1 ? "" : "s"} in your CRM`
          : null,
    },
    {
      key: "create_agent",
      title: "Create your first AI agent",
      description:
        "Configure an agent that grounds against your Knowledge Base and auto-handles inbound DMs.",
      ctaHref: "/ai-agents",
      ctaLabel: activeAgentCount > 0 ? "View agents" : "Create agent",
      done: activeAgentCount > 0,
      detail:
        activeAgentCount > 0
          ? `${activeAgentCount} ACTIVE agent${activeAgentCount === 1 ? "" : "s"}`
          : null,
    },
    {
      key: "send_message",
      title: "Send your first message",
      description:
        "Reply to an inbound DM from the inbox, run a test campaign, or test-drive an agent.",
      ctaHref: "/inbox",
      ctaLabel: outboundCount > 0 ? "Open inbox" : "Open inbox to start",
      done: outboundCount > 0,
      detail:
        outboundCount > 0
          ? `${outboundCount.toLocaleString()} outbound message${outboundCount === 1 ? "" : "s"} sent`
          : null,
    },
  ];

  const completedSteps = steps.filter((s) => s.done).length;
  return {
    steps,
    completedSteps,
    totalSteps: steps.length,
    completed: completedSteps === steps.length,
  };
}
