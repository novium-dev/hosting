DROP TABLE project_databases;

DELETE FROM database_instances;

ALTER TABLE database_instances
    DROP CONSTRAINT database_instances_host_fkey,
    ADD CONSTRAINT database_instances_host_fkey FOREIGN KEY (host) REFERENCES database_hosts (id),
    ADD COLUMN project char(6) NOT NULL REFERENCES projects (id),
    ADD COLUMN created timestamptz NOT NULL DEFAULT now();

CREATE INDEX database_instances_project_idx ON database_instances (project);
