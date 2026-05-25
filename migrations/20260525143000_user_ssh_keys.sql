CREATE TABLE
    IF NOT EXISTS `user_ssh_keys` (
        `id` INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        `user` INT UNSIGNED NOT NULL,
        `name` VARCHAR(64) NOT NULL,
        `public_key` VARCHAR(4096) NOT NULL,
        `fingerprint_sha512` CHAR(128) NOT NULL,
        FOREIGN KEY (`user`) REFERENCES `users` (`id`) ON DELETE CASCADE,
        UNIQUE (`user`, `fingerprint_sha512`)
    ) ENGINE = INNODB;
