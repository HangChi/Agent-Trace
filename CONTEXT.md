# Agent-Trace 领域词汇表

本文件定义代码、文档、Issue 和架构讨论中使用的领域语言。新增概念前应先检查是否已有对应术语；改变已有术语含义时，应同步修改需求、架构、Schema 和相关 ADR。

## 产品概念

### Agent-Trace

本地优先的 AI Agent 运行观测工具。默认在单机完成采集、存储、查询和展示。

### Run

一次 Agent 执行或一段被统一表示为执行过程的本地会话。Run 拥有唯一 `id`、名称、状态、开始时间和可选结束时间，并可包含多个 Event。

### Event

Run 内的一个可观察动作，例如生命周期、模型调用、工具调用、检索、记忆更新或错误。Event 可通过 `parentId` 形成父子调用关系；异常、孤立或循环引用仍应保留。

### Tracked Run

至少包含一个可展示追踪动作的 Run。Dashboard 默认只列出 Tracked Run，避免只有空壳元数据的记录干扰调试。

### Untracked Run

当前没有可展示追踪动作的 Run。查询时可使用 `includeUntracked` 显式包含。

### Trace

一个 Run 及其 Event、父子关系、用量、错误和诊断信息的整体视图。

### Trace Insight

由确定性规则从 Trace 中得到的诊断，例如重复动作、重试循环、慢步骤、Token 热点和失败级联。Insight 必须包含可解释证据，并可定位到关联 Event。

## 采集概念

### Collector

接收 HTTP 写入、规范化来源数据并持久化到 SQLite 的本地 Hono 进程。Collector 默认监听回环地址且没有认证。

### TypeScript SDK

由 Agent 代码显式调用的埋点入口。SDK 创建 Run、包装 LLM/工具调用并更新最终状态；投递失败不得改变被观测代码的业务语义。

### Tracing Hook

安装到 Codex 或 Claude Code 用户配置中的生命周期命令。Hook 只提交受控元数据，失败或超时不得阻塞上游 Agent。

### OTel Ingestion

Collector 接收 Codex OTLP/HTTP JSON 日志并转换为 Run/Event 的过程，主要补充模型和官方 Token 遥测。

### Usage Scanner

CLI 周期或单次调用 `tokscale`，协调客户端历史并向 Collector 提交 Usage Snapshot 和可选 Transcript Event 的过程。

### Usage Snapshot

以客户端、会话、模型和 Provider 为键的 Token、成本、消息数和时间聚合。它是会话级读模型数据，不是普通 Trace Event。

### Transcript Event

从支持的本地会话历史中提取的 Prompt/Turn 记录。`preview` 模式可保存清理后的短预览；`metadata` 模式不保存 Prompt 文本。

### Surface

同一 Agent 的使用界面，例如 `cli` 或 `desktop`。Surface 用于区分数据来源，不表示独立用户身份。

### Redaction

写入前限制敏感内容的策略。Hooks 当前固定使用 `metadata`；SDK 输入输出由调用方负责脱敏。

## 展示与存储概念

### Dashboard

通过 Collector 读接口展示 Run、Event、Usage、Scanner 状态和诊断的 Next.js 界面。Dashboard 不直接访问 SQLite。

### Read Model

Collector 为 Dashboard 生成的有界查询结果，包括分页、筛选、汇总、Facet 和 Trace Insight。共享 Schema 中的 Dashboard 类型是其 Interface。

### Run Organization

用于长期整理 Run 的项目、环境、版本、标签、备注和收藏状态。组织字段属于 Run metadata，不改变来源、状态或 Event 拓扑；用户可通过 Dashboard 显式编辑。

### Privacy Settings

保存在本地 SQLite settings 表中的写入前字段脱敏配置，包括不区分大小写的敏感字段名和替换文本。配置只作用于后续写入，不追溯修改已有数据。

### Redacted Export

用于分享或提交诊断材料的单 Run JSON 快照。它保留状态、时间、调用结构、Token、成本和安全元数据；Run/Event ID 使用稳定化名，Prompt、输入输出、命令、路径、会话 ID 与错误正文不进入导出文件。当前唯一脱敏级别为 `metadata`。

### Run Comparison

对 2–5 个 Run 的状态、耗时、Event 数、失败 Event 数、Token 和成本进行并排比较的有界 Read Model。输入顺序决定展示顺序，第一个 Run 是 Dashboard 中的比较基准。

### Run Trend

按 UTC 自然日聚合 Run 数、成功/失败数、平均耗时、Token 和成本的有界 Read Model。Dashboard 默认展示最近 14 天，Collector 最大接受 90 天窗口，并补齐没有 Run 的日期。

### Legacy Read

通过 `legacy=1|true` 返回旧版不分页数组的兼容查询。仅用于旧客户端和兼容测试，新调用方应使用默认分页 Read Model。

### Run Tombstone

用户删除 Run 后保留的持久忽略记录。Tombstone 不删除上游历史，但会阻止 Hook、OTel 和 Transcript Scanner 重新生成同 ID Run；只能通过显式恢复 Interface 解除。

### Change Feed

Collector 发布的进程内 SSE 变更流。它通知 Dashboard Run、Event、Usage 或维护状态已变化，不携带完整业务对象。

### Source Kind

Token 用量的可信度分类：

- `official`：来自受信 Provider 或 OTel 结构。
- `scan`：来自本地会话扫描。
- `estimate`：缺少官方数据时的本地估算。

### API-equivalent Cost

根据扫描结果或精确模型价格计算的 API 等价成本。它不代表订阅产品的实际账单或扣费证明。

## 状态与不变量

- Run/Event 状态为 `running`、`success` 或 `error`。
- SDK、Hook、OTel 和 Scanner 的观测故障不得改变上游 Agent 结果。
- 完整 Usage Snapshot 只替换本次明确协调的客户端数据。
- 删除 Agent-Trace 中的 Run 不会删除上游客户端源历史；Run Tombstone 阻止后续扫描重新生成，直到用户显式解除。
- Collector 没有认证，非回环部署必须由调用方提供网络隔离和访问控制。
