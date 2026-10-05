CREATE TABLE backend_keys (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    root_key TEXT NOT NULL,
    backend_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
