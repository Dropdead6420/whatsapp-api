import { defineConfig, devices } from "@playwright/test";

// Playwright config for the web app (PRD Phase 7).
//
// Local default: hits http://localhost:3000 (the running Next dev/start
// server). CI can override via PLAYWRIGHT_BASE_URL — for example, point
// at the staging URL during PR builds:
//
//   PLAYWRIGHT_BASE_URL=https://medscrub.in npm run test:e2e
//
// `webServer` boots `next start` automatically when there's no existing
// server on the target URL, so `npm run test:e2e` works against a fresh
// build with no manual prep. Set PLAYWRIGHT_SKIP_WEB_SERVER=1 to opt out
// (when you're running the app yourself in another terminal).

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PORT = Number(new URL(BASE_URL).port || "3000");
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEB_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Webkit + Firefox can be re-enabled per-need. Default to chromium-only
    // to keep CI runtime tight; the auth happy path is the same across
    // engines in this app.
  ],

  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: "npm run start",
          url: BASE_URL,
          port: PORT,
          reuseExistingServer: !process.env.CI,
          stdout: "ignore",
          stderr: "pipe",
          timeout: 120_000,
        },
      }),
});
