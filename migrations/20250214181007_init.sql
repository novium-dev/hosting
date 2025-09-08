CREATE TABLE
    IF NOT EXISTS `nodes` (
    `id` INT (255) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `uuid` UUID NOT NULL UNIQUE,
    `display` VARCHAR(64) NOT NULL,
    `url` VARCHAR(255) NOT NULL,
    `default_host` VARCHAR(255) NOT NULL,
    `default_bind` VARCHAR(64) NOT NULL
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_server_storage` (
    `node` INT (255) UNSIGNED NOT NULL,
    `storage` VARCHAR(64) NOT NULL,
    `storage_type` VARCHAR(32) NOT NULL,
    `group` VARCHAR(64),
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE,
    PRIMARY KEY (`node`, `storage`)
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_backup_storage` (
    `node` INT (255) UNSIGNED NOT NULL,
    `storage` VARCHAR(64) NOT NULL,
    `storage_type` VARCHAR(32) NOT NULL,
    `group` VARCHAR(64),
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE,
    PRIMARY KEY (`node`, `storage`)
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `node_ports` (
    `id` INT (255) UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `node` INT (255) UNSIGNED NOT NULL,
    `protocol` ENUM('tcp', 'udp') NOT NULL,
    `start` SMALLINT UNSIGNED NOT NULL,
    `end` SMALLINT UNSIGNED NOT NULL,
    FOREIGN KEY (`node`) REFERENCES `nodes`(`id`) ON DELETE CASCADE
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `servers` (
    `id` CHAR(6) NOT NULL PRIMARY KEY,
    `name` VARCHAR(64) NOT NULL,
    `node` INT (255) UNSIGNED NOT NULL,
    `node_server_id` INT (255) UNSIGNED NOT NULL,
    `owner` INT (255) UNSIGNED NOT NULL,
    `cpu` FLOAT (255, 2),
    `ram` INT UNSIGNED,
    `swap` INT UNSIGNED,
    `disk` BIGINT UNSIGNED,
    `group` VARCHAR(64),
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
    IF NOT EXISTS `server_users` (
    `user` INT (255) UNSIGNED NOT NULL,
    `server` CHAR(6) NOT NULL,
    `permissions` BIGINT NOT NULL,
    PRIMARY KEY (`user`, `server`)
);

CREATE TABLE
    IF NOT EXISTS `api_keys` (
    `key` BINARY(128) NOT NULL PRIMARY KEY,
    `name` VARCHAR(64) NOT NULL,
    `permissions` BIGINT NOT NULL
    ) ENGINE=INNODB;

CREATE TABLE
    IF NOT EXISTS `users` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(32) NOT NULL,
    `auth_id` VARCHAR(255) NOT NULL UNIQUE,
    `permissions` BIGINT NOT NULL,
    `role` INT NOT NULL DEFAULT 0,
    `email` VARCHAR(255) NOT NULL,
    `language` VARCHAR(255) NOT NULL DEFAULT 'en',
    `first_name` VARCHAR(255),
    `last_name` VARCHAR(255)
    );