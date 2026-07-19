use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde::Deserialize;
use serde_json::{Value, json};

const MAX_FILES: usize = 5_000;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) fn scan(home: &Path) -> Value {
    let include_titles = match std::env::var("AGENT_TRACE_HISTORY_CONTENT") {
        Ok(mode) => !mode.eq_ignore_ascii_case("metadata"),
        Err(_) => true,
    };
    scan_with_pricing(home, PricingCatalog::load(), include_titles)
}

fn scan_with_pricing(home: &Path, pricing: PricingCatalog, include_titles: bool) -> Value {
    let scanned_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut rows = Vec::new();
    let mut diagnostics = Vec::new();
    let mut reconciled = Vec::new();

    let codex_roots = [
        home.join(".codex/sessions"),
        home.join(".codex/archived_sessions"),
    ];
    let codex_files = jsonl_files(&codex_roots);
    if codex_roots.iter().any(|root| root.is_dir()) {
        reconciled.push(json!("codex"));
        rows.extend(
            codex_files
                .iter()
                .filter_map(|path| scan_codex(path, &pricing, include_titles)),
        );
        diagnostics.push(json!({
            "client": "codex", "available": true, "source": "native-rust",
            "files": codex_files.len(), "actionHint": null,
        }));
    } else {
        diagnostics.push(json!({
            "client": "codex", "available": false, "source": "native-rust",
            "files": 0, "actionHint": "Start a Codex session to create local history",
        }));
    }

    let claude_roots = [home.join(".claude/projects")];
    let claude_files = jsonl_files(&claude_roots);
    if claude_roots.iter().any(|root| root.is_dir()) {
        reconciled.push(json!("claude"));
        rows.extend(
            claude_files
                .iter()
                .filter_map(|path| scan_claude(path, &pricing, include_titles)),
        );
        diagnostics.push(json!({
            "client": "claude", "available": true, "source": "native-rust",
            "files": claude_files.len(), "actionHint": null,
        }));
    } else {
        diagnostics.push(json!({
            "client": "claude", "available": false, "source": "native-rust",
            "files": 0, "actionHint": "Start a Claude Code session to create local history",
        }));
    }

    json!({
        "source": "native-rust", "scannedAt": scanned_at, "rows": rows,
        "reconciledClients": reconciled, "diagnostics": diagnostics,
    })
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelPricing {
    provider: String,
    input: f64,
    output: f64,
    cached_input: Option<f64>,
    cache_write_5m: Option<f64>,
    cache_read: Option<f64>,
}

impl ModelPricing {
    fn new(
        provider: &str,
        input: f64,
        output: f64,
        cached_input: Option<f64>,
        cache_write_5m: Option<f64>,
    ) -> Self {
        Self {
            provider: provider.to_owned(),
            input,
            output,
            cached_input,
            cache_write_5m,
            cache_read: None,
        }
    }

    fn is_valid(&self) -> bool {
        !self.provider.is_empty()
            && [
                Some(self.input),
                Some(self.output),
                self.cached_input,
                self.cache_write_5m,
                self.cache_read,
            ]
            .into_iter()
            .flatten()
            .all(|value| value.is_finite() && value >= 0.0)
    }

    fn cost_usd(&self, usage: &Usage) -> f64 {
        let cache_read_rate = self.cache_read.or(self.cached_input).unwrap_or(self.input);
        let cost = if self.provider == "anthropic" {
            usage.input as f64 * self.input
                + usage.output as f64 * self.output
                + usage.cache_read as f64 * cache_read_rate
                + usage.cache_write as f64 * self.cache_write_5m.unwrap_or(self.input)
        } else {
            (usage.input + usage.cache_write) as f64 * self.input
                + usage.output as f64 * self.output
                + usage.cache_read as f64 * cache_read_rate
        };

        cost / 1_000_000.0
    }
}

struct PricingCatalog(HashMap<String, ModelPricing>);

impl PricingCatalog {
    fn load() -> Self {
        let mut catalog = Self::built_in();
        let configured = std::env::var("AGENT_TRACE_MODEL_PRICES_JSON")
            .or_else(|_| std::env::var("TOOLTRACE_MODEL_PRICES_JSON"));
        if let Ok(value) = configured {
            catalog.apply_overrides(&value);
        }
        catalog
    }

    fn apply_overrides(&mut self, value: &str) {
        if let Ok(overrides) = serde_json::from_str::<HashMap<String, ModelPricing>>(value) {
            for (model, pricing) in overrides {
                if pricing.is_valid() {
                    self.0.insert(normalize_model(&model), pricing);
                }
            }
        }
    }

    fn built_in() -> Self {
        let mut prices = HashMap::new();
        prices.insert(
            "gpt-5.6-sol".to_owned(),
            ModelPricing::new("openai", 5.0, 30.0, Some(0.5), Some(6.25)),
        );
        prices.insert(
            "gpt-5.5".to_owned(),
            ModelPricing::new("openai", 5.0, 30.0, Some(0.5), None),
        );
        prices.insert(
            "gpt-5".to_owned(),
            ModelPricing::new("openai", 1.25, 10.0, Some(0.125), None),
        );
        prices.insert(
            "codex-auto-review".to_owned(),
            ModelPricing::new("openai", 0.25, 2.0, Some(0.025), None),
        );
        prices.insert(
            "claude-opus-4-8".to_owned(),
            ModelPricing::new("anthropic", 5.0, 25.0, Some(0.5), Some(6.25)),
        );
        prices.insert(
            "deepseek-v4-pro".to_owned(),
            ModelPricing::new("deepseek", 0.435, 0.87, Some(0.003_625), Some(0.0)),
        );
        Self(prices)
    }

    fn get(&self, model: &str) -> Option<&ModelPricing> {
        self.0.get(&normalize_model(model))
    }
}

fn normalize_model(model: &str) -> String {
    model.trim().to_lowercase()
}

fn jsonl_files(roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let mut pending = roots.to_vec();
    while let Some(path) = pending.pop() {
        if result.len() >= MAX_FILES {
            break;
        }
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.is_file() {
            if metadata.len() <= MAX_FILE_BYTES
                && path
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
            {
                result.push(path);
            }
            continue;
        }
        if let Ok(entries) = fs::read_dir(path) {
            pending.extend(entries.filter_map(Result::ok).map(|entry| entry.path()));
        }
    }
    result.sort();
    result
}

#[derive(Default)]
struct Usage {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    reasoning: i64,
}

impl Usage {
    fn total(&self) -> i64 {
        self.input + self.output + self.cache_read + self.cache_write
    }

    fn add(&mut self, other: &Self) {
        self.input += other.input;
        self.output += other.output;
        self.cache_read += other.cache_read;
        self.cache_write += other.cache_write;
        self.reasoning += other.reasoning;
    }
}

fn scan_codex(path: &Path, pricing: &PricingCatalog, include_title: bool) -> Option<Value> {
    let mut latest_usage = Usage::default();
    let mut model = String::new();
    let mut first = None::<String>;
    let mut last = None::<String>;
    let mut messages = 0_i64;
    let mut title = String::new();
    for value in json_lines(path) {
        update_timestamps(&value, &mut first, &mut last);
        if model.is_empty() {
            model = find_string(&value, &["model", "model_name"]).unwrap_or_default();
        }
        let mut candidates = Vec::new();
        find_named_objects(&value, "total_token_usage", &mut candidates);
        for candidate in candidates {
            let usage = usage_from_object(candidate);
            if usage.total() >= latest_usage.total() {
                latest_usage = usage;
            }
        }
        if value.pointer("/payload/type").and_then(Value::as_str) == Some("message") {
            messages += 1;
        }
        if include_title
            && title.is_empty()
            && value.get("type").and_then(Value::as_str) == Some("event_msg")
            && value.pointer("/payload/type").and_then(Value::as_str) == Some("user_message")
            && let Some(prompt) = value
                .pointer("/payload/message")
                .or_else(|| value.pointer("/payload/text"))
                .and_then(Value::as_str)
        {
            title = compact_conversation_title(
                prompt
                    .rsplit_once("## My request for Codex:")
                    .map(|(_, request)| request)
                    .unwrap_or(prompt),
            );
        }
    }
    usage_row(
        ("codex", "openai"),
        path,
        model,
        latest_usage,
        messages,
        (first, last, title),
        pricing,
    )
}

fn scan_claude(path: &Path, pricing: &PricingCatalog, include_title: bool) -> Option<Value> {
    let mut usage = Usage::default();
    let mut model = String::new();
    let mut first = None::<String>;
    let mut last = None::<String>;
    let mut messages = 0_i64;
    let mut title = String::new();
    for value in json_lines(path) {
        update_timestamps(&value, &mut first, &mut last);
        if let Some(message) = value.get("message") {
            if include_title
                && title.is_empty()
                && value.get("type").and_then(Value::as_str) == Some("user")
                && let Some(prompt) = claude_user_prompt(message)
            {
                title = compact_conversation_title(&prompt);
            }
            if model.is_empty() {
                model = find_string(message, &["model"]).unwrap_or_default();
            }
            if let Some(item) = message.get("usage").and_then(Value::as_object) {
                usage.add(&usage_from_object(item));
                messages += 1;
            }
        }
    }
    usage_row(
        ("claude", "anthropic"),
        path,
        model,
        usage,
        messages,
        (first, last, title),
        pricing,
    )
}

fn usage_row(
    source: (&str, &str),
    path: &Path,
    model: String,
    usage: Usage,
    messages: i64,
    session: (Option<String>, Option<String>, String),
    pricing: &PricingCatalog,
) -> Option<Value> {
    let total = usage.total();
    if total <= 0 {
        return None;
    }
    let cost = pricing.get(&model).map(|price| price.cost_usd(&usage));
    let mut row = json!({
        "client": source.0,
        "sessionId": path.file_stem().and_then(|value| value.to_str()).unwrap_or("usage"),
        "model": model, "provider": source.1,
        "inputTokens": usage.input, "outputTokens": usage.output,
        "cacheReadTokens": usage.cache_read, "cacheWriteTokens": usage.cache_write,
        "reasoningTokens": usage.reasoning, "totalTokens": total,
        "messageCount": messages, "startedAt": session.0, "lastUsedAt": session.1,
    });
    if let Some(cost) = cost {
        row["costUsd"] = json!(cost);
    }
    if !session.2.is_empty() {
        row["title"] = json!(session.2);
    }
    Some(row)
}

fn claude_user_prompt(message: &Value) -> Option<String> {
    let content = message.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    let blocks = content.as_array()?;
    if blocks
        .iter()
        .any(|block| block.get("type").and_then(Value::as_str) == Some("tool_result"))
    {
        return None;
    }
    let text = blocks
        .iter()
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

fn compact_conversation_title(value: &str) -> String {
    let cleaned = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_start_matches("[image]")
        .trim()
        .to_owned();
    let characters = cleaned.chars().collect::<Vec<_>>();
    if characters.len() > 80 {
        format!("{}…", characters[..79].iter().collect::<String>())
    } else {
        cleaned
    }
}

fn json_lines(path: &Path) -> impl Iterator<Item = Value> {
    File::open(path)
        .ok()
        .map(|file| {
            BufReader::new(file)
                .lines()
                .map_while(Result::ok)
                .filter_map(|line| serde_json::from_str(&line).ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
        .into_iter()
}

fn usage_from_object(object: &serde_json::Map<String, Value>) -> Usage {
    Usage {
        input: integer(object, &["input_tokens", "inputTokens"]),
        output: integer(object, &["output_tokens", "outputTokens"]),
        cache_read: integer(
            object,
            &[
                "cached_input_tokens",
                "cache_read_input_tokens",
                "cacheReadInputTokens",
            ],
        ),
        cache_write: integer(
            object,
            &["cache_creation_input_tokens", "cacheWriteInputTokens"],
        ),
        reasoning: integer(
            object,
            &["reasoning_output_tokens", "reasoningOutputTokens"],
        ),
    }
}

fn integer(object: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| {
            object
                .get(*key)
                .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        })
        .unwrap_or_default()
}

fn update_timestamps(value: &Value, first: &mut Option<String>, last: &mut Option<String>) {
    let Some(timestamp) = find_string(value, &["timestamp"]) else {
        return;
    };
    if first.as_ref().is_none_or(|current| timestamp < *current) {
        *first = Some(timestamp.clone());
    }
    if last.as_ref().is_none_or(|current| timestamp > *current) {
        *last = Some(timestamp);
    }
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(value) = object
                    .get(*key)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    return Some(value.to_owned());
                }
            }
            object.values().find_map(|value| find_string(value, keys))
        }
        Value::Array(values) => values.iter().find_map(|value| find_string(value, keys)),
        _ => None,
    }
}

fn find_named_objects<'a>(
    value: &'a Value,
    key: &str,
    result: &mut Vec<&'a serde_json::Map<String, Value>>,
) {
    match value {
        Value::Object(object) => {
            if let Some(candidate) = object.get(key).and_then(Value::as_object) {
                result.push(candidate);
            }
            for child in object.values() {
                find_named_objects(child, key, result);
            }
        }
        Value::Array(values) => {
            for child in values {
                find_named_objects(child, key, result);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use super::*;

    #[test]
    fn scans_codex_and_claude_with_bounded_titles_but_without_arbitrary_content() {
        let directory = tempfile::tempdir().unwrap();
        let codex_dir = directory.path().join(".codex/sessions");
        let claude_dir = directory.path().join(".claude/projects/test");
        fs::create_dir_all(&codex_dir).unwrap();
        fs::create_dir_all(&claude_dir).unwrap();
        let mut codex = File::create(codex_dir.join("codex-session.jsonl")).unwrap();
        writeln!(
            codex,
            "{}",
            json!({
                "type": "event_msg", "timestamp": "2026-01-01T00:00:00Z",
                "payload": { "type": "user_message", "message": "## My request for Codex:\nFix collector startup" }
            })
        )
        .unwrap();
        writeln!(
            codex,
            "{}",
            json!({
                "timestamp": "2026-01-01T00:00:00Z", "secret": "do not store",
                "payload": { "model": "gpt-5.6-sol", "total_token_usage": {
                    "input_tokens": 80, "output_tokens": 20, "cached_input_tokens": 10
                }}
            })
        )
        .unwrap();
        let mut claude = File::create(claude_dir.join("claude-session.jsonl")).unwrap();
        writeln!(
            claude,
            "{}",
            json!({
                "type": "user", "timestamp": "2026-01-01T00:00:00Z",
                "message": { "content": "Review trace failures" }
            })
        )
        .unwrap();
        writeln!(
            claude,
            "{}",
            json!({
                "timestamp": "2026-01-01T00:00:00Z", "message": {
                    "model": "claude-sonnet", "usage": { "input_tokens": 30, "output_tokens": 10 }
                }
            })
        )
        .unwrap();
        let result = scan_with_pricing(directory.path(), PricingCatalog::built_in(), true);
        assert_eq!(result["rows"].as_array().unwrap().len(), 2);
        assert_eq!(result["rows"][0]["totalTokens"], 110);
        assert_eq!(result["rows"][0]["title"], "Fix collector startup");
        assert_eq!(result["rows"][1]["title"], "Review trace failures");
        assert_close(result["rows"][0]["costUsd"].as_f64(), 0.001_005);
        assert!(!result.to_string().contains("do not store"));

        let metadata = scan_with_pricing(directory.path(), PricingCatalog::built_in(), false);
        assert!(
            metadata["rows"]
                .as_array()
                .unwrap()
                .iter()
                .all(|row| row.get("title").is_none())
        );
    }

    #[test]
    fn matches_web_scan_pricing_without_double_counting_reasoning() {
        let usage = Usage {
            input: 749_641,
            output: 106_336,
            cache_read: 43_577_088,
            cache_write: 0,
            reasoning: 39_514,
        };
        let catalog = PricingCatalog::built_in();

        assert_close(
            catalog
                .get("gpt-5.6-sol")
                .map(|pricing| pricing.cost_usd(&usage)),
            28.726_829,
        );
    }

    #[test]
    fn configured_exact_price_overrides_the_built_in_catalog() {
        let mut catalog = PricingCatalog::built_in();
        catalog.apply_overrides(
            r#"{"gpt-5.6-sol":{"provider":"openai","input":2,"output":4,"cachedInput":1,"cacheWrite5m":9}}"#,
        );
        let usage = Usage {
            input: 100,
            output: 20,
            cache_read: 60,
            cache_write: 40,
            ..Usage::default()
        };

        assert_close(
            catalog
                .get("GPT-5.6-SOL")
                .map(|pricing| pricing.cost_usd(&usage)),
            0.000_42,
        );
    }

    fn assert_close(actual: Option<f64>, expected: f64) {
        assert!(actual.is_some_and(|value| (value - expected).abs() < 0.000_000_1));
    }
}
