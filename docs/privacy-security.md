# Agent-Trace 隐私与安全

安全漏洞报告和敏感数据响应流程见仓库根目录的 [SECURITY.md](../SECURITY.md)。

## 安全模型

Agent-Trace 面向单机开发环境。Collector 默认监听 `127.0.0.1`，Dashboard 通过本地 HTTP 访问它，数据写入本机 SQLite。Collector 没有认证、授权或多租户隔离，不应直接暴露到公网或不可信局域网。

服务端 CORS 只允许来源为 `localhost` 或 `127.0.0.1` 的 HTTP/HTTPS Dashboard，但 CORS 不是服务端认证。若通过 `AGENT_TRACE_SERVER_HOST` 改为非回环地址，调用者必须自行承担网络隔离和访问控制责任。

## 采集边界

| 来源 | 会保存的内容 | 默认不会保存的内容 |
| --- | --- | --- |
| TypeScript SDK | 调用方传入的 Run/Event input、成功 output、错误、耗时和 metadata | SDK 不主动脱敏；调用方未传入的内容不会被推断。 |
| Codex/Claude Hooks | 生命周期、会话/轮次 ID、来源、工作目录、工具/Skill/MCP 名、Shell 命令、状态、耗时、模型、Token、普通工具 payload 字节数 | 原始用户 Prompt、普通工具完整输入/输出、文件内容、最终回答全文、隐藏推理。 |
| Codex OTel | OTel 记录中的会话、来源、模型、工具、命令、Token 和状态等规范化元数据 | Agent-Trace 配置 Codex `log_user_prompt = false`；普通 payload 只保留受控摘要。 |
| Usage scan | 客户端、会话 ID、模型、provider、Token 分类、消息数、时间、扫描成本、诊断路径和提示 | `tokscale` 源日志全文不会直接提交给 Collector。 |
| Transcript scan（preview） | 清理后的 Prompt 短预览、Prompt/Turn 时间、Token、工具名、会话元数据 | Assistant 正文、工具结果全文、文件内容；Prompt 预览截断为最多 240 个字符。 |
| Transcript scan（metadata） | Prompt/Turn 时间、Token、工具名和会话元数据 | Prompt 文本。 |

SDK 是显式埋点接口，会原样序列化调用方交给它的 input/output。处理密钥、个人信息或受保护内容时，应在调用 SDK 前自行移除或摘要化。

## Hooks 脱敏

当前 CLI 只接受 `metadata` 脱敏级别。它保留执行过的 Shell 命令，因为命令本身用于诊断；命令可能包含路径、参数或秘密，使用者应避免把凭据直接写入命令行。

Dashboard 的“维护”页面可配置写入前敏感字段名和替换文本。Collector 会递归检查后续 Run、Event 与 Transcript payload 的对象字段名，不区分大小写；命中字段在写入 SQLite 前替换。该规则不会追溯清理已有数据，也不会检查普通字符串内容中的秘密。

Dashboard 的“脱敏导出”是独立的分享安全层：它不会导出 Run/Event 名称、Prompt、input/output、命令、路径、会话 ID、错误正文或堆栈，并使用稳定化名替换原始 ID。导出前仍应根据接收方和项目策略检查 agent、model、tool、MCP、Skill 名称是否适合分享。

对于普通工具和 MCP 调用，Collector 保存工具名及 input/output 的 JSON 字节数，不递归采集任意字段中的 Token 数据。只有受信任的协议位置可贡献官方 Token 用量，避免把命令输出里的 `totalTokens` 等普通数字误识别为模型用量。

## 本地会话预览

`AGENT_TRACE_HISTORY_CONTENT` 和 `--history-content` 支持：

- `preview`：默认值，保存清理后的 Prompt 短预览。
- `metadata`：不保存 Prompt 文本。

敏感项目建议在首次扫描前设置：

```powershell
$env:AGENT_TRACE_HISTORY_CONTENT = "metadata"
node packages/cli/dist/index.js usage --once --home C:\Users\alice
```

切换到 metadata 不会自动清理数据库中先前保存的 preview。需要清理时，应在 Dashboard 删除相关 Run，或停止服务后删除/替换本地数据库。

## 本地文件

- 源码运行时数据库默认是仓库当前目录下的 `agent-trace.db`，可由 `AGENT_TRACE_DB_PATH` 覆盖。
- 桌面端数据库默认位于 Tauri `app_data_dir`，文件名为 `agent-trace.db`；可用 `AGENT_TRACE_DB_PATH` 覆盖。
- Tauri UI、Rust Collector 和原生 Scanner 编入同一桌面应用，不创建 Node/Next 运行时解压目录。
- Hook 安装或卸载修改既有配置前会生成 `.agent-trace-backup.<timestamp>`。

SQLite 数据库、WAL/SHM 文件、环境文件、桌面资源和构建产物均由仓库 `.gitignore` 排除。

## 外部网络访问

核心 tracing 与本地展示不要求 Agent-Trace 云服务。以下行为可能访问本机之外：

- 安装依赖、下载 Rust crates 或构建 Tauri 包时访问包管理器/构建资源；缺少 WebView2 时，NSIS 安装器会下载微软 bootstrapper。
- 用户显式执行受支持客户端的 `tokscale sync` 时，由 `tokscale` 访问对应服务。
- Dashboard 为显示人民币换算，默认尝试从 `https://open.er-api.com/v6/latest/USD` 获取 USD/CNY 汇率，每小时重新验证；失败时只省略 CNY 值。

如需禁止汇率请求，可设置固定正数：

```powershell
$env:AGENT_TRACE_USD_CNY_RATE = "7.20"
```

也可通过 `AGENT_TRACE_EXCHANGE_RATE_URL` 指向受控服务。

## 成本与 Token

- `official` 表示来自受信任 provider/OTel 结构的用量。
- `scan` 表示来自本地扫描器的会话级用量。
- `estimate` 表示缺少官方数据时的本地估算。
- Reasoning Token 作为 output 的明细展示，不会在派生总量时重复相加。
- Scanner 提供的正数 `costUsd` 优先。
- 缺少扫描成本时，桌面原生扫描器使用版本固定的内置精确价格；`AGENT_TRACE_MODEL_PRICES_JSON` 可按精确模型名覆盖或补充，系统不做模糊匹配。

所有成本均为 API 等价估算，不表示订阅产品实际产生了额外扣费。

## 删除与保留

- `DELETE /runs/:id` 和批量删除会从 Agent-Trace 数据库删除 Run，并级联删除其 Event。
- 删除不会修改 Codex、Claude Code、OpenCode 或其他客户端的源历史。
- 删除会在 `run_tombstones` 中保留 Run ID，后续 Hook、OTel 和 Transcript Scanner 不会依据源历史重新生成该 Run。
- 如果需要重新采集某个已删除 Run，显式调用 `DELETE /runs/:id/tombstone`。
- 使用 `POST /maintenance/prune` 按日期和状态执行保留期清理；默认保留墓碑。`GET /maintenance/storage` 用于监测容量，`POST /maintenance/compact` 用于回收 SQLite 空间。
- 完整 usage snapshot 会替换已协调客户端的旧汇总行，但不会删除 Hook 或 OTel trace。

需要彻底清空 Agent-Trace 本地数据时，先退出 Collector/桌面端，再备份或删除数据库及同名 `-wal`、`-shm` 文件。该操作不可撤销。

## 安全回放边界

- 回放 API 不接受可执行代码、Shell 命令、脚本路径或真实工具配置，只允许输入覆盖、Mock 输出、模拟错误、延迟和超时。
- 子进程执行仓库内置固定 Worker，使用净化后的最小环境变量和每任务独立临时目录；任务结束、超时或取消后等待进程退出并清理目录。
- “网络禁用”表示固定 Worker 的实现不包含网络或工具调用能力，不等同于容器、虚拟机或操作系统防火墙提供的强制网络隔离。
- 回放输入、Mock 输出、错误以及生成的 Run/Event 会持久化到 SQLite，仍可能包含敏感数据，并继续受写入前字段脱敏规则约束。
- 此实现适合可信单机开发环境中的可控 Mock 调试；不要把它当作运行不可信代码的通用沙箱。
