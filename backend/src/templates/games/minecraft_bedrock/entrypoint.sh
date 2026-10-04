#!/bin/bash
set -euo pipefail
shopt -s nullglob

cd /work
mkdir -p .tmp

for entry in /opt/bedrock/*; do
  name="${entry##*/}"
  case "$name" in
    server.properties)
      touch server.properties
      while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue
        grep -q "^${line%%=*}=" server.properties || printf '%s\n' "$line" >> server.properties
      done < "$entry"
      ;;
    permissions.json | allowlist.json | packetlimitconfig.json | profanity_filter.wlist)
      [[ -e "$name" ]] || cp "$entry" "$name"
      ;;
    *)
      if [[ ! -e "$name" || -L "$name" ]]; then
        ln -sfn "$entry" "$name"
      fi
      ;;
  esac
done

export LD_LIBRARY_PATH=/opt/bedrock
echo "### Starting Bedrock Dedicated Server..."
exec ./bedrock_server
