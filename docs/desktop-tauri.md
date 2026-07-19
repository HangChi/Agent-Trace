# Tauri 桌面架构

Windows 桌面交付已改为 Tauri + 全 Rust 后端。这个重构只替换桌面运行时：现有 Node/Hono/Next.js 源码模式、CLI、JavaScript/Python SDK 仍保留，SDK 继续向 `http://127.0.0.1:4319` 写入，因此业务接入代码无需迁移到 Rust。

## 运行结构

桌面进程包含三部分：

- `apps/desktop-tauri/src-tauri`：Tauri 生命周期、系统托盘、窗口和 NSIS 配置。
- `crates/agent-trace-core`：Axum Collector、SQLite 迁移和存储、Hooks/OTLP、分析、维护、评测与 mock-only 回放沙箱。
- `apps/desktop-tauri/ui`：无构建步骤的完整静态 HTML/CSS/JavaScript Dashboard，通过回环 API 和 SSE 读取数据。包含 Run 高级筛选、批量管理、详情时间线与 Trace 树、对比、Token-Trace、分析预算、评测、mock 回放、维护与隐私设置。

桌面包不启动 Node 子进程，不携带 Electron、Next Server、CLI 归档或 `tokscale` sidecar。Windows WebView2 由系统运行时提供；缺失时安装器使用微软 bootstrapper 安装。

静态页面直接作为 Tauri 资源嵌入可执行文件，Node 只可用于执行开发期契约检查和 Tauri CLI；安装后的桌面应用不需要系统安装 Node.js。

## 兼容性

- Collector 地址保持 `127.0.0.1:4319`。
- SQLite schema version 保持 `7`，Rust 会拒绝打开比自身更新的数据库，避免降级破坏。
- 保留 `/runs`、`/events`、Codex/Claude hooks、OTLP logs/traces、usage、analytics、evaluations、maintenance、export、insights、comparison 和 replay 路由。
- Node 版和 Rust 版不会同时监听 4319 端口；桌面启动时若端口被占用会直接报错，源码 Dashboard 则可验证并复用已运行的 Rust Collector。
- Rust Hook 归一化覆盖稳定的生命周期、工具、命令、状态、模型和来源字段；不会读取 Claude transcript 正文来估算 Token。

## 原生 Usage Scanner

桌面启动时立即扫描，之后每 5 分钟刷新一次：

- Codex：`~/.codex/sessions` 与 `~/.codex/archived_sessions`。
- Claude Code：`~/.claude/projects`。

扫描器只持久化客户端、会话 ID、模型、provider、Token 分类、API 等价估算成本、消息数和时间。成本按精确模型名使用随桌面版本固定的价目计算，`AGENT_TRACE_MODEL_PRICES_JSON` 中的精确条目可覆盖内置价格；未知模型不会模糊匹配。每个会话会以稳定 ID 增量物化为一个历史 Run 和摘要 Event，因此全新安装后无需旧数据库也能看到本机记录并生成趋势；已由 Hook/OTLP 跟踪的同一会话会优先保留，不创建重复历史 Run。它不保存 JSONL 中的 Prompt、响应正文或其他任意字段。单文件上限为 16 MiB，单次最多检查 5000 个 JSONL 文件。

0.5.0 内置价目精确覆盖 `gpt-5.6-sol`、`gpt-5.5`、`gpt-5`、`codex-auto-review`、`claude-opus-4-8` 与 `deepseek-v4-pro`。其他模型需提供精确配置后才会产生估算成本。

## 旧桌面数据兼容

升级用户启动 Tauri 版本时会检查旧 Electron 的 `%APPDATA%/Agent-Trace/agent-trace.db` 等标准数据目录，并将兼容的 schema v7 数据以 `INSERT OR IGNORE` 合并到新桌面库。现有桌面记录和旧库文件均不会被覆盖或删除。源码模式使用自定义数据库位置时，可在首次启动前设置 `AGENT_TRACE_LEGACY_DB_PATH` 指向旧库；这项兼容迁移只服务升级用户，新安装用户的数据来源仍是原生历史扫描与后续 Hook/OTLP 采集。

源码模式仍使用 `tokscale`，因此 Cursor、OpenCode 等扩展客户端的聚合和动态价格目录暂时属于源码版能力；桌面原生扫描器当前聚焦 Codex 与 Claude Code，使用版本固定的精确价格目录，并把来源标记为 `native-rust`。

## 构建与验证

```bash
pnpm desktop:check:rust
pnpm desktop:dev
pnpm desktop:build:win
```

NSIS 产物位于 `target/release/bundle/nsis`。如果只需要 release 可执行文件而不生成安装器，可运行 `pnpm desktop:pack:win`。
