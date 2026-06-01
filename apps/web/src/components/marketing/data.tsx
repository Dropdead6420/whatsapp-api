import {
  BarChart3,
  Bot,
  CheckCircle2,
  GitBranch,
  Inbox,
  Megaphone,
  Plug,
  ShieldCheck,
  Sparkles,
  WalletCards,
  Workflow,
} from "lucide-react";

export const productPillars = [
  {
    title: "Manage",
    description:
      "Shared WhatsApp inbox, assignment, notes, labels, SLA timers, and AI reply suggestions in one team workspace.",
    href: "/features/inbox",
    icon: Inbox,
  },
  {
    title: "Reach",
    description:
      "Broadcast campaigns, templates, audience filters, delivery controls, opt-out safety, and campaign analytics.",
    href: "/features/campaigns",
    icon: Megaphone,
  },
  {
    title: "Automate",
    description:
      "No-code workflows, chatbot flows, lead capture, appointment reminders, webhooks, and delayed follow-ups.",
    href: "/features/workflows",
    icon: Workflow,
  },
  {
    title: "Assist",
    description:
      "AI agents use your knowledge base, tools, and fallback rules to draft or answer customer conversations.",
    href: "/features/ai-agents",
    icon: Bot,
  },
  {
    title: "Govern",
    description:
      "Compliance firewall, opt-in tracking, smart throttles, wallet risk controls, audit logs, and feature flags.",
    href: "/features/compliance",
    icon: ShieldCheck,
  },
  {
    title: "Analyse",
    description:
      "Dashboards for contacts, conversations, campaigns, revenue signals, provider health, and platform monitoring.",
    href: "/features/analytics",
    icon: BarChart3,
  },
];

export const useCases = [
  "Salons and clinics",
  "Coaches and consultants",
  "Local service teams",
  "E-commerce support",
  "Agencies and resellers",
  "Multi-location brands",
];

export const featurePages = {
  inbox: {
    title: "Shared WhatsApp Inbox",
    intro:
      "Give every agent a clear, accountable inbox with routing, context, labels, AI reply help, and SLA visibility.",
    icon: Inbox,
    bullets: [
      "Team inbox with assignment, labels, notes, canned replies, and conversation status.",
      "SLA breach indicators and first-response tracking for faster customer care.",
      "AI reply suggestions and sentiment signals without removing human control.",
      "Customer context, contact tags, lead links, and recent activity beside the thread.",
    ],
    workflow: ["Inbound message", "Auto-route", "AI assist", "Agent reply", "SLA/reporting"],
  },
  campaigns: {
    title: "Campaigns and Broadcasts",
    intro:
      "Plan and send WhatsApp broadcasts with templates, segmentation, compliance gates, throttles, and performance reporting.",
    icon: Megaphone,
    bullets: [
      "Template-driven campaigns with audience filters that exclude opted-out contacts.",
      "Compliance checks before sends and smart throttling to protect quality rating.",
      "Status tracking from draft to scheduled, running, paused, completed, or failed.",
      "Analytics for delivery, read behavior, engagement, and follow-up opportunities.",
    ],
    workflow: ["Audience", "Template", "Compliance", "Send throttle", "Results"],
  },
  "ai-agents": {
    title: "AI Agent Builder",
    intro:
      "Create tenant-scoped AI agents that use knowledge, tools, fallback behavior, and workflow nodes to support customers.",
    icon: Bot,
    bullets: [
      "Draft, edit, publish, disable, archive, and choose a default agent.",
      "Provider/model presets, temperature and token controls, tools, and fallback behavior.",
      "Knowledge-base category and tag selection to keep answers grounded.",
      "Flow Builder AI_AGENT node lets operators route conversations through active agents.",
    ],
    workflow: ["Persona", "Knowledge", "Tools", "Test run", "Publish"],
  },
  workflows: {
    title: "Workflow Builder",
    intro:
      "Design WhatsApp automations with reusable nodes for messages, conditions, delays, tags, webhooks, and AI agents.",
    icon: GitBranch,
    bullets: [
      "Visual flow canvas with saved node positions and per-node configuration.",
      "Trigger flows from WhatsApp keywords, campaigns, or manual tests.",
      "Delay and resume support with audit trails for every executed node.",
      "AI Agent node can generate replies and pass output into message nodes.",
    ],
    workflow: ["Trigger", "Decision", "AI/tool node", "Delay", "Outcome"],
  },
  compliance: {
    title: "Compliance Firewall",
    intro:
      "Check outbound WhatsApp messages before they send, with assistive review, strict block rules, and override governance.",
    icon: ShieldCheck,
    bullets: [
      "Heuristic and optional AI-assisted checks for risky wording and restricted claims.",
      "Manual, assisted, and autopilot modes for different tenant risk levels.",
      "Review overrides require permission and a reason; hard blocks stay protected.",
      "Recent checks, verdicts, reasoning, rewrites, and audit logging stay visible.",
    ],
    workflow: ["Draft content", "Check", "Pass/review/block", "Override if allowed", "Audit"],
  },
  integrations: {
    title: "Integrations and Webhooks",
    intro:
      "Connect NexaFlow to your CRM, website, booking stack, and internal tools with signed webhooks and API surfaces.",
    icon: Plug,
    bullets: [
      "Signed outbound webhooks for messages, leads, assignments, appointments, and more.",
      "Provider routing, WhatsApp settings, public booking links, and API key foundations.",
      "Retry logs and delivery status help teams debug integrations without guessing.",
      "Designed for agencies and white-label partners managing many client accounts.",
    ],
    workflow: ["Event", "Signed webhook", "Retry", "CRM update", "Reporting"],
  },
  analytics: {
    title: "Analytics and Monitoring",
    intro:
      "Track performance across campaigns, conversations, providers, wallets, tenants, and customer health signals.",
    icon: BarChart3,
    bullets: [
      "Campaign, contact, conversation, and revenue indicators for business users.",
      "Platform monitor and provider health views for operators.",
      "Wallet risk and customer health signals highlight accounts needing action.",
      "Export-ready data surfaces are prepared for reporting and partner operations.",
    ],
    workflow: ["Collect", "Score", "Segment", "Alert", "Act"],
  },
} as const;

export const fallbackPlans = [
  {
    name: "Starter",
    price: "₹2,999",
    description: "For one business starting with WhatsApp CRM and simple broadcasts.",
    features: [
      "Shared inbox",
      "Contact CRM",
      "Templates and campaigns",
      "Basic analytics",
      "Email support",
    ],
  },
  {
    name: "Growth",
    price: "₹7,999",
    description: "For teams that need AI, automations, and stronger governance.",
    featured: true,
    features: [
      "Everything in Starter",
      "AI Agent Builder",
      "Workflow Builder",
      "Compliance Firewall",
      "Wallet and quota controls",
    ],
  },
  {
    name: "Partner",
    price: "Custom",
    description: "For agencies and white-label operators managing many clients.",
    features: [
      "White-label portal",
      "Client provisioning",
      "Partner wallet",
      "Revenue autopilot",
      "Priority onboarding",
    ],
  },
];

export const proofPoints = [
  { value: "5", label: "Portals planned for launch" },
  { value: "70+", label: "Web routes already built" },
  { value: "24/7", label: "Automation and worker-first architecture" },
  { value: "Tenant-safe", label: "RBAC, feature flags, audit logs" },
];

export const platformSignals = [
  { label: "Inbox SLA", value: "12m", icon: CheckCircle2 },
  { label: "AI agents", value: "Live", icon: Sparkles },
  { label: "Wallet risk", value: "Low", icon: WalletCards },
  { label: "Compliance", value: "Assisted", icon: ShieldCheck },
];
