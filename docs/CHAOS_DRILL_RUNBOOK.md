# Chaos drill runbook (T-124)

Quarterly exercise: prove the platform survives single-node failures
without operator intervention. Run in staging only. **Never run in
prod.** Any test that would page an oncall who isn't aware of the drill
is out of scope.

The infrastructure was designed for these failures already:
- Workers are BullMQ jobs with retry + DLQ (Phase A).
- Redis is a hot path with hash-tagged keys + fail-open throttle (Phase B).
- Postgres reads route to a replica behind `prismaRead` (Phase C).
- Sentry + Prometheus give us the post-mortem signal (Phase E).

The drill is the proof.

---

## Scenarios

### 1. Kill one worker process

**Setup**: staging is running 3 worker replicas (`APP_MODE=worker`).

**Action**: `kubectl delete pod nexaflow-worker-<random>` (or the
docker-compose equivalent). Don't drain — yank it.

**Expected**:
- BullMQ detects the dead worker via Redis lease expiry within
  `lockDuration` (30s default).
- In-flight jobs get retried on the surviving workers — no rows lost.
- `/api/v1/admin/queues` shows a brief spike in `active`, then
  normalisation within 60s.
- No 5xx on the API surface — the kill is invisible to clients.

**Page if**: queue depth grows monotonically for > 5 minutes.

### 2. Kill one Postgres replica

**Setup**: primary + 2 read replicas. App is configured with
`DATABASE_URL` (primary) and `DATABASE_URL_READ` (replica pool).

**Action**: stop one replica's Postgres container.

**Expected**:
- The replica pool router (PgBouncer or HAProxy) drops the dead node
  out of rotation within 10s.
- Read traffic continues against the surviving replica.
- Inbox p95 stays under target (some bump is OK).
- The Sentry-captured errors from the in-flight queries that landed
  mid-failover are bounded (< 10 total per 1k requests).

**Page if**: `prismaRead` starts erroring for > 60s or the surviving
replica's CPU pegs at 100%.

### 3. Kill one Redis shard

**Setup**: Redis Cluster with 3 masters + 3 replicas.

**Action**: stop one master container.

**Expected**:
- The cluster promotes the replica within 5s.
- BullMQ workers reconnect transparently — jobs may stall briefly
  but don't fail.
- Hash-tagged keys (T-092) keep send-throttle + auth-context + login-
  fail buckets coherent — each shard's failover only affects its own
  key range.
- Realtime sockets (`@socket.io/redis-adapter`) drop fan-out for a few
  seconds while the adapter reconnects; clients see no message loss
  because the next inbound fetch pulls the missed ones from Postgres.

**Page if**: BullMQ stays disconnected for > 60s, or socket fan-out
doesn't recover after the cluster has stabilised.

### 4. Saturate Anthropic with 429s

**Setup**: stub Anthropic responses to return 429 for 5 minutes.

**Expected**:
- `callLlmJson()` surfaces the 429 to callers; routes return 503.
- `assertCanAffordAi` short-circuits before the call, so no credits
  burn on the rate-limited window.
- Sentry sees one error per failed call (not one per retry).
- The campaign autopilot worker re-queues with backoff.

**Page if**: error rate > 10% for > 10 minutes after the stub is
removed (would indicate a stuck retry loop).

### 5. Cold-cache restart

**Setup**: kill the API + Redis at the same time, then bring both
back up.

**Expected**:
- All caches start empty.
- The first inbox-list request from each tenant pays the cache miss
  (~45ms vs the warm ~5ms — see T-090 numbers).
- Auth context refills lazily — no thundering herd because the cache
  is per-user, not per-tenant.

**Page if**: Postgres connection count exceeds `MAX_CLIENT_CONN` on
PgBouncer during the warm-up, indicating the connection budget needs
expansion.

---

## How to run

1. Announce on `#staging-ops` 30 minutes ahead.
2. Pin the Grafana dashboard URL (the one fed by `/api/v1/admin/metrics`).
3. Run scenarios in order; wait for normalisation between each.
4. Capture screenshots of the relevant graphs.
5. File a post-mortem doc under `docs/postmortems/YYYY-MM-DD-chaos.md`
   regardless of outcome. The drill failing is data; so is the drill
   passing — both inform the next quarter's plan.

---

## What's NOT covered (yet)

- Multi-region failover — single-region today; this drill is single-AZ.
- DB primary failure — handled by managed Postgres failover; out of
  app-layer scope but covered by the infra runbook.
- Meta API outage — already handled in code (campaign pause, retry
  queue); doesn't need a chaos drill until we add traffic-shaping logic.
