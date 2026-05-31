import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Anchor vitest's working root to this file's directory (the repo root)
// regardless of who invokes it. Without this, running `npm test` from
// `apps/api/` (which is what `turbo run test` does) would re-resolve
// the include globs against cwd=apps/api and find nothing.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Repo-root vitest configuration.
 *
 * vitest is the unit-test runner for the API workspace (`apps/api`).
 * When invoked from the repo root (e.g. `npx vitest run`), vitest's
 * default include pattern (`**\/*.{test,spec}.?(c|m)[jt]s?(x)`) would
 * otherwise scoop up the Playwright end-to-end specs under
 * `apps/web/e2e/` — those import `@playwright/test`, fail with
 * `Failed to load url @playwright/test` under vitest, and produce
 * the perennial "3 failed suites" noise.
 *
 * Playwright owns its own test runner (see `apps/web/package.json`'s
 * `test:e2e` script). This config scopes vitest to the API workspace
 * + shared packages and explicitly excludes the e2e tree so the two
 * runners stay in their own lanes.
 */
export default defineConfig({
  test: {
    root: repoRoot,
    include: [
      "apps/api/src/**/*.{test,spec}.{ts,tsx,js}",
      "packages/**/src/**/*.{test,spec}.{ts,tsx,js}",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      // Playwright owns the e2e directory.
      "apps/web/e2e/**",
    ],
  },
});
