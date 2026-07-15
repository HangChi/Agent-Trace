# 架构决策记录

ADR 记录长期有效、会影响后续设计选择的决定。状态使用 `Proposed`、`Accepted`、`Superseded` 或 `Rejected`；新 ADR 不回写旧 ADR 的历史，只通过链接声明替代关系。

| ADR | 状态 | 决策 |
| --- | --- | --- |
| [0001](0001-local-first-loopback-collector.md) | Accepted | 本地优先、回环 Collector、无内置认证 |
| [0002](0002-unified-run-event-model.md) | Accepted | 使用统一 Run/Event 模型承接多来源 |
| [0003](0003-separate-usage-snapshots-from-traces.md) | Accepted | Usage Snapshot 与 Trace Event 分离 |
| [0004](0004-bounded-dashboard-read-model.md) | Accepted | Dashboard 默认使用有界分页 Read Model |

## 新增 ADR

复制以下结构：

```markdown
# ADR-NNNN：标题

- 状态：Proposed
- 日期：YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives considered
```
