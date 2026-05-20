"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AuthUserPublic, UserRole } from "@nexaflow/shared";
import { fetchMeFull, logout, tokenStore } from "../lib/api";

type RoleName =
  | "SUPER_ADMIN"
  | "WHITE_LABEL_ADMIN"
  | "BUSINESS_ADMIN"
  | "TEAM_LEAD"
  | "AGENT";

export function useAuth(opts: { required?: boolean; roles?: RoleName[] } = {}) {
  const router = useRouter();
  const required = opts.required;
  const roles = opts.roles;
  const rolesKey = roles?.join(",");
  const [user, setUser] = useState<AuthUserPublic | null>(null);
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const access = tokenStore.getAccess();
    if (!access) {
      setLoading(false);
      if (required) router.replace("/login");
      return;
    }
    (async () => {
      const me = await fetchMeFull();
      if (cancelled) return;
      if (!me) {
        tokenStore.clear();
        setLoading(false);
        if (required) router.replace("/login");
        return;
      }
      if (roles && !roles.includes(me.user.role as RoleName)) {
        setLoading(false);
        router.replace(roleHome(me.user.role));
        return;
      }
      setUser(me.user);
      setFeatures(me.features ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [required, rolesKey, router]);

  return {
    user,
    features,
    loading,
    signOut: () => logout().then(() => router.push("/login")),
  };
}

export function roleHome(role: UserRole): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/dashboard";
    case "WHITE_LABEL_ADMIN":
      return "/partner/dashboard";
    case "BUSINESS_ADMIN":
    case "TEAM_LEAD":
      return "/dashboard";
    case "AGENT":
      return "/agent/inbox";
    default:
      return "/";
  }
}
