CREATE TABLE server_licenses (
    server char(6) NOT NULL REFERENCES servers (id) ON DELETE CASCADE,
    license varchar(64) NOT NULL,
    accepted_by integer REFERENCES users (id) ON DELETE SET NULL,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (server, license)
);
