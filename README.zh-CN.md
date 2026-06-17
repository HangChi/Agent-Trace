# ToolTrace

[English](README.md)

本地优先的 AI Agent 调试 DevTools。

ToolTrace 会记录一次 Agent run 里的 LLM 调用、工具调用、token 使用量、耗时、输出和错误，并把执行过程展示成时间线。

## 为什么做

AI Agent 的失败经常很难定位：

- 调错工具。
- 重复执行同一个动作。
- 超出 token 预算。
- 隐藏了中间工具错误。
- 最终答案看起来对，但推理过程其实错了。

ToolTrace 帮你看清楚一次 Agent run 到底发生了什么。

## 快速开始

安装依赖：

```bash
pnpm install
```

启动本地 collector 和 dashboard：

```bash
pnpm --filter @tooltrace/cli build
node packages/cli/dist/index.js dev
```

另开一个终端，运行示例 Agent：

```bash
pnpm --filter @tooltrace/schema build
pnpm --filter @tooltrace/sdk build
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
import { startRun } from "@tooltrace/sdk";

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

## 工作区结构

```text
apps/
  server/          Hono collector API 和 SQLite 存储
  web/             Next.js 调试面板
packages/
  schema/          共享 trace 契约和运行时校验
  sdk-js/          JS/TS tracing SDK
  cli/             tooltrace dev 命令
examples/
  simple-agent/    fake agent 示例
docs/
  architecture.md  MVP 架构说明
```

## 常用命令

```bash
pnpm --filter @tooltrace/schema build
pnpm --filter @tooltrace/server db:init
pnpm --filter @tooltrace/server dev
pnpm --filter @tooltrace/web dev
pnpm --filter @tooltrace/sdk smoke
pnpm --filter simple-agent dev
```

生成一条失败示例 run，用来查看 Failure Inspector：

```bash
TOOLTRACE_EXAMPLE_FAIL=1 pnpm --filter simple-agent dev
```

Windows PowerShell：

```powershell
$env:TOOLTRACE_EXAMPLE_FAIL = "1"
pnpm --filter simple-agent dev
```

## API

- `GET /health`
- `POST /runs`
- `PATCH /runs/:id`
- `POST /events`
- `GET /runs`
- `GET /runs/:id/events`

## 贡献流程

- 保持有意义的 conventional commit，例如 `feat(sdk): add traceTool wrapper`。
- PR 尽量小；一个 PR 只实现一个功能或修改一个行为。
- PR 描述需要包含功能说明、实现思路和测试方式。
- 不要提交 SQLite 数据库文件、构建产物、本地环境变量文件或 `.next` 缓存。
