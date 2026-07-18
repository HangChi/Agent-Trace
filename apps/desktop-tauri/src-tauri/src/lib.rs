use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Mutex,
};

use agent_trace_core::{RunningCollector, start_collector};
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};

const COLLECTOR_PORT: u16 = 4319;

struct DesktopState {
    collector: Mutex<Option<RunningCollector>>,
    usage_scanner: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
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
            let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), COLLECTOR_PORT);
            let collector = tauri::async_runtime::block_on(start_collector(database_path, address))
                .map_err(|error| format!("Agent-Trace Collector could not start: {error}"))?;
            let usage_home = app.path().home_dir()?;
            let usage_collector = collector.collector();
            let usage_scanner = tauri::async_runtime::spawn(async move {
                loop {
                    let collector = usage_collector.clone();
                    let home = usage_home.clone();
                    let _ = tauri::async_runtime::spawn_blocking(move || {
                        if let Err(error) = collector.scan_usage_home(&home) {
                            tracing::warn!(%error, "native usage scan failed");
                        }
                    })
                    .await;
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                }
            });
            app.manage(DesktopState {
                collector: Mutex::new(Some(collector)),
                usage_scanner: Mutex::new(Some(usage_scanner)),
            });

            let open = MenuItem::with_id(app, "open", "Open Agent-Trace", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Exit Agent-Trace", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            TrayIconBuilder::new()
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
                })
                .build(app)?;
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

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
