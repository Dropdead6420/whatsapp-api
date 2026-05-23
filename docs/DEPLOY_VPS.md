# Deploying NexaFlow on a Hostinger VPS

Single-host production deploy. Web stays on Vercel; everything else
runs on the VPS.

| Layer | Where | How |
|---|---|---|
| Next.js web | Vercel | `NEXT_PUBLIC_API_URL` points at the VPS |
| Express API + Socket.io | VPS Docker | `ghcr.io/dropdead6420/nexaflow-api` |
| 8 BullMQ workers | VPS Docker | Same image, `APP_MODE=worker` |
| Postgres 16 | VPS Docker | Volume-persisted |
| Redis 7 | VPS Docker | Volume-persisted, AOF on |
| Reverse proxy + auto-SSL | VPS Docker | Caddy 2, Let's Encrypt |

The deploy is **idempotent**: re-running `bootstrap.sh` updates the
repo, pulls latest images, restarts the stack, and keeps your env file
intact. Updates after the initial deploy are a one-liner.

---

## 0. Prerequisites

| | Need it for |
|---|---|
| **Hostinger VPS with root SSH access** | Everything below |
| **A domain name** | Caddy auto-SSL; DNS points at the VPS |
| **2–10 minutes of attention** | The script asks ~10 questions |

VM sizing — the stack runs comfortably on:

| Spec | Suits |
|---|---|
| 2 vCPU / 4 GB RAM / 50 GB SSD | Dev + first ~10 paying tenants |
| 4 vCPU / 8 GB RAM / 100 GB SSD | Production up to ~100 tenants |
| 8 vCPU / 16 GB RAM / 200 GB SSD | Production up to ~1000 tenants; consider managed Postgres beyond that |

Hostinger's KVM-2 (2 vCPU / 8 GB) is the sweet spot for getting started.

---

## 1. Point your domain at the VPS

In your DNS provider (Hostinger's hPanel → Domains → DNS, or your
registrar's panel):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `api` | `YOUR_VPS_IP` | 300 |

So `api.yourdomain.com` resolves to the VPS. Verify with:

```bash
dig +short api.yourdomain.com
# should return YOUR_VPS_IP
```

DNS propagation typically takes 30 seconds to 10 minutes. Caddy can't
issue an SSL cert until this resolves.

---

## 2. SSH into the VPS

From your laptop:

```bash
ssh root@YOUR_VPS_IP
```

(Hostinger sends the root password via email after provisioning. If
you set up SSH keys instead, use those.)

---

## 3. Run the bootstrap script

One command does everything: installs Docker, clones the repo, prompts
for env values, runs migrations, starts the stack.

```bash
curl -fsSL https://raw.githubusercontent.com/Dropdead6420/whatsapp-api/codex/nexaflow-v2-platform/deploy/vps/bootstrap.sh | bash
```

The script will ask:

| Prompt | What to enter |
|---|---|
| `API domain` | `api.yourdomain.com` |
| `Vercel web URL` | `https://whatsapp-api-ruddy-alpha.vercel.app` (default) |
| `META_APP_ID` | From developers.facebook.com → your app. Press Enter to use `placeholder` for now. |
| `META_APP_SECRET` | Same. Enter to skip. |
| `WHATSAPP_WEBHOOK_TOKEN` | Auto-generated random hex if you press Enter. |
| `META_PHONE_NUMBER_ID` / `META_BUSINESS_ACCOUNT_ID` | Press Enter to skip. Fill later via tenant settings. |
| `ANTHROPIC_API_KEY` | From console.anthropic.com. Enter to skip — AI features disabled until set. |
| `OPENAI_API_KEY` | From platform.openai.com. Optional. |
| `SENTRY_DSN` | Optional. Enter to skip. |

The script auto-generates `POSTGRES_PASSWORD`, `JWT_SECRET`, and
`TENANT_TOKEN_ENCRYPTION_KEY` (32 random bytes each) — you never see
or type them.

**The env file (`/opt/nexaflow/whatsapp-api/deploy/vps/.env.production`)
is chmod 600.** Treat it like an SSH key — don't `cat` it in shared
logs, don't `scp` it elsewhere, don't paste it in chat.

---

## 4. Verify the deploy

When `bootstrap.sh` finishes, it prints the verification commands. From
your laptop:

```bash
curl -i https://api.yourdomain.com/live
# HTTP/2 200
# { "status": "alive", "timestamp": "..." }

curl -i https://api.yourdomain.com/api/v1/ready
# HTTP/2 200
# { "status": "ready", "mode": "api", "services": [
#   { "name": "postgres", "ok": true },
#   { "name": "redis",    "ok": true }
# ] }
```

If `/api/v1/ready` returns 503, SSH back in and tail logs:

```bash
cd /opt/nexaflow/whatsapp-api/deploy/vps
docker compose -f docker-compose.prod.yml logs --tail=50 api worker postgres redis
```

---

## 5. Hook up Vercel

In the Vercel dashboard:

1. Open the `whatsapp-api-ruddy-alpha` project
2. **Settings → Environment Variables**
3. Add `NEXT_PUBLIC_API_URL` = `https://api.yourdomain.com` for **all
   three** environments (Production, Preview, Development)
4. **Deployments → ⋯ → Redeploy** — env-var changes alone don't rebuild;
   Next has to bake the new value into the JS bundle.

After the Vercel redeploy finishes, hard-reload the login page
(Cmd+Shift+R). The "Can't reach the server" error will be gone.

---

## 6. Common operations

Everything below runs from `cd /opt/nexaflow/whatsapp-api/deploy/vps`
on the VPS.

### Tail logs

```bash
docker compose -f docker-compose.prod.yml logs -f api worker
```

### Update to latest code

```bash
git -C /opt/nexaflow/whatsapp-api pull origin codex/nexaflow-v2-platform
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Or rerun the bootstrap script — it does the same thing and also
re-runs `migrate deploy`:

```bash
bash /opt/nexaflow/whatsapp-api/deploy/vps/bootstrap.sh
```

### Run a migration after a schema change

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm api \
  node node_modules/prisma/build/index.js migrate deploy \
  --schema packages/db/prisma/schema.prisma
```

### psql shell into Postgres

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U nexaflow -d nexaflow
```

### Backup Postgres

```bash
mkdir -p /opt/nexaflow/backups
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U nexaflow -d nexaflow --no-owner --no-acl \
  | gzip > /opt/nexaflow/backups/nexaflow-$(date +%Y%m%d-%H%M%S).sql.gz
```

Add to root's crontab for daily 03:00 backups:

```cron
0 3 * * * cd /opt/nexaflow/whatsapp-api/deploy/vps && docker compose -f docker-compose.prod.yml exec -T postgres pg_dump -U nexaflow -d nexaflow --no-owner --no-acl | gzip > /opt/nexaflow/backups/nexaflow-$(date +\%Y\%m\%d).sql.gz
```

Keep at least 7 daily backups + ship them off-host (Hostinger object
storage, S3, Backblaze B2) — the backups directory is on the same disk
as the database, so a disk failure loses both.

### Restart a single service

```bash
docker compose -f docker-compose.prod.yml restart api
docker compose -f docker-compose.prod.yml restart worker
```

### Tail Caddy access logs

```bash
docker compose -f docker-compose.prod.yml logs -f caddy
```

### Rotate `JWT_SECRET` or `TENANT_TOKEN_ENCRYPTION_KEY`

**Don't.** Rotating `JWT_SECRET` invalidates every user session
(everyone has to log back in). Rotating `TENANT_TOKEN_ENCRYPTION_KEY`
makes every encrypted WABA token unreadable (every tenant has to
re-connect Meta).

If you really need to (key compromise):

1. Operator notice to all tenants 48 hours in advance.
2. Edit `.env.production` with the new key.
3. `docker compose -f docker-compose.prod.yml up -d` to restart.
4. After: every tenant re-connects Meta, every user re-logs.

---

## 7. Troubleshooting

### `https://api.yourdomain.com` returns "connection refused"

Caddy hasn't gotten an SSL cert yet. Check:

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i "obtain\|error"
```

Most common cause: DNS doesn't resolve yet. `dig +short api.yourdomain.com`
must return your VPS IP **from the VPS itself** (Let's Encrypt resolves
from external servers; local DNS is irrelevant). Wait, then:

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

### Login page still shows "Can't reach the server"

1. Hard-reload (Cmd+Shift+R) — the old JS bundle is cached.
2. Open browser devtools → Network. The failing request reveals the URL
   the bundle is calling. If it's still `localhost`, the Vercel
   redeploy didn't run.
3. `curl https://api.yourdomain.com/api/v1/ready` from your terminal.
   503 = DB/Redis broken; check logs.
4. CORS preflight: `curl -I -H "Origin: https://whatsapp-api-ruddy-alpha.vercel.app" https://api.yourdomain.com/api/v1/auth/login` — if the response doesn't include `Access-Control-Allow-Origin`, the `WEB_URL` env in `.env.production` is wrong. Fix + restart api.

### Out of disk

`df -h /` — if the Docker volume directory (`/var/lib/docker/volumes`)
is filling up, Postgres has the most data. Vacuum + reindex:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U nexaflow -d nexaflow -c "VACUUM FULL;"
```

Or extend the volume (Hostinger has resize-disk in hPanel).

### Worker stops processing jobs

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 worker
```

Most common cause: Redis ran out of memory and the noeviction policy
errored on enqueue. Bump Redis memory:

```yaml
# In docker-compose.prod.yml, redis service:
command: ["redis-server", "--maxmemory", "1gb", "--maxmemory-policy", "noeviction", ...]
```

---

## 8. Architecture notes

### Single host, no HA — what fails when something breaks?

| Failure | Blast radius | Recovery |
|---|---|---|
| Postgres crash | All writes 503 until restart (~30 s) | Compose auto-restarts |
| Redis crash | Workers pause; HTTP keeps serving cached auth (60 s TTL) | Compose auto-restarts; queued jobs survive (AOF) |
| API container crash | 502 for ~10 s until health check + restart | Compose auto-restarts |
| Worker container crash | Campaigns pause; HTTP unaffected | Compose auto-restarts |
| Caddy crash | Site down (cert state preserved) | Compose auto-restarts |
| VPS reboot | All of the above, ~60 s total | All restart on boot (`restart: unless-stopped`) |
| Disk full | Postgres stops accepting writes | Extend disk + `VACUUM FULL` |
| VPS hardware failure | **Total outage until restore** | Restore from off-host backup |

For HA, you'd split DB + Redis off-host (managed Postgres + managed
Redis), and run 2+ VPS behind a load balancer. The compose file is
structured so that change is mechanical, not architectural.

### Why GHCR image instead of building on the VPS

- The VPS doesn't need Node / npm / TypeScript / Prisma installed.
- Builds happen once, in CI, with reproducible inputs.
- A fresh VPS pulls a ~250 MB image instead of compiling for 5 minutes.
- Rollback is `IMAGE_TAG=sha-abc1234` in `.env.production` + restart.

### Why Caddy instead of Nginx

- Auto-SSL is built in. No certbot cron, no manual renewals.
- HTTP/3 (QUIC) works out of the box.
- Config is shorter than the equivalent nginx + certbot setup.
- Slightly slower than nginx on raw bytes; doesn't matter at this scale.

### Why a single `internal` Docker network

Only Caddy publishes ports to the host. The API, workers, Postgres,
and Redis communicate over the internal network — `postgres` resolves
to the Postgres container's IP, etc. Nothing except Caddy is reachable
from the internet, even by IP, even if you forget to lock down UFW.
Defense in depth.
