-- The modpack installed on a server, and the files it put there.
--
-- Without this, every mod a pack installs looks like a hand-uploaded file: the
-- pack writes jars directly rather than one record per mod, so reconciliation
-- reported all of them as unmanaged. Recording the file list lets those files be
-- attributed to the pack instead.
--
-- One pack per server (a server runs one pack), so the server is the key. The
-- paths are stored as an array: they are read and written as one set, never
-- queried individually, and a pack is commonly several hundred entries.
CREATE TABLE server_modpacks (
    server char(6) PRIMARY KEY REFERENCES servers (id) ON DELETE CASCADE,
    provider varchar(32) NOT NULL,
    project varchar(128) NOT NULL,
    version varchar(128) NOT NULL,
    title varchar(255) NOT NULL,
    files text[] NOT NULL DEFAULT '{}',
    installed_at timestamptz NOT NULL DEFAULT now()
);
