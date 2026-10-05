# Deploying novium

Three images, built and deployed independently:

| Image | Dockerfile | Context |
| --- | --- | --- |
| backend | `backend.Dockerfile` | repo root |
| frontend | `frontend/Dockerfile` | `frontend/` |
| database agent | `database_agent.Dockerfile` | repo root |

The backend and the database agent need SSH access to the private git
dependencies, so build them with `--ssh default`:

```bash
docker build --ssh default -f backend.Dockerfile -t novium/backend:latest .
docker build -f frontend/Dockerfile -t novium/frontend:latest frontend
docker build --ssh default -f database_agent.Dockerfile -t novium/database-agent:latest .
```

## The stack

`compose.yml` runs Traefik, the backend, the SPA, Postgres and Valkey. Traefik
terminates TLS on one host and splits by path, which is what the backend used to
do internally:

- `Host(DOMAIN) && (PathPrefix(/api/) || Path(/api))` → backend (priority 100)
- `Host(DOMAIN)` → frontend (priority 1)

Matching `/api/` rather than the prefix `/api` keeps paths like `/apifoo` on the
SPA, which is where the backend's own fallback used to send them.

Same origin for both means the httpOnly session cookie and the origin check in
`backend/src/auth/csrf.rs` keep working unchanged.

```bash
cd deploy
cp .env.example .env    # DOMAIN, ACME_EMAIL, image tags, Postgres password, OIDC client
docker compose up -d
```

The backend has no config file — it reads everything from the environment, and
`compose.yml` derives most of it from `.env`: `BACKEND_PUBLIC_URL` and
`BACKEND_AUTH_REDIRECT_URL` from `DOMAIN`, `BACKEND_DATABASE_URL` from the
Postgres credentials. `backend/.env.example` documents every variable it reads,
including the ones `compose.yml` does not pass through.

Migrations run at startup, so the backend brings an empty Postgres up to date
on its own. The CA and backend keys live in Postgres too (`backend_keys`): the
first instance to start generates them, or imports `backend_root.pem` and
`backend.pem` from `BACKEND_DATA_DIR` (`/data` here) if an older deployment left
them there. Once imported, the data volume is no longer read.

## Running several instances

Both images are stateless, so either can be scaled behind the load balancer:

```bash
docker compose up -d --scale backend=3 --scale frontend=2
```

Everything instance-wide lives in Postgres or Valkey: sessions, OAuth flows,
the keys, node and database host setup codes, modpack install and integrity run
progress, and template caches. No sticky sessions are needed.

- Node and database host changes are broadcast with Postgres `NOTIFY`, and every
  instance reloads its in-memory node and host maps. Each instance holds one
  extra Postgres connection for this, on top of its pool of 5, so size
  Postgres' `max_connections` for that.
- Background jobs (modpack installs, integrity runs) run on the instance that
  accepted them and hold a Valkey lock refreshed every minute. If that instance
  dies, the lock expires after 3 minutes and the job reads as failed.
- Only one instance refreshes a template's upstream cache per interval, the rest
  read the result from Valkey.
- `GET /api/health` returns 200 while the instance can reach Postgres, and 503
  otherwise; Traefik uses it to take an instance out of rotation.

## Serving the SPA from a different origin

Build the frontend with `--build-arg VITE_API_URL=https://api.example.com` and
add that origin to `trusted_urls` in the backend config. The session cookie is
`SameSite=Lax`, so a cross-site frontend needs the cookie relaxed as well —
the same-origin layout above avoids that entirely.

## Database agent

The agent runs on its own host (it needs the Docker socket and binds the engine
proxy ports directly); see `../compose.yml`.

It authenticates with mTLS against the same CA the backend uses for daemons, so
a fresh agent has to register before it can serve. Create the database host in
the admin panel, which returns a setup code, then start the agent once with an
empty data directory and

```
SETUP_URL=https://panel.example.com SETUP_TOKEN=<code>
```

set. Setup pulls the CA and the intended config from the backend, proves it is
reachable on the registered base URL, and writes `config.toml`, `agent_root.pem`
and `agent.pem` into `DATABASE_AGENT_DATA_DIR`. Later starts find the config and
run normally; keep those three files on a persistent volume.
