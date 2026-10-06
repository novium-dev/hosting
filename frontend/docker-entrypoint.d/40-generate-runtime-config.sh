#!/bin/sh
set -eu

TEMPLATE=/usr/share/nginx/index.html.template
INDEX_HTML=/usr/share/nginx/html/index.html

VITE_APP_NAME="${VITE_APP_NAME:-Hephaestus}"

json_string() {
  printf '"%s"' "$(printf '%s' "$1" | tr -d '\r\n' | sed 's/\\/\\\\/g; s/"/\\"/g; s/</\\u003c/g')"
}

html_escape() {
  printf '%s' "$1" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'
}

sed_escape() {
  printf '%s' "$1" | sed 's/[\\&|]/\\&/g'
}

CONFIG=""
for name in $(env | sed -n 's/^\(VITE_[A-Za-z0-9_]*\)=.*/\1/p'); do
  eval "value=\${$name}"
  CONFIG="${CONFIG}${CONFIG:+,}\"${name}\":$(json_string "$value")"
done

sed \
  -e "s|__RUNTIME_CONFIG_JSON__|$(sed_escape "{${CONFIG}}")|" \
  -e "s|__APP_NAME__|$(sed_escape "$(html_escape "$VITE_APP_NAME")")|g" \
  "$TEMPLATE" > "$INDEX_HTML"
