CREATE TABLE database_hosts (
    id uuid PRIMARY KEY,
    display varchar(64) NOT NULL,
    region char(6) NOT NULL REFERENCES regions (id),
    url text NOT NULL,
    token text NOT NULL,
    public_host varchar(255) NOT NULL,
    maintenance boolean NOT NULL DEFAULT false
);

CREATE INDEX database_hosts_region_idx ON database_hosts (region);

CREATE TABLE database_host_ports (
    host uuid NOT NULL REFERENCES database_hosts (id) ON DELETE CASCADE,
    type varchar(16) NOT NULL,
    port integer NOT NULL,
    PRIMARY KEY (host, type)
);

CREATE TABLE database_instances (
    id uuid PRIMARY KEY,
    host uuid NOT NULL REFERENCES database_hosts (id) ON DELETE CASCADE,
    type varchar(16) NOT NULL,
    display varchar(64) NOT NULL
);

CREATE INDEX database_instances_host_idx ON database_instances (host);
CREATE INDEX database_instances_type_idx ON database_instances (type);

CREATE TABLE project_databases (
    id char(6) PRIMARY KEY,
    project char(6) NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    instance uuid NOT NULL REFERENCES database_instances (id),
    name varchar(63) NOT NULL,
    remote_database uuid NOT NULL,
    remote_user uuid NOT NULL,
    username varchar(32) NOT NULL,
    password text NOT NULL,
    created timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_databases_project_idx ON project_databases (project);
CREATE INDEX project_databases_instance_idx ON project_databases (instance);
CREATE UNIQUE INDEX project_databases_project_name_idx ON project_databases (project, name);
