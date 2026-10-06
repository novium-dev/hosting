ALTER TABLE server_ports RENAME COLUMN external_ip TO bind;

ALTER TABLE database_instances RENAME COLUMN type TO kind;
ALTER INDEX database_instances_type_idx RENAME TO database_instances_kind_idx;
ALTER TABLE database_host_ports RENAME COLUMN type TO kind;

ALTER TABLE node_server_storage RENAME TO node_server_storages;
ALTER TABLE node_backup_storage RENAME TO node_backup_storages;
