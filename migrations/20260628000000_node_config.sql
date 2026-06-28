-- Backend-owned logical config that the daemon pulls during setup and the
-- backend reconciles against (NodeConfig): the MariaDB connection URL and the
-- publicly reachable SSH address (host/port, nullable -> SSH disabled).
ALTER TABLE nodes
    ADD COLUMN database varchar(512) NOT NULL DEFAULT '',
    ADD COLUMN ssh_host varchar(255),
    ADD COLUMN ssh_port integer CHECK (ssh_port IS NULL OR ssh_port BETWEEN 0 AND 65535);
