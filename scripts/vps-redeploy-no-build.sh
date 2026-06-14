#!/usr/bin/env bash
set -euo pipefail

VPS_HOST="${NEXAFLOW_VPS_HOST:-root@187.127.172.138}"
APP_DIR="${NEXAFLOW_VPS_APP_DIR:-/opt/medscub}"

echo "Redeploying NexaFlow Docker services on ${VPS_HOST}:${APP_DIR}"

ssh -o BatchMode=yes -o ConnectTimeout=12 "${VPS_HOST}" "APP_DIR='${APP_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP_DIR"

echo "Current containers:"
docker ps --format "table {{.Names}}\t{{.Status}}" | sed -n '1,20p'

echo
echo "Recreating app services from existing images..."
docker compose -f docker-compose.live.yml -f docker-compose.ip-only.yml up -d --no-build --force-recreate api worker web caddy

echo
echo "Waiting for medscub-api health..."
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' medscub-api 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 2
done

api_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' medscub-api)"
web_status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' medscub-web)"

echo "medscub-api: $api_status"
echo "medscub-web: $web_status"

if [ "$api_status" != "healthy" ]; then
  echo "medscub-api is not healthy" >&2
  docker logs --tail 120 medscub-api >&2
  exit 1
fi

if [ "$web_status" != "healthy" ]; then
  echo "medscub-web is not healthy" >&2
  docker logs --tail 120 medscub-web >&2
  exit 1
fi

echo
echo "Recent API errors:"
docker logs --since 3m medscub-api 2>&1 | grep -E "INTERNAL_SERVER_ERROR|PrismaClientKnownRequestError|does not exist|Unhandled|ERROR" || true

echo
echo "Final containers:"
docker ps --format "table {{.Names}}\t{{.Status}}" | sed -n '1,20p'
REMOTE

echo
echo "Running local VPS verification..."
npm run vps:verify
