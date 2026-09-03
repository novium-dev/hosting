ALTER TABLE server_modpacks
    ADD COLUMN loader varchar(32),
    ADD COLUMN version_number varchar(128),
    ADD COLUMN icon_url text,
    ADD COLUMN page_url text;
