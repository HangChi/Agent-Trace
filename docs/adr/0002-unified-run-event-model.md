# ADR-0002：统一 Run/Event 模型

- 状态：Accepted
- 日期：2026-06-16

## Context

SDK、Codex Hook、Claude Code Hook、Codex OTel 和 Transcript 的源格式不同，但 Dashboard 需要统一显示状态、时间线、工具、模型、错误和父子调用关系。

## Decision

- 所有运行过程以 Run 表示，内部动作以 Event 表示。
- Event 通过可选 `parentId` 表达调用关系；不对父引用设置数据库外键。
- 共享 Zod Schema 是写入契约；Dashboard 类型允许读取历史未知状态或类型。
- 来源特有信息放入 metadata，同时保留 `agent`、`surface`、`sessionId`、`category` 等共同字段。

## Consequences

- 多来源可以复用 Collector、存储与 Dashboard。
- Normalizer 必须准确维护来源语义、脱敏和 Token 可信度。
- 异常父引用、孤立节点和循环必须在读模型中容错，不能丢弃 Event。

## Alternatives considered

- 每个来源独立表和页面：查询与展示重复，跨来源分析困难。
- 强制父 Event 外键：乱序接入和不完整上游数据会导致写入失败。
