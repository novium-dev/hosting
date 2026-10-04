CREATE TABLE groups (
    name varchar(200) PRIMARY KEY,
    CONSTRAINT groups_name_check CHECK (name ~ '^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$')
);

CREATE TABLE node_groups (
    node uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    group_name varchar(200) NOT NULL REFERENCES groups (name) ON DELETE CASCADE,
    cpu real CHECK (cpu IS NULL OR cpu > 0),
    ram integer CHECK (ram IS NULL OR ram > 0),
    swap integer CHECK (swap IS NULL OR swap >= 0),
    PRIMARY KEY (node, group_name)
);

CREATE INDEX node_groups_group_idx ON node_groups (group_name);

ALTER TABLE servers ADD COLUMN node_group varchar(200);

ALTER TABLE servers
    ADD CONSTRAINT servers_node_group_fkey FOREIGN KEY (node, node_group)
    REFERENCES node_groups (node, group_name) ON DELETE SET NULL (node_group);

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

CREATE TABLE database_host_groups (
    host uuid NOT NULL REFERENCES database_hosts (id) ON DELETE CASCADE,
    group_name varchar(200) NOT NULL REFERENCES groups (name) ON DELETE CASCADE,
    PRIMARY KEY (host, group_name)
);

CREATE INDEX database_host_groups_group_idx ON database_host_groups (group_name);

ALTER TABLE nodes DROP COLUMN region;
ALTER TABLE database_hosts DROP COLUMN region;

DROP TABLE regions;
