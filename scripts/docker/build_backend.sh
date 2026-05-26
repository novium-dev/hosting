#!/bin/sh
set -eu

mkdir -p /run/postgresql /var/lib/postgresql/data
chown -R postgres:postgres /run/postgresql /var/lib/postgresql
su postgres -c "initdb -D /var/lib/postgresql/data --auth=trust" >/dev/null
su postgres -c "pg_ctl -D /var/lib/postgresql/data -o '-h 127.0.0.1 -k /run/postgresql' -w start"
createdb --host=127.0.0.1 --username=postgres backend

export BACKEND_DATABASE_URL="postgres://postgres@127.0.0.1/backend"

cargo sqlx database create --database-url "$BACKEND_DATABASE_URL"
cargo sqlx migrate run --database-url "$BACKEND_DATABASE_URL"

cargo build --target x86_64-unknown-linux-musl --release --no-default-features --features "$FEATURES"

# llvm-strip target/x86_64-unknown-linux-musl/release/backend
