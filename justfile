set dotenv-load := true

backend_database_url := env("BACKEND_DATABASE_URL", "postgres://postgres:postgres@localhost/backend")
compose := "docker compose -f dev/compose.yml"

[private]
default:
    @just --list --unsorted

# --- infra ---------------------------------------------------------------

# Start postgres, valkey and mariadb
[group('infra')]
up:
    {{compose}} up -d

# Stop the local infra
[group('infra')]
down:
    {{compose}} down

# Follow the infra logs
[group('infra')]
infra-logs:
    {{compose}} logs -f

# Create the local infra, run migrations and seed the agent's sqlite database
[group('infra')]
setup: up migrate agent-db

# --- database ------------------------------------------------------------

# Run the backend migrations
[group('database')]
migrate:
    sqlx migrate run --source backend/migrations --database-url "{{backend_database_url}}"

# Add a backend migration
[group('database')]
migration name:
    sqlx migrate add --source backend/migrations {{name}}

# Create the sqlite database the agent's query macros compile against
[group('database')]
agent-db:
    ./scripts/dev/database_agent_db.sh

# Open a psql shell on the backend database
[group('database')]
psql:
    psql "{{backend_database_url}}"

# --- rust ----------------------------------------------------------------

# Type-check the workspace
[group('rust')]
check:
    cargo check --workspace

# Format
[group('rust')]
fmt:
    cargo fmt --all

# Lint (what CI enforces)
[group('rust')]
clippy:
    cargo clippy --all-targets --workspace

# Run one test by name, or the whole suite
[group('rust')]
test name="":
    cargo test {{name}} -- --nocapture

# Run the backend with the dev auth router
[group('rust')]
backend *args:
    cd backend && cargo run --features auth_dev {{args}}

# Run the database agent
[group('rust')]
agent *args:
    cargo run -p database_agent {{args}}

# --- database agent on macOS ---------------------------------------------

# Build and run the agent in its OrbStack machine
[group('agent')]
orb command="start":
    ./scripts/dev/database_agent_orb.sh {{command}}

# --- frontend ------------------------------------------------------------

# Install the frontend dependencies
[group('frontend')]
web-install:
    cd frontend && bun install

# Vite dev server on :3000
[group('frontend')]
web:
    cd frontend && bun run dev

# Production build of the SPA
[group('frontend')]
web-build:
    cd frontend && bun run build

# Full type check
[group('frontend')]
web-typecheck:
    cd frontend && bun run typecheck

# Regenerate the hey-api client from a running backend's /api/docs/openapi.json
[group('frontend')]
web-gen:
    cd frontend && bun run gen

# --- images --------------------------------------------------------------

# Build the backend image
[group('image')]
image-backend:
    docker build --ssh default -f backend.Dockerfile -t novium/backend:latest .

# Build the frontend image
[group('image')]
image-frontend:
    docker build -f frontend/Dockerfile -t novium/frontend:latest frontend

# Build the database agent image
[group('image')]
image-agent:
    docker build --ssh default -f database_agent.Dockerfile -t novium/database-agent:latest .

# --- ci ------------------------------------------------------------------

# Check formatting without rewriting
[group('rust')]
fmt-check:
    cargo fmt --all --check

# Everything CI enforces
[group('ci')]
verify: fmt-check clippy web-typecheck web-build
