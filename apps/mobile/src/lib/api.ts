// Mobile API client. Mirrors the web client (apps/web/src/lib/api.ts) but
// uses AsyncStorage for token persistence and reads the API base URL from
// the EXPO_PUBLIC_API_URL env var (set in app.json under `expo.extra` or
// via EAS secrets).

import axios, { AxiosError } from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ACCESS_KEY = "nx_access";
const REFRESH_KEY = "nx_refresh";

export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001";

// ---------------------------------------------------------------------------
// Token store — AsyncStorage replaces window.localStorage from the web side.
// ---------------------------------------------------------------------------

export const tokenStore = {
  async getAccess(): Promise<string | null> {
    return AsyncStorage.getItem(ACCESS_KEY);
  },
  async getRefresh(): Promise<string | null> {
    return AsyncStorage.getItem(REFRESH_KEY);
  },
  async set(tokens: { accessToken: string; refreshToken: string }) {
    await AsyncStorage.multiSet([
      [ACCESS_KEY, tokens.accessToken],
      [REFRESH_KEY, tokens.refreshToken],
    ]);
  },
  async clear() {
    await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY]);
  },
};

// ---------------------------------------------------------------------------
// ApiClientError — same shape as the web client so handler code can be
// shared between the two surfaces with minor adaptation.
// ---------------------------------------------------------------------------

export class ApiClientError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Axios instance with a request interceptor that attaches the access token
// and a response interceptor that converts the API's error envelope to
// ApiClientError.
// ---------------------------------------------------------------------------

const http = axios.create({
  baseURL: API_BASE,
  timeout: 20_000,
});

http.interceptors.request.use(async (config) => {
  const token = await tokenStore.getAccess();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: { code?: string; message?: string } }>) => {
    const status = error.response?.status ?? 0;
    const code = error.response?.data?.error?.code ?? "UNKNOWN";
    const message =
      error.response?.data?.error?.message ?? error.message ?? "Request failed";
    return Promise.reject(new ApiClientError(code, status, message));
  },
);

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

async function unwrap<T>(p: Promise<{ data: { success?: boolean; data?: T } }>): Promise<T> {
  const { data } = await p;
  if (!data.success) {
    throw new ApiClientError("UNKNOWN", 0, "Request failed");
  }
  return data.data as T;
}

export const api = {
  get: <T>(path: string) => unwrap<T>(http.get(path)),
  post: <T>(path: string, body?: unknown) => unwrap<T>(http.post(path, body)),
  patch: <T>(path: string, body?: unknown) => unwrap<T>(http.patch(path, body)),
  // axios accepts a body on DELETE via the `data` config field — required
  // for endpoints like /devices that take fcmToken in the body.
  delete: <T>(path: string, body?: unknown) =>
    unwrap<T>(http.delete(path, body !== undefined ? { data: body } : undefined)),
};

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
}

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user: AuthUser;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResult> {
  const data = await api.post<LoginResult>("/api/v1/auth/login", {
    email,
    password,
  });
  await tokenStore.set({
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  });
  return data;
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const data = await api.get<{ user: AuthUser }>("/api/v1/auth/me");
    return data.user;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  // Best-effort unregister of this device's FCM token from the server so
  // a logged-out user stops receiving push for this tenant. We don't
  // block logout on it.
  try {
    const { unregisterThisDevice } = await import("./push");
    await unregisterThisDevice();
  } catch {
    // ignore
  }
  try {
    const refreshToken = await tokenStore.getRefresh();
    await api.post("/api/v1/auth/logout", { refreshToken });
  } catch {
    // ignore — local clear is the important part
  }
  await tokenStore.clear();
}
