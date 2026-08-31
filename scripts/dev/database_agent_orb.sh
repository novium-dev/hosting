#!/bin/sh
set -eu

# Builds and runs the database_agent inside an OrbStack Linux machine.
#
# The agent reaches its instances over a bind-mounted unix socket, and a macOS
# process cannot connect to one: the socket file shows up on the shared
# filesystem, but the listening socket lives inside the Docker VM. An OrbStack
# machine shares that same Docker daemon, so running the agent there puts both
# ends in one kernel and everything behaves like production.
#
#   ./scripts/dev/database_agent_orb.sh build           # compile inside the machine
#   ./scripts/dev/database_agent_orb.sh setup <code>    # register against the backend
#   ./scripts/dev/database_agent_orb.sh run             # build, then run in foreground
#   ./scripts/dev/database_agent_orb.sh start           # run as a systemd --user unit
#   ./scripts/dev/database_agent_orb.sh stop
#   ./scripts/dev/database_agent_orb.sh logs
#   ./scripts/dev/database_agent_orb.sh forward         # expose the ports on macOS
#   ./scripts/dev/database_agent_orb.sh shell
#
# The agent authenticates with mTLS, so it has to run `setup` once before it can
# serve: create a database host in the admin panel, then pass the setup code
# here. `setup` pulls the CA and the intended config from the backend, registers
# and writes config.toml, agent_root.pem and agent.pem into the agent directory.
#
# SETUP_URL points at the backend (default http://host.internal:8080). The base
# URL the backend later calls back on is the one entered in the admin panel; run
# `forward` first and register the host as https://127.0.0.1:18090, since
# <machine>.orb.local routing is not reliable on every Mac.

MACHINE="${ORB_MACHINE:-ubuntu}"
ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
GUEST_ROOT="/mnt/mac${ROOT}"
AGENT_DIR='$HOME/database-agent'
TARGET_DIR='$HOME/target-dba'

# Host ports for `forward`. The proxies use the engines' default ports inside
# the machine, which usually collide with dev/compose.yml on macOS.
FORWARD_API="${ORB_FORWARD_API:-18090}"
FORWARD_POSTGRES="${ORB_FORWARD_POSTGRES:-15432}"
FORWARD_MARIADB="${ORB_FORWARD_MARIADB:-13306}"
FORWARD_MONGODB="${ORB_FORWARD_MONGODB:-27018}"
FORWARD_REDIS="${ORB_FORWARD_REDIS:-16379}"

if ! orb list 2>/dev/null | awk '{print $1}' | grep -qx "$MACHINE"; then
    echo "OrbStack machine '$MACHINE' not found; create one with:" >&2
    echo "  orb create ubuntu $MACHINE" >&2
    exit 1
fi

guest() {
    orb -m "$MACHINE" bash -lc "$1"
}

# The workspace lockfile pins the SSH-only novium-dev/daemon repo, which a fresh
# machine cannot fetch. Seed cargo's git cache from the host instead.
#
# This syncs every time rather than only when the cache is missing: when the
# lockfile moves to a revision the guest's copy predates, cargo tries to fetch
# it over SSH and the build dies on a key the machine does not have.
seed_cargo_cache() {
    guest "
        set -eu
        mkdir -p \$HOME/.cargo/git/db
        cp -r --no-preserve=mode,ownership /mnt/mac${HOME}/.cargo/git/db/. \$HOME/.cargo/git/db/
    "
}

# Setup writes the built-in production defaults; rewrite the paths and the
# docker socket to the OrbStack layout afterwards. Rootless is required here:
# OrbStack's per-user daemon remaps container uids, so chowning the socket and
# volume directories would make them unreadable to the engine containers.
localize_config() {
    guest "
        set -eu
        mkdir -p ${AGENT_DIR}/data ${AGENT_DIR}/sock
        sed -i \
            -e \"s|^data_dir = .*|data_dir = '${AGENT_DIR}/data'|\" \
            -e \"s|^socket_dir = .*|socket_dir = '${AGENT_DIR}/sock'|\" \
            -e \"s|^url = .*|url = 'sqlite://${AGENT_DIR}/data/agent.db?mode=rwc'|\" \
            -e \"s|^socket = .*|socket = '/run/user/\$(id -u)/docker.sock'|\" \
            -e \"s|^rootless = .*|rootless = true|\" \
            ${AGENT_DIR}/config.toml
        echo 'localized ${AGENT_DIR}/config.toml'
    "
}

require_config() {
    if ! guest "test -f ${AGENT_DIR}/config.toml" >/dev/null 2>&1; then
        echo "the agent is not set up yet; run:" >&2
        echo "  $0 setup <code>" >&2
        exit 1
    fi
}

build() {
    seed_cargo_cache
    guest "
        set -eu
        cd ${GUEST_ROOT}
        export CARGO_TARGET_DIR=${TARGET_DIR}
        export DATABASE_AGENT_DATABASE_URL='sqlite://${GUEST_ROOT}/dev/database_agent.db'
        cargo build -p database_agent
    "
}

case "${1:-run}" in
    build)
        build
        ;;
    setup)
        if [ $# -lt 2 ]; then
            echo "usage: $0 setup <code>" >&2
            exit 1
        fi
        build
        guest "
            set -eu
            mkdir -p ${AGENT_DIR}
            rm -f ${AGENT_DIR}/config.toml
            DATABASE_AGENT_DATA_DIR=${AGENT_DIR} \
                SETUP_URL='${SETUP_URL:-http://host.internal:8080}' \
                SETUP_TOKEN='$2' \
                ${TARGET_DIR}/debug/database_agent
        "
        localize_config
        ;;
    run)
        build
        require_config
        guest "DATABASE_AGENT_DATA_DIR=${AGENT_DIR} ${TARGET_DIR}/debug/database_agent"
        ;;
    start)
        build
        require_config
        guest "
            systemctl --user reset-failed database-agent 2>/dev/null || true
            systemd-run --user --unit=database-agent --collect \
                --setenv=DATABASE_AGENT_DATA_DIR=${AGENT_DIR} \
                --working-directory=${AGENT_DIR} \
                ${TARGET_DIR}/debug/database_agent
        "
        ;;
    stop)
        guest "systemctl --user stop database-agent"
        ;;
    logs)
        guest "journalctl --user -u database-agent -f -o cat"
        ;;
    forward)
        pkill -f "ssh -f -N .*@${MACHINE}@orb" 2>/dev/null || true
        # `ssh -f` forks but keeps the inherited stdout/stderr open, which would
        # hang anything piping this script's output. Detach them explicitly.
        if ! ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
            -L "${FORWARD_API}:127.0.0.1:8090" \
            -L "${FORWARD_POSTGRES}:127.0.0.1:5432" \
            -L "${FORWARD_MARIADB}:127.0.0.1:3306" \
            -L "${FORWARD_MONGODB}:127.0.0.1:27017" \
            -L "${FORWARD_REDIS}:127.0.0.1:6379" \
            "${USER}@${MACHINE}@orb" </dev/null >/dev/null 2>&1
        then
            echo "failed to forward the agent ports (already in use?)" >&2
            exit 1
        fi
        echo "api      -> 127.0.0.1:${FORWARD_API}"
        echo "postgres -> 127.0.0.1:${FORWARD_POSTGRES}"
        echo "mariadb  -> 127.0.0.1:${FORWARD_MARIADB}"
        echo "mongodb  -> 127.0.0.1:${FORWARD_MONGODB}"
        echo "redis    -> 127.0.0.1:${FORWARD_REDIS}"
        ;;
    shell)
        orb -m "$MACHINE"
        ;;
    *)
        echo "usage: $0 [build|setup <code>|run|start|stop|logs|forward|shell]" >&2
        exit 1
        ;;
esac
