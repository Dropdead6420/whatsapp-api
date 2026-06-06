import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { prisma } from "@nexaflow/db";
import {
  ApiError,
  ErrorCodes,
  UserRole,
  UserStatus,
  TenantType,
  TenantStatus,
  AuthTokens,
  AuthUserPublic,
  PlanName,
  SubscriptionStatus,
} from "@nexaflow/shared";
import { authService } from "../services/auth.service";
import {
  storeRefreshToken,
  isRefreshTokenActive,
  isRefreshTokenBlacklisted,
  revokeRefreshToken,
  invalidateAuthContext,
  clearLoginFails,
  getLoginFailCount,
  getLoginThrottleConfig,
  recordLoginFail,
} from "../lib/redis";
import { logAudit, extractRequestMeta } from "../services/audit.service";
import {
  sendEmail,
  buildPasswordResetEmail,
  buildVerifyEmailEmail,
  buildWelcomeEmail,
} from "../services/email.service";
import { requireAuth, RequestWithAuth } from "../middleware/auth";

const router = Router();

const WEB_URL = process.env.WEB_URL ?? "http://localhost:3000";

// ----------------------------------------------------------------------------
// Validation schemas
// ----------------------------------------------------------------------------

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const signupSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(120),
  companyName: z.string().min(1, "Company name is required").max(120),
  selectedPlanName: z.string().trim().min(1).max(80).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

const requestResetSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8),
});

const verifyEmailSchema = z.object({
  token: z.string().min(1),
});

const resendVerificationSchema = z.object({
  email: z.string().email("Invalid email address"),
});

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function toPublicUser(u: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  tenantId: string | null;
  emailVerified: Date | null;
}): AuthUserPublic {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    status: u.status as UserStatus,
    tenantId: u.tenantId,
    emailVerified: u.emailVerified !== null,
  };
}

async function issueTokens(
  userId: string,
  role: UserRole,
  tenantId: string | null,
): Promise<AuthTokens> {
  const accessToken = authService.generateAccessToken(
    userId,
    role,
    tenantId ?? undefined,
  );
  const { token: refreshToken, jti } = authService.generateRefreshToken(userId);
  await storeRefreshToken(jti, userId, authService.refreshTokenTtl);
  return {
    accessToken,
    refreshToken,
    expiresIn: authService.accessTokenTtl,
  };
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const detail = result.error.errors
      .map((e) => `${e.path.join(".") || "body"}: ${e.message}`)
      .join(", ");
    throw new ApiError(ErrorCodes.BAD_REQUEST, 400, `Validation failed: ${detail}`);
  }
  return result.data;
}

async function sendFreshVerificationEmail(user: {
  id: string;
  email: string;
  tenantId: string | null;
}): Promise<void> {
  const { raw, hash } = authService.generateUrlSafeToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const verifyUrl = `${WEB_URL}/verify-email?token=${raw}`;
  await sendEmail(buildVerifyEmailEmail(user.email, verifyUrl));
}

function planPeriodEnd(start: Date, billingCycle: string): Date {
  const end = new Date(start);
  if (billingCycle.toLowerCase().includes("annual")) {
    end.setFullYear(end.getFullYear() + 1);
    return end;
  }
  end.setMonth(end.getMonth() + 1);
  return end;
}

function normalizeRequestedPlanName(value: string | undefined): PlanName | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return Object.values(PlanName).includes(normalized as PlanName)
    ? (normalized as PlanName)
    : null;
}

// ----------------------------------------------------------------------------
// POST /api/v1/auth/signup
// Creates a new tenant + business admin user, sends verification email.
// ----------------------------------------------------------------------------

router.post("/signup", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password, name, companyName, selectedPlanName } = parseBody(
      signupSchema,
      req.body,
    );

    const existing = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });
    if (existing) {
      if (
        existing.status === UserStatus.PENDING_EMAIL_VERIFICATION &&
        existing.tenantId
      ) {
        await sendFreshVerificationEmail(existing);
        res.status(200).json({
          success: true,
          data: {
            user: toPublicUser(existing),
            message:
              "Account already exists but is not verified. We sent a fresh verification link.",
          },
        });
        return;
      }
      throw new ApiError(
        ErrorCodes.CONFLICT,
        409,
        "An account with this email already exists.",
      );
    }

    const passwordHash = await authService.hashPassword(password);

    const { tenant, user, selectedPlan, subscription } = await prisma.$transaction(async (tx) => {
      const requestedPlanEnum = normalizeRequestedPlanName(selectedPlanName);
      const selectedPlan = selectedPlanName
        ? await tx.plan.findFirst({
            where: {
              OR: [
                { id: selectedPlanName },
                ...(requestedPlanEnum ? [{ name: requestedPlanEnum }] : []),
                {
                  displayName: {
                    equals: selectedPlanName,
                    mode: "insensitive",
                  },
                },
              ],
            },
          })
        : null;

      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          type: TenantType.DIRECT,
          status: TenantStatus.ACTIVE,
          ...(selectedPlan
            ? {
                contactLimit: selectedPlan.contactLimit,
                agentLimit: selectedPlan.agentLimit,
                aiCreditsPerMonth: selectedPlan.aiCreditsPerMonth,
                campaignLimit: selectedPlan.campaignLimit,
              }
            : {}),
        },
      });
      const user = await tx.user.create({
        data: {
          email: email.toLowerCase(),
          name,
          password: passwordHash,
          role: UserRole.BUSINESS_ADMIN,
          status: UserStatus.PENDING_EMAIL_VERIFICATION,
          tenantId: tenant.id,
        },
      });
      const subscriptionStart = new Date();
      const subscription = selectedPlan
        ? await tx.subscription.create({
            data: {
              tenantId: tenant.id,
              planId: selectedPlan.id,
              status: SubscriptionStatus.ACTIVE,
              currentPeriodStart: subscriptionStart,
              currentPeriodEnd: planPeriodEnd(
                subscriptionStart,
                selectedPlan.billingCycle,
              ),
            },
          })
        : null;
      return { tenant, user, selectedPlan, subscription };
    });

    await sendFreshVerificationEmail(user);

    const meta = extractRequestMeta(req);
    await logAudit({
      tenantId: tenant.id,
      userId: user.id,
      action: "SIGNUP",
      resource: "User",
      resourceId: user.id,
      newValues: {
        email: user.email,
        role: user.role,
        requestedPlan: selectedPlanName ?? null,
        selectedPlan: selectedPlan
          ? {
              id: selectedPlan.id,
              name: selectedPlan.name,
              displayName: selectedPlan.displayName,
            }
          : null,
        subscriptionId: subscription?.id ?? null,
      },
      ...meta,
    });

    res.status(201).json({
      success: true,
      data: {
        user: toPublicUser(user),
        selectedPlan: selectedPlan
          ? {
              id: selectedPlan.id,
              name: selectedPlan.name,
              displayName: selectedPlan.displayName,
            }
          : null,
        message:
          selectedPlan
            ? `Account created on the ${selectedPlan.displayName} plan. Check your email to verify your address before logging in.`
            : "Account created. Check your email to verify your address before logging in.",
      },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// POST /api/v1/auth/resend-verification
// Sends a fresh verification email for pending accounts.
// ----------------------------------------------------------------------------

router.post(
  "/resend-verification",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = parseBody(resendVerificationSchema, req.body);
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase() },
      });

      if (user?.status === UserStatus.PENDING_EMAIL_VERIFICATION) {
        await sendFreshVerificationEmail(user);
        if (user.tenantId) {
          await logAudit({
            tenantId: user.tenantId,
            userId: user.id,
            action: "EMAIL_VERIFICATION_RESENT",
            resource: "User",
            resourceId: user.id,
            ...extractRequestMeta(req),
          });
        }
      }

      res.json({
        success: true,
        data: {
          message:
            "If the account is waiting for verification, a fresh email has been sent.",
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// POST /api/v1/auth/login
// ----------------------------------------------------------------------------

router.post("/login", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, password } = parseBody(loginSchema, req.body);
    const meta = extractRequestMeta(req);

    // Per-account throttle (T-091). Pre-check before the bcrypt call so we
    // refuse to burn CPU on a locked-out address.
    const throttleCfg = getLoginThrottleConfig();
    const existingFails = await getLoginFailCount(email);
    if (existingFails >= throttleCfg.max) {
      throw new ApiError(
        ErrorCodes.TOO_MANY_REQUESTS,
        429,
        `Too many failed login attempts. Try again in ${Math.ceil(throttleCfg.windowSeconds / 60)} minutes.`,
      );
    }

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });

    const invalidCredentials = new ApiError(
      ErrorCodes.INVALID_CREDENTIALS,
      401,
      "Invalid email or password.",
    );

    if (!user) {
      // Record the fail even when the account doesn't exist — otherwise
      // attackers can enumerate addresses for free.
      await recordLoginFail(email);
      throw invalidCredentials;
    }

    const passwordOk = await authService.comparePassword(password, user.password);
    if (!passwordOk) {
      const failResult = await recordLoginFail(email);
      if (user.tenantId) {
        await logAudit({
          tenantId: user.tenantId,
          userId: user.id,
          action: failResult.thresholdHit ? "LOGIN_THROTTLED" : "LOGIN_FAILED",
          resource: "User",
          resourceId: user.id,
          ...meta,
        });
      }
      throw invalidCredentials;
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new ApiError(
        ErrorCodes.FORBIDDEN,
        403,
        "This account is suspended. Contact support.",
      );
    }
    if (user.status === UserStatus.DELETED) {
      throw invalidCredentials;
    }
    if (user.status === UserStatus.PENDING_EMAIL_VERIFICATION) {
      throw new ApiError(
        ErrorCodes.EMAIL_NOT_VERIFIED,
        403,
        "Please verify your email before logging in.",
      );
    }

    const tokens = await issueTokens(
      user.id,
      user.role as UserRole,
      user.tenantId,
    );

    // Successful login — clear the throttle counter so the next typo
    // doesn't start halfway to lockout.
    await clearLoginFails(email);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    if (user.tenantId) {
      await logAudit({
        tenantId: user.tenantId,
        userId: user.id,
        action: "LOGIN",
        resource: "User",
        resourceId: user.id,
        ...meta,
      });
    }

    res.json({
      success: true,
      data: { ...tokens, user: toPublicUser(user) },
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ----------------------------------------------------------------------------

router.post("/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = parseBody(refreshSchema, req.body);
    const payload = authService.verifyRefreshToken(refreshToken);

    if (await isRefreshTokenBlacklisted(payload.jti)) {
      throw new ApiError(ErrorCodes.TOKEN_REVOKED, 401, "Refresh token has been revoked.");
    }
    if (!(await isRefreshTokenActive(payload.jti))) {
      throw new ApiError(ErrorCodes.TOKEN_REVOKED, 401, "Refresh token is no longer active.");
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new ApiError(ErrorCodes.UNAUTHORIZED, 401, "User no longer active.");
    }

    await revokeRefreshToken(payload.jti);
    const tokens = await issueTokens(user.id, user.role as UserRole, user.tenantId);

    res.json({ success: true, data: tokens });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ----------------------------------------------------------------------------

router.post("/logout", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = (req.body as { refreshToken?: string })?.refreshToken;
    if (refreshToken) {
      try {
        const payload = authService.verifyRefreshToken(refreshToken);
        await revokeRefreshToken(payload.jti);
        // Drop the cached auth context so a stolen access token can't keep
        // riding the cache TTL after logout.
        await invalidateAuthContext(payload.userId);
      } catch {
        // already invalid — silently succeed
      }
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
// POST /api/v1/auth/request-password-reset
// ----------------------------------------------------------------------------

router.post(
  "/request-password-reset",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = parseBody(requestResetSchema, req.body);
      const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase() },
      });

      if (user) {
        const { raw, hash } = authService.generateUrlSafeToken();
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tenantId: user.tenantId,
            tokenHash: hash,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
        const resetUrl = `${WEB_URL}/reset-password?token=${raw}`;
        await sendEmail(buildPasswordResetEmail(user.email, resetUrl));
        if (user.tenantId) {
          await logAudit({
            tenantId: user.tenantId,
            userId: user.id,
            action: "PASSWORD_RESET_REQUEST",
            resource: "User",
            resourceId: user.id,
            ...extractRequestMeta(req),
          });
        }
      }

      // Always succeed — never reveal whether email exists
      res.json({
        success: true,
        data: { message: "If an account exists, a reset link has been sent." },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// POST /api/v1/auth/reset-password
// ----------------------------------------------------------------------------

router.post(
  "/reset-password",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, newPassword } = parseBody(resetSchema, req.body);
      const hash = authService.hashOpaqueToken(token);

      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hash },
      });

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new ApiError(
          ErrorCodes.UNAUTHORIZED,
          401,
          "Reset link is invalid or expired.",
        );
      }

      const passwordHash = await authService.hashPassword(newPassword);
      await prisma.$transaction([
        prisma.user.update({
          where: { id: record.userId },
          data: { password: passwordHash },
        }),
        prisma.passwordResetToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);

      // Drop cached auth context so the next request re-validates.
      await invalidateAuthContext(record.userId);

      if (record.tenantId) {
        await logAudit({
          tenantId: record.tenantId,
          userId: record.userId,
          action: "PASSWORD_RESET_COMPLETE",
          resource: "User",
          resourceId: record.userId,
          ...extractRequestMeta(req),
        });
      }

      res.json({ success: true, data: { message: "Password updated. You can now log in." } });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// POST /api/v1/auth/verify-email
// ----------------------------------------------------------------------------

router.post(
  "/verify-email",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token } = parseBody(verifyEmailSchema, req.body);
      const hash = authService.hashOpaqueToken(token);

      const record = await prisma.emailVerificationToken.findUnique({
        where: { tokenHash: hash },
      });

      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new ApiError(
          ErrorCodes.UNAUTHORIZED,
          401,
          "Verification link is invalid or expired.",
        );
      }

      await prisma.$transaction([
        prisma.user.update({
          where: { id: record.userId },
          data: {
            emailVerified: new Date(),
            status: UserStatus.ACTIVE,
          },
        }),
        prisma.emailVerificationToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        }),
      ]);

      if (record.tenantId) {
        await logAudit({
          tenantId: record.tenantId,
          userId: record.userId,
          action: "EMAIL_VERIFIED",
          resource: "User",
          resourceId: record.userId,
          ...extractRequestMeta(req),
        });
      }

      // Welcome email — fire-and-forget so a transient SMTP hiccup
      // doesn't block the operator from logging in. Failed sends are
      // logged by sendEmail itself.
      void (async () => {
        try {
          const user = await prisma.user.findUnique({
            where: { id: record.userId },
            select: {
              email: true,
              name: true,
              tenant: { select: { name: true } },
            },
          });
          if (user?.tenant) {
            await sendEmail(
              buildWelcomeEmail({
                to: user.email,
                recipientName: user.name?.split(" ")[0] || "there",
                tenantName: user.tenant.name,
              }),
            );
          }
        } catch (err) {
          console.warn("[auth] welcome email failed (non-fatal):", err);
        }
      })();

      res.json({ success: true, data: { message: "Email verified. You can now log in." } });
    } catch (err) {
      next(err);
    }
  },
);

// ----------------------------------------------------------------------------
// GET /api/v1/auth/me — current user
// ----------------------------------------------------------------------------

router.get(
  "/me",
  requireAuth,
  async (req: RequestWithAuth, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.userId! },
      });
      if (!user) {
        throw new ApiError(ErrorCodes.NOT_FOUND, 404, "User not found.");
      }
      // Resolve features lazily so /me stays light for SUPER_ADMIN (no tenant).
      let features: Record<string, boolean> | undefined;
      let products: Record<string, boolean> | undefined;
      let productAccess:
        | Array<{
            key: string;
            name: string;
            category: string;
            routeHref: string | null;
            featureKey: string | null;
            enabled: boolean;
            limits: unknown | null;
          }>
        | undefined;
      if (user.tenantId) {
        const { getTenantFeatures } = await import(
          "../services/features.service"
        );
        const { listTenantProductAccess } = await import(
          "../services/productAccess.service"
        );
        const [resolvedFeatures, resolvedProducts] = await Promise.all([
          getTenantFeatures(user.tenantId),
          listTenantProductAccess(user.tenantId),
        ]);
        features = resolvedFeatures;
        products = Object.fromEntries(
          resolvedProducts.map((product) => [product.key, product.enabled]),
        );
        productAccess = resolvedProducts.map((product) => ({
          key: product.key,
          name: product.name,
          category: product.category,
          routeHref: product.routeHref,
          featureKey: product.featureKey,
          enabled: product.enabled,
          limits: product.limits,
        }));
      }
      res.json({
        success: true,
        data: { user: toPublicUser(user), features, products, productAccess },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
