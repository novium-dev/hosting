pub async fn detached<F>(future: F) -> F::Output
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    tokio::spawn(future)
        .await
        .expect("a detached task panicked")
}
