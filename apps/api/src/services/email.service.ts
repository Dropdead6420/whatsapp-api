interface EmailPayload {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const FROM = process.env.SMTP_FROM ?? "noreply@nexaflow.ai";
const PROVIDER = (process.env.EMAIL_PROVIDER ?? "console").toLowerCase();
const RESEND_KEY = process.env.RESEND_API_KEY;
const STRICT_DELIVERY = process.env.EMAIL_STRICT_DELIVERY === "true";

async function sendViaResend(payload: EmailPayload): Promise<void> {
  if (!RESEND_KEY) {
    console.warn("[email] RESEND_API_KEY missing; falling back to console");
    return sendViaConsole(payload);
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: FROM,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error("[email] resend failed", res.status, body);
    if (STRICT_DELIVERY) {
      throw new Error(`Resend API error: ${res.status}`);
    }
    console.warn(
      "[email] EMAIL_STRICT_DELIVERY is not enabled; falling back to console delivery",
    );
    return sendViaConsole(payload);
  }
}

function sendViaConsole(payload: EmailPayload): void {
  console.log("\n📧 [email:dev]", {
    from: FROM,
    to: payload.to,
    subject: payload.subject,
  });
  console.log(payload.text);
  console.log("---");
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  if (PROVIDER === "resend") return sendViaResend(payload);
  return sendViaConsole(payload);
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
  };
}
