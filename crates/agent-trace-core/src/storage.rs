use std::collections::{BTreeMap, HashMap, HashSet};

use anyhow::{Context, bail};
use chrono::{SecondsFormat, Utc};
use rusqlite::{OptionalExtension, params, params_from_iter};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    Database,
    models::{
        AgentCount, CreateEvent, CreateRun, DashboardEvent, DashboardRun, Page, Pagination,
        RunOrganization, RunPageSummary, UpdateRun,
    },
};

const DEFAULT_RUN_PAGE_SIZE: usize = 50;
const MAX_RUN_PAGE_SIZE: usize = 200;
const DEFAULT_EVENT_PAGE_SIZE: usize = 100;
const MAX_EVENT_PAGE_SIZE: usize = 500;

#[derive(Clone)]
pub(crate) struct Storage {
    database: Database,
}

#[derive(Default)]
pub(crate) struct RunListQuery {
    pub include_untracked: bool,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
    pub q: Option<String>,
    pub status: Option<String>,
    pub source: Option<String>,
    pub model: Option<String>,
    pub project: Option<String>,
    pub environment: Option<String>,
    pub tag: Option<String>,
    pub favorite: Option<bool>,
    pub started_after: Option<String>,
    pub started_before: Option<String>,
    pub min_cost_usd: Option<f64>,
    pub max_cost_usd: Option<f64>,
    pub sort: Option<String>,
    pub order: Option<String>,
}

#[derive(Default)]
pub(crate) struct EventListQuery {
    pub visibility: Option<String>,
    pub page: Option<usize>,
    pub page_size: Option<usize>,
    pub q: Option<String>,
    pub status: Option<String>,
    pub event_type: Option<String>,
    pub category: Option<String>,
}

impl Storage {
    pub fn new(database: Database) -> Self {
        Self { database }
    }

    pub fn create_run(&self, mut run: CreateRun) -> anyhow::Result<bool> {
        validate_identifier(&run.id, "run id")?;
        validate_required_text(&run.name, "run name")?;
        validate_status(&run.status)?;
        let mut connection = self.database.connection()?;
        let transaction = connection.transaction()?;
        let tombstoned = transaction
            .query_row(
                "SELECT 1 FROM run_tombstones WHERE run_id = ?1",
                [&run.id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if tombstoned {
            return Ok(false);
        }
        let privacy = read_privacy_settings(&transaction)?;
        redact_option(&mut run.input, &privacy);
        redact_option(&mut run.output, &privacy);
        redact_option(&mut run.metadata, &privacy);
        transaction.execute(
            "INSERT INTO runs (
                id, name, status, started_at, ended_at, input_json, output_json, error, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                run.id,
                run.name,
                run.status,
                run.started_at.unwrap_or_else(now),
                run.ended_at,
                stringify(run.input),
                stringify(run.output),
                run.error,
                stringify(run.metadata),
            ],
        )?;
        transaction.commit()?;
        Ok(true)
    }

    pub fn update_run(&self, id: &str, mut update: UpdateRun) -> anyhow::Result<bool> {
        validate_status(&update.status)?;
        let privacy = self.privacy_settings()?;
        redact_option(&mut update.output, &privacy);
        let ended_at = match update.ended_at {
            Some(value) => value,
            None if update.status == "running" => None,
            None => Some(now()),
        };
        let clear_error = update.error.is_none() && update.status != "error";
        let connection = self.database.connection()?;
        let changes = connection.execute(
            "UPDATE runs SET
                status = ?2,
                ended_at = ?3,
                output_json = CASE WHEN ?4 THEN ?5 ELSE output_json END,
                error = CASE WHEN ?6 THEN NULL WHEN ?7 THEN ?8 ELSE error END
             WHERE id = ?1",
            params![
                id,
                update.status,
                ended_at,
                update.output.is_some(),
                stringify(update.output),
                clear_error,
                update.error.is_some(),
                update.error,
            ],
        )?;
        Ok(changes > 0)
    }

    pub fn create_event(&self, mut event: CreateEvent) -> anyhow::Result<()> {
        validate_identifier(&event.id, "event id")?;
        validate_identifier(&event.run_id, "run id")?;
        validate_required_text(&event.name, "event name")?;
        validate_status(&event.status)?;
        let privacy = self.privacy_settings()?;
        redact_option(&mut event.input, &privacy);
        redact_option(&mut event.output, &privacy);
        redact_option(&mut event.error, &privacy);
        redact_option(&mut event.metadata, &privacy);
        self.database.connection()?.execute(
            "INSERT INTO events (
                id, run_id, parent_id, type, name, status, timestamp, duration_ms,
                input_json, output_json, error_json, metadata_json
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                event.id,
                event.run_id,
                event.parent_id,
                event.event_type,
                event.name,
                event.status,
                event.timestamp.unwrap_or_else(now),
                event.duration_ms,
                stringify(event.input),
                stringify(event.output),
                stringify(event.error),
                stringify(event.metadata),
            ],
        )?;
        Ok(())
    }

    pub fn ingest_agent_hook(
        &self,
        source: &str,
        body: &Value,
        surface: Option<&str>,
        surface_source: Option<&str>,
    ) -> anyhow::Result<Value> {
        let session_id = first_text(
            body,
            &[
                "session_id",
                "sessionId",
                "conversation_id",
                "conversationId",
            ],
        )
        .unwrap_or("unknown");
        let hook_event = first_text(body, &["hook_event_name", "hookEventName", "hookEvent"])
            .unwrap_or("unknown");
        let tool_name = first_text(body, &["tool_name", "toolName"]);
        let run_id = format!("run_{}_{}", id_part(source), id_part(session_id));
        if self.get_run(&run_id)?.is_none() {
            let mut metadata = json!({
                "agent": source,
                "sessionId": session_id,
                "redactionLevel": "metadata",
            });
            insert_optional(&mut metadata, "model", first_text(body, &["model"]));
            insert_optional(&mut metadata, "provider", inferred_provider(source, body));
            insert_optional(
                &mut metadata,
                "surface",
                surface.or_else(|| first_text(body, &["surface"])),
            );
            insert_optional(&mut metadata, "surfaceSource", surface_source);
            let created = self.create_run(CreateRun {
                id: run_id.clone(),
                name: format!("{source}:{session_id}"),
                status: "running".to_owned(),
                started_at: None,
                ended_at: None,
                input: Some(json!({ "source": "agent-hook", "redactionLevel": "metadata" })),
                output: None,
                error: None,
                metadata: Some(metadata),
            })?;
            if !created {
                return Ok(json!({ "stored": false, "runId": run_id }));
            }
        }
        let known = known_hook_event(hook_event);
        let status = if !known
            || matches!(
                hook_event,
                "PermissionDenied" | "PostToolUseFailure" | "StopFailure"
            ) {
            "error"
        } else if running_hook_event(hook_event) {
            "running"
        } else {
            "success"
        };
        let event_type = hook_event_type(hook_event, known);
        let event_id = format!("evt_{}", Uuid::new_v4());
        let command = body
            .get("tool_input")
            .or_else(|| body.get("toolInput"))
            .and_then(|value| value.get("command"))
            .and_then(Value::as_str);
        let category = hook_category(hook_event, tool_name, command);
        let mut metadata = json!({
            "agent": source,
            "sessionId": session_id,
            "hookEvent": hook_event,
            "redactionLevel": "metadata",
            "category": category,
        });
        for (key, source_keys) in [
            ("model", &["model"][..]),
            ("turnId", &["turn_id", "turnId"][..]),
            ("promptId", &["prompt_id", "promptId"][..]),
            ("toolUseId", &["tool_use_id", "toolUseId"][..]),
            ("permissionMode", &["permission_mode", "permissionMode"][..]),
            ("cwd", &["cwd"][..]),
        ] {
            insert_optional(&mut metadata, key, first_text(body, source_keys));
        }
        insert_optional(&mut metadata, "toolName", tool_name);
        insert_optional(&mut metadata, "command", command);
        insert_optional(&mut metadata, "provider", inferred_provider(source, body));
        insert_optional(
            &mut metadata,
            "surface",
            surface.or_else(|| first_text(body, &["surface"])),
        );
        insert_optional(&mut metadata, "surfaceSource", surface_source);
        self.create_event(CreateEvent {
            id: event_id.clone(),
            run_id: run_id.clone(),
            parent_id: None,
            event_type: event_type.to_owned(),
            name: hook_event_name(hook_event, tool_name, command),
            status: status.to_owned(),
            timestamp: None,
            duration_ms: body
                .get("duration_ms")
                .or_else(|| body.get("durationMs"))
                .and_then(Value::as_i64),
            input: command.map(|value| json!({ "command": value })),
            output: None,
            error: (status == "error").then(|| json!({
                "message": if known { format!("Agent hook reported {hook_event}") } else { "Unknown agent hook payload".to_owned() }
            })),
            metadata: Some(metadata),
        })?;
        if matches!(hook_event, "SessionEnd" | "Stop" | "StopFailure") {
            let final_status = if hook_event == "StopFailure" {
                "error"
            } else {
                "success"
            };
            self.update_run(
                &run_id,
                UpdateRun {
                    status: final_status.to_owned(),
                    ended_at: Some(Some(now())),
                    output: None,
                    error: (final_status == "error")
                        .then(|| "Agent hook reported StopFailure".to_owned()),
                },
            )?;
        }
        Ok(json!({ "stored": true, "eventId": event_id, "runId": run_id }))
    }

    pub fn ingest_otlp_traces(&self, payload: &Value) -> anyhow::Result<Value> {
        let mut traces = BTreeMap::<String, (Map<String, Value>, Vec<&Value>)>::new();
        for resource_span in array_at(payload, "resourceSpans") {
            let resource_attributes =
                otlp_attributes(resource_span.pointer("/resource/attributes"));
            for scope in array_at(resource_span, "scopeSpans") {
                for span in array_at(scope, "spans") {
                    let Some(trace_id) = span.get("traceId").and_then(Value::as_str) else {
                        continue;
                    };
                    traces
                        .entry(trace_id.to_owned())
                        .or_insert_with(|| (resource_attributes.clone(), Vec::new()))
                        .1
                        .push(span);
                }
            }
        }
        let mut event_count = 0;
        for (trace_id, (resource, spans)) in &traces {
            let run_id = format!("otlp:{trace_id}");
            let earliest = spans
                .iter()
                .filter_map(|span| nano_iso(span.get("startTimeUnixNano")))
                .min();
            let latest = spans
                .iter()
                .filter_map(|span| nano_iso(span.get("endTimeUnixNano")))
                .max();
            let root_name = spans
                .iter()
                .find(|span| {
                    span.get("parentSpanId")
                        .and_then(Value::as_str)
                        .is_none_or(str::is_empty)
                })
                .and_then(|span| span.get("name"))
                .and_then(Value::as_str);
            let service = resource
                .get("service.name")
                .and_then(Value::as_str)
                .or(root_name)
                .unwrap_or("otlp-service");
            let status = if spans.iter().any(|span| otlp_error(span.get("status"))) {
                "error"
            } else {
                "success"
            };
            let mut metadata = resource.clone();
            metadata.insert("source".to_owned(), json!("otlp"));
            metadata.insert("project".to_owned(), json!(service));
            if let Some(environment) = resource.get("deployment.environment.name") {
                metadata.insert("environment".to_owned(), environment.clone());
            }
            self.upsert_otlp_run(
                &run_id,
                service,
                status,
                earliest.as_deref(),
                latest.as_deref(),
                Value::Object(metadata),
            )?;
            for span in spans {
                self.upsert_otlp_event(&run_id, span)?;
                event_count += 1;
            }
        }
        Ok(json!({ "runs": traces.len(), "events": event_count }))
    }

    pub fn ingest_codex_otlp_logs(
        &self,
        payload: &Value,
        surface: Option<&str>,
        surface_source: Option<&str>,
    ) -> anyhow::Result<Value> {
        let mut stored = 0;
        let mut event_ids = Vec::new();
        let mut run_ids = Vec::<String>::new();
        for resource_log in array_at(payload, "resourceLogs") {
            let resource_attributes = otlp_attributes(resource_log.pointer("/resource/attributes"));
            for scope in array_at(resource_log, "scopeLogs") {
                for record in array_at(scope, "logRecords") {
                    let mut attributes = resource_attributes.clone();
                    attributes.extend(otlp_attributes(record.get("attributes")));
                    let session_id = [
                        "conversation_id",
                        "conversation.id",
                        "codex.conversation_id",
                        "codex.conversation.id",
                        "thread_id",
                        "thread.id",
                    ]
                    .iter()
                    .find_map(|key| attributes.get(*key).and_then(Value::as_str))
                    .unwrap_or("unknown")
                    .to_owned();
                    let run_id = format!("run_codex_{}", id_part(&session_id));
                    let timestamp = nano_iso(record.get("timeUnixNano")).unwrap_or_else(now);
                    let model = attributes
                        .get("gen_ai.response.model")
                        .or_else(|| attributes.get("gen_ai.request.model"))
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned);
                    if self.get_run(&run_id)?.is_none() {
                        let mut metadata = json!({
                            "agent": "codex", "sessionId": session_id,
                            "redactionLevel": "metadata",
                        });
                        insert_optional(&mut metadata, "model", model.as_deref());
                        insert_optional(&mut metadata, "provider", Some("openai"));
                        insert_optional(&mut metadata, "surface", surface);
                        insert_optional(&mut metadata, "surfaceSource", surface_source);
                        if !self.create_run(CreateRun {
                            id: run_id.clone(),
                            name: format!("codex:{session_id}"),
                            status: "running".to_owned(),
                            started_at: Some(timestamp.clone()),
                            ended_at: None,
                            input: Some(json!({ "source": "otel", "redactionLevel": "metadata" })),
                            output: None,
                            error: None,
                            metadata: Some(metadata),
                        })? {
                            continue;
                        }
                    }
                    let input = attribute_number(&attributes, "input_tokens");
                    let output = attribute_number(&attributes, "output_tokens");
                    let cached = attribute_number(&attributes, "cached_input_tokens");
                    let reasoning = attribute_number(&attributes, "reasoning_output_tokens");
                    let has_tokens = input.is_some()
                        || output.is_some()
                        || cached.is_some()
                        || reasoning.is_some();
                    let mut metadata = Value::Object(attributes);
                    if let Some(object) = metadata.as_object_mut() {
                        object.insert("agent".to_owned(), json!("codex"));
                        object.insert("sessionId".to_owned(), json!(session_id));
                        object.insert(
                            "category".to_owned(),
                            json!(if has_tokens { "tokens" } else { "lifecycle" }),
                        );
                        object.insert("redactionLevel".to_owned(), json!("metadata"));
                        if let Some(surface) = surface {
                            object.insert("surface".to_owned(), json!(surface));
                        }
                        if let Some(surface_source) = surface_source {
                            object.insert("surfaceSource".to_owned(), json!(surface_source));
                        }
                        if let Some(model) = &model {
                            object.insert("model".to_owned(), json!(model));
                        }
                        if has_tokens {
                            let input = input.unwrap_or_default();
                            let output = output.unwrap_or_default();
                            object.insert(
                                "tokenUsage".to_owned(),
                                json!({
                                    "input": input, "output": output, "total": input + output,
                                    "cachedInput": cached.unwrap_or_default(),
                                    "reasoningOutput": reasoning.unwrap_or_default(),
                                    "source": "codex-otel", "sourceKind": "official",
                                }),
                            );
                        }
                    }
                    let event_name = metadata
                        .get("event.name")
                        .and_then(Value::as_str)
                        .or_else(|| record.pointer("/body/stringValue").and_then(Value::as_str))
                        .unwrap_or("codex.otel")
                        .to_owned();
                    let event_id = format!("evt_{}", Uuid::new_v4());
                    self.create_event(CreateEvent {
                        id: event_id.clone(),
                        run_id: run_id.clone(),
                        parent_id: None,
                        event_type: if has_tokens { "llm_call" } else { "step_ended" }.to_owned(),
                        name: event_name,
                        status: "success".to_owned(),
                        timestamp: Some(timestamp.clone()),
                        duration_ms: None,
                        input: None,
                        output: None,
                        error: None,
                        metadata: Some(metadata),
                    })?;
                    self.update_run(
                        &run_id,
                        UpdateRun {
                            status: "success".to_owned(),
                            ended_at: Some(Some(timestamp)),
                            output: None,
                            error: None,
                        },
                    )?;
                    stored += 1;
                    event_ids.push(event_id);
                    if !run_ids.contains(&run_id) {
                        run_ids.push(run_id);
                    }
                }
            }
        }
        Ok(json!({ "stored": stored, "eventIds": event_ids, "runIds": run_ids }))
    }

    pub fn create_replay_task(&self, input: &Value) -> anyhow::Result<Value> {
        let source_run_id = required_string(input, "sourceRunId")?;
        let source_event_id = required_string(input, "sourceEventId")?;
        let source_run = self
            .get_run(source_run_id)?
            .ok_or_else(|| anyhow::anyhow!("source_run_not_found"))?;
        let source_event = self
            .list_events_legacy(source_run_id)?
            .into_iter()
            .find(|event| event.id == source_event_id)
            .ok_or_else(|| anyhow::anyhow!("source_event_not_found"))?;
        let timeout_ms = input
            .get("timeoutMs")
            .and_then(Value::as_u64)
            .unwrap_or(5_000);
        let delay_ms = input
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if !(100..=30_000).contains(&timeout_ms) || delay_ms > 30_000 {
            bail!("invalid_replay_task");
        }
        let request = json!({
            "input": input.get("input").cloned().or(source_event.input),
            "mockOutput": input.get("mockOutput").cloned().or(source_event.output),
            "simulateError": input.get("simulateError").and_then(Value::as_bool).unwrap_or(false),
            "delayMs": delay_ms,
            "sourceEventType": source_event.event_type,
            "sourceEventName": source_event.name,
            "sourceEventMetadata": source_event.metadata,
            "sourceProject": source_run.metadata.as_ref().and_then(|value| value.get("project")).cloned(),
        });
        let request_json = request.to_string();
        if request_json.len() > 1_000_000 {
            bail!("replay_payload_too_large");
        }
        let id = Uuid::new_v4().to_string();
        self.database.connection()?.execute(
            "INSERT INTO replay_tasks (
                id,source_run_id,source_event_id,status,request_json,policy_json,
                timeout_ms,created_at,workspace_cleaned
             ) VALUES (?1,?2,?3,'queued',?4,?5,?6,?7,0)",
            params![
                id,
                source_run_id,
                source_event_id,
                request_json,
                replay_policy().to_string(),
                timeout_ms as i64,
                now(),
            ],
        )?;
        self.get_replay_task(&id)?
            .context("created replay task missing")
    }

    pub fn get_replay_task(&self, id: &str) -> anyhow::Result<Option<Value>> {
        self.database
            .connection()?
            .query_row(
                "SELECT id,source_run_id,source_event_id,replay_run_id,status,policy_json,
                        timeout_ms,error,created_at,started_at,completed_at,workspace_cleaned
                 FROM replay_tasks WHERE id=?1",
                [id],
                map_replay_task,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_replay_tasks(
        &self,
        source_run_id: Option<&str>,
        limit: usize,
    ) -> anyhow::Result<Vec<Value>> {
        let connection = self.database.connection()?;
        let limit = limit.clamp(1, 200) as i64;
        let sql = if source_run_id.is_some() {
            "SELECT id,source_run_id,source_event_id,replay_run_id,status,policy_json,
                    timeout_ms,error,created_at,started_at,completed_at,workspace_cleaned
             FROM replay_tasks WHERE source_run_id=?1 ORDER BY created_at DESC LIMIT ?2"
        } else {
            "SELECT id,source_run_id,source_event_id,replay_run_id,status,policy_json,
                    timeout_ms,error,created_at,started_at,completed_at,workspace_cleaned
             FROM replay_tasks ORDER BY created_at DESC LIMIT ?1"
        };
        let mut statement = connection.prepare(sql)?;
        let rows = if let Some(source_run_id) = source_run_id {
            statement.query_map(params![source_run_id, limit], map_replay_task)?
        } else {
            statement.query_map([limit], map_replay_task)?
        };
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn cancel_replay_task(&self, id: &str) -> anyhow::Result<Option<Value>> {
        let Some(task) = self.get_replay_task(id)? else {
            return Ok(None);
        };
        if matches!(task["status"].as_str(), Some("queued" | "running")) {
            self.database.connection()?.execute(
                "UPDATE replay_tasks SET status='cancelled',completed_at=?2,
                    error='cancelled_by_user',workspace_cleaned=1 WHERE id=?1",
                params![id, now()],
            )?;
        }
        self.get_replay_task(id)
    }

    pub async fn execute_replay_task(&self, id: &str) -> anyhow::Result<()> {
        let selected = {
            let connection = self.database.connection()?;
            let row = connection
                .query_row(
                    "SELECT request_json,timeout_ms FROM replay_tasks WHERE id=?1 AND status='queued'",
                    [id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?.max(0) as u64,
                        ))
                    },
                )
                .optional()?;
            if row.is_some() {
                connection.execute(
                    "UPDATE replay_tasks SET status='running',started_at=?2 WHERE id=?1 AND status='queued'",
                    params![id, now()],
                )?;
            }
            row
        };
        let Some((request_json, timeout_ms)) = selected else {
            return Ok(());
        };
        let request: Value = serde_json::from_str(&request_json)?;
        let delay_ms = request
            .get("delayMs")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms.min(timeout_ms))).await;
        let Some(task) = self.get_replay_task(id)? else {
            return Ok(());
        };
        if task["status"] == "cancelled" {
            return Ok(());
        }
        if delay_ms > timeout_ms {
            self.database.connection()?.execute(
                "UPDATE replay_tasks SET status='timeout',error=?2,completed_at=?3,
                    workspace_cleaned=1 WHERE id=?1",
                params![id, format!("sandbox_timeout_{timeout_ms}ms"), now()],
            )?;
            return Ok(());
        }
        let source_run_id = task["sourceRunId"].as_str().context("missing source run")?;
        let source_event_id = task["sourceEventId"]
            .as_str()
            .context("missing source event")?;
        let replay_run_id = format!("replay:{id}");
        let simulate_error = request
            .get("simulateError")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let status = if simulate_error { "error" } else { "success" };
        let started_at = now();
        self.create_run(CreateRun {
            id: replay_run_id.clone(),
            name: format!("Replay: {}", request["sourceEventName"].as_str().unwrap_or("event")),
            status: "running".to_owned(),
            started_at: Some(started_at.clone()),
            ended_at: None,
            input: request.get("input").cloned().filter(|value| !value.is_null()),
            output: None,
            error: None,
            metadata: Some(json!({
                "source": "replay-sandbox", "project": request.get("sourceProject"),
                "replay": { "sourceRunId": source_run_id, "sourceEventId": source_event_id, "taskId": id },
                "sandbox": replay_policy(),
            })),
        })?;
        let output = request
            .get("mockOutput")
            .cloned()
            .filter(|value| !value.is_null());
        self.create_event(CreateEvent {
            id: format!("replay-event:{id}"),
            run_id: replay_run_id.clone(),
            parent_id: None,
            event_type: request["sourceEventType"]
                .as_str()
                .unwrap_or("tool_call")
                .to_owned(),
            name: request["sourceEventName"]
                .as_str()
                .unwrap_or("event")
                .to_owned(),
            status: status.to_owned(),
            timestamp: Some(started_at),
            duration_ms: Some(delay_ms as i64),
            input: request
                .get("input")
                .cloned()
                .filter(|value| !value.is_null()),
            output: output.clone(),
            error: simulate_error.then(|| json!({ "message": "Simulated replay error" })),
            metadata: Some(json!({
                "source": "replay-sandbox", "replayMode": "mock",
                "sourceRunId": source_run_id, "sourceEventId": source_event_id,
                "realSideEffects": false,
            })),
        })?;
        self.update_run(
            &replay_run_id,
            UpdateRun {
                status: status.to_owned(),
                ended_at: Some(Some(now())),
                output,
                error: simulate_error.then(|| "Simulated replay error".to_owned()),
            },
        )?;
        self.database.connection()?.execute(
            "UPDATE replay_tasks SET replay_run_id=?2,status='completed',completed_at=?3,
                workspace_cleaned=1 WHERE id=?1",
            params![id, replay_run_id, now()],
        )?;
        Ok(())
    }

    pub fn get_run(&self, id: &str) -> anyhow::Result<Option<DashboardRun>> {
        let connection = self.database.connection()?;
        let mut run = connection
            .query_row(
                "SELECT id, name, status, started_at, ended_at, input_json, output_json, error,
                        metadata_json
                 FROM runs WHERE id = ?1",
                [id],
                map_run,
            )
            .optional()?;
        if let Some(run) = run.as_mut() {
            attach_summary(&connection, run)?;
        }
        Ok(run)
    }

    pub fn export_redacted_run(&self, id: &str) -> anyhow::Result<Option<Value>> {
        let Some(run) = self.get_run(id)? else {
            return Ok(None);
        };
        let events = self.list_events_legacy(id)?;
        let run_id = pseudonym("run", &run.id);
        let redacted_events = events
            .iter()
            .map(|event| {
                let mut value = json!({
                    "id": pseudonym("event", &event.id),
                    "runId": run_id,
                    "type": event.event_type,
                    "name": event.event_type,
                    "status": event.status,
                    "timestamp": event.timestamp,
                });
                if let Some(parent_id) = &event.parent_id {
                    value["parentId"] = json!(pseudonym("event", parent_id));
                }
                if let Some(duration_ms) = event.duration_ms {
                    value["durationMs"] = json!(duration_ms);
                }
                if let Some(metadata) = safe_metadata(event.metadata.as_ref()) {
                    value["metadata"] = metadata;
                }
                value
            })
            .collect::<Vec<_>>();
        let mut redacted_run = json!({
            "id": run_id,
            "name": "redacted-run",
            "status": run.status,
            "startedAt": run.started_at,
        });
        if let Some(ended_at) = run.ended_at {
            redacted_run["endedAt"] = json!(ended_at);
        }
        if let Some(metadata) = safe_metadata(run.metadata.as_ref()) {
            redacted_run["metadata"] = metadata;
        }
        Ok(Some(json!({
            "schemaVersion": 1,
            "exportedAt": now(),
            "redaction": "metadata",
            "run": redacted_run,
            "events": redacted_events,
        })))
    }

    pub fn trace_insights(&self, run_id: &str) -> anyhow::Result<Vec<Value>> {
        let events = self.list_events_legacy(run_id)?;
        Ok(analyze_trace_insights(&events))
    }

    pub fn compare_runs(&self, ids: &[String]) -> anyhow::Result<Value> {
        let mut runs = Vec::new();
        let mut event_groups = Vec::new();
        for id in ids {
            let Some(run) = self.get_run(id)? else {
                event_groups.push(Vec::new());
                continue;
            };
            let events = self.list_events_legacy(id)?;
            let failed = events
                .iter()
                .filter(|event| event.status == "error")
                .count();
            let total_tokens = run
                .metadata
                .as_ref()
                .and_then(|value| value.pointer("/summary/tokenUsage/total"))
                .and_then(Value::as_f64)
                .unwrap_or_default();
            let cost_usd = run
                .metadata
                .as_ref()
                .and_then(|value| value.pointer("/summary/costUsd"))
                .and_then(Value::as_f64)
                .unwrap_or_default();
            let duration_ms = timestamp_delta_ms(&run.started_at, run.ended_at.as_deref());
            runs.push(json!({
                "id": run.id,
                "name": run.name,
                "status": run.status,
                "startedAt": run.started_at,
                "durationMs": duration_ms,
                "eventCount": events.len(),
                "failedEventCount": failed,
                "totalTokens": total_tokens,
                "costUsd": cost_usd,
            }));
            event_groups.push(events);
        }
        let baseline = event_groups.first().map(Vec::as_slice).unwrap_or_default();
        let baseline_index = index_comparable_events(baseline);
        let mut event_diffs = Vec::new();
        for (position, candidate_events) in event_groups.iter().enumerate().skip(1) {
            let candidate_index = index_comparable_events(candidate_events);
            let mut keys = baseline_index.keys().cloned().collect::<Vec<_>>();
            keys.extend(
                candidate_index
                    .keys()
                    .filter(|key| !baseline_index.contains_key(*key))
                    .cloned(),
            );
            for key in keys {
                let baseline_event = baseline_index.get(&key);
                let candidate_event = candidate_index.get(&key);
                let changes = event_changes(baseline_event, candidate_event);
                if changes.is_empty() {
                    continue;
                }
                let source = candidate_event
                    .or(baseline_event)
                    .expect("comparison event");
                let regressions = event_regressions(baseline_event, candidate_event);
                let mut diff = json!({
                    "runId": ids[position],
                    "eventKey": key,
                    "type": source.event_type,
                    "name": source.name,
                    "occurrence": source.occurrence,
                    "changes": changes,
                    "regressions": regressions,
                });
                if let Some(value) = baseline_event {
                    diff["baseline"] = value.metric();
                }
                if let Some(value) = candidate_event {
                    diff["candidate"] = value.metric();
                }
                event_diffs.push(diff);
            }
        }
        let regression_count = event_diffs
            .iter()
            .map(|diff| diff["regressions"].as_array().map_or(0, Vec::len))
            .sum::<usize>();
        Ok(json!({
            "runs": runs,
            "eventDiffs": event_diffs,
            "regressionCount": regression_count,
        }))
    }

    pub fn list_runs_legacy(&self, include_untracked: bool) -> anyhow::Result<Vec<DashboardRun>> {
        let query = RunListQuery {
            include_untracked,
            page_size: Some(MAX_RUN_PAGE_SIZE),
            ..Default::default()
        };
        Ok(self.list_runs(query)?.runs)
    }

    pub fn list_runs(&self, query: RunListQuery) -> anyhow::Result<Page<DashboardRun>> {
        let connection = self.database.connection()?;
        let page_size = query
            .page_size
            .unwrap_or(DEFAULT_RUN_PAGE_SIZE)
            .clamp(1, MAX_RUN_PAGE_SIZE);
        let requested_page = query.page.unwrap_or(1).max(1);
        let mut clauses = Vec::new();
        let mut values = Vec::<rusqlite::types::Value>::new();

        if !query.include_untracked {
            clauses.push(
                "EXISTS (SELECT 1 FROM events e WHERE e.run_id = runs.id AND \
                 json_extract(e.metadata_json, '$.category') IN ('command','tool','mcp','skill'))"
                    .to_owned(),
            );
        }
        if let Some(q) = normalized_filter(query.q.as_deref()) {
            let parameter = format!("%{}%", q.to_lowercase());
            let index = values.len() + 1;
            clauses.push(format!(
                "(lower(id) LIKE ?{index} OR lower(name) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.agent'), '')) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.sessionId'), '')) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.model'), '')) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.project'), '')) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.environment'), '')) LIKE ?{index} OR \
                 lower(coalesce(json_extract(metadata_json, '$.note'), '')) LIKE ?{index})"
            ));
            values.push(parameter.into());
        }
        add_text_filter(&mut clauses, &mut values, "status", query.status, false);
        add_json_filter(&mut clauses, &mut values, "$.model", query.model);
        add_json_filter(&mut clauses, &mut values, "$.project", query.project);
        add_json_filter(
            &mut clauses,
            &mut values,
            "$.environment",
            query.environment,
        );
        if let Some(source) = normalized_filter(query.source.as_deref()) {
            let index = values.len() + 1;
            clauses.push(format!(
                "(json_extract(metadata_json, '$.agent') = ?{index} OR \
                 json_extract(metadata_json, '$.source') = ?{index} OR \
                 json_extract(metadata_json, '$.surface') = ?{index} OR \
                 json_extract(input_json, '$.source') = ?{index})"
            ));
            values.push(source.into());
        }
        if let Some(tag) = normalized_filter(query.tag.as_deref()) {
            let index = values.len() + 1;
            clauses.push(format!(
                "EXISTS (SELECT 1 FROM json_each(coalesce(json_extract(metadata_json, '$.tags'), '[]')) \
                 WHERE lower(cast(value AS text)) = lower(?{index}))"
            ));
            values.push(tag.into());
        }
        if let Some(favorite) = query.favorite {
            let index = values.len() + 1;
            clauses.push(format!(
                "coalesce(json_extract(metadata_json, '$.favorite'), 0) = ?{index}"
            ));
            values.push((favorite as i64).into());
        }
        add_bound(
            &mut clauses,
            &mut values,
            "started_at",
            ">=",
            query.started_after,
        );
        add_bound(
            &mut clauses,
            &mut values,
            "started_at",
            "<=",
            query.started_before,
        );
        if let Some(value) = query.min_cost_usd {
            let index = values.len() + 1;
            clauses.push(format!(
                "coalesce(json_extract(metadata_json, '$.summary.costUsd'), 0) >= ?{index}"
            ));
            values.push(value.into());
        }
        if let Some(value) = query.max_cost_usd {
            let index = values.len() + 1;
            clauses.push(format!(
                "coalesce(json_extract(metadata_json, '$.summary.costUsd'), 0) <= ?{index}"
            ));
            values.push(value.into());
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!(" WHERE {}", clauses.join(" AND "))
        };
        let total: usize = connection.query_row(
            &format!("SELECT count(*) FROM runs{where_sql}"),
            params_from_iter(values.iter()),
            |row| row.get::<_, i64>(0),
        )? as usize;
        let total_pages = total.div_ceil(page_size).max(1);
        let page = requested_page.min(total_pages);
        let order = if query.order.as_deref() == Some("asc") {
            "ASC"
        } else {
            "DESC"
        };
        let sort = match query.sort.as_deref() {
            Some("name") => "name",
            Some("status") => "status",
            _ => "started_at",
        };
        let limit_index = values.len() + 1;
        let offset_index = values.len() + 2;
        let mut page_values = values.clone();
        page_values.push((page_size as i64).into());
        page_values.push((((page - 1) * page_size) as i64).into());
        let sql = format!(
            "SELECT id, name, status, started_at, ended_at, input_json, output_json, error, metadata_json \
             FROM runs{where_sql} ORDER BY {sort} {order}, id ASC LIMIT ?{limit_index} OFFSET ?{offset_index}"
        );
        let mut statement = connection.prepare(&sql)?;
        let mut runs: Vec<DashboardRun> = statement
            .query_map(params_from_iter(page_values.iter()), map_run)?
            .collect::<Result<_, _>>()?;
        for run in &mut runs {
            attach_summary(&connection, run)?;
        }
        let (running_runs, failed_runs): (i64, i64) = connection.query_row(
            &format!(
                "SELECT coalesce(sum(status = 'running'), 0), coalesce(sum(status = 'error'), 0) \
                 FROM runs{where_sql}"
            ),
            params_from_iter(values.iter()),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut agent_statement = connection.prepare(&format!(
            "SELECT coalesce(json_extract(metadata_json, '$.agent'), 'manual') agent, count(*) \
             FROM runs{where_sql} GROUP BY agent ORDER BY count(*) DESC, agent"
        ))?;
        let agents = agent_statement
            .query_map(params_from_iter(values.iter()), |row| {
                Ok(AgentCount {
                    agent: row.get(0)?,
                    count: row.get::<_, i64>(1)? as usize,
                })
            })?
            .collect::<Result<_, _>>()?;

        Ok(Page {
            runs,
            pagination: Pagination {
                page,
                page_size,
                total,
                total_pages,
            },
            summary: RunPageSummary {
                total_runs: total,
                running_runs: running_runs as usize,
                failed_runs: failed_runs as usize,
                agents,
            },
        })
    }

    pub fn list_events_legacy(&self, run_id: &str) -> anyhow::Result<Vec<DashboardEvent>> {
        let connection = self.database.connection()?;
        let mut statement = connection.prepare(
            "SELECT id, run_id, parent_id, type, name, status, timestamp, duration_ms,
                    input_json, output_json, error_json, metadata_json
             FROM events WHERE run_id = ?1 ORDER BY julianday(timestamp), id",
        )?;
        Ok(statement
            .query_map([run_id], map_event)?
            .collect::<Result<_, _>>()?)
    }

    pub fn list_events_page(&self, run_id: &str, query: EventListQuery) -> anyhow::Result<Value> {
        let all = self.list_events_legacy(run_id)?;
        let display = all.iter().filter(|event| is_display_event(event)).count();
        let visibility = match query.visibility.as_deref() {
            Some("hidden") => "hidden",
            Some("all") => "all",
            _ => "display",
        };
        let filtered: Vec<&DashboardEvent> = all
            .iter()
            .filter(|event| match visibility {
                "hidden" => !is_display_event(event),
                "all" => true,
                _ => is_display_event(event),
            })
            .filter(|event| {
                query
                    .status
                    .as_deref()
                    .is_none_or(|value| value == "all" || event.status == value)
                    && query
                        .event_type
                        .as_deref()
                        .is_none_or(|value| value == "all" || event.event_type == value)
                    && query.category.as_deref().is_none_or(|value| {
                        value == "all" || event_category(event).as_deref() == Some(value)
                    })
                    && query.q.as_deref().is_none_or(|value| {
                        let needle = value.to_lowercase();
                        event.name.to_lowercase().contains(&needle)
                            || event.event_type.to_lowercase().contains(&needle)
                    })
            })
            .collect();
        let page_size = query
            .page_size
            .unwrap_or(DEFAULT_EVENT_PAGE_SIZE)
            .clamp(1, MAX_EVENT_PAGE_SIZE);
        let total_pages = filtered.len().div_ceil(page_size).max(1);
        let page = query.page.unwrap_or(1).max(1).min(total_pages);
        let start = (page - 1) * page_size;
        let matching = filtered.len();
        let events: Vec<&DashboardEvent> = filtered
            .into_iter()
            .rev()
            .skip(start)
            .take(page_size)
            .collect();
        let types: HashSet<&str> = all.iter().map(|event| event.event_type.as_str()).collect();
        let categories: HashSet<String> = all.iter().filter_map(event_category).collect();
        let total_tokens: i64 = all.iter().map(event_total_tokens).sum();
        let total_duration_ms: i64 = all.iter().map(|event| event.duration_ms.unwrap_or(0)).sum();
        let error_events: Vec<&DashboardEvent> =
            all.iter().filter(|event| event.status == "error").collect();
        let source_metadata = all
            .iter()
            .find_map(|event| {
                event
                    .metadata
                    .as_ref()
                    .filter(|metadata| metadata.get("agent").is_some())
                    .cloned()
            })
            .unwrap_or_else(|| json!({}));
        Ok(json!({
            "events": events,
            "counts": { "total": all.len(), "display": display, "hidden": all.len() - display, "matching": matching },
            "facets": { "types": types, "categories": categories },
            "pagination": { "page": page, "pageSize": page_size, "total": matching, "totalPages": total_pages },
            "summary": {
                "totalTokens": total_tokens,
                "totalDurationMs": total_duration_ms,
                "failedEvents": error_events.len(),
                "sourceMetadata": source_metadata,
                "errorEvents": error_events
            },
            "visibility": visibility
        }))
    }

    pub fn update_organization(
        &self,
        id: &str,
        organization: RunOrganization,
    ) -> anyhow::Result<bool> {
        let connection = self.database.connection()?;
        let metadata_json: Option<String> = connection
            .query_row(
                "SELECT metadata_json FROM runs WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        let exists = connection
            .query_row("SELECT 1 FROM runs WHERE id = ?1", [id], |_| Ok(()))
            .optional()?;
        if exists.is_none() {
            return Ok(false);
        }
        let mut metadata = parse(metadata_json)
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        update_optional_text(&mut metadata, "project", organization.project);
        update_optional_text(&mut metadata, "environment", organization.environment);
        update_optional_text(&mut metadata, "version", organization.version);
        update_optional_text(&mut metadata, "note", organization.note);
        if let Some(tags) = organization.tags {
            let unique: Vec<String> = tags
                .into_iter()
                .map(|tag| tag.trim().to_owned())
                .filter(|tag| !tag.is_empty())
                .collect::<HashSet<_>>()
                .into_iter()
                .collect();
            metadata.insert("tags".to_owned(), json!(unique));
        }
        if let Some(favorite) = organization.favorite {
            metadata.insert("favorite".to_owned(), favorite.into());
        }
        let privacy = read_privacy_settings(&connection)?;
        let mut value = Value::Object(metadata);
        redact(&mut value, &privacy);
        connection.execute(
            "UPDATE runs SET metadata_json = ?2 WHERE id = ?1",
            params![id, value.to_string()],
        )?;
        Ok(true)
    }

    pub fn delete_run(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self.delete_runs(&[id.to_owned()])? > 0)
    }

    pub fn delete_runs(&self, ids: &[String]) -> anyhow::Result<usize> {
        let unique: Vec<&String> = ids
            .iter()
            .filter(|id| !id.trim().is_empty())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        if unique.is_empty() {
            return Ok(0);
        }
        let mut connection = self.database.connection()?;
        let transaction = connection.transaction()?;
        let deleted_at = now();
        for id in &unique {
            let exists = transaction
                .query_row("SELECT 1 FROM runs WHERE id = ?1", [id], |_| Ok(()))
                .optional()?
                .is_some();
            if exists {
                transaction.execute(
                    "INSERT INTO run_tombstones (run_id, deleted_at, reason) VALUES (?1, ?2, 'user_deleted') \
                     ON CONFLICT(run_id) DO UPDATE SET deleted_at = excluded.deleted_at, reason = excluded.reason",
                    params![id, deleted_at],
                )?;
                transaction.execute("DELETE FROM events WHERE run_id = ?1", [id])?;
            }
        }
        let mut deleted = 0;
        for id in unique {
            deleted += transaction.execute("DELETE FROM runs WHERE id = ?1", [id])?;
        }
        transaction.commit()?;
        Ok(deleted)
    }

    pub fn restore_tombstone(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self
            .database
            .connection()?
            .execute("DELETE FROM run_tombstones WHERE run_id = ?1", [id])?
            > 0)
    }

    pub fn tombstones(&self, limit: usize) -> anyhow::Result<Vec<Value>> {
        let connection = self.database.connection()?;
        let mut statement = connection.prepare(
            "SELECT run_id, deleted_at, reason FROM run_tombstones ORDER BY deleted_at DESC LIMIT ?1"
        )?;
        Ok(statement
            .query_map([limit.clamp(1, 200) as i64], |row| {
                Ok(json!({
                    "runId": row.get::<_, String>(0)?, "deletedAt": row.get::<_, String>(1)?,
                    "reason": row.get::<_, Option<String>>(2)?
                }))
            })?
            .collect::<Result<_, _>>()?)
    }

    pub fn storage_stats(&self) -> anyhow::Result<Value> {
        let connection = self.database.connection()?;
        let count = |table: &str| -> anyhow::Result<i64> {
            connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .map_err(Into::into)
        };
        Ok(json!({
            "databasePath": self.database.path(),
            "databaseBytes": std::fs::metadata(self.database.path()).ok().map(|metadata| metadata.len()),
            "runs": count("runs")?, "events": count("events")?,
            "usageSessions": count("usage_sessions")?, "tombstones": count("run_tombstones")?
        }))
    }

    pub fn compact(&self) -> anyhow::Result<()> {
        self.database
            .connection()?
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")?;
        Ok(())
    }

    pub fn prune(
        &self,
        before: &str,
        statuses: &[String],
        keep_tombstones: bool,
    ) -> anyhow::Result<usize> {
        let connection = self.database.connection()?;
        let ids: Vec<String> = if statuses.is_empty() {
            let mut statement = connection.prepare("SELECT id FROM runs WHERE started_at < ?1")?;
            statement
                .query_map([before], |row| row.get(0))?
                .collect::<Result<_, _>>()?
        } else {
            let placeholders = (0..statuses.len())
                .map(|_| "?")
                .collect::<Vec<_>>()
                .join(",");
            let sql =
                format!("SELECT id FROM runs WHERE started_at < ? AND status IN ({placeholders})");
            let mut values = vec![rusqlite::types::Value::Text(before.to_owned())];
            values.extend(statuses.iter().cloned().map(Into::into));
            let mut statement = connection.prepare(&sql)?;
            statement
                .query_map(params_from_iter(values), |row| row.get(0))?
                .collect::<Result<_, _>>()?
        };
        drop(connection);
        if keep_tombstones {
            self.delete_runs(&ids)
        } else {
            let mut connection = self.database.connection()?;
            let transaction = connection.transaction()?;
            let mut deleted = 0;
            for id in ids {
                transaction.execute("DELETE FROM events WHERE run_id = ?1", [&id])?;
                deleted += transaction.execute("DELETE FROM runs WHERE id = ?1", [&id])?;
            }
            transaction.commit()?;
            Ok(deleted)
        }
    }

    pub fn privacy_settings(&self) -> anyhow::Result<PrivacySettings> {
        let connection = self.database.connection()?;
        read_privacy_settings(&connection)
    }

    pub fn update_privacy_settings(
        &self,
        mut value: PrivacySettings,
    ) -> anyhow::Result<PrivacySettings> {
        value.normalize()?;
        let timestamp = now();
        self.database.connection()?.execute(
            "INSERT INTO settings (key, value_json, updated_at) VALUES ('privacy', ?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            params![serde_json::to_string(&value)?, timestamp],
        )?;
        Ok(value)
    }

    pub fn replace_usage_snapshot(&self, body: &Value) -> anyhow::Result<usize> {
        let scanned_at = body
            .get("scannedAt")
            .and_then(Value::as_str)
            .context("scannedAt is required")?;
        let rows = body
            .get("rows")
            .and_then(Value::as_array)
            .context("rows must be an array")?;
        let reconciled = body
            .get("reconciledClients")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let diagnostics = body
            .get("diagnostics")
            .cloned()
            .unwrap_or_else(|| json!([]));
        let error = body.get("error").and_then(Value::as_str);
        let mut connection = self.database.connection()?;
        let transaction = connection.transaction()?;
        for client in reconciled.iter().filter_map(Value::as_str) {
            transaction.execute("DELETE FROM usage_sessions WHERE client = ?1", [client])?;
        }
        let mut stored = 0;
        for row in rows {
            let total = row.get("totalTokens").and_then(Value::as_i64).unwrap_or(0);
            let cost = row.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0);
            if total <= 0 && cost <= 0.0 {
                continue;
            }
            transaction.execute(
                "INSERT INTO usage_sessions (
                    client, session_id, model, provider, input_tokens, output_tokens, cache_read_tokens,
                    cache_write_tokens, reasoning_tokens, total_tokens, cost_usd, message_count,
                    started_at, last_used_at, scanned_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
                 ON CONFLICT(client, session_id, model, provider) DO UPDATE SET
                    input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
                    cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
                    reasoning_tokens=excluded.reasoning_tokens, total_tokens=excluded.total_tokens,
                    cost_usd=excluded.cost_usd, message_count=excluded.message_count,
                    started_at=excluded.started_at, last_used_at=excluded.last_used_at, scanned_at=excluded.scanned_at",
                params![
                    string_field(row, "client", "")?, string_field(row, "sessionId", "usage")?,
                    string_field(row, "model", "")?, string_field(row, "provider", "")?,
                    int_field(row, "inputTokens"), int_field(row, "outputTokens"),
                    int_field(row, "cacheReadTokens"), int_field(row, "cacheWriteTokens"),
                    int_field(row, "reasoningTokens"), total, row.get("costUsd").and_then(Value::as_f64),
                    row.get("messageCount").and_then(Value::as_i64), row.get("startedAt").and_then(Value::as_str),
                    row.get("lastUsedAt").and_then(Value::as_str), scanned_at
                ],
            )?;
            upsert_history_run(&transaction, row, scanned_at)?;
            stored += 1;
        }
        transaction.execute(
            "INSERT INTO usage_scan_state (id, scanned_at, diagnostics_json, error) VALUES ('current', ?1, ?2, ?3) \
             ON CONFLICT(id) DO UPDATE SET scanned_at=excluded.scanned_at, diagnostics_json=excluded.diagnostics_json, error=excluded.error",
            params![scanned_at, diagnostics.to_string(), error],
        )?;
        transaction.commit()?;
        Ok(stored)
    }

    pub fn usage_summary(&self) -> anyhow::Result<Value> {
        let connection = self.database.connection()?;
        let (total_tokens, cost_usd): (i64, f64) = connection.query_row(
            "SELECT coalesce(sum(total_tokens),0), coalesce(sum(cost_usd),0) FROM usage_sessions",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let mut client_statement = connection.prepare(
            "SELECT client, sum(total_tokens), coalesce(sum(cost_usd),0) FROM usage_sessions GROUP BY client"
        )?;
        let clients: Vec<Value> = client_statement.query_map([], |row| Ok(json!({
            "client": row.get::<_, String>(0)?, "totalTokens": row.get::<_, i64>(1)?, "costUsd": row.get::<_, f64>(2)?
        })))?.collect::<Result<_, _>>()?;
        let mut model_statement = connection.prepare(
            "SELECT model, provider, sum(total_tokens), coalesce(sum(cost_usd),0) FROM usage_sessions WHERE model != '' GROUP BY model, provider"
        )?;
        let models: Vec<Value> = model_statement
            .query_map([], |row| {
                Ok(json!({
                    "model": row.get::<_, String>(0)?, "provider": row.get::<_, String>(1)?,
                    "totalTokens": row.get::<_, i64>(2)?, "costUsd": row.get::<_, f64>(3)?
                }))
            })?
            .collect::<Result<_, _>>()?;
        Ok(
            json!({ "totalTokens": total_tokens, "costUsd": cost_usd, "clients": clients, "models": models }),
        )
    }

    pub fn scanner_status(&self) -> anyhow::Result<Value> {
        let connection = self.database.connection()?;
        let row: Option<(String, String, Option<String>)> = connection.query_row(
            "SELECT scanned_at, diagnostics_json, error FROM usage_scan_state WHERE id = 'current'", [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional()?;
        Ok(match row {
            Some((scanned_at, diagnostics, error)) => json!({
                "scannedAt": scanned_at, "diagnostics": serde_json::from_str::<Value>(&diagnostics).unwrap_or_else(|_| json!([])), "error": error
            }),
            None => json!({ "diagnostics": [] }),
        })
    }

    pub fn trends(&self, days: usize) -> anyhow::Result<Value> {
        let days = days.clamp(1, 90);
        let today = Utc::now().date_naive();
        let start = today - chrono::Duration::days(days.saturating_sub(1) as i64);
        let connection = self.database.connection()?;
        let mut statement = connection.prepare(
            "SELECT date(started_at), count(*), sum(status='success'), sum(status='error'),
                    cast(round(avg(max(0, (julianday(coalesce(ended_at, ?2))-julianday(started_at))*86400000))) AS integer),
                    coalesce(sum((SELECT sum(cast(json_extract(metadata_json,'$.tokenUsage.total') AS integer)) FROM events WHERE run_id=runs.id)),0),
                    coalesce(sum((SELECT sum(cast(json_extract(metadata_json,'$.costUsd') AS real)) FROM events WHERE run_id=runs.id)),0)
             FROM runs WHERE started_at >= ?1 GROUP BY date(started_at) ORDER BY date(started_at)"
        )?;
        let rows: HashMap<String, Value> = statement.query_map(params![start.to_string(), now()], |row| {
            let date: String = row.get(0)?;
            Ok((date.clone(), json!({
                "date": date, "runCount": row.get::<_, i64>(1)?, "successfulRunCount": row.get::<_, i64>(2)?,
                "failedRunCount": row.get::<_, i64>(3)?, "averageDurationMs": row.get::<_, i64>(4)?,
                "totalTokens": row.get::<_, i64>(5)?, "costUsd": row.get::<_, f64>(6)?
            })))
        })?.collect::<Result<_, _>>()?;
        let points: Vec<Value> =
            (0..days)
                .map(|offset| {
                    let key = (start + chrono::Duration::days(offset as i64)).to_string();
                    rows.get(&key).cloned().unwrap_or_else(|| json!({
                "date": key, "runCount": 0, "successfulRunCount": 0, "failedRunCount": 0,
                "averageDurationMs": 0, "totalTokens": 0, "costUsd": 0
            }))
                })
                .collect();
        Ok(json!({ "days": days, "points": points }))
    }

    pub fn analytics_breakdown(&self, days: usize, dimension: &str) -> anyhow::Result<Value> {
        let days = days.clamp(1, 90);
        let start = (Utc::now().date_naive()
            - chrono::Duration::days(days.saturating_sub(1) as i64))
        .to_string();
        let expression = analytics_dimension_expression(dimension)?;
        let connection = self.database.connection()?;
        let sql = format!(
            "WITH event_metrics AS (
                SELECT run_id,
                  coalesce(sum(cast(json_extract(metadata_json, '$.tokenUsage.total') AS integer)), 0) total_tokens,
                  coalesce(sum(cast(json_extract(metadata_json, '$.costUsd') AS real)), 0) cost_usd
                FROM events GROUP BY run_id
             )
             SELECT {expression} key, count(*) run_count,
               coalesce(sum(runs.status='success'),0) successful_run_count,
               coalesce(sum(runs.status='error'),0) failed_run_count,
               cast(round(avg(max(0,(julianday(coalesce(runs.ended_at,?2))-julianday(runs.started_at))*86400000))) AS integer) average_duration_ms,
               coalesce(sum(event_metrics.total_tokens),0) total_tokens,
               coalesce(sum(event_metrics.cost_usd),0) cost_usd
             FROM runs LEFT JOIN event_metrics ON event_metrics.run_id=runs.id
             WHERE runs.started_at>=?1 GROUP BY key ORDER BY cost_usd DESC, total_tokens DESC, key"
        );
        let mut statement = connection.prepare(&sql)?;
        let groups: Vec<Value> = statement
            .query_map(params![start, now()], |row| {
                let run_count: i64 = row.get(1)?;
                let failed: i64 = row.get(3)?;
                Ok(json!({
                    "key": row.get::<_, String>(0)?, "runCount": run_count,
                    "successfulRunCount": row.get::<_, i64>(2)?, "failedRunCount": failed,
                    "failureRate": if run_count == 0 { 0.0 } else { failed as f64 / run_count as f64 },
                    "averageDurationMs": row.get::<_, i64>(4)?, "totalTokens": row.get::<_, i64>(5)?,
                    "costUsd": row.get::<_, f64>(6)?
                }))
            })?
            .collect::<Result<_, _>>()?;
        Ok(json!({ "dimension": dimension, "days": days, "groups": groups }))
    }

    pub fn list_budgets(&self) -> anyhow::Result<Vec<Value>> {
        let connection = self.database.connection()?;
        let mut statement = connection.prepare(
            "SELECT id,name,dimension,dimension_value,period,max_cost_usd,max_tokens,max_runs,enabled,created_at,updated_at
             FROM analytics_budgets ORDER BY created_at DESC",
        )?;
        Ok(statement
            .query_map([], budget_row)?
            .collect::<Result<_, _>>()?)
    }

    pub fn create_budget(&self, input: &Value) -> anyhow::Result<Value> {
        let name = required_string(input, "name")?;
        let dimension = required_string(input, "dimension")?;
        analytics_dimension_expression(dimension)?;
        let value = required_string(input, "value")?;
        let period = required_string(input, "period")?;
        if !matches!(period, "daily" | "monthly") {
            bail!("invalid budget period");
        }
        let max_cost = input.get("maxCostUsd").and_then(Value::as_f64);
        let max_tokens = input.get("maxTokens").and_then(Value::as_i64);
        let max_runs = input.get("maxRuns").and_then(Value::as_i64);
        if max_cost.is_none() && max_tokens.is_none() && max_runs.is_none() {
            bail!("at least one budget limit is required");
        }
        let id = Uuid::new_v4().to_string();
        let timestamp = now();
        let enabled = input
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
        self.database.connection()?.execute(
            "INSERT INTO analytics_budgets
             (id,name,dimension,dimension_value,period,max_cost_usd,max_tokens,max_runs,enabled,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)",
            params![id, name, dimension, value, period, max_cost, max_tokens, max_runs, enabled, timestamp],
        )?;
        Ok(json!({
            "id": id, "name": name, "dimension": dimension, "value": value, "period": period,
            "maxCostUsd": max_cost, "maxTokens": max_tokens, "maxRuns": max_runs,
            "enabled": enabled, "createdAt": timestamp, "updatedAt": timestamp
        }))
    }

    pub fn delete_budget(&self, id: &str) -> anyhow::Result<bool> {
        Ok(self
            .database
            .connection()?
            .execute("DELETE FROM analytics_budgets WHERE id=?1", [id])?
            > 0)
    }

    pub fn budget_alerts(&self) -> anyhow::Result<Vec<Value>> {
        let mut alerts = Vec::new();
        for budget in self.list_budgets()? {
            if !budget
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                continue;
            }
            let period = budget["period"].as_str().unwrap_or("daily");
            let days = if period == "daily" { 1 } else { 31 };
            let dimension = budget["dimension"].as_str().unwrap_or("project");
            let breakdown = self.analytics_breakdown(days, dimension)?;
            let target = budget["value"].as_str().unwrap_or_default();
            let group = breakdown["groups"].as_array().and_then(|groups| {
                groups
                    .iter()
                    .find(|group| group["key"].as_str() == Some(target))
            });
            for (metric, limit_key, actual_key) in [
                ("costUsd", "maxCostUsd", "costUsd"),
                ("tokens", "maxTokens", "totalTokens"),
                ("runs", "maxRuns", "runCount"),
            ] {
                let Some(limit) = budget.get(limit_key).and_then(Value::as_f64) else {
                    continue;
                };
                let actual = group
                    .and_then(|group| group.get(actual_key))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                if actual <= limit {
                    continue;
                }
                alerts.push(json!({
                    "budgetId": budget["id"], "budgetName": budget["name"],
                    "dimension": dimension, "value": target, "period": period,
                    "metric": metric, "limit": limit, "actual": actual,
                    "ratio": if limit == 0.0 { Value::Null } else { json!(actual / limit) }
                }));
            }
        }
        Ok(alerts)
    }

    pub fn list_evaluation_datasets(&self) -> anyhow::Result<Vec<Value>> {
        let connection = self.database.connection()?;
        let mut statement = connection.prepare(
            "SELECT d.id,d.name,d.description,d.score_weights_json,d.created_at,
                    count(distinct c.id),count(r.id),coalesce(avg(r.quality_score),0)
             FROM evaluation_datasets d
             LEFT JOIN evaluation_cases c ON c.dataset_id=d.id
             LEFT JOIN evaluation_results r ON r.case_id=c.id
             GROUP BY d.id ORDER BY d.created_at DESC",
        )?;
        Ok(statement.query_map([], |row| Ok(json!({
            "id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "scoreWeights": parse(row.get::<_, Option<String>>(3)?).unwrap_or_else(|| json!({})),
            "createdAt": row.get::<_, String>(4)?, "caseCount": row.get::<_, i64>(5)?,
            "resultCount": row.get::<_, i64>(6)?, "averageQualityScore": row.get::<_, f64>(7)?
        })))?.collect::<Result<_, _>>()?)
    }

    pub fn create_evaluation_dataset(&self, input: &Value) -> anyhow::Result<Value> {
        let id = Uuid::new_v4().to_string();
        let name = required_string(input, "name")?;
        let description = input.get("description").and_then(Value::as_str);
        let weights = input
            .get("scoreWeights")
            .cloned()
            .unwrap_or_else(|| json!({}));
        let created_at = now();
        self.database.connection()?.execute(
            "INSERT INTO evaluation_datasets (id,name,description,score_weights_json,created_at) VALUES (?1,?2,?3,?4,?5)",
            params![id, name, description, weights.to_string(), created_at],
        )?;
        Ok(
            json!({ "id": id, "name": name, "description": description, "scoreWeights": weights,
            "createdAt": created_at, "caseCount": 0, "resultCount": 0, "averageQualityScore": 0 }),
        )
    }

    pub fn create_evaluation_case(
        &self,
        dataset_id: &str,
        input: &Value,
    ) -> anyhow::Result<Option<Value>> {
        let connection = self.database.connection()?;
        if connection
            .query_row(
                "SELECT 1 FROM evaluation_datasets WHERE id=?1",
                [dataset_id],
                |_| Ok(()),
            )
            .optional()?
            .is_none()
        {
            return Ok(None);
        }
        let id = Uuid::new_v4().to_string();
        let name = required_string(input, "name")?;
        let case_input = input.get("input").cloned().context("input is required")?;
        let expected = input.get("expectedOutput").cloned();
        let metadata = input.get("metadata").cloned();
        let created_at = now();
        connection.execute(
            "INSERT INTO evaluation_cases (id,dataset_id,name,input_json,expected_output_json,metadata_json,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id, dataset_id, name, case_input.to_string(), stringify(expected.clone()), stringify(metadata.clone()), created_at],
        )?;
        Ok(Some(
            json!({ "id": id, "datasetId": dataset_id, "name": name, "input": case_input,
            "expectedOutput": expected, "metadata": metadata, "createdAt": created_at, "results": [] }),
        ))
    }

    pub fn evaluation_report(&self, dataset_id: &str) -> anyhow::Result<Option<Value>> {
        let dataset = self
            .list_evaluation_datasets()?
            .into_iter()
            .find(|value| value["id"].as_str() == Some(dataset_id));
        let Some(dataset) = dataset else {
            return Ok(None);
        };
        let connection = self.database.connection()?;
        let mut case_statement = connection.prepare(
            "SELECT id,name,input_json,expected_output_json,metadata_json,created_at FROM evaluation_cases WHERE dataset_id=?1 ORDER BY created_at"
        )?;
        let mut cases: Vec<Value> = case_statement.query_map([dataset_id], |row| Ok(json!({
            "id": row.get::<_, String>(0)?, "datasetId": dataset_id, "name": row.get::<_, String>(1)?,
            "input": parse(row.get::<_, Option<String>>(2)?), "expectedOutput": parse(row.get::<_, Option<String>>(3)?),
            "metadata": parse(row.get::<_, Option<String>>(4)?), "createdAt": row.get::<_, String>(5)?, "results": []
        })))?.collect::<Result<_, _>>()?;
        for case in &mut cases {
            let case_id = case["id"].as_str().unwrap_or_default();
            let mut result_statement = connection.prepare(
                "SELECT id,run_id,scores_json,quality_score,notes,created_at FROM evaluation_results WHERE case_id=?1 ORDER BY created_at DESC"
            )?;
            case["results"] = Value::Array(result_statement.query_map([case_id], |row| Ok(json!({
                "id": row.get::<_, String>(0)?, "caseId": case_id, "runId": row.get::<_, String>(1)?,
                "scores": parse(row.get::<_, Option<String>>(2)?), "qualityScore": row.get::<_, f64>(3)?,
                "notes": row.get::<_, Option<String>>(4)?, "createdAt": row.get::<_, String>(5)?
            })))?.collect::<Result<_, _>>()?);
        }
        Ok(Some(json!({ "dataset": dataset, "cases": cases })))
    }

    pub fn record_evaluation_result(&self, input: &Value) -> anyhow::Result<Option<Value>> {
        let case_id = required_string(input, "caseId")?;
        let run_id = required_string(input, "runId")?;
        let scores = input
            .get("scores")
            .and_then(Value::as_object)
            .context("scores must be an object")?;
        if scores.is_empty() {
            bail!("scores must not be empty");
        }
        let connection = self.database.connection()?;
        let weights_json: Option<String> = connection.query_row(
            "SELECT d.score_weights_json FROM evaluation_cases c JOIN evaluation_datasets d ON d.id=c.dataset_id
             JOIN runs r ON r.id=?2 WHERE c.id=?1", params![case_id, run_id], |row| row.get(0)
        ).optional()?;
        let Some(weights_json) = weights_json else {
            return Ok(None);
        };
        let weights = serde_json::from_str::<Value>(&weights_json).unwrap_or_else(|_| json!({}));
        let mut weighted = 0.0;
        let mut total_weight = 0.0;
        for (key, value) in scores {
            let score = value.as_f64().context("scores must be numeric")?;
            if !(0.0..=1.0).contains(&score) {
                bail!("scores must be between zero and one");
            }
            let weight = weights.get(key).and_then(Value::as_f64).unwrap_or(1.0);
            weighted += score * weight;
            total_weight += weight;
        }
        let quality = if total_weight == 0.0 {
            0.0
        } else {
            weighted / total_weight
        };
        let id = Uuid::new_v4().to_string();
        let notes = input.get("notes").and_then(Value::as_str);
        let created_at = now();
        connection.execute(
            "INSERT INTO evaluation_results (id,case_id,run_id,scores_json,quality_score,notes,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(case_id,run_id) DO UPDATE SET scores_json=excluded.scores_json,
               quality_score=excluded.quality_score,notes=excluded.notes,created_at=excluded.created_at",
            params![id, case_id, run_id, Value::Object(scores.clone()).to_string(), quality, notes, created_at],
        )?;
        Ok(Some(
            json!({ "id": id, "caseId": case_id, "runId": run_id, "scores": scores,
            "qualityScore": quality, "notes": notes, "createdAt": created_at }),
        ))
    }

    fn upsert_otlp_run(
        &self,
        id: &str,
        name: &str,
        status: &str,
        started_at: Option<&str>,
        ended_at: Option<&str>,
        metadata: Value,
    ) -> anyhow::Result<()> {
        self.database.connection()?.execute(
            "INSERT INTO runs (id,name,status,started_at,ended_at,metadata_json)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,
               started_at=excluded.started_at,ended_at=excluded.ended_at,
               metadata_json=excluded.metadata_json",
            params![
                id,
                name,
                status,
                started_at.unwrap_or(&now()),
                ended_at,
                metadata.to_string()
            ],
        )?;
        Ok(())
    }

    fn upsert_otlp_event(&self, run_id: &str, span: &Value) -> anyhow::Result<()> {
        let span_id = span
            .get("spanId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let attributes = otlp_attributes(span.get("attributes"));
        let input_tokens = number_value(attributes.get("gen_ai.usage.input_tokens"));
        let output_tokens = number_value(attributes.get("gen_ai.usage.output_tokens"));
        let mut metadata = attributes.clone();
        metadata.insert("source".to_owned(), json!("otlp"));
        if let Some(model) = attributes.get("gen_ai.request.model") {
            metadata.insert("model".to_owned(), model.clone());
        }
        if let Some(provider) = attributes.get("gen_ai.system") {
            metadata.insert("provider".to_owned(), provider.clone());
        }
        if input_tokens.is_some() || output_tokens.is_some() {
            let input = input_tokens.unwrap_or_default();
            let output = output_tokens.unwrap_or_default();
            metadata.insert(
                "tokenUsage".to_owned(),
                json!({
                    "input": input, "output": output, "total": input + output,
                    "source": "otlp", "sourceKind": "official",
                }),
            );
        }
        let event_type = attributes
            .get("agent.trace.event.type")
            .and_then(Value::as_str)
            .filter(|value| {
                matches!(
                    *value,
                    "run_started"
                        | "run_ended"
                        | "step_started"
                        | "step_ended"
                        | "llm_call"
                        | "tool_call"
                        | "retrieval"
                        | "memory_update"
                        | "error"
                )
            })
            .unwrap_or_else(|| {
                if attributes.contains_key("gen_ai.operation.name") {
                    "llm_call"
                } else if attributes.contains_key("tool.name")
                    || attributes.contains_key("gen_ai.tool.name")
                {
                    "tool_call"
                } else {
                    "step_ended"
                }
            });
        let status = if otlp_error(span.get("status")) {
            "error"
        } else {
            "success"
        };
        let parent_id = span
            .get("parentSpanId")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(|value| format!("otlp:{value}"));
        let error = (status == "error").then(|| {
            json!({
                "message": span.pointer("/status/message").and_then(Value::as_str).unwrap_or("OTLP span failed")
            })
        });
        self.database.connection()?.execute(
            "INSERT INTO events (id,run_id,parent_id,type,name,status,timestamp,duration_ms,error_json,metadata_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(id) DO UPDATE SET run_id=excluded.run_id,parent_id=excluded.parent_id,
               type=excluded.type,name=excluded.name,status=excluded.status,timestamp=excluded.timestamp,
               duration_ms=excluded.duration_ms,error_json=excluded.error_json,
               metadata_json=excluded.metadata_json",
            params![
                format!("otlp:{span_id}"), run_id, parent_id, event_type,
                span.get("name").and_then(Value::as_str).unwrap_or("span"), status,
                nano_iso(span.get("startTimeUnixNano")).unwrap_or_else(now),
                nano_duration_ms(span.get("startTimeUnixNano"), span.get("endTimeUnixNano")),
                error.map(|value| value.to_string()), Value::Object(metadata).to_string(),
            ],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrivacySettings {
    sensitive_keys: Vec<String>,
    replacement: String,
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            sensitive_keys: Vec::new(),
            replacement: "[REDACTED]".to_owned(),
        }
    }
}

impl PrivacySettings {
    fn normalize(&mut self) -> anyhow::Result<()> {
        if self.replacement.is_empty() || self.replacement.len() > 120 {
            bail!("invalid replacement");
        }
        let mut seen = HashSet::new();
        self.sensitive_keys = self
            .sensitive_keys
            .drain(..)
            .map(|key| key.trim().to_owned())
            .filter(|key| !key.is_empty() && key.len() <= 120)
            .filter(|key| seen.insert(key.to_lowercase()))
            .collect();
        if self.sensitive_keys.len() > 100 {
            bail!("too many sensitive keys");
        }
        Ok(())
    }
}

fn map_run(row: &rusqlite::Row<'_>) -> rusqlite::Result<DashboardRun> {
    let status: String = row.get(2)?;
    Ok(DashboardRun {
        id: row.get(0)?,
        name: row.get(1)?,
        status: status.clone(),
        started_at: row.get(3)?,
        ended_at: row.get(4)?,
        input: parse(row.get(5)?),
        output: parse(row.get(6)?),
        error: if status == "error" { row.get(7)? } else { None },
        metadata: parse(row.get(8)?),
    })
}

fn map_event(row: &rusqlite::Row<'_>) -> rusqlite::Result<DashboardEvent> {
    Ok(DashboardEvent {
        id: row.get(0)?,
        run_id: row.get(1)?,
        parent_id: row.get(2)?,
        event_type: row.get(3)?,
        name: row.get(4)?,
        status: row.get(5)?,
        timestamp: row.get(6)?,
        duration_ms: row.get(7)?,
        input: parse(row.get(8)?),
        output: parse(row.get(9)?),
        error: parse(row.get(10)?),
        metadata: parse(row.get(11)?),
    })
}

fn map_replay_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    let policy: String = row.get(5)?;
    let mut value = json!({
        "id": row.get::<_, String>(0)?,
        "sourceRunId": row.get::<_, String>(1)?,
        "sourceEventId": row.get::<_, String>(2)?,
        "status": row.get::<_, String>(4)?,
        "policy": serde_json::from_str::<Value>(&policy).unwrap_or_else(|_| replay_policy()),
        "timeoutMs": row.get::<_, i64>(6)?,
        "createdAt": row.get::<_, String>(8)?,
        "workspaceCleaned": row.get::<_, i64>(11)? == 1,
    });
    for (index, key) in [
        (3, "replayRunId"),
        (7, "error"),
        (9, "startedAt"),
        (10, "completedAt"),
    ] {
        if let Some(item) = row.get::<_, Option<String>>(index)? {
            value[key] = json!(item);
        }
    }
    Ok(value)
}

fn replay_policy() -> Value {
    json!({
        "network": "disabled", "toolExecution": "mock-only",
        "filesystem": "temporary", "environment": "sanitized",
    })
}

fn attach_summary(connection: &rusqlite::Connection, run: &mut DashboardRun) -> anyhow::Result<()> {
    let mut statement = connection.prepare(
        "SELECT status, timestamp, name, metadata_json FROM events WHERE run_id = ?1 ORDER BY julianday(timestamp)"
    )?;
    let rows: Vec<(String, String, String, Option<String>)> = statement
        .query_map([&run.id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<Result<_, _>>()?;
    let mut totals = json!({ "input": 0, "output": 0, "total": 0 });
    let mut cost = 0.0;
    let mut models = HashSet::new();
    let mut counts = BTreeMap::from([
        ("commandCount", 0_u64),
        ("toolCount", 0),
        ("mcpCount", 0),
        ("skillCount", 0),
        ("promptCount", 0),
        ("turnCount", 0),
    ]);
    let mut last_event_at = None;
    let mut has_error = false;
    for (status, timestamp, _name, metadata_json) in rows {
        last_event_at = Some(timestamp);
        has_error |= status == "error";
        let metadata = parse(metadata_json).unwrap_or_else(|| json!({}));
        if let Some(token) = metadata.get("tokenUsage") {
            for key in ["input", "output", "total"] {
                let current = totals.get(key).and_then(Value::as_i64).unwrap_or(0);
                totals[key] =
                    (current + token.get(key).and_then(Value::as_i64).unwrap_or(0)).into();
            }
        }
        cost += metadata
            .get("costUsd")
            .and_then(Value::as_f64)
            .unwrap_or(0.0);
        if let Some(model) = metadata.get("model").and_then(Value::as_str) {
            models.insert(model.to_owned());
        }
        if let Some(category) = metadata.get("category").and_then(Value::as_str) {
            let key = match category {
                "command" => Some("commandCount"),
                "tool" => Some("toolCount"),
                "mcp" => Some("mcpCount"),
                "skill" => Some("skillCount"),
                "prompt" => Some("promptCount"),
                "turn" => Some("turnCount"),
                _ => None,
            };
            if let Some(key) = key {
                *counts.get_mut(key).unwrap() += 1;
            }
        }
    }
    if run.status == "running" && has_error {
        run.status = "error".to_owned();
    }
    if run.ended_at.is_none() && run.status != "running" {
        run.ended_at = last_event_at;
    }
    let metadata = run.metadata.get_or_insert_with(|| json!({}));
    if !metadata.is_object() {
        *metadata = json!({});
    }
    metadata["summary"] = json!({
        "commandCount": counts["commandCount"], "toolCount": counts["toolCount"],
        "mcpCount": counts["mcpCount"], "skillCount": counts["skillCount"],
        "promptCount": counts["promptCount"], "turnCount": counts["turnCount"],
        "tokenUsage": totals, "costUsd": cost, "models": models,
        "modelUsage": [], "commands": [], "tools": [], "mcpTools": [], "skills": []
    });
    Ok(())
}

fn validate_identifier(value: &str, name: &str) -> anyhow::Result<()> {
    validate_required_text(value, name)
}
fn validate_required_text(value: &str, name: &str) -> anyhow::Result<()> {
    if value.trim().is_empty() {
        bail!("{name} must not be empty");
    }
    Ok(())
}
fn validate_status(value: &str) -> anyhow::Result<()> {
    if matches!(value, "running" | "success" | "error") {
        Ok(())
    } else {
        bail!("invalid status")
    }
}

fn first_text<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .filter(|value| !value.is_empty())
}

fn insert_optional(target: &mut Value, key: &str, value: Option<&str>) {
    if let (Some(object), Some(value)) = (target.as_object_mut(), value) {
        object.insert(key.to_owned(), json!(value));
    }
}

fn id_part(value: &str) -> String {
    let result = value
        .chars()
        .take(80)
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '_' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    if result.is_empty() {
        "unknown".to_owned()
    } else {
        result
    }
}

fn inferred_provider(source: &str, body: &Value) -> Option<&'static str> {
    let model = first_text(body, &["model"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    if source == "claude-code" || model.contains("claude") {
        Some("anthropic")
    } else if model.contains("gemini") {
        Some("google")
    } else if model.starts_with("gpt-") || model.starts_with('o') {
        Some("openai")
    } else {
        None
    }
}

fn known_hook_event(value: &str) -> bool {
    matches!(
        value,
        "SessionStart"
            | "Setup"
            | "InstructionsLoaded"
            | "UserPromptSubmit"
            | "UserPromptExpansion"
            | "MessageDisplay"
            | "PreToolUse"
            | "PermissionRequest"
            | "PermissionDenied"
            | "PostToolUse"
            | "PostToolUseFailure"
            | "PostToolBatch"
            | "Notification"
            | "SubagentStart"
            | "SubagentStop"
            | "TaskCreated"
            | "TaskCompleted"
            | "Stop"
            | "StopFailure"
            | "TeammateIdle"
            | "ConfigChange"
            | "CwdChanged"
            | "FileChanged"
            | "WorktreeCreate"
            | "WorktreeRemove"
            | "PreCompact"
            | "PostCompact"
            | "SessionEnd"
            | "Elicitation"
            | "ElicitationResult"
    )
}

fn running_hook_event(value: &str) -> bool {
    matches!(
        value,
        "SessionStart"
            | "Setup"
            | "InstructionsLoaded"
            | "UserPromptSubmit"
            | "UserPromptExpansion"
            | "PreToolUse"
            | "PermissionRequest"
            | "SubagentStart"
            | "TaskCreated"
            | "PreCompact"
            | "Elicitation"
            | "PostToolUseFailure"
            | "PermissionDenied"
    )
}

fn hook_event_type(event: &str, known: bool) -> &'static str {
    if !known
        || matches!(
            event,
            "StopFailure" | "PermissionDenied" | "PostToolUseFailure"
        )
    {
        "error"
    } else {
        match event {
            "SessionStart" => "run_started",
            "SessionEnd" => "run_ended",
            "PreToolUse" | "PermissionRequest" | "PostToolUse" | "Elicitation"
            | "ElicitationResult" => "tool_call",
            "PostToolBatch" | "SubagentStop" | "TaskCompleted" | "Stop" | "PostCompact" => {
                "step_ended"
            }
            _ => "step_started",
        }
    }
}

fn hook_category(_event: &str, tool_name: Option<&str>, command: Option<&str>) -> &'static str {
    if command.is_some() || matches!(tool_name, Some("Bash" | "Shell" | "Terminal")) {
        "command"
    } else if tool_name.is_some() {
        "tool"
    } else {
        "lifecycle"
    }
}

fn hook_event_name(event: &str, tool_name: Option<&str>, command: Option<&str>) -> String {
    if command.is_some() {
        return tool_name.map_or_else(|| "command".to_owned(), |tool| format!("{tool} command"));
    }
    if let Some(tool_name) = tool_name {
        return tool_name.to_owned();
    }
    if event == "UserPromptSubmit" {
        "user_prompt".to_owned()
    } else if known_hook_event(event) {
        event.to_owned()
    } else {
        "unknown_hook_event".to_owned()
    }
}

fn array_at<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}

fn otlp_attributes(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|attribute| {
            let key = attribute.get("key")?.as_str()?.to_owned();
            let value = otlp_any_value(attribute.get("value")?)?;
            Some((key, value))
        })
        .collect()
}

fn otlp_any_value(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    for key in [
        "stringValue",
        "intValue",
        "doubleValue",
        "boolValue",
        "bytesValue",
    ] {
        if let Some(value) = object.get(key) {
            return match key {
                "intValue" | "doubleValue" => number_value(Some(value)).map(|number| json!(number)),
                "boolValue" => value.as_bool().map(|value| json!(value)),
                _ => value.as_str().map(|value| json!(value)),
            };
        }
    }
    None
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    value.and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
}

fn attribute_number(attributes: &Map<String, Value>, key: &str) -> Option<f64> {
    number_value(attributes.get(key))
}

fn nano_iso(value: Option<&Value>) -> Option<String> {
    let nanos = value?.as_str()?.parse::<i128>().ok()?;
    let millis = i64::try_from(nanos / 1_000_000).ok()?;
    chrono::DateTime::<Utc>::from_timestamp_millis(millis)
        .map(|value| value.to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn nano_duration_ms(start: Option<&Value>, end: Option<&Value>) -> Option<i64> {
    let start = start?.as_str()?.parse::<i128>().ok()?;
    let end = end?.as_str()?.parse::<i128>().ok()?;
    i64::try_from(((end - start) / 1_000_000).max(0)).ok()
}

fn otlp_error(value: Option<&Value>) -> bool {
    matches!(value.and_then(|value| value.get("code")), Some(Value::Number(number)) if number.as_i64() == Some(2))
        || matches!(
            value
                .and_then(|value| value.get("code"))
                .and_then(Value::as_str),
            Some("2" | "STATUS_CODE_ERROR")
        )
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

const SAFE_METADATA_KEYS: &[&str] = &[
    "agent",
    "surface",
    "redactionLevel",
    "provider",
    "model",
    "costUsd",
    "messageCount",
    "category",
    "toolName",
    "toolKind",
    "mcpServer",
    "mcpTool",
    "skillName",
    "source",
    "surfaceSource",
];
const SAFE_TOKEN_KEYS: &[&str] = &[
    "input",
    "output",
    "total",
    "cachedInput",
    "cacheCreationInput",
    "cacheReadInput",
    "reasoningOutput",
    "estimated",
    "method",
    "source",
    "sourceKind",
    "scope",
];

fn pseudonym(prefix: &str, value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let suffix = digest
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{prefix}-{suffix}")
}

fn safe_metadata(value: Option<&Value>) -> Option<Value> {
    let source = value?.as_object()?;
    let mut result = Map::new();
    for key in SAFE_METADATA_KEYS {
        if let Some(item) = source.get(*key).filter(|item| safe_scalar(item)) {
            result.insert((*key).to_owned(), item.clone());
        }
    }
    if let Some(tokens) = source.get("tokenUsage").and_then(Value::as_object) {
        let mut safe_tokens = Map::new();
        for key in SAFE_TOKEN_KEYS {
            if let Some(item) = tokens.get(*key).filter(|item| safe_scalar(item)) {
                safe_tokens.insert((*key).to_owned(), item.clone());
            }
        }
        if !safe_tokens.is_empty() {
            result.insert("tokenUsage".to_owned(), Value::Object(safe_tokens));
        }
    }
    (!result.is_empty()).then_some(Value::Object(result))
}

fn safe_scalar(value: &Value) -> bool {
    value.is_string() || value.is_boolean() || value.as_f64().is_some_and(f64::is_finite)
}

fn timestamp_delta_ms(started_at: &str, ended_at: Option<&str>) -> i64 {
    let Ok(start) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return 0;
    };
    let end = ended_at
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .map(|value| value.timestamp_millis())
        .unwrap_or_else(|| Utc::now().timestamp_millis());
    (end - start.timestamp_millis()).max(0)
}

#[derive(Debug)]
struct ComparableEvent {
    id: String,
    event_type: String,
    name: String,
    status: String,
    duration_ms: i64,
    total_tokens: f64,
    occurrence: usize,
}

impl ComparableEvent {
    fn metric(&self) -> Value {
        json!({
            "id": self.id, "status": self.status, "durationMs": self.duration_ms,
            "totalTokens": self.total_tokens,
        })
    }
}

fn index_comparable_events(events: &[DashboardEvent]) -> BTreeMap<String, ComparableEvent> {
    let mut occurrences = HashMap::<String, usize>::new();
    let mut result = BTreeMap::new();
    for event in events {
        let signature = format!("{}:{}", event.event_type, event.name);
        let occurrence = occurrences.entry(signature.clone()).or_default();
        *occurrence += 1;
        let total_tokens = event
            .metadata
            .as_ref()
            .and_then(|value| value.pointer("/tokenUsage/total"))
            .and_then(Value::as_f64)
            .unwrap_or_default();
        result.insert(
            format!("{signature}:{}", *occurrence),
            ComparableEvent {
                id: event.id.clone(),
                event_type: event.event_type.clone(),
                name: event.name.clone(),
                status: event.status.clone(),
                duration_ms: event.duration_ms.unwrap_or_default(),
                total_tokens,
                occurrence: *occurrence,
            },
        );
    }
    result
}

fn event_changes(
    baseline: Option<&ComparableEvent>,
    candidate: Option<&ComparableEvent>,
) -> Vec<&'static str> {
    let (Some(baseline), Some(candidate)) = (baseline, candidate) else {
        return match (baseline, candidate) {
            (None, Some(_)) => vec!["added"],
            (Some(_), None) => vec!["removed"],
            _ => Vec::new(),
        };
    };
    let mut changes = Vec::new();
    if baseline.status != candidate.status {
        changes.push("status");
    }
    if baseline.duration_ms != candidate.duration_ms {
        changes.push("duration");
    }
    if baseline.total_tokens != candidate.total_tokens {
        changes.push("tokens");
    }
    changes
}

fn event_regressions(
    baseline: Option<&ComparableEvent>,
    candidate: Option<&ComparableEvent>,
) -> Vec<&'static str> {
    let Some(candidate) = candidate else {
        return baseline.map_or_else(Vec::new, |_| vec!["missing"]);
    };
    let mut regressions = Vec::new();
    if candidate.status == "error" && baseline.is_none_or(|value| value.status != "error") {
        regressions.push("status");
    }
    if let Some(baseline) = baseline {
        if baseline.duration_ms > 0
            && candidate.duration_ms as f64 > baseline.duration_ms as f64 * 1.2
        {
            regressions.push("duration");
        }
        if baseline.total_tokens > 0.0 && candidate.total_tokens > baseline.total_tokens * 1.2 {
            regressions.push("tokens");
        }
    }
    regressions
}

fn analyze_trace_insights(events: &[DashboardEvent]) -> Vec<Value> {
    let has_live_actions = events.iter().any(|event| {
        event.metadata.as_ref().is_some_and(|metadata| {
            metadata.get("source").and_then(Value::as_str) != Some("transcript")
                && is_action_category(metadata.get("category").and_then(Value::as_str))
        })
    });
    let mut ordered = events
        .iter()
        .filter(|event| {
            !has_live_actions
                || event
                    .metadata
                    .as_ref()
                    .and_then(|value| value.get("source"))
                    .and_then(Value::as_str)
                    != Some("transcript")
        })
        .collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
    let actions = ordered
        .iter()
        .filter_map(|event| action_name(event).map(|name| (*event, name)))
        .collect::<Vec<_>>();
    let mut insights = Vec::new();
    let mut start = 0;
    while start < actions.len() {
        let mut end = start + 1;
        while end < actions.len() && actions[end].1 == actions[start].1 {
            end += 1;
        }
        let group = &actions[start..end];
        if group.len() >= 3 {
            let ids = group.iter().map(|(event, _)| &event.id).collect::<Vec<_>>();
            insights.push(json!({
                "kind": "repeated_action", "severity": "warning", "eventIds": ids,
                "title": "Repeated action",
                "evidence": { "actionName": group[0].1, "count": group.len() },
            }));
            let failed = group[..group.len() - 1]
                .iter()
                .filter(|(event, _)| event.status == "error")
                .count();
            if group
                .last()
                .is_some_and(|(event, _)| event.status == "success")
                && failed >= 2
            {
                insights.push(json!({
                    "kind": "retry_loop", "severity": "warning", "eventIds": ids,
                    "title": "Retry loop",
                    "evidence": {
                        "actionName": group[0].1, "attempts": group.len(), "failedAttempts": failed,
                    },
                }));
            }
        }
        start = end;
    }
    for event in &ordered {
        if event.duration_ms.is_some_and(|duration| duration >= 10_000) {
            insights.push(json!({
                "kind": "slow_step", "severity": "warning", "eventIds": [event.id],
                "title": "Slow step",
                "evidence": { "durationMs": event.duration_ms, "thresholdMs": 10_000 },
            }));
        }
    }
    let token_events = ordered
        .iter()
        .filter_map(|event| {
            let tokens = event
                .metadata
                .as_ref()
                .and_then(|value| value.pointer("/tokenUsage/total"))
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite() && *value > 0.0)?;
            Some((*event, tokens))
        })
        .collect::<Vec<_>>();
    let run_tokens = token_events.iter().map(|(_, tokens)| tokens).sum::<f64>();
    for (event, tokens) in token_events {
        let share = tokens / run_tokens;
        if tokens >= 1_000.0 && share >= 0.5 {
            insights.push(json!({
                "kind": "token_hotspot", "severity": "info", "eventIds": [event.id],
                "title": "Token hotspot",
                "evidence": { "eventTokens": tokens, "runTokens": run_tokens, "share": share },
            }));
        }
    }
    let errors = ordered
        .iter()
        .filter(|event| event.status == "error")
        .collect::<Vec<_>>();
    if errors.len() >= 3 {
        insights.push(json!({
            "kind": "failure_cascade", "severity": "error",
            "eventIds": [&errors[0].id, &errors[1].id, &errors[2].id],
            "title": "Failure cascade", "evidence": { "errorCount": 3 },
        }));
    }
    insights
}

fn action_name(event: &DashboardEvent) -> Option<String> {
    let metadata = event.metadata.as_ref();
    let category = metadata
        .and_then(|value| value.get("category"))
        .and_then(Value::as_str);
    if !is_action_category(category) && event.event_type != "tool_call" {
        return None;
    }
    let key = match category {
        Some("command") => "command",
        Some("tool") => "toolName",
        Some("skill") => "skillName",
        Some("mcp") => {
            let server = metadata
                .and_then(|value| value.get("mcpServer"))
                .and_then(Value::as_str);
            let tool = metadata
                .and_then(|value| value.get("mcpTool"))
                .and_then(Value::as_str);
            return Some(match (server, tool) {
                (Some(server), Some(tool)) => format!("{server}.{tool}"),
                _ => event.name.clone(),
            });
        }
        _ => "toolName",
    };
    Some(
        metadata
            .and_then(|value| value.get(key))
            .and_then(Value::as_str)
            .unwrap_or(&event.name)
            .to_owned(),
    )
}

fn is_action_category(category: Option<&str>) -> bool {
    matches!(category, Some("command" | "tool" | "mcp" | "skill"))
}

fn stringify(value: Option<Value>) -> Option<String> {
    value.map(|value| value.to_string())
}
fn parse(value: Option<String>) -> Option<Value> {
    value.and_then(|value| serde_json::from_str(&value).ok())
}
fn normalized_filter(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "all")
        .map(ToOwned::to_owned)
}
fn add_text_filter(
    clauses: &mut Vec<String>,
    values: &mut Vec<rusqlite::types::Value>,
    column: &str,
    value: Option<String>,
    lower: bool,
) {
    if let Some(value) = normalized_filter(value.as_deref()) {
        let index = values.len() + 1;
        clauses.push(if lower {
            format!("lower({column}) = lower(?{index})")
        } else {
            format!("{column} = ?{index}")
        });
        values.push(value.into());
    }
}
fn add_json_filter(
    clauses: &mut Vec<String>,
    values: &mut Vec<rusqlite::types::Value>,
    path: &str,
    value: Option<String>,
) {
    if let Some(value) = normalized_filter(value.as_deref()) {
        let index = values.len() + 1;
        clauses.push(format!(
            "lower(coalesce(json_extract(metadata_json, '{path}'), '')) = lower(?{index})"
        ));
        values.push(value.into());
    }
}
fn add_bound(
    clauses: &mut Vec<String>,
    values: &mut Vec<rusqlite::types::Value>,
    column: &str,
    operation: &str,
    value: Option<String>,
) {
    if let Some(value) = value {
        let index = values.len() + 1;
        clauses.push(format!("{column} {operation} ?{index}"));
        values.push(value.into());
    }
}
fn update_optional_text(map: &mut Map<String, Value>, key: &str, value: Option<Option<String>>) {
    match value {
        Some(Some(value)) if !value.trim().is_empty() => {
            map.insert(key.to_owned(), value.trim().into());
        }
        Some(_) => {
            map.remove(key);
        }
        None => {}
    }
}
fn event_category(event: &DashboardEvent) -> Option<String> {
    let metadata = event.metadata.as_ref()?;
    let category = metadata.get("category")?.as_str()?;
    if category == "tool" && metadata.get("toolKind").and_then(Value::as_str) == Some("command") {
        Some("command".to_owned())
    } else {
        Some(category.to_owned())
    }
}
fn is_display_event(event: &DashboardEvent) -> bool {
    matches!(
        event_category(event).as_deref(),
        Some("command" | "tool" | "mcp" | "skill" | "tokens")
    ) || event
        .metadata
        .as_ref()
        .and_then(|value| value.get("tokenUsage"))
        .is_some()
}
fn event_total_tokens(event: &DashboardEvent) -> i64 {
    event
        .metadata
        .as_ref()
        .and_then(|value| value.get("tokenUsage"))
        .and_then(|value| value.get("total"))
        .and_then(Value::as_i64)
        .unwrap_or(0)
}
fn read_privacy_settings(connection: &rusqlite::Connection) -> anyhow::Result<PrivacySettings> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value_json FROM settings WHERE key = 'privacy'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}
fn redact_option(value: &mut Option<Value>, settings: &PrivacySettings) {
    if let Some(value) = value {
        redact(value, settings);
    }
}
fn redact(value: &mut Value, settings: &PrivacySettings) {
    if settings.sensitive_keys.is_empty() {
        return;
    }
    let sensitive: HashSet<String> = settings
        .sensitive_keys
        .iter()
        .map(|key| key.to_lowercase())
        .collect();
    redact_inner(value, &sensitive, &settings.replacement);
}
fn redact_inner(value: &mut Value, sensitive: &HashSet<String>, replacement: &str) {
    match value {
        Value::Array(values) => {
            for value in values {
                redact_inner(value, sensitive, replacement);
            }
        }
        Value::Object(values) => {
            for (key, value) in values {
                if sensitive.contains(&key.to_lowercase()) {
                    *value = replacement.into();
                } else {
                    redact_inner(value, sensitive, replacement);
                }
            }
        }
        _ => {}
    }
}
fn string_field<'a>(value: &'a Value, key: &str, fallback: &'a str) -> anyhow::Result<&'a str> {
    Ok(value.get(key).and_then(Value::as_str).unwrap_or(fallback))
}
fn int_field(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0)
}

fn upsert_history_run(
    transaction: &rusqlite::Transaction<'_>,
    row: &Value,
    scanned_at: &str,
) -> anyhow::Result<()> {
    let client = string_field(row, "client", "unknown")?;
    let session_id = string_field(row, "sessionId", "usage")?;
    let title = string_field(row, "title", "")?;
    let already_tracked: bool = transaction.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM runs
           WHERE json_extract(metadata_json, '$.sessionId') = ?1
             AND coalesce(json_extract(metadata_json, '$.historyScan'), 0) != 1
         )",
        [session_id],
        |record| record.get(0),
    )?;
    if already_tracked {
        update_generated_run_name(transaction, client, session_id, title)?;
        return Ok(());
    }

    let run_id = history_identifier("run", client, session_id);
    let tombstoned: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM run_tombstones WHERE run_id = ?1)",
        [&run_id],
        |record| record.get(0),
    )?;
    if tombstoned {
        return Ok(());
    }

    let started_at = row
        .get("startedAt")
        .and_then(Value::as_str)
        .or_else(|| row.get("lastUsedAt").and_then(Value::as_str))
        .unwrap_or(scanned_at);
    let ended_at = row
        .get("lastUsedAt")
        .and_then(Value::as_str)
        .unwrap_or(started_at);
    let model = string_field(row, "model", "")?;
    let provider = string_field(row, "provider", "")?;
    let input = int_field(row, "inputTokens");
    let output = int_field(row, "outputTokens");
    let cache_read = int_field(row, "cacheReadTokens");
    let cache_write = int_field(row, "cacheWriteTokens");
    let reasoning = int_field(row, "reasoningTokens");
    let total = int_field(row, "totalTokens");
    let messages = int_field(row, "messageCount");
    let token_usage = json!({
        "input": input, "output": output, "cacheRead": cache_read,
        "cacheWrite": cache_write, "reasoning": reasoning, "total": total,
        "source": "native-history-scan"
    });
    let metadata = json!({
        "agent": client, "source": "history-scan", "historyScan": true,
        "sessionId": session_id, "model": model, "provider": provider,
        "summary": {
            "eventCount": 1, "messageCount": messages, "failedEventCount": 0,
            "tokenUsage": token_usage, "costUsd": row.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0),
            "models": if model.is_empty() { Vec::<String>::new() } else { vec![model.to_owned()] }
        }
    });
    let short_session: String = session_id.chars().take(18).collect();
    let run_name = if title.is_empty() {
        format!("{client}:{short_session}")
    } else {
        title.to_owned()
    };
    transaction.execute(
        "INSERT INTO runs (id,name,status,started_at,ended_at,input_json,output_json,error,metadata_json)
         VALUES (?1,?2,'success',?3,?4,NULL,NULL,NULL,?5)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,status='success',
           started_at=excluded.started_at,ended_at=excluded.ended_at,
           metadata_json=json_patch(coalesce(runs.metadata_json,'{}'), excluded.metadata_json)",
        params![run_id, run_name, started_at, ended_at, metadata.to_string()],
    )?;

    let event_id = history_identifier("event", client, session_id);
    let event_metadata = json!({
        "category": "model", "agent": client, "source": "history-scan",
        "sessionId": session_id, "model": model, "provider": provider,
        "messageCount": messages, "tokenUsage": token_usage,
        "costUsd": row.get("costUsd").and_then(Value::as_f64).unwrap_or(0.0)
    });
    transaction.execute(
        "INSERT INTO events (id,run_id,parent_id,type,name,status,timestamp,duration_ms,input_json,output_json,error_json,metadata_json)
         VALUES (?1,?2,NULL,'model_call',?3,'success',?4,NULL,NULL,NULL,NULL,?5)
         ON CONFLICT(id) DO UPDATE SET timestamp=excluded.timestamp,name=excluded.name,
           metadata_json=excluded.metadata_json",
        params![event_id, run_id, format!("{client} session usage"), ended_at, event_metadata.to_string()],
    )?;
    Ok(())
}

fn update_generated_run_name(
    transaction: &rusqlite::Transaction<'_>,
    client: &str,
    session_id: &str,
    title: &str,
) -> anyhow::Result<()> {
    if title.is_empty() {
        return Ok(());
    }
    let agent = if client == "claude" {
        "claude-code"
    } else {
        client
    };
    let short_session: String = session_id.chars().take(18).collect();
    transaction.execute(
        "UPDATE runs SET name=?1
         WHERE json_extract(metadata_json, '$.sessionId')=?2
           AND name IN (?3, ?4, ?5, ?6)",
        params![
            title,
            session_id,
            format!("{agent}:{session_id}"),
            format!("{client}:{session_id}"),
            format!("{agent}:{short_session}"),
            format!("{client}:{short_session}")
        ],
    )?;
    Ok(())
}

fn history_identifier(kind: &str, client: &str, session_id: &str) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in client.bytes().chain([0]).chain(session_id.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("history_{kind}_{client}_{hash:016x}")
}

fn analytics_dimension_expression(dimension: &str) -> anyhow::Result<&'static str> {
    Ok(match dimension {
        "project" => "coalesce(json_extract(runs.metadata_json,'$.project'),'unassigned')",
        "environment" => "coalesce(json_extract(runs.metadata_json,'$.environment'),'unassigned')",
        "model" => "coalesce(json_extract(runs.metadata_json,'$.model'),'unknown')",
        "source" => {
            "coalesce(json_extract(runs.metadata_json,'$.agent'),json_extract(runs.metadata_json,'$.source'),json_extract(runs.metadata_json,'$.surface'),'manual')"
        }
        _ => bail!("invalid analytics dimension"),
    })
}

fn required_string<'a>(value: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .with_context(|| format!("{key} is required"))
}

fn budget_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?,
        "dimension": row.get::<_, String>(2)?, "value": row.get::<_, String>(3)?,
        "period": row.get::<_, String>(4)?, "maxCostUsd": row.get::<_, Option<f64>>(5)?,
        "maxTokens": row.get::<_, Option<i64>>(6)?, "maxRuns": row.get::<_, Option<i64>>(7)?,
        "enabled": row.get::<_, bool>(8)?, "createdAt": row.get::<_, String>(9)?,
        "updatedAt": row.get::<_, String>(10)?
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let directory = tempfile::tempdir().unwrap();
        let database = Database::open(directory.path().join("test.db")).unwrap();
        (directory, Storage::new(database))
    }

    #[test]
    fn run_and_event_round_trip_matches_the_json_contract() {
        let (_directory, storage) = storage();
        storage
            .create_run(CreateRun {
                id: "run-1".into(),
                name: "test".into(),
                status: "running".into(),
                started_at: Some("2026-01-01T00:00:00.000Z".into()),
                ended_at: None,
                input: Some(json!({"prompt":"hello"})),
                output: None,
                error: None,
                metadata: Some(json!({"agent":"codex"})),
            })
            .unwrap();
        storage
            .create_event(CreateEvent {
                id: "event-1".into(),
                run_id: "run-1".into(),
                parent_id: None,
                event_type: "tool_call".into(),
                name: "shell".into(),
                status: "success".into(),
                timestamp: Some("2026-01-01T00:00:01.000Z".into()),
                duration_ms: Some(20),
                input: None,
                output: None,
                error: None,
                metadata: Some(
                    json!({"category":"tool","tokenUsage":{"input":1,"output":2,"total":3}}),
                ),
            })
            .unwrap();
        let run = storage.get_run("run-1").unwrap().unwrap();
        assert_eq!(run.id, "run-1");
        assert_eq!(run.metadata.unwrap()["summary"]["tokenUsage"]["total"], 3);
        assert_eq!(storage.list_events_legacy("run-1").unwrap().len(), 1);
    }

    #[test]
    fn tombstone_prevents_recreating_a_deleted_run() {
        let (_directory, storage) = storage();
        let create = || CreateRun {
            id: "run-1".into(),
            name: "test".into(),
            status: "running".into(),
            started_at: None,
            ended_at: None,
            input: None,
            output: None,
            error: None,
            metadata: None,
        };
        assert!(storage.create_run(create()).unwrap());
        assert!(storage.delete_run("run-1").unwrap());
        assert!(!storage.create_run(create()).unwrap());
        assert!(storage.restore_tombstone("run-1").unwrap());
        assert!(storage.create_run(create()).unwrap());
    }

    #[test]
    fn native_usage_snapshot_materializes_history_runs_with_a_readable_title() {
        let (_directory, storage) = storage();
        storage
            .replace_usage_snapshot(&json!({
                "scannedAt": "2026-01-02T00:00:00.000Z",
                "reconciledClients": ["codex"], "diagnostics": [],
                "rows": [{
                    "client": "codex", "sessionId": "session-1", "model": "gpt-5",
                    "provider": "openai", "inputTokens": 80, "outputTokens": 20,
                    "cacheReadTokens": 10, "cacheWriteTokens": 0, "reasoningTokens": 5,
                    "totalTokens": 110, "costUsd": 0.42, "messageCount": 4,
                    "title": "Fix collector startup",
                    "startedAt": "2026-01-01T00:00:00.000Z",
                    "lastUsedAt": "2026-01-01T00:05:00.000Z",
                    "prompt": "must not be stored"
                }]
            }))
            .unwrap();
        let page = storage
            .list_runs(RunListQuery {
                include_untracked: true,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.runs.len(), 1);
        let run = &page.runs[0];
        assert_eq!(run.name, "Fix collector startup");
        assert_eq!(run.metadata.as_ref().unwrap()["historyScan"], true);
        assert_eq!(
            run.metadata.as_ref().unwrap()["summary"]["tokenUsage"]["total"],
            110
        );
        assert_eq!(run.metadata.as_ref().unwrap()["summary"]["costUsd"], 0.42);
        assert!(
            !serde_json::to_string(run)
                .unwrap()
                .contains("must not be stored")
        );
    }
}
