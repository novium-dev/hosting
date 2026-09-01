#!/bin/sh
set -eu

APP_NAME="${VITE_APP_NAME:-Hephaestus}"
ESCAPED_APP_NAME=$(printf '%s' "$APP_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')

BEHIND_CLOUDFLARE="${VITE_BEHIND_CLOUDFLARE:-false}"
ESCAPED_BEHIND_CLOUDFLARE=$(printf '%s' "$BEHIND_CLOUDFLARE" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/runtime-config.js <<CONFIG
window.__RUNTIME_CONFIG__ = { APP_NAME: "${ESCAPED_APP_NAME}", BEHIND_CLOUDFLARE: "${ESCAPED_BEHIND_CLOUDFLARE}" };
CONFIG
