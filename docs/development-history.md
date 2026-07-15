# Agent-Trace 开发历史

## 2026-06-16：基础观测闭环

- 初始化 pnpm monorepo。
- 建立共享 trace event 契约、SQLite 存储和 Hono ingestion/query API。
- 增加 JavaScript/TypeScript SDK 与 simple-agent 示例。
- 完成 Run 列表、时间线详情和第一版 Failure Inspector。
- 增加本地开发 CLI，当时项目名称为 ToolTrace。

## 2026-06-17：外部 Agent 接入与交互完善

- 为外部 Agent 增加来源 metadata 和服务端规范化。
- 增加 Codex、Claude Code Hook ingestion，以及安装/卸载命令。
- 增加 Hook 冒烟示例和 Windows Hook 命令兼容。
- Dashboard 增加来源展示、中英文界面、刷新和删除控制。
- 逐步替换原生确认框并优化 Runs 页面视觉与交互。

## 2026-06-18：Token、筛选与成本

- 扩大 Token usage ingestion 范围并增加本地估算。
- 扩展 trace 布局、详情筛选和事件排序。
- 修正 stale/untracked Run、Codex surface 和 trace visibility。
- 增加 Claude Code Token 估算、批量删除和成本计算。
- 改进事件展示与错误诊断信息。

## 2026-06-19：模型支持与界面迭代

- 改进 Claude Code 模型归因和 Token 跟踪。
- 支持更多主流模型及 DeepSeek 精确价格配置。
- 改进来源提示、界面样式、主题切换和站点图标。

## 2026-06-20：项目更名

- 项目从 ToolTrace 更名为 Agent-Trace。
- 运行时继续保留部分 `TOOLTRACE_*` 环境变量兼容。

## 2026-06-24：Windows 桌面交付

- 增加 Electron Windows 桌面打包。
- 修正安装器运行时依赖和资源封装。
- 调整桌面 Runs 布局。

## 2026-06-25：桌面体验与读模型

- 增加退出/最小化到托盘选项、托盘支持和偏好保存。
- 增加 Run 表格列宽调整与响应式布局。
- 缩减桌面包体并优化 tiktoken 加载。
- 统一 Dashboard 读模型并重构 Hook ingestion normalizer。

## 2026-06-26：非阻塞 Hooks

- 修正 Agent Trace Hooks，使 Collector 故障不阻塞上游 Agent。
- 更新 Next.js 路由类型引用。

## 2026-07-09：多客户端本地用量

- 增加多 Agent/客户端 usage 扫描与汇总。

## 2026-07-10：历史准确性与桌面 Scanner

- 补齐 Token monitor 能力。
- 修正扫描 Token 总量和成本计算。
- 默认扫描可用客户端，并协调 Codex active/archived 历史。
- 使用完整 snapshot 替换 stale usage 数据。
- 桌面端启动 usage watcher，并修正 Windows 下 `tokscale` 启动路径。

## 2026-07-11：历史与成本可靠性

- 阻止普通工具输出中的 Token-like 数字污染模型用量。
- 提高本地历史 Scanner 启动可靠性。
- 将 Scanner 成本明确为 API 等价估算。

## 2026-07-12：扫描准确性与分页

- 修正 usage scan 客户端发现和数据准确性。
- 为大数据量查询补充分页行为。

## 2026-07-13：Usage 与 Trace 分离

- 将会话级 usage snapshot 从 trace Run/Event 存储中分离。
- 增加 OpenCode transcript、Scanner 状态和 usage API。
- 让会话详情与 live trace 在读模型层协调，而不是混用同一存储语义。

## 2026-07-14：稳定性、性能与诊断

- Collector 默认限制在回环地址并增加启动检查。
- 增加版本化 SQLite migration 和 stale Run 协调。
- 增加有界 SDK 投递。
- 优化 Run/Event 读模型与分页。
- 增加父子调用树，以及重复动作、重试循环、慢步骤、Token 热点和失败级联诊断。
- 强化根工作区脚本审计和各包验证入口。

## 2026-07-15：诊断导航与文档治理

- 增加从确定性诊断到任一关联 Event 的跨分页、跨可见性定位。
- 现代化 Console 界面，并同步用户手册、需求映射和 Web smoke。
- 明确 Node.js/pnpm 基线，补充中英文 README 与英文使用、API、部署、安全文档。
- 新增 OpenAPI、领域词汇表、ADR、贡献、安全、发布与变更记录。
- 增加文档链接、路由、环境变量和 CLI 一致性检查及 CI。
