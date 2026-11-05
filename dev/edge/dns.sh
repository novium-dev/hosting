#!/usr/bin/env bash
set -euo pipefail

api="${CHALLTESTSRV_API:-http://localhost:8055}"

usage() {
    echo "usage: $0 txt <name> <value> | cname <name> <target> | clear-txt <name> | clear-cname <name>" >&2
    exit 1
}

[ $# -ge 2 ] || usage

case "$1" in
    txt)
        [ $# -eq 3 ] || usage
        curl -sf -X POST "$api/set-txt" -d "{\"host\":\"$2.\",\"value\":\"$3\"}"
        ;;
    cname)
        [ $# -eq 3 ] || usage
        curl -sf -X POST "$api/set-cname" -d "{\"host\":\"$2.\",\"target\":\"$3.\"}"
        ;;
    clear-txt)
        curl -sf -X POST "$api/clear-txt" -d "{\"host\":\"$2.\"}"
        ;;
    clear-cname)
        curl -sf -X POST "$api/clear-cname" -d "{\"host\":\"$2.\"}"
        ;;
    *)
        usage
        ;;
esac

echo "ok"
