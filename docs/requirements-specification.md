# Agent-Trace 需求规格说明

## 功能需求

| 编号 | 需求 | 验收标准 |
| --- | --- | --- |
| FR-01 | Collector 管理 Run | 可创建、更新、查询、单个删除和批量删除 Run；请求不符合共享 Schema 时返回 400。 |
| FR-02 | Collector 管理 Event | 可写入带类型、状态、时间、输入、输出、错误和元数据的 Event，并按 Run 查询。 |
| FR-03 | SDK 手动埋点 | `startRun` 返回可用的 `traceLLM`、`traceTool`、`end` 和 `fail`，且支持自定义 endpoint 与投递超时。 |
| FR-04 | Codex Hooks | CLI 可幂等安装/卸载用户级 Codex Hooks，并保留用户自定义 Hook。 |
| FR-05 | Claude Code Hooks | CLI 可幂等安装/卸载用户级 Claude Code Hooks，并保留用户自定义配置。 |
| FR-06 | Codex OTel | Collector 接收 Codex OTLP/HTTP JSON 日志并规范化模型、Token、工具和来源信息。 |
| FR-07 | 本地用量扫描 | CLI 可执行单次或周期扫描，按客户端、会话和模型提交 Token、消息数和成本快照。 |
| FR-08 | 客户端诊断与同步 | CLI 可列出 `tokscale` 客户端状态，并为 Cursor、Antigravity、Trae、Warp 执行支持的同步流程。 |
| FR-09 | 本地会话内容 | Claude、Codex 和 OpenCode 会话可生成 Prompt/Turn 事件；用户可选择 `preview` 或 `metadata`。 |
| FR-10 | Run 列表 | Dashboard 展示 Run 分页、状态、来源、时间、模型、Token、耗时和成本，并支持刷新与选择。 |
| FR-11 | Run 详情 | Dashboard 展示摘要、事件分页、筛选、可见性、时间线、调用树和原始事件字段。 |
| FR-12 | 诊断 | 系统识别重复动作、重试循环、慢步骤、Token 热点和失败级联，提供失败检查结果，并可从诊断定位到任一关联事件。 |
| FR-13 | 用量与成本 | Dashboard 汇总客户端和模型 Token；优先显示扫描成本，否则使用精确配置价格。 |
| FR-14 | 数据删除 | 用户可删除一个或多个 Run；删除 Run 时级联删除其 Event。 |
| FR-15 | 桌面端编排 | Windows Tauri 桌面端在进程内启动 Rust Collector、原生 Scanner 和静态 Dashboard，并管理数据库与固定回环端口。 |
| FR-16 | 桌面关闭行为 | 关闭主窗口时应用隐藏到托盘；用户可从托盘重新打开窗口或显式退出。 |
| FR-17 | 双语与主题 | Dashboard 支持中文/英文界面和明暗主题。 |
| FR-18 | Scanner 状态 | Dashboard 可显示最近扫描时间、客户端诊断、警告和操作提示。 |
| FR-19 | 通用 SDK Step | SDK 可记录任意共享 Event 类型；嵌套步骤自动继承父 Event，显式 `parentId` 可覆盖。 |
| FR-20 | Run 组织与标注 | 用户可编辑项目、环境、版本、标签、备注与收藏状态，并按项目、环境、标签和收藏筛选。 |
| FR-21 | 维护与隐私中心 | Dashboard 可查看容量、清理与压缩数据、恢复墓碑，并配置持久化的写入前敏感字段脱敏。 |
| FR-22 | 事件差异与回归 | Run 对比按事件签名匹配并识别状态、缺失、耗时和 Token 回归。 |
| FR-23 | Agent 评测 | 用户可创建评测集与用例，把 Run 绑定为多维评分结果并获得加权质量分。 |
| FR-24 | 多维分析与预算 | Dashboard 可按项目、环境、模型和来源聚合指标，设置日/月成本、Token 和 Run 数预算并查看告警。 |
| FR-25 | Python SDK 与 OTLP | Python SDK 支持嵌套 Step、OpenAI 与 LangChain 适配；Collector 接收通用 OTLP Trace。 |
| FR-26 | 安全回放与调试沙箱 | 用户可在网页选择源 Run/Event，以覆盖输入和 Mock 输出创建隔离回放任务；任务支持超时、取消与临时目录清理，并生成可对比的新 Run。 |

## 非功能需求

| 编号 | 需求 | 验收标准 |
| --- | --- | --- |
| NFR-01 | 本地优先 | Collector 默认监听 `127.0.0.1:4319`，数据库默认位于本地文件；不要求远程账户。 |
| NFR-02 | 非侵入性 | SDK 投递失败不改变 Agent 结果；Hook/OTel/扫描接收错误不向上游返回失败状态。 |
| NFR-03 | 有界等待 | SDK 默认投递超时 1000 ms；Hook 命令超时 5 秒；`tokscale` 默认命令超时 60 秒。 |
| NFR-04 | 数据完整性 | SQLite 外键级联删除 Event；迁移事务化执行；高于当前版本的数据库拒绝打开。 |
| NFR-05 | 查询上限 | Run 默认每页 50、最大 200；Event 默认每页 100、最大 500。 |
| NFR-06 | 隐私可控 | Hooks 固定使用 metadata 脱敏；历史内容可切换为不包含文本的 metadata 模式；用户可配置后续写入的敏感字段名与替换文本。 |
| NFR-07 | 可解释估算 | Token 来源区分 official、scan、estimate；界面明确标识估算成本和未定价模型。 |
| NFR-08 | 向后兼容 | 关键路径继续接受 `TOOLTRACE_*` 旧环境变量，并迁移旧 usage-scan 记录。 |
| NFR-09 | 故障隔离 | Scanner 故障不阻止桌面 Collector 与 Dashboard 启动；周期扫描不重叠。 |
| NFR-10 | 可维护性 | Schema、SDK、Server、Web、CLI 和 Desktop 均提供构建、类型检查或测试入口。 |
| NFR-11 | 文档一致性 | 相对链接可解析；Collector 路由与 API/OpenAPI 一致；运行时环境变量和 CLI 主命令均有文档。 |

## 数据约束

### Run

- `id`、`name`、`status` 必填。
- `startedAt` 创建时可省略，由服务端存储层补齐；查询结果始终包含。
- `endedAt`、`input`、`output`、`error`、`metadata` 可选。

### Event

- `id`、`runId`、`type`、`name`、`status` 必填。
- `timestamp` 创建时可省略。
- `parentId` 可选，用于树形关系。
- `durationMs` 必须是非负整数。
- Token 字段必须是非负整数；成本必须是非负数。

### 事件类型

`run_started`、`run_ended`、`step_started`、`step_ended`、`llm_call`、`tool_call`、`retrieval`、`memory_update`、`error`。

## 需求与验证映射

| 需求 | 主要实现 | 主要验证 |
| --- | --- | --- |
| FR-01、FR-02、FR-06、FR-14 | `apps/server/src/app.ts`、`storage.ts` | `smoke.ts`、`read-model.smoke.ts`、`migrations.smoke.ts` |
| FR-03、NFR-02、NFR-03 | `packages/sdk-js/src/index.ts` | `packages/sdk-js/src/smoke.ts` |
| FR-04、FR-05、FR-08 | `packages/cli/src/hooks.ts`、`index.ts` | `packages/cli/src/smoke.ts` |
| FR-07、FR-09、FR-18 | CLI scanner、Server usage/transcript 存储 | CLI transcript smoke、Server usage/transcript API smoke |
| FR-10、FR-11、FR-17 | `apps/web/src/app/runs` | Web cost、scanner status、trace tree smoke |
| FR-12 | Server trace insights、Web failure inspector 与诊断定位 | `trace-insights.smoke.ts`、`trace-tree.smoke.ts`、`trace-navigation.smoke.ts` |
| FR-22、FR-24 | Server analytics、预算与 Web 分析页 | `run-analytics.smoke.ts`、`analytics-budget.smoke.ts` |
| FR-23 | Server evaluation 存储、API 与 Web 评测页 | `evaluations.smoke.ts` |
| FR-25 | `packages/sdk-python`、OTLP Trace normalizer | Python unittest、`otlp-traces.smoke.ts` |
| FR-26 | `apps/server/src/replay-sandbox.ts`、`apps/web/src/app/sandbox` | `replay-sandbox.smoke.ts`、`sandbox-page.smoke.ts` |
| FR-15、FR-16 | `apps/desktop-tauri/src-tauri/src/lib.rs` | `apps/desktop-tauri/scripts/check-ui.mjs`、`cargo test -p agent-trace-desktop` |
| NFR-04、NFR-05、NFR-08 | migrations、分页读模型、兼容环境变量 | migrations、read-model、startup smoke |
| NFR-10、NFR-11 | 根脚本、文档检查和 CI | `workspace-scripts.*`、`docs-check.mjs`、`.github/workflows/ci.yml` |
