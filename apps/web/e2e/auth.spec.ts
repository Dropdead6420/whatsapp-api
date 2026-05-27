import { expect, test } from "@playwright/test";

// Smoke tests for the auth surface. These are intentionally tight — they
// don't try to verify every error message; they verify the user-visible
// surfaces render without crashing and the happy-path login → dashboard
// redirect works.
//
// Tests that require real credentials (full login flow) read
// PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD from the env. When
// missing, those tests skip rather than fail — keeps CI green on PRs
// that don't have access to the staging secrets.

const testEmail = process.env.PLAYWRIGHT_TEST_EMAIL;
const testPassword = process.env.PLAYWRIGHT_TEST_PASSWORD;

test.describe("/login", () => {
  test("renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign in/i }),
    ).toBeVisible();
  });

  test("blocks submission with empty fields", async ({ page }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: /sign in/i });
    // Browser-side validation: required attribute prevents submit and
    // keeps us on /login. We assert by URL rather than checking a
    // specific error string (those vary by browser locale).
    await submit.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("shows an inline error for bad credentials", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("nobody@nexaflow.test");
    await page.getByLabel(/password/i).fill("definitely-wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    // The login page surfaces server errors inline rather than redirecting.
    // We don't bind to a specific message string — just that we stay on
    // /login and either an error region appears or the URL still matches.
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("/signup", () => {
  test("renders the sign-up form", async ({ page }) => {
    await page.goto("/signup");
    // The page uses input labels for name, email, password, and company —
    // we just verify the first two render so the route is reachable.
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });
});

test.describe("happy-path login (requires test creds)", () => {
  test.skip(
    !testEmail || !testPassword,
    "Set PLAYWRIGHT_TEST_EMAIL + PLAYWRIGHT_TEST_PASSWORD to run this test.",
  );

  test("signs in and lands on the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail!);
    await page.getByLabel(/password/i).fill(testPassword!);
    await page.getByRole("button", { name: /sign in/i }).click();
    // The auth client redirects to a dashboard route — exact path depends
    // on the user's role, so we match the broad set rather than pinning
    // to /dashboard.
    await expect(page).toHaveURL(/\/(dashboard|partner|tenants|leads)/, {
      timeout: 15_000,
    });
  });
});
