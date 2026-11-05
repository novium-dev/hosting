CREATE TABLE acme_accounts (
    "user" integer PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    directory_url text NOT NULL,
    email varchar(255) NOT NULL,
    credentials jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_domain_certificates (
    domain integer PRIMARY KEY REFERENCES route_domains (id) ON DELETE CASCADE,
    certificate_pem text,
    private_key_pem text,
    issued_at timestamptz,
    expires_at timestamptz,
    last_attempt_at timestamptz,
    last_error text,
    CHECK ((certificate_pem IS NULL) = (private_key_pem IS NULL)),
    CHECK ((certificate_pem IS NULL) = (expires_at IS NULL))
);
