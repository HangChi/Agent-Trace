mod api;
mod database;
mod models;
mod storage;
mod usage_scanner;

pub use api::{Collector, CollectorOptions};
pub use database::{CURRENT_SCHEMA_VERSION, Database, merge_compatible_database};

use std::{net::SocketAddr, path::PathBuf, time::Duration};

use anyhow::Context;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

const COLLECTOR_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(200);

pub struct RunningCollector {
    pub address: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    task: tokio::task::JoinHandle<anyhow::Result<()>>,
    collector: Collector,
}

pub enum CollectorRuntime {
    Owned(RunningCollector),
    Reused { address: SocketAddr },
}

impl RunningCollector {
    pub fn collector(&self) -> Collector {
        self.collector.clone()
    }

    pub async fn stop(mut self) -> anyhow::Result<()> {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
        match tokio::time::timeout(COLLECTOR_SHUTDOWN_TIMEOUT, &mut self.task).await {
            Ok(result) => result.context("collector task failed")?,
            Err(_) => {
                self.task.abort();
                let _ = self.task.await;
                Ok(())
            }
        }
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

pub async fn start_or_reuse_collector(
    database_path: PathBuf,
    address: SocketAddr,
) -> anyhow::Result<CollectorRuntime> {
    if is_compatible_collector(address).await {
        return Ok(CollectorRuntime::Reused { address });
    }

    match start_collector(database_path, address).await {
        Ok(collector) => Ok(CollectorRuntime::Owned(collector)),
        Err(error) => {
            if is_compatible_collector(address).await {
                Ok(CollectorRuntime::Reused { address })
            } else {
                Err(error)
            }
        }
    }
}

async fn is_compatible_collector(address: SocketAddr) -> bool {
    let Ok(Ok(mut stream)) =
        tokio::time::timeout(Duration::from_secs(1), TcpStream::connect(address)).await
    else {
        return false;
    };
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    if !matches!(
        tokio::time::timeout(Duration::from_secs(1), stream.read_to_string(&mut response)).await,
        Ok(Ok(_))
    ) {
        return false;
    }
    response.starts_with("HTTP/1.1 200 OK")
        && response.contains(r#""ok":true"#)
        && response.contains(r#""service":"agent-trace""#)
}

#[cfg(test)]
mod tests {
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

    #[tokio::test]
    async fn running_collector_stops_with_an_open_sse_client() {
        let directory = tempfile::tempdir().unwrap();
        let collector = start_collector(
            directory.path().join("agent-trace.db"),
            "127.0.0.1:0".parse().unwrap(),
        )
        .await
        .unwrap();
        let mut stream = TcpStream::connect(collector.address).await.unwrap();
        stream
            .write_all(
                b"GET /changes HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n",
            )
            .await
            .unwrap();
        let mut response = [0_u8; 512];
        let received = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            stream.read(&mut response),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(received > 0);

        tokio::time::timeout(std::time::Duration::from_millis(500), collector.stop())
            .await
            .expect("collector shutdown must not wait forever for SSE clients")
            .unwrap();
    }

    #[tokio::test]
    async fn compatible_collector_is_reused_when_the_desktop_port_is_occupied() {
        let directory = tempfile::tempdir().unwrap();
        let collector = start_collector(
            directory.path().join("web.db"),
            "127.0.0.1:0".parse().unwrap(),
        )
        .await
        .unwrap();
        let address = collector.address;

        let runtime = start_or_reuse_collector(directory.path().join("desktop.db"), address)
            .await
            .expect("a compatible Agent-Trace collector should be reused");
        assert!(
            matches!(runtime, CollectorRuntime::Reused { address: reused } if reused == address)
        );

        collector.stop().await.unwrap();
    }
}
