# ADR-0005：Run Tombstone 与本地数据维护

- 状态：Accepted
- 日期：2026-07-15

## Context

用户删除 Run 后，上游 Codex、Claude Code 或其他客户端历史仍然存在。Transcript Scanner 的替换语义会再次发现该会话，如果仅删除 runs/events，用户的删除意图会被覆盖。本地历史还需要可观测的容量与保留期清理流程。

## Decision

- 删除 Run 时写入 `run_tombstones`，再删除 Run 和 Event。
- Hook、OTel 和 Transcript Scanner 在创建 Run 前查询 Tombstone；命中时静默忽略该 Trace。
- 显式恢复 Interface 删除 Tombstone，之后才允许同 ID Run 再次采集。
- 提供容量计数、按日期/状态清理和 SQLite 压缩 Interface；保留期清理默认保留 Tombstone。

## Consequences

- 删除意图跨 Scanner 周期持久有效，数据不会意外“复活”。
- Tombstone 数量会增长，但每条只保存 ID、时间和原因；用户可显式恢复。
- 完全遗忘需要停止 Collector 并删除整个 SQLite/WAL/SHM，因为 Tombstone 本身也是本地数据。

## Alternatives considered

- 只删除 runs/events：会被 Scanner 重建，违反用户意图。
- 删除上游历史：超出 Agent-Trace 的所有权和安全范围。
- 全局禁用 Scanner：会丢失其他会话的 Usage 和 Transcript 能力。
