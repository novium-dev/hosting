CREATE TABLE groups (
    name varchar(200) PRIMARY KEY,
    CONSTRAINT groups_name_check CHECK (name ~ '^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$')
);

INSERT INTO groups (name) SELECT DISTINCT name FROM node_groups;

ALTER TABLE node_groups DROP CONSTRAINT node_groups_name_check;
ALTER TABLE node_groups RENAME COLUMN name TO group_name;
ALTER TABLE node_groups
    ADD CONSTRAINT node_groups_group_name_fkey FOREIGN KEY (group_name)
    REFERENCES groups (name) ON DELETE CASCADE;

CREATE INDEX node_groups_group_idx ON node_groups (group_name);

ALTER TABLE nodes ADD COLUMN overallocation integer NOT NULL DEFAULT 100
    CHECK (overallocation > 0 AND overallocation <= 1000);

CREATE TABLE deploy_configs (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(64) NOT NULL UNIQUE,
    group_name varchar(200) NOT NULL REFERENCES groups (name),
    template varchar(64) NOT NULL,
    variables jsonb NOT NULL,
    cpu real NOT NULL CHECK (cpu > 0),
    ram integer NOT NULL CHECK (ram > 0),
    swap integer NOT NULL CHECK (swap >= 0),
    disk bigint CHECK (disk IS NULL OR disk > 0),
    internet_access boolean NOT NULL DEFAULT true,
    backup_limit integer CHECK (backup_limit IS NULL OR backup_limit >= 0)
);

CREATE INDEX deploy_configs_group_idx ON deploy_configs (group_name);
