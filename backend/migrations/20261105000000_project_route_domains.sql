ALTER TABLE route_domains
    ADD COLUMN project char(6) REFERENCES projects (id) ON DELETE CASCADE,
    ADD COLUMN created_by integer REFERENCES users (id) ON DELETE SET NULL,
    ADD COLUMN verification_token varchar(64),
    ADD COLUMN verified_at timestamptz,
    ADD COLUMN verify_checked_at timestamptz,
    ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
    ADD CONSTRAINT route_domains_project_token_check
        CHECK (project IS NULL OR verification_token IS NOT NULL);

ALTER TABLE route_domains DROP CONSTRAINT route_domains_domain_key;

CREATE UNIQUE INDEX route_domains_claimed_idx ON route_domains (domain)
    WHERE project IS NULL OR verified_at IS NOT NULL;

CREATE UNIQUE INDEX route_domains_project_domain_idx ON route_domains (project, domain)
    WHERE project IS NOT NULL;

CREATE INDEX route_domains_pending_idx ON route_domains (created_at)
    WHERE project IS NOT NULL AND verified_at IS NULL;

UPDATE project_users SET permissions = permissions | 0x800000
WHERE permissions & 0x10000 = 0x10000;

UPDATE api_keys SET permissions = permissions | 0x800000
WHERE permissions & 0x10000 = 0x10000;
