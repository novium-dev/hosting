use crate::Backend;
use tokio::signal::ctrl_c;
use tokio::signal::unix::{SignalKind, signal};

impl Backend {
    pub fn hook_signals(&self) {
        let shutdown = self.shutdown.clone();
        let mut terminate = signal(SignalKind::terminate()).expect("Unable to hook signals");
        tokio::spawn(async move {
            tokio::select! {
                _ = ctrl_c() => {}
                _ = terminate.recv() => {}
            }
            shutdown.cancel();
        });
    }
}
