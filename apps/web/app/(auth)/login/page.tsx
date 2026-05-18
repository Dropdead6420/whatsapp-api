"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, ApiClientError } from "../../../src/lib/api";
import { roleHome } from "../../../src/hooks/useAuth";

interface LoginError {
  message: string;
  hint?: string;
}

// Map server-side ApiClientError codes to user-facing copy. Falling back
// to the API's own message string is fine — those are already vetted —
// but explicit cases let us add a hint (resend link, retry-window, etc).
function explainLoginError(err: unknown): LoginError {
  if (err instanceof ApiClientError) {
    switch (err.code) {
      case "INVALID_CREDENTIALS":
        return { message: "Email or password is incorrect." };
      case "TOO_MANY_REQUESTS":
        return {
          message: err.message,
          hint:
            "Too many failed attempts on this account. Wait the cooldown out or reset your password.",
        };
      case "EMAIL_NOT_VERIFIED":
        return {
          message: "Please verify your email before logging in.",
          hint: "Check your inbox for the verification link — or sign up again to resend.",
        };
      case "FORBIDDEN":
        return { message: err.message };
      default:
        return { message: err.message };
    }
  }
  // Network error / API unreachable. Most common cause is the API
  // process not running locally — surface that so the user doesn't
  // chase a phantom credential bug.
  return {
    message: "Can't reach the server.",
    hint: "Check your connection, or confirm the API is running on the expected port.",
  };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { user } = await login(email.trim(), password);
      router.push(roleHome(user.role));
    } catch (err) {
      setError(explainLoginError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Log in</h1>
      <p className="mt-1 text-sm text-slate-500">
        Welcome back. Enter your credentials below.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            <div className="font-medium">{error.message}</div>
            {error.hint && (
              <div className="mt-1 text-xs text-red-600/80">{error.hint}</div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      <div className="mt-6 flex justify-between text-sm">
        <Link href="/reset-password" className="text-slate-600 hover:text-slate-900">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-slate-600 hover:text-slate-900">
          Create account
        </Link>
      </div>
    </>
  );
}
