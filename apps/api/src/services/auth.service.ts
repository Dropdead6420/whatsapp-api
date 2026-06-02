import crypto from "node:crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import bcryptjs from "bcryptjs";
import { UserRole, ApiError, ErrorCodes } from "@nexaflow/shared";

export interface TokenPayload {
  userId: string;
  role: UserRole;
  tenantId?: string;
  /**
   * Impersonation claims (set only when a SUPER_ADMIN started an
   * impersonation session). The token presents as the *target* (userId
   * + role + tenantId), so existing tenant-scoped queries Just Work —
   * but the real actor is preserved here so the audit trail can stamp
   * who's behind the keyboard and the dangerous-action gate can refuse
   * irreversible mutations.
   */
  actorUserId?: string;
  actorRole?: UserRole;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  userId: string;
  jti: string;
  iat?: number;
  exp?: number;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export class AuthService {
  private jwtSecret: string;

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET ?? "";
    if (!this.jwtSecret) {
      throw new Error(
        "JWT_SECRET environment variable is not set. Please set it in .env file.",
      );
    }
    if (this.jwtSecret.length < 32) {
      console.warn(
        "⚠️  JWT_SECRET is less than 32 characters. Use a stronger secret in production.",
      );
    }
  }

  get accessTokenTtl(): number {
    return ACCESS_TOKEN_TTL_SECONDS;
  }

  get refreshTokenTtl(): number {
    return REFRESH_TOKEN_TTL_SECONDS;
  }

  generateAccessToken(
    userId: string,
    role: UserRole,
    tenantId?: string,
  ): string {
    const payload: TokenPayload = {
      userId,
      role,
      ...(tenantId && { tenantId }),
    };
    const options: SignOptions = {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: "HS256",
    };
    return jwt.sign(payload, this.jwtSecret, options);
  }

  /**
   * Mint a short-lived (15-minute) impersonation token. The token's
   * subject is the *target* user — so all tenant-scoped routes apply
   * exactly as if the target had logged in — but it carries actorUserId
   * + actorRole so audit + dangerous-action gating know who's behind it.
   */
  generateImpersonationToken(args: {
    actorUserId: string;
    actorRole: UserRole;
    targetUserId: string;
    targetRole: UserRole;
    targetTenantId?: string;
  }): string {
    const payload: TokenPayload = {
      userId: args.targetUserId,
      role: args.targetRole,
      actorUserId: args.actorUserId,
      actorRole: args.actorRole,
      ...(args.targetTenantId && { tenantId: args.targetTenantId }),
    };
    const options: SignOptions = {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: "HS256",
    };
    return jwt.sign(payload, this.jwtSecret, options);
  }

  generateRefreshToken(userId: string): { token: string; jti: string } {
    const jti = crypto.randomUUID();
    const payload: RefreshTokenPayload = { userId, jti };
    const options: SignOptions = {
      expiresIn: REFRESH_TOKEN_TTL_SECONDS,
      algorithm: "HS256",
    };
    const token = jwt.sign(payload, this.jwtSecret, options);
    return { token, jti };
  }

  verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as TokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ApiError(
          ErrorCodes.TOKEN_EXPIRED,
          401,
          "Access token has expired.",
        );
      }
      throw new ApiError(
        ErrorCodes.UNAUTHORIZED,
        401,
        "Invalid access token.",
      );
    }
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return jwt.verify(token, this.jwtSecret) as RefreshTokenPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new ApiError(
          ErrorCodes.TOKEN_EXPIRED,
          401,
          "Refresh token has expired. Please log in again.",
        );
      }
      throw new ApiError(
        ErrorCodes.UNAUTHORIZED,
        401,
        "Invalid refresh token.",
      );
    }
  }

  async hashPassword(password: string): Promise<string> {
    const salt = await bcryptjs.genSalt(12);
    return bcryptjs.hash(password, salt);
  }

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcryptjs.compare(password, hash);
  }

  generateUrlSafeToken(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(32).toString("base64url");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");
    return { raw, hash };
  }

  hashOpaqueToken(raw: string): string {
    return crypto.createHash("sha256").update(raw).digest("hex");
  }
}

export const authService = new AuthService();
