#!/bin/sh
set -eu

APP_NAME="${VITE_APP_NAME:-Hephaestus}"
ESCAPED_APP_NAME=$(printf '%s' "$APP_NAME" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/runtime-config.js <<EOF
window.__RUNTIME_CONFIG__ = { APP_NAME: "${ESCAPED_APP_NAME}" };
EOF
