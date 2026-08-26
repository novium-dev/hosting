CREATE TABLE user_grants (
    user_uuid BLOB NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
    database_uuid BLOB NOT NULL REFERENCES databases (uuid) ON DELETE CASCADE,
    access TEXT NOT NULL,
    PRIMARY KEY (user_uuid, database_uuid)
);

CREATE INDEX user_grants_database_uuid_idx ON user_grants (database_uuid);

INSERT INTO user_grants (user_uuid, database_uuid, access)
SELECT uuid, database_uuid, 'write' FROM users WHERE database_uuid IS NOT NULL;

DROP INDEX users_database_uuid_idx;

ALTER TABLE users DROP COLUMN database_uuid;
