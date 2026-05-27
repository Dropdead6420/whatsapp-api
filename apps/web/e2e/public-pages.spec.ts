import { expect, test } from "@playwright/test";

// Smoke tests for routes that should render without auth. If any of these
// 500 or redirect-loop, this catches it before deploy.

const publicRoutes = [
  "/",
  "/login",
  "/signup",
  "/reset-password",
  "/verify-email",
];

test.describe("public pages render without auth", () => {
  for (const path of publicRoutes) {
    test(`GET ${path} returns a 200 page`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status() ?? 0).toBeLessThan(400);
      // Defensive: confirm we didn't get redirected to /login when we
      // explicitly asked for an auth route (avoid silent loops).
      const url = page.url();
      if (path !== "/") {
        expect(url).toContain(path);
      }
    });
  }

  test("landing page shows the AI feature copy", async ({ page }) => {
    await page.goto("/");
    // The landing page has FEATURES content; check for one of the
    // distinctive phrases. We use a regex so a future copy tweak doesn't
    // break the test on whitespace alone.
    await expect(
      page.getByText(/AI Campaign Autopilot/i).first(),
    ).toBeVisible();
  });
});
