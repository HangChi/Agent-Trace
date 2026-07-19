<p align="center">
  <img src="apps/desktop-tauri/assets/icon.svg" width="88" height="88" alt="Agent-Trace 图标" />
</p>

# Agent-Trace

<p align="center">本地优先的 AI Agent 运行观测、用量分析与故障诊断工具。</p>

<p align="center">
  <a href="README.en.md">English</a> ·
  <a href="docs/README.md">完整文档</a> ·
  <a href="CHANGELOG.md">变更记录</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

Agent-Trace 把模型调用、工具执行、Token、成本、耗时、错误和本地会话历史汇总到本机 SQLite，并通过 Web 或 Windows 桌面界面展示 Run 列表、时间线、调用树与确定性诊断。核心采集和展示不依赖托管后端。

## 核心能力

- TypeScript SDK：显式记录自定义 Agent 的 Run、LLM 与工具调用。
- Python SDK：嵌套 Step、同步/异步装饰器，以及 OpenAI 和 LangChain 适配。
- Codex/Claude Code Hooks：无需修改 Agent 源码即可采集生命周期与工具元数据。
- Codex OTel：接收 OTLP/HTTP JSON 日志中的模型与官方 Token 用量。
- 本地 Usage Scanner：源码模式通过 `tokscale` 汇总多客户端会话；桌面模式由 Rust 原生只读扫描 Codex/Claude JSONL。
- Trace 分析：事件筛选、时间线、父子调用树、失败检查、重试/慢步骤/Token 热点诊断。
- 本地治理：Run 项目与标签、维护中心、保留期清理、墓碑恢复和可配置写入前字段脱敏。
- 本地交付：源码模式保留 Hono/Next.js；Windows 桌面包使用 Tauri、静态 UI 和全 Rust Collector，不携带 Node/Electron。

## 运行要求

- Node.js `>=22.12.0`；仓库的 `.nvmrc` 使用 Node.js 22。
- pnpm `>=11.0.7 <12`；`packageManager` 和 CI 固定使用 11.0.7。
- 构建桌面包还需要 Rust stable、MSVC C++ Build Tools 和 Windows SDK。
- Windows 桌面安装包只能在 Windows x64 环境构建。

## 快速开始

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

启动后访问：

- Dashboard：<http://localhost:3000/runs>
- Collector：<http://127.0.0.1:4319>

另开终端生成一条示例 Run：

```bash
pnpm --filter simple-agent dev
```

> [!TIP]
> 不希望首次启动扫描本地会话时，可运行
> `node packages/cli/dist/index.js dev --usage-scan=false`。

## 三种接入方式

### TypeScript SDK

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

SDK 默认向 `http://localhost:4319` 投递，单次投递超时 1000 ms；Tracing 失败不会改变被观测函数的返回值或异常语义。

### Codex / Claude Code Hooks

```bash
node packages/cli/dist/index.js install codex
node packages/cli/dist/index.js install claude-code
```

安装过程只管理带 Agent-Trace 标记的配置，并在修改前创建时间戳备份。完整参数见[用户手册](docs/user-guide.md#安装全局-tracing-hooks)。

### 本地用量与会话

```bash
node packages/cli/dist/index.js usage --once
node packages/cli/dist/index.js usage clients --home <path>
```

敏感项目建议首次扫描前设置 `AGENT_TRACE_HISTORY_CONTENT=metadata`，避免保存 Prompt 预览。

## 工作区

| 路径 | 职责 |
| --- | --- |
| `apps/server` | Hono Collector、SQLite、集成入口与读模型 |
| `apps/web` | Next.js Dashboard |
| `apps/desktop-tauri` | Tauri 桌面壳、静态 UI 与 Windows NSIS 打包 |
| `crates/agent-trace-core` | Rust Collector、SQLite、Hooks/OTLP、分析、回放与原生 Usage Scanner |
| `packages/schema` | Zod 契约与共享 TypeScript 类型 |
| `packages/sdk-js` | JavaScript/TypeScript Tracing SDK |
| `packages/sdk-python` | Python Tracing SDK 与框架适配 |
| `packages/cli` | 开发编排、Hooks 管理和本地用量扫描 |
| `examples` | SDK 与 Hook 冒烟示例 |

## 验证

```bash
pnpm verify
pnpm desktop:check:rust
```

等价于依次运行构建、测试、类型检查和 lint；lint 同时执行文档链接、API 路由、环境变量和 CLI 命令一致性检查。测试范围与已知边界见[测试文档](docs/testing.md)。

## 数据、隐私与成本

> [!WARNING]
> Collector 没有认证，只应监听回环地址。不要直接暴露到公网或不可信局域网。

- 数据默认保存在本机 SQLite。
- SDK 会保存调用方传入的 input/output，不会自动脱敏。
- Hooks 固定使用 metadata 脱敏，但 Shell 命令仍可能包含路径、参数或凭据。
- 本地历史默认可保存清理后的 Prompt 预览；可切换为 `metadata`。
- 所有成本都是 API 等价估算，不代表订阅产品的实际账单。

处理敏感数据前请阅读[隐私与安全](docs/privacy-security.md)。

## 文档

从[文档索引](docs/README.md)按角色进入，常用入口包括：

- [用户手册](docs/user-guide.md)
- [系统架构](docs/architecture.md)
- [Collector API 与 OpenAPI](docs/api-reference.md)
- [开发指南](docs/development-guide.md)
- [部署与运维](docs/deployment-operations.md)
- [隐私与安全](docs/privacy-security.md)
- [领域词汇表](CONTEXT.md)
- [架构决策记录](docs/adr/README.md)
