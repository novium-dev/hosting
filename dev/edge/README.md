# Local edge stack

Runs the whole project-domain flow locally: verification, ACME issuance and
HTTP routes through both Traefiks. Nothing leaves the machine.

| Service            | Stands in for                          | Host port             |
| ------------------ | -------------------------------------- | --------------------- |
| `challtestsrv`     | the user's DNS provider and public DNS | 8053 (DNS), 8055 (API)|
| `pebble`           | Let's Encrypt                          | 14000, 15000          |
| `cloudflare`       | Cloudflare API for the challenge zone  | 18999                 |
| `pangolin-traefik` | Pangolin's Traefik (Redis provider)    | 18080, 18443          |
| `edge`             | the edge Traefik                       | -                     |
| `whoami`           | a game server's HTTP port (`:25565`)   | -                     |

## Start

```bash
docker compose -f dev/compose.yml up -d
docker compose -f dev/edge/compose.yml up -d
docker exec backend_valkey valkey-cli CONFIG SET notify-keyspace-events KEA
```

Run the backend with these on top of `.env`:

```bash
set -a && . ./.env && set +a && \
BACKEND_CLOUDFLARE_API_TOKEN=dev \
BACKEND_CLOUDFLARE_API_URL=http://localhost:18999/client/v4/ \
BACKEND_ACME_CHALLENGE_ZONE=acme.novium.test \
BACKEND_ACME_DIRECTORY_URL=https://localhost:14000/dir \
BACKEND_ACME_ROOT_CA=$PWD/dev/edge/pebble.minica.pem \
BACKEND_DNS_RESOLVER=127.0.0.1:8053 \
BACKEND_EDGE_TOKEN=dev-edge-token \
BACKEND_EDGE_PUBLIC_HOST=edge.novium.test \
BACKEND_EDGE_HTTPS_ADDRESS=edge:443 \
BACKEND_EDGE_HTTP_URL=http://edge:80 \
BACKEND_EDGE_PROXY_PROTOCOL=true \
cargo run -p backend --features auth_dev
```

## Walk through

1. Add a domain such as `example.test` on the project's domains page.
2. Create the records it lists in `challtestsrv`, as the user would at their
   DNS provider:

   ```bash
   ./dev/edge/dns.sh txt _novium-verify.example.test novium-verify=<token>
   ./dev/edge/dns.sh cname _acme-challenge.example.test <hash>.acme.novium.test
   ```

3. Click "Check now". Verification starts the certificate issuance right away;
   the certificate shows up on the domain after a few seconds.
4. Point an HTTP port at `whoami` and create a route on the domain:

   ```bash
   docker exec backend_postgres psql -U postgres -d backend \
     -c "UPDATE server_ports SET host = 'whoami', http = true WHERE id = <port id>"
   ```

5. Call it through Pangolin's Traefik, trusting Pebble's root:

   ```bash
   curl -sk https://localhost:15000/roots/0 > /tmp/pebble-root.pem
   curl --cacert /tmp/pebble-root.pem \
     --resolve <sub>.example.test:18443:127.0.0.1 https://<sub>.example.test:18443/
   ```

Pebble's root changes on every restart, so fetch it again after one.
Restore the port afterwards (`host`, `http`) to what it was.
