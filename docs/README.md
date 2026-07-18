# Agent-Trace 文档

本目录描述 Agent-Trace 当前实现的产品能力、使用方式、架构、接口、开发流程和运行边界。若文档与代码不一致，以共享 Schema、服务端路由、CLI 帮助和测试为准。

[English documentation](en/README.md)

> [!NOTE]
> 文档最后完成代码交叉校验的日期为 2026-07-15。`pnpm docs:check` 会检查相对链接、Collector 路由、OpenAPI、环境变量和 CLI 命令的一致性。

## 按角色阅读

### 使用者

1. [用户手册](user-guide.md)：启动、接入、查看与排障。
2. [隐私与安全](privacy-security.md)：采集内容、本地存储和成本含义。
3. [部署与运维](deployment-operations.md)：端口、数据目录、环境变量和桌面构建。
4. [Tauri 桌面架构](desktop-tauri.md)：桌面专用 Rust 重构范围、兼容边界和构建产物。

### 产品与项目管理

1. [产品需求文档](product-requirements.md)：产品目标、用户、场景和范围。
2. [需求规格说明](requirements-specification.md)：功能与非功能需求、验收映射。
3. [开发历史](development-history.md)：依据 Git 演进整理的里程碑。

### 研发与测试

1. [系统架构](architecture.md)：模块、数据流、存储和关键设计约束。
2. [API 参考](api-reference.md)：Collector HTTP 接口和共享数据契约。
3. [开发指南](development-guide.md)：工作区、首次初始化和常用命令。
4. [测试文档](testing.md)：测试层次、执行方法和需求覆盖关系。

### 维护与治理

1. [领域词汇表](../CONTEXT.md)：Run、Event、Snapshot、Read Model 等统一语言。
2. [架构决策记录](adr/README.md)：本地优先、统一模型、Usage 分离和分页契约。
3. [参与贡献](../CONTRIBUTING.md)：开发流程、变更边界和 PR 检查清单。
4. [安全策略](../SECURITY.md)：安全模型、漏洞报告和敏感数据响应。
5. [变更记录](../CHANGELOG.md)：用户可见变化。
6. [发布与版本策略](release-policy.md)：版本来源、发布检查和许可证状态。

## 快速导航

| 目标 | 文档 |
| --- | --- |
| 启动本地 Collector 与 Dashboard | [用户手册](user-guide.md#从源码启动) |
| 接入自定义 TypeScript Agent | [用户手册](user-guide.md#接入-typescript-sdk) |
| 安装 Codex 或 Claude Code Hooks | [用户手册](user-guide.md#安装全局-tracing-hooks) |
| 理解本地历史与 Token 扫描 | [用户手册](user-guide.md#扫描本地用量与会话) |
| 检查会采集哪些内容 | [隐私与安全](privacy-security.md#采集边界) |
| 调用 Collector API | [API 参考](api-reference.md) |
| 使用机器可读接口契约 | [OpenAPI](openapi.yaml) |
| 开发或验证代码 | [开发指南](development-guide.md) · [测试文档](testing.md) |
| 构建 Windows 桌面包 | [部署与运维](deployment-operations.md#windows-桌面构建) |
| 理解桌面端为何不再携带 Node | [Tauri 桌面架构](desktop-tauri.md) |
| 理解长期架构决定 | [ADR 索引](adr/README.md) |

## 术语

- **Run**：一次 Agent 执行，对应一条运行记录。
- **Event**：Run 内的一个生命周期、模型、工具、检索、记忆或错误事件。
- **Collector**：接收、规范化并持久化数据的本地服务；源码版为 Hono，桌面版为 Rust/Axum。
- **Dashboard**：读取 Collector 数据的界面；源码版为 Next.js，桌面版为静态 WebView UI。
- **Usage snapshot**：本地会话 Token 与成本快照；源码版由 `tokscale` 生成，桌面版由 Rust 原生扫描器生成。
- **Transcript event**：从支持的本地历史中提取的 Prompt/Turn 元数据或清理后预览。

完整定义及不变量见[领域词汇表](../CONTEXT.md)。
