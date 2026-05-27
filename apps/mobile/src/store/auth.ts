// Global auth state for the mobile app. Wraps tokenStore + the /me endpoint
// so screens can read `user` synchronously and call `hydrate()` once on
// startup to determine which root route to send the user to.

import { create } from "zustand";
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  tokenStore,
  type AuthUser,
} from "../lib/api";

interface AuthState {
  user: AuthUser | null;
  hydrating: boolean;
  signingIn: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  hydrating: true,
  signingIn: false,
  error: null,

  // Called once from the root layout on app boot. If we have an access
  // token, hit /me to validate it and pull the user record; otherwise we
  // stay unauthenticated and the index screen will redirect to /login.
  hydrate: async () => {
    set({ hydrating: true, error: null });
    try {
      const token = await tokenStore.getAccess();
      if (!token) {
        set({ user: null });
        return;
      }
      const me = await fetchMe();
      set({ user: me });
      if (!me) await tokenStore.clear();
    } catch {
      set({ user: null });
    } finally {
      set({ hydrating: false });
    }
  },

  signIn: async (email, password) => {
    set({ signingIn: true, error: null });
    try {
      const result = await apiLogin(email, password);
      set({ user: result.user });
      return true;
    } catch (err) {
      set({ error: (err as Error).message || "Login failed" });
      return false;
    } finally {
      set({ signingIn: false });
    }
  },

  signOut: async () => {
    await apiLogout();
    set({ user: null });
  },
}));
