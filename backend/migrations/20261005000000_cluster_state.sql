CREATE TABLE backend_keys (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    root_key TEXT NOT NULL,
    backend_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE node_registrations (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_host TEXT NOT NULL,
    config JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE database_host_registrations (
    code TEXT PRIMARY KEY,
    display TEXT NOT NULL,
    groups TEXT[] NOT NULL,
    public_host TEXT NOT NULL,
    config JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
