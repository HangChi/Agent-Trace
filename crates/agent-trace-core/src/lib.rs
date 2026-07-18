mod api;
mod database;
mod models;
mod storage;
mod usage_scanner;

pub use api::{Collector, CollectorOptions};
pub use database::{CURRENT_SCHEMA_VERSION, Database};

use std::{net::SocketAddr, path::PathBuf};

use anyhow::Context;
use tokio::{net::TcpListener, sync::oneshot};

pub struct RunningCollector {
    pub address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<anyhow::Result<()>>,
    collector: Collector,
}

impl RunningCollector {
    pub fn collector(&self) -> Collector {
        self.collector.clone()
    }

    pub async fn stop(mut self) -> anyhow::Result<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        self.task.await.context("collector task failed")?
    }
}

pub async fn start_collector(
    database_path: PathBuf,
    address: SocketAddr,
) -> anyhow::Result<RunningCollector> {
    let collector = Collector::open(CollectorOptions { database_path })?;
    let listener = TcpListener::bind(address)
        .await
        .with_context(|| format!("failed to bind collector at {address}"))?;
    let address = listener.local_addr()?;
    let router = collector.router();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await
            .context("collector HTTP server failed")
    });

    Ok(RunningCollector {
        address,
        shutdown: Some(shutdown_tx),
        task,
        collector,
    })
}

#[cfg(test)]
mod tests {
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpStream,
    };

    use super::*;

    #[tokio::test]
    async fn running_collector_serves_health_over_tcp() {
        let directory = tempfile::tempdir().unwrap();
        let collector = start_collector(
            directory.path().join("agent-trace.db"),
            "127.0.0.1:0".parse().unwrap(),
        )
        .await
        .unwrap();
        let mut stream = TcpStream::connect(collector.address).await.unwrap();
        stream
            .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
            .await
            .unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"));
        assert!(response.contains(r#"{"ok":true,"service":"agent-trace"}"#));
        collector.stop().await.unwrap();
    }
}
