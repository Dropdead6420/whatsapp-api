import { resolveTxt } from "node:dns/promises";
import { prisma } from "@nexaflow/db";

// T-041: tenant custom email sender — DNS verification.
//
// To send "FROM medscrub@medscrub.in" we need the domain owner to add:
//   - SPF: a TXT record at the apex that authorizes our sending IPs
//   - DKIM: a TXT record at the provider-specified selector
//     (typically `resend._domainkey.medscrub.in` for Resend)
//   - DMARC: optional but recommended — `_dmarc.medscrub.in`
//
// We verify by resolving the TXT records and checking for the
// expected signatures. We DON'T verify the cryptographic content —
// the email provider does that on every send. We just confirm the
// records EXIST so the operator hasn't typo'd anything.
//
// Re-verification: emails check `emailDomainVerifiedAt` is within 30
// days. After that we fall back to the platform sender until the
// operator re-verifies. Catches silent DNS regressions (SPF
// truncated, DKIM key rotated, etc.).

const VERIFICATION_TTL_DAYS = 30;
const VERIFICATION_TTL_MS = VERIFICATION_TTL_DAYS * 24 * 60 * 60 * 1000;

export interface EmailDomainCheckResult {
  domain: string;
  spfPresent: boolean;
  dkimPresent: boolean;
  dmarcPresent: boolean;
  /** Some platform-required string SHOULD appear in the SPF — for Resend it's "include:_spf.resend.com". */
  includeSeen: string[];
  /** True if all required records exist. */
  verified: boolean;
  errors: string[];
}

const DEFAULT_PROVIDER_INCLUDES: Record<string, string> = {
  // Hard-coded for the providers we support today.
  resend: "include:_spf.resend.com",
  // SendGrid uses `include:sendgrid.net`
  sendgrid: "include:sendgrid.net",
  // Mailgun uses `include:mailgun.org`
  mailgun: "include:mailgun.org",
};

function getProviderIncludeForCurrentEmail(): string | null {
  const provider = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  return DEFAULT_PROVIDER_INCLUDES[provider] ?? null;
}

function safeTxtLookup(name: string): Promise<string[][]> {
  // resolveTxt returns string[][] (each TXT record is a list of
  // string chunks Postel-style). We collapse to one string per record
  // at the caller.
  return resolveTxt(name).catch(() => []);
}

/**
 * Check the DNS records for an email-from domain. Pure read; doesn't
 * mutate any tenant state. Returns the structured result for the
 * caller to display + persist.
 */
export async function checkEmailDomain(
  domain: string,
  providerInclude: string | null = getProviderIncludeForCurrentEmail(),
): Promise<EmailDomainCheckResult> {
  const result: EmailDomainCheckResult = {
    domain,
    spfPresent: false,
    dkimPresent: false,
    dmarcPresent: false,
    includeSeen: [],
    verified: false,
    errors: [],
  };

  // Defensive: refuse bare-IP / localhost / private domains.
  if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
    result.errors.push(
      `"${domain}" doesn't look like a valid public DNS hostname.`,
    );
    return result;
  }

  // SPF at apex
  const spfRecords = await safeTxtLookup(domain);
  for (const record of spfRecords) {
    const flat = record.join("");
    if (flat.startsWith("v=spf1")) {
      result.spfPresent = true;
      // Collect every `include:` declaration so the UI can show
      // operator what was found.
      const includes = flat
        .split(/\s+/)
        .filter((part) => part.startsWith("include:"));
      result.includeSeen.push(...includes);
      if (providerInclude && !flat.includes(providerInclude)) {
        result.errors.push(
          `SPF record exists but doesn't include "${providerInclude}". Add it.`,
        );
      }
    }
  }
  if (!result.spfPresent) {
    result.errors.push(
      `No SPF record found at ${domain}. Add a TXT record with "v=spf1 ${providerInclude ?? "include:_spf.example.com"} ~all".`,
    );
  }

  // DKIM — the selector varies by provider. We probe the common ones
  // since the operator might use different providers across tenants.
  const dkimSelectors = ["resend._domainkey", "s1._domainkey", "google._domainkey"];
  for (const selector of dkimSelectors) {
    const lookup = await safeTxtLookup(`${selector}.${domain}`);
    if (lookup.length > 0 && lookup.some((r) => r.join("").includes("v=DKIM1"))) {
      result.dkimPresent = true;
      break;
    }
  }
  if (!result.dkimPresent) {
    result.errors.push(
      `No DKIM record found under ${domain}. For Resend, add the resend._domainkey TXT record from the Resend dashboard.`,
    );
  }

  // DMARC — at `_dmarc.<domain>`. Recommended, not required for verify.
  const dmarc = await safeTxtLookup(`_dmarc.${domain}`);
  if (dmarc.some((r) => r.join("").startsWith("v=DMARC1"))) {
    result.dmarcPresent = true;
  }
  // No error if DMARC is absent; it's a strong-recommend, not required.

  // "Verified" requires SPF + DKIM. DMARC is informational.
  result.verified = result.spfPresent && result.dkimPresent && result.errors.length === 0;
  return result;
}

/**
 * Verify a tenant's emailFromAddress domain and persist the result.
 * On success, stamps emailDomainVerifiedAt; on failure, records the
 * last error so the operator UI can display it.
 */
export async function verifyAndPersistEmailDomain(
  tenantId: string,
): Promise<EmailDomainCheckResult> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { emailFromAddress: true },
  });
  if (!tenant?.emailFromAddress) {
    return {
      domain: "",
      spfPresent: false,
      dkimPresent: false,
      dmarcPresent: false,
      includeSeen: [],
      verified: false,
      errors: ["Tenant has no emailFromAddress configured."],
    };
  }
  // Extract the domain portion. Email parsing without a library — we
  // just split on `@` and refuse anything that doesn't have exactly one.
  const parts = tenant.emailFromAddress.trim().split("@");
  if (parts.length !== 2 || !parts[1]) {
    const err = "emailFromAddress is not a valid email (missing '@').";
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        emailDomainLastError: err,
        emailDomainVerifiedAt: null,
      },
    });
    return {
      domain: tenant.emailFromAddress,
      spfPresent: false,
      dkimPresent: false,
      dmarcPresent: false,
      includeSeen: [],
      verified: false,
      errors: [err],
    };
  }

  const check = await checkEmailDomain(parts[1]);
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      emailDomainVerifiedAt: check.verified ? new Date() : null,
      emailDomainLastError: check.verified ? null : check.errors.join(" "),
    },
  });
  return check;
}

/**
 * Read the tenant's verified custom sender — or null if the tenant
 * doesn't have one set, OR the verification is stale (>30d old), OR
 * was never successful.
 *
 * Email senders call this to decide whether to override the platform
 * default. The 30d staleness check is what makes silent DNS
 * regressions visible.
 */
export async function getVerifiedTenantSender(
  tenantId: string,
): Promise<{ address: string; name: string | null } | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      emailFromAddress: true,
      emailFromName: true,
      emailDomainVerifiedAt: true,
    },
  });
  if (!t?.emailFromAddress) return null;
  if (!t.emailDomainVerifiedAt) return null;
  const ageMs = Date.now() - t.emailDomainVerifiedAt.getTime();
  if (ageMs > VERIFICATION_TTL_MS) return null;
  return { address: t.emailFromAddress, name: t.emailFromName };
}

export const __test__ = {
  VERIFICATION_TTL_DAYS,
  DEFAULT_PROVIDER_INCLUDES,
};
