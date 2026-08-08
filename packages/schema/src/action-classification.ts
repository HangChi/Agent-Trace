export type ActionCategory = "command" | "tool" | "mcp" | "skill";

export type ActionClassificationInput = {
  toolName?: string;
  argumentKeys?: string[];
  skillName?: string;
};

export type ActionClassification = {
  category: ActionCategory;
  toolKind: "command" | "tool" | "mcp";
  toolName?: string;
  mcpServer?: string;
  mcpTool?: string;
  skillName?: string;
};

const commandArgumentKeys = new Set(["command", "cmd", "script", "shell_command"]);

export function classifyAction(input: ActionClassificationInput): ActionClassification {
  const toolName = input.toolName?.trim() || undefined;
  const mcp = parseMcpToolName(toolName);

  if (mcp) {
    return {
      category: "mcp",
      toolKind: "mcp",
      toolName,
      mcpServer: mcp.server,
      mcpTool: mcp.tool
    };
  }

  const skillName = input.skillName?.trim() || undefined;
  if (skillName) {
    return { category: "skill", toolKind: "tool", toolName, skillName };
  }

  const hasCommandArgument = input.argumentKeys?.some((key) =>
    commandArgumentKeys.has(key.trim().toLowerCase())
  );
  if (isCommandToolName(toolName) || hasCommandArgument) {
    return { category: "command", toolKind: "command", toolName };
  }

  return { category: "tool", toolKind: "tool", toolName };
}

export function parseMcpToolName(toolName: string | undefined) {
  if (!toolName?.startsWith("mcp__")) return undefined;
  const [, server, ...toolParts] = toolName.split("__");
  const tool = toolParts.join("__");
  return server && tool ? { server, tool } : undefined;
}

export function isCommandToolName(toolName: string | undefined) {
  if (!toolName) return false;
  return /^(bash|shell|command|powershell|cmd|terminal|exec|exec_command)$/i.test(toolName) ||
    toolName.toLowerCase().includes("shell_command") ||
    toolName.toLowerCase().includes("command_execution");
}
