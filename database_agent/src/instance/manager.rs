use crate::instance::{InnerInstance, Instance};
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::DatabaseType;
use parking_lot::RwLock;
use rustc_hash::{FxHashMap, FxHashSet};
use std::sync::{Arc, Weak};
use uuid::Uuid;

#[derive(Clone)]
pub struct Credentials {
    pub instance: Instance,
    pub password: Arc<str>,
}

type Table = RwLock<FxHashMap<u32, Credentials>>;

#[derive(Default)]
pub struct DatabaseRouteManager {
    mariadb: Table,
    mongodb: Table,
    postgres: Table,
    redis: Table,

    pub mariadb_versions: MariadbVersions,
}

const MAX_VERSION_LENGTH: usize = 60;

type MariadbVersion = (u32, u32, u32);

#[derive(Default)]
pub struct MariadbVersions {
    versions: RwLock<FxHashMap<Uuid, (MariadbVersion, Arc<str>)>>,
}

impl MariadbVersions {
    pub fn set(&self, instance: Uuid, version: &str) -> bool {
        if version.len() > MAX_VERSION_LENGTH
            || !version
                .bytes()
                .all(|byte| byte.is_ascii_graphic() || byte == b' ')
            || !version.to_ascii_lowercase().contains("mariadb")
        {
            return false;
        }

        let mut parts = version
            .strip_prefix("5.5.5-")
            .unwrap_or(version)
            .split(|character: char| !character.is_ascii_digit())
            .map(|part| part.parse::<u32>().ok());
        let (Some(Some(major)), Some(Some(minor)), Some(Some(patch))) =
            (parts.next(), parts.next(), parts.next())
        else {
            return false;
        };

        self.versions
            .write()
            .insert(instance, ((major, minor, patch), Arc::from(version)));

        true
    }

    pub fn remove(&self, instance: Uuid) {
        self.versions.write().remove(&instance);
    }

    pub fn lowest(&self) -> Option<Arc<str>> {
        self.versions
            .read()
            .values()
            .min_by_key(|(parsed, _)| *parsed)
            .map(|(_, version)| Arc::clone(version))
    }
}

impl DatabaseRouteManager {
    const fn table(&self, kind: DatabaseType) -> &Table {
        match kind {
            DatabaseType::Mariadb => &self.mariadb,
            DatabaseType::Mongodb => &self.mongodb,
            DatabaseType::Postgres => &self.postgres,
            DatabaseType::Redis => &self.redis,
        }
    }

    pub fn find(&self, kind: DatabaseType, user: &UserIdentifier) -> Option<Credentials> {
        self.table(kind).read().get(&user.short_uuid()).cloned()
    }

    pub fn inserter(
        self: &Arc<Self>,
        instance: Weak<InnerInstance>,
        kind: DatabaseType,
    ) -> RouteInserter {
        RouteInserter {
            manager: Arc::clone(self),
            instance,
            kind,
            inserted: RwLock::new(FxHashSet::default()),
        }
    }
}

pub struct RouteInserter {
    manager: Arc<DatabaseRouteManager>,
    instance: Weak<InnerInstance>,
    kind: DatabaseType,
    inserted: RwLock<FxHashSet<u32>>,
}

impl RouteInserter {
    pub fn insert(&self, user: UserIdentifier, password: impl Into<Arc<str>>) {
        if !self.inserted.write().insert(user.short_uuid()) {
            return;
        }
        let Some(instance) = self.instance.upgrade().map(Instance) else {
            return;
        };

        self.manager.table(self.kind).write().insert(
            user.short_uuid(),
            Credentials {
                instance,
                password: password.into(),
            },
        );
    }

    pub fn remove(&self, user: &UserIdentifier) {
        if !self.inserted.write().remove(&user.short_uuid()) {
            return;
        }

        self.manager
            .table(self.kind)
            .write()
            .remove(&user.short_uuid());
    }

    pub fn clear(&self) {
        let mut inserted = self.inserted.write();
        let mut table = self.manager.table(self.kind).write();
        for user in inserted.drain() {
            table.remove(&user);
        }
    }
}

impl Drop for RouteInserter {
    fn drop(&mut self) {
        let mut table = self.manager.table(self.kind).write();
        for user in self.inserted.get_mut().iter() {
            table.remove(user);
        }
    }
}
