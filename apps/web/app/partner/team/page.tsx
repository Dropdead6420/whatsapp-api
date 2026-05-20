"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../../src/hooks/useAuth";
import { PartnerShell } from "../../../src/components/PartnerShell";
import { api, ApiClientError } from "../../../src/lib/api";

interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  lastLoginAt: string | null;
}

export default function PartnerTeamPage() {
  const { user, loading, signOut } = useAuth({
    required: true,
    roles: ["WHITE_LABEL_ADMIN"],
  });
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .get<TeamMember[]>("/api/v1/partner/team")
      .then(setTeam)
      .catch((e) => setErr(e instanceof ApiClientError ? e.message : "Load failed"));
  }, [user]);

  if (loading || !user) {
    return <div className="p-10 text-sm text-slate-500">Loading…</div>;
  }

  return (
    <PartnerShell user={user} signOut={signOut}>
      <h1 className="mb-2 text-2xl font-semibold">Team</h1>
      <p className="mb-6 text-sm text-slate-500">Partner staff on your white-label account.</p>
      {err && <p className="mb-4 text-sm text-red-600">{err}</p>}
      <ul className="space-y-2">
        {team.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm"
          >
            <div>
              <div className="font-medium">{m.name}</div>
              <div className="text-slate-500">{m.email}</div>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{m.role}</span>
          </li>
        ))}
      </ul>
    </PartnerShell>
  );
}
