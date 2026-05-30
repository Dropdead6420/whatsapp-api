import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";

export type DemoConversionStage = "COLD" | "NURTURE" | "WARM" | "HOT" | "EXPIRED";

export type DemoConversionAction =
  | "CONVERT_NOW"
  | "SCHEDULE_CALL"
  | "EXTEND_DEMO"
  | "NUDGE_USAGE"
  | "REACTIVATE_DEMO"
  | "ARCHIVE";

export interface DemoConversionSignals {
  daysSinceCreated: number;
  daysToExpire: number;
  contacts: number;
  users: number;
  campaigns: number;
  templates: number;
  leads: number;
  conversations: number;
  appointments: number;
  messages: number;
  inboundMessages: number;
  outboundMessages: number;
}

export interface DemoConversionRecommendation {
  demoId: string;
  tenantId: string;
  tenantName: string;
  score: number;
  stage: DemoConversionStage;
  recommendedAction: DemoConversionAction;
  subject: string;
  message: string;
  reasoning: string;
  signals: DemoConversionSignals;
  aiUsed: boolean;
  aiFallbackReason?: string;
}

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((b.getTime() - a.getTime()) / 86_400_000);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function stageFor(score: number, daysToExpire: number): DemoConversionStage {
  if (daysToExpire < 0) return "EXPIRED";
  if (score >= 70) return "HOT";
  if (score >= 45) return "WARM";
  if (score >= 20) return "NURTURE";
  return "COLD";
}

function actionFor(stage: DemoConversionStage, signals: DemoConversionSignals): DemoConversionAction {
  if (stage === "EXPIRED") return signals.messages > 0 ? "REACTIVATE_DEMO" : "ARCHIVE";
  if (stage === "HOT") return "CONVERT_NOW";
  if (stage === "WARM") return "SCHEDULE_CALL";
  if (signals.daysToExpire <= 5 && signals.contacts + signals.campaigns + signals.messages > 0) {
    return "EXTEND_DEMO";
  }
  return "NUDGE_USAGE";
}

function scoreSignals(signals: DemoConversionSignals): number {
  let score = 5;
  if (signals.users >= 2) score += 10;
  if (signals.contacts >= 3) score += 10;
  if (signals.contacts >= 10) score += 8;
  if (signals.templates > 0) score += 8;
  if (signals.campaigns > 0) score += 14;
  if (signals.leads > 0) score += 12;
  if (signals.conversations > 0) score += 10;
  if (signals.messages > 0) score += 18;
  if (signals.inboundMessages > 0) score += 10;
  if (signals.appointments > 0) score += 8;
  if (signals.daysToExpire <= 7 && signals.daysToExpire >= 0) score += 6;
  if (signals.daysToExpire < 0) score -= 18;
  if (signals.daysSinceCreated < 2 && signals.messages === 0) score -= 8;
  return clampScore(score);
}

function defaultRecommendation(args: {
  demoId: string;
  tenantId: string;
  tenantName: string;
  score: number;
  stage: DemoConversionStage;
  action: DemoConversionAction;
  signals: DemoConversionSignals;
  aiFallbackReason?: string;
}): DemoConversionRecommendation {
  const { action, signals, tenantName } = args;
  const subjectByAction: Record<DemoConversionAction, string> = {
    CONVERT_NOW: `Move ${tenantName} to a paid workspace`,
    SCHEDULE_CALL: `Book a conversion call with ${tenantName}`,
    EXTEND_DEMO: `Extend ${tenantName}'s demo and ask for a call`,
    NUDGE_USAGE: `Send ${tenantName} a guided demo nudge`,
    REACTIVATE_DEMO: `Reactivate ${tenantName}'s expired demo`,
    ARCHIVE: `Archive ${tenantName}'s inactive demo`,
  };
  const messageByAction: Record<DemoConversionAction, string> = {
    CONVERT_NOW:
      `Hi, I noticed your demo is already showing real activity. Want me to activate the paid workspace so your team keeps the same setup and data?`,
    SCHEDULE_CALL:
      `Hi, your demo has enough activity for a quick success review. Can we schedule a 15-minute call to map it to a paid rollout?`,
    EXTEND_DEMO:
      `Hi, your demo is close to expiry and has some useful activity. I can extend it and walk you through the next setup steps.`,
    NUDGE_USAGE:
      `Hi, I can help you get value from the demo faster. Want me to set up a sample campaign, inbox flow, and booking reminder for your business?`,
    REACTIVATE_DEMO:
      `Hi, your demo expired after some activity. I can reactivate it and help convert the setup into a live paid workspace.`,
    ARCHIVE:
      `Hi, I am closing inactive demo workspaces this week. Reply if you want me to reopen this one with a guided setup.`,
  };
  const reasoning = [
    `Score ${args.score}/100 from ${signals.users} user(s), ${signals.contacts} contact(s), ${signals.campaigns} campaign(s), ${signals.messages} message(s), and ${signals.daysToExpire} day(s) to expiry.`,
    args.aiFallbackReason ? `AI copy fallback: ${args.aiFallbackReason}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    demoId: args.demoId,
    tenantId: args.tenantId,
    tenantName,
    score: args.score,
    stage: args.stage,
    recommendedAction: action,
    subject: subjectByAction[action],
    message: messageByAction[action],
    reasoning,
    signals,
    aiUsed: false,
    aiFallbackReason: args.aiFallbackReason,
  };
}

async function maybeUseAi(args: {
  partnerTenantId: string;
  base: DemoConversionRecommendation;
}): Promise<DemoConversionRecommendation> {
  try {
    const { runTenantLlmJson } = await import("./ai.service");
    const parsed = await runTenantLlmJson<{
      subject?: unknown;
      message?: unknown;
      reasoning?: unknown;
      score?: unknown;
      recommendedAction?: unknown;
    }>({
      tenantId: args.partnerTenantId,
      feature: "demo_to_paid",
      system:
        "You are a white-label SaaS partner success assistant. Write concise, practical demo-to-paid follow-up copy. Return strict JSON only.",
      prompt: [
        "Improve this demo-to-paid recommendation without inventing facts.",
        `Demo tenant: ${args.base.tenantName}`,
        `Current score: ${args.base.score}`,
        `Stage: ${args.base.stage}`,
        `Recommended action: ${args.base.recommendedAction}`,
        `Signals: ${JSON.stringify(args.base.signals)}`,
        `Fallback subject: ${args.base.subject}`,
        `Fallback message: ${args.base.message}`,
        "",
        'Return JSON: {"score":0-100,"recommendedAction":"CONVERT_NOW|SCHEDULE_CALL|EXTEND_DEMO|NUDGE_USAGE|REACTIVATE_DEMO|ARCHIVE","subject":"...","message":"...","reasoning":"..."}',
      ].join("\n"),
      maxTokens: 600,
      temperature: 0.35,
    });

    const validActions: DemoConversionAction[] = [
      "CONVERT_NOW",
      "SCHEDULE_CALL",
      "EXTEND_DEMO",
      "NUDGE_USAGE",
      "REACTIVATE_DEMO",
      "ARCHIVE",
    ];
    const nextScore = clampScore(Number(parsed.score ?? args.base.score));
    const nextAction = validActions.includes(parsed.recommendedAction as DemoConversionAction)
      ? (parsed.recommendedAction as DemoConversionAction)
      : args.base.recommendedAction;

    return {
      ...args.base,
      score: nextScore,
      stage: stageFor(nextScore, args.base.signals.daysToExpire),
      recommendedAction: nextAction,
      subject:
        typeof parsed.subject === "string" && parsed.subject.trim()
          ? parsed.subject.trim().slice(0, 160)
          : args.base.subject,
      message:
        typeof parsed.message === "string" && parsed.message.trim()
          ? parsed.message.trim().slice(0, 1200)
          : args.base.message,
      reasoning:
        typeof parsed.reasoning === "string" && parsed.reasoning.trim()
          ? parsed.reasoning.trim().slice(0, 1000)
          : args.base.reasoning,
      aiUsed: true,
      aiFallbackReason: undefined,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "AI unavailable";
    return { ...args.base, aiFallbackReason: reason };
  }
}

export async function recommendDemoConversion(args: {
  partnerTenantId: string;
  demoId: string;
  useAi?: boolean;
}): Promise<DemoConversionRecommendation> {
  const demo = await prisma.demoTenant.findFirst({
    where: {
      id: args.demoId,
      createdByPartnerId: args.partnerTenantId,
    },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: {
            select: {
              contacts: true,
              users: true,
              campaigns: true,
              whatsappTemplates: true,
              leads: true,
              conversations: true,
              appointments: true,
            },
          },
        },
      },
    },
  });

  if (!demo) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Demo tenant not found.");
  }

  const [messages, inboundMessages, outboundMessages] = await Promise.all([
    prisma.message.count({ where: { conversation: { tenantId: demo.tenantId } } }),
    prisma.message.count({
      where: { conversation: { tenantId: demo.tenantId }, direction: "INBOUND" },
    }),
    prisma.message.count({
      where: { conversation: { tenantId: demo.tenantId }, direction: "OUTBOUND" },
    }),
  ]);

  const now = new Date();
  const signals: DemoConversionSignals = {
    daysSinceCreated: Math.max(0, daysBetween(demo.tenant.createdAt, now)),
    daysToExpire: daysBetween(now, demo.expiresAt),
    contacts: demo.tenant._count.contacts,
    users: demo.tenant._count.users,
    campaigns: demo.tenant._count.campaigns,
    templates: demo.tenant._count.whatsappTemplates,
    leads: demo.tenant._count.leads,
    conversations: demo.tenant._count.conversations,
    appointments: demo.tenant._count.appointments,
    messages,
    inboundMessages,
    outboundMessages,
  };
  const score = scoreSignals(signals);
  const stage = stageFor(score, signals.daysToExpire);
  const action = actionFor(stage, signals);
  const base = defaultRecommendation({
    demoId: demo.id,
    tenantId: demo.tenantId,
    tenantName: demo.tenant.name,
    score,
    stage,
    action,
    signals,
  });

  if (args.useAi === false) return base;
  return maybeUseAi({ partnerTenantId: args.partnerTenantId, base });
}
