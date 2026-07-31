# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`backend` is the control-plane API for a game-server hosting platform ("novium"). It's a Rust (edition 2024) Axum service that manages projects, servers, users, and files, and orchestrates work on remote **nodes** (daemons) over the network. State lives in Postgres (source of truth) and Valkey/Redis (sessions + template caches).

## Commands

```bash
# Bring up the local infra (Postgres on :5432, Valkey on :6379, MariaDB on :3306)
docker compose -f dev/compose.yml up -d

# Build / check / run (requires a running, migrated Postgres — see sqlx note below)
cargo check
cargo run                      # reads ./config.toml, generates keys in BACKEND_DATA_DIR (default ".")

# Lint & format (CI enforces both; the clippy config is very strict — see below)
cargo fmt --all --check
cargo clippy --all-targets

# Tests (single test)
cargo test <name> -- --nocapture

# Migrations run automatically at startup; to run them manually:
sqlx migrate run --source migrations --database-url postgres://postgres:postgres@localhost/backend
```

Swagger UI is served at `/docs` in debug builds only.

### sqlx compile-time verification (important)

Queries use the `sqlx::query!` family, which is checked **against a live database at compile time**. There is no `.sqlx` offline cache, so `cargo check`/`clippy`/`build` all require a reachable, migrated Postgres. `build.rs` sets `DATABASE_URL` to `BACKEND_DATABASE_URL` if present, otherwise defaults to `postgres://postgres:postgres@localhost/backend`. If a build fails on query macros, your DB is down or missing a migration.

### Private dependencies

Builds pull two git dependencies over SSH — `novium-dev/daemon` (`daemon`/`daemon_common`) and `0xIO32/zelus` — plus a patched `reqwest`. You need SSH access to those repos (`ssh-agent` with the deploy key) or the build won't fetch.

### Feature flags

- `auth_dev` — enables a dev-only auth router. A `compile_error!` forbids it in release builds.
- `embedded_node` — runs a daemon in-process (pulls the `daemon` crate with `btrfs`) instead of only talking to remote nodes.

## Architecture

**`Backend` (`src/main.rs`)** is the cloneable shared-state handle threaded through everything: `PgPool`, Valkey `ConnectionManager` (cache), `AuthService`, loaded config, the in-memory `nodes` map, the `templates` registry, and the crypto keys. It's registered as an Axum `Extension` and extracted by request guards.

**Services (`src/service/`)** are the HTTP layer. Each is an `impl` block annotated with zelus's `#[service]` macro; individual handlers use `#[route(...)]` and declare their error surface with `#[error(...)]`. Error variants come from `define_error!` groups in `src/service/mod.rs` (e.g. `auth`, `project`, `db`), and the `<- [sql:...]` mappings turn sqlx errors into typed API errors (`sql:not_found`, `sql:foreign_key`, `sql:*`). All services are wired into the router in `src/http.rs` via `framework_router!`. `internal.rs` is the daemon-facing service (node registration, SSH auth callbacks); the `admin/` services are gated behind `ManagementPermissions`.

**Auth (`src/auth/`)** — Users sign in via OAuth/OIDC (`auth/oauth/`); `get_or_create_user` upserts them keyed on `auth_id` (the OIDC `sub`). Sessions are random 128-byte tokens stored in Valkey with a sliding TTL. They travel two ways: the `Authorization: Session <base64>` header (API clients) or an httpOnly `session` cookie (`SESSION_COOKIE_NAME` in `src/auth/user.rs`) that the backend **sets on the OAuth callback** and **clears on logout**. The `/auth/callback` handler attaches the cookie via the `WithCookies<T>` response wrapper and redirects to a clean URL (no `?session=` in the query). The `UserAuthentication` guard prefers the header, then falls back to the cookie (`CookieJar::from_headers`). Cookie `Secure` is derived from `config.public_url`'s scheme; same-origin serving keeps `SameSite=Lax`. Request guards `Authentication` (optional) and `UserAuthentication` (required) resolve the session, then eagerly load the user's full permission picture (owned projects, `project_users` grants, per-server effective permissions) into the guard.

**Permissions (`src/auth/permissions.rs`)** are `i64` bitflags in three scopes: `ProjectPermissions`, `ServerPermissions`, and instance-wide `ManagementPermissions`. Checks go through `auth.require(extra, PERM)` where `extra` is a `ProjectId`/`ServerId`/`()` — the `Permission` impls resolve the effective permission from role defaults + project grants + server overrides. Permissions have **dependencies** (`with_dependencies`): e.g. `USER_EDIT` implies `USER_VIEW`, `FILES_WRITE` implies `FILES_READ`. A `require` that fails returns `permission_denied` if the user can otherwise `VIEW` the resource, or `not_found` if they can't (so non-members can't probe existence). `Role` (User/Moderator/Admin) maps to baseline permission sets.

**IDs** — Projects/servers use 6-char nanoids (`GenericNanoId`, `src/utils/id.rs`) created via the `define_id!` macro; they serialize as strings and encode/decode transparently for sqlx. Users and nodes use integer / UUID ids respectively.

**Nodes (`src/db/node/`)** are remote daemons. `sync_nodes` loads them from the `nodes` table into the in-memory `nodes` map at startup, building a `DaemonSDK` client per node (or the in-process `embedded` daemon when its id matches). `BackendNode` derefs to the daemon services trait, so backend code calls daemon RPCs directly on the node handle.

**Templates (`src/templates/`)** define how a given server type is built and configured (Minecraft variants, Satisfactory, and generic Go/Java/Python/Rust/Docker). The `Template` trait (typed) is object-safed behind `TemplateInner` (JSON-`Value`-based) so heterogeneous templates live in one `HashMap`. Templates keep a Valkey-backed cache (e.g. upstream version lists) refreshed on a background task; `.Dockerfile` files colocated in the tree are the build recipes. Templates are initialized once at startup in `load_templates`.

## Before finishing a change

Always run `cargo fmt --all` to format, then `cargo clippy --all-targets` to verify. Both are enforced in CI and the clippy config is strict, so a change isn't done until clippy passes clean.

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

`frontend/` ("hephaestus") is a **client-only SPA** — Vite + React 19 + React Router v7 (library mode, `createBrowserRouter`), Tailwind v4 (via `@tailwindcss/vite`), shadcn/radix UI, SWR for data fetching, and react-hook-form + zod for forms. There is **no frontend server**: the built `dist/` is served by the backend at the same origin (see Part B / `src/http.rs` `ServeDir` fallback and `BACKEND_FRONTEND_DIR`), so auth is the backend's httpOnly session cookie and API calls go same-origin (`credentials: "include"`). It is bundled into the one all-in-one Docker image and validated in CI by the `frontend` job.

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
