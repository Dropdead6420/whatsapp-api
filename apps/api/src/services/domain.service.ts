import crypto from "node:crypto";
import dns from "node:dns/promises";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  DomainDnsStatus,
  DomainPortalType,
  DomainSslStatus,
  DomainStatus,
  ErrorCodes,
} from "@nexaflow/shared";

const CNAME_TARGETS: Record<DomainPortalType, string> = {
  [DomainPortalType.PARTNER]: "partner.nexaflow.ai",
  [DomainPortalType.CUSTOMER]: "cname.nexaflow.ai",
  [DomainPortalType.DEMO]: "demo.nexaflow.ai",
  [DomainPortalType.API]: "api.nexaflow.ai",
  [DomainPortalType.TRACKING]: "track.nexaflow.ai",
};

const DOMAIN_RE =
  /^(?=.{1,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");

  if (!DOMAIN_RE.test(cleaned)) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Enter a valid domain such as app.example.com.",
    );
  }
  return cleaned;
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function buildDomainRecords(
  domain: string,
  portalType: DomainPortalType,
  verificationToken = generateVerificationToken(),
) {
  return {
    domain,
    portalType,
    verificationToken,
    cnameHost: domain,
    cnameValue: CNAME_TARGETS[portalType],
    txtHost: `_nexaflow_verify.${domain}`,
    txtValue: `nexaflow-verify=${verificationToken}`,
  };
}

function normalizeDnsValue(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

async function cnameMatches(host: string, expected: string): Promise<boolean> {
  try {
    const records = await dns.resolveCname(host);
    const expectedNormalized = normalizeDnsValue(expected);
    return records.some((record) => normalizeDnsValue(record) === expectedNormalized);
  } catch {
    return false;
  }
}

async function txtMatches(host: string, expected: string): Promise<boolean> {
  try {
    const records = await dns.resolveTxt(host);
    return records
      .map((parts) => parts.join(""))
      .some((record) => record.trim() === expected);
  } catch {
    return false;
  }
}

function deriveStatus({
  cnameOk,
  txtOk,
  sslStatus,
}: {
  cnameOk: boolean;
  txtOk: boolean;
  sslStatus: DomainSslStatus;
}) {
  if (!cnameOk) {
    return {
      dnsStatus: DomainDnsStatus.PENDING,
      status: DomainStatus.PENDING_DNS,
      lastError: "CNAME record was not found yet.",
    };
  }

  if (!txtOk) {
    return {
      dnsStatus: DomainDnsStatus.CNAME_FOUND,
      status: DomainStatus.DNS_FOUND,
      lastError: "CNAME found. TXT ownership record is still missing.",
    };
  }

  if (sslStatus === DomainSslStatus.ACTIVE) {
    return {
      dnsStatus: DomainDnsStatus.TXT_VERIFIED,
      status: DomainStatus.LIVE,
      lastError: null,
    };
  }

  return {
    dnsStatus: DomainDnsStatus.TXT_VERIFIED,
    status: DomainStatus.SSL_PENDING,
    lastError:
      "DNS is verified. SSL provisioning is pending until a domain provider is configured.",
  };
}

export async function checkDomain(domainId: string) {
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  if (!domain) {
    throw new ApiError(ErrorCodes.NOT_FOUND, 404, "Domain not found.");
  }
  if (domain.status === DomainStatus.SUSPENDED) {
    throw new ApiError(
      ErrorCodes.BAD_REQUEST,
      400,
      "Suspended domains cannot be verified until reactivated.",
    );
  }

  const [cnameOk, txtOk] = await Promise.all([
    cnameMatches(domain.cnameHost, domain.cnameValue),
    txtMatches(domain.txtHost, domain.txtValue),
  ]);

  const next = deriveStatus({
    cnameOk,
    txtOk,
    sslStatus: domain.sslStatus as DomainSslStatus,
  });

  return prisma.domain.update({
    where: { id: domainId },
    data: {
      dnsStatus: next.dnsStatus,
      status: next.status,
      lastError: next.lastError,
      lastCheckedAt: new Date(),
    },
  });
}

export function getDomainRecordInstructions(domain: {
  cnameHost: string;
  cnameValue: string;
  txtHost: string;
  txtValue: string;
}) {
  return [
    {
      type: "CNAME",
      host: domain.cnameHost,
      value: domain.cnameValue,
      purpose: "Route this portal to NexaFlow.",
    },
    {
      type: "TXT",
      host: domain.txtHost,
      value: domain.txtValue,
      purpose: "Verify domain ownership.",
    },
  ];
}
