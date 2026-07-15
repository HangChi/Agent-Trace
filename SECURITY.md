# 安全策略

## 支持范围

仓库目前没有带 Git Tag 的正式发行线。安全修复以当前 `main` 为准；Windows 桌面包的版本号不等同于长期支持承诺。发布与版本规则见[发布策略](docs/release-policy.md)。

## 安全模型

Agent-Trace 面向单机开发环境：

- Collector 默认监听 `127.0.0.1`。
- Collector 没有认证、授权或多租户隔离。
- 数据默认写入本机 SQLite。
- CORS 仅限制浏览器来源，不是服务端身份认证。

不要把 Collector 直接暴露到公网或不可信局域网。非回环监听需要由部署方提供防火墙、反向代理认证和网络隔离。

## 报告安全问题

不要在公开 Issue 中提交密钥、Prompt、文件内容、完整数据库、用户目录或未经脱敏的命令行。

1. 优先使用仓库托管平台提供的私有安全报告渠道或组织内部安全渠道联系维护者。
2. 如果没有私有渠道，可创建一个不包含漏洞细节和敏感数据的普通 Issue，请求维护者提供私下联系方式。
3. 报告中说明受影响版本/提交、影响、复现条件和建议缓解措施；附件应先脱敏。

当前仓库没有公开安全邮箱，因此本文不虚构联系人。维护者配置私有渠道后应在此补充准确地址。

## 敏感数据响应

若怀疑 Agent-Trace 已记录敏感内容：

1. 停止 Collector、Scanner 和桌面端。
2. 撤销可能泄露的凭据。
3. 备份证据后，清理 Agent-Trace 数据库及对应 WAL/SHM。
4. 检查 Codex、Claude Code、OpenCode 或其他源历史；删除 Agent-Trace Run 不会删除源历史。
5. 将 `AGENT_TRACE_HISTORY_CONTENT` 切换为 `metadata`，并审查 SDK 输入输出和 Shell 命令。

详细采集范围见[隐私与安全](docs/privacy-security.md)。
