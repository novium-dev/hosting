CREATE TABLE instances (
    uuid BLOB PRIMARY KEY NOT NULL,
    uuid_short INTEGER NOT NULL,
    database_type TEXT NOT NULL,
    suspended BOOLEAN NOT NULL,
    memory INTEGER NOT NULL,
    swap INTEGER NOT NULL,
    disk INTEGER NOT NULL,
    io_weight INTEGER,
    cpu INTEGER NOT NULL,
    image TEXT NOT NULL,
    image_uid INTEGER NOT NULL,
    image_gid INTEGER NOT NULL,
    volumes TEXT NOT NULL,
    socket_path TEXT NOT NULL,
    timezone TEXT,
    env TEXT NOT NULL,
    cmd TEXT,
    root_password TEXT,
    created TEXT NOT NULL
);

CREATE UNIQUE INDEX instances_uuid_short_idx ON instances (uuid_short);
CREATE INDEX instances_database_type_idx ON instances (database_type);

CREATE TABLE databases (
    uuid BLOB PRIMARY KEY NOT NULL,
    instance_uuid BLOB NOT NULL REFERENCES instances (uuid) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created TEXT NOT NULL
);

CREATE INDEX databases_instance_uuid_idx ON databases (instance_uuid);
CREATE UNIQUE INDEX databases_instance_uuid_name_idx ON databases (instance_uuid, name);

CREATE TABLE users (
    uuid BLOB PRIMARY KEY NOT NULL,
    uuid_short INTEGER NOT NULL,
    instance_uuid BLOB NOT NULL REFERENCES instances (uuid) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created TEXT NOT NULL
);

CREATE UNIQUE INDEX users_uuid_short_idx ON users (uuid_short);
CREATE INDEX users_instance_uuid_idx ON users (instance_uuid);

CREATE TABLE user_grants (
    user_uuid BLOB NOT NULL REFERENCES users (uuid) ON DELETE CASCADE,
    database_uuid BLOB NOT NULL REFERENCES databases (uuid) ON DELETE CASCADE,
    access TEXT NOT NULL,
    PRIMARY KEY (user_uuid, database_uuid)
);

CREATE INDEX user_grants_database_uuid_idx ON user_grants (database_uuid);
