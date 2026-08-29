#!/usr/bin/env bash
set -euo pipefail

# Starts the whole local stack in one terminal: the backend (just backend), the
# daemon (cargo run -p daemon) and the websocket/http proxy in front of it.
# Output from all three is prefixed and colored; Ctrl-C stops everything,
# including the binaries cargo spawns.
#
# Override the daemon checkout with DAEMON_DIR if it does not sit next to this
# repository.

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
DAEMON_DIR="${DAEMON_DIR:-$(dirname "$ROOT")/daemon}"
PROXY_DIR="$DAEMON_DIR/proxy"
PROXY_PYTHON="$PROXY_DIR/.venv/bin/python"

if [ -t 1 ]; then
    RESET=$'\033[0m'
    C_BACKEND=$'\033[36m'
    C_DAEMON=$'\033[33m'
    C_PROXY=$'\033[35m'
    C_STACK=$'\033[32m'
    C_ERROR=$'\033[31m'
else
    RESET='' C_BACKEND='' C_DAEMON='' C_PROXY='' C_STACK='' C_ERROR=''
fi

log() { printf '%s[stack]%s %s\n' "$C_STACK" "$RESET" "$*"; }
fail() { printf '%s[stack]%s %s\n' "$C_ERROR" "$RESET" "$*" >&2; exit 1; }

name_of() {
    case "$1" in
        "$BACKEND_PID") printf 'backend' ;;
        "$DAEMON_PID") printf 'daemon' ;;
        "$PROXY_PID") printf 'proxy' ;;
        *) printf 'a service' ;;
    esac
}

prefix() {
    awk -v tag="$1" -v color="$2" -v reset="$RESET" \
        '{ print color "[" tag "]" reset " " $0; fflush() }'
}

# Reads a port out of an env var or a config value, falling back to a default.
port_of() {
    local value="$1" fallback="$2" port
    port="$(printf '%s' "$value" | sed -nE 's/.*:([0-9]+).*/\1/p' | head -n1)"
    printf '%s' "${port:-$fallback}"
}

env_value() {
    local name="$1"
    if [ -n "${!name:-}" ]; then
        printf '%s' "${!name}"
    elif [ -f "$ROOT/.env" ]; then
        sed -nE "s/^${name}=(.*)$/\1/p" "$ROOT/.env" | tail -n1
    fi
}

wait_port() {
    local name="$1" port="$2" pid="$3" timeout="${4:-600}" waited=0
    log "waiting for $name on :$port"
    until (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; do
        kill -0 "$pid" 2>/dev/null || fail "$name exited before it opened :$port"
        [ "$waited" -lt "$timeout" ] || fail "$name did not open :$port within ${timeout}s"
        sleep 1
        waited=$((waited + 1))
    done
    log "$name is up on :$port"
}

kill_tree() {
    local pid="$1" child
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
        kill_tree "$child"
    done
    kill -TERM "$pid" 2>/dev/null || true
}

PIDS=""
shutting_down=0

shutdown() {
    [ "$shutting_down" -eq 0 ] || return 0
    shutting_down=1
    trap '' INT TERM
    log "stopping"
    local pid
    for pid in $PIDS; do
        kill_tree "$pid"
    done
    sleep 2
    for pid in $PIDS; do
        kill -KILL "$pid" 2>/dev/null || true
    done
}
trap shutdown INT TERM EXIT

command -v just >/dev/null || fail "just is not installed"
command -v cargo >/dev/null || fail "cargo is not installed"
[ -d "$DAEMON_DIR" ] || fail "daemon checkout not found at $DAEMON_DIR (set DAEMON_DIR)"
[ -f "$PROXY_DIR/main.py" ] || fail "proxy entrypoint not found at $PROXY_DIR/main.py"
[ -x "$PROXY_PYTHON" ] || fail "proxy venv missing: create it with 'python3 -m venv $PROXY_DIR/.venv'"

BACKEND_PORT="$(port_of "$(env_value BACKEND_LISTENERS)" 8080)"
DAEMON_PORT="$(port_of "$(sed -nE 's/^listeners = \["(.*)"\].*/\1/p' "$DAEMON_DIR/config.toml" | head -n1)" 4000)"

log "backend  $ROOT"
log "daemon   $DAEMON_DIR"
log "proxy    $PROXY_DIR"

( cd "$ROOT" && exec just backend "$@" ) > >(prefix backend "$C_BACKEND") 2>&1 &
BACKEND_PID=$!
PIDS="$PIDS $BACKEND_PID"
wait_port backend "$BACKEND_PORT" "$BACKEND_PID"

( cd "$DAEMON_DIR" && exec cargo run -p daemon ) > >(prefix daemon "$C_DAEMON") 2>&1 &
DAEMON_PID=$!
PIDS="$PIDS $DAEMON_PID"
wait_port daemon "$DAEMON_PORT" "$DAEMON_PID"

( cd "$PROXY_DIR" && exec "$PROXY_PYTHON" main.py ) > >(prefix proxy "$C_PROXY") 2>&1 &
PROXY_PID=$!
PIDS="$PIDS $PROXY_PID"

log "all three running, Ctrl-C to stop"

while :; do
    for pid in $PIDS; do
        kill -0 "$pid" 2>/dev/null && continue
        log "$(name_of "$pid") exited, stopping the rest"
        exit 1
    done
    sleep 1
done
