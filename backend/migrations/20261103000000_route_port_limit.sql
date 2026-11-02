CREATE UNIQUE INDEX routes_port_unique_idx ON routes (port);

CREATE TABLE route_port_cooldowns (
    port integer PRIMARY KEY REFERENCES server_ports (id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);
