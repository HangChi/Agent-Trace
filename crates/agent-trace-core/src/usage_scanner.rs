use std::{
    fs::{self, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};

const MAX_FILES: usize = 5_000;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

pub(crate) fn scan(home: &Path) -> Value {
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
        rows.extend(codex_files.iter().filter_map(|path| scan_codex(path)));
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
        rows.extend(claude_files.iter().filter_map(|path| scan_claude(path)));
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

fn scan_codex(path: &Path) -> Option<Value> {
    let mut latest_usage = Usage::default();
    let mut model = String::new();
    let mut first = None::<String>;
    let mut last = None::<String>;
    let mut messages = 0_i64;
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
    }
    usage_row(
        "codex",
        path,
        model,
        "openai",
        latest_usage,
        messages,
        (first, last),
    )
}

fn scan_claude(path: &Path) -> Option<Value> {
    let mut usage = Usage::default();
    let mut model = String::new();
    let mut first = None::<String>;
    let mut last = None::<String>;
    let mut messages = 0_i64;
    for value in json_lines(path) {
        update_timestamps(&value, &mut first, &mut last);
        if let Some(message) = value.get("message") {
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
        "claude",
        path,
        model,
        "anthropic",
        usage,
        messages,
        (first, last),
    )
}

fn usage_row(
    client: &str,
    path: &Path,
    model: String,
    provider: &str,
    usage: Usage,
    messages: i64,
    timestamps: (Option<String>, Option<String>),
) -> Option<Value> {
    let total = usage.total();
    if total <= 0 {
        return None;
    }
    Some(json!({
        "client": client,
        "sessionId": path.file_stem().and_then(|value| value.to_str()).unwrap_or("usage"),
        "model": model, "provider": provider,
        "inputTokens": usage.input, "outputTokens": usage.output,
        "cacheReadTokens": usage.cache_read, "cacheWriteTokens": usage.cache_write,
        "reasoningTokens": usage.reasoning, "totalTokens": total,
        "messageCount": messages, "startedAt": timestamps.0, "lastUsedAt": timestamps.1,
    }))
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
    fn scans_codex_and_claude_without_prompt_content() {
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
                "timestamp": "2026-01-01T00:00:00Z", "secret": "do not store",
                "payload": { "model": "gpt-5", "total_token_usage": {
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
                "timestamp": "2026-01-01T00:00:00Z", "message": {
                    "model": "claude-sonnet", "usage": { "input_tokens": 30, "output_tokens": 10 }
                }
            })
        )
        .unwrap();
        let result = scan(directory.path());
        assert_eq!(result["rows"].as_array().unwrap().len(), 2);
        assert_eq!(result["rows"][0]["totalTokens"], 110);
        assert!(!result.to_string().contains("do not store"));
    }
}
