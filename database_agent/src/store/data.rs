use anyhow::Context as _;
use chrono::{DateTime, Utc};
use core::str::FromStr as _;
use database_agent_common::types::{
    DatabaseType, StoredDatabase, StoredInstance, StoredInstanceCreate, StoredInstanceUpdate,
    StoredUser, VolumeMapping,
};
use sqlx::{SqlitePool, query, query_scalar};
use std::collections::BTreeMap;
use uuid::Uuid;

fn parse_type(value: &str) -> anyhow::Result<DatabaseType> {
    DatabaseType::from_str(value).map_err(|()| anyhow::anyhow!("invalid database type {value}"))
}

fn parse_volumes(value: &str) -> anyhow::Result<VolumeMapping> {
    serde_json::from_str(value).context("invalid stored volume mapping")
}

fn parse_env(value: &str) -> anyhow::Result<BTreeMap<String, String>> {
    serde_json::from_str(value).context("invalid stored environment")
}

fn parse_cmd(value: Option<&str>) -> anyhow::Result<Option<Vec<String>>> {
    value
        .map(serde_json::from_str)
        .transpose()
        .context("invalid stored command")
}

pub async fn all_instances(pool: &SqlitePool) -> anyhow::Result<Vec<StoredInstance>> {
    query!(
        r#"SELECT uuid AS "uuid: Uuid", uuid_short, database_type, suspended,
               memory, swap, disk, io_weight, cpu, image, image_uid AS "image_uid: u32",
               image_gid AS "image_gid: u32", volumes, socket_path, timezone, env, cmd,
               root_password, created AS "created: DateTime<Utc>"
           FROM instances"#
    )
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(|row| {
        Ok(StoredInstance {
            uuid: row.uuid,
            uuid_short: row.uuid_short,
            database_type: parse_type(&row.database_type)?,
            suspended: row.suspended,
            memory: row.memory,
            swap: row.swap,
            disk: row.disk,
            io_weight: row.io_weight,
            cpu: row.cpu,
            image: row.image,
            image_uid: row.image_uid,
            image_gid: row.image_gid,
            volumes: parse_volumes(&row.volumes)?,
            socket_path: row.socket_path,
            timezone: row.timezone,
            env: parse_env(&row.env)?,
            cmd: parse_cmd(row.cmd.as_deref())?,
            root_password: row.root_password,
            created: row.created,
        })
    })
    .collect()
}

pub async fn insert_instance(
    pool: &SqlitePool,
    create: StoredInstanceCreate,
) -> anyhow::Result<StoredInstance> {
    let volumes = serde_json::to_string(&create.volumes)?;
    let env = serde_json::to_string(&create.env)?;
    let cmd = create.cmd.as_ref().map(serde_json::to_string).transpose()?;
    let database_type = create.database_type.as_str();

    loop {
        let uuid = Uuid::new_v4();
        let uuid_short = i64::from(uuid.as_fields().0);
        let created = Utc::now();

        let result = query!(
            "INSERT INTO instances (uuid, uuid_short, database_type, suspended, memory, swap,
                 disk, io_weight, cpu, image, image_uid, image_gid, volumes, socket_path,
                 timezone, env, cmd, created)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            uuid,
            uuid_short,
            database_type,
            create.suspended,
            create.memory,
            create.swap,
            create.disk,
            create.io_weight,
            create.cpu,
            create.image,
            create.image_uid,
            create.image_gid,
            volumes,
            create.socket_path,
            create.timezone,
            env,
            cmd,
            created
        )
        .execute(pool)
        .await;

        match result {
            Ok(_) => {
                return Ok(StoredInstance {
                    uuid,
                    uuid_short,
                    database_type: create.database_type,
                    suspended: create.suspended,
                    memory: create.memory,
                    swap: create.swap,
                    disk: create.disk,
                    io_weight: create.io_weight,
                    cpu: create.cpu,
                    image: create.image,
                    image_uid: create.image_uid,
                    image_gid: create.image_gid,
                    volumes: create.volumes,
                    socket_path: create.socket_path,
                    timezone: create.timezone,
                    env: create.env,
                    cmd: create.cmd,
                    root_password: None,
                    created,
                });
            }
            Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {}
            Err(err) => return Err(err.into()),
        }
    }
}

pub async fn update_instance(pool: &SqlitePool, data: &StoredInstance) -> anyhow::Result<()> {
    let volumes = serde_json::to_string(&data.volumes)?;
    let env = serde_json::to_string(&data.env)?;
    let cmd = data.cmd.as_ref().map(serde_json::to_string).transpose()?;

    query!(
        "UPDATE instances SET suspended = ?, memory = ?, swap = ?, disk = ?, io_weight = ?,
             cpu = ?, image = ?, image_uid = ?, image_gid = ?, volumes = ?, socket_path = ?,
             timezone = ?, env = ?, cmd = ? WHERE uuid = ?",
        data.suspended,
        data.memory,
        data.swap,
        data.disk,
        data.io_weight,
        data.cpu,
        data.image,
        data.image_uid,
        data.image_gid,
        volumes,
        data.socket_path,
        data.timezone,
        env,
        cmd,
        data.uuid
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn set_root_password(
    pool: &SqlitePool,
    instance: Uuid,
    password: &str,
) -> anyhow::Result<()> {
    query!(
        "UPDATE instances SET root_password = ? WHERE uuid = ?",
        password,
        instance
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_instance(pool: &SqlitePool, instance: Uuid) -> anyhow::Result<()> {
    query!("DELETE FROM instances WHERE uuid = ?", instance)
        .execute(pool)
        .await?;

    Ok(())
}

pub fn apply_update(data: &mut StoredInstance, update: StoredInstanceUpdate) {
    let StoredInstanceUpdate {
        suspended,
        memory,
        swap,
        disk,
        io_weight,
        cpu,
        image,
        image_uid,
        image_gid,
        volumes,
        socket_path,
        timezone,
        env,
        cmd,
    } = update;

    replace(&mut data.suspended, suspended);
    replace(&mut data.memory, memory);
    replace(&mut data.swap, swap);
    replace(&mut data.disk, disk);
    replace(&mut data.io_weight, io_weight);
    replace(&mut data.cpu, cpu);
    replace(&mut data.image, image);
    replace(&mut data.image_uid, image_uid);
    replace(&mut data.image_gid, image_gid);
    replace(&mut data.volumes, volumes);
    replace(&mut data.socket_path, socket_path);
    replace(&mut data.timezone, timezone);
    replace(&mut data.env, env);
    replace(&mut data.cmd, cmd);
}

fn replace<T>(target: &mut T, value: Option<T>) {
    if let Some(value) = value {
        *target = value;
    }
}

pub async fn databases(pool: &SqlitePool, instance: Uuid) -> anyhow::Result<Vec<StoredDatabase>> {
    Ok(sqlx::query_as!(
        StoredDatabase,
        r#"SELECT uuid AS "uuid: Uuid", instance_uuid AS "instance_uuid: Uuid", name,
               created AS "created: DateTime<Utc>"
           FROM databases WHERE instance_uuid = ? ORDER BY name"#,
        instance
    )
    .fetch_all(pool)
    .await?)
}

pub async fn database(
    pool: &SqlitePool,
    instance: Uuid,
    database: Uuid,
) -> anyhow::Result<Option<StoredDatabase>> {
    Ok(sqlx::query_as!(
        StoredDatabase,
        r#"SELECT uuid AS "uuid: Uuid", instance_uuid AS "instance_uuid: Uuid", name,
               created AS "created: DateTime<Utc>"
           FROM databases WHERE instance_uuid = ? AND uuid = ?"#,
        instance,
        database
    )
    .fetch_optional(pool)
    .await?)
}

pub async fn database_count(pool: &SqlitePool, instance: Uuid) -> anyhow::Result<i64> {
    Ok(query_scalar!(
        r#"SELECT COUNT(*) AS "count!: i64" FROM databases WHERE instance_uuid = ?"#,
        instance
    )
    .fetch_one(pool)
    .await?)
}

pub async fn insert_database(
    pool: &SqlitePool,
    instance: Uuid,
    name: &str,
) -> anyhow::Result<StoredDatabase> {
    let uuid = Uuid::new_v4();
    let created = Utc::now();

    query!(
        "INSERT INTO databases (uuid, instance_uuid, name, created) VALUES (?, ?, ?, ?)",
        uuid,
        instance,
        name,
        created
    )
    .execute(pool)
    .await?;

    Ok(StoredDatabase {
        uuid,
        instance_uuid: instance,
        name: name.to_owned(),
        created,
    })
}

pub async fn delete_database(pool: &SqlitePool, database: Uuid) -> anyhow::Result<()> {
    query!("DELETE FROM databases WHERE uuid = ?", database)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn users(pool: &SqlitePool, instance: Uuid) -> anyhow::Result<Vec<StoredUser>> {
    Ok(sqlx::query_as!(
        StoredUser,
        r#"SELECT uuid AS "uuid: Uuid", uuid_short, instance_uuid AS "instance_uuid: Uuid",
               database_uuid AS "database_uuid: Uuid", username, password,
               created AS "created: DateTime<Utc>"
           FROM users WHERE instance_uuid = ? ORDER BY username"#,
        instance
    )
    .fetch_all(pool)
    .await?)
}

pub async fn database_users(
    pool: &SqlitePool,
    instance: Uuid,
    database: Uuid,
) -> anyhow::Result<Vec<StoredUser>> {
    Ok(sqlx::query_as!(
        StoredUser,
        r#"SELECT uuid AS "uuid: Uuid", uuid_short, instance_uuid AS "instance_uuid: Uuid",
               database_uuid AS "database_uuid: Uuid", username, password,
               created AS "created: DateTime<Utc>"
           FROM users WHERE instance_uuid = ? AND database_uuid = ?"#,
        instance,
        database
    )
    .fetch_all(pool)
    .await?)
}

pub async fn user(
    pool: &SqlitePool,
    instance: Uuid,
    user: Uuid,
) -> anyhow::Result<Option<StoredUser>> {
    Ok(sqlx::query_as!(
        StoredUser,
        r#"SELECT uuid AS "uuid: Uuid", uuid_short, instance_uuid AS "instance_uuid: Uuid",
               database_uuid AS "database_uuid: Uuid", username, password,
               created AS "created: DateTime<Utc>"
           FROM users WHERE instance_uuid = ? AND uuid = ?"#,
        instance,
        user
    )
    .fetch_optional(pool)
    .await?)
}

pub async fn insert_user(
    pool: &SqlitePool,
    instance: Uuid,
    database: Option<Uuid>,
    username: &str,
    password: &str,
) -> anyhow::Result<StoredUser> {
    loop {
        let uuid = Uuid::new_v4();
        let uuid_short = i64::from(uuid.as_fields().0);
        let created = Utc::now();

        let result = query!(
            "INSERT INTO users (uuid, uuid_short, instance_uuid, database_uuid, username,
                 password, created)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
            uuid,
            uuid_short,
            instance,
            database,
            username,
            password,
            created
        )
        .execute(pool)
        .await;

        match result {
            Ok(_) => {
                return Ok(StoredUser {
                    uuid,
                    uuid_short,
                    instance_uuid: instance,
                    database_uuid: database,
                    username: username.to_owned(),
                    password: password.to_owned(),
                    created,
                });
            }
            Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {}
            Err(err) => return Err(err.into()),
        }
    }
}

pub async fn set_user_password(
    pool: &SqlitePool,
    user: Uuid,
    password: &str,
) -> anyhow::Result<()> {
    query!(
        "UPDATE users SET password = ? WHERE uuid = ?",
        password,
        user
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn delete_user(pool: &SqlitePool, user: Uuid) -> anyhow::Result<()> {
    query!("DELETE FROM users WHERE uuid = ?", user)
        .execute(pool)
        .await?;

    Ok(())
}
