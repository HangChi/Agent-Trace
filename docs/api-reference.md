# Agent-Trace API 参考

机器可读契约见 [OpenAPI 3.1](openapi.yaml)。本文提供行为语义、兼容说明和人工可读示例；路由表与 OpenAPI 由 `pnpm docs:check` 对照 `apps/server/src/app.ts` 校验。

## 基础信息

- 默认地址：`http://127.0.0.1:4319`
- 数据格式：JSON
- 写入请求：`Content-Type: application/json`
- 认证：无
- 默认监听：回环地址；不应直接公开到不可信网络
- API 版本：当前没有统一 URL 版本前缀；`/v1/logs` 仅是 OTLP 兼容入口
- Rate limit：无内置限流

Collector 只为来源为 `localhost` 或 `127.0.0.1` 的 HTTP/HTTPS 页面返回 CORS 允许头。非浏览器客户端不受 CORS 保护，仍需依赖网络边界。

## 路由总览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/changes` | SSE 数据变更通知 |
| POST | `/runs` | 创建 Run |
| PATCH | `/runs/:id` | 更新 Run |
| POST | `/events` | 创建 Event |
| POST | `/integrations/codex/hook` | 接收 Codex Hook |
| POST | `/integrations/claude-code/hook` | 接收 Claude Code Hook |
| POST | `/integrations/codex/otel/v1/logs` | 接收 Codex OTLP/HTTP JSON 日志 |
| POST | `/v1/logs` | 桌面端默认 Codex OTel 兼容入口 |
| POST | `/integrations/usage-scan` | 接收 usage 与 transcript snapshot |
| GET | `/usage/summary` | 查询本地用量汇总 |
| GET | `/usage/scanner` | 查询 Scanner 状态 |
| GET | `/runs` | 查询 Run 列表或分页读模型 |
| DELETE | `/runs` | 批量删除 Run |
| GET | `/runs/:id` | 查询单个 Run |
| GET | `/runs/:id/export` | 下载单个 Run 的脱敏 JSON |
| GET | `/runs/:id/events` | 查询 Run 的 Event |
| GET | `/runs/:id/insights` | 查询完整 Trace 的确定性诊断 |
| GET | `/analytics/runs/compare` | 对比 2–5 个 Run |
| GET | `/analytics/runs/trends` | 查询按日 Run 趋势 |
| DELETE | `/runs/:id` | 删除单个 Run |
| DELETE | `/runs/:id/tombstone` | 解除删除墓碑，允许同 ID 再次采集 |
| GET | `/maintenance/storage` | 查询数据库容量与行数 |
| POST | `/maintenance/prune` | 按日期和状态执行保留期清理 |
| POST | `/maintenance/compact` | WAL checkpoint 并压缩 SQLite |

## 通用约定

### 请求与响应

- 写入 JSON 时设置 `Content-Type: application/json`。
- 时间字段使用 ISO 8601 datetime，例如 `2026-07-15T08:00:00.000Z`。
- 未特别说明的成功响应均为 JSON。
- Collector 不设置业务 Rate Limit 头。

### 错误格式

校验和查询错误使用：

```json
{
  "error": "machine_readable_code"
}
```

Schema 校验失败还可能包含 `issues` 数组。常见状态：

| 状态 | 含义 |
| --- | --- |
| `400` | JSON 或 Schema 无效、分页/删除参数不合法 |
| `404` | 指定 Run 不存在 |
| `409` | Run ID 存在删除墓碑；需先显式解除墓碑 |
| `202` | Hook、OTel、Usage 接入请求已处理；应检查 `stored` 与 `error` 判断是否真正存储 |

Hooks、OTel 和 Usage 接入故意在规范化失败时保持 `202`，避免观测链路阻塞上游 Agent。

### 快速请求

```bash
curl http://127.0.0.1:4319/health
curl "http://127.0.0.1:4319/runs?page=1&pageSize=20"
```

```ts
const response = await fetch(
  "http://127.0.0.1:4319/runs?page=1&pageSize=20"
);

if (!response.ok) {
  throw new Error(`Collector returned ${response.status}`);
}

const page = await response.json();
```

## 共享枚举

### TraceStatus

```text
running | success | error
```

### TraceEventType

```text
run_started | run_ended | step_started | step_ended | llm_call
tool_call | retrieval | memory_update | error
```

## 健康检查

### `GET /health`

响应 `200`：

```json
{
  "ok": true,
  "service": "agent-trace"
}
```

## Run 写入

### `POST /runs`

请求：

```json
{
  "id": "run_123",
  "name": "research-agent",
  "status": "running",
  "startedAt": "2026-07-14T08:00:00.000Z",
  "input": { "task": "Research MCP" },
  "metadata": {
    "agent": "custom",
    "provider": "openai",
    "model": "gpt-4.1"
  }
}
```

字段规则：

- `id`、`name` 为非空字符串。
- `status` 可省略，默认 `running`。
- `startedAt` 可省略；存在时必须是 ISO datetime。
- `input` 和 `metadata` 可省略。

成功响应 `201`：

```json
{ "ok": true }
```

校验失败响应 `400`：

```json
{
  "error": "invalid_run",
  "issues": []
}
```

### `PATCH /runs/:id`

请求：

```json
{
  "status": "success",
  "endedAt": "2026-07-14T08:01:00.000Z",
  "output": { "result": "done" }
}
```

- `status` 必填。
- `endedAt` 可为 ISO datetime、`null` 或省略。
- `output`、`error` 可省略。

成功响应 `200`：`{ "ok": true }`。校验失败返回 `400`，错误码为 `invalid_run_update`。

## Event 写入

### `POST /events`

请求：

```json
{
  "id": "evt_123",
  "runId": "run_123",
  "parentId": "evt_parent",
  "type": "tool_call",
  "name": "web_search",
  "status": "success",
  "timestamp": "2026-07-14T08:00:30.000Z",
  "durationMs": 420,
  "input": { "query": "MCP" },
  "output": { "count": 3 },
  "metadata": {
    "toolName": "web_search",
    "category": "tool"
  }
}
```

- `id`、`runId`、`type`、`name`、`status` 必填。
- `timestamp` 可省略；存在时必须是 ISO datetime。
- `durationMs` 必须是非负整数。
- `error` 的结构为 `{ message, stack?, code? }`。

成功响应 `201`：`{ "ok": true }`。校验失败返回 `400`，错误码为 `invalid_trace_event`。

## 集成写入

### Hooks

```text
POST /integrations/codex/hook
POST /integrations/claude-code/hook
```

可选查询参数：

- `surface`
- `surface_source` 或 `surfaceSource`

CLI 安装的 Hook 还会附加 `redaction=metadata`。请求体是对应工具产生的 Hook JSON。

Collector 无论是否成功规范化都返回 `202`：

```json
{
  "ok": true,
  "eventId": "evt_123",
  "runId": "run_123"
}
```

失败示例：

```json
{
  "ok": true,
  "stored": false,
  "error": "Unsupported hook payload"
}
```

### Codex OTel

```text
POST /integrations/codex/otel/v1/logs
POST /v1/logs
```

接收 OTLP/HTTP JSON 日志结构。第一个入口接受 `surface` 与 `surface_source` 查询提示；`/v1/logs` 在未提供提示时默认标记为 desktop。

响应始终为 `202`。成功时 `stored` 为写入数量；失败时 `stored` 为 `0` 并包含 `error`。

### Usage scan

`POST /integrations/usage-scan`

CLI 提交的主体：

```json
{
  "source": "tokscale",
  "complete": true,
  "explicitClients": ["codex"],
  "reconciledClients": ["codex"],
  "transcriptClients": ["codex"],
  "transcriptSessionIds": ["codex:session-1"],
  "scannedAt": "2026-07-14T08:00:00.000Z",
  "rows": [
    {
      "client": "codex",
      "sessionId": "session-1",
      "model": "gpt-5",
      "provider": "openai",
      "inputTokens": 100,
      "outputTokens": 40,
      "cacheReadTokens": 20,
      "cacheWriteTokens": 0,
      "reasoningTokens": 10,
      "totalTokens": 160,
      "costUsd": 0.01,
      "messageCount": 4,
      "startedAt": "2026-07-14T07:50:00.000Z",
      "lastUsedAt": "2026-07-14T08:00:00.000Z"
    }
  ],
  "diagnostics": [],
  "transcripts": []
}
```

要求：

- `source` 必须是 `tokscale`。
- `rows` 必须是数组。
- `complete=false` 时不会清理旧的客户端快照。
- `reconciledClients` 控制哪些客户端的旧 usage 行可被替换。
- 只有总 Token 或成本为正的行会被保留。

响应始终为 `202`。成功字段包括 `stored`、`transcripts` 和 `reconciledClients`；失败时 `stored: 0` 并包含 `error`。

## 用量查询

### `GET /usage/summary`

响应 `200`：

```json
{
  "totalTokens": 160,
  "costUsd": 0.01,
  "clients": [
    { "client": "codex", "totalTokens": 160, "costUsd": 0.01 }
  ],
  "models": [
    { "model": "gpt-5", "provider": "openai", "totalTokens": 160, "costUsd": 0.01 }
  ]
}
```

### `GET /usage/scanner`

响应 `200`：

```json
{
  "scannedAt": "2026-07-14T08:00:00.000Z",
  "diagnostics": [
    {
      "client": "cursor",
      "status": "needs_sync",
      "pathExists": true,
      "actionHint": "Run tokscale cursor login, then tokscale cursor sync --json"
    }
  ]
}
```

`scannedAt` 和 `error` 可省略，`diagnostics` 始终为数组。

## Run 查询与删除

### `GET /runs`

查询参数：

| 参数 | 说明 |
| --- | --- |
| `includeUntracked=1|true` | 包含没有可见追踪活动的 Run。 |
| `page` | 页码，最小 1。 |
| `pageSize` | 默认 50，最小 1，最大 200。 |
| `q` | 按 Run 名称、ID、会话、来源或模型搜索。 |
| `status` | `running` / `success` / `error`；`all` 表示不限制。 |
| `source` | 精确匹配 agent、surface 或采集来源。 |
| `model` | 匹配 Run、Event 或 usage snapshot 中的模型。 |
| `startedAfter` / `startedBefore` | ISO 8601 日期或时间范围。 |
| `minCostUsd` / `maxCostUsd` | 按 API 等价美元成本范围筛选。 |
| `sort` | `startedAt` / `name` / `status` / `duration` / `tokens` / `cost`。 |
| `order` | `asc` 或 `desc`，默认 `desc`。 |
| `legacy=1|true` | 兼容旧客户端，返回不分页的 `DashboardRun[]`。 |

默认返回有界分页响应：

```json
{
  "runs": [],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 0,
    "totalPages": 1
  },
  "summary": {
    "totalRuns": 0,
    "runningRuns": 0,
    "failedRuns": 0,
    "agents": []
  }
}
```

### `GET /runs/:id`

返回单个 `DashboardRun`，包含 Run 的 input、output、error、metadata 和聚合 summary。Run 不存在时返回 `404`：`{ "error": "run_not_found" }`。

```bash
curl "http://127.0.0.1:4319/runs/run_123"
```

### `GET /runs/:id/export`

下载 `application/json` 脱敏快照，响应带 `Content-Disposition: attachment`。导出保留状态、时间、Event 拓扑、耗时、Token、成本以及 agent/model/tool 等安全元数据；Run/Event ID 使用稳定 SHA-256 截断化名。Run 名称、Prompt、input/output、命令、路径、会话 ID、错误正文和堆栈不导出。

Run 不存在时返回 `404`：`{ "error": "run_not_found" }`。

### Run 对比与趋势

- `GET /analytics/runs/compare?ids=run_1,run_2`：接受 2–5 个去重后的 Run ID，按请求顺序返回状态、开始时间、耗时、Event 数、失败 Event 数、Token 和成本。数量不合法时返回 `400`。
- `GET /analytics/runs/trends?days=14`：按 UTC 自然日返回连续趋势点；`days` 默认 14、最小 1、最大 90。每个趋势点包含 Run 数、成功/失败数、平均耗时、Token 和成本。

### `DELETE /runs`

请求：

```json
{ "ids": ["run_1", "run_2"] }
```

成功响应 `200`：

```json
{ "ok": true, "deleted": 2 }
```

`ids` 不是字符串数组或包含空字符串时返回 `400`：`{ "error": "invalid_run_ids" }`。

### `DELETE /runs/:id`

成功响应 `200`：`{ "ok": true }`。Run 不存在时返回 `404`：`{ "error": "run_not_found" }`。删除同时写入墓碑，Hook、OTel 和 Transcript Scanner 不会重建该 Run。如需重新采集，调用 `DELETE /runs/:id/tombstone`。

### 数据保留与容量

- `GET /maintenance/storage` 返回数据库路径、字节数以及 Run、Event、Usage Session、墓碑行数。
- `POST /maintenance/prune` 请求例：`{ "before": "2026-01-01T00:00:00Z", "statuses": ["success", "error"], "keepTombstones": true }`。
- `POST /maintenance/compact` 执行 WAL checkpoint 和 `VACUUM`；建议在本地低流量时调用。

### `GET /changes`

返回 `text/event-stream`。首帧为 `ready`，后续 Run、Event、Usage 或维护变更会发送 `change` 事件。Dashboard 仅在收到变更时刷新；SSE 不可用时退化为 15 秒轮询。

## Event 查询

`GET /runs/:id/insights` 单独返回完整 Run 的确定性诊断。Event 分页不再为每个页面请求扫描全部 Event。

### `GET /runs/:id/events`

默认返回分页读模型。传入 `legacy=1|true` 时返回按时间升序排列、不分页的 `DashboardTraceEvent[]`。

| 参数 | 说明 |
| --- | --- |
| `visibility` | `display`（默认）、`hidden` 或 `all`。 |
| `page` | 页码，最小 1。 |
| `pageSize` | 默认 100，最小 1，最大 500。 |
| `q` | 匹配事件可搜索文本。 |
| `status` | 状态筛选；`all` 表示不限制。 |
| `type` | 事件类型筛选；`all` 表示不限制。 |
| `category` | command/tool/mcp/skill/tokens/lifecycle 等类别；`all` 表示不限制。 |
| `legacy` | `1` 或 `true` 时返回旧版不分页数组。 |

分页响应包含：

- `events`：当前页事件。
- `counts`：total、display、hidden、matching。
- `facets`：可用 types 与 categories。
- `pagination`：页码、页大小、总数和总页数。
- `summary`：总 Token、总耗时、失败数、来源元数据、错误事件和诊断。
- `visibility`：实际采用的可见性。

> [!CAUTION]
> `legacy=1|true` 返回无界数组，只用于旧客户端迁移和兼容验证。新调用方应使用默认分页响应。

## TokenUsage

```ts
type TokenUsage = {
  input: number;
  output: number;
  total: number;
  cachedInput?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
  reasoningOutput?: number;
  estimated?: boolean;
  method?: string;
  source?: string;
  sourceKind?: "official" | "scan" | "estimate";
  scope?: "event" | "session";
};
```

所有 Token 数必须为非负整数。
