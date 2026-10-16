CREATE TABLE server_modpack_files (
    server char(6) NOT NULL REFERENCES server_modpacks (server) ON DELETE CASCADE,
    path text NOT NULL,
    project varchar(128),
    version varchar(128),
    title varchar(255),
    icon_url text,
    page_url text,
    PRIMARY KEY (server, path)
);

INSERT INTO server_modpack_files (server, path)
SELECT server, unnest(files)
FROM server_modpacks
ON CONFLICT DO NOTHING;

ALTER TABLE server_modpacks
    DROP COLUMN files,
    ADD COLUMN game_version varchar(64),
    ADD COLUMN loader_version varchar(64);
