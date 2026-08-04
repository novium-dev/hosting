use core::hash::Hash;
use core::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use database_agent_common::identifier::UserIdentifier;
use database_agent_common::types::{SubsystemConnectionCounts, SubsystemStatus};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Default)]
pub struct SubsystemConnections {
    running: AtomicBool,
    total: AtomicUsize,
    users: Mutex<HashMap<UserIdentifier, usize>>,
    databases: Mutex<HashMap<String, usize>>,
}

impl SubsystemConnections {
    pub fn mark_running(&self) {
        self.running.store(true, Ordering::SeqCst);
    }

    pub fn connect(
        self: &Arc<Self>,
        user: UserIdentifier,
        database: Option<String>,
    ) -> ConnectionGuard {
        self.total.fetch_add(1, Ordering::SeqCst);
        increment(&self.users, user);
        if let Some(database) = database.clone() {
            increment(&self.databases, database);
        }

        ConnectionGuard {
            subsystem: Arc::clone(self),
            user,
            database,
        }
    }

    pub fn snapshot(&self) -> SubsystemStatus {
        SubsystemStatus {
            running: self.running.load(Ordering::SeqCst),
            connections: SubsystemConnectionCounts {
                total: self.total.load(Ordering::SeqCst),
                unique_databases: self.databases.lock().len(),
                unique_users: self.users.lock().len(),
            },
        }
    }
}

fn increment<K: Eq + Hash>(map: &Mutex<HashMap<K, usize>>, key: K) {
    *map.lock().entry(key).or_default() += 1;
}

fn decrement<K: Eq + Hash>(map: &Mutex<HashMap<K, usize>>, key: &K) {
    let mut map = map.lock();
    if let Some(count) = map.get_mut(key) {
        *count = count.saturating_sub(1);
        if *count == 0 {
            map.remove(key);
        }
    }
}

pub struct ConnectionGuard {
    subsystem: Arc<SubsystemConnections>,
    user: UserIdentifier,
    database: Option<String>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.subsystem.total.fetch_sub(1, Ordering::SeqCst);
        decrement(&self.subsystem.users, &self.user);
        if let Some(database) = self.database.as_ref() {
            decrement(&self.subsystem.databases, database);
        }
    }
}
