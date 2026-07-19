# 参与贡献

感谢你改进 Agent-Trace。项目强调本地优先、非侵入观测、隐私可控和可解释诊断；提交前请先阅读[领域词汇表](CONTEXT.md)与[架构决策记录](docs/adr/README.md)。

## 开发环境

- Node.js `>=22.12.0`（推荐使用 `.nvmrc` 中的 Node.js 22）。
- pnpm `>=11.0.7 <12`；可复现安装和 CI 固定使用 11.0.7。
- 完整验证和 Tauri 桌面开发需要 Rust stable；Windows 桌面安装包还需要 Windows x64、MSVC C++ Build Tools 与 Windows SDK。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

首次构建不可省略，因为 `examples/simple-agent` 会解析工作区 SDK 的 `dist` 类型入口。

## 开发流程

1. 从最新主分支创建短生命周期分支。
2. 先添加能复现问题或定义行为的测试。
3. 只修改完成当前目标所需的文件。
4. 跨包契约先改 `packages/schema`，再更新生产者、消费者和文档。
5. 运行完整验证并检查差异。

```bash
pnpm verify
git diff --check
git status --short
```

## 变更要求

### HTTP 路由

新增或修改 Collector 路由时，必须同步：

- `apps/server/src/app.ts`
- 对应 Server smoke 测试
- `docs/api-reference.md` 的路由总览与端点说明
- `docs/openapi.yaml`

`pnpm docs:check` 会比较代码、API 路由表和 OpenAPI。

### CLI

修改命令或参数时，必须同步 CLI Help、`docs/user-guide.md` 和相关 smoke 测试。

### 环境变量

新增 `AGENT_TRACE_*` 变量时，应在 `docs/deployment-operations.md` 说明用途、默认值、优先级和旧变量兼容关系。

### 数据库

- 只通过版本化 migration 修改结构。
- migration 必须事务化并覆盖空库、升级、数据保留和未来版本拒绝。
- 不得假设用户数据库为空。

### 文档

- 使用 UTF-8 和 GitHub Flavored Markdown。
- 相对链接必须可解析。
- 示例必须与当前命令、端口和响应契约一致。
- 用户可见行为变化应更新 `CHANGELOG.md`。
- 重要且长期有效的架构决定应新增或修订 ADR。

## Pull Request 检查清单

- [ ] 变更范围与问题描述一致，没有无关重构。
- [ ] 新行为有自动化测试或明确的手工验收步骤。
- [ ] `pnpm verify` 通过。
- [ ] Schema、API、CLI、环境变量和用户文档已同步。
- [ ] 隐私、兼容性、数据迁移和桌面打包影响已评估。
- [ ] 未提交数据库、WAL/SHM、`dist`、`.next`、安装包、运行时或本地配置。

## 报告问题

一般缺陷请提供复现步骤、预期/实际结果、操作系统、Node/pnpm 版本以及经过脱敏的日志。安全问题不要附带敏感数据公开提交，按 [SECURITY.md](SECURITY.md) 处理。
