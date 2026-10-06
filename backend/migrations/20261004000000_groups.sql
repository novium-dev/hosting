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

ALTER TABLE nodes ADD COLUMN overallocation integer NOT NULL DEFAULT 100
    CHECK (overallocation > 0 AND overallocation <= 1000);

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

ALTER TABLE nodes DROP COLUMN region;
ALTER TABLE database_hosts DROP COLUMN region;

DROP TABLE regions;
