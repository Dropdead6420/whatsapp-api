import type {
  ApiResponse,
  AuthTokens,
  AuthUserPublic,
} from "@nexaflow/shared";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const ACCESS_KEY = "nx_access";
const REFRESH_KEY = "nx_refresh";

export const tokenStore = {
  getAccess(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(ACCESS_KEY);
  },
  getRefresh(): string | null {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },
  set(tokens: AuthTokens): void {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear(): void {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(ACCESS_KEY);
    window.localStorage.removeItem(REFRESH_KEY);
  },
};

export class ApiClientError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
  }
}

interface FetchOpts extends RequestInit {
  auth?: boolean;
  json?: unknown;
}

async function request<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  const headers = new Headers(opts.headers ?? {});
  if (opts.json !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (opts.auth !== false) {
    const token = tokenStore.getAccess();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as ApiResponse<T>) : null;

  if (!res.ok || !parsed?.success) {
    const code = parsed?.error?.code ?? "UNKNOWN";
    const message = parsed?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiClientError(code, res.status, message);
  }
  return parsed.data as T;
}

export const api = {
  get: <T>(path: string, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "GET" }),
  post: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "POST", json: body }),
  put: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "PUT", json: body }),
  patch: <T>(path: string, body?: unknown, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "PATCH", json: body }),
  delete: <T>(path: string, opts: FetchOpts = {}) =>
    request<T>(path, { ...opts, method: "DELETE" }),
};

// ----------------------------------------------------------------------------
// Auth helpers
// ----------------------------------------------------------------------------

export interface LoginResult extends AuthTokens {
  user: AuthUserPublic;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await api.post<LoginResult>(
    "/api/v1/auth/login",
    { email, password },
    { auth: false },
  );
  tokenStore.set(data);
  return data;
}

export async function signup(payload: {
  email: string;
  password: string;
  name: string;
  companyName: string;
  selectedPlanName?: string;
}): Promise<{
  user: AuthUserPublic;
  selectedPlan?: {
    id: string;
    name: string;
    displayName: string;
  } | null;
  message: string;
}> {
  return api.post<{
    user: AuthUserPublic;
    selectedPlan?: {
      id: string;
      name: string;
      displayName: string;
    } | null;
    message: string;
  }>(
    "/api/v1/auth/signup",
    payload,
    { auth: false },
  );
}

export async function logout(): Promise<void> {
  const refreshToken = tokenStore.getRefresh();
  try {
    await api.post("/api/v1/auth/logout", { refreshToken });
  } catch {
    // ignore — clearing locally is the important part
  }
  tokenStore.clear();
  // Defensive: wipe per-user draft autosaves so the next user doesn't see them.
  try {
    const { clearAllAutoSave } = await import("../hooks/useAutoSave");
    clearAllAutoSave();
  } catch {
    // ignore
  }
}

export interface MeResponse {
  user: AuthUserPublic;
  features?: Record<string, boolean>;
}

export async function fetchMe(): Promise<AuthUserPublic | null> {
  try {
    const { user } = await api.get<MeResponse>("/api/v1/auth/me");
    return user;
  } catch {
    return null;
  }
}

export async function fetchMeFull(): Promise<MeResponse | null> {
  try {
    return await api.get<MeResponse>("/api/v1/auth/me");
  } catch {
    return null;
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api.post(
    "/api/v1/auth/request-password-reset",
    { email },
    { auth: false },
  );
}

export async function resendVerification(email: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(
    "/api/v1/auth/resend-verification",
    { email },
    { auth: false },
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  await api.post(
    "/api/v1/auth/reset-password",
    { token, newPassword },
    { auth: false },
  );
}

export async function verifyEmail(token: string): Promise<void> {
  await api.post("/api/v1/auth/verify-email", { token }, { auth: false });
}
