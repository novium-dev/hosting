-- Store the SSH/SFTP port clients use to reach a node (previously hardcoded to
-- 2022 in the server-info response).
ALTER TABLE nodes ADD COLUMN ssh_port int NOT NULL DEFAULT 2022;
