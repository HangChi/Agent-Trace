# ADR-0004：Dashboard 默认使用有界分页 Read Model

- 状态：Accepted
- 日期：2026-07-12

## Context

Run 和 Event 数量会随本地历史增长。旧接口返回完整数组，页面加载时间和内存占用随数据量无界增长，也无法稳定承载筛选、Facet 和诊断定位。

## Decision

- `GET /runs` 默认返回 `DashboardRunPage`，Run 页大小默认 50、最大 200。
- `GET /runs/:id/events` 默认返回 `DashboardEventPage`，Event 页大小默认 100、最大 500。
- 过滤、可见性、Facet、汇总和 Trace Insight 属于服务端 Read Model。
- 旧客户端可显式使用 `legacy=1|true` 获取不分页数组；新代码和测试应默认验证分页契约。

## Consequences

- Dashboard 请求和响应大小有界，并能跨分页定位诊断证据。
- 兼容路径必须明确标记，避免测试无意依赖旧数组。
- Read Model 查询仍需持续优化，确保分页不会先扫描全部数据。

## Alternatives considered

- 保持完整数组并只在前端分页：网络和内存仍无界。
- 立即删除旧接口：会破坏已有本地客户端和迁移期测试。
