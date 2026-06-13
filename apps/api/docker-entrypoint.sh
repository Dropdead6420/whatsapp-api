#!/bin/sh
# Container entrypoint for the NexaFlow API / worker image.
#
# Applies any pending database migrations before the process starts serving.
# Without this, shipping a new image whose Prisma client knows about new
# columns/tables — while the database is still on the old schema — makes every
# handler that touches the new shape throw a runtime error (HTTP 500). Running
# `prisma migrate deploy` on boot closes that gap:
#   - it is idempotent (only applies migrations not yet in _prisma_migrations);
#   - it takes a Postgres advisory lock, so the api and worker containers
#     starting together serialize safely (one waits for the other);
#   - it is a no-op (fast) once the database is up to date.
#
# Best-effort by design: if the database is unreachable at boot we log loudly
# and still start the app rather than crash-loop — Prisma then surfaces
# per-request errors exactly as it did before, so this never reduces
# availability below the previous behavior.

echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
if npx prisma migrate deploy --schema packages/db/prisma/schema.prisma; then
  echo "[entrypoint] migrations up to date."
else
  echo "[entrypoint] WARNING: 'prisma migrate deploy' failed; starting the app anyway."
fi

# exec so the Node process becomes PID 1 and receives SIGTERM/SIGINT directly,
# preserving the app's graceful-shutdown handler.
exec npx tsx apps/api/src/index.ts
