ALTER TABLE servers
    DROP CONSTRAINT servers_node_fkey,
    ADD CONSTRAINT servers_node_fkey FOREIGN KEY (node) REFERENCES nodes (id) ON DELETE CASCADE;

ALTER TABLE database_instances
    DROP CONSTRAINT database_instances_host_fkey,
    ADD CONSTRAINT database_instances_host_fkey FOREIGN KEY (host) REFERENCES database_hosts (id) ON DELETE CASCADE;
