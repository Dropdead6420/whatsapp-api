import nodemailer, { type Transporter } from "nodemailer";

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /**
   * T-041: optional tenant id. When set AND the tenant has a
   * verified custom email domain (within the 30-day TTL), the FROM
   * header is overridden to use the tenant's address. Otherwise the
   * platform-default sender is used.
   */
  tenantId?: string;
}

let smtpTransporter: Transporter | null = null;

function getProvider(): string {
  return (process.env.EMAIL_PROVIDER ?? (process.env.SMTP_HOST ? "smtp" : "console"))
    .toLowerCase()
    .trim();
}

function isStrictDelivery(): boolean {
  return process.env.EMAIL_STRICT_DELIVERY === "true";
}

function getFromAddress(): string {
  return (
    process.env.SMTP_FROM ??
    process.env.EMAIL_FROM ??
    process.env.EMAIL_FROM_ADDRESS ??
    process.env.SMTP_USER ??
    "noreply@nexaflow.ai"
  );
}

function getFormattedFrom(
  override?: { address: string; name: string | null } | null,
): string {
  if (override?.address) {
    const name = override.name ?? process.env.EMAIL_FROM_NAME ?? "NexaFlow AI";
    return `${name} <${override.address}>`;
  }
  const from = getFromAddress();
  if (from.includes("<")) return from;
  const name = process.env.EMAIL_FROM_NAME ?? "NexaFlow AI";
  return `${name} <${from}>`;
}

function getSmtpTransporter(): Transporter {
  if (smtpTransporter) return smtpTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD ?? process.env.SMTP_PASS;
  const secure =
    process.env.SMTP_SECURE === "true" ||
    (process.env.SMTP_SECURE !== "false" && port === 465);

  if (!host || !user || !pass) {
    throw new Error("SMTP_HOST, SMTP_USER, and SMTP_PASSWORD are required for SMTP email");
  }

  smtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return smtpTransporter;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

type EnrichedPayload = EmailPayload & {
  overrideFrom?: { address: string; name: string | null };
};

async function sendViaResend(payload: EnrichedPayload): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("[email] RESEND_API_KEY missing; falling back to console");
    return sendViaConsole(payload);
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from: getFormattedFrom(payload.overrideFrom),
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("[email] resend failed", res.status, body);
    if (isStrictDelivery()) {
      throw new Error(`Resend API error: ${res.status}`);
    }
    console.warn(
      "[email] EMAIL_STRICT_DELIVERY is not enabled; falling back to console delivery",
    );
    return sendViaConsole(payload);
  }
}

async function sendViaSmtp(payload: EnrichedPayload): Promise<void> {
  await getSmtpTransporter().sendMail({
    from: getFormattedFrom(payload.overrideFrom),
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

function sendViaConsole(payload: EnrichedPayload): void {
  console.log("\n📧 [email:dev]", {
    from: getFormattedFrom(payload.overrideFrom),
    to: payload.to,
    subject: payload.subject,
  });
  console.log(payload.text);
  console.log("---");
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  // T-041: tenant custom-from override. Resolve once + stash on
  // payload so the per-provider implementations can read it. We
  // lazy-import emailDomain.service to avoid the circular dep
  // (emailDomain reads tenants, which sometimes need to email).
  const enriched: EmailPayload & {
    overrideFrom?: { address: string; name: string | null };
  } = { ...payload };
  if (payload.tenantId) {
    try {
      const { getVerifiedTenantSender } = await import("./emailDomain.service");
      const sender = await getVerifiedTenantSender(payload.tenantId);
      if (sender) enriched.overrideFrom = sender;
    } catch (err) {
      console.warn(
        "[email] tenant sender lookup failed; using platform default:",
        describeError(err),
      );
    }
  }

  const provider = getProvider();
  try {
    if (provider === "resend") return await sendViaResend(enriched);
    if (provider === "smtp") return await sendViaSmtp(enriched);
    return sendViaConsole(enriched);
  } catch (error) {
    console.error(`[email] ${provider} delivery failed`, describeError(error));
    if (isStrictDelivery()) throw error;
    console.warn(
      "[email] EMAIL_STRICT_DELIVERY is not enabled; falling back to console delivery",
    );
    return sendViaConsole(enriched);
  }
}

export async function verifyEmailTransport(): Promise<{
  ok: boolean;
  provider: string;
  message: string;
}> {
  const provider = getProvider();
  if (provider === "smtp") {
    await getSmtpTransporter().verify();
    return { ok: true, provider, message: "SMTP transport is ready" };
  }
  if (provider === "resend" && !process.env.RESEND_API_KEY) {
    return { ok: false, provider, message: "RESEND_API_KEY is not configured" };
  }
  return { ok: true, provider, message: "Console email transport is ready" };
}

export function buildPasswordResetEmail(
  to: string,
  resetUrl: string,
): EmailPayload {
  return {
    to,
    subject: "Reset your NexaFlow password",
    text: `We received a request to reset your NexaFlow password.\n\nReset link (expires in 30 minutes):\n${resetUrl}\n\nIf you didn't request this, ignore this email.`,
  };
}

export function buildVerifyEmailEmail(
  to: string,
  verifyUrl: string,
): EmailPayload {
  return {
    to,
    subject: "Verify your NexaFlow email",
    text: `Welcome to NexaFlow! Confirm your email to activate your account.\n\nVerify link (expires in 24 hours):\n${verifyUrl}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
        <h2>Verify your NexaFlow email</h2>
        <p>Welcome to NexaFlow! Confirm your email to activate your account.</p>
        <p><a href="${verifyUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 18px;border-radius:6px;text-decoration:none">Verify email</a></p>
        <p style="color:#6b7280;font-size:14px">This link expires in 24 hours.</p>
      </div>
    `,
  };
}

// ---------------------------------------------------------------------------
// Operational notification emails. All builders below take the recipient
// + the structured data, return an EmailPayload. The caller decides
// when to fire — usually a service or worker that detected the event.
// ---------------------------------------------------------------------------

const APP_URL = process.env.WEB_URL ?? "https://medscrub.in";

function fmtCredits(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Welcome email — fires AFTER email is verified, so the link in this
 * one goes to the login / onboarding page, not back to verification.
 */
export function buildWelcomeEmail(opts: {
  to: string;
  recipientName: string;
  tenantName: string;
}): EmailPayload {
  const { to, recipientName, tenantName } = opts;
  return {
    to,
    subject: "Welcome to NexaFlow AI 👋",
    text: `Hi ${recipientName},\n\nYour ${tenantName} workspace is live. Get started in three minutes:\n\n1. Connect WhatsApp Business: ${APP_URL}/whatsapp-settings\n2. Import contacts:           ${APP_URL}/contacts\n3. Create your first agent:   ${APP_URL}/ai-agents\n\nTrack your setup at ${APP_URL}/onboarding.\n\n— The NexaFlow team`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px">
        <h2 style="margin:0 0 8px">Welcome, ${recipientName} 👋</h2>
        <p>Your <strong>${tenantName}</strong> workspace is live. Three steps to your first automated conversation:</p>
        <ol style="padding-left:20px">
          <li style="margin-bottom:6px"><a href="${APP_URL}/whatsapp-settings" style="color:#059669">Connect WhatsApp Business</a></li>
          <li style="margin-bottom:6px"><a href="${APP_URL}/contacts" style="color:#059669">Import your contacts</a></li>
          <li><a href="${APP_URL}/ai-agents" style="color:#059669">Create your first AI agent</a></li>
        </ol>
        <p style="margin-top:24px"><a href="${APP_URL}/onboarding" style="display:inline-block;background:#059669;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Open setup checklist</a></p>
        <p style="color:#6b7280;font-size:14px;margin-top:24px">Reply to this email if you need help — a human reads every reply.</p>
      </div>
    `,
  };
}

/**
 * Low-balance alert — fires when Wallet.balanceCredits drops below
 * Wallet.lowBalanceThreshold. Sent at most once per 24 hours per wallet
 * (the caller is responsible for the de-dupe; we don't want this code
 * coupled to a "last alert sent at" column).
 */
export function buildLowBalanceEmail(opts: {
  to: string;
  recipientName: string;
  tenantName: string;
  balanceCredits: number;
  threshold: number;
  isEmpty: boolean;
}): EmailPayload {
  const { to, recipientName, tenantName, balanceCredits, threshold, isEmpty } =
    opts;
  const urgency = isEmpty
    ? "Sending is blocked until you recharge"
    : `You'll hit zero soon at the current send rate`;
  return {
    to,
    subject: isEmpty
      ? `[Action needed] ${tenantName} wallet is empty`
      : `[Heads up] ${tenantName} wallet is low`,
    text: `Hi ${recipientName},\n\n${tenantName} wallet balance is ${fmtCredits(balanceCredits)} credits (threshold ${fmtCredits(threshold)}).\n\n${urgency}.\n\nRecharge: ${APP_URL}/wallets\n\n— NexaFlow`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px">
        <h2 style="margin:0 0 8px;color:${isEmpty ? "#b91c1c" : "#b45309"}">
          ${isEmpty ? "Wallet is empty" : "Wallet running low"}
        </h2>
        <p>Hi ${recipientName},</p>
        <p>
          <strong>${tenantName}</strong> balance:
          <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${fmtCredits(balanceCredits)} credits</code>
          (threshold ${fmtCredits(threshold)}).
        </p>
        <p>${urgency}.</p>
        <p><a href="${APP_URL}/wallets" style="display:inline-block;background:#b45309;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Recharge wallet</a></p>
      </div>
    `,
  };
}

/**
 * Agent-disabled notification — fires when an AI agent that was
 * answering inbound DMs gets disabled (either by an operator or by
 * the platform after persistent LLM failures). Lets a sleeping admin
 * know inbound traffic might be unattended.
 */
export function buildAgentDisabledEmail(opts: {
  to: string;
  recipientName: string;
  tenantName: string;
  agentName: string;
  reason: string;
}): EmailPayload {
  const { to, recipientName, tenantName, agentName, reason } = opts;
  return {
    to,
    subject: `[${tenantName}] AI agent "${agentName}" is disabled`,
    text: `Hi ${recipientName},\n\nThe AI agent "${agentName}" is no longer answering inbound conversations.\n\nReason: ${reason}\n\nReview + re-enable: ${APP_URL}/ai-agents\n\n— NexaFlow`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827;max-width:560px">
        <h2 style="margin:0 0 8px;color:#b45309">AI agent disabled</h2>
        <p>Hi ${recipientName},</p>
        <p>The AI agent <strong>${agentName}</strong> in <strong>${tenantName}</strong> is no longer answering inbound conversations.</p>
        <p><strong>Reason:</strong> ${reason}</p>
        <p>Customers messaging you will get the fallback behavior configured on the agent (escalate to human / send template / silent).</p>
        <p><a href="${APP_URL}/ai-agents" style="display:inline-block;background:#b45309;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">Review agents</a></p>
      </div>
    `,
  };
}
