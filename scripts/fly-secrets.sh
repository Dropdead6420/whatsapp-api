#!/usr/bin/env bash
# Fly.io secrets helper for nexaflow-api.
#
# Run AFTER you've created the app + attached Postgres + Redis (steps
# 1-5 in the fly.toml header comment). Sets the secrets the API needs
# to boot in production.
#
# Usage:
#   bash scripts/fly-secrets.sh
#
# This script prompts for each value. To rerun a single key:
#   fly secrets set --app nexaflow-api KEY=value
#
# DO NOT commit real secret values. This script generates random ones
# for JWT_SECRET and TENANT_TOKEN_ENCRYPTION_KEY when you don't paste a
# value — those should be at least 32 random bytes.

set -euo pipefail

APP="${FLY_APP:-nexaflow-api}"

if ! command -v fly >/dev/null 2>&1; then
  echo "fly CLI not found. Install: curl -L https://fly.io/install.sh | sh"
  exit 1
fi

# --- helpers -----------------------------------------------------------------
prompt() {
  # prompt LABEL VAR_NAME [DEFAULT]
  local label="$1"
  local var="$2"
  local default="${3:-}"
  local value
  if [ -n "$default" ]; then
    read -r -p "$label [$default]: " value
    value="${value:-$default}"
  else
    read -r -p "$label: " value
  fi
  printf -v "$var" '%s' "$value"
}

generate_secret() {
  # 32 random bytes, base64-encoded — strong enough for HMAC / AES key derivation
  openssl rand -base64 32
}

echo "Setting Fly secrets for app: $APP"
echo "If you press Enter without typing anything, a strong random value is generated"
echo "for JWT_SECRET and TENANT_TOKEN_ENCRYPTION_KEY. Other prompts have no default."
echo ""

# --- required core secrets --------------------------------------------------
JWT_SECRET=""
read -r -p "JWT_SECRET (Enter to generate): " JWT_SECRET
[ -z "$JWT_SECRET" ] && JWT_SECRET="$(generate_secret)" && echo "  generated."

TENANT_TOKEN_ENCRYPTION_KEY=""
read -r -p "TENANT_TOKEN_ENCRYPTION_KEY (Enter to generate): " TENANT_TOKEN_ENCRYPTION_KEY
[ -z "$TENANT_TOKEN_ENCRYPTION_KEY" ] && TENANT_TOKEN_ENCRYPTION_KEY="$(generate_secret)" && echo "  generated."

prompt "META_APP_ID (from developers.facebook.com)" META_APP_ID
prompt "META_APP_SECRET" META_APP_SECRET
prompt "WHATSAPP_WEBHOOK_TOKEN (any random string Meta will verify)" WHATSAPP_WEBHOOK_TOKEN

# --- optional but recommended ------------------------------------------------
prompt "OPENAI_API_KEY (for KB embeddings; blank = use local hash fallback)" OPENAI_API_KEY ""
prompt "ANTHROPIC_API_KEY (for AI features; blank = features disabled)" ANTHROPIC_API_KEY ""
prompt "SENTRY_DSN (blank = no error reporting)" SENTRY_DSN ""

echo ""
echo "Setting secrets on $APP..."

# Build args array so blanks don't get pushed as empty strings.
ARGS=(
  "JWT_SECRET=$JWT_SECRET"
  "TENANT_TOKEN_ENCRYPTION_KEY=$TENANT_TOKEN_ENCRYPTION_KEY"
  "META_APP_ID=$META_APP_ID"
  "META_APP_SECRET=$META_APP_SECRET"
  "WHATSAPP_WEBHOOK_TOKEN=$WHATSAPP_WEBHOOK_TOKEN"
)
[ -n "$OPENAI_API_KEY" ]    && ARGS+=("OPENAI_API_KEY=$OPENAI_API_KEY")
[ -n "$ANTHROPIC_API_KEY" ] && ARGS+=("ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY")
[ -n "$SENTRY_DSN" ]        && ARGS+=("SENTRY_DSN=$SENTRY_DSN")

fly secrets set --app "$APP" "${ARGS[@]}"

echo ""
echo "Done. Verify with: fly secrets list --app $APP"
echo "Deploy with:       fly deploy --remote-only"
