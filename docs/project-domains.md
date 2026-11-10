# Project domains

Projects can add domains they own and publish routes on them. The backend
verifies ownership, issues certificates with the email of the user who added
the domain and serves HTTP routes through a dedicated Traefik ("the edge").
Pangolin keeps serving the platform domains.

## Flow

1. A project adds a domain (`PUT /api/project/{id}/domain`). The response
   lists the DNS records the owner has to create:
   - `TXT _novium-verify.<domain>`: proves ownership. A job checks pending
     domains every five minutes; `POST .../{domain_id}/verify` checks right
     away. Unverified domains are dropped after a week.
   - `CNAME _acme-challenge.<domain>` to `<hash>.<BACKEND_ACME_CHALLENGE_ZONE>`:
     delegates the ACME DNS-01 challenges (only when certificates are enabled).
2. Once verified, a job issues a certificate for `<domain>` and `*.<domain>`
   from the ACME account of the user who added the domain, with their email as
   the contact. It renews once two thirds of the lifetime have passed and
   retries failures after an hour. Errors are shown on the domain.
3. Routes on the domain publish no DNS records. Each route's `records` lists
   the ones the owner has to create:
   - HTTP routes: `CNAME <sub>.<domain>` to `BACKEND_EDGE_PUBLIC_HOST`. They
     are served by the edge.
   - TCP and UDP routes: the SRV (and A/AAAA) records pointing at the node.

   An empty subdomain puts the route on the domain itself, which only project
   domains allow. At the top of a zone a CNAME is not allowed, so the owner
   needs ALIAS, ANAME or CNAME flattening there.

   Other subdomains of the domain are left alone, wherever they are hosted.

## Traffic

```text
client ──443 (TLS)──> Pangolin's Traefik ──SNI passthrough──> edge Traefik ──> server port
client ──80────────>  Pangolin's Traefik ──Host forward────> edge Traefik ──> server port
```

Pangolin's Traefik never terminates TLS for project domains. It only passes
through the hostnames of HTTP routes on verified project domains, one router
per route. TCP routers apply before HTTP routers on the same entry point, so
every other hostname, including other subdomains of a project domain, keeps
reaching Pangolin's own routers.

The edge forwards to `server_ports.host:external_port`, the same target
Pangolin uses, so it has to reach the nodes directly.

## Backend configuration

See `backend/.env.example`:

- `BACKEND_ACME_CHALLENGE_ZONE` enables certificates and needs
  `BACKEND_CLOUDFLARE_API_TOKEN`. It is a name inside one of the token's
  zones; the challenge TXT records are created below it.
- `BACKEND_ACME_DIRECTORY_URL` defaults to Let's Encrypt production. Use
  `https://acme-staging-v02.api.letsencrypt.org/directory` for testing.
- `BACKEND_EDGE_TOKEN` enables the edge, together with
  `BACKEND_EDGE_PUBLIC_HOST`, `BACKEND_EDGE_HTTPS_ADDRESS`,
  `BACKEND_EDGE_HTTP_URL`, `BACKEND_EDGE_ROOT_KEY` and
  `BACKEND_EDGE_PROXY_PROTOCOL`.

## Edge Traefik

It loads its routers, services and certificates from the backend:

```yaml
entryPoints:
  web:
    address: ":80"
    forwardedHeaders:
      trustedIPs: ["<pangolin traefik address>"]
  websecure:
    address: ":443"
    proxyProtocol:
      trustedIPs: ["<pangolin traefik address>"]

providers:
  http:
    endpoint: "https://<backend>/api/internal/edge/traefik"
    pollInterval: "10s"
    headers:
      Authorization: "Bearer <BACKEND_EDGE_TOKEN>"
```

The response contains the certificates' private keys, so the endpoint must
only be reachable over TLS or a private network. `proxyProtocol` is only needed
with `BACKEND_EDGE_PROXY_PROTOCOL=true`.

## Pangolin's Traefik

Add a Redis provider next to Pangolin's HTTP and file providers:

```yaml
providers:
  redis:
    endpoints: ["<valkey host>:6379"]
    rootKey: "novium-edge"
```

The backend writes one TCP passthrough router (`websecure`) and one HTTP
router (`web`) per HTTP route on a verified project domain under the root key, plus the
services pointing at the edge. Traefik only picks up changes when Valkey has
keyspace notifications enabled, for example `notify-keyspace-events KEA`.
