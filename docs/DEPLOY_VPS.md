# Deploying NexaFlow on a Hostinger VPS (all-in-one)

Everything runs on one VPS. No Vercel. No managed Postgres. No managed Redis.

| Layer | Where | How |
|---|---|---|
| Next.js web | VPS Docker | Built locally so `NEXT_PUBLIC_API_URL` bakes in correctly |
| Express API + Socket.io | VPS Docker | `ghcr.io/ishitapriya/nexaflow-api` pulled from GHCR |
| 8 BullMQ workers | VPS Docker | Same image, `APP_MODE=worker` |
| Postgres 16 | VPS Docker | Volume-persisted |
| Redis 7 | VPS Docker | Volume-persisted, AOF on |
| Reverse proxy + auto-SSL | VPS Docker | Caddy 2 serves both domains, Let's Encrypt |

The deploy is **idempotent**: re-running `bootstrap.sh` pulls latest code,
rebuilds the web image, restarts the stack, and keeps your env file intact.

---

## 0. Prerequisites

| | Need it for |
|---|---|
| **Hostinger VPS with root SSH access (or browser terminal)** | Everything below |
| **An apex domain you control** (e.g. `medscrub.in`) | Caddy auto-SSL on both web + API |
| **5–10 minutes** | The script asks ~10 questions |

VM sizing — the all-in-one stack runs on:

| Spec | Suits |
|---|---|
| 2 vCPU / 4 GB RAM / 50 GB SSD | Dev + first ~10 paying tenants |
| 4 vCPU / 8 GB RAM / 100 GB SSD | Production up to ~100 tenants |
| 8 vCPU / 16 GB RAM / 200 GB SSD | Production up to ~1000 tenants; consider splitting DB off-host beyond that |

Hostinger's KVM-2 (2 vCPU / 8 GB) is the sweet spot for getting started.

---

## 1. DNS records (Cloudflare)

You're using Cloudflare as the DNS provider for `medscrub.in`. Add or
update these records so both domains point at the VPS:

| Type | Name | Value | Proxy | TTL |
|---|---|---|---|---|
| **A** | `@` (apex) | `187.127.172.138` | **DNS only** (gray) | Auto |
| **A** | `www` | `187.127.172.138` | **DNS only** (gray) | Auto |
| **A** | `api` | `187.127.172.138` | **DNS only** (gray) | Auto |
| *CAA* | `@` | `0 issue "letsencrypt.org"` | — | Auto |

**All records pointing at the VPS must be "DNS only" (gray cloud).** The
orange "Proxied" cloud intercepts HTTPS and breaks Caddy's Let's Encrypt
HTTP-01 challenge — your sites won't get certs and will show SSL errors.

If you previously had Vercel records (`216.150.x.x` or `cname.vercel-dns.com`),
**replace them** with the rows above. Delete the Vercel records — they
just confuse browsers if both are set.

Verify from your laptop after saving:

```bash
dig +short medscrub.in api.medscrub.in www.medscrub.in
# All three should return 187.127.172.138
```

DNS propagation is usually 30 seconds via Cloudflare. Don't continue
until all three resolve to your VPS.

---

## 2. Open the VPS terminal

Easiest: Hostinger hPanel → VPS → click your server → **Browser Terminal**
(or "Console" / "noVNC Terminal" depending on the plan). You're already
root in the browser, no SSH client needed.

Or from your Mac (after rotating the password you previously shared):

```bash
ssh root@187.127.172.138
```

---

## 3. Run the bootstrap

One command. It installs Docker, clones the repo, prompts for env values,
pulls the API image, builds the web image with your domain baked in,
runs migrations, starts the stack.

```bash
curl -fsSL https://raw.githubusercontent.com/IshitaPriya/whatsapp-api/codex/nexaflow-v2-platform/deploy/vps/bootstrap.sh | bash
```

The script will ask:

| Prompt | What to enter |
|---|---|
| `Web domain` | `medscrub.in` |
| `API domain` | press **Enter** (default `api.medscrub.in`) |
| `META_APP_ID` | from developers.facebook.com, or **Enter** to skip with `placeholder` |
| `META_APP_SECRET` | same |
| `WHATSAPP_WEBHOOK_TOKEN` | press **Enter** (auto-generates) |
| `META_PHONE_NUMBER_ID` / `META_BUSINESS_ACCOUNT_ID` | **Enter** to skip — fill via dashboard later |
| `ANTHROPIC_API_KEY` | from console.anthropic.com, or **Enter** to skip (AI features disabled) |
| `OPENAI_API_KEY` | optional |
| `SENTRY_DSN` | optional |

Three secrets are **auto-generated** as 32 random bytes each — you never
see or type them:

- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `TENANT_TOKEN_ENCRYPTION_KEY`

The env file (`/opt/nexaflow/whatsapp-api/deploy/vps/.env.production`)
is chmod 600. Treat it like an SSH key.

**First-time deploy takes 5–8 minutes** because the web image is being
built on the VPS. Subsequent runs take ~90 seconds thanks to Docker
layer caching.

---

## 4. Verify

When `bootstrap.sh` finishes it prints the verification URLs. From your
laptop:

```bash
curl -i https://medscrub.in/
# HTTP/2 200 — should redirect/render the Next.js login page

curl -i https://api.medscrub.in/api/v1/ready
# HTTP/2 200
# {"status":"ready","mode":"api","services":[
#   {"name":"postgres","ok":true},
#   {"name":"redis","ok":true}
# ]}
```

Open `https://medscrub.in/login` in a browser. The "Can't reach the
server" error is gone — login form actually talks to the API. The Vercel
deployment can be deleted.

---

## 5. Common operations

Everything below runs from `cd /opt/nexaflow/whatsapp-api/deploy/vps`
on the VPS.

### Tail logs

```bash
docker compose -f docker-compose.prod.yml logs -f api web worker caddy
```

### Update to latest code (after pushing changes to GitHub)

```bash
git -C /opt/nexaflow/whatsapp-api pull origin codex/nexaflow-v2-platform
docker compose -f docker-compose.prod.yml --env-file .env.production pull --ignore-pull-failures
docker compose -f docker-compose.prod.yml --env-file .env.production build web
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Or rerun the bootstrap script — it does the same thing and re-runs
`migrate deploy`:

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
docker compose -f docker-compose.prod.yml restart web
docker compose -f docker-compose.prod.yml restart worker
docker compose -f docker-compose.prod.yml restart caddy
```

---

## 6. Troubleshooting

### `https://medscrub.in` shows "this site can't be reached"

1. `dig +short medscrub.in` — must return `187.127.172.138`. If it
   returns a Vercel IP (`216.150.x.x` or similar), DNS still points
   at Vercel.
2. Cloudflare → DNS → make sure the apex `A` record is the VPS IP
   AND the proxy icon is gray (DNS only).
3. After fixing DNS, wait 30s then `dig` again.

### `https://api.medscrub.in` returns SSL error / `connection refused`

Same root cause 90% of the time: DNS or proxy icon. Caddy can't issue
a Let's Encrypt cert until DNS resolves and the proxy is OFF.

Check Caddy's logs:

```bash
docker compose -f docker-compose.prod.yml logs caddy | grep -i "obtain\|error" | tail -20
```

Look for `acme: error: 403` — that's the DNS/proxy problem. Fix DNS,
then:

```bash
docker compose -f docker-compose.prod.yml restart caddy
```

### Web shows "Can't reach the server" after deploy

The web image was built with the wrong `NEXT_PUBLIC_API_URL`. Force a
rebuild:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build --no-cache web
docker compose -f docker-compose.prod.yml --env-file .env.production up -d web
```

Hard-reload (Cmd+Shift+R) — the browser may have cached the old bundle.

### CORS error in browser devtools

The API's `WEB_URL` env doesn't match the origin the browser is sending.
Check:

```bash
docker compose -f docker-compose.prod.yml exec api env | grep WEB_URL
# should print WEB_URL=https://medscrub.in
```

If wrong, edit `/opt/nexaflow/whatsapp-api/deploy/vps/.env.production`
and restart:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

### Out of disk

`df -h /` — if `/var/lib/docker` is filling up, Postgres usually has
the most data. Try a vacuum + reindex:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U nexaflow -d nexaflow -c "VACUUM FULL;"
```

Or extend the volume (Hostinger has resize-disk in hPanel).

### Worker stops processing jobs

```bash
docker compose -f docker-compose.prod.yml logs --tail=200 worker
```

Most common cause: Redis ran out of memory and the `noeviction` policy
errored on enqueue. Bump Redis memory in `docker-compose.prod.yml`:

```yaml
redis:
  command: ["redis-server", "--maxmemory", "1gb", "--maxmemory-policy", "noeviction", ...]
```

---

## 7. Architecture notes

### Why the web image is built locally on the VPS (not pulled from GHCR)

Next.js inlines `NEXT_PUBLIC_*` env vars **at build time** — they become
string literals in the JavaScript bundle the browser downloads. A
pre-built GHCR image would have whatever value was set in the CI runner,
which doesn't know your domain.

Two ways to handle this:
- **Build per-tenant** (what we do) — the VPS builds with the right URL.
  First build is slow, subsequent builds are cached.
- **Make the URL runtime-configurable** — refactor the web client to
  read from a `/config.json` endpoint or `window` global. More flexible
  but adds runtime moving parts; not worth the complexity for a
  single-tenant deploy.

If you eventually move to multi-tenant white-label deployments, switch
to runtime config.

### Single host, no HA — what fails when something breaks?

| Failure | Blast radius | Recovery |
|---|---|---|
| Postgres crash | API 503s until restart (~30 s) | Compose auto-restarts |
| Redis crash | Workers pause; HTTP keeps serving cached auth (60 s TTL) | Compose auto-restarts; queued jobs survive (AOF) |
| API container crash | 502 for ~10 s until health check + restart | Compose auto-restarts |
| Web container crash | Web 502 for ~10 s; API unaffected | Compose auto-restarts |
| Worker container crash | Campaigns pause; HTTP unaffected | Compose auto-restarts |
| Caddy crash | Everything down (cert state preserved) | Compose auto-restarts |
| VPS reboot | All of the above, ~60 s total | All restart on boot (`restart: unless-stopped`) |
| Disk full | Postgres stops accepting writes | Extend disk + `VACUUM FULL` |
| VPS hardware failure | **Total outage until restore** | Restore from off-host backup |

For HA, you'd split DB + Redis off-host (managed Postgres + managed
Redis), and run 2+ VPS behind a load balancer. The compose file is
structured so that change is mechanical, not architectural.

### Why a single `internal` Docker network

Only Caddy publishes ports to the host. The API, web, workers, Postgres,
and Redis communicate over the internal Docker network. Nothing except
Caddy is reachable from the internet, even by IP, even if you forget to
lock down UFW. Defense in depth.
