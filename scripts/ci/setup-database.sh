#!/bin/sh
set -eu

if [ ! -x .ci/sqlx-cli/bin/sqlx ]; then
    cargo install --locked --no-default-features --features postgres,rustls sqlx-cli --root .ci/sqlx-cli
fi

until pg_isready --host db --username postgres --dbname postgres; do sleep 1; done
.ci/sqlx-cli/bin/sqlx database create --database-url "$BACKEND_DATABASE_URL"
.ci/sqlx-cli/bin/sqlx migrate run --database-url "$BACKEND_DATABASE_URL" --source backend/migrations
./scripts/dev/database_agent_db.sh
