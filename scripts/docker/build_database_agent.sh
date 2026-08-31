#!/bin/sh
set -eu

# The agent's sqlx query macros are checked against a sqlite schema database
# rather than a live server, so it only has to be created before the build.
./scripts/dev/database_agent_db.sh

cargo build --bin database_agent --target x86_64-unknown-linux-musl --release
