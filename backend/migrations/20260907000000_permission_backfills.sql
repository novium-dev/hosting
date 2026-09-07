CREATE TABLE permission_backfills (
    id varchar(64) PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
