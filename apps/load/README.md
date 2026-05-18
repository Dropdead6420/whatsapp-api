# Load test harness (k6)

Phase A target: **50k concurrent / 200 messages-per-second**. This directory
holds the k6 scripts and the conventions for running them.

## Prerequisites

- [k6](https://k6.io) installed locally (`brew install k6` on macOS).
- A running NexaFlow stack (`docker compose up -d` + `npm run dev`).
- Seed data: at least one tenant + one verified user. For the inbox-poll
  scenario, also seed a few hundred conversations so the list endpoint is
  doing real work.

## Scenarios

All scenarios are in `scenarios/`. Each one is self-contained — no shared
helpers — so you can read it top-to-bottom and reason about exactly what it
exercises.

| Script | What it hammers | Phase A target |
|---|---|---|
| `scenarios/auth-burst.js` | `POST /api/v1/auth/login` ramp | p95 < 500ms, no errors at 200 VU |
| `scenarios/inbox-poll.js` | `GET /api/v1/conversations` ramp | p95 < 400ms, no errors at 500 VU |
| `scenarios/webhook-storm.js` | `POST /webhooks/whatsapp` flood | 200 rps sustained, error rate < 0.1% |

## Running

Each script takes config from env vars so the same script works against any
environment (local, staging, prod-canary).

```bash
# Local API listening on 3001
BASE_URL=http://localhost:3001 \
  LOGIN_EMAIL=admin@example.com LOGIN_PASSWORD=password123 \
  k6 run scenarios/auth-burst.js

# Inbox polling — needs a Bearer token from a real login session.
BASE_URL=http://localhost:3001 \
  AUTH_TOKEN="eyJhbGciOi..." \
  k6 run scenarios/inbox-poll.js

# Webhook storm — needs META_APP_SECRET so the script can sign requests.
BASE_URL=http://localhost:3001 \
  META_APP_SECRET=$(grep ^META_APP_SECRET= ../../.env | cut -d= -f2) \
  PHONE_NUMBER_ID=PNID-LOAD \
  k6 run scenarios/webhook-storm.js
```

## How to read the results

- `http_req_duration` — request latency. Watch the **p95**, not the mean.
- `http_req_failed` — fraction of failed requests. Target < 0.001 for the
  Phase A pass.
- `iterations` — total scenario loops completed. Useful as a sanity check
  against the configured duration.

If a scenario fails the threshold, k6 exits non-zero. CI can wire this to
gate a release.

## What this doesn't cover

- WebSocket / realtime inbox — that's Phase C (T-100).
- AI endpoints — billed and rate-limited; not part of the throughput target.
- Multi-tenant fan-out — needs a seed loader; tracked separately.

When a Phase A run is green, copy the summary into `docs/SCALE_PLAN_1M.md`
under "Phase A results" and tag the commit. That's the gate before Phase B
can start.
