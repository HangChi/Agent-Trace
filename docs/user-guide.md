# Agent-Trace 用户手册

## 使用方式

Agent-Trace 可以通过三条路径产生数据：

1. 自定义 Agent 使用 `@agent-trace/sdk` 主动上报。
2. Codex 或 Claude Code 使用全局 Hooks，Codex 还可使用 OTel。
3. CLI 使用 `tokscale` 扫描本机 AI 编程客户端的用量与会话历史。

这些数据都写入本地 Collector，再由 Dashboard 读取。

## 从源码启动

准备 Node.js `>=22.12.0` 和 pnpm `>=11.0.7 <12` 后执行；使用 Node 版本管理器时可读取仓库 `.nvmrc`：

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

`dev` 命令完成以下操作：

- 初始化 SQLite 数据库。
- 在 `127.0.0.1:4319` 启动 Collector。
- 在 `localhost:3000` 启动 Dashboard。
- 默认启动本地 usage watcher，每 15 秒扫描一次。

打开 <http://localhost:3000/runs>。如不希望扫描本地历史：

```bash
node packages/cli/dist/index.js dev --usage-scan=false
```

### CLI 命令总览

构建后的包声明 `agent-trace` 可执行入口。仓库内可将下列 `agent-trace` 替换为 `node packages/cli/dist/index.js`：

| 命令 | 用途 |
| --- | --- |
| `agent-trace dev` | 启动 Collector、Dashboard 和默认 usage watcher。 |
| `agent-trace usage --once` | 执行一次本地用量扫描。 |
| `agent-trace usage --watch` | 按间隔持续扫描。 |
| `agent-trace usage clients` | 查看 `tokscale` 客户端诊断。 |
| `agent-trace usage sync` | 同步支持的客户端缓存。 |
| `agent-trace install codex` | 安装 Codex Hooks 与 OTel 配置。 |
| `agent-trace install claude-code` | 安装 Claude Code Hooks。 |
| `agent-trace uninstall codex` | 移除 Agent-Trace 管理的 Codex Hooks。 |
| `agent-trace uninstall claude-code` | 移除 Agent-Trace 管理的 Claude Code Hooks。 |

`dev` 参数：

| 参数 | 含义 | 默认值 |
| --- | --- | --- |
| `--usage-scan <boolean>` | 启用或禁用本地 Scanner。 | 启用 |
| `--usage-sync` | 每个扫描周期前执行支持的同步。 | 关闭 |
| `--usage-clients <csv>` | 限制 Scanner 客户端。 | 自动发现 |
| `--usage-home <path>` | 指定 `tokscale` 用户目录。 | 当前用户 home |
| `--history-content <mode>` | `preview` 或 `metadata`。 | `preview` |
| `--usage-interval-ms <ms>` | 扫描周期，正整数。 | `15000` |

`usage` 参数：

| 参数 | 含义 | 默认值 |
| --- | --- | --- |
| `--once` | 执行一次扫描。 | 默认行为 |
| `--watch` | 按周期持续扫描。 | 关闭 |
| `--sync` | 扫描前执行支持的同步。 | 关闭 |
| `--json` | `clients`/`sync` 子命令输出 JSON。 | 关闭 |
| `--interval-ms <ms>` | watch 周期，最小按 1000 ms 归一化。 | `15000` |
| `--clients <csv>` | 限制客户端；`sync` 时为目标列表。 | 扫描时自动发现；同步时使用支持列表 |
| `--home <path>` | `tokscale` 与本地历史使用的用户目录。 | 当前用户 home |
| `--history-content <mode>` | `preview` 或 `metadata`。 | `preview` |
| `--collector-url <url>` | Collector 基础地址。 | `http://localhost:4319` |
| `--timeout-ms <ms>` | `tokscale` 命令超时。 | `60000` |

`install` 参数为 `--scope user`、`--redaction metadata`、Codex 专用的 `--surface cli|desktop`，以及 `--collector-url <url>`。`uninstall` 只接受目标名称，没有其他业务参数。

运行示例 Agent：

```bash
pnpm --filter simple-agent dev
```

生成失败示例：

```bash
AGENT_TRACE_EXAMPLE_FAIL=1 pnpm --filter simple-agent dev
```

Windows PowerShell：

```powershell
$env:AGENT_TRACE_EXAMPLE_FAIL = "1"
pnpm --filter simple-agent dev
```

## 使用 Dashboard

### Run 列表

列表页展示 Run 名称、状态、来源、开始时间、模型、Token、耗时和成本。页面支持：

- 分页浏览和手动刷新。
- 使用搜索、状态、来源、模型和起止日期筛选；点击 Tokens、成本或耗时表头按“降序 → 升序 → 默认排序”循环，开始时间按“升序 → 默认排序（开始时间降序）”循环。
- 选择一个或多个 Run。
- 选择 2–5 个 Run，以第一个为基准比较状态、耗时、Event、Token 和成本。
- 单个删除和批量删除。
- 查看最近 14 天的运行量、成功率、平均耗时、Token 和成本趋势。
- 查看 Scanner 最近状态与客户端诊断。
- 切换中文/英文和明暗主题。

删除操作会永久删除本地数据库中的 Run 及其 Event，不会删除 Codex、Claude Code 或其他客户端的源历史文件；后续历史扫描可能再次生成对应的会话展示数据。

### Run 详情

详情页提供：

- Run 状态、来源、模型、Token、总耗时和错误摘要。
- 按关键词、状态、事件类型、类别和显示/隐藏范围筛选。
- 时间线与父子调用树两种视图。
- Command、Tool、MCP、Skill 和 Token 分类信息。
- 重复动作、重试循环、慢步骤、Token 热点、失败级联和错误建议。
- 从自动诊断直接定位到关联事件；存在多个关联事件时，可展开位置列表并选择任一位置。
- 下载单个 Run 的脱敏 JSON；导出不会包含 Prompt、输入输出、命令、路径、会话 ID 或错误正文。
- 编辑项目、环境、版本、标签、备注与收藏状态；这些字段保存在 Run metadata 中，不改变采集来源。

调用树会保留孤立节点和循环引用中的事件，避免因异常父子关系丢失数据。

点击诊断中的“定位”后，详情页会临时使用事件 ID 精确筛选，并将可见范围切换为“全部”，因此目标不会被当前分页、筛选条件或隐藏状态遮挡。目标事件会滚动到工作区中央并高亮；查看完成后点击查询栏中的“清除”即可恢复完整轨迹。

### 维护与隐私

从顶部“维护”进入控制中心，可以查看数据库体积和 Run/Event/Usage/墓碑数量，按日期与状态清理历史、执行 SQLite 压缩、恢复删除墓碑，以及配置写入前字段脱敏。

敏感字段名支持逗号或换行分隔，不区分大小写。规则保存后只作用于后续 Run、Event 和 Transcript 写入；不会追溯修改现有记录。清理与压缩属于本地数据操作，执行前应先备份数据库及对应 WAL/SHM 文件。

## 分析、预算与评测

顶部“分析”页面按项目、环境、模型或来源查看最近 30 天的 Run 数、失败率、平均耗时、Token 与成本。预算支持 UTC 日/月周期，可同时设置成本、Token 和 Run 数上限；页面会实时列出当前超限项。

在 Run 列表选择 2–5 个 Run 进行对比时，第一个 Run 是基准。系统按 Event 类型、名称和出现次序匹配事件；新增失败、基准事件缺失、耗时或 Token 增长超过 20% 会标记为回归。

顶部“评测”页面可以创建带评分权重的评测集、添加输入/期望输出用例，并把已有 Run 记录为多维评分结果。同一用例与 Run 再次提交会更新原结果；质量分为 0–1 的加权平均值。

## 接入 Python SDK

```bash
pip install -e packages/sdk-python
```

```python
from agent_trace import AgentTraceClient
from agent_trace.integrations.openai import instrument_openai

client = AgentTraceClient()
with client.start_run("research-agent", metadata={"project": "demo"}) as run:
    with run.trace_step("retrieval", "load-documents"):
        documents = load_documents()
    openai_client = instrument_openai(openai_client, run)
```

`AgentTraceCallbackHandler(run)` 可直接放入 LangChain 的 `callbacks`。Python SDK 与 TypeScript SDK 一样采用有界超时和 fail-open 投递。通用 OTLP/HTTP JSON Exporter 可把 Trace 发到 `http://127.0.0.1:4319/v1/traces`。

## 接入 TypeScript SDK

先构建工作区包：

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/sdk build
```

示例：

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP ecosystem" },
  metadata: { project: "agent-trace", environment: "test", version: "0.4.0", tags: ["sdk"] },
  endpoint: "http://localhost:4319",
  deliveryTimeoutMs: 1000
});

try {
  const plan = await run.traceLLM(
    "planner",
    { prompt: "Research MCP ecosystem" },
    () => callLLM(),
    {
      provider: "openai",
      model: "gpt-4.1",
      tokenUsage: {
        input: 120,
        output: 40,
        total: 160,
        sourceKind: "official",
        scope: "event"
      }
    }
  );

  const results = await run.traceTool(
    "web_search",
    { query: "MCP ecosystem" },
    () => webSearch("MCP ecosystem")
  );

  await run.traceStep("retrieval", "load-documents", { query: "MCP ecosystem" }, async () => {
    await run.traceTool("read-document", { id: "doc-1" }, () => readDocument("doc-1"));
  });

  await run.end({ plan, results });
} catch (error) {
  await run.fail(error);
  throw error;
}
```

注意：

- `traceLLM` 的第四个参数是 `TraceMetadata`。
- `traceTool` 的第四个参数是包含 `parentId` 和 `metadata` 的选项对象。
- `traceStep` 接受共享 Schema 中的任意 Event 类型；嵌套 `traceStep`、`traceTool` 或 `traceLLM` 会自动使用当前 Event 作为父节点，显式 `parentId` 优先。
- SDK 会保存调用方传入的 input 和成功 output；不要传入不希望落盘的秘密。
- Collector 不可用或超时时，SDK 忽略投递错误；被包装函数本身的异常仍会重新抛出。

## 安装全局 Tracing Hooks

先构建 CLI：

```bash
pnpm --filter @agent-trace/cli build
```

安装 Codex CLI Hooks 与 OTel：

```bash
node packages/cli/dist/index.js install codex \
  --scope user \
  --redaction metadata \
  --surface cli
```

如果共享的 Codex 配置用于桌面端，使用：

```bash
node packages/cli/dist/index.js install codex --surface desktop
```

安装 Claude Code Hooks：

```bash
node packages/cli/dist/index.js install claude-code \
  --scope user \
  --redaction metadata
```

卸载：

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

安装与卸载规则：

- 仅支持用户级配置和 `metadata` 脱敏。
- 重复安装会替换 Agent-Trace 自己管理的条目。
- 从旧版本升级后重新运行 `install claude-code`，可替换可能包含 CMD 语法的旧 Hook；用户自定义 Hook 不受影响。
- 修改已有配置前创建 `.agent-trace-backup.<timestamp>` 备份。
- 卸载只移除带 Agent-Trace 标记的 Hook，不删除用户自定义条目。
- Codex 安装会更新 `~/.codex/config.toml` 的 `[otel]` 配置；安装后需重启 Codex。
- Codex CLI 与桌面端共享配置，最后一次 `--surface` 决定后续来源标记。

不运行真实 Agent 也可检查 Hook ingestion：

```bash
node examples/agent-hook-smoke.mjs
```

## 扫描本地用量与会话

单次扫描：

```bash
node packages/cli/dist/index.js usage --once --home C:\Users\alice
```

持续扫描：

```bash
node packages/cli/dist/index.js usage --watch \
  --interval-ms 15000 \
  --home C:\Users\alice
```

默认扫描 `tokscale` 当前识别并在本机存在的客户端。显式限制客户端：

```bash
node packages/cli/dist/index.js usage --once \
  --clients codex,claude,opencode \
  --home C:\Users\alice
```

查看客户端诊断：

```bash
node packages/cli/dist/index.js usage clients --home C:\Users\alice
node packages/cli/dist/index.js usage clients --home C:\Users\alice --json
```

同步需要登录或远程缓存的客户端：

```bash
node packages/cli/dist/index.js usage sync \
  --clients cursor,antigravity,trae,warp \
  --home C:\Users\alice
```

也可以在扫描前同步：

```bash
node packages/cli/dist/index.js usage --once --sync --home C:\Users\alice
```

### 历史内容模式

- `preview`：默认模式。Claude、Codex 和 OpenCode 的用户 Prompt 可保存清理后的最多 240 个字符预览，同时保存 Turn Token、工具名和时间。
- `metadata`：不保存 Prompt 文本，只保留时间、Token、工具和会话元数据。

使用纯元数据模式：

```bash
node packages/cli/dist/index.js usage --once \
  --history-content metadata \
  --home C:\Users\alice
```

## 常见问题

| 现象 | 检查与处理 |
| --- | --- |
| Dashboard 无法打开 | 源码模式确认 CLI 仍在运行并检查 3000 端口；Tauri 桌面 UI 不使用 Dashboard 端口，需检查应用窗口与 WebView2。 |
| Collector 启动失败 | 检查 4319 端口。源码模式会复用通过 `/health` 验证的现有 Agent-Trace Collector；其他程序占用时可关闭它或设置 `AGENT_TRACE_SERVER_PORT`。 |
| 看不到本地历史 | 运行 `usage clients --home <真实用户目录>`，根据 `actionHint` 登录或同步。 |
| 只看到近期 Hook 事件 | 确认 usage watcher 未被 `AGENT_TRACE_USAGE_SCAN=0` 禁用，并检查 Scanner 状态。 |
| 某模型显示未定价 | 桌面内置价目、扫描结果与 `AGENT_TRACE_MODEL_PRICES_JSON` 均没有该模型的精确条目。 |
| Codex Token 不完整 | 重新执行 `install codex`，重启 Codex，并确认 OTel endpoint 指向当前 Collector。 |
| Run 长期处于 running | Collector 每分钟检查一次；默认将超过 30 分钟且缺少活动的运行标记为 `error`。 |
| 干净工作区测试找不到 SDK | 先运行 `pnpm build`，再运行 `pnpm test`。 |

## 安全回放与调试沙箱

在 Run 详情点击“安全回放”，或从顶部“回放”进入控制台并填写源 Run ID。选择一个事件后，可以覆盖 JSON 输入、设置 Mock 输出、模拟错误与延迟，并配置 100–30000 毫秒超时。覆盖项留空时沿用源事件数据。

任务会经历排队、运行、完成、失败、取消或超时状态。完成后可打开新的回放 Run，或与源 Run 进入差异对比。排队中和运行中的任务可以取消；超时与取消都会终止 Worker 并清理临时目录。

该功能只执行内置固定 Mock Worker，不运行用户代码、Shell 或真实工具调用。生成的任务和 Run/Event 会保存在本地 SQLite；更完整的能力边界见[隐私与安全](privacy-security.md)。

更多数据与网络边界见[隐私与安全](privacy-security.md)，全部配置项见[部署与运维](deployment-operations.md)。
