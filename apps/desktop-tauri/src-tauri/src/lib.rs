use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::Duration,
};

use agent_trace_core::{
    Collector, CollectorRuntime, RunningCollector, merge_compatible_database,
    start_or_reuse_collector,
};
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const COLLECTOR_PORT: u16 = 4319;

struct DesktopState {
    collector: Arc<Mutex<Option<RunningCollector>>>,
    usage_scanner: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
    takeover_monitor: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "agent_trace=info".into()),
        )
        .with_target(false)
        .compact()
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let database_path = std::env::var_os("AGENT_TRACE_DB_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("agent-trace.db"));
            for legacy_path in legacy_database_candidates(&database_path) {
                match merge_compatible_database(&database_path, &legacy_path) {
                    Ok(imported) if imported > 0 => tracing::info!(
                        imported,
                        source = %legacy_path.display(),
                        "legacy Agent-Trace data imported"
                    ),
                    Ok(_) => {}
                    Err(error) => tracing::warn!(
                        %error,
                        source = %legacy_path.display(),
                        "legacy Agent-Trace data import skipped"
                    ),
                }
            }
            let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), COLLECTOR_PORT);
            let runtime = tauri::async_runtime::block_on(start_or_reuse_collector(
                database_path.clone(),
                address,
            ))
            .map_err(|error| format!("Agent-Trace Collector could not start: {error}"))?;
            let usage_home = app.path().home_dir()?;
            let collector = Arc::new(Mutex::new(None));
            let usage_scanner = Arc::new(Mutex::new(None));
            let takeover_monitor = match runtime {
                CollectorRuntime::Owned(owned_collector) => {
                    let scanner = spawn_usage_scanner(owned_collector.collector(), usage_home);
                    *usage_scanner.lock().expect("usage scanner state poisoned") = Some(scanner);
                    *collector.lock().expect("collector state poisoned") = Some(owned_collector);
                    None
                }
                CollectorRuntime::Reused { address } => {
                    tracing::info!(%address, "reusing an existing Agent-Trace Collector");
                    Some(spawn_takeover_monitor(
                        database_path,
                        address,
                        usage_home,
                        Arc::clone(&collector),
                        Arc::clone(&usage_scanner),
                    ))
                }
            };
            app.manage(DesktopState {
                collector,
                usage_scanner,
                takeover_monitor: Mutex::new(takeover_monitor),
            });

            let open = MenuItem::with_id(app, "open", "Open Agent-Trace", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Exit Agent-Trace", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Agent-Trace desktop application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit)
                && let Some(state) = app.try_state::<DesktopState>()
            {
                if let Ok(mut monitor) = state.takeover_monitor.lock()
                    && let Some(monitor) = monitor.take()
                {
                    monitor.abort();
                }
                if let Ok(mut scanner) = state.usage_scanner.lock()
                    && let Some(scanner) = scanner.take()
                {
                    scanner.abort();
                }
                if let Ok(mut collector) = state.collector.lock()
                    && let Some(collector) = collector.take()
                {
                    let _ = tauri::async_runtime::block_on(collector.stop());
                }
            }
        });
}

fn spawn_usage_scanner(
    collector: Collector,
    home: PathBuf,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        loop {
            let collector = collector.clone();
            let home = home.clone();
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Err(error) = collector.scan_usage_home(&home) {
                    tracing::warn!(%error, "native usage scan failed");
                }
            })
            .await;
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    })
}

fn spawn_takeover_monitor(
    database_path: PathBuf,
    address: SocketAddr,
    usage_home: PathBuf,
    collector_slot: Arc<Mutex<Option<RunningCollector>>>,
    scanner_slot: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let collector =
            wait_for_collector_ownership(database_path, address, Duration::from_secs(1)).await;
        tracing::info!(%address, "desktop Collector took ownership after the reused service exited");
        let scanner = spawn_usage_scanner(collector.collector(), usage_home);
        *collector_slot.lock().expect("collector state poisoned") = Some(collector);
        *scanner_slot.lock().expect("usage scanner state poisoned") = Some(scanner);
    })
}

async fn wait_for_collector_ownership(
    database_path: PathBuf,
    address: SocketAddr,
    retry_interval: Duration,
) -> RunningCollector {
    loop {
        match start_or_reuse_collector(database_path.clone(), address).await {
            Ok(CollectorRuntime::Owned(collector)) => return collector,
            Ok(CollectorRuntime::Reused { .. }) => {}
            Err(error) => tracing::warn!(%error, %address, "desktop Collector takeover waiting"),
        }
        tokio::time::sleep(retry_interval).await;
    }
}

fn legacy_database_candidates(destination: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(configured) = std::env::var_os("AGENT_TRACE_LEGACY_DB_PATH") {
        candidates.push(PathBuf::from(configured));
    }
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(root) = std::env::var_os(variable).map(PathBuf::from) {
            for directory in ["Agent-Trace", "agent-trace", "dev.agent-trace.desktop"] {
                candidates.push(root.join(directory).join("agent-trace.db"));
            }
        }
    }
    if let Ok(current) = std::env::current_dir() {
        for root in current.ancestors().take(6) {
            candidates.push(root.join("apps/server/agent-trace.db"));
            candidates.push(root.join("agent-trace.db"));
        }
    }
    candidates.sort();
    candidates.dedup();
    candidates.retain(|path| path.is_file() && path != destination);
    candidates
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[tokio::test]
    async fn takeover_claims_the_port_after_a_reused_collector_exits() {
        let directory = tempfile::tempdir().unwrap();
        let owner = agent_trace_core::start_collector(
            directory.path().join("source.db"),
            "127.0.0.1:0".parse().unwrap(),
        )
        .await
        .unwrap();
        let address = owner.address;
        let takeover = tokio::spawn(wait_for_collector_ownership(
            directory.path().join("desktop.db"),
            address,
            Duration::from_millis(10),
        ));

        tokio::time::sleep(Duration::from_millis(40)).await;
        assert!(!takeover.is_finished());
        owner.stop().await.unwrap();

        let replacement = tokio::time::timeout(Duration::from_secs(2), takeover)
            .await
            .expect("desktop should claim the released Collector port")
            .unwrap();
        assert_eq!(replacement.address, address);
        replacement.stop().await.unwrap();
    }
}
