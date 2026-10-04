CREATE TABLE node_groups (
    node uuid NOT NULL REFERENCES nodes (id) ON DELETE CASCADE,
    name varchar(200) NOT NULL,
    cpu real CHECK (cpu IS NULL OR cpu > 0),
    ram integer CHECK (ram IS NULL OR ram > 0),
    swap integer CHECK (swap IS NULL OR swap >= 0),
    PRIMARY KEY (node, name),
    CONSTRAINT node_groups_name_check CHECK (name ~ '^[A-Za-z0-9_]+(-[A-Za-z0-9_]+){0,15}$')
);

ALTER TABLE servers ADD COLUMN node_group varchar(200);

ALTER TABLE servers
    ADD CONSTRAINT servers_node_group_fkey FOREIGN KEY (node, node_group)
    REFERENCES node_groups (node, name) ON DELETE SET NULL (node_group);
