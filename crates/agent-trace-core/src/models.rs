use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRun {
    pub id: String,
    pub name: String,
    #[serde(default = "default_running")]
    pub status: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub input: Option<Value>,
    pub output: Option<Value>,
    pub error: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRun {
    pub status: String,
    pub ended_at: Option<Option<String>>,
    pub output: Option<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEvent {
    pub id: String,
    pub run_id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub name: String,
    pub status: String,
    pub timestamp: Option<String>,
    pub duration_ms: Option<i64>,
    pub input: Option<Value>,
    pub output: Option<Value>,
    pub error: Option<Value>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunOrganization {
    pub project: Option<Option<String>>,
    pub environment: Option<Option<String>>,
    pub version: Option<Option<String>>,
    pub tags: Option<Vec<String>>,
    pub note: Option<Option<String>>,
    pub favorite: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardRun {
    pub id: String,
    pub name: String,
    pub status: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardEvent {
    pub id: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub event_type: String,
    pub name: String,
    pub status: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub runs: Vec<T>,
    pub pagination: Pagination,
    pub summary: RunPageSummary,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pagination {
    pub page: usize,
    pub page_size: usize,
    pub total: usize,
    pub total_pages: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPageSummary {
    pub total_runs: usize,
    pub running_runs: usize,
    pub failed_runs: usize,
    pub agents: Vec<AgentCount>,
}

#[derive(Debug, Serialize)]
pub struct AgentCount {
    pub agent: String,
    pub count: usize,
}

fn default_running() -> String {
    "running".to_owned()
}
