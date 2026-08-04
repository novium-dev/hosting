-- Installed mods/plugins/data packs per server.
--
-- Previously the frontend inferred the installed set by listing `mods/` and
-- `plugins/` and matching file names against every version of every search hit
-- (one upstream request per hit). One row per installed project makes the
-- lookup a single indexed read and keeps the provider/project/version identity
-- that file names cannot express.
CREATE TABLE server_resources (
    server char(6) NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL,
    project varchar(128) NOT NULL,
    version varchar(128) NOT NULL,
    resource_type varchar(32) NOT NULL,
    file_name varchar(255) NOT NULL,
    title varchar(255) NOT NULL,
    installed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (server, provider, project)
);

CREATE INDEX server_resources_server_idx ON server_resources (server);
