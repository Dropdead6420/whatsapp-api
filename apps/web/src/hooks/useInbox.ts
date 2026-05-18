"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { api, ApiClientError, tokenStore } from "../lib/api";

// useInbox (T-103). WS-first realtime updates with a polling fallback so
// the page works on any network that blocks WebSocket upgrades. The hook
// owns three things:
//
//   1. Initial fetch + manual refresh.
//   2. A socket.io subscription scoped to the current tenant (server-
//      side rooms keep us from seeing other tenants' traffic).
//   3. A polling timer that ticks every POLL_INTERVAL_MS only while the
//      socket is NOT connected. This is the fallback — no double work
//      when the WS is healthy.

const POLL_INTERVAL_MS = 15_000;
const WS_PATH = "/realtime";

interface UseInboxOptions<T> {
  endpoint: string;
  enabled?: boolean;
}

interface UseInboxResult<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  realtimeConnected: boolean;
}

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

export function useInbox<T>({
  endpoint,
  enabled = true,
}: UseInboxOptions<T>): UseInboxResult<T> {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await api.get<T[]>(endpoint);
      setData(list);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled]);

  // Initial fetch + manual triggers (re-runs when endpoint changes).
  useEffect(() => {
    if (enabled) void refresh();
  }, [refresh, enabled]);

  // WS subscription. Connects with the current access token; the server
  // re-validates against the T-090 auth cache, so a logged-out token
  // can't keep a socket open.
  useEffect(() => {
    if (!enabled) return;
    const token = tokenStore.getAccess();
    if (!token) return;

    const socket = io(getApiBase(), {
      path: WS_PATH,
      transports: ["websocket", "polling"],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setRealtimeConnected(true));
    socket.on("disconnect", () => setRealtimeConnected(false));
    socket.on("connect_error", () => setRealtimeConnected(false));

    // Any of these events can change the list — easiest correctness move
    // is a full refetch. At scale, swap to delta updates per event.
    const events = [
      "message:received",
      "message:sent",
      "conversation:updated",
      "conversation:assigned",
    ];
    for (const ev of events) {
      socket.on(ev, () => void refresh());
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setRealtimeConnected(false);
    };
  }, [refresh, enabled]);

  // Polling fallback — only while WS is NOT connected. The dependency
  // on realtimeConnected reschedules the interval at the right times.
  useEffect(() => {
    if (!enabled) return;
    if (realtimeConnected) return;
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, enabled, realtimeConnected]);

  return { data, loading, error, refresh, realtimeConnected };
}
