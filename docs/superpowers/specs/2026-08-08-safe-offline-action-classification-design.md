# 安全的离线动作分类设计

- 状态：已确认
- 日期：2026-08-08

## 背景

Agent-Trace 当前通过两类链路生成动作事件：

- Codex/Claude Code Hooks 与 Codex OTel 能识别命令、普通工具、MCP 和 Skill，并可能保存完整 Shell 命令。
- 本地 transcript 扫描只把工具名称保存到 `TranscriptEvent.tools`，Collector 再将全部名称写成普通 `tool`。因此 WorkBuddy 等仅有历史扫描的客户端无法在列表和详情中显示正确的命令、MCP、Skill 分类。

本地源文件实际包含更丰富的结构。已验证的 WorkBuddy 和 Claude Code 历史记录保留 Bash 的 `command` 参数；WorkBuddy 历史还保留 `mcp__server__tool` 格式的 MCP 名称。因此无需实时采集，也可以恢复大部分动作分类。安全风险在于命令可能包含用户目录、业务参数、访问令牌或其他秘密，不能因为源文件存在就默认复制到 Agent-Trace 数据库。

现有“写入前字段脱敏”仅按对象字段名递归替换，不能识别普通命令字符串内部的秘密，不应被当作命令内容保护机制。

## 目标

1. 让 WorkBuddy、Claude Code、Codex 等受支持的本地历史在没有实时 Hook 时，也能显示 command、tool、MCP、Skill 分类和计数。
2. 默认不把离线命令正文、普通工具参数或工具结果复制到 Collector 和 SQLite。
3. 让所有写入入口遵守统一的命令内容策略，避免旧客户端或其他入口绕过默认保护。
4. 允许用户显式选择保存完整命令，同时清楚提示风险。
5. 支持重新扫描现有 transcript 来回填分类，并提供显式清理既有命令正文的能力。

## 非目标

- 不执行 transcript 中的命令或工具。
- 不读取或持久化 Assistant 正文、工具结果正文或文件内容。
- 不实现基于正则表达式的“自动秘密识别”；这种处理无法可靠覆盖 Shell 引号、环境变量、URL、内嵌 JSON 等格式。
- 不保证所有客户端都能恢复 Skill；只有源记录显式提供 Skill 名称时才分类为 Skill。
- 不在本次工作中解决 Hook 与 OTel 之间已有的重复事件计数，也不自动合并不同路径下的 SQLite 数据库。

## 安全默认值

在现有 `PrivacySettings` 中增加：

```ts
type CommandCaptureMode = "metadata" | "full";

type PrivacySettings = {
  sensitiveKeys: string[];
  replacement: string;
  commandCapture: CommandCaptureMode;
};
```

规则如下：

- `metadata` 是新安装和升级后的默认值。只保存命令类别、工具名、状态、时间和来源，不保存命令正文。
- `full` 必须由用户在维护与隐私页面显式开启。该模式保存完整命令，界面必须标记为高风险，并说明字段名脱敏无法清理命令字符串内部的秘密。
- 旧的隐私设置 JSON 缺少 `commandCapture` 时，Schema 应补默认值 `metadata`，同时保留原有 `sensitiveKeys` 和 `replacement`。
- 策略只影响后续写入，不静默删除历史数据。

不保存命令哈希、命令预览、首尾字符或命令长度。这些字段对分类没有必要，也会扩大可推断信息。

## 结构化 transcript 动作

将 CLI 内部的 `TranscriptEvent.tools?: string[]` 扩展为结构化动作，同时保留读取旧 payload 的兼容路径：

```ts
type TranscriptAction = {
  callId?: string;
  name: string;
  category: "command" | "tool" | "mcp" | "skill";
  toolName?: string;
  mcpServer?: string;
  mcpTool?: string;
  skillName?: string;
  status: "success" | "error";
  timestamp: string;
  durationMs?: number;
  resultObserved: boolean;
  command?: string;
};
```

`command` 只允许在 `commandCapture=full` 时出现。metadata 模式可以在内存中检查参数对象是否存在 `command`、`cmd`、`script` 或 `shell_command` 字段，但不得把字段值加入 `TranscriptAction`、日志或 HTTP payload。

Collector 接收新版 `actions` 时使用结构化元数据创建事件；收到旧版 `tools` 时继续按普通工具处理，保证 CLI 与 Server 短暂版本不一致时不会丢数据。

## 统一分类规则

在 `packages/schema` 中增加无副作用的动作分类模块，使 CLI transcript 解析器和 Server Hook/OTel normalizer 使用同一套纯函数。该模块只接收工具名、参数字段名和显式类型，不读取文件或访问数据库。

分类优先级：

1. 工具名符合 `mcp__<server>__<tool>`：分类为 `mcp`，并拆出 `mcpServer`、`mcpTool`。
2. 存在显式 Skill 名称，或来源明确标记 SlashCommand/Skill：分类为 `skill`。
3. 工具名属于 Bash、Shell、Command、PowerShell、cmd、Terminal、exec 等命令工具，或参数字段包含受支持的命令字段：分类为 `command`。
4. 其余有名称的调用：分类为 `tool`。
5. 名称缺失或参数损坏：生成普通工具事件并使用稳定占位名称，不猜测 MCP、Skill 或命令。

MCP 的识别优先于命令，避免 MCP 工具参数中恰好包含 `command` 时被错误归类。

## 各客户端离线解析

### WorkBuddy

- 从 `function_call` 读取 `callId`、`name`、`arguments` 和时间戳。
- `arguments` 为 JSON 字符串时只解析对象结构；metadata 模式不保留值。
- 用 `function_call_result.callId` 配对结果，读取结构化状态和结果时间，不读取 `output` 正文。

### Claude Code

- 从 Assistant 消息的 `tool_use` block 读取 `id`、`name`、`input` 字段名和时间戳。
- 用后续 `tool_result` 的关联 ID 判断是否观察到结果和失败状态。
- 不把 `tool_result.content` 保存或提交给 Collector。

### Codex

- 从 `function_call`、`custom_tool_call`、`tool_search_call` 和 MCP 结束事件读取调用名称、ID 与结构化状态。
- metadata 模式只检查参数字段名；不保留 arguments、invocation、result 或命令正文。
- Codex 已有实时动作时继续沿用实时源优先规则，避免 transcript 与实时事件重复计数。

## 隐私策略的双层执行

命令内容策略在两层执行，以防版本不一致或非标准调用方绕过：

1. **CLI Scanner 最小化**：扫描开始时读取 Collector 的隐私设置。读取失败或返回未知值时强制使用 `metadata`。metadata 模式不把命令值放入 transcript payload。
2. **Collector 最终执行**：所有 Event 在序列化到 SQLite 前统一应用 `commandCapture`。metadata 模式删除 `input.command` 和 `metadata.command`，包括 Hook、OTel、SDK 或旧 CLI 提交的值。

第二层是最终安全边界。即使旧 CLI 仍提交完整命令，Collector 也不会在 metadata 模式落库。

SDK 调用方显式提交的非命令 input/output 继续遵循现有契约，不在本方案中被自动删除。

## 存储与详情页

metadata 模式的命令事件保存：

- `category: "command"`
- `toolName` 与 `toolKind: "command"`
- 时间戳、状态、来源、调用 ID、可用的耗时
- `commandContent: "omitted"`，用于解释正文缺失原因

不保存 `input.command` 或 `metadata.command`。

详情页遇到 `category=command` 且 `commandContent=omitted` 时显示：

> Bash 命令 · 正文未保存（隐私策略）

列表摘要、筛选和诊断仍按 command 统计。MCP 详情只显示 Server 与 Tool 名称，不显示参数。JSON 详情不得出现被省略的命令值。

full 模式沿用现有命令正文展示方式，但在隐私设置和详情页显示高风险提示。

## 实时与离线事件协调

保留当前的来源优先级：一个 Run 存在 Hook/OTel 的 command、tool、MCP 或 Skill 动作时，摘要和默认详情不再累计该 Run 的 transcript 动作；只有没有实时动作时才使用 transcript 动作。

这样可以在不引入不可靠时间窗口指纹的情况下避免重复计数。Hook 与 OTel 彼此之间的去重属于独立问题，不在本设计内修改。

部署时必须让 CLI、Hooks、Desktop 和源码 Server 指向同一个 Collector，并为源码运行配置绝对 `AGENT_TRACE_DB_PATH`。维护页继续展示当前数据库路径，文档增加“多个 Collector 会造成历史扫描和实时事件分流”的说明。

## 历史回填与清理

### 分类回填

重新执行 usage/transcript 扫描即可重建 transcript 事件。沿用现有稳定 Run ID、事件替换事务和 tombstone 规则：

- 未删除的 transcript Run 获得新的结构化分类。
- 有实时动作的 Run 继续显示实时动作。
- 已删除且保留 tombstone 的 Run 不会重新生成。

### 历史命令正文清理

维护接口增加只读统计和显式清理操作：

- 统计返回包含 `input.command` 或 `metadata.command` 的 Event 数量和 Run 数量，不返回命令内容。
- 清理请求必须携带显式确认字段，并在事务中移除两个位置的命令正文。
- 清理保留 category、toolName、状态、时间、Token 和诊断元数据。
- UI 在执行前显示影响数量和“不可恢复；源客户端历史不受影响”的提示。
- 清理后发布 change feed 更新，并建议用户按需执行数据库压缩；压缩不是清理事务的一部分。

## 错误处理

- 单行 JSON 损坏：忽略该行，继续扫描；不得把原始行写入日志。
- arguments 不是合法 JSON：只按工具名分类，不保存原字符串。
- 结果缺失：保留调用事件，`resultObserved=false`；状态沿用当前成功默认，避免把历史不完整误判成执行失败。
- 结果显式失败：标记 `error`，但不保存结果正文。
- Collector 隐私设置读取失败：CLI 强制 metadata，扫描继续。
- 未知隐私枚举值：Schema 拒绝设置更新；读取端按 metadata 处理。

## 测试策略

### CLI transcript 测试

- WorkBuddy/Claude Bash 被识别为 command。
- `mcp__ardot__batch_edit` 被拆为 MCP Server `ardot` 和 Tool `batch_edit`。
- 普通 Read/Edit 保持 tool。
- metadata 模式生成的对象和 HTTP payload 不包含命令秘密哨兵。
- full 模式显式开启后才包含完整命令。
- malformed arguments 降级但不泄漏原始字符串。
- 调用与结果按 ID 配对，状态和耗时计算正确。

### Server 测试

- Collector 在 metadata 模式删除来自 Hook、OTel、SDK 风格 Event 和旧 transcript payload 的命令字段。
- full 模式保留现有命令写入行为。
- 旧隐私设置读取后保留敏感字段配置并补上 metadata 默认值。
- 新旧 transcript payload 都可接收。
- 重新扫描更新旧 transcript 分类且不绕过 tombstone。
- 实时动作存在时 transcript 不参与摘要计数。
- 历史清理事务只移除命令正文，并返回正确数量。
- 脱敏导出仍不包含命令、路径和会话 ID。

### Web 测试

- metadata 命令显示“正文未保存”，列表计数与筛选正常。
- JSON 详情不含命令字段。
- full 模式显示高风险提示和完整命令。
- 历史清理必须经过影响统计和确认。

## 验收标准

1. 只含 transcript 的 WorkBuddy、Claude Code 和 Codex Run 能显示正确的命令、工具与 MCP 数量。
2. 默认设置下，从源 JSONL 到 HTTP payload、SQLite、API 和页面均找不到测试命令秘密哨兵。
3. 用户显式开启 full 后，新写入命令才在详情页可见。
4. 重新扫描能回填既有 transcript Run，不产生重复摘要计数。
5. 历史清理后分类和统计保留，命令正文从 Event JSON 中移除。
6. 所有现有 Hook、transcript、存储、读模型、隐私和导出测试继续通过。

## 实施顺序

1. 扩展共享 Schema 与隐私设置默认值。
2. 提取共享分类器并让 Hook normalizer 使用它。
3. 扩展三类 transcript 解析器与兼容 payload。
4. 在 Scanner 和 Collector 两层执行命令内容策略。
5. 更新详情页、隐私设置和历史清理界面。
6. 增加回填、隐私、兼容和 UI 测试。
7. 更新用户指南、隐私安全、架构和测试文档。
