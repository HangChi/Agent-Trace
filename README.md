# Agent-Trace

[English](README.en.md)

本地优先的 AI Agent 调试 DevTools。

Agent-Trace 会记录一次 Agent run 里的 LLM 调用、工具调用、token 使用量、耗时、输出和错误，并把执行过程展示成时间线。

## 为什么做

AI Agent 的失败经常很难定位：

- 调错工具。
- 重复执行同一个动作。
- 超出 token 预算。
- 隐藏了中间工具错误。
- 最终答案看起来对，但推理过程其实错了。

Agent-Trace 帮你看清楚一次 Agent run 到底发生了什么。

## 快速开始

安装依赖：

```bash
pnpm install
```

启动本地 collector 和 dashboard：

```bash
pnpm --filter @agent-trace/cli build
node packages/cli/dist/index.js dev
```

```bash
node packages/cli/dist/index.js dev --usage-scan --usage-home C:\Users\song
node packages/cli/dist/index.js dev --usage-scan --usage-sync --usage-home C:\Users\song
node packages/cli/dist/index.js usage --once --home C:\Users\song
node packages/cli/dist/index.js usage --once --sync --home C:\Users\song
node packages/cli/dist/index.js usage clients --home C:\Users\song
node packages/cli/dist/index.js usage sync --clients cursor,antigravity,trae,warp --home C:\Users\song
```

桌面应用会在 collector 启动后自动扫描一次本机全部 `tokscale` 客户端，并每 15 秒刷新。设置
`AGENT_TRACE_USAGE_SCAN=0`（也支持 `false` 或 `off`）可关闭桌面端自动扫描。CLI 默认同样
扫描 `tokscale` 支持的全部客户端；只有显式传入 `--clients` 时才会限制范围。

Codex 扫描会同时核对 `~/.codex/sessions` 和 `~/.codex/archived_sessions`。恢复或归档产生的
重复 JSONL 会按模型/token 事件序列去重；`reasoning` 已包含在 output 中，只单独展示，不会
重复加入 total。价格优先采用 `tokscale` 返回的 `costUsd`，缺价且没有精确配置时显示未定价。

开发时也可以直接从源码启动 CLI：

```bash
pnpm --filter @agent-trace/cli exec tsx src/index.ts dev
```

另开一个终端，运行示例 Agent：

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/sdk build
pnpm --filter simple-agent dev
```

打开面板：

```text
http://localhost:3000/runs
```

Collector API 默认运行在：

```text
http://localhost:4319
```

## SDK 示例

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP ecosystem" }
});

try {
  const plan = await run.traceLLM(
    "planner",
    { prompt: "Research MCP ecosystem" },
    () => callLLM(),
    {
      provider: "openai",
      model: "gpt-4.1",
      tokenUsage: { input: 120, output: 40, total: 160 }
    }
  );

  const results = await run.traceTool(
    "web_search",
    { query: "MCP ecosystem" },
    () => webSearch("MCP ecosystem")
  );

  await run.end({ plan, results });
} catch (error) {
  await run.fail(error);
  throw error;
}
```

SDK 会吞掉 tracing 自身的失败，所以 collector 不可用时也不会改变用户 Agent 的主流程。

## 全局 Tracing Hooks

无需手工编辑配置文件，Agent-Trace 可以为 Codex 和 Claude Code 安装全局 tracing hooks，把生命周期、prompt 和工具事件转发到本地 collector。

```bash
pnpm --filter @agent-trace/cli build

node packages/cli/dist/index.js install codex --scope user --redaction metadata --surface cli
# 如果这份共享 Codex 配置当前用于 Codex 桌面端，请改用：
# node packages/cli/dist/index.js install codex --scope user --redaction metadata --surface desktop
node packages/cli/dist/index.js install claude-code --scope user --redaction metadata
```

卸载：

```bash
node packages/cli/dist/index.js uninstall codex
node packages/cli/dist/index.js uninstall claude-code
```

- `install codex` 会在 `~/.codex/hooks.json` 写入 Agent-Trace 管理块。
- `install claude-code` 会在 `~/.claude/settings.json` 写入 Agent-Trace 管理块。
- 修改前会创建带时间戳的 `.agent-trace-backup.<timestamp>` 备份。
- 重复执行 install 是幂等的；uninstall 只移除 Agent-Trace 管理块，不会动你自己的 hooks。
- Codex 桌面端和 CLI 共用同一份 Codex 配置。使用 `install codex --surface cli` 或 `install codex --surface desktop`；最后一次安装的 surface 会作为 Agent-Trace 显示的来源，直到用另一个值重新安装。
- `CODEX_HOME` 和 `CLAUDE_CONFIG_DIR` 可覆盖配置目录；`AGENT_TRACE_COLLECTOR_URL`（或 `--collector-url`）可覆盖 collector 地址。
- 默认使用 metadata 脱敏级别。Agent-Trace 会保存事件名、工具名、执行过的 shell 命令、ID、状态、耗时、模型、来源提供的官方 token 用量、缺少官方用量时的本地 token 估算值，以及非命令工具输入/输出的 payload 大小；不会保存原始 prompt、非命令工具输入/输出全文、文件内容或隐藏推理。
- 如需最准确的 Codex token，请把官方 Codex OTel JSON 日志导出到 `http://localhost:4319/integrations/codex/otel/v1/logs`；仅来自 Codex 或 Claude Code hook 的 prompt/output token 会在本地估算，并标记为估算值。

不运行 Codex 或 Claude Code 也可以验证 hook ingestion。先启动本地 collector，再运行：

```bash
node examples/agent-hook-smoke.mjs
```

隐私默认值、smoke 验证和已知限制见 [Agent Tracing](docs/agent-tracing.md)。

## 工作区结构

```text
apps/
  server/          Hono collector API 和 SQLite 存储
  web/             Next.js 调试面板
packages/
  schema/          共享 trace 契约和运行时校验
  sdk-js/          JS/TS tracing SDK
  cli/             agent-trace dev 命令
examples/
  simple-agent/    fake agent 示例
  agent-hook-smoke.mjs  Codex/Claude Code hook ingestion smoke
docs/
  architecture.md  MVP 架构说明
  agent-tracing.md Codex 和 Claude Code tracing 指南
```

## 常用命令

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/server db:init
pnpm --filter @agent-trace/server dev
pnpm --filter @agent-trace/web dev
pnpm --filter @agent-trace/cli exec tsx src/index.ts usage --once
pnpm --filter @agent-trace/cli exec tsx src/index.ts usage clients --home C:\Users\song
pnpm --filter @agent-trace/cli exec tsx src/index.ts usage sync --clients cursor,antigravity,trae,warp --home C:\Users\song
pnpm --filter @agent-trace/sdk smoke
pnpm --filter simple-agent dev
node examples/agent-hook-smoke.mjs
```

生成一条失败示例 run，用来查看 Failure Inspector：

```bash
AGENT_TRACE_EXAMPLE_FAIL=1 pnpm --filter simple-agent dev
```

Windows PowerShell：

```powershell
$env:AGENT_TRACE_EXAMPLE_FAIL = "1"
pnpm --filter simple-agent dev
```

## API

- `GET /health`
- `POST /runs`
- `PATCH /runs/:id`
- `POST /events`
- `POST /integrations/codex/hook`
- `POST /integrations/codex/otel/v1/logs`
- `POST /integrations/claude-code/hook`
- `POST /integrations/usage-scan`
- `GET /runs`
- `GET /runs/:id/events`
- `DELETE /runs/:id`

## 贡献流程

- 保持有意义的 conventional commit，例如 `feat(sdk): add traceTool wrapper`。
- PR 尽量小；一个 PR 只实现一个功能或修改一个行为。
- PR 描述需要包含功能说明、实现思路和测试方式。
- 不要提交 SQLite 数据库文件、构建产物、本地环境变量文件或 `.next` 缓存。
