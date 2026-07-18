# Agent-Trace 部署与运维

## 部署模型

Agent-Trace 当前支持两种本地运行模型：

- 源码模式：CLI 编排 Hono Collector、Next.js Dashboard 和 usage watcher。
- Windows 桌面模式：Tauri 启动进程内 Rust Collector 和静态 WebView UI，并管理托盘与本地数据。

Collector 没有认证，不提供面向公网的部署配置。

## 源码运行

要求 Node.js `>=22.12.0` 和 pnpm `>=11.0.7 <12`；可复现安装与 CI 固定使用 11.0.7。使用 Node 版本管理器时可读取仓库 `.nvmrc`。

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/dist/index.js dev
```

默认地址：

- Collector：`http://127.0.0.1:4319`
- Dashboard：`http://localhost:3000/runs`

单独运行服务：

```bash
pnpm --filter @agent-trace/schema build
pnpm --filter @agent-trace/server db:init
pnpm --filter @agent-trace/server dev
```

另一个终端：

```bash
pnpm --filter @agent-trace/web dev
```

健康检查：

```bash
curl http://127.0.0.1:4319/health
```

预期 JSON：`{"ok":true,"service":"agent-trace"}`。

## Windows 桌面构建

桌面包只配置 Windows x64 和 NSIS。构建机需要 Rust stable、MSVC C++ Build Tools、Windows SDK，以及 pnpm 安装的 Tauri CLI。

开发运行：

```bash
pnpm desktop:dev
```

生成解包目录：

```bash
pnpm desktop:pack:win
```

生成 NSIS 安装包：

```bash
pnpm desktop:build:win
```

构建产物位于 `target/release/bundle/nsis`。安装器按当前用户安装；UI 资源直接编入 Tauri 应用，安装包不包含 Electron、Node、Next Server、CLI 压缩包或 `tokscale` sidecar。首次安装若系统没有 Evergreen WebView2 Runtime，NSIS 会通过微软 bootstrapper 下载运行时。

旧 Electron 构建仍可用 `pnpm desktop:build:electron:win` 和 `pnpm desktop:pack:electron:win` 手动执行，但不再是默认桌面交付链路。

## 端口行为

| 服务 | 默认 | 行为 |
| --- | --- | --- |
| Collector | 4319 | 固定使用配置端口；被其他程序占用时桌面启动失败并提示。 |
| Dashboard | 3000 | 仅源码 Next.js 模式使用；Tauri 静态 UI 不监听端口。 |

源码 Server 默认监听 `127.0.0.1`。Dashboard 使用 `AGENT_TRACE_API_URL` 指向 Collector。

## 数据目录

### 源码模式

- 默认数据库：当前工作目录的 `agent-trace.db`。
- 覆盖：`AGENT_TRACE_DB_PATH`。

### 桌面模式

- 数据库：Tauri `app_data_dir/agent-trace.db`。
- UI 与 Collector：编入单一桌面可执行文件，不创建解压运行时目录。
- 覆盖数据库路径：`AGENT_TRACE_DB_PATH`。

具体 `app_data_dir` 绝对路径由 Tauri 和当前 Windows 用户决定。桌面 Collector 固定只监听 `127.0.0.1:4319`。

## 环境变量

### Collector 与 Dashboard

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `AGENT_TRACE_DB_PATH` | SQLite 文件路径 | 源码为 `agent-trace.db`；桌面为 userData 下文件 |
| `AGENT_TRACE_SERVER_HOST` | Collector 监听地址 | `127.0.0.1` |
| `AGENT_TRACE_SERVER_PORT` | Collector 端口 | `4319` |
| `PORT` | Server/Next 进程端口；Server 中优先级高于专用变量 | 由启动器设置 |
| `AGENT_TRACE_WEB_PORT` | Dashboard 端口 | `3000` |
| `AGENT_TRACE_API_URL` | Web 访问的 Collector 地址 | `http://localhost:4319` |
| `AGENT_TRACE_ENDPOINT` | CLI、Scanner 和示例的通用 Collector 地址覆盖；优先级低于显式命令参数 | 未设置时使用对应 `*_COLLECTOR_URL` 或默认地址 |
| `AGENT_TRACE_DESKTOP_PREFERENCES_PATH` | Web 更新桌面偏好的文件 | 仅桌面注入 |
| `AGENT_TRACE_RUNNING_STALE_MINUTES` | running Run 的 stale 阈值 | `30` |
| `AGENT_TRACE_STALE_RUN_MINUTES` | stale 阈值的备用名称 | `30` |

### Usage 与历史

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `AGENT_TRACE_USAGE_SCAN` | `0`、`false`、`off` 禁用自动扫描 | 启用 |
| `AGENT_TRACE_USAGE_CLIENTS` | 逗号分隔的客户端限制 | 自动发现可用客户端 |
| `AGENT_TRACE_USAGE_HOME` | 传给 `tokscale` 的用户主目录 | 当前用户 home |
| `TOKSCALE_HOME` | `AGENT_TRACE_USAGE_HOME` 未设置时的兼容 home | 当前用户 home |
| `AGENT_TRACE_HISTORY_CONTENT` | `preview` 或 `metadata` | `preview` |
| `AGENT_TRACE_TOKSCALE_BIN` | `tokscale` 可执行文件覆盖 | 包内入口或 PATH |
| `AGENT_TRACE_COLLECTOR_URL` | CLI/Hooks/Scanner 的 Collector 地址 | `http://localhost:4319` |

### 成本与汇率

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `AGENT_TRACE_MODEL_PRICES_JSON` | 精确模型价格 JSON | 无 |
| `AGENT_TRACE_USD_CNY_RATE` | 固定 USD/CNY 正数汇率 | 未设置时请求汇率服务 |
| `AGENT_TRACE_EXCHANGE_RATE_URL` | 汇率服务 URL | `https://open.er-api.com/v6/latest/USD` |

### 集成配置

| 变量 | 用途 |
| --- | --- |
| `CODEX_HOME` | 覆盖 Codex 配置目录。 |
| `CLAUDE_CONFIG_DIR` | 覆盖 Claude Code 配置目录。 |

### 示例程序

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `AGENT_TRACE_EXAMPLE_TASK` | `simple-agent` 示例任务文本 | 示例内置任务 |
| `AGENT_TRACE_EXAMPLE_FAIL` | 设置为 `1` 时让示例生成失败 Run | 未设置 |

### 旧名称兼容

新部署应使用 `AGENT_TRACE_*`。以下旧名称仍在对应路径生效：

| 当前名称 | 兼容名称 |
| --- | --- |
| `AGENT_TRACE_API_URL` | `TOOLTRACE_API_URL` |
| `AGENT_TRACE_COLLECTOR_URL` / `AGENT_TRACE_ENDPOINT` | `TOOLTRACE_COLLECTOR_URL` / `TOOLTRACE_ENDPOINT` |
| `AGENT_TRACE_DB_PATH` | `TOOLTRACE_DB_PATH` |
| `AGENT_TRACE_SERVER_HOST` | `TOOLTRACE_SERVER_HOST` |
| `AGENT_TRACE_SERVER_PORT` | `TOOLTRACE_SERVER_PORT` |
| `AGENT_TRACE_WEB_PORT` | `TOOLTRACE_WEB_PORT` |
| `AGENT_TRACE_MODEL_PRICES_JSON` | `TOOLTRACE_MODEL_PRICES_JSON` |
| `AGENT_TRACE_USD_CNY_RATE` | `TOOLTRACE_USD_CNY_RATE` |
| `AGENT_TRACE_EXCHANGE_RATE_URL` | `TOOLTRACE_EXCHANGE_RATE_URL` |
| `AGENT_TRACE_RUNNING_STALE_MINUTES` / `AGENT_TRACE_STALE_RUN_MINUTES` | 对应 `TOOLTRACE_*` 名称 |
| `AGENT_TRACE_EXAMPLE_TASK` / `AGENT_TRACE_EXAMPLE_FAIL` | 对应 `TOOLTRACE_*` 名称 |

兼容变量用于迁移旧配置，不保证在未来正式稳定版本中永久保留。

## 数据库运维

- Server 启动时自动执行版本化 migration。
- migration 在事务中执行并更新 SQLite `user_version`。
- 数据库版本高于程序支持版本时拒绝启动，避免降级程序破坏数据。
- 删除 Run 会写入 Tombstone 并级联删除 Event，防止 Scanner 重新生成。
- `GET /maintenance/storage` 监测 Run/Event/Usage/Tombstone 数量与数据库体积。
- `POST /maintenance/prune` 按截止时间和状态删除历史；`POST /maintenance/compact` 在清理后回收空间。

备份步骤：

1. 停止 CLI 或退出桌面端，确保写入进程结束。
2. 复制 `agent-trace.db`；如存在同名 `-wal`、`-shm`，一并复制。
3. 恢复时使用相同或更新版本的 Agent-Trace 打开副本。

不要在 Collector 运行期间只复制主数据库文件作为一致性备份。

### 测试与容量基准变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `AGENT_TRACE_DESKTOP_E2E_DIR` | 未设置 | Desktop 生命周期 E2E 的隔离 `userData` 和结果目录；仅用于测试。 |
| `AGENT_TRACE_BENCHMARK_RUNS` | `100000` | 容量基准 Run 数。 |
| `AGENT_TRACE_BENCHMARK_EVENTS` | `1000000` | 容量基准 Event 数。 |
| `AGENT_TRACE_BENCHMARK_RUN_MS` | `1500` | Run 分页延迟上限（ms）。 |
| `AGENT_TRACE_BENCHMARK_EVENT_MS` | `500` | Event 分页延迟上限（ms）。 |
| `AGENT_TRACE_BENCHMARK_HEAP_MB` | `512` | 基准查询堆内存增量上限（MiB）。 |
| `AGENT_TRACE_BENCHMARK_DB_MB` | `2048` | 基准 SQLite 文件体积上限（MiB）。 |

## 运行检查

- `GET /health`：Collector 是否可用。
- `GET /usage/scanner`：最近扫描时间、客户端状态和错误。
- `GET /usage/summary`：扫描快照是否已写入。
- Run 列表：Hook/OTel/SDK 数据是否进入读模型。
- 进程退出：源码 CLI 收到退出信号后停止 watcher 和子进程；桌面退出会停止其管理的本地服务。

## 故障处理

### Collector 端口占用

确认已有服务是否为 Agent-Trace。若不是，关闭占用进程或设置其他 `AGENT_TRACE_SERVER_PORT`，并确保 CLI/Hooks/Web 指向相同地址。

### Dashboard 端口占用

桌面端未显式配置时会自动选择后续端口；显式 `AGENT_TRACE_WEB_PORT` 被占用时会失败。源码模式可更换该变量。

### Scanner 不更新

1. 检查 `AGENT_TRACE_USAGE_SCAN`。
2. 运行 `usage clients --home <path>`。
3. 检查 `/usage/scanner` 的 `warning` 与 `actionHint`。
4. 对需要缓存的客户端执行 `usage sync`。
5. 使用真实用户 home，避免沙箱 HOME 指向空目录。

### Hook 无数据

1. 确认 Collector 地址与 Hook URL 相同。
2. 检查 Codex `hooks.json`、`config.toml` 或 Claude `settings.json`。
3. 重新安装 Hook；Codex 需重启以加载 OTel 配置。
4. 运行 `examples/agent-hook-smoke.mjs` 隔离 Collector 问题。

### 成本未显示

确认扫描行是否含 `costUsd`。否则为模型提供 `AGENT_TRACE_MODEL_PRICES_JSON` 精确条目；系统不会猜测相近模型价格。
