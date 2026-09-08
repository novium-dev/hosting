---
name: zelus
description: How to write, extend and debug HTTP endpoints in this repo's zelus service framework — the `#[service]` / `#[route]` / `#[error]` macros, `define_error!` groups, `#[special]` extractors, path/query variable declarations, raw vs JSON responses, router registration and SDK traits. Use this whenever a task touches an endpoint in backend/src/service/, database_agent_common/src/service/ or database_agent/src/service/ — adding or changing a route, adding a field to a response, wiring a new service, mapping sqlx errors to API errors, or making sense of a macro-expansion compile error. Also use it when the frontend needs a new API call and the endpoint behind it has to be built or regenerated.
---

# The zelus service framework

zelus is a private macro framework (`github.com/0xIO32/zelus`, pinned in `Cargo.lock`) that turns an annotated `impl` block or trait into three things at once: axum routes, an OpenAPI document, and — unless `no_sdk` is set — a reqwest client SDK. Because one annotation drives all three, the shape of a handler is not a free choice: argument order, return type and the `#[error]` list are load-bearing.

The framework source is vendored at `~/.cargo/git/checkouts/zelus-991ff131a1eb11b4/<rev>/` (rev from `Cargo.lock`). Its `zelus/examples/*.rs` are short and each demonstrates exactly one feature — read one when a macro option is unclear rather than guessing, since macro errors point at expanded code and are hard to read.

## The two shapes

**Backend** (`backend/src/service/`) annotates the `impl` directly — there is no separate trait to keep in sync:

```rust
#[service(path = "/admin/route", tag = "route", no_sdk)]
pub(crate) impl RouteAdminService for Backend { … }
```

**Agent** (`database_agent_common/src/service/`, and the `daemon`/`daemon_common` pair) splits it: the annotated *trait* lives in the `_common` crate so both sides share it, and the server implements it with a plain `#[async_trait] impl`. Dropping `no_sdk` is what generates `DatabaseAgentSDK`, so the backend calls agent endpoints as ordinary methods. Change a trait signature there and you change the wire protocol for both sides at once.

## Anatomy of a handler

```rust
/// Lists every route pointing at the domain, across all projects.
///
/// # Permissions
/// Requires [`ManagementPermissions::DOMAINS_VIEW`].
#[route("/domains/{domain_id}/routes", method = GET)]
#[error(auth::{permission_denied, unreachable}, route::domain_not_found, db::failure <- [sql:*])]
async fn list_domain_routes(
    &self,
    #[special] auth: Authentication,
    domain_id: i32,
) -> Result<Vec<DomainRouteInfo>, _> {
    auth.require::<_, _, ListDomainRoutesError>((), ManagementPermissions::DOMAINS_VIEW)?;
    …
}
```

Five things are doing work here:

- **The doc comment is the API documentation.** It becomes the endpoint's description at `/api/docs`. This repo forbids comments everywhere else, so this is the one place prose belongs — and CLAUDE.md requires a `# Permissions` section listing the permissions whenever the handler calls `auth.require`.
- **Argument order is the binding order**: `&self`, then `#[special]` extractors, then one argument per `{brace}` in the path (name must match), then one per name in `query = [...]`, then the payload. Nothing is matched positionally against the path — it is matched by *name*, so renaming an argument silently rebinds it.
- **`Result<T, _>`** — the `_` is not inference, it is the macro's cue to synthesize the error enum from `#[error(...)]`. Write the type out only when reusing a standalone `error!` type.
- **The generated error type** is named after the function and lives in a module named after the service: `list_domain_routes` in `RouteAdminService` → `route_admin_service_error::ListDomainRoutesError`. Import it at the top of the file alongside its siblings; adding a handler means adding a name to that import list.
- **Variant names** are `CamelCase(category) + CamelCase(error)`: `route::domain_not_found` → `RouteDomainNotFound`, `server::not_found` → `ServerNotFound`, `auth::invalid` → `AuthInvalid`. This trips people up when the category and the error read redundantly (`ServerServerNotFound` never appears; it is `ServerNotFound` from `server::not_found`).

## Errors are a shared vocabulary, not per-handler enums

`define_error!` groups in `backend/src/service/mod.rs` declare each error once — message and HTTP status — and every handler picks the subset it can actually return. A handler that lists a variant it never constructs advertises a lie in the OpenAPI docs; one that forgets a variant won't compile. Prefer an existing variant over a new one; add to a group only when no existing error carries the meaning, and remember the message is user-visible.

`<- [...]` attaches automatic `From` conversions to a variant, which is what lets handlers use plain `?` on sqlx errors:

- `db::failure <- [sql:*]` — every sqlx error becomes `DbFailure` (the catch-all; almost every DB-touching handler wants this)
- `project::not_found <- [sql:foreign_key]` — an FK violation becomes a typed 404 instead of a 500
- also available: `sql:not_found` (`RowNotFound`), `sql:unique`, `sql:check`, `redis:*`, `io:<ErrorKind>`

`auth.require::<_, _, SomeError>(scope, PERM)` only compiles when the error type carries `auth::{permission_denied, unreachable}`, which is why that pair opens nearly every `#[error(...)]` list in the backend. Put the `require` call before any DB work — it is both the security boundary and the cheapest failure.

## Responses

By default the `Ok` value is serialized as JSON. `raw` on the route turns that off and hands the value to axum as-is, which is what you want when the type renders itself: `Paged<T>` (pagination headers), `WithCookies<T>` (Set-Cookie), `FileResponse`, `Redirect`, streams, or `()` when an empty body reads better than `null`. A raw success type must implement `IntoResponse` *and* `DocumentedResultResponse` so the docs stay honest.

Response structs are plain `#[derive(Debug, Serialize, utoipa::ToSchema)]` types defined at the top of the service file. Field names are the API contract and flow straight into the generated TypeScript client.

## Adding to an endpoint's response

The most common task. Gate anything operator-only the way the existing fields do — `Option<T>` filled from a permission check — so the same endpoint can serve both the panel and the admin UI:

```rust
node_server_id: auth
    .has((), ManagementPermissions::SERVER_MANAGE)
    .then_some(server.node_server_id),
```

`auth.has` returns a bool and never errors; `auth.require` short-circuits. Use `has` for shaping a response, `require` for guarding an operation.

## Checklist for a new endpoint

1. Write the handler in the right service file, with the doc comment and `# Permissions` section.
2. Reuse an error variant if one fits; otherwise add it to the group in `service/mod.rs`.
3. Declare any *new* path or query variable name with `define_path_variable!` / `define_query_variable!` (in `service/mod.rs`, or locally at the top of the service file for one-offs). The macro looks up a description module by name; a name with no declaration fails to compile.
4. Add the generated error type to the file's `…_service_error::{…}` import.
5. A brand-new service also needs: `pub(crate) mod` in `service/mod.rs`, its trait imported in `backend/src/http.rs`, and its name inside the `framework_router!` list there.
6. `cargo check -p backend` — needs a live migrated Postgres, since `query!` is verified at compile time.
7. Regenerate the frontend client if the UI will call it (below).
8. `cargo fmt --all`, then `cargo clippy --all-targets --workspace`. The config is strict; a change isn't done until clippy is clean.

## Regenerating the TypeScript client

`frontend/lib/api` is generated from the running backend's OpenAPI document, so the backend must be up first:

```bash
set -a && . ./.env && set +a && cargo run -p backend --features auth_dev
```

```bash
cd frontend && bun run gen
```

Then stop the backend. The generated names follow the handler: `list_domain_routes` → `listDomainRoutes()`, with `ListDomainRoutesResponses[200]` as the row type. Commit `lib/api` — it is checked in.

## When the compiler yells

Macro errors surface at the expanded code, so read them against these usual causes:

| Symptom | Cause |
|---|---|
| unresolved module `variable_path_x` / `variable_query_x` | missing `define_path_variable!` / `define_query_variable!` for that name |
| unresolved `SomeHandlerError` | handler renamed, or the name not added to the `…_service_error` import |
| no variant named `FooBar` | check the `CamelCase(category) + CamelCase(error)` derivation, and that the variant is in this handler's `#[error(...)]` |
| `?` on a sqlx error doesn't convert | no `<- [sql:*]` mapping in this handler's error list |
| `require` complains about a missing trait bound | error list is missing `auth::{permission_denied, unreachable}` |
| trait method signature mismatch (agent) | trait in `_common` and impl in the server drifted apart |
| query macro failures across the whole crate | Postgres down or un-migrated — not a code problem |

## Deeper reference

`references/macros.md` documents every `#[service]` / `#[route]` / `#[error]` option, the multi-router `routes = [...]` mechanism, `#[special]` extractor implementation, websocket routes, and the error-group catalog. Read it when you need an option that isn't used anywhere in the repo yet, or when writing a new `#[special]` extractor.
