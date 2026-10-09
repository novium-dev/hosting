# CLAUDE.md

Game server hosting platform ("novium"), a Cargo workspace (Rust 2024) plus a React SPA:

- `backend/` - Axum API. Postgres is the source of truth, Valkey is cache and short-lived shared state. Talks to remote nodes (daemons) and database hosts over mTLS.
- `database_agent/` - runs database engines in Docker and proxies them on shared ports. State in SQLite.
- `database_agent_common/` - DTOs, service traits and the `DatabaseAgentSDK` the backend uses.
- `frontend/` - Vite + React SPA, its own nginx image.

## Commands

```bash
docker compose -f dev/compose.yml up -d    # Postgres, Valkey, MariaDB
./scripts/dev/database_agent_db.sh         # sqlite db the agent's query macros compile against
set -a && . ./.env && set +a && cargo run -p backend --features auth_dev
cargo fmt --all
cargo clippy --all-targets --workspace     # must pass clean before a change is done
sqlx migrate run --source backend/migrations --database-url postgres://postgres:postgres@localhost/backend
```

- `sqlx::query!` is checked against a live, migrated database at compile time (no offline cache). If a build fails on query macros, Postgres is down or missing a migration; run the migrate command above. The agent compiles against `dev/database_agent.db` (rerun the script after adding an agent migration).
- Builds fetch `daemon` and `zelus_keys` from `git-ssh.novium.world` over SSH (CI uses the `DEPLOY_KEY` secret).
- The backend reads only `BACKEND_*` environment variables (`backend/.env.example`), never a `.env` file. The agent reads `config.toml` from `DATABASE_AGENT_DATA_DIR`.
- `auth_dev` adds `GET /api/auth/login/dev`, which signs in as a seeded admin. Swagger is at `/api/docs` in debug builds.

## Backend rules

- Several instances run behind a load balancer, so nothing request-visible may live only in one process's memory. Durable state goes in Postgres, short-lived shared state in Valkey. Polled background jobs hold a lock (`try_lock` + `hold_lock`) and mirror their state with `store_shared`; periodic tasks must be idempotent or take a lock.
- The in-memory `nodes` and `database_hosts` maps are caches. After changing those tables in a transaction, call `backend.sync(tx, SyncTarget::…)` so every instance reloads.
- Database writes that also call a node or agent: open a transaction, write, make the remote call, commit only if it succeeded.
- Handlers check permissions (`auth.require`) first, before any DB work.
- Grants are bitmasks in `project_users.permissions` and `api_keys.permissions`. When adding a permission bit that existing grants should receive, add a migration that ORs it into both columns for grants holding the implying permission (see `20261008000000_drop_permission_backfills.sql`).
- The clippy config is very strict (`unwrap`, `panic`, indexing, `print*` and short identifiers are denied). Use `?` with the typed service errors and `tracing` for logs.
- Raw SQL via `query!` / `query_scalar!` / `query_as!`.
- No comments in Rust code. The only exception: every `#[route(...)]` handler has a `///` doc comment (it feeds the OpenAPI docs), with a `# Permissions` section when it calls `auth.require`:

```rust
/// Restarts the server.
///
/// # Permissions
/// Requires [`ServerPermissions::POWER`].
#[route("/{server_id}/restart", method = POST)]
```

- Never edit a committed migration unless asked.
- Code that only exists for older deployments or data gets an entry in `docs/legacy-compat.md`.

## Database agent on macOS

The agent must run on Linux (it reaches instances over bind-mounted unix sockets, which a macOS process cannot connect to). Use the OrbStack script:

```bash
./scripts/dev/database_agent_orb.sh forward         # expose its ports on macOS
./scripts/dev/database_agent_orb.sh setup <code>    # setup code from the admin panel
./scripts/dev/database_agent_orb.sh start
./scripts/dev/database_agent_orb.sh logs
```

Run `forward` first and register the host as `https://127.0.0.1:18090`.

## Frontend

```bash
cd frontend
pnpm install
pnpm run dev        # :3000, proxies /api to VITE_DEV_API_URL
pnpm run typecheck
pnpm run lint       # oxlint
pnpm run format     # oxfmt
pnpm run build
pnpm run gen        # regenerate lib/api from a running backend's OpenAPI spec
```

- Run typecheck, lint, format and build before finishing a change. Don't verify UI changes in a browser and never add throwaway preview routes; the user reviews UI themselves.
- shadcn on Base UI (`render` prop, not `asChild`). The React Compiler is on, so follow its rules (no setState in effects, no ref writes during render).
- Fetch with SWR. SWR caches by key alone: a key used by more than one component lives in `hooks/use-shared-queries.ts` with its single fetcher; other keys must be unique.
- Show API errors with `apiErrorMessage(response.error, fallback)`.
- All user-facing strings go through i18next with an explicit namespace (`t("common:actions.save")`). Reuse keys from `locales/en/common.json` where possible. `en` and `de` must have identical keys. New namespaces are registered in `lib/i18n.ts`.
- Runtime settings come from `window.__RUNTIME_CONFIG__` (`constants/config.ts`); a new one needs its key in `vite-env.d.ts`. `VITE_API_URL` and `VITE_PROVIDERS` are build-time.
