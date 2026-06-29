-- Add migration script here

/*
CREATE TABLE node_server_storage (
                                     node uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
                                     storage varchar(64) NOT NULL,
                                     storage_type varchar(32) NOT NULL,
                                     "group" varchar(64),
                                     PRIMARY KEY (node, storage)
);

CREATE TABLE node_backup_storage (
                                     node uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
                                     storage varchar(64) NOT NULL,
                                     storage_type varchar(32) NOT NULL,
                                     "group" varchar(64),
                                     PRIMARY KEY (node, storage)
);*/

-- lets refactor to only node -> storage
ALTER TABLE node_server_storage
    DROP COLUMN storage_type,
    DROP COLUMN "group";

ALTER TABLE node_backup_storage
    DROP COLUMN storage_type,
    DROP COLUMN "group";