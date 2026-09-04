CREATE TABLE sessions (
    id uuid PRIMARY KEY,
    "user" integer NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash char(64) NOT NULL UNIQUE,
    user_agent varchar(512),
    ip_address varchar(64),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    absolute_expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_user_idx ON sessions ("user");

CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);
