use crate::instance::{InnerInstance, Instance};
use core::sync::atomic::Ordering;
use core::time::Duration;
use database_agent_common::types::ContainerState;
use std::collections::HashSet;
use std::io;
use std::os::unix::fs::MetadataExt as _;
use std::path::{Path, PathBuf};
use std::sync::Weak;

const BLOCK_SIZE: u64 = 512;
const MEGABYTE: u64 = 1024 * 1024;

pub async fn run(instance: Weak<InnerInstance>) {
    tokio::time::sleep(Duration::from_secs(5)).await;

    loop {
        let Some(inner) = instance.upgrade() else {
            break;
        };
        let instance = Instance(inner);

        let permit = instance.agent.disk_check_semaphore.acquire().await;
        instance.check_disk_usage().await;
        drop(permit);

        let interval = instance.agent.config.disk_check_interval.max(1);
        drop(instance);
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

impl Instance {
    pub async fn check_disk_usage(&self) {
        let path = self.agent.config.data_dir(self.uuid);
        let usage = match tokio::task::spawn_blocking(move || scan_path(&path)).await {
            Ok(Ok(usage)) => usage,
            Ok(Err(err)) => {
                tracing::error!(instance = %self.uuid, "disk usage scan failed: {err}");
                return;
            }
            Err(err) => {
                tracing::error!(instance = %self.uuid, "disk usage scan panicked: {err}");
                return;
            }
        };

        self.disk_usage.store(usage, Ordering::Relaxed);

        let disk_limit = self.data.read().await.disk;
        if disk_limit > 0
            && usage >= disk_limit.cast_unsigned() * MEGABYTE
            && self.container_state().await == ContainerState::Running
        {
            tracing::warn!(
                instance = %self.uuid,
                "instance is exceeding its disk limit ({usage} bytes), stopping it",
            );

            if let Err(err) = self.stop().await {
                tracing::error!(instance = %self.uuid, "failed to stop an instance over its disk limit: {err}");
            }
        }
    }

    pub async fn is_disk_full(&self) -> bool {
        let disk_limit = self.data.read().await.disk;
        disk_limit != 0
            && self.disk_usage.load(Ordering::Relaxed) >= disk_limit.cast_unsigned() * MEGABYTE
    }
}

fn scan_path(path: &Path) -> std::io::Result<u64> {
    let mut seen_inodes = HashSet::new();
    let mut total: u64 = 0;
    let mut stack: Vec<PathBuf> = vec![path.to_path_buf()];

    while let Some(directory) = stack.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => return Err(err),
        };

        for entry in entries.flatten() {
            let Ok(metadata) = entry.metadata() else {
                continue;
            };

            if metadata.is_dir() {
                total = total.saturating_add(metadata.blocks() * BLOCK_SIZE);
                stack.push(entry.path());
            } else {
                if metadata.nlink() > 1 && !seen_inodes.insert(metadata.ino()) {
                    continue;
                }
                total = total.saturating_add(metadata.blocks() * BLOCK_SIZE);
            }
        }
    }

    Ok(total)
}
