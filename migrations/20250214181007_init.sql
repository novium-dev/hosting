CREATE TABLE
    IF NOT EXISTS `nodes` (
    `id` UUID NOT NULL PRIMARY KEY,
    `display` VARCHAR(64) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `default_host` VARCHAR(255) NOT NULL,
    `default_bind` VARCHAR(64) NOT NULL
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_server_storage` (
    `node` UUID NOT NULL,
    `storage` VARCHAR(64) NOT NULL,
    `storage_type` VARCHAR(32) NOT NULL,
    `group` VARCHAR(64),
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE,
    PRIMARY KEY (`node`, `storage`)
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_backup_storage` (
    `node` UUID NOT NULL,
    `storage` VARCHAR(64) NOT NULL,
    `storage_type` VARCHAR(32) NOT NULL,
    `group` VARCHAR(64),
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE,
    PRIMARY KEY (`node`, `storage`)
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_ports` (
    `id` INT (255) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `node` UUID NOT NULL,
    `protocol` ENUM('tcp', 'udp') NOT NULL,
    `start` SMALLINT UNSIGNED NOT NULL,
    `end` SMALLINT UNSIGNED NOT NULL,
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `servers` (
    `id` CHAR(6) NOT NULL PRIMARY KEY,
    `name` VARCHAR(64) NOT NULL,
    `node` UUID NOT NULL,
    `node_server_id` INT (255) UNSIGNED NOT NULL,
    `owner` VARCHAR(64) NOT NULL,
    `cpu` FLOAT (255, 2),
    `ram` INT UNSIGNED,
    `swap` INT UNSIGNED,
    `disk` BIGINT UNSIGNED,
    `storage` VARCHAR(64) NOT NULL,
    `template` VARCHAR(64) NOT NULL,
    `template_extra` JSON NOT NULL,
    `custom_dockerfile` VARCHAR(10000),
    `suspended` BOOLEAN NOT NULL DEFAULT FALSE,
    `internet_access` BOOLEAN NOT NULL DEFAULT TRUE,
    `backup_limit` INT UNSIGNED DEFAULT NULL,
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`),
    UNIQUE (`node`, `node_server_id`)
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `server_ports` (
    `id` INT (255) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `server` CHAR(6) NOT NULL,
    `name` VARCHAR(255) NOT NULL DEFAULT 'Unknown',
    `host` VARCHAR(255) NOT NULL,
    `internal_port` SMALLINT (5) UNSIGNED NOT NULL,
    `external_ip` VARCHAR(255) NOT NULL,
    `external_port_start` SMALLINT (5) UNSIGNED NOT NULL,
    `external_port_end` SMALLINT (5) UNSIGNED NOT NULL,
    `protocol` ENUM ('tcp', 'udp') NOT NULL,
    FOREIGN KEY (`server`) REFERENCES `servers`(`id`) ON DELETE CASCADE
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `api_keys` (
    `key` BINARY(128) NOT NULL PRIMARY KEY,
    `name` VARCHAR(64) NOT NULL,
    `permissions` BIGINT NOT NULL
    ) ENGINE=INNODB;
