-- Store the SSH/SFTP endpoint (host + port) clients use to reach a node. The
-- host can differ from the game `default_host`. Both nullable: NULL means
-- SSH/SFTP is disabled for the node, matching the optional-by-design daemon
-- config. (Previously the port was hardcoded to 2022 in the server-info route.)
ALTER TABLE nodes ADD COLUMN ssh_port int;
ALTER TABLE nodes ADD COLUMN ssh_host varchar(255);
