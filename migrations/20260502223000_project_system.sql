CREATE TABLE
    IF NOT EXISTS `users` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `username` VARCHAR(32) NOT NULL,
        `auth_id` VARCHAR(255) NOT NULL UNIQUE,
        `permissions` BIGINT NOT NULL,
        `role` INT NOT NULL DEFAULT 0,
        `email` VARCHAR(255) NOT NULL,
        `language` VARCHAR(255) NOT NULL DEFAULT 'en',
        `first_name` VARCHAR(255),
        `last_name` VARCHAR(255)
    ) ENGINE = INNODB;

INSERT INTO
    `users` (
        `id`,
        `username`,
        `auth_id`,
        `permissions`,
        `role`,
        `email`
    )
VALUES
    (1, 'dev', 'dev', 0, 3, 'dev@example.com') ON DUPLICATE KEY
UPDATE `auth_id` =
VALUES
    (`auth_id`);

CREATE TABLE
    IF NOT EXISTS `projects` (
        `id` UUID NOT NULL PRIMARY KEY,
        `name` VARCHAR(64) NOT NULL,
        `owner` INT UNSIGNED NOT NULL,
        FOREIGN KEY (`owner`) REFERENCES `users` (`id`) ON DELETE CASCADE
    ) ENGINE = INNODB;

CREATE TABLE
    IF NOT EXISTS `project_users` (
        `user` INT UNSIGNED NOT NULL,
        `project` UUID NOT NULL,
        `permissions` BIGINT NOT NULL,
        PRIMARY KEY (`user`, `project`),
        FOREIGN KEY (`user`) REFERENCES `users` (`id`) ON DELETE CASCADE,
        FOREIGN KEY (`project`) REFERENCES `projects` (`id`) ON DELETE CASCADE
    ) ENGINE = INNODB;

SET
    @has_owner = (
        SELECT
            COUNT(*)
        FROM
            `INFORMATION_SCHEMA`.`COLUMNS`
        WHERE
            `TABLE_SCHEMA` = DATABASE()
            AND `TABLE_NAME` = 'servers'
            AND `COLUMN_NAME` = 'owner'
    );

SET
    @has_project = (
        SELECT
            COUNT(*)
        FROM
            `INFORMATION_SCHEMA`.`COLUMNS`
        WHERE
            `TABLE_SCHEMA` = DATABASE()
            AND `TABLE_NAME` = 'servers'
            AND `COLUMN_NAME` = 'project'
    );

SET
    @sql = IF (
        @has_owner > 0
        AND @has_project = 0,
        'ALTER TABLE `servers` ADD COLUMN `project` UUID',
        'SELECT 1'
    );

PREPARE stmt
FROM
    @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET
    @sql = IF (
        @has_owner > 0,
        'INSERT IGNORE INTO `projects` (`id`, `name`, `owner`) SELECT DISTINCT `owner`, CAST(`owner` AS CHAR), 1 FROM `servers`',
        'SELECT 1'
    );

PREPARE stmt
FROM
    @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET
    @sql = IF (
        @has_owner > 0,
        'UPDATE `servers` SET `project` = `owner` WHERE `project` IS NULL',
        'SELECT 1'
    );

PREPARE stmt
FROM
    @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET
    @sql = IF (
        @has_owner > 0,
        'ALTER TABLE `servers` MODIFY `project` UUID NOT NULL',
        'SELECT 1'
    );

PREPARE stmt
FROM
    @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

SET
    @sql = IF (
        @has_owner > 0,
        'ALTER TABLE `servers` DROP COLUMN `owner`',
        'SELECT 1'
    );

PREPARE stmt
FROM
    @sql;

EXECUTE stmt;

DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS `server_users`;
