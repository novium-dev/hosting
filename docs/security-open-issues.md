# Open security issues

Known issues from the security audit that are not fixed yet. Both need changes in the daemon as well as here.

## SSRF from nodes through resource downloads

The backend hands download URLs to the daemon (`server_write_file_by_url`), and the daemon fetches them with its shared `reqwest` client: redirects are followed and private, loopback and link-local addresses are not blocked. The response lands in the server's files, so the user can read it.

URLs the user can influence:

- **Hangar `external_url`** (`backend/src/resources/hangar.rs`, `resolve`): used when a version has no `download_url`. The plugin author picks it freely, so anyone who publishes on Hangar can point it at an internal address.
- **Modpack files** (`backend/src/service/modpack.rs`, `prepare_pack`): the pack is unpacked into `.novium-modpack/` inside the server directory and `modrinth.index.json` is read back from there afterwards, so anyone who can write to the server's files can swap the manifest in between. Download URLs are checked against the Modrinth allowlist (`cdn.modrinth.com`, `github.com`, `raw.githubusercontent.com`, `gitlab.com`, `allowed_download` in `backend/src/resources/modpack.rs`), so a swapped manifest can only point at those hosts. Redirects from them are still followed by the daemon.

Impact: requests from the node's network position (cloud metadata endpoints, services bound to the node or its private network) with the response readable by the user.

Possible fixes:

- Daemon: resolve the host and refuse non-global addresses (loopback, private, link-local, unique-local, metadata), check every redirect hop the same way, or disable redirects.
- Backend: drop `external_url`, or only accept it from an allowlist of hosts.
- Backend: read the modpack manifest from the archive before it is written to user-writable storage.

## Setuid escalation inside server containers

`chmod_file` (`backend/src/service/file.rs`) accepts modes up to `0o7777`, and `chown_file` accepts any `uid` and `gid`, including 0. The daemon applies both as given (`daemon/src/files/chmod.rs`, `daemon/src/files/chown.rs`, also reachable through SFTP `setstat`).

Server containers run as an unprivileged `uid:gid`, but are created without `no-new-privileges` and the server directory is bind-mounted without `nosuid`. A user with `FILES_WRITE` can upload a binary, chown it to root and set the setuid bit, then execute it from the console and become root inside the container (with Docker's default capabilities).

Possible fixes:

- Backend and daemon (including SFTP): reject the setuid, setgid and sticky bits (`mode & 0o7000`) and only allow chown to the server's own uid and gid.
- Daemon: create containers with `security_opt: ["no-new-privileges:true"]`.
- Daemon: mount the server storage with `nosuid` (and consider user namespace remapping).

## No TLS on the database proxies

The Postgres proxy answers `SSLRequest` with `N`, MariaDB uses `mysql_native_password`, and Redis and MongoDB are plaintext. Traffic and, for MariaDB, material for offline password guessing are exposed on the network.

Possible fix: terminate TLS in the proxies with a certificate for the host's public name.

## Smaller items

- The backup limit is checked against the node's backup list before the backup is ordered, so concurrent requests can exceed it. The check has to move to the daemon.
- There is no rate limiting on login, API or proxy authentication.
- Server containers have no pids limit unless the cgroup slice sets one.
