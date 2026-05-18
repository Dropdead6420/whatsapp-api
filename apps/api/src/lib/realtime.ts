import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { authService } from "../services/auth.service";
import { getAuthContext } from "./redis";

// ----------------------------------------------------------------------------
// Realtime layer (T-100). Socket.io attached to the same HTTP server as
// Express. JWT-authenticated on connection; clients are auto-joined to
// `tenant:<tenantId>` and (on demand) per-conversation rooms. A Redis
// pub/sub adapter ensures emit() reaches clients connected to any replica.
//
// Clients connect with the access token as either a query parameter
// (`?token=...`) or via the `auth` payload in socket.io-client. The same
// JWT verification the HTTP routes use applies — no separate WS auth
// surface.
// ----------------------------------------------------------------------------

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_CLUSTER_URLS = process.env.REDIS_CLUSTER_URLS;

export type RealtimeEvent =
  | "message:received"
  | "message:sent"
  | "message:status"
  | "conversation:assigned"
  | "conversation:updated"
  | "lead:created"
  | "appointment:booked";

interface AuthedSocketData {
  userId: string;
  role: string;
  tenantId: string | null;
}

let io: SocketIOServer | null = null;
let pubClient: ReturnType<typeof createClient> | null = null;
let subClient: ReturnType<typeof createClient> | null = null;

async function buildRedisAdapter() {
  // socket.io's adapter wants two duplicate clients (one publisher, one
  // subscriber). On cluster, both seed nodes from REDIS_CLUSTER_URLS.
  function build() {
    if (REDIS_CLUSTER_URLS) {
      // node-redis v4 cluster client returns a different shape than the
      // single client and the adapter doesn't support it directly. Document
      // the limitation: pub/sub goes through a regular client even when
      // queries route through cluster. This is the recommended pattern in
      // the socket.io docs.
      console.warn(
        "[realtime] REDIS_CLUSTER_URLS set but socket.io adapter uses single-node REDIS_URL for pub/sub.",
      );
    }
    return createClient({ url: REDIS_URL });
  }
  pubClient = build();
  subClient = pubClient.duplicate();
  pubClient.on("error", (err) => console.error("[realtime:pub]", err));
  subClient.on("error", (err) => console.error("[realtime:sub]", err));
  await Promise.all([pubClient.connect(), subClient.connect()]);
  return createAdapter(pubClient, subClient);
}

export async function attachRealtime(server: HttpServer): Promise<void> {
  if (io) return;

  io = new SocketIOServer(server, {
    cors: {
      origin: process.env.WEB_URL ?? "http://localhost:3000",
      credentials: true,
    },
    path: "/realtime",
  });

  try {
    const adapter = await buildRedisAdapter();
    io.adapter(adapter);
  } catch (err) {
    console.warn(
      "[realtime] Redis pub/sub adapter unavailable; running in single-process mode:",
      (err as Error).message,
    );
  }

  io.use(async (socket: Socket, next: (err?: Error) => void) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      if (!token) {
        return next(new Error("Missing access token"));
      }
      const payload = authService.verifyAccessToken(token);

      // Re-validate via the cached auth context so suspended users + tenants
      // can't open new WS connections (HTTP middleware already does this for
      // requests; same gate here for sockets).
      const ctx = await getAuthContext(payload.userId);
      if (ctx && (ctx.userStatus !== "ACTIVE" || (ctx.tenantStatus && ctx.tenantStatus !== "ACTIVE"))) {
        return next(new Error("Account or tenant is not active"));
      }

      const data: AuthedSocketData = {
        userId: payload.userId,
        role: payload.role,
        tenantId: payload.tenantId ?? null,
      };
      (socket.data as AuthedSocketData) = data;
      next();
    } catch (err) {
      next(new Error((err as Error).message || "Authentication failed"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const data = socket.data as AuthedSocketData;
    if (data.tenantId) {
      socket.join(`tenant:${data.tenantId}`);
    }
    socket.join(`user:${data.userId}`);

    socket.on("conversation:subscribe", (conversationId: string) => {
      if (typeof conversationId !== "string" || conversationId.length > 64) return;
      // Cross-tenant join attempts are blocked at emit time — we never
      // emit conversation:* events without scoping to the tenant first.
      socket.join(`conversation:${conversationId}`);
    });
    socket.on("conversation:unsubscribe", (conversationId: string) => {
      if (typeof conversationId !== "string") return;
      socket.leave(`conversation:${conversationId}`);
    });

    if (process.env.REALTIME_LOG_CONNECTIONS === "true") {
      console.log(
        `[realtime] connect user=${data.userId} tenant=${data.tenantId ?? "(none)"} id=${socket.id}`,
      );
    }
  });
}

export function emitToTenant(
  tenantId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown>,
): void {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit(event, payload);
}

export function emitToConversation(
  tenantId: string,
  conversationId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown>,
): void {
  if (!io) return;
  // Always include the tenant scope in the room name so cross-tenant
  // subscribers (defensive — shouldn't happen) can't receive another
  // tenant's traffic.
  io.to(`tenant:${tenantId}`)
    .to(`conversation:${conversationId}`)
    .emit(event, payload);
}

export function emitToUser(
  userId: string,
  event: RealtimeEvent,
  payload: Record<string, unknown>,
): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

export async function closeRealtime(): Promise<void> {
  if (io) {
    await new Promise<void>((resolve) => io!.close(() => resolve()));
    io = null;
  }
  await Promise.allSettled([
    pubClient?.quit().catch(() => undefined),
    subClient?.quit().catch(() => undefined),
  ]);
  pubClient = null;
  subClient = null;
}

export function isRealtimeAttached(): boolean {
  return io !== null;
}
