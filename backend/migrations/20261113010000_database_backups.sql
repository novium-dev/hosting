ALTER TABLE database_instances
    ADD COLUMN backup_limit integer CHECK (backup_limit IS NULL OR backup_limit >= 0);

CREATE TABLE database_backup_jobs (
    instance uuid NOT NULL REFERENCES database_instances (id) ON DELETE CASCADE,
    database uuid NOT NULL,
    enabled boolean NOT NULL,
    cron varchar(128) NOT NULL,
    timezone varchar(64) NOT NULL,
    retention jsonb NOT NULL,
    next_run timestamptz,
    prune_pending boolean NOT NULL DEFAULT false,
    last_run timestamptz,
    last_error text,
    PRIMARY KEY (instance, database)
);

CREATE INDEX database_backup_jobs_next_run_idx ON database_backup_jobs (next_run) WHERE enabled;
