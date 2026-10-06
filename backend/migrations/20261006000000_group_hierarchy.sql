CREATE TEMP TABLE legacy_groups AS SELECT name FROM groups;
CREATE TEMP TABLE legacy_node_groups AS SELECT node, group_name, cpu, ram, swap FROM node_groups;
CREATE TEMP TABLE legacy_server_groups AS SELECT id, node_group FROM servers WHERE node_group IS NOT NULL;
CREATE TEMP TABLE legacy_deploy_configs AS SELECT * FROM deploy_configs;
CREATE TEMP TABLE legacy_database_host_groups AS SELECT host, group_name FROM database_host_groups;

ALTER TABLE servers DROP COLUMN node_group;
DROP TABLE deploy_configs, database_host_groups, node_groups, groups;

CREATE TABLE groups (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(64) NOT NULL CHECK (char_length(name) > 0),
    parent integer REFERENCES groups (id),
    UNIQUE NULLS NOT DISTINCT (parent, name)
);

CREATE INDEX groups_parent_idx ON groups (parent);

CREATE VIEW group_paths AS
WITH RECURSIVE tree AS (
    SELECT id, parent, name, ARRAY[name::text] AS path, 'g' || id AS daemon_name, 1 AS depth
    FROM groups
    WHERE parent IS NULL
    UNION ALL
    SELECT groups.id, groups.parent, groups.name, tree.path || groups.name::text,
           tree.daemon_name || '-g' || groups.id, tree.depth + 1
    FROM groups
    JOIN tree ON groups.parent = tree.id
)
SELECT id, parent, name, path, array_to_string(path, ' / ') AS label, daemon_name, depth
FROM tree;

CREATE TABLE node_groups (
    node uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    group_id integer NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    cpu real CHECK (cpu IS NULL OR cpu > 0),
    ram integer CHECK (ram IS NULL OR ram > 0),
    swap integer CHECK (swap IS NULL OR swap >= 0),
    PRIMARY KEY (node, group_id)
);

CREATE INDEX node_groups_group_idx ON node_groups (group_id);

ALTER TABLE servers ADD COLUMN group_id integer;

ALTER TABLE servers
    ADD CONSTRAINT servers_group_id_fkey FOREIGN KEY (node, group_id)
    REFERENCES node_groups (node, group_id) ON DELETE SET NULL (group_id);

CREATE TABLE deploy_configs (
    id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name varchar(64) NOT NULL UNIQUE,
    group_id integer NOT NULL REFERENCES groups (id),
    template varchar(64) NOT NULL,
    variables jsonb NOT NULL,
    cpu real NOT NULL CHECK (cpu > 0),
    ram integer NOT NULL CHECK (ram > 0),
    swap integer NOT NULL CHECK (swap >= 0),
    disk bigint CHECK (disk IS NULL OR disk > 0),
    internet_access boolean NOT NULL DEFAULT true,
    backup_limit integer CHECK (backup_limit IS NULL OR backup_limit >= 0)
);

CREATE INDEX deploy_configs_group_idx ON deploy_configs (group_id);

CREATE TABLE database_host_groups (
    host uuid NOT NULL REFERENCES database_hosts (id) ON DELETE CASCADE,
    group_id integer NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    PRIMARY KEY (host, group_id)
);

CREATE INDEX database_host_groups_group_idx ON database_host_groups (group_id);

INSERT INTO groups (name) SELECT left(name, 64) FROM legacy_groups ORDER BY name;

INSERT INTO node_groups (node, group_id, cpu, ram, swap)
SELECT legacy_node_groups.node, groups.id, legacy_node_groups.cpu, legacy_node_groups.ram, legacy_node_groups.swap
FROM legacy_node_groups
JOIN groups ON groups.name = left(legacy_node_groups.group_name, 64);

UPDATE servers SET group_id = groups.id
FROM legacy_server_groups
JOIN groups ON groups.name = left(legacy_server_groups.node_group, 64)
WHERE servers.id = legacy_server_groups.id;

INSERT INTO deploy_configs (id, name, group_id, template, variables, cpu, ram, swap, disk, internet_access, backup_limit)
OVERRIDING SYSTEM VALUE
SELECT legacy_deploy_configs.id, legacy_deploy_configs.name, groups.id, legacy_deploy_configs.template,
       legacy_deploy_configs.variables, legacy_deploy_configs.cpu, legacy_deploy_configs.ram,
       legacy_deploy_configs.swap, legacy_deploy_configs.disk, legacy_deploy_configs.internet_access,
       legacy_deploy_configs.backup_limit
FROM legacy_deploy_configs
JOIN groups ON groups.name = left(legacy_deploy_configs.group_name, 64);

SELECT setval(pg_get_serial_sequence('deploy_configs', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL)
FROM deploy_configs;

INSERT INTO database_host_groups (host, group_id)
SELECT legacy_database_host_groups.host, groups.id
FROM legacy_database_host_groups
JOIN groups ON groups.name = left(legacy_database_host_groups.group_name, 64);

DROP TABLE legacy_groups, legacy_node_groups, legacy_server_groups, legacy_deploy_configs, legacy_database_host_groups;
