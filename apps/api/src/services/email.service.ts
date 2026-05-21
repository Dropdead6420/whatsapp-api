import nodemailer, { type Transporter } from "nodemailer";

interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
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

function getFormattedFrom(): string {
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

async function sendViaResend(payload: EmailPayload): Promise<void> {
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
      from: getFormattedFrom(),
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

async function sendViaSmtp(payload: EmailPayload): Promise<void> {
  await getSmtpTransporter().sendMail({
    from: getFormattedFrom(),
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
}

function sendViaConsole(payload: EmailPayload): void {
  console.log("\n📧 [email:dev]", {
    from: getFormattedFrom(),
    to: payload.to,
    subject: payload.subject,
  });
  console.log(payload.text);
  console.log("---");
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const provider = getProvider();
  try {
    if (provider === "resend") return await sendViaResend(payload);
    if (provider === "smtp") return await sendViaSmtp(payload);
    return sendViaConsole(payload);
  } catch (error) {
    console.error(`[email] ${provider} delivery failed`, describeError(error));
    if (isStrictDelivery()) throw error;
    console.warn(
      "[email] EMAIL_STRICT_DELIVERY is not enabled; falling back to console delivery",
    );
    return sendViaConsole(payload);
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
