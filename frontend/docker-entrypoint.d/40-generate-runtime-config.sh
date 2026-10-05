#!/bin/sh
set -eu

escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

APP_NAME="${VITE_APP_NAME:-Hephaestus}"
ESCAPED_APP_NAME=$(escape "$APP_NAME")

LOGO_URL="${VITE_LOGO_URL:-}"
ESCAPED_LOGO_URL=$(escape "$LOGO_URL")

TERMS_URL="${VITE_TERMS_URL:-}"
ESCAPED_TERMS_URL=$(escape "$TERMS_URL")

PRIVACY_URL="${VITE_PRIVACY_URL:-}"
ESCAPED_PRIVACY_URL=$(escape "$PRIVACY_URL")

IMPRINT_URL="${VITE_IMPRINT_URL:-}"
ESCAPED_IMPRINT_URL=$(escape "$IMPRINT_URL")

BEHIND_CLOUDFLARE="${VITE_BEHIND_CLOUDFLARE:-false}"
ESCAPED_BEHIND_CLOUDFLARE=$(escape "$BEHIND_CLOUDFLARE")

cat > /usr/share/nginx/html/runtime-config.js <<CONFIG
window.__RUNTIME_CONFIG__ = { APP_NAME: "${ESCAPED_APP_NAME}", LOGO_URL: "${ESCAPED_LOGO_URL}", TERMS_URL: "${ESCAPED_TERMS_URL}", PRIVACY_URL: "${ESCAPED_PRIVACY_URL}", IMPRINT_URL: "${ESCAPED_IMPRINT_URL}", BEHIND_CLOUDFLARE: "${ESCAPED_BEHIND_CLOUDFLARE}" };
CONFIG

html_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

sed_escape() {
  printf '%s' "$1" | sed 's/[\\&|]/\\&/g'
}

HTML_APP_NAME=$(sed_escape "$(html_escape "$APP_NAME")")
HTML_DESCRIPTION=$(sed_escape "$(html_escape "$APP_NAME game panel for managing your servers.")")

sed -i \
  -e "s|<title>[^<]*</title>|<title>${HTML_APP_NAME}</title>|" \
  -e "/property=\"og:\(site_name\|title\)\"/ s|content=\"[^\"]*\"|content=\"${HTML_APP_NAME}\"|" \
  -e "/\(name=\"description\"\|property=\"og:description\"\)/ s|content=\"[^\"]*\"|content=\"${HTML_DESCRIPTION}\"|" \
  /usr/share/nginx/html/index.html
