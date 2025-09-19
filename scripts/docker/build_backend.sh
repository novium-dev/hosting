#!/bin/sh

mkdir /run/mysqld -p
mariadbd --user=root --skip-name-resolve --skip-networking=0 --silent-startup &
until mariadb-admin ping --user root; do sleep 0.250; done

export BACKEND_DATABASE_URL="mysql://root@localhost/backend?socket=/run/mysqld/mysqld.sock"

cargo sqlx database create --database-url "$BACKEND_DATABASE_URL"
cargo sqlx migrate run --database-url "$BACKEND_DATABASE_URL"

cargo build --target x86_64-unknown-linux-musl --release --no-default-features --features "$FEATURES"

# llvm-strip target/x86_64-unknown-linux-musl/release/backend
