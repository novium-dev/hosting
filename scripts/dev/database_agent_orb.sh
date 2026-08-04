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
#   ./scripts/dev/database_agent_orb.sh build     # compile inside the machine
#   ./scripts/dev/database_agent_orb.sh run       # build, then run in foreground
#   ./scripts/dev/database_agent_orb.sh start     # run as a systemd --user unit
#   ./scripts/dev/database_agent_orb.sh stop
#   ./scripts/dev/database_agent_orb.sh logs
#   ./scripts/dev/database_agent_orb.sh forward   # expose the ports on macOS
#   ./scripts/dev/database_agent_orb.sh shell

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

ensure_config() {
    guest "
        set -eu
        mkdir -p ${AGENT_DIR}/data ${AGENT_DIR}/sock
        if [ ! -f ${AGENT_DIR}/config.toml ]; then
            cat > ${AGENT_DIR}/config.toml <<EOF
id = \"\$(cat /proc/sys/kernel/random/uuid)\"
data_dir = \"${AGENT_DIR}/data\"
socket_dir = \"${AGENT_DIR}/sock\"

[docker]
rootless = true
socket = \"/run/user/\$(id -u)/docker.sock\"

[api]
bind = \"0.0.0.0:8090\"
token = \"dev-token\"

[store]
url = \"sqlite://${AGENT_DIR}/data/agent.db?mode=rwc\"

[postgres]
enabled = true
bind = \"0.0.0.0:5432\"

[mariadb]
enabled = true
bind = \"0.0.0.0:3306\"

[mongodb]
enabled = true
bind = \"0.0.0.0:27017\"

[redis]
enabled = true
bind = \"0.0.0.0:6379\"
EOF
            echo \"wrote ${AGENT_DIR}/config.toml\"
        fi
    "
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
    run)
        build
        ensure_config
        guest "DATABASE_AGENT_DATA_DIR=${AGENT_DIR} ${TARGET_DIR}/debug/database_agent"
        ;;
    start)
        build
        ensure_config
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
        echo "usage: $0 [build|run|start|stop|logs|forward|shell]" >&2
        exit 1
        ;;
esac
