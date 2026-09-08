# zelus macro reference

Source of truth: `~/.cargo/git/checkouts/zelus-991ff131a1eb11b4/<rev>/` where `<rev>` is the hash in `Cargo.lock` under `name = "zelus"`. `zelus/examples/` has one small file per feature; `zelus_macros/src/` is the parser if you need to settle an argument's exact syntax.

## Contents

- [`#[service(...)]` options](#service-options)
- [`#[route(...)]` options](#route-options)
- [Multiple routers (`routes = [...]`)](#multiple-routers)
- [`#[error(...)]` and `define_error!`](#errors)
- [Automatic conversions (`<-`)](#automatic-conversions)
- [Path, query and header variables](#variables)
- [`#[special]` extractors](#special-extractors)
- [Payloads and examples](#payloads)
- [Response types](#response-types)
- [Websockets](#websockets)
- [Router assembly](#router-assembly)
- [Error group catalog](#error-group-catalog)

## Service options

```rust
#[service(path = "/admin/route", tag = "route", no_sdk)]
```

| Option | Meaning |
|---|---|
| `path = "…"` | prefix prepended to every route in the block. May contain `{variables}` shared by all routes (e.g. `path = "/file/{server_id}"`). |
| `tag = "…"` | OpenAPI tag; groups the endpoints in the docs UI. |
| `no_sdk` | skip generating the reqwest client. Every backend service sets this — nothing consumes the backend over a Rust SDK. Agent/daemon traits omit it, which is what produces `DatabaseAgentSDK` / `DaemonSDK`. |

Applies to either an `impl … for Type` block (backend style) or a `trait` (agent style, implemented separately with `#[zelus::async_trait]`).

## Route options

```rust
#[route("/domains/{domain_id}/routes", method = GET, query = [ project ], raw, no_auth, routes = [ dev_auth ])]
```

| Option | Meaning |
|---|---|
| `"path"` | appended to the service `path`. |
| `!"path"` | leading `!` escapes the service prefix — the path is absolute. |
| `method = GET` | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`, `WS`. |
| `query = [ a, b ]` | query parameter names, each needing a `define_query_variable!`. An inline string literal after the name overrides the description: `query = [ page "The page" ]`. |
| `raw` | do not wrap the `Ok` value in the JSON response wrapper — see [Response types](#response-types). |
| `no_auth` | place the route in the `without_auth` router instead of `with_auth`, and skip the automatic `auth::invalid` error variant. |
| `routes = [ name, … ]` | which named routers the route joins; defaults to `[ default ]`. |

Every route additionally lands in `with_auth` or `without_auth` automatically depending on `no_auth`; those two names always exist and cannot be redefined.

## Multiple routers

`routes = [...]` exists so one service can serve several listeners — an internal port, a dev-only port, a public one. `framework_router!` then materializes one router per name:

```rust
let (default_router,) = framework_router!(Self self (default,) { ServerService, FileService, … });
let (dev_auth_router,) = framework_router!(Self self (dev_auth,) { AuthService });
```

In this repo only `default` and `dev_auth` are used — `dev_auth` carries `GET /auth/login/dev`, merged into the router only under `cfg!(feature = "auth_dev")`, which is how the dev sign-in endpoint stays out of release builds.

## Errors

`define_error!` declares a category of reusable errors, each with a message and an HTTP status (any `http::StatusCode` constant name):

```rust
define_error!(route {
    domain_not_found("The specified route domain was not found" NOT_FOUND),
    domain_exists("A route domain with this name already exists" BAD_REQUEST),
});
```

A handler's `#[error(...)]` picks variants from those categories:

```rust
#[error(auth::{permission_denied, unreachable}, route::domain_not_found, db::failure <- [sql:*])]
```

- `category::variant` — one variant
- `category::{a, b}` — several from one category
- The generated enum is `<FnName>Error` in module `<service_trait_snake>_error`, e.g. `route_admin_service_error::ListDomainRoutesError`
- Variant identifier = `CamelCase(category) + CamelCase(variant)` — `route::domain_not_found` → `RouteDomainNotFound`
- Returning `Result<T, _>` is required for the macro to synthesize the enum
- Routes without `no_auth` get an `auth::invalid` variant added automatically
- Generated enums also carry a `Communication(reqwest::Error)` variant on the SDK side; when consuming an agent/daemon SDK, match it separately from the semantic variants (the repo logs it and maps it to `node::failure`)

`error!(Name, category::{a, b})` (from `zelus::error`) defines a standalone reusable error type instead, for handlers that share one error surface. `BlankError` is the empty one.

Inline one-off variants are possible — `#[error((Custom, "message", IM_A_TEAPOT))]` — but the repo never uses them; a named group entry is discoverable and reusable.

## Automatic conversions

`variant <- [source:kind, …]` generates `From` impls so `?` works directly on foreign error types.

| Source | Kinds |
|---|---|
| `sql` | `*` (catch-all), `not_found` (`RowNotFound`), `unique`, `foreign_key`, `check` |
| `redis` | `*` only |
| `io` | `*`, or any `std::io::ErrorKind` variant name, e.g. `io:NotFound` |

Order does not matter: specific kinds are tested first, the `*` variant is the fallback. A handler that touches Postgres essentially always wants `db::failure <- [sql:*]`, and adds `<- [sql:foreign_key]` on a typed variant when a constraint has a meaningful user-facing message.

## Variables

Path, query and header parameter *names* must be declared once so the macro can attach a description:

```rust
define_path_variable!(domain_id "The route domain ID");
define_query_variable!(project "The project the domains are listed for");
define_header_variable!(x_request_id "The request ID");
```

Shared names live in `backend/src/service/mod.rs`; names used by a single service are declared at the top of that file (see `define_query_variable!(include …)` in `service/server.rs`). The macro resolves them by generated module name (`variable_path_domain_id`), so a missing declaration shows up as an unresolved-module error.

Header parameters are typed extractors, e.g. `header: TypedHeader<Authorization<Bearer>>`.

## Special extractors

`#[special]` marks an argument resolved from request parts rather than the path, query or body — the framework's equivalent of an axum extractor:

```rust
async fn logout(&self, #[special] auth: UserAuthentication) -> Result<WithCookies<()>, _>
```

In this repo: `Authentication` (optional session/API key, carries the permission picture), `UserAuthentication` (required), `ClientInfo` (user agent + client IP), `PreviousSession`, `Option<PageSplit>` (pagination).

To write a new one, implement `zelus::special::FromRequestParts<E>` (the error type is generic so any handler's error enum can absorb it), plus `DocumentedType` if it should shape the OpenAPI docs, plus `IntoRequestParts` if the service generates an SDK (`no_sdk` waives it). `zelus/examples/special_variable.rs` is the minimal template.

## Payloads

- One non-path, non-query, non-special argument of a `Serialize + Deserialize + ToSchema` type → that type is the request body.
- Several such arguments → the macro synthesizes a body object with those field names.
- `#[example("../examples/server.create.json")]` above the route attaches a request example to the docs (see `backend/src/service/admin/server.rs`).
- `DataStream` as the payload takes the raw body as a stream (agent import endpoints).

## Response types

Default: the `Ok` value is JSON-encoded by the framework.

`raw` hands it to axum untouched, so the type controls its own status, headers and body. It must implement `IntoResponse` (for axum) and `DocumentedResultResponse` (so the OpenAPI response stays accurate). Used in this repo for:

| Type | Why |
|---|---|
| `Paged<T>` (`backend/src/utils/mod.rs`) | pagination headers alongside the body |
| `WithCookies<T>` (`backend/src/auth/user.rs`) | `Set-Cookie` on login/logout |
| `FileResponse`, `Redirect` (`zelus::responses`) | file downloads, OAuth redirects |
| `()` | empty 200 rather than a JSON `null` |

## Websockets

`method = WS` makes the route a websocket upgrade; the macro injects the `WebSocketUpgrade` extractor ahead of the declared arguments and returns `WebsocketResponse`. No SDK client is generated for websocket routes.

## Router assembly

`backend/src/http.rs` merges every service into the axum router:

```rust
let (default_router,) = framework_router!(Self self (default,) { ServerService, FileService, … });
```

The tuple has one element per router name in the parentheses, in order. A new service is only reachable once its trait is imported there and its name appears in that list — this is the step most easily forgotten, and it fails silently at runtime (404) rather than at compile time.

`ZelusRouter::with_openapi(...).merge(router).into_openapi().split_for_parts()` yields the axum router and the OpenAPI document; the latter is served at `/api/docs` in debug builds only.

## Error group catalog

Most groups are defined in `backend/src/service/mod.rs`; a few live next to the service that owns them (`template`, `session`, `profile`, `api_key`, `modpack`, `internal_daemon`). Skim before inventing a variant — the odds are good that one exists.

| Group | Covers |
|---|---|
| `auth` | `invalid`, `failure`, `unreachable`, `permission_denied` |
| `server` | not found, storage, availability, suspension, config/startup/environment validation |
| `project` | not found, not empty, slug/expiry/owner validation |
| `user` | not found, owns projects |
| `file` | sandbox, existence, type, quota, mode/owner validation |
| `resource` | provider availability, payload validity, template compatibility |
| `backup` | storage selection, limits, quota, compression |
| `port` | range validity, allocation, collision, in use |
| `route` | route/domain existence, subdomain and zone validation, backend availability |
| `schedule`, `node`, `region`, `database`, `feature`, `integrity`, `license`, `os` | see the file for the current entries |
| `db`, `cache` | storage and Valkey catch-alls |

`db::failure`, `cache::failure` and `node::failure` are the three infrastructure catch-alls; they map storage, Valkey and daemon/agent transport failures respectively and should be logged with `tracing` before being returned.
