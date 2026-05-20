"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AuthUserPublic } from "@nexaflow/shared";

const NAV = [
  { href: "/agent/inbox", label: "Inbox" },
  { href: "/agent/leads", label: "My leads" },
  { href: "/appointments", label: "Appointments" },
];

export function AgentShell({
  user,
  signOut,
  children,
  features: _features,
}: {
  user: AuthUserPublic;
  signOut: () => void;
  children: ReactNode;
  /** Ignored — keeps call sites compatible with DashboardShell. */
  features?: Record<string, boolean> | null;
}) {
  const pathname = usePathname() ?? "/";

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-52 shrink-0 border-r border-slate-200 bg-white md:flex md:flex-col">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4 text-sm font-semibold">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-cyan-600 text-white">
            A
          </span>
          Agent
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                pathname.startsWith(item.href)
                  ? "bg-cyan-50 font-medium text-cyan-900"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          {user.name}
          <button
            type="button"
            onClick={signOut}
            className="mt-2 block w-full rounded-md border border-slate-200 px-2 py-1.5 text-left text-slate-700 hover:bg-slate-50"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-slate-50 p-4 md:p-6">{children}</main>
    </div>
  );
}
