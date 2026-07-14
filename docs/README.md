# Agent-Trace 文档

本目录描述 Agent-Trace 当前实现的产品能力、使用方式、架构、接口、开发流程和运行边界。若文档与代码不一致，以共享 Schema、服务端路由、CLI 帮助和测试为准。

## 按角色阅读

### 使用者

1. [用户手册](user-guide.md)：启动、接入、查看与排障。
2. [隐私与安全](privacy-security.md)：采集内容、本地存储和成本含义。
3. [部署与运维](deployment-operations.md)：端口、数据目录、环境变量和桌面构建。

### 产品与项目管理

1. [产品需求文档](product-requirements.md)：产品目标、用户、场景和范围。
2. [需求规格说明](requirements-specification.md)：功能与非功能需求、验收映射。
3. [开发历史](development-history.md)：依据 Git 演进整理的里程碑。

### 研发与测试

1. [系统架构](architecture.md)：模块、数据流、存储和关键设计约束。
2. [API 参考](api-reference.md)：Collector HTTP 接口和共享数据契约。
3. [开发指南](development-guide.md)：工作区、首次初始化和常用命令。
4. [测试文档](testing.md)：测试层次、执行方法和需求覆盖关系。

## 快速导航

| 目标 | 文档 |
| --- | --- |
| 启动本地 Collector 与 Dashboard | [用户手册](user-guide.md#从源码启动) |
| 接入自定义 TypeScript Agent | [用户手册](user-guide.md#接入-typescript-sdk) |
| 安装 Codex 或 Claude Code Hooks | [用户手册](user-guide.md#安装全局-tracing-hooks) |
| 理解本地历史与 Token 扫描 | [用户手册](user-guide.md#扫描本地用量与会话) |
| 检查会采集哪些内容 | [隐私与安全](privacy-security.md#采集边界) |
| 调用 Collector API | [API 参考](api-reference.md) |
| 开发或验证代码 | [开发指南](development-guide.md) · [测试文档](testing.md) |
| 构建 Windows 桌面包 | [部署与运维](deployment-operations.md#windows-桌面构建) |

## 术语

- **Run**：一次 Agent 执行，对应一条运行记录。
- **Event**：Run 内的一个生命周期、模型、工具、检索、记忆或错误事件。
- **Collector**：接收、规范化并持久化数据的本地 Hono 服务。
- **Dashboard**：读取 Collector 数据的 Next.js 界面。
- **Usage snapshot**：由 `tokscale` 扫描得到的本地会话 Token 与成本快照。
- **Transcript event**：从支持的本地历史中提取的 Prompt/Turn 元数据或清理后预览。
