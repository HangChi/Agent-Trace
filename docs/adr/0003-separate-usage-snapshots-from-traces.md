# ADR-0003：Usage Snapshot 与 Trace Event 分离

- 状态：Accepted
- 日期：2026-07-13

## Context

`tokscale` 产生会话级聚合，而 Hook/OTel 产生动作级 Event。把扫描聚合伪装成 Trace Event 会造成重复 Token、空 Run 和删除/替换语义混乱。

## Decision

- Usage Snapshot 存入独立 `usage_sessions` 表，以客户端、会话、模型和 Provider 为复合键。
- 完整扫描只替换本次明确协调的客户端数据。
- 与真实 Run 匹配的 Snapshot 在读模型中增强 Token 和成本摘要，不创建占位 Event。
- Transcript Event 仍属于 Run/Event，但通过来源元数据与实时 Hook/OTel Event 区分。

## Consequences

- Token/成本聚合拥有明确权威来源，避免重复相加。
- Read Model 需要合并 runs、events 与 usage_sessions。
- Scanner 状态需要独立存储和查询入口。

## Alternatives considered

- 所有扫描结果写成 Event：实现简单，但会污染 Trace 并破坏替换语义。
- 只在前端读取 `tokscale`：无法与 Run 关联，也不利于桌面离线展示。
