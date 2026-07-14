# Agent-Trace 部署与运维

## 部署模型

Agent-Trace 当前支持两种本地运行模型：

- 源码模式：CLI 编排 Hono Collector、Next.js Dashboard 和 usage watcher。
- Windows 桌面模式：Electron 主进程管理打包后的 Server、Web、CLI 运行时及本地数据。

Collector 没有认证，不提供面向公网的部署配置。

## 源码运行

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

桌面包只配置 Windows x64 和 NSIS。

开发运行：

```bash
pnpm build
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

构建产物位于 `apps/desktop/release`。安装器按用户安装，允许选择目录；当前 NSIS 配置在卸载时删除 Electron `userData`，因此数据库和偏好也会被删除。

打包流程先把 Server、Web 和 CLI 生产运行时制作为归档，再由 Electron 放入 `resources/archives`。首次启动或归档变化时，桌面端把它们解压到 `userData/runtime`。

## 端口行为

| 服务 | 默认 | 行为 |
| --- | --- | --- |
| Collector | 4319 | 固定使用配置端口；被其他程序占用时桌面启动失败并提示。 |
| Dashboard | 3000 | 未显式配置时，桌面端从 3000 到 3099 寻找可用端口。 |

源码 Server 默认监听 `127.0.0.1`。Dashboard 使用 `AGENT_TRACE_API_URL` 指向 Collector。

## 数据目录

### 源码模式

- 默认数据库：当前工作目录的 `agent-trace.db`。
- 覆盖：`AGENT_TRACE_DB_PATH`。

### 桌面模式

- 数据库：Electron `userData/agent-trace.db`。
- 偏好：Electron `userData/preferences.json`。
- 解压运行时：Electron `userData/runtime/`。

具体 `userData` 绝对路径由 Electron 和当前操作系统用户决定。应用启动时会把实际数据库路径注入 Server。

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
| `AGENT_TRACE_DESKTOP_PREFERENCES_PATH` | Web 更新桌面偏好的文件 | 仅桌面注入 |
| `AGENT_TRACE_RUNNING_STALE_MINUTES` | running Run 的 stale 阈值 | `30` |
| `AGENT_TRACE_STALE_RUN_MINUTES` | stale 阈值的备用名称 | `30` |

### Usage 与历史

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `AGENT_TRACE_USAGE_SCAN` | `0`、`false`、`off` 禁用自动扫描 | 启用 |
| `AGENT_TRACE_USAGE_CLIENTS` | 逗号分隔的客户端限制 | 自动发现可用客户端 |
| `AGENT_TRACE_USAGE_HOME` | 传给 `tokscale` 的用户主目录 | 当前用户 home |
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

多个路径仍接受相应 `TOOLTRACE_*` 旧变量；新部署应使用 `AGENT_TRACE_*`。

## 数据库运维

- Server 启动时自动执行版本化 migration。
- migration 在事务中执行并更新 SQLite `user_version`。
- 数据库版本高于程序支持版本时拒绝启动，避免降级程序破坏数据。
- 删除 Run 会依赖 SQLite 外键级联删除 Event。

备份步骤：

1. 停止 CLI 或退出桌面端，确保写入进程结束。
2. 复制 `agent-trace.db`；如存在同名 `-wal`、`-shm`，一并复制。
3. 恢复时使用相同或更新版本的 Agent-Trace 打开副本。

不要在 Collector 运行期间只复制主数据库文件作为一致性备份。

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
