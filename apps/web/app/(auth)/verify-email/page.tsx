"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { verifyEmail, ApiClientError } from "../../../src/lib/api";

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params?.get("token");
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Missing verification token.");
      return;
    }
    verifyEmail(token)
      .then(() => {
        setState("ok");
        setMessage("Your email is verified. You can now log in.");
      })
      .catch((err) => {
        setState("error");
        setMessage(
          err instanceof ApiClientError
            ? err.message
            : "Could not verify email. The link may have expired.",
        );
      });
  }, [token]);

  return (
    <>
      <h1 className="text-xl font-semibold">Email verification</h1>
      <p className="mt-2 text-sm text-slate-600">
        {state === "working" ? "Verifying your email…" : message}
      </p>
      {state === "ok" && (
        <Link
          href="/login"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Continue to login
        </Link>
      )}
      {state === "error" && (
        <Link
          href="/signup"
          className="mt-6 inline-block text-sm font-medium text-emerald-700 hover:underline"
        >
          Back to signup
        </Link>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
      <VerifyEmailInner />
    </Suspense>
  );
}
