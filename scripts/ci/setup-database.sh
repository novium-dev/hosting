#!/bin/sh
set -eu

host="$1"
sqlx=.ci/sqlx-cli/bin/sqlx

[ -x "$sqlx" ] || RUSTFLAGS="-C opt-level=0" cargo install --locked --version "$SQLX_CLI_VERSION" \
    --no-default-features --features postgres,rustls sqlx-cli --root .ci/sqlx-cli

until pg_isready --host "$host" --username postgres --dbname postgres; do sleep 1; done
"$sqlx" database create --database-url "$BACKEND_DATABASE_URL"
"$sqlx" migrate run --database-url "$BACKEND_DATABASE_URL" --source backend/migrations
./scripts/dev/database_agent_db.sh
