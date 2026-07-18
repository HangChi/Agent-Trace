use std::{
    convert::Infallible,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{delete, get, patch, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::broadcast;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::{
    Database,
    models::{CreateEvent, CreateRun, RunOrganization, UpdateRun},
    storage::{EventListQuery, PrivacySettings, RunListQuery, Storage},
};

#[derive(Debug, Clone)]
pub struct CollectorOptions {
    pub database_path: PathBuf,
}

#[derive(Clone)]
pub struct Collector {
    state: AppState,
}

#[derive(Clone)]
struct AppState {
    storage: Storage,
    changes: Arc<Changes>,
}

struct Changes {
    revision: AtomicU64,
    sender: broadcast::Sender<ChangeEvent>,
}

#[derive(Debug, Clone, serde::Serialize)]
struct ChangeEvent {
    revision: u64,
    kind: &'static str,
}

impl Collector {
    pub fn open(options: CollectorOptions) -> anyhow::Result<Self> {
        let database = Database::open(options.database_path)?;
        let (sender, _) = broadcast::channel(128);
        Ok(Self {
            state: AppState {
                storage: Storage::new(database),
                changes: Arc::new(Changes {
                    revision: AtomicU64::new(0),
                    sender,
                }),
            },
        })
    }

    pub fn router(&self) -> Router {
        let loopback = AllowOrigin::predicate(|origin: &HeaderValue, _request| {
            origin.to_str().is_ok_and(|value| {
                value.starts_with("http://127.0.0.1:")
                    || value.starts_with("http://localhost:")
                    || value == "tauri://localhost"
                    || value == "http://tauri.localhost"
                    || value == "https://tauri.localhost"
            })
        });
        let cors = CorsLayer::new()
            .allow_origin(loopback)
            .allow_methods([
                Method::GET,
                Method::POST,
                Method::PUT,
                Method::PATCH,
                Method::DELETE,
                Method::OPTIONS,
            ])
            .allow_headers(tower_http::cors::Any);

        Router::new()
            .route("/health", get(health))
            .route("/changes", get(changes))
            .route("/runs", get(list_runs).post(create_run).delete(delete_runs))
            .route(
                "/runs/{id}",
                get(get_run).patch(update_run).delete(delete_run),
            )
            .route("/runs/{id}/events", get(list_events))
            .route("/runs/{id}/export", get(export_run))
            .route("/runs/{id}/insights", get(run_insights))
            .route("/runs/{id}/organization", patch(update_run_organization))
            .route("/runs/{id}/tombstone", delete(restore_tombstone))
            .route("/events", post(create_event))
            .route("/integrations/codex/hook", post(ingest_codex_hook))
            .route(
                "/integrations/codex/otel/v1/logs",
                post(ingest_codex_otlp_logs),
            )
            .route("/integrations/claude-code/hook", post(ingest_claude_hook))
            .route("/integrations/usage-scan", post(ingest_usage_scan))
            .route("/v1/traces", post(ingest_otlp_traces))
            .route("/v1/logs", post(ingest_desktop_otlp_logs))
            .route("/integrations/otlp/v1/traces", post(ingest_otlp_traces))
            .route("/usage/summary", get(usage_summary))
            .route("/usage/scanner", get(scanner_status))
            .route("/analytics/runs/trends", get(run_trends))
            .route("/analytics/runs/compare", get(compare_runs))
            .route("/analytics/breakdown", get(analytics_breakdown))
            .route("/analytics/budgets", get(list_budgets).post(create_budget))
            .route("/analytics/budgets/{id}", delete(delete_budget))
            .route("/analytics/alerts", get(budget_alerts))
            .route("/sandbox/replays", get(list_replays).post(create_replay))
            .route(
                "/sandbox/replays/{id}",
                get(get_replay).delete(cancel_replay),
            )
            .route(
                "/evaluations/datasets",
                get(list_evaluation_datasets).post(create_evaluation_dataset),
            )
            .route("/evaluations/datasets/{id}", get(get_evaluation_dataset))
            .route(
                "/evaluations/datasets/{id}/cases",
                post(create_evaluation_case),
            )
            .route("/evaluations/results", post(record_evaluation_result))
            .route("/maintenance/storage", get(storage_stats))
            .route("/maintenance/tombstones", get(list_tombstones))
            .route("/maintenance/privacy", get(get_privacy).put(update_privacy))
            .route("/maintenance/prune", post(prune_runs))
            .route("/maintenance/compact", post(compact_database))
            .layer(cors)
            .with_state(self.state.clone())
    }

    pub fn scan_usage_home(&self, home: &std::path::Path) -> anyhow::Result<usize> {
        let snapshot = crate::usage_scanner::scan(home);
        let stored = self.state.storage.replace_usage_snapshot(&snapshot)?;
        self.state.changes.publish("usage");
        Ok(stored)
    }
}

impl Changes {
    fn publish(&self, kind: &'static str) {
        let revision = self.revision.fetch_add(1, Ordering::Relaxed) + 1;
        let _ = self.sender.send(ChangeEvent { revision, kind });
    }
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "service": "agent-trace" }))
}

async fn changes(State(state): State<AppState>) -> impl IntoResponse {
    let initial = state.changes.revision.load(Ordering::Relaxed);
    let mut receiver = state.changes.sender.subscribe();
    let stream = async_stream::stream! {
        yield Ok::<Event, Infallible>(Event::default()
            .event("ready").id(initial.to_string())
            .json_data(json!({ "revision": initial })).unwrap());
        loop {
            match receiver.recv().await {
                Ok(change) => yield Ok(Event::default()
                    .event("change").id(change.revision.to_string())
                    .json_data(change).unwrap()),
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream)
}

async fn create_run(
    State(state): State<AppState>,
    Json(run): Json<CreateRun>,
) -> Result<Response, ApiError> {
    if !state.storage.create_run(run)? {
        return Ok((
            StatusCode::CONFLICT,
            Json(json!({ "error": "run_tombstoned" })),
        )
            .into_response());
    }
    state.changes.publish("run");
    Ok((StatusCode::CREATED, Json(json!({ "ok": true }))).into_response())
}

async fn update_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(update): Json<UpdateRun>,
) -> Result<Json<Value>, ApiError> {
    state.storage.update_run(&id, update)?;
    state.changes.publish("run");
    Ok(Json(json!({ "ok": true })))
}

async fn create_event(
    State(state): State<AppState>,
    Json(event): Json<CreateEvent>,
) -> Result<Response, ApiError> {
    state.storage.create_event(event)?;
    state.changes.publish("event");
    Ok((StatusCode::CREATED, Json(json!({ "ok": true }))).into_response())
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RunsQuery {
    legacy: Option<String>,
    include_untracked: Option<String>,
    page: Option<usize>,
    page_size: Option<usize>,
    q: Option<String>,
    status: Option<String>,
    source: Option<String>,
    model: Option<String>,
    project: Option<String>,
    environment: Option<String>,
    tag: Option<String>,
    favorite: Option<bool>,
    started_after: Option<String>,
    started_before: Option<String>,
    min_cost_usd: Option<f64>,
    max_cost_usd: Option<f64>,
    sort: Option<String>,
    order: Option<String>,
}

async fn list_runs(
    State(state): State<AppState>,
    Query(query): Query<RunsQuery>,
) -> Result<Json<Value>, ApiError> {
    let include_untracked = bool_query(query.include_untracked.as_deref());
    if bool_query(query.legacy.as_deref()) {
        return Ok(Json(serde_json::to_value(
            state.storage.list_runs_legacy(include_untracked)?,
        )?));
    }
    let page = state.storage.list_runs(RunListQuery {
        include_untracked,
        page: query.page,
        page_size: query.page_size,
        q: query.q,
        status: query.status,
        source: query.source,
        model: query.model,
        project: query.project,
        environment: query.environment,
        tag: query.tag,
        favorite: query.favorite,
        started_after: query.started_after,
        started_before: query.started_before,
        min_cost_usd: query.min_cost_usd,
        max_cost_usd: query.max_cost_usd,
        sort: query.sort,
        order: query.order,
    })?;
    Ok(Json(serde_json::to_value(page)?))
}

async fn get_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match state.storage.get_run(&id)? {
        Some(run) => Ok(Json(run).into_response()),
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "run_not_found" })),
        )
            .into_response()),
    }
}

#[derive(Debug, Deserialize, Default)]
struct EventsQuery {
    legacy: Option<String>,
    visibility: Option<String>,
    page: Option<usize>,
    #[serde(rename = "pageSize")]
    page_size: Option<usize>,
    q: Option<String>,
    status: Option<String>,
    #[serde(rename = "type")]
    event_type: Option<String>,
    category: Option<String>,
}

async fn list_events(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<Value>, ApiError> {
    if bool_query(query.legacy.as_deref()) {
        return Ok(Json(serde_json::to_value(
            state.storage.list_events_legacy(&id)?,
        )?));
    }
    Ok(Json(state.storage.list_events_page(
        &id,
        EventListQuery {
            visibility: query.visibility,
            page: query.page,
            page_size: query.page_size,
            q: query.q,
            status: query.status,
            event_type: query.event_type,
            category: query.category,
        },
    )?))
}

async fn export_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match state.storage.export_redacted_run(&id)? {
        Some(value) => Ok((
            [
                (header::CONTENT_TYPE, "application/json; charset=UTF-8"),
                (
                    header::CONTENT_DISPOSITION,
                    &format!("attachment; filename=\"agent-trace-{id}.json\""),
                ),
            ],
            serde_json::to_string_pretty(&value)?,
        )
            .into_response()),
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "run_not_found" })),
        )
            .into_response()),
    }
}

async fn run_insights(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "insights": state.storage.trace_insights(&id)? }),
    ))
}

#[derive(Debug, Deserialize)]
struct CompareQuery {
    ids: Option<String>,
}

async fn compare_runs(
    State(state): State<AppState>,
    Query(query): Query<CompareQuery>,
) -> Result<Response, ApiError> {
    let mut ids = Vec::new();
    for id in query.ids.as_deref().unwrap_or_default().split(',') {
        let id = id.trim();
        if !id.is_empty() && !ids.iter().any(|existing| existing == id) {
            ids.push(id.to_owned());
        }
    }
    if !(2..=5).contains(&ids.len()) {
        return Ok((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "comparison_requires_2_to_5_runs" })),
        )
            .into_response());
    }
    Ok(Json(state.storage.compare_runs(&ids)?).into_response())
}

async fn update_run_organization(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(organization): Json<RunOrganization>,
) -> Result<Response, ApiError> {
    if state.storage.update_organization(&id, organization)? {
        state.changes.publish("run");
        Ok(Json(json!({ "ok": true })).into_response())
    } else {
        Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "run_not_found" })),
        )
            .into_response())
    }
}

async fn delete_run(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if state.storage.delete_run(&id)? {
        state.changes.publish("maintenance");
        Ok(Json(json!({ "ok": true })).into_response())
    } else {
        Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "run_not_found" })),
        )
            .into_response())
    }
}

async fn delete_runs(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let ids = body
        .get("ids")
        .and_then(Value::as_array)
        .ok_or_else(|| ApiError::bad_request("invalid_run_ids"))?
        .iter()
        .map(|id| id.as_str().map(ToOwned::to_owned))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| ApiError::bad_request("invalid_run_ids"))?;
    let deleted = state.storage.delete_runs(&ids)?;
    if deleted > 0 {
        state.changes.publish("maintenance");
    }
    Ok(Json(json!({ "ok": true, "deleted": deleted })))
}

async fn restore_tombstone(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if state.storage.restore_tombstone(&id)? {
        state.changes.publish("maintenance");
        Ok(Json(json!({ "ok": true })).into_response())
    } else {
        Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "tombstone_not_found" })),
        )
            .into_response())
    }
}

async fn ingest_usage_scan(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    match state.storage.replace_usage_snapshot(&body) {
        Ok(stored) => {
            state.changes.publish("usage");
            (
                StatusCode::ACCEPTED,
                Json(json!({ "ok": true, "stored": stored })),
            )
                .into_response()
        }
        Err(error) => (
            StatusCode::ACCEPTED,
            Json(json!({ "ok": true, "stored": 0, "error": error.to_string() })),
        )
            .into_response(),
    }
}

#[derive(Debug, Deserialize, Default)]
struct HookQuery {
    surface: Option<String>,
    #[serde(rename = "surface_source", alias = "surfaceSource")]
    surface_source: Option<String>,
}

async fn ingest_codex_hook(
    State(state): State<AppState>,
    Query(query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    ingest_hook(&state, "codex", query, body)
}

async fn ingest_claude_hook(
    State(state): State<AppState>,
    Query(query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    ingest_hook(&state, "claude-code", query, body)
}

fn ingest_hook(state: &AppState, source: &str, query: HookQuery, body: Value) -> Response {
    match state.storage.ingest_agent_hook(
        source,
        &body,
        query.surface.as_deref(),
        query.surface_source.as_deref(),
    ) {
        Ok(result) => {
            state.changes.publish("event");
            let mut response = json!({ "ok": true });
            if let (Some(target), Some(source)) = (response.as_object_mut(), result.as_object()) {
                target.extend(source.clone());
            }
            (StatusCode::ACCEPTED, Json(response)).into_response()
        }
        Err(error) => (
            StatusCode::ACCEPTED,
            Json(json!({ "ok": true, "stored": false, "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn ingest_otlp_traces(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    match state.storage.ingest_otlp_traces(&body) {
        Ok(result) => {
            state.changes.publish("event");
            let mut response = json!({ "ok": true });
            if let (Some(target), Some(source)) = (response.as_object_mut(), result.as_object()) {
                target.extend(source.clone());
            }
            (StatusCode::ACCEPTED, Json(response)).into_response()
        }
        Err(error) => (
            StatusCode::ACCEPTED,
            Json(json!({ "ok": true, "runs": 0, "events": 0, "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn ingest_codex_otlp_logs(
    State(state): State<AppState>,
    Query(query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    ingest_otlp_logs(&state, query, body)
}

async fn ingest_desktop_otlp_logs(
    State(state): State<AppState>,
    Query(mut query): Query<HookQuery>,
    Json(body): Json<Value>,
) -> Response {
    query.surface.get_or_insert_with(|| "desktop".to_owned());
    query
        .surface_source
        .get_or_insert_with(|| "default-v1-logs".to_owned());
    ingest_otlp_logs(&state, query, body)
}

fn ingest_otlp_logs(state: &AppState, query: HookQuery, body: Value) -> Response {
    match state.storage.ingest_codex_otlp_logs(
        &body,
        query.surface.as_deref(),
        query.surface_source.as_deref(),
    ) {
        Ok(result) => {
            state.changes.publish("event");
            let mut response = json!({ "ok": true });
            if let (Some(target), Some(source)) = (response.as_object_mut(), result.as_object()) {
                target.extend(source.clone());
            }
            (StatusCode::ACCEPTED, Json(response)).into_response()
        }
        Err(error) => (
            StatusCode::ACCEPTED,
            Json(json!({ "ok": true, "stored": 0, "error": error.to_string() })),
        )
            .into_response(),
    }
}

async fn usage_summary(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.storage.usage_summary()?))
}

async fn scanner_status(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.storage.scanner_status()?))
}

#[derive(Debug, Deserialize)]
struct TrendsQuery {
    days: Option<usize>,
}

async fn run_trends(
    State(state): State<AppState>,
    Query(query): Query<TrendsQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.storage.trends(query.days.unwrap_or(14))?))
}

#[derive(Debug, Deserialize)]
struct BreakdownQuery {
    days: Option<usize>,
    dimension: Option<String>,
}

async fn analytics_breakdown(
    State(state): State<AppState>,
    Query(query): Query<BreakdownQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.storage.analytics_breakdown(
        query.days.unwrap_or(14),
        query.dimension.as_deref().unwrap_or("project"),
    )?))
}

async fn list_budgets(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({ "budgets": state.storage.list_budgets()? })))
}

async fn create_budget(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Response, ApiError> {
    let budget = state.storage.create_budget(&input)?;
    state.changes.publish("analytics");
    Ok((StatusCode::CREATED, Json(budget)).into_response())
}

async fn delete_budget(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    if state.storage.delete_budget(&id)? {
        state.changes.publish("analytics");
        Ok(Json(json!({ "ok": true })).into_response())
    } else {
        Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "analytics_budget_not_found" })),
        )
            .into_response())
    }
}

async fn budget_alerts(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({ "alerts": state.storage.budget_alerts()? })))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ReplayQuery {
    source_run_id: Option<String>,
    limit: Option<usize>,
}

async fn list_replays(
    State(state): State<AppState>,
    Query(query): Query<ReplayQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "tasks": state.storage.list_replay_tasks(
            query.source_run_id.as_deref(),
            query.limit.unwrap_or(50),
        )?
    })))
}

async fn get_replay(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match state.storage.get_replay_task(&id)? {
        Some(task) => Ok(Json(json!({ "task": task })).into_response()),
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "replay_task_not_found" })),
        )
            .into_response()),
    }
}

async fn create_replay(State(state): State<AppState>, Json(input): Json<Value>) -> Response {
    match state.storage.create_replay_task(&input) {
        Ok(task) => {
            let id = task["id"].as_str().unwrap_or_default().to_owned();
            let storage = state.storage.clone();
            let changes = state.changes.clone();
            tokio::spawn(async move {
                let _ = storage.execute_replay_task(&id).await;
                changes.publish("replay");
            });
            state.changes.publish("replay");
            (StatusCode::ACCEPTED, Json(json!({ "task": task }))).into_response()
        }
        Err(error) => {
            let code = error.to_string();
            let status = match code.as_str() {
                "source_run_not_found" | "source_event_not_found" => StatusCode::NOT_FOUND,
                "replay_payload_too_large" => StatusCode::PAYLOAD_TOO_LARGE,
                _ => StatusCode::BAD_REQUEST,
            };
            (status, Json(json!({ "error": code }))).into_response()
        }
    }
}

async fn cancel_replay(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match state.storage.cancel_replay_task(&id)? {
        Some(task) => {
            state.changes.publish("replay");
            Ok(Json(json!({ "task": task })).into_response())
        }
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "replay_task_not_found" })),
        )
            .into_response()),
    }
}

async fn list_evaluation_datasets(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        json!({ "datasets": state.storage.list_evaluation_datasets()? }),
    ))
}

async fn create_evaluation_dataset(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Response, ApiError> {
    let dataset = state.storage.create_evaluation_dataset(&input)?;
    state.changes.publish("evaluation");
    Ok((StatusCode::CREATED, Json(dataset)).into_response())
}

async fn get_evaluation_dataset(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    match state.storage.evaluation_report(&id)? {
        Some(report) => Ok(Json(report).into_response()),
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "evaluation_dataset_not_found" })),
        )
            .into_response()),
    }
}

async fn create_evaluation_case(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(input): Json<Value>,
) -> Result<Response, ApiError> {
    match state.storage.create_evaluation_case(&id, &input)? {
        Some(case) => {
            state.changes.publish("evaluation");
            Ok((StatusCode::CREATED, Json(case)).into_response())
        }
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "evaluation_dataset_not_found" })),
        )
            .into_response()),
    }
}

async fn record_evaluation_result(
    State(state): State<AppState>,
    Json(input): Json<Value>,
) -> Result<Response, ApiError> {
    match state.storage.record_evaluation_result(&input)? {
        Some(result) => {
            state.changes.publish("evaluation");
            Ok((StatusCode::CREATED, Json(result)).into_response())
        }
        None => Ok((
            StatusCode::NOT_FOUND,
            Json(json!({ "error": "evaluation_case_or_run_not_found" })),
        )
            .into_response()),
    }
}

async fn storage_stats(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    Ok(Json(state.storage.storage_stats()?))
}

#[derive(Debug, Deserialize)]
struct LimitQuery {
    limit: Option<usize>,
}

async fn list_tombstones(
    State(state): State<AppState>,
    Query(query): Query<LimitQuery>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({
        "tombstones": state.storage.tombstones(query.limit.unwrap_or(50))?
    })))
}

async fn get_privacy(State(state): State<AppState>) -> Result<Json<PrivacySettings>, ApiError> {
    Ok(Json(state.storage.privacy_settings()?))
}

async fn update_privacy(
    State(state): State<AppState>,
    Json(value): Json<PrivacySettings>,
) -> Result<Json<PrivacySettings>, ApiError> {
    let result = state.storage.update_privacy_settings(value)?;
    state.changes.publish("maintenance");
    Ok(Json(result))
}

async fn prune_runs(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let before = body
        .get("before")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiError::bad_request("invalid_prune_before"))?;
    let statuses: Vec<String> = body
        .get("statuses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect();
    let keep = body
        .get("keepTombstones")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let deleted = state.storage.prune(before, &statuses, keep)?;
    if deleted > 0 {
        state.changes.publish("maintenance");
    }
    Ok(Json(json!({ "ok": true, "deleted": deleted })))
}

async fn compact_database(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    state.storage.compact()?;
    state.changes.publish("maintenance");
    Ok(Json(json!({ "ok": true })))
}

fn bool_query(value: Option<&str>) -> bool {
    matches!(value, Some("1" | "true"))
}

struct ApiError {
    status: StatusCode,
    code: &'static str,
    detail: Option<String>,
}

impl ApiError {
    fn bad_request(code: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code,
            detail: None,
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "internal_error",
            detail: Some(error.to_string()),
        }
    }
}

impl From<serde_json::Error> for ApiError {
    fn from(error: serde_json::Error) -> Self {
        anyhow::Error::from(error).into()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut body = json!({ "error": self.code });
        if cfg!(debug_assertions) {
            body["detail"] = self.detail.into();
        }
        (self.status, Json(body)).into_response()
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{Body, to_bytes},
        http::Request,
    };
    use tower::ServiceExt;

    use super::*;

    fn app() -> (tempfile::TempDir, Router) {
        let directory = tempfile::tempdir().unwrap();
        let collector = Collector::open(CollectorOptions {
            database_path: directory.path().join("agent-trace.db"),
        })
        .unwrap();
        (directory, collector.router())
    }

    async fn json_response(response: Response) -> Value {
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }

    async fn post_json(app: &Router, path: &str, body: Value) -> Response {
        app.clone()
            .oneshot(
                Request::post(path)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn health_matches_the_node_collector() {
        let (_directory, app) = app();
        let response = app
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            json_response(response).await,
            json!({ "ok": true, "service": "agent-trace" })
        );
    }

    #[tokio::test]
    async fn cors_allows_the_windows_tauri_webview_origin() {
        let (_directory, app) = app();
        let response = app
            .oneshot(
                Request::get("/health")
                    .header("origin", "http://tauri.localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("access-control-allow-origin")
                .unwrap(),
            "http://tauri.localhost"
        );
    }

    #[tokio::test]
    async fn sdk_run_and_event_contract_round_trips() {
        let (_directory, app) = app();
        let run = json!({ "id": "run-1", "name": "test", "status": "running" });
        let response = app
            .clone()
            .oneshot(
                Request::post("/runs")
                    .header("content-type", "application/json")
                    .body(Body::from(run.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let event = json!({
            "id":"event-1", "runId":"run-1", "type":"tool_call", "name":"shell",
            "status":"success", "metadata":{"category":"tool"}
        });
        let response = app
            .clone()
            .oneshot(
                Request::post("/events")
                    .header("content-type", "application/json")
                    .body(Body::from(event.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::CREATED);
        let response = app
            .oneshot(
                Request::get("/runs?includeUntracked=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let body = json_response(response).await;
        assert_eq!(body["runs"][0]["id"], "run-1");
    }

    #[tokio::test]
    async fn desktop_read_models_match_node_response_shapes() {
        let (_directory, app) = app();
        for run in [
            json!({
                "id": "baseline", "name": "baseline", "status": "success",
                "startedAt": "2026-01-01T00:00:00.000Z",
                "endedAt": "2026-01-01T00:00:01.000Z",
                "input": { "secret": "must-not-export" },
                "metadata": { "agent": "codex", "private": "must-not-export" }
            }),
            json!({
                "id": "candidate", "name": "candidate", "status": "error",
                "startedAt": "2026-01-01T00:00:00.000Z",
                "endedAt": "2026-01-01T00:00:02.000Z"
            }),
        ] {
            assert_eq!(
                post_json(&app, "/runs", run).await.status(),
                StatusCode::CREATED
            );
        }
        for (index, status, duration, tokens) in [
            (1, "error", 10_000, 100),
            (2, "error", 1, 100),
            (3, "success", 1, 1_000),
        ] {
            let event = json!({
                "id": format!("base-{index}"), "runId": "baseline", "type": "tool_call",
                "name": "shell", "status": status, "durationMs": duration,
                "input": { "command": "private" },
                "metadata": { "category": "tool", "toolName": "shell", "tokenUsage": { "total": tokens } }
            });
            assert_eq!(
                post_json(&app, "/events", event).await.status(),
                StatusCode::CREATED
            );
        }
        let candidate = json!({
            "id": "candidate-1", "runId": "candidate", "type": "tool_call", "name": "shell",
            "status": "error", "durationMs": 15_000,
            "metadata": { "category": "tool", "tokenUsage": { "total": 250 } }
        });
        assert_eq!(
            post_json(&app, "/events", candidate).await.status(),
            StatusCode::CREATED
        );

        let export = app
            .clone()
            .oneshot(
                Request::get("/runs/baseline/export")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(export.status(), StatusCode::OK);
        let export = json_response(export).await;
        assert_eq!(export["schemaVersion"], 1);
        assert_eq!(export["run"]["name"], "redacted-run");
        assert!(export["run"].get("input").is_none());
        assert!(export["run"]["metadata"].get("private").is_none());

        let insights = app
            .clone()
            .oneshot(
                Request::get("/runs/baseline/insights")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let insights = json_response(insights).await;
        assert!(
            insights["insights"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value["kind"] == "retry_loop")
        );
        assert!(
            insights["insights"]
                .as_array()
                .unwrap()
                .iter()
                .any(|value| value["kind"] == "slow_step")
        );

        let comparison = app
            .oneshot(
                Request::get("/analytics/runs/compare?ids=baseline,candidate")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let comparison = json_response(comparison).await;
        assert_eq!(comparison["runs"].as_array().unwrap().len(), 2);
        assert!(comparison["regressionCount"].as_u64().unwrap() > 0);
    }

    #[tokio::test]
    async fn desktop_ingests_hooks_and_otlp_without_node() {
        let (_directory, app) = app();
        let hook = json!({
            "session_id": "session-1", "hook_event_name": "PostToolUse",
            "tool_name": "Bash", "tool_input": { "command": "cargo test" },
            "model": "gpt-5"
        });
        let response = post_json(
            &app,
            "/integrations/codex/hook?surface=cli&surface_source=agent-trace-cli",
            hook,
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let response = json_response(response).await;
        assert_eq!(response["stored"], true);
        assert_eq!(response["runId"], "run_codex_session-1");

        let traces = json!({
            "resourceSpans": [{
                "resource": { "attributes": [
                    { "key": "service.name", "value": { "stringValue": "checkout-agent" } },
                    { "key": "deployment.environment.name", "value": { "stringValue": "production" } }
                ] },
                "scopeSpans": [{ "spans": [{
                    "traceId": "trace-1", "spanId": "span-1", "name": "call-model",
                    "startTimeUnixNano": "1784109600500000000",
                    "endTimeUnixNano": "1784109601500000000",
                    "status": { "code": 1 },
                    "attributes": [
                        { "key": "gen_ai.operation.name", "value": { "stringValue": "chat" } },
                        { "key": "gen_ai.request.model", "value": { "stringValue": "gpt-5" } },
                        { "key": "gen_ai.usage.input_tokens", "value": { "intValue": "60" } },
                        { "key": "gen_ai.usage.output_tokens", "value": { "intValue": "40" } }
                    ]
                }] }]
            }]
        });
        let response = post_json(&app, "/v1/traces", traces).await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let response = json_response(response).await;
        assert_eq!(response, json!({ "ok": true, "runs": 1, "events": 1 }));

        let response = app
            .clone()
            .oneshot(
                Request::get("/runs/otlp%3Atrace-1/events?legacy=1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let events = json_response(response).await;
        assert_eq!(events[0]["type"], "llm_call");
        assert_eq!(events[0]["durationMs"], 1_000);
        assert_eq!(events[0]["metadata"]["tokenUsage"]["total"], 100.0);

        let logs = json!({
            "resourceLogs": [{ "scopeLogs": [{ "logRecords": [{
                "timeUnixNano": "1784109601500000000",
                "body": { "stringValue": "codex.sse_event" },
                "attributes": [
                    { "key": "conversation_id", "value": { "stringValue": "otel-session" } },
                    { "key": "input_tokens", "value": { "intValue": "80" } },
                    { "key": "output_tokens", "value": { "intValue": "20" } }
                ]
            }] }] }]
        });
        let response = post_json(&app, "/v1/logs", logs).await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let response = json_response(response).await;
        assert_eq!(response["stored"], 1);

        let response = app
            .oneshot(
                Request::get("/runs/run_codex_otel-session/events?legacy=1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let events = json_response(response).await;
        assert_eq!(events[0]["metadata"]["surface"], "desktop");
        assert_eq!(events[0]["metadata"]["tokenUsage"]["total"], 100.0);
    }

    #[tokio::test]
    async fn replay_sandbox_is_mock_only_and_materializes_a_run() {
        let (_directory, app) = app();
        assert_eq!(
            post_json(
                &app,
                "/runs",
                json!({ "id": "source", "name": "source", "status": "success" }),
            )
            .await
            .status(),
            StatusCode::CREATED
        );
        assert_eq!(
            post_json(
                &app,
                "/events",
                json!({
                    "id": "source-event", "runId": "source", "type": "tool_call",
                    "name": "shell", "status": "success", "input": { "command": "echo safe" }
                }),
            )
            .await
            .status(),
            StatusCode::CREATED
        );
        let response = post_json(
            &app,
            "/sandbox/replays",
            json!({
                "sourceRunId": "source", "sourceEventId": "source-event",
                "mockOutput": { "stdout": "mocked" }, "timeoutMs": 1_000
            }),
        )
        .await;
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let task = json_response(response).await["task"].clone();
        assert_eq!(task["policy"]["network"], "disabled");
        let id = task["id"].as_str().unwrap();
        let mut completed = None;
        for _ in 0..20 {
            let response = app
                .clone()
                .oneshot(
                    Request::get(format!("/sandbox/replays/{id}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let task = json_response(response).await["task"].clone();
            if task["status"] == "completed" {
                completed = Some(task);
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        let completed = completed.expect("replay should complete");
        assert_eq!(completed["workspaceCleaned"], true);
        assert!(
            completed["replayRunId"]
                .as_str()
                .unwrap()
                .starts_with("replay:")
        );
    }
}
