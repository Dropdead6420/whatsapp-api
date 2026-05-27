// Socket.io client singleton. Mirrors the server contract in
// apps/api/src/lib/realtime.ts:
//   - Connects to <API_BASE>/realtime with the JWT access token in the
//     `auth` payload (the server's middleware reads `socket.handshake.auth.token`).
//   - Auto-joins tenant:* and user:* on the server side.
//   - For per-conversation rooms we emit `conversation:subscribe` /
//     `conversation:unsubscribe` ourselves.
//
// We lazily connect on first `useRealtime()` call so unauthenticated
// surfaces (login) never establish a socket.

import { useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { API_BASE, tokenStore } from "./api";

export type RealtimeEvent =
  | "message:received"
  | "message:sent"
  | "message:status"
  | "conversation:assigned"
  | "conversation:updated"
  | "lead:created"
  | "appointment:booked";

let socket: Socket | null = null;
let connectingPromise: Promise<Socket | null> | null = null;

async function connect(): Promise<Socket | null> {
  if (socket?.connected) return socket;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const token = await tokenStore.getAccess();
    if (!token) {
      connectingPromise = null;
      return null;
    }
    const s = io(API_BASE, {
      path: "/realtime",
      transports: ["websocket"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      // RN doesn't ship cookies; auth lives entirely in the `auth` payload.
      withCredentials: false,
    });

    s.on("connect_error", (err) => {
      // Don't log the token; just the reason.
      console.warn("[socket] connect_error:", err.message);
    });

    socket = s;
    connectingPromise = null;
    return s;
  })();

  return connectingPromise;
}

/**
 * Subscribe to a server event for the lifetime of the React effect. Returns
 * a cleanup function suitable for useEffect.
 */
export function subscribe<T = unknown>(
  event: RealtimeEvent,
  handler: (payload: T) => void,
): () => void {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  void connect().then((s) => {
    if (cancelled || !s) return;
    s.on(event, handler);
    unsub = () => s.off(event, handler);
  });
  return () => {
    cancelled = true;
    unsub?.();
  };
}

/**
 * Join a per-conversation room while the React effect is mounted; emit
 * the leave when it unmounts. Safe to call before the socket connects —
 * the join is queued.
 */
export function useConversationRoom(conversationId: string | null | undefined) {
  useEffect(() => {
    if (!conversationId) return undefined;
    let cancelled = false;
    let joinedOn: Socket | null = null;

    void connect().then((s) => {
      if (cancelled || !s) return;
      s.emit("conversation:subscribe", conversationId);
      joinedOn = s;
    });

    return () => {
      cancelled = true;
      if (joinedOn) {
        joinedOn.emit("conversation:unsubscribe", conversationId);
      }
    };
  }, [conversationId]);
}

/**
 * Drop the socket on sign-out. Safe to call when nothing's connected.
 */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  connectingPromise = null;
}
