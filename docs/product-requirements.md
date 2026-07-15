# Agent-Trace 产品需求文档

## 产品定义

Agent-Trace 是面向 AI Agent 开发者和本地 AI 编程工具使用者的运行观测工具。它在本机汇聚显式 SDK 埋点、Codex/Claude Code Hooks、Codex OTel 日志和本地会话用量，帮助用户回答以下问题：

- 一次 Agent 执行经过了哪些模型、工具、命令、MCP 或 Skill 步骤？
- 失败发生在哪里，前后有哪些关联事件？
- 哪些步骤重复、缓慢、形成重试循环或消耗了主要 Token？
- 本地不同客户端、会话和模型产生了多少 Token 与 API 等价估算成本？
- 数据是否仍保存在本机，哪些内容会被记录？

## 目标用户

| 用户 | 核心需求 |
| --- | --- |
| Agent 开发者 | 使用 SDK 观测自定义工作流，定位工具或模型步骤失败。 |
| Codex/Claude Code 使用者 | 无需修改 Agent 源码，查看生命周期、命令、工具和 Token 事件。 |
| 多客户端 AI 编程用户 | 汇总本机客户端的历史用量、会话和成本估算。 |
| 项目维护者 | 在本地复现运行问题，检查数据模型、接口和桌面交付链路。 |

## 产品目标

1. 用统一的 Run/Event 模型承接多种 Agent 数据源。
2. 默认在本机完成采集、存储和展示，不依赖托管后端。
3. 让 tracing 故障不改变被观测 Agent 的主要执行路径。
4. 同时提供运行级调试与会话级 Token/成本视角。
5. 对采集边界、估算数据和诊断依据保持可解释。

## 主要使用场景

### 自定义 Agent 调试

开发者使用 `@agent-trace/sdk` 创建 Run，以 `traceLLM` 和 `traceTool` 包装异步调用。成功输出、异常、耗时、父子关系和可选模型元数据写入 Collector，Dashboard 展示执行过程。

### Codex 与 Claude Code 观测

用户通过 CLI 安装全局 Hooks。Hooks 把生命周期和工具事件发送到本地 Collector；Codex 安装流程还配置 OTel JSON 日志出口，以补充模型与 Token 遥测。

### 本地用量与会话汇总

CLI 调用 `tokscale` 扫描支持的本地客户端，按客户端、会话和模型汇总 Token 与成本。Codex 活跃/归档历史会被协调去重，Claude、Codex 和 OpenCode 可额外生成 Prompt/Turn 元数据或清理后的短预览。

### 运行分析

用户在 Dashboard 查看运行分页、状态、来源、模型、Token、耗时和成本，进入详情后筛选事件、切换时间线或树形视图，并查看失败提示及重复动作、重试循环、慢步骤、Token 热点和失败级联等确定性诊断。

## 当前产品范围

### 包含

- TypeScript SDK 手动埋点。
- Codex 与 Claude Code 用户级 Hooks 安装和卸载。
- Codex OTel JSON 日志接收。
- `tokscale` 本地用量扫描、客户端诊断与部分客户端同步。
- SQLite 数据库与自动迁移。
- Run/Event 创建、查询、分页、筛选和删除接口。
- 双语 Web Dashboard、主题切换与 Windows Electron 桌面端。
- 本地历史 Prompt/Turn 预览或纯元数据模式。
- Token 汇总和 API 等价成本估算。
- 通用 SDK Step 与自动父子链路。
- Run 项目、环境、版本、标签、备注和收藏。
- Dashboard 维护与隐私控制中心。
- Event 级 Run 差异与回归检测。
- Agent 评测集、加权质量评分、多维分析、预算与告警。
- Python SDK、通用 OTLP Trace、OpenAI 与 LangChain 适配。

### 不包含

- 云端托管、跨设备同步或团队共享空间。
- 用户账户、登录、权限系统或多租户隔离。
- 面向公网的 Collector 部署方案。
- 对所有 Agent 框架的自动埋点。
- 订阅账单核对、实际扣费证明或通用财务记账。
- macOS/Linux 桌面安装包配置。

## 核心业务规则

- Run 状态为 `running`、`success` 或 `error`；Event 使用相同状态集合。
- Event 可通过 `parentId` 形成父子调用树；异常父引用或环不会丢弃事件。
- Hooks 与 OTel 接收端即使规范化失败也返回 202，并在响应中报告未存储原因，避免阻塞上游 Agent。
- SDK 单次投递有界超时且吞掉 tracing 投递错误；被包装函数的返回值和异常语义保持不变。
- 完整 usage snapshot 只替换本次明确协调过的客户端数据，不删除 Hook 或 OTel 事件。
- Scanner 提供的 `costUsd` 优先；缺少扫描成本时只使用精确配置的模型价格，不按相似名称猜价。
- 成本始终解释为 API 等价估算，而非订阅账单。

## 验收结果

- 用户可以从源码启动本地 Collector 与 Dashboard，并生成、查看和删除示例 Run。
- SDK、Hooks、OTel 和 usage scan 都能进入统一的本地读模型。
- Run 列表和事件详情在大数据量下支持有界分页。
- 本地历史扫描失败不会阻止 Collector、Dashboard 或桌面窗口启动。
- metadata Hooks 不保存原始 Prompt、普通工具完整输入/输出或隐藏推理。
- 仓库的构建、测试、类型检查、Lint 和差异检查提供可重复的验证入口。
