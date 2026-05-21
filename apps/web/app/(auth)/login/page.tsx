"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { login, resendVerification, ApiClientError } from "../../../src/lib/api";
import { roleHome } from "../../../src/hooks/useAuth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resendDone, setResendDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNeedsVerification(false);
    setResendDone(null);
    setBusy(true);
    try {
      const { user } = await login(email.trim(), password);
      router.push(roleHome(user.role));
    } catch (err) {
      const msg =
        err instanceof ApiClientError ? err.message : "Login failed. Try again.";
      setNeedsVerification(
        err instanceof ApiClientError && err.code === "EMAIL_NOT_VERIFIED",
      );
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onResendVerification() {
    setError(null);
    setResendDone(null);
    setResendBusy(true);
    try {
      const { message } = await resendVerification(email.trim());
      setResendDone(message);
    } catch (err) {
      const msg =
        err instanceof ApiClientError
          ? err.message
          : "Could not resend verification email.";
      setError(msg);
    } finally {
      setResendBusy(false);
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
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
            {needsVerification && (
              <button
                type="button"
                onClick={onResendVerification}
                disabled={resendBusy || !email.trim()}
                className="mt-3 block font-medium text-red-800 underline disabled:opacity-60"
              >
                {resendBusy ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </div>
        )}

        {resendDone && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {resendDone}
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
