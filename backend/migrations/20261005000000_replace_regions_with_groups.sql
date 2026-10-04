CREATE TABLE database_host_groups (
    host uuid NOT NULL REFERENCES database_hosts (id) ON DELETE CASCADE,
    group_name varchar(200) NOT NULL REFERENCES groups (name) ON DELETE CASCADE,
    PRIMARY KEY (host, group_name)
);

CREATE INDEX database_host_groups_group_idx ON database_host_groups (group_name);

ALTER TABLE nodes DROP COLUMN region;
ALTER TABLE database_hosts DROP COLUMN region;

DROP TABLE regions;
