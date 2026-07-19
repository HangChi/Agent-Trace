# 变更记录

本文件记录用户可见的重要变化，格式参考 Keep a Changelog。仓库目前没有 Git Tag；下列内容均属于未发布状态，桌面包中的版本号只表示打包产物版本。

## Unreleased

### Added

- 本地优先的 Run/Event Collector、TypeScript SDK 和双语 Dashboard。
- Codex 与 Claude Code 全局 Hooks，以及 Codex OTel JSON 日志接入。
- `tokscale` 本地 Usage Scanner、客户端诊断、同步和 Transcript 采集。
- Run 分页、事件筛选、时间线、父子调用树、失败检查和确定性 Trace Insight。
- Windows Tauri 桌面端、静态 UI、全 Rust Collector、原生 Usage Scanner、托盘交互和 NSIS 打包。
- 文档一致性检查、OpenAPI、英文使用/接口/部署/安全文档与 CI。
- SDK 通用 Step、异步自动父子链路和 Run 级组织 metadata。
- Run 项目/环境/版本/标签/备注/收藏编辑与筛选。
- Dashboard 维护与隐私中心、墓碑列表和持久化写入前字段脱敏。
- Event 级 Run 回归检测、Agent 评测集、加权质量评分、多维分析、预算告警、Python SDK、通用 OTLP Trace 与 OpenAI/LangChain 适配。

### Changed

- Usage Snapshot 与 Trace Event 分离，避免扫描数据污染运行轨迹。
- Run/Event 查询默认返回有界分页 Read Model；旧客户端可使用 `legacy=1|true`。
- 成本统一解释为 API 等价估算，模型价格只做精确匹配。
- Node.js 基线明确为 `>=22.12.0`，pnpm 支持 `>=11.0.7 <12` 并在 CI 固定为 11.0.7。

### Fixed

- 桌面端复用源码 Collector 后会持续监测其状态；源码进程退出时，桌面端自动接管 4319 并启动原生 Scanner，页面无需重启即可恢复。
- Codex 会话优先显示 `session_index.jsonl` 中的官方 `thread_name`；其他来源缺少显式标题时使用最多 40 字符的本地短标题，Web 与桌面列表均保持单行省略展示。
- 桌面端现在会安全复用已运行的源码 Collector，不再因 Web 端占用 4319 而闪退；非 Agent-Trace 端口占用仍会明确失败。
- Codex 与 Claude Code 历史会话现在使用清理后的首条用户消息作为可读 Run 标题，并只替换系统生成的 ID 名称；Web 与 Tauri 桌面列表的字体和数据排版保持一致。
- Tauri 原生 Usage Scanner 现在按精确模型价格计算 API 等价成本，并让 Run 读模型保留扫描成本；Windows 托盘始终使用可辨识的应用图标，退出时也不会被 SSE 长连接阻塞。
- 源码模式现在会验证并复用已运行的 Agent-Trace Collector，避免桌面端仍在托盘时因 4319 端口冲突导致 Web 开发进程崩溃；非兼容占用会返回明确错误。
- Claude Code Hooks 现在显式选择平台 Shell，采集服务不可用时在 PowerShell、Git Bash 和 POSIX Bash 中均不会阻断 Agent；重新安装会迁移旧的 CMD 风格托管条目。
- Codex 活跃/归档历史协调、Token 重复计算和 Scanner 启动可靠性。
- 异常父子关系下的 Trace Tree 保留、诊断定位和跨分页导航。
- 过期 smoke 断言与分页响应契约不一致的问题。

完整的逐日工程演进见[开发历史](docs/development-history.md)。
