# Agent-Trace 开发指南

## 环境准备

仓库要求：

- Node.js `>=22.12.0`；`.nvmrc` 选择 Node.js 22。
- pnpm `>=11.0.7 <12`；`packageManager` 和 CI 固定使用 11.0.7。
- 完整验证和 Windows 桌面开发需要 Rust stable；Windows 打包还需要 MSVC C++ Build Tools 与 Windows SDK。

安装依赖：

```bash
pnpm install --frozen-lockfile
```

首次在干净工作区初始化：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

先构建整个工作区的原因是 `examples/simple-agent` 通过 workspace 依赖引用 `@agent-trace/sdk` 的 `dist` 类型入口；只有 Schema 的根 `pretest` 构建不足以初始化全新 checkout。

## 工作区结构

```text
apps/
  server/       Collector、SQLite、集成与读模型
  web/          Next.js Dashboard
  desktop-tauri/ Tauri 壳、静态 UI、图标和 Windows 打包
crates/
  agent-trace-core/ Rust Collector、SQLite、分析与原生 Usage Scanner
packages/
  schema/       共享 Zod Schema 与 TypeScript 类型
  sdk-js/       Agent Tracing SDK
  cli/          dev、usage、Hooks 管理
examples/
  simple-agent/ SDK 示例
  agent-hook-smoke.mjs
scripts/
  workspace-scripts.*  根脚本审计
docs/           产品、用户、架构、开发和运维文档
```

构建依赖方向：

```text
schema -> sdk-js -> simple-agent
schema -> server
schema -> web
agent-trace-core -> desktop-tauri
```

## 本地开发

### 一体化启动

```bash
pnpm build
node packages/cli/dist/index.js dev
```

CLI 会初始化数据库并并行启动 Server 与 Web。修改 CLI 源码后可直接运行：

```bash
pnpm --filter @agent-trace/cli exec tsx src/index.ts dev
```

### 分别启动

终端一：

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/server db:init
pnpm --filter @agent-trace/server dev
```

终端二：

```bash
pnpm --filter @agent-trace/web dev
```

终端三：

```bash
pnpm --filter simple-agent dev
```

### 桌面端开发

```bash
pnpm desktop:dev
```

Tauri 进程通常会启动进程内 Rust Collector、静态 WebView UI 和原生 Usage Scanner；如果 `4319` 上已有通过 `/health` 验证的 Agent-Trace Collector，则桌面端会复用它并只启动静态 WebView UI。

## 根脚本

| 命令 | 行为 |
| --- | --- |
| `pnpm build` | 递归构建源码模式工作区包；桌面包使用独立命令。 |
| `pnpm dev` | 并行执行源码模式各包 `dev`；通常优先使用 CLI 一体化启动。 |
| `pnpm test` | 构建 Schema，审计工作区脚本，运行根 Node 测试和各包测试。 |
| `pnpm typecheck` | 递归执行各包类型检查。 |
| `pnpm docs:check` | 校验 Markdown 链接、Collector/API/OpenAPI、环境变量和 CLI 文档一致性。 |
| `pnpm lint` | 审计脚本、文档一致性、递归 Lint，并执行 `git diff --check`。 |
| `pnpm verify` | 依次运行 build、test、typecheck 和 lint。 |
| `pnpm format` | 递归调用各包 `format`；当前工作区包没有声明该脚本，不作为常规验证入口。 |
| `pnpm desktop:dev` | 启动 Tauri 开发应用。 |
| `pnpm desktop:pack:win` | 生成不带安装器的 release 可执行文件。 |
| `pnpm desktop:build:win` | 生成 Windows NSIS 安装包。 |
| `pnpm desktop:check:rust` | 检查静态 UI，并运行 Rust 测试和 Clippy。 |

## 按包命令

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/sdk build
pnpm --filter @agent-trace/cli build
pnpm --filter @agent-trace/server db:init
pnpm --filter @agent-trace/server dev
pnpm --filter @agent-trace/web dev
pnpm --filter @agent-trace/desktop-tauri test
```

各包的 `lint` 当前主要委托给类型检查或桌面静态检查。完整验证应从根目录运行，避免遗漏根脚本审计和 `git diff --check`。

## 变更边界

- 修改跨包数据契约时，先更新 `packages/schema`，再同步 Server、SDK 与 Web 消费者。
- 新增 HTTP 路由时，同时更新 `apps/server/src/app.ts` 的验证、对应 smoke 测试和 [API 参考](api-reference.md)。
- 桌面 Collector 路由还必须同步 `crates/agent-trace-core/src/api.rs`；`pnpm docs:check` 会校验两套 Collector 与 API/OpenAPI 的路由集合。
- 修改 CLI 参数时，同时更新 `printHelp`/子命令帮助和[用户手册](user-guide.md)。
- 修改数据库结构时只通过版本化 migration 前进，不手工假设现有数据库为空。
- 修改 Hooks 时保持幂等管理标记、配置备份和非阻塞退出语义。
- 不提交 SQLite、`dist`、`.next`、桌面运行时、安装包、环境文件或本地工作树。

## 提交前检查

```bash
pnpm verify
git diff --check
```

检查差异时确保每一处变更都服务于当前任务，不顺带格式化或重构无关文件。
