use crate::Backend;
use core::mem;
use core::time::Duration;
use signal_hook::consts::{SIGINT, SIGTERM};
use signal_hook::iterator::Signals;
use std::sync::Arc;
use tracing::{debug, info};

impl Backend {
    pub async fn shutdown(&self) {
        info!("Shutting backend down...");
        let _ = self.shutdown_channel.send(());
        debug!("Sent shutdown signal");
        self.server_task_cancellable.lock().await.shutdown().await;
        debug!("Cancelled server tasks... (if possible)");
        mem::take(&mut *self.server_task.lock().await)
            .join_all()
            .await;
        debug!("Server tasks down");

        info!("Backend shutdown complete");
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    pub fn hook_signals(&self) {
        let backend = self.clone();
        let mut signal = Signals::new([SIGINT, SIGTERM]).expect("Unable to hook signals");
        tokio::task::spawn_blocking(move || {
            if signal.forever().next().is_some() {
                Arc::clone(&backend.shutdown_task)
                    .blocking_lock_owned()
                    .spawn(async move { backend.shutdown().await });
            }
        });
    }

    pub async fn await_shutdown(&self) {
        let mut recv = self.shutdown_channel.subscribe();
        while recv.recv().await.is_err() {}
        mem::take(&mut *self.shutdown_task.lock().await)
            .join_all()
            .await;
    }
}
