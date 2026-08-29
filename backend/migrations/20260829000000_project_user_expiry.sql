ALTER TABLE project_users ADD COLUMN expires_at timestamptz;

CREATE INDEX project_users_expires_at_idx ON project_users (expires_at) WHERE expires_at IS NOT NULL;
