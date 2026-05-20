import crypto from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
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

/**
 * Check if SSL certificate is valid for a domain
 * Returns ACTIVE if certificate exists and is not expired
 */
async function checkSslCertificate(domain: string): Promise<DomainSslStatus> {
  try {
    const agent = new https.Agent({
      rejectUnauthorized: false, // Allow self-signed for the check
    });

    // Create a promise-wrapped HTTPS request
    const cert = await new Promise<any>((resolve, reject) => {
      const req = https.request(
        {
          hostname: domain,
          path: "/",
          method: "HEAD",
          agent,
          timeout: 5000,
        },
        (res) => {
          // res.socket on an HTTPS request is a TLSSocket; the base Socket
          // type doesn't expose getPeerCertificate, so widen at the call.
          const tlsSocket = res.socket as import("node:tls").TLSSocket | undefined;
          const cert = tlsSocket?.getPeerCertificate(false);
          if (!cert) {
            reject(new Error("No certificate found"));
          } else {
            resolve(cert);
          }
        }
      );

      req.on("error", (err) => reject(err));
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("SSL check timeout"));
      });

      req.end();
    });

    // Check certificate validity
    if (!cert || !cert.valid_from || !cert.valid_to) {
      return DomainSslStatus.FAILED;
    }

    const now = new Date();
    const validFrom = new Date(cert.valid_from);
    const validTo = new Date(cert.valid_to);

    // Certificate is valid if current time is within validity range
    if (now >= validFrom && now <= validTo) {
      return DomainSslStatus.ACTIVE;
    }

    return DomainSslStatus.FAILED;
  } catch (error) {
    // SSL check failed - might be pending or certificate doesn't exist yet
    return DomainSslStatus.PENDING;
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

  const [cnameOk, txtOk, sslStatus] = await Promise.all([
    cnameMatches(domain.cnameHost, domain.cnameValue),
    txtMatches(domain.txtHost, domain.txtValue),
    checkSslCertificate(domain.domain),
  ]);

  const next = deriveStatus({
    cnameOk,
    txtOk,
    sslStatus,
  });

  return prisma.domain.update({
    where: { id: domainId },
    data: {
      dnsStatus: next.dnsStatus,
      sslStatus,
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
