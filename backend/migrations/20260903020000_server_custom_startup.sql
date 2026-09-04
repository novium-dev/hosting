ALTER TABLE servers
    ADD COLUMN custom_startup varchar(4000),
    ADD COLUMN custom_environment jsonb NOT NULL DEFAULT '{}'::jsonb;
