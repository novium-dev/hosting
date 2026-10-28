# Legacy compatibility

Code that only exists so older deployments and data keep working. Each entry
says what it covers, where it lives and what removing it takes.

## Key import from `BACKEND_DATA_DIR`

The CA and backend keys live in the `backend_keys` table. Before that, every
instance generated `backend_root.pem` and `backend.pem` in `BACKEND_DATA_DIR`.
On startup, if `backend_keys` is empty, the backend imports those two files
instead of generating new keys, so existing nodes and database hosts keep
trusting it.

Where:

- `backend/src/crypto.rs` - `read_legacy` and its use in `load_or_store`
- `backend/src/main.rs` - reading `BACKEND_DATA_DIR` and passing it to `crypto::load_keys`
- `backend/.env.example` - the `BACKEND_DATA_DIR` note
- `deploy/compose.yml`, `deploy/prod/compose.yml`, `deploy/prod/.env` - `BACKEND_DATA_DIR` and the `backend_data` volume
- `deploy/README.md` - the import paragraph

Remove once every deployment has started at least once on a version with
`backend_keys`, so the table is filled everywhere. After that, drop the
`data_dir` parameter, `read_legacy`, the env var and the volume.

## Optional server group

Servers created before groups existed have no group, so `servers.group_id` is
nullable and the API treats the group as optional.

Where:

- `backend/migrations/20261004000000_groups.sql` - `group_id` is nullable, and
  the foreign key to `node_groups` uses `ON DELETE SET NULL (group_id)`, so
  removing a node from a group also clears the group on its servers
- `backend/src/db/server/mod.rs`, `backend/src/db/server/provision.rs` - `group: Option<i32>`;
  provisioning sends `""` to the daemon when there is no group
- `backend/src/service/server.rs` - `ServerInfo.group` is optional, and
  `update_server` clears the group when `group.id` is `null`
- `backend/src/service/admin/server.rs` - `group: Option<i32>` on server creation
- `frontend/app/(app)/admin/servers/create/server-create-form.tsx` and
  `frontend/app/(app)/admin/servers/[server]/server-admin-settings.tsx` - the
  "No group" option (`NO_GROUP`, `admin-infra:servers.shared.noGroup`)

Making it required takes:

1. Assigning a group to every server that has none.
2. A migration making `servers.group_id` `NOT NULL` and replacing the
   `ON DELETE SET NULL` behavior, for example by refusing to remove a node from
   a group while servers still use it.
3. Making `group` non-optional in the backend types and handlers, and dropping
   the `null` clearing in `update_server`.
4. Removing the "No group" option and its translation keys (`en` and `de`) from the frontend.

## Unknown template release

Servers created before template releases were tracked have no recorded
release, so `servers.template_rel` is nullable and the resync preview shows
their release as unknown. Any build push (resync, template change, port or
startup change) fills it in.

Where:

- `backend/migrations/20261028000000_server_template_rel.sql` - the nullable column
- `backend/src/db/server/resync.rs` - `ServerResyncPreview::rel` is optional
- `frontend/app/(app)/admin/templates/templates-view.tsx` - the unknown label

Remove once every server has been resynced at least once. After that, make the
column `NOT NULL` and drop the optional handling.

## Pterodactyl nginx configs in web servers

Web servers moved over from Pterodactyl keep their `nginx/conf.d/*.conf`,
which point at `/home/container` and a php-fpm unix socket. On every start the
web entrypoint rewrites `/home/container` to `/work` and the socket to
`127.0.0.1:9000`.

Where:

- `backend/src/templates/generic/web/entrypoint.sh` - the `/home/container`
  check in the nginx branch

Remove once no web server has a config mentioning `/home/container`, then bump
`REL` in `backend/src/templates/generic/web.rs`.
