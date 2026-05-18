# Phase D — Storage partitioning + cold path

Companion to `docs/SCALE_PLAN_1M.md` §"Phase D". This file is the
implementation-ready plan for the four storage tasks that have to land
before the platform can sustain 1M users without query degradation.

Everything in this doc is **plan-only**. Each task lists the migration
sequence, the operational risks, and the rollout order so we can sequence
the work safely in production. T-113 (CDN headers) shipped alongside this
plan; T-110/T-111/T-112/T-114 each get their own commit when the prod
window opens.

The repo currently uses `prisma db push`. Before any of T-110/T-111/T-112
can ship, we need to migrate to `prisma migrate dev` / `migrate deploy`
so the partitioning DDL becomes a tracked, replayable change. That
migration-mode swap is **a separate, small task** that should land first.

---

## T-110 — Monthly partitioning of hot tables

### Tables in scope

| Table | Growth rate (target) | Why partition |
|---|---|---|
| `Message` | ~500/s sustained, billions/year at 1M users | Inbox queries always filter by tenant + recent window. Without partitions, the index alone won't keep up. |
| `AuditLog` | every mutation × every tenant | SuperAdmin scans by date range routinely. |
| `AiUsage` | every LLM call × every feature | Used for billing reconciliation — heavy aggregate queries by month. |
| `WebhookLog` | every retry attempt × every subscription | Retention pressure; older logs should evaporate cheaply. |

### Partitioning scheme

`PARTITION BY RANGE (createdAt)` with one child partition per UTC month.
Pattern:

```sql
-- One-time setup per table, replace <table> + <pk> as needed.
ALTER TABLE "<table>" RENAME TO "<table>_legacy";

CREATE TABLE "<table>" (LIKE "<table>_legacy" INCLUDING ALL)
  PARTITION BY RANGE ("createdAt");

-- Backfill: copy old rows in batches so we don't hold a single long
-- transaction on a table that may already be tens of millions of rows.
-- Use a server-side WITH MOVE pattern or pg_partman.

CREATE TABLE "<table>_2026_05" PARTITION OF "<table>"
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "<table>_2026_06" PARTITION OF "<table>"
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
-- ... three months ahead, always.

DROP TABLE "<table>_legacy";
```

### Why monthly (not weekly / daily)

- Average partition count stays manageable (~36 child partitions for a 3-year
  retention window — Postgres pruning is happy).
- Inbox queries on the last 30 days hit exactly one or two partitions.
- Cold-storage archival (T-111) operates on whole partitions: drop one,
  the OS reclaims its disk.

### Partition-maintenance worker

A daily BullMQ scheduled job (uses the same `lib/queue.ts` pattern that
shipped in T-080..T-086) does two things on each tick:

1. Make sure `current_month + 3` partitions exist for each partitioned
   table; create any missing ones.
2. Detach + archive partitions older than the retention horizon (T-111).

Code skeleton (drop in `apps/api/src/services/partitionMaintenance.service.ts`
when the migration mode swap is done):

```ts
const TABLES = ["Message", "AuditLog", "AiUsage", "WebhookLog"];

async function ensureFuturePartitions() {
  const now = new Date();
  for (let offset = 0; offset <= 3; offset++) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const next  = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    for (const t of TABLES) {
      const name = `${t}_${month.toISOString().slice(0, 7).replace("-", "_")}`;
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "${t}"
         FOR VALUES FROM ('${month.toISOString()}') TO ('${next.toISOString()}');`,
      );
    }
  }
}
```

### Rollout order (production)

1. Stop writes (maintenance window: ~30 minutes for the four tables).
2. Snapshot the DB.
3. Run the rename + create + backfill block per table, smallest first
   (`WebhookLog` → `AiUsage` → `AuditLog` → `Message`).
4. Resume writes.
5. Start the maintenance worker on the next deploy.

### Acceptance

- The k6 `inbox-poll` scenario from `apps/load/` retains its p95 under
  the same target after partitioning, and EXPLAIN on the inbox query
  shows partition pruning to ≤ 2 partitions.

---

## T-111 — Cold-storage archival for messages > 30 days

### Strategy

Two-tier storage:

- **Hot**: the live partitioned `Message` table — last 90 days.
- **Cold**: detached partitions written to S3 as Parquet, OR a replica
  table `Message_archive` on cheaper Postgres storage. Decision deferred
  until we know whether SuperAdmin needs historical scans.

### Worker

Same partition-maintenance worker (T-110):

1. Find partitions where `month_end < now - 90d` and not yet archived.
2. `ALTER TABLE ... DETACH PARTITION CONCURRENTLY` to remove from the
   parent.
3. Either `pg_dump | aws s3 cp` for cold export, or `INSERT INTO
   Message_archive SELECT *` for in-DB archival, then `DROP TABLE`.
4. Record the archive in a new `MessageArchive` index row so admin queries
   can find it.

### Read path

`MessageArchive.path` is opaque storage. Routine inbox queries never touch
it. SuperAdmin "show me messages from 2024" hits a new endpoint that
re-attaches the partition temporarily OR streams from S3.

### Risk

Once detached, a partition is gone from the live tenant's view. Any tenant
that wants their old data back triggers an explicit re-attach (slow but
correct).

---

## T-112 — OpenSearch full-text index for contact + message

### Why not Postgres FTS

Postgres `tsvector` handles English text fine, but:

- Per-tenant lexeme dictionaries don't scale beyond a few tenants.
- Cross-column ranking (contact name + last-message body + tags) needs
  `GIN` indexes on every searchable column.
- Multi-language tenants (Hindi, Spanish, Arabic) need different
  analyzers — Postgres can do it but the operator cost is high.

### Shape

- Add `opensearch` service to `docker-compose.yml` (alongside
  `elasticsearch` which is already there — the two are wire-compatible;
  consolidate to one).
- New `services/search.service.ts` wraps the OpenSearch client.
- Two index pipelines:
  - `contacts` — indexed on `phoneNumber`, `name`, `tags`, `customFields`.
    Indexed via a Prisma middleware that mirrors every Contact write.
  - `messages` — indexed on `content`, `direction`, `createdAt`, scoped by
    `tenantId`. Same mirror pattern.
- Routes that currently do `WHERE name CONTAINS x` swap to the search
  service; results are still permission-filtered server-side.

### Risk

OpenSearch + Postgres can drift. Two mitigations:

1. The mirror writes are best-effort with a retry queue (already have
   BullMQ infra from Phase A).
2. A nightly reconciliation job re-indexes the previous day's rows so
   any dropped writes self-heal.

---

## T-113 — CDN cache headers ✅ shipped

`apps/web/next.config.js` declares cache headers for `/_next/static`,
`/_next/image`, the marketing root, and public image/text files. The
dashboard pages stay uncached — they're per-user.

The CDN itself (Cloudflare / Vercel) is operationally configured:

- Origin: the standalone Next.js server in the Docker image.
- Cache key includes the host header so white-label domains stay isolated.
- Purge on deploy: `cf cli purge --tag ${git_sha}` in the deploy
  workflow (TODO once a CDN account is provisioned).

---

## T-114 — Wallet sharding strategy (plan-only)

### Trigger

Only adopt sharding if the Phase C load test shows contention on the
`Wallet.balance` cached column at ≥ 1,000 concurrent debits per second
on a single tenant. Until then, the append-only `Transaction` ledger
plus `Wallet.balance` cache is sufficient.

### Strategy if needed

The hot row is `Wallet` for one tenant. Two options:

1. **Vertical: per-tenant ledger shards.** Each tenant's `Transaction`
   rows live on a hash partition; `Wallet.balance` becomes a sum
   maintained by a Redis counter with periodic reconciliation against
   the partition. Pros: keeps the ledger atomic per tenant. Cons:
   cross-tenant analytics has to fan out.

2. **Horizontal: append-only with eventual sum.** Drop
   `Wallet.balance`; compute balance on read by summing the ledger
   (cached in Redis with a short TTL). Cons: read latency. Pros:
   writes are append-only and never contend.

Option 2 is the simpler change and matches how Stripe / Adyen handle
high-write ledgers. Option 1 is a future move if read latency dominates.

### What blocks it today

Nothing — we just don't need it yet. The Phase A/B work already
de-risked the path: Redis Cluster is wired (T-092), so a Redis-backed
balance cache is one PR away.

---

## Order of operations for the four tasks

1. **Migration-mode swap** — switch from `db push` to `prisma migrate`.
   Small, low-risk, but required before T-110 can land.
2. **T-110** — partition the four hot tables. Biggest change.
3. **T-111** — turn on archival once the partitions are stable.
4. **T-112** — OpenSearch. Can land in parallel with T-111 — no DB
   coupling.
5. **T-114** — only after the Phase C load test result tells us
   whether wallet contention is real.
