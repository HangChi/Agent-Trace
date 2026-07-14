# Agent-Trace

[English](README.en.md) · [完整文档](docs/README.md)

Agent-Trace 是一套本地优先的 AI Agent 运行观测工具。它把 Agent 的模型调用、工具执行、Token 用量、耗时、错误和本地会话历史汇总到 SQLite，并通过 Web 或 Windows 桌面界面展示运行列表、执行时间线、调用树和诊断结果。

## 核心能力

- 使用 TypeScript SDK 为自定义 Agent 记录 run、LLM 调用和工具调用。
- 通过全局 Hooks 接入 Codex 与 Claude Code 生命周期事件。
- 接收 Codex OTel JSON 日志中的模型与官方 Token 用量。
- 使用 `tokscale` 汇总本地 AI 编程客户端的会话、Token 和成本数据。
- 展示运行摘要、事件筛选、时间线、父子调用树、失败分析和性能诊断。
- 提供本地 Collector、双语 Dashboard 和 Windows 桌面封装。

## 快速开始

仓库未声明 Node.js 最低版本。请准备可运行当前依赖的 Node.js，以及 `packageManager` 字段指定的 pnpm 11.0.7。

```bash
pnpm install
pnpm build
node packages/cli/dist/index.js dev
```

启动后访问：

- Dashboard：<http://localhost:3000/runs>
- Collector：<http://127.0.0.1:4319>

另开终端生成一条示例运行：

```bash
pnpm --filter simple-agent dev
```

首次在干净工作区运行测试前应先执行 `pnpm build`，确保示例包可以解析工作区 SDK 的构建产物。

## 最小 SDK 示例

```ts
import { startRun } from "@agent-trace/sdk";

const run = startRun({
  name: "research-agent",
  input: { task: "Research MCP ecosystem" }
});

try {
  const result = await run.traceTool(
    "web_search",
    { query: "MCP ecosystem" },
    () => webSearch("MCP ecosystem")
  );

  await run.end(result);
} catch (error) {
  await run.fail(error);
  throw error;
}
```

SDK 默认向 `http://localhost:4319` 投递数据，单次投递默认超时为 1000 ms。投递失败不会改变被观测 Agent 的执行结果。

## 工作区

| 路径 | 职责 |
| --- | --- |
| `apps/server` | Hono Collector、SQLite 存储、查询与集成入口 |
| `apps/web` | Next.js Dashboard |
| `apps/desktop` | Electron 桌面端与 Windows 打包 |
| `packages/schema` | Zod 契约与共享 TypeScript 类型 |
| `packages/sdk-js` | JavaScript/TypeScript Tracing SDK |
| `packages/cli` | 开发编排、Hooks 管理和本地用量扫描 |
| `examples` | SDK 与 Hook 冒烟示例 |

## 数据与成本说明

Collector 默认仅监听回环地址，数据库保存在本机。SDK 会保存调用方主动传入的 input/output；Hooks 默认采用 metadata 脱敏；本地历史扫描默认可能保存清理后的 Prompt 预览。敏感环境应先阅读[隐私与安全](docs/privacy-security.md)。

界面中的成本是按扫描结果或精确配置价格计算的 API 等价估算，不代表 Codex、Claude 或其他订阅产品的实际账单。

## 文档

- [产品需求文档](docs/product-requirements.md)
- [需求规格说明](docs/requirements-specification.md)
- [用户手册](docs/user-guide.md)
- [系统架构](docs/architecture.md)
- [API 参考](docs/api-reference.md)
- [开发指南](docs/development-guide.md)
- [测试文档](docs/testing.md)
- [部署与运维](docs/deployment-operations.md)
- [隐私与安全](docs/privacy-security.md)
- [开发历史](docs/development-history.md)
