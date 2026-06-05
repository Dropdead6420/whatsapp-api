import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@nexaflow/db";
import { ApiError, ErrorCodes } from "@nexaflow/shared";
import { encryptToken, decryptToken } from "../lib/tokenCrypto";

// =====================================================================
// Two-Factor Authentication (TOTP, RFC 6238) — Complete Planning PDF §28
// security rule "2FA". Self-implemented with node:crypto (HMAC-SHA1), no
// external dependency. The per-user TOTP secret is stored envelope-
// encrypted (lib/tokenCrypto) in User.twoFactorSecret; User.twoFactorEnabled
// flips true only after the user confirms a valid code.
//
// This slice ships enrollment + verify + disable + status. Login-time
// enforcement and recovery codes wire in as follow-ups.
// =====================================================================

const ISSUER = "NexaFlow";
const PERIOD = 30; // seconds
const DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// ---------------------------------------------------------------------
// Pure TOTP primitives (unit-tested against RFC 6238 vectors)
// ---------------------------------------------------------------------

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226) for a counter; returns a zero-padded DIGITS-length code. */
export function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

/** TOTP (RFC 6238) for a base32 secret at a given unix time (seconds). */
export function totp(
  base32Secret: string,
  timeSec: number = Math.floor(Date.now() / 1000),
): string {
  const counter = Math.floor(timeSec / PERIOD);
  return hotp(base32Decode(base32Secret), counter);
}

/** Verify a token within ±window steps to tolerate clock drift. */
export function verifyTotp(
  base32Secret: string,
  token: string,
  timeSec: number = Math.floor(Date.now() / 1000),
  window = 1,
): boolean {
  const candidate = (token ?? "").trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  const secret = base32Decode(base32Secret);
  const counter = Math.floor(timeSec / PERIOD);
  for (let drift = -window; drift <= window; drift++) {
    const expected = hotp(secret, counter + drift);
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Random base32 TOTP secret (default 20 bytes = 160 bits, per RFC). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function buildOtpauthUrl(
  base32Secret: string,
  accountLabel: string,
  issuer = ISSUER,
): string {
  // Encode issuer + account separately, keeping the ":" separator literal
  // (the conventional otpauth label format authenticator apps expect).
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountLabel)}`;
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// DB-backed enrollment lifecycle (per authenticated user)
// ---------------------------------------------------------------------

export interface TwoFactorStatus {
  enabled: boolean;
  pending: boolean;
}

export async function getStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
  return {
    enabled: user.twoFactorEnabled,
    pending: !user.twoFactorEnabled && Boolean(user.twoFactorSecret),
  };
}

export interface EnrollmentChallenge {
  secret: string;
  otpauthUrl: string;
}

/**
 * Begin enrollment: generate a fresh secret, store it encrypted (not yet
 * enabled), and return the secret + otpauth URL for the authenticator app.
 * Shown once; the client must confirm with a valid code to enable.
 */
export async function beginEnrollment(userId: string): Promise<EnrollmentChallenge> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, twoFactorEnabled: true },
  });
  if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
  if (user.twoFactorEnabled) {
    throw new ApiError(
      ErrorCodes.CONFLICT,
      409,
      "Two-factor authentication is already enabled. Disable it first to re-enroll.",
    );
  }
  const secret = generateSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecret: encryptToken(secret) },
  });
  return { secret, otpauthUrl: buildOtpauthUrl(secret, user.email) };
}

/** Confirm enrollment by verifying a code against the pending secret. */
export async function confirmEnrollment(
  userId: string,
  token: string,
): Promise<TwoFactorStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });
  if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
  if (user.twoFactorEnabled) {
    return { enabled: true, pending: false };
  }
  if (!user.twoFactorSecret) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Start enrollment before confirming.",
    );
  }
  const secret = decryptToken(user.twoFactorSecret);
  if (!verifyTotp(secret, token)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid verification code.");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: true },
  });
  return { enabled: true, pending: false };
}

/** Disable 2FA after verifying a current code; clears the secret. */
export async function disable(
  userId: string,
  token: string,
): Promise<TwoFactorStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true, twoFactorEnabled: true },
  });
  if (!user) throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
  if (!user.twoFactorEnabled || !user.twoFactorSecret) {
    return { enabled: false, pending: false };
  }
  const secret = decryptToken(user.twoFactorSecret);
  if (!verifyTotp(secret, token)) {
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, "Invalid verification code.");
  }
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorEnabled: false, twoFactorSecret: null },
  });
  return { enabled: false, pending: false };
}

/**
 * Verify a token for a user who has 2FA enabled. Used by login-time
 * enforcement (wired in a follow-up). Returns true when the user has no
 * 2FA (nothing to check) or the code is valid.
 */
export async function verifyUserToken(
  userId: string,
  token: string,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) return true;
  return verifyTotp(decryptToken(user.twoFactorSecret), token);
}
