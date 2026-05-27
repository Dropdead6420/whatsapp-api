import { expect, test } from "@playwright/test";

// Verify that protected routes redirect unauthenticated users to /login
// instead of rendering a broken / blank page.
//
// We assert by URL because the route guard does a client-side redirect via
// `useAuth({ required: true })` — the network request to /me fails, the
// hook clears state, and Next pushes us to /login.

const protectedRoutes = [
  "/partner/dashboard",
  "/partner/customers",
  "/partner/wallet",
  "/partner/whitelabel",
  "/partner/theme",
  "/partner/menu",
  "/partner/products",
  "/partner/tickets",
  "/partner/channels",
  "/partner/ai",
  "/contacts",
  "/leads",
  "/campaigns",
  "/templates",
  "/drip-sequences",
  "/meta-ads",
  "/google-ads",
];

test.describe("route guards", () => {
  for (const path of protectedRoutes) {
    test(`unauthenticated GET ${path} → /login`, async ({ page }) => {
      await page.goto(path);
      // Some pages render a "Loading…" placeholder before the redirect
      // fires; wait for the URL to settle rather than asserting
      // synchronously.
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
