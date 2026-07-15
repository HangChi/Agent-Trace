# ADR-0001：本地优先与回环 Collector

- 状态：Accepted
- 日期：2026-06-16

## Context

Agent-Trace 处理 Prompt、命令、工具元数据和模型用量。这些内容可能包含源代码路径、凭据或个人信息。产品当前面向单机开发调试，不需要团队账户或托管后端。

## Decision

- Collector 默认监听 `127.0.0.1`，数据默认写入本机 SQLite。
- Collector 不实现认证、授权或多租户隔离。
- Dashboard 通过本地 HTTP 读取 Collector，不直接访问数据库。
- 非回环部署不属于内置交付范围，必须由部署者提供网络隔离和访问控制。

## Consequences

- 核心功能离线可用，部署和数据所有权简单。
- 不能把 Collector 直接暴露到公网或不可信局域网。
- 团队共享、跨设备同步和云托管需要新的安全模型，而不是简单修改监听地址。

## Alternatives considered

- 内置账户与远程数据库：增加运行和安全复杂度，与当前单机目标不符。
- 仅使用进程内 SDK：无法承接 Hooks、OTel 和多客户端本地历史。
