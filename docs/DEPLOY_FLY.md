# Deploying NexaFlow to Fly.io + Vercel

This is the production deploy path the codebase is designed for:

| Layer | Hosted on | Why |
|---|---|---|
| Next.js web frontend | **Vercel** | Edge cache, static-export friendly, free tier |
| Express API + Socket.io + BullMQ workers | **Fly.io** | Long-lived processes, Docker-native, Postgres + Redis integrations |
| Postgres | **Fly Postgres** | Managed, in the same region as the app — sub-ms latency |
| Redis | **Fly Redis** (Upstash under the hood) | Managed, low-latency, BullMQ-compatible |

This split solves the "Can't reach the server" error: Vercel hosts the web,
Fly hosts the API, and `NEXT_PUBLIC_API_URL` connects them.

---

## One-time setup

### 0. Prerequisites

```bash
# Install the Fly CLI
curl -L https://fly.io/install.sh | sh

# Log in (opens browser)
fly auth login
```

### 1. Create the Fly app

From the repo root:

```bash
fly apps create nexaflow-api
```

If `nexaflow-api` is taken, pick another and update the `app =` line in `fly.toml`.

### 2. Provision Postgres + Redis

```bash
# Pick the region closest to your users. Common choices:
#   iad (Virginia)  bom (Mumbai)  sin (Singapore)  fra (Frankfurt)  nrt (Tokyo)
export FLY_REGION=iad

fly postgres create --name nexaflow-db --region "$FLY_REGION" --vm-size shared-cpu-1x --initial-cluster-size 1
fly postgres attach   nexaflow-db --app nexaflow-api
#   ^ sets DATABASE_URL secret automatically

fly redis create   --name nexaflow-redis --region "$FLY_REGION" --no-replicas
fly redis attach   nexaflow-redis --app nexaflow-api
#   ^ sets REDIS_URL secret automatically
```

### 3. Set application secrets

```bash
bash scripts/fly-secrets.sh
```

The script prompts for:

- `JWT_SECRET` — Enter to auto-generate 32 random bytes
- `TENANT_TOKEN_ENCRYPTION_KEY` — Enter to auto-generate
- `META_APP_ID`, `META_APP_SECRET`, `WHATSAPP_WEBHOOK_TOKEN` — from developers.facebook.com
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `SENTRY_DSN` — optional

Verify:

```bash
fly secrets list --app nexaflow-api
```

### 4. Run database migrations

The first deploy needs the Postgres schema in place:

```bash
fly ssh console --app nexaflow-api -C \
  "node node_modules/prisma/build/index.js migrate deploy \
   --schema packages/db/prisma/schema.prisma"
```

If `fly ssh` fails because no machine is running yet, deploy first (next step) and migrate after.

### 5. Deploy

```bash
fly deploy --remote-only
```

`--remote-only` builds on Fly's builder (no local Docker required). The first deploy takes ~4-6 minutes; subsequent deploys are ~90s thanks to layer caching.

### 6. Verify

```bash
# Liveness
curl https://nexaflow-api.fly.dev/live

# Readiness (Postgres + Redis must be up)
curl https://nexaflow-api.fly.dev/api/v1/ready
```

Expected:

```json
{ "status": "ready", "mode": "api", "services": [{"name":"postgres","ok":true},{"name":"redis","ok":true}] }
```

### 7. Point Vercel at the new API

In the Vercel dashboard:

1. Open the `whatsapp-api-ruddy-alpha` (or your renamed) project
2. **Settings → Environment Variables**
3. Add `NEXT_PUBLIC_API_URL` = `https://nexaflow-api.fly.dev` for **all three** environments (Production, Preview, Development)
4. **Deployments → Redeploy** (env var changes alone don't rebuild — Next has to bake the new value into the JS bundle)

After the redeploy finishes, the login page will reach the Fly-hosted API and the "Can't reach the server" error will be gone.

### 8. Update CORS for the new web URL

If your Vercel domain is *not* `whatsapp-api-ruddy-alpha.vercel.app`:

```bash
fly secrets set --app nexaflow-api WEB_URL=https://YOUR-NEW-DOMAIN.vercel.app
```

A redeploy isn't required — Fly will rolling-restart the machines with the new env.

---

## Scaling

The `fly.toml` ships with two process groups so you can scale them independently:

```bash
# Three API replicas, two worker replicas
fly scale count app=3 worker=2 --app nexaflow-api

# Bigger machines (worker pool only)
fly scale memory 1024 --process-group worker --app nexaflow-api
```

For 10k+ concurrent users the codebase already supports:

- **PgBouncer** — add it as a separate Fly machine (`edoburu/pgbouncer:v1.24.1-p1` image) and set `DATABASE_URL_POOLED` to its address
- **Redis Cluster** — set `REDIS_CLUSTER_URLS` instead of `REDIS_URL` (see ADR for hash-tag conventions)
- **Read replica** — provision a follower Postgres and set `DATABASE_URL_READ`

See [`docs/SCALE_PLAN_1M.md`](SCALE_PLAN_1M.md) for the full path to 1M concurrent.

---

## Troubleshooting

### Web still shows "Can't reach the server" after deploy

1. Hard-reload the browser tab (Cmd+Shift+R) — the old bundle may be cached.
2. `curl https://nexaflow-api.fly.dev/api/v1/ready` from your terminal. If this 503s, check `fly logs --app nexaflow-api` — Postgres or Redis likely isn't attached.
3. Open browser devtools → Network. The failing request will reveal the URL the bundle is calling. If it's still `http://localhost:3001`, the Vercel redeploy didn't happen.
4. Check the CORS preflight (`OPTIONS`) response from the API — if `Access-Control-Allow-Origin` is missing or wrong, your `WEB_URL` secret is wrong.

### Worker process not running

`fly status --app nexaflow-api` should list both `app` and `worker` machines. If `worker` is missing:

```bash
fly scale count worker=1 --app nexaflow-api
```

### Migrations needed after a schema change

```bash
fly ssh console --app nexaflow-api -C \
  "node node_modules/prisma/build/index.js migrate deploy \
   --schema packages/db/prisma/schema.prisma"
```

Run this **after** deploying the new code so the new migration files are present on the machine.

---

## Cost estimate (Fly hobbyist pricing as of 2026)

| Item | Spec | $/mo |
|---|---|---|
| `app` machine | shared-cpu-1x, 512MB | ~$2 |
| `worker` machine | shared-cpu-1x, 512MB | ~$2 |
| Postgres | shared-cpu-1x, 1GB volume | ~$2 + storage |
| Redis | 256MB | ~$0 (free tier) |
| **Total** | | **~$8/mo** for dev/staging |

Pro tier (multi-region, larger VMs, replica) adds ~$30-50/mo depending on traffic.

---

## What this does NOT solve

- **Custom domain on the API** — `fly certs add api.yourdomain.com` after pointing a CNAME. Then update `NEXT_PUBLIC_API_URL` in Vercel + redeploy.
- **Backups** — Fly Postgres has automatic daily snapshots; verify in dashboard. For PITR, upgrade the cluster tier.
- **Outbound webhook delivery** — works out of the box (workers run on Fly), but if your Meta webhook needs a fixed IP for an allow-list, use [Fly's dedicated IPv4](https://fly.io/docs/networking/services/#allocate-an-ip-address).
