use core::future::Future;
use core::net::SocketAddr;
use core::ops::{Bound, RangeBounds};
use core::time::Duration;
use rand::RngExt as _;
use rand::distr::SampleString as _;
use socket2::{SockRef, TcpKeepalive};
use std::io;
use subtle::ConstantTimeEq as _;
use tokio::net::{TcpListener, TcpStream};

const KEEPALIVE_IDLE: Duration = Duration::from_secs(60);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const KEEPALIVE_RETRIES: u32 = 4;

const PASSWORD_LENGTH: usize = 24;
const PASSWORD_SPECIAL_CHARS: &[u8] = b"!@#$%^&*()<>-_";

#[must_use]
pub fn generate_password() -> String {
    let mut rng = rand::rng();
    let mut password = rand::distr::Alphanumeric
        .sample_string(&mut rng, PASSWORD_LENGTH)
        .into_bytes();

    for _ in 0..rng.random_range(1u8..=5u8) {
        let position = rng.random_range(0..password.len());
        let special = rng.random_range(0..PASSWORD_SPECIAL_CHARS.len());
        if let (Some(slot), Some(&character)) = (
            password.get_mut(position),
            PASSWORD_SPECIAL_CHARS.get(special),
        ) {
            *slot = character;
        }
    }

    String::from_utf8_lossy(&password).into_owned()
}

#[must_use]
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.ct_eq(right).into()
}

#[must_use]
pub fn bad(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_owned())
}

#[must_use]
pub fn is_silent_error(error: &io::Error) -> bool {
    matches!(
        error.kind(),
        io::ErrorKind::BrokenPipe
            | io::ErrorKind::ConnectionReset
            | io::ErrorKind::UnexpectedEof
            | io::ErrorKind::WriteZero
            | io::ErrorKind::TimedOut
    )
}

fn apply_socket_keepalive(stream: &TcpStream) {
    let keepalive = TcpKeepalive::new()
        .with_time(KEEPALIVE_IDLE)
        .with_interval(KEEPALIVE_INTERVAL)
        .with_retries(KEEPALIVE_RETRIES);

    if let Err(err) = SockRef::from(stream).set_tcp_keepalive(&keepalive) {
        tracing::debug!("failed to set tcp keepalive on a connection: {err}");
    }
}

#[expect(
    clippy::infinite_loop,
    reason = "the listener runs until the task is aborted"
)]
pub async fn accept_loop<
    F: FnMut(TcpStream, SocketAddr) -> Fut,
    Fut: Future<Output = io::Result<()>> + Send + 'static,
>(
    listener: &TcpListener,
    name: &'static str,
    mut on_accept: F,
) -> anyhow::Result<()> {
    loop {
        match listener.accept().await {
            Ok((tcp, peer)) => {
                apply_socket_keepalive(&tcp);
                let task = on_accept(tcp, peer);
                tokio::spawn(async move {
                    if let Err(err) = task.await
                        && !is_silent_error(&err)
                    {
                        tracing::error!("[{peer}] {name} error: {err}");
                    }
                });
            }
            Err(err) => {
                const EMFILE: i32 = 24;
                const ENFILE: i32 = 23;

                let backoff = match err.raw_os_error() {
                    Some(EMFILE | ENFILE) => Duration::from_millis(500),
                    _ => Duration::from_millis(50),
                };

                tracing::error!("{name} accept error: {err}; backing off {backoff:?}");
                tokio::time::sleep(backoff).await;
            }
        }
    }
}

fn resolve_range(range: impl RangeBounds<usize>, len: usize) -> io::Result<(usize, usize)> {
    let start = match range.start_bound() {
        Bound::Included(&bound) => bound,
        Bound::Excluded(&bound) => bound.saturating_add(1),
        Bound::Unbounded => 0,
    };

    let end = match range.end_bound() {
        Bound::Included(&bound) => bound.saturating_add(1),
        Bound::Excluded(&bound) => bound,
        Bound::Unbounded => len,
    };

    if start > end || end > len {
        return Err(bad("unexpected end of buffer"));
    }

    Ok((start, end))
}

pub trait SafeSliceExt<T>: AsRef<[T]> {
    fn get_slice(&self, range: impl RangeBounds<usize>) -> io::Result<&[T]> {
        let slice = self.as_ref();
        let (start, end) = resolve_range(range, slice.len())?;

        slice
            .get(start..end)
            .ok_or_else(|| bad("unexpected end of buffer"))
    }
}

impl<T, Target: AsRef<[T]> + ?Sized> SafeSliceExt<T> for Target {}

pub trait SafeArrayExt: AsRef<[u8]> {
    fn get_array<const N: usize>(&self, start: usize) -> io::Result<[u8; N]> {
        <[u8; N]>::try_from(self.get_slice(start..start.saturating_add(N))?)
            .map_err(|_err| bad("unexpected end of buffer"))
    }
}

impl<Target: AsRef<[u8]> + ?Sized> SafeArrayExt for Target {}
