# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Cargo workspace for a game-server hosting platform ("novium"), Rust edition 2024:

- **`backend/`** — the control-plane API. An Axum service that manages projects, servers, users, and files, and orchestrates work on remote **nodes** (daemons) over the network. State lives in Postgres (source of truth) and Valkey/Redis (sessions + template caches).
- **`database_agent/`** — a separate application that runs database engines (postgres, mariadb, mongodb, redis) in Docker containers and fronts them with a shared-port proxy. Its own state lives in SQLite.
- **`database_agent_common/`** — shared DTOs, the zelus service traits, and the `DatabaseAgentSDK` the backend uses to talk to an agent. Same split as `daemon` / `daemon_common`.
- **`frontend/`** — the client-only SPA (see Part B), served by the backend.

## Commands

```bash
# Bring up the local infra (Postgres on :5432, Valkey on :6379, MariaDB on :3306)
docker compose -f dev/compose.yml up -d

# Prepare the sqlite database the database_agent's query macros compile against
./scripts/dev/database_agent_db.sh

# Build / check / run (requires a running, migrated Postgres — see sqlx note below)
cargo check --workspace
cargo run -p backend           # reads backend/config.toml, generates keys in BACKEND_DATA_DIR (default ".")
cargo run -p database_agent    # reads ./config.toml from DATABASE_AGENT_DATA_DIR (default ".")

# Lint & format (CI enforces both; the clippy config is very strict — see below)
cargo fmt --all --check
cargo clippy --all-targets --workspace

# Tests (single test)
cargo test <name> -- --nocapture

# Migrations run automatically at startup; to run them manually:
sqlx migrate run --source backend/migrations --database-url postgres://postgres:postgres@localhost/backend
```

Swagger UI is served at `/docs` in debug builds only (`/api/docs` for the backend).

### sqlx compile-time verification (important)

Queries use the `sqlx::query!` family, which is checked **against a live database at compile time**. There is no `.sqlx` offline cache, so `cargo check`/`clippy`/`build` all require a reachable, migrated database.

- **backend** — `backend/build.rs` sets `DATABASE_URL` to `BACKEND_DATABASE_URL` if present, otherwise `postgres://postgres:postgres@localhost/backend`. If a build fails on query macros, your Postgres is down or missing a migration.
- **database_agent** — `database_agent/build.rs` sets `DATABASE_URL` to `DATABASE_AGENT_DATABASE_URL` if present, otherwise `sqlite://dev/database_agent.db`. That file is gitignored; create it with `./scripts/dev/database_agent_db.sh` and re-run the script after adding a migration.

### Private dependencies

Builds pull two git dependencies over SSH — `novium-dev/daemon` (`daemon`/`daemon_common`) and `0xIO32/zelus` — plus a patched `reqwest`. You need SSH access to those repos (`ssh-agent` with the deploy key) or the build won't fetch.

### Feature flags

- `auth_dev` — enables a dev-only auth router. A `compile_error!` forbids it in release builds.
- `embedded_node` — runs a daemon in-process (pulls the `daemon` crate with `btrfs`) instead of only talking to remote nodes.

## Architecture

**`Backend` (`backend/src/main.rs`)** is the cloneable shared-state handle threaded through everything: `PgPool`, Valkey `ConnectionManager` (cache), `AuthService`, loaded config, the in-memory `nodes` map, the `templates` registry, and the crypto keys. It's registered as an Axum `Extension` and extracted by request guards.

**Services (`backend/src/service/`)** are the HTTP layer. Each is an `impl` block annotated with zelus's `#[service]` macro; individual handlers use `#[route(...)]` and declare their error surface with `#[error(...)]`. Error variants come from `define_error!` groups in `backend/src/service/mod.rs` (e.g. `auth`, `project`, `db`), and the `<- [sql:...]` mappings turn sqlx errors into typed API errors (`sql:not_found`, `sql:foreign_key`, `sql:*`). All services are wired into the router in `backend/src/http.rs` via `framework_router!`. `internal.rs` is the daemon-facing service (node registration, SSH auth callbacks); the `admin/` services are gated behind `ManagementPermissions`.

**Auth (`backend/src/auth/`)** — Users sign in via OAuth/OIDC (`auth/oauth/`); `get_or_create_user` upserts them keyed on `auth_id` (the OIDC `sub`). Sessions are random 128-byte tokens stored in Valkey with a sliding TTL. They travel two ways: the `Authorization: Session <base64>` header (API clients) or an httpOnly `session` cookie (`SESSION_COOKIE_NAME` in `backend/src/auth/user.rs`) that the backend **sets on the OAuth callback** and **clears on logout**. The `/auth/callback` handler attaches the cookie via the `WithCookies<T>` response wrapper and redirects to a clean URL (no `?session=` in the query). The `UserAuthentication` guard prefers the header, then falls back to the cookie (`CookieJar::from_headers`). Cookie `Secure` is derived from `config.public_url`'s scheme; same-origin serving keeps `SameSite=Lax`. Request guards `Authentication` (optional) and `UserAuthentication` (required) resolve the session, then eagerly load the user's full permission picture (owned projects, `project_users` grants, per-server effective permissions) into the guard.

**Permissions (`backend/src/auth/permissions.rs`)** are `i64` bitflags in three scopes: `ProjectPermissions`, `ServerPermissions`, and instance-wide `ManagementPermissions`. Checks go through `auth.require(extra, PERM)` where `extra` is a `ProjectId`/`ServerId`/`()` — the `Permission` impls resolve the effective permission from role defaults + project grants + server overrides. Permissions have **dependencies** (`with_dependencies`): e.g. `USER_EDIT` implies `USER_VIEW`, `FILES_WRITE` implies `FILES_READ`. A `require` that fails returns `permission_denied` if the user can otherwise `VIEW` the resource, or `not_found` if they can't (so non-members can't probe existence). `Role` (User/Moderator/Admin) maps to baseline permission sets.

**IDs** — Projects/servers use 6-char nanoids (`GenericNanoId`, `backend/src/utils/id.rs`) created via the `define_id!` macro; they serialize as strings and encode/decode transparently for sqlx. Users and nodes use integer / UUID ids respectively.

**Nodes (`backend/src/db/node/`)** are remote daemons. `sync_nodes` loads them from the `nodes` table into the in-memory `nodes` map at startup, building a `DaemonSDK` client per node (or the in-process `embedded` daemon when its id matches). `BackendNode` derefs to the daemon services trait, so backend code calls daemon RPCs directly on the node handle.

**Templates (`backend/src/templates/`)** define how a given server type is built and configured (Minecraft variants, Satisfactory, and generic Go/Java/Python/Rust/Docker). The `Template` trait (typed) is object-safed behind `TemplateInner` (JSON-`Value`-based) so heterogeneous templates live in one `HashMap`. Templates keep a Valkey-backed cache (e.g. upstream version lists) refreshed on a background task; `.Dockerfile` files colocated in the tree are the build recipes. Templates are initialized once at startup in `load_templates`.

**Databases (`backend/src/db/database.rs`, `backend/src/service/database.rs`)** — a project may hold up to `MAX_PROJECT_DATABASES` (4) databases; going beyond that needs `ManagementPermissions::LIMITS_BYPASS`. `sync_database_hosts` mirrors `sync_nodes`: it loads the `database_hosts` table into an in-memory map, building a `DatabaseAgentSDK` per host. Creating a project database picks an instance of the requested engine (host not in maintenance, project's region preferred, fewest databases), then calls the agent to create the database and its user. `backend/src/service/admin/database.rs` registers hosts and their public ports and manages instances.

## The database agent

**`Agent` (`database_agent/src/state.rs`)** is the cloneable handle (config, SQLite `Store`, `bollard::Docker`, the instance list, the route table, the subsystem registry). Instances hold an `Agent` back-reference, mirroring the reference implementation.

**Instances (`database_agent/src/instance/`)** are Docker containers running a database engine. `docker.rs` holds the concrete `bollard` calls — there is deliberately **no executor trait**, the agent only supports Docker. Containers run with `network_mode: none`; the only way in is a bind-mounted unix socket. `connection/` provisions databases and users per engine through that socket, dispatched by the `Connection` enum (no `Box<dyn>`).

**Proxy subsystems (`database_agent/src/subsystems/`)** are the point of the agent. One TCP listener per engine (5432/3306/27017/6379) serves every instance of that engine. A client connects as `u<8 hex>_<label>` (`database_agent_common::identifier`); the agent parses the username, looks it up in the `DatabaseRouteManager`, authenticates the client itself (SCRAM-SHA-256 for postgres/mongodb, `mysql_native_password` for mariadb, `AUTH`/`HELLO` for redis), re-authenticates against the instance's socket, then `copy_bidirectional`s. Suspended instances and unknown users are rejected before any relay. The protocol modules carry module-level `#![expect(...)]` blocks for the endianness and cast lints — wire formats fix both, so those lints don't apply there.

**Agent auth** is a shared bearer token from `[api] token`, checked with `constant_time_eq` in an axum middleware over zelus's `with_auth` router group. The agent is not user facing and speaks plain HTTP; keep it on a private network.

## Before finishing a change

Always run `cargo fmt --all` to format, then `cargo clippy --all-targets --workspace` to verify. Both are enforced in CI and the clippy config is strict, so a change isn't done until clippy passes clean.

## Conventions

The clippy config in `Cargo.toml` is deliberately strict (`pedantic` + `nursery` + a large `restriction` set, mostly at `deny`/`forbid`). Notably **denied**: `unwrap_used`, `panic`, `expect_used` is *allowed* but `unwrap` is not, `indexing_slicing`, `print_stdout`/`print_stderr` (use `tracing`), `dbg_macro`, `exit`, `str_to_string`, `create_dir`, endianness-implicit byte conversions. Prefer `?` with the typed service errors over panicking. `min_ident_chars` is denied except in autogenerated code. Match the existing pattern: raw SQL via `query!`/`query_scalar!`/`query_as!`, `#[error(...)]` mappings for fallible handlers, and permission checks (`auth.require`) as the first lines of a handler before any DB work.

### Comments

No comments in the code, period — no file/module headers, no explanatory `//` or `///` notes, no commented-out code, no TODOs. Code should read clearly enough on its own (naming, structure) that it doesn't need narration. The one exception is route documentation, below.

Every `#[route(...)]` handler must have a `///` doc comment directly above it describing what the endpoint does (these feed the OpenAPI docs at `/docs`). If the handler calls `auth.require`, add a `# Permissions` section listing the required permission(s), e.g.:

```rust
/// Restarts the server.
///
/// # Permissions
/// Requires [`ServerPermissions::POWER`].
#[route("/{server_id}/restart", method = GET)]
```

## Frontend

`frontend/` ("hephaestus") is a **client-only SPA** — Vite + React 19 + React Router v7 (library mode, `createBrowserRouter`), Tailwind v4 (via `@tailwindcss/vite`), shadcn/radix UI, SWR for data fetching, and react-hook-form + zod for forms. There is **no frontend server**: the built `dist/` is served by the backend at the same origin (see Part B / `backend/src/http.rs` `ServeDir` fallback and `BACKEND_FRONTEND_DIR`), so auth is the backend's httpOnly session cookie and API calls go same-origin (`credentials: "include"`). It is bundled into the one all-in-one Docker image and validated in CI by the `frontend` job.

```bash
cd frontend
bun install
bun run dev        # Vite dev server on :3000; proxies /api -> VITE_DEV_API_URL (see vite.config.ts)
bun run build      # type-agnostic Vite build -> dist/
bun run typecheck  # tsc --noEmit (full type check)
bun run gen        # regenerate the hey-api client in lib/api from the backend's /docs/openapi.json
```

Conventions:
- **API client** — the generated hey-api client lives in `lib/api` (committed, framework-agnostic); its runtime config is `lib/api-client.ts` (base URL `""` in prod, `/api` proxy in dev, `credentials: "include"`). The `lib/auth.ts` / `lib/auth-client.ts` shims wrap those calls.
- **Cached session/org** — the current user is fetched once by `SessionProvider` (`contexts/session-provider.tsx`, backed by the Zustand store `stores/session.ts`) and read via `authClient.useSession()` / `useSession()` (`{ data, isLoading }`); logout clears it. Full organizations are cached per-slug in `stores/organizations.ts` via the `useOrganization(slug)` hook (fetch-once); mutations should call the store's `invalidate(slug)` / `clear()` to refresh.
- **Routing** — routes are declared in `router.tsx`, mapping the `app/` tree (Next-style folders kept for familiarity) to route objects. Layouts render `<Outlet/>`. The auth guard lives in `app/(app)/layout.tsx` (redirects to `/signin`); the old Next `middleware.ts` and `/api` proxy are gone.
- **Data & navigation** — pages are client components: fetch with `useSWR`, read params with `useParams`, redirect with `<Navigate/>`. `lib/navigation.ts` is a small `next/navigation` compatibility shim (`useRouter`/`usePathname`/`useSearchParams`); `components/link.tsx` is a `next/link` replacement accepting `href`.
- **Actions** — former server actions in `actions/` are plain async functions using the `lib/safe-action.ts` builder; components consume them via `lib/action-hooks.ts` (`useAction` / `useHookFormAction`).
- Run `bun run build` (and ideally `bun run typecheck`) before finishing a frontend change; `bun run build` is what CI enforces.
- **Don't verify UI changes in a browser.** `bun run typecheck` + `bun run build` passing is enough — don't start a dev server, drive the browser, or take screenshots to check a change. Never add a throwaway route (e.g. `/preview`) rendering components with mock data just to look at them; those temp files end up committed. The user reviews UI changes themselves.
