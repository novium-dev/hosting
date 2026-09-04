ALTER TABLE servers
    ADD COLUMN env_file_enabled boolean NOT NULL DEFAULT false,
    ADD COLUMN env_file_path varchar(255) NOT NULL DEFAULT '.env';
