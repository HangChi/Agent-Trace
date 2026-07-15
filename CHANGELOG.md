# 变更记录

本文件记录用户可见的重要变化，格式参考 Keep a Changelog。仓库目前没有 Git Tag；下列内容均属于未发布状态，桌面包中的版本号只表示打包产物版本。

## Unreleased

### Added

- 本地优先的 Run/Event Collector、TypeScript SDK 和双语 Dashboard。
- Codex 与 Claude Code 全局 Hooks，以及 Codex OTel JSON 日志接入。
- `tokscale` 本地 Usage Scanner、客户端诊断、同步和 Transcript 采集。
- Run 分页、事件筛选、时间线、父子调用树、失败检查和确定性 Trace Insight。
- Windows Electron 桌面编排、托盘关闭偏好和 NSIS 打包。
- 文档一致性检查、OpenAPI、英文使用/接口/部署/安全文档与 CI。

### Changed

- Usage Snapshot 与 Trace Event 分离，避免扫描数据污染运行轨迹。
- Run/Event 查询默认返回有界分页 Read Model；旧客户端可使用 `legacy=1|true`。
- 成本统一解释为 API 等价估算，模型价格只做精确匹配。
- Node.js 基线明确为 `>=22.12.0`，pnpm 支持 `>=11.0.7 <12` 并在 CI 固定为 11.0.7。

### Fixed

- Codex 活跃/归档历史协调、Token 重复计算和 Scanner 启动可靠性。
- 异常父子关系下的 Trace Tree 保留、诊断定位和跨分页导航。
- 过期 smoke 断言与分页响应契约不一致的问题。

完整的逐日工程演进见[开发历史](docs/development-history.md)。
