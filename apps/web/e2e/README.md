# Web E2E (Playwright)

Browser-driven smoke tests for the Next.js web app. PRD Phase 7. Lives next
to the code it tests so the same engineer who edits a page can update the
spec in the same diff.

## Run

```sh
cd apps/web

# One-time: install Playwright + the chromium browser bundle.
npx playwright install --with-deps chromium

# Build + start the app + run the specs (Playwright manages the server).
npm run build
npm run test:e2e

# Watch mode + headed browser:
npm run test:e2e:ui
```

If you're running the dev server yourself, point Playwright at it and
skip the auto-managed start:

```sh
PLAYWRIGHT_SKIP_WEB_SERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3000 \
  npm run test:e2e
```

## Environment variables

| Var | Purpose |
|---|---|
| `PLAYWRIGHT_BASE_URL` | Override the default `http://localhost:3000`. CI can point at staging. |
| `PLAYWRIGHT_SKIP_WEB_SERVER` | Set to `1` when you're running `npm run start` yourself. |
| `PLAYWRIGHT_TEST_EMAIL` | Credentials for the happy-path login test. |
| `PLAYWRIGHT_TEST_PASSWORD` | Same. Without both, that test is skipped. |
| `CI` | Set automatically by GitHub Actions; switches reporter + retries. |

## What's covered (slice 1)

- `auth.spec.ts` — `/login` + `/signup` render, blank submission stays on
  page, bad credentials surface inline, optional happy-path login.
- `route-guards.spec.ts` — every protected route redirects to `/login`
  when unauthenticated.
- `public-pages.spec.ts` — `/`, `/login`, `/signup`, `/reset-password`,
  `/verify-email` all return 2xx and render.

## What's not covered yet (slice 2+)

- Logged-in flows (sending a WhatsApp message, creating a contact, editing
  a lead) — need a seeded test tenant + agent credentials in CI secrets.
- Realtime / Socket.io message arrival.
- Mobile (Detox lives in `apps/mobile/` and is its own slice).

## Design notes

- **No fixtures or page objects yet.** With ~6 tests, abstractions cost
  more than they buy. Add a `fixtures/auth.ts` when we get a logged-in
  test that's reused 3+ times.
- **Assertions stay loose where copy might change.** Headings + URLs are
  pinned; specific error message strings aren't, because locale + small
  copy edits shouldn't break the test.
- **Tests skip rather than fail** when secrets are missing. Keeps PR
  builds green for contributors who can't reach staging.
