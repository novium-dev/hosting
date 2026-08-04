#!/bin/sh
set -eu

# Creates the sqlite database the database_agent's sqlx query macros are checked
# against at compile time (see database_agent/build.rs). Re-run after adding a
# migration.

ROOT="$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)"
DB="${DATABASE_AGENT_DEV_DATABASE:-$ROOT/dev/database_agent.db}"

mkdir -p "$(dirname "$DB")"
rm -f "$DB"

for migration in "$ROOT"/database_agent/migrations/*.sql; do
    sqlite3 "$DB" < "$migration"
done

echo "prepared $DB"
