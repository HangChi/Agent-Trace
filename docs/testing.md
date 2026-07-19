# Agent-Trace 测试文档

## 测试目标

测试覆盖共享契约、SDK 非侵入投递、CLI/Hooks、Collector API 与存储、usage/transcript、Dashboard 读模型、桌面打包静态约束和工作区脚本一致性。

这些测试以 smoke 和类型检查为主，不包含浏览器端端到端自动化、真实 Codex/Claude Code 在线调用或正式安装包验收。

## 首次运行

在干净 checkout 中先安装依赖并构建工作区：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

如果直接运行 `pnpm test`，`examples/simple-agent` 可能因 SDK 的 `dist` 类型入口尚未生成而失败。该错误属于初始化顺序，不代表示例源码测试失败。

## 自动化测试入口

| 范围 | 命令 | 覆盖内容 |
| --- | --- | --- |
| 根目录 | `pnpm test` | Schema 构建、工作区脚本审计、根 Node 测试、全部包测试。 |
| 文档 | `pnpm docs:check` | 相对链接、API 路由、OpenAPI、环境变量和 CLI 命令。 |
| Schema | `pnpm --filter @agent-trace/schema test` | TypeScript 与 Zod 契约类型检查。 |
| SDK | `pnpm --filter @agent-trace/sdk test` | Run 创建、步骤成功/失败、父 ID、metadata、投递超时与不干扰主流程。 |
| CLI | `pnpm --filter @agent-trace/cli test` | Hooks 安装/卸载、帮助/参数、usage 规范化、历史协调、transcript 解析。 |
| Server | `pnpm --filter @agent-trace/server test` | 迁移、API、启动、读模型、Provider/Token 黄金 fixtures、数据治理、诊断、脱敏导出、Run 对比/趋势、usage 和 transcript 存储。 |
| Shared Dashboard | `pnpm --filter @agent-trace/dashboard-ui test` | 八个页面导出、默认过滤、管理工作流和 Web/Tauri 共用契约。 |
| Web | `pnpm --filter @agent-trace/web test` | 共享页面入口、成本、分页/排序、事件可见性和诊断定位。 |
| Tauri Desktop | `pnpm desktop:check:rust` | 共享 UI/Tauri 契约、Rust Collector/Scanner 测试、桌面 crate 编译测试与工作区 Clippy。 |
| Desktop 安装包 | `desktop-release-validation.yml` | 在 Windows CI 构建 Tauri NSIS，并确认只生成一个安装器。 |
| 容量基准 | `pnpm --filter @agent-trace/server benchmark:capacity` | 10 万 Run / 100 万 Event 下的列表延迟、Event 延迟、堆内存和数据库体积预算。 |
| Example | `pnpm --filter simple-agent test` | 示例 TypeScript 类型检查。 |

## Server 测试组成

`apps/server` 的测试按以下顺序运行：

1. `migrations.smoke.ts`：空库迁移、旧结构升级、未来版本拒绝和数据保留。
2. `smoke.ts`：Run/Event 写入、Hooks、OTel、删除和基础 API。
3. `start.smoke.ts`：端口、主机、启动与 stale 协调定时器。
4. `read-model.smoke.ts`：Run/Event 分页、筛选、汇总和大数据量行为。
5. `run-export.smoke.ts`：脱敏导出不泄露 Prompt、路径、会话 ID、错误或原始标识。
6. `run-analytics.smoke.ts`：2–5 Run 对比和连续 UTC 日趋势聚合。
7. `trace-insights.smoke.ts`：重复动作、重试、慢步骤、Token 热点和失败级联。
8. `usage-api.smoke.ts`：用量与 Scanner 查询接口。
9. `usage-storage.smoke.ts`：完整/部分快照替换和客户端隔离。
10. `transcript-api.smoke.ts`：Transcript ingestion、更新和清理。
11. `data-governance.smoke.ts`：删除墓碑、Scanner 防复活、显式恢复、保留期清理与容量计数。

`normalizers/provider-token-adapter.smoke.ts` 在主 Server smoke 前运行，通过 JSON 黄金 fixtures 锁定 OpenAI、Anthropic、Gemini、Cohere 和 Bedrock 用量规范化。

`change-feed.smoke.ts` 验证修订号、订阅和取消订阅；Web `live-refresh.smoke.ts` 验证 SSE 变更刷新与 15 秒故障回退，并禁止恢复 2 秒整页轮询。

Web `event-visibility.smoke.ts` 锁定 `display`、`hidden`、`all` 三态的计数、说明和切换目标，防止“全部事件”再次被误标为“显示已隐藏事件”。

Web `run-sorting.smoke.ts` 锁定 Tokens、成本、开始时间和耗时表头的激活状态、新列默认降序，以及重复点击最终恢复默认排序。

## 性能预算

每周 `performance.yml` 执行 10 万 Run / 100 万 Event 基准。默认门槛：Run 分页 1500 ms、Event 分页 500 ms、单次查询堆增量 512 MiB、SQLite 体积 2048 MiB。可通过 `AGENT_TRACE_BENCHMARK_*` 环境变量收紧或放宽。

测试使用临时 SQLite 数据库，不应依赖或修改开发者的 `agent-trace.db`。

## CLI 测试重点

- Codex/Claude Code 配置不存在、已有自定义项、重复安装和卸载。
- 配置修改前备份，旧管理标记兼容。
- Codex `[otel]` 表更新、surface 和 endpoint。
- Windows/Posix Hook 命令及超时。
- `tokscale` 行、客户端诊断、总 Token 和成本规范化。
- Codex active/archived 历史去重与补扫。
- Claude/Codex/OpenCode transcript 的 preview/metadata 行为。
- Prompt 预览清理、240 字符截断和工具/Token 提取。

## Web 测试重点

- 扫描成本优先、精确价格回退、缓存 Token 计费和未定价模型。
- Scanner 状态的 stale、missing、needs sync 和提示文案。
- Trace tree 的父子排序、孤儿、环、自引用和所有事件不丢失。
- 五类确定性诊断的中英文标题与证据格式。
- 诊断位置锚点的稳定性，以及定位链接对事件 ID、全部可见范围、当前视图和语言的保留。

## 需求覆盖

| 需求组 | 自动化证据 |
| --- | --- |
| Run/Event CRUD 与校验 | Server API、read-model、migration smoke |
| SDK 非侵入性与有界投递 | SDK smoke |
| Hooks/OTel 接入 | CLI smoke、Server smoke |
| Usage 与 transcript | CLI transcript、Server usage/transcript smoke |
| 分页、筛选、树形展示 | Server read-model、Web trace tree smoke |
| Token 与成本 | Server read-model、Web cost smoke |
| 确定性诊断 | Server trace insights、Web trace tree 与 trace navigation smoke |
| 桌面编排和打包约束 | Tauri UI check、Rust tests 与 Clippy |
| 根脚本真实性 | `workspace-scripts.smoke.mjs` 与 `.test.mjs` |

完整的 FR/NFR 映射见[需求规格说明](requirements-specification.md#需求与验证映射)。

## 手工验收场景

### 源码启动

1. 执行 `pnpm build`。
2. 执行 `node packages/cli/dist/index.js dev --usage-scan=false`。
3. 请求 `GET http://127.0.0.1:4319/health`，确认 `ok: true`。
4. 打开 `/runs`，确认页面可加载。
5. 运行 `pnpm --filter simple-agent dev`，确认新 Run 出现并可打开。
6. 删除该 Run，确认列表中不再出现。

### Hooks

1. 把 `CODEX_HOME`/`CLAUDE_CONFIG_DIR` 指向临时目录。
2. 安装目标 Hook，检查管理标记和备份。
3. 重复安装，确认没有重复管理组。
4. 运行 `examples/agent-hook-smoke.mjs`，确认 Collector 接收事件。
5. 卸载，确认用户自定义配置仍存在。

### Usage

1. 运行 `usage clients --home <home>`，记录诊断。
2. 运行 `usage --once --history-content metadata`。
3. 检查 `/usage/summary`、`/usage/scanner` 和 Dashboard。
4. 确认 metadata 模式没有 Prompt 文本。
5. 对 preview 模式使用非敏感 fixture，确认预览长度和清理结果。

### Windows 桌面端

1. 运行 `pnpm desktop:pack:win` 并启动 release 可执行文件。
2. 确认 Collector、静态 Dashboard 和 Scanner 生命周期；第二个实例或源码 Collector 已运行时，桌面端应复用兼容 Collector 且不会闪退。
3. 关闭被桌面端复用的源码 Collector，确认桌面端自动接管 4319、启动原生 Scanner，并让页面恢复加载。
4. 确认 Codex 原生扫描将缓存输入作为总输入的子集：普通输入、缓存输入与输出之和应等于官方 `total_tokens`，缓存输入不得重复计费。
5. 确认关闭窗口会隐藏到托盘，托盘可重新打开窗口并显式退出。
6. 使用非 Agent-Trace 服务占用 `4319` 后启动，确认错误清晰且不会打开不可用窗口。
7. 运行 `pnpm desktop:build:win`，确认 `target/release/bundle/nsis` 生成安装器并完成安装/卸载检查。

## 完整验证

```bash
pnpm verify
git diff --check
```

`pnpm verify` 按 build、test、typecheck、lint 顺序执行；lint 会运行 `pnpm docs:check`。文档变更还应验证：

- 所有相对 Markdown 链接可解析。
- 不存在指向已删除过程产物或旧追踪指南的链接。
- API 路由与 `apps/server/src/app.ts` 一致。
- CLI 命令与 `packages/cli/src/index.ts` 的 help 一致。
- `git status --short` 只包含预期文档变更。

CI 工作流在 push 和 pull request 中使用 Node.js 22、pnpm 11.0.7，并执行相同的 `pnpm verify`。
