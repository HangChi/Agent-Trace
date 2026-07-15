import type { TokenUsage } from "@agent-trace/schema";

export type AgentHookSource = "codex" | "claude-code";
export type UsageContext = { model?: string; provider?: string };

export const providerTokenAdapter = {
  normalizeProviderName,
  inferProviderFromModel,
  extractHookTokenUsage,
  extractTokenUsage
};

function extractHookTokenUsage(
  source: AgentHookSource,
  body: Record<string, unknown>,
  hookEvent: string,
  toolName: string | undefined,
  context: UsageContext
) {
  for (const key of ["usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage", "response_usage", "responseUsage"]) {
    const usage = record(parseJson(body[key]));
    if (Object.keys(usage).length === 0) continue;
    const parsed = extractTokenUsage(source, usage, context);
    if (parsed) return parsed;
  }

  if (source !== "claude-code" || hookEvent !== "PostToolUse" || toolName !== "Agent") return undefined;
  const response = record(first(body, "tool_response", "toolResponse"));
  const parsed = extractTokenUsage(source, record(response.usage), context);
  const total = number(response, "totalTokens", "total_tokens");

  return parsed && total !== undefined ? { ...parsed, total } : parsed;
}

function extractTokenUsage(source: AgentHookSource, value: unknown, context: UsageContext = {}) {
  for (const candidate of candidates(value)) {
    const provider = normalizeProviderName(string(candidate, "provider", "llm_provider", "llmProvider", "model_provider", "modelProvider", "gen_ai.system", "gen_ai.provider.name"))
      ?? context.provider
      ?? inferProviderFromModel(string(candidate, "model", "model_id", "modelId") ?? context.model);
    const parsed = parseCandidate(candidate, source, provider);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseCandidate(value: Record<string, unknown>, source: AgentHookSource, provider?: string) {
  const usageSource = source === "codex" && provider === "openai"
    ? "codex"
    : source === "claude-code" && provider === "anthropic"
      ? "claude-code"
      : provider ?? source;
  const nested = record(value.usage);
  const actual = Object.keys(nested).length > 0 ? nested : value;

  return parseGemini(actual, usageSource)
    ?? parseCohere(actual, usageSource)
    ?? parseBedrock(actual, usageSource)
    ?? ((provider === "anthropic" || source === "claude-code" || has(actual, "cache_creation_input_tokens", "cacheCreationInputTokens", "cache_read_input_tokens", "cacheReadInputTokens"))
      ? parseAnthropic(actual, usageSource)
      : undefined)
    ?? parseOpenAI(actual, usageSource);
}

function parseOpenAI(value: Record<string, unknown>, source: string) {
  const input = number(value, "input_tokens", "inputTokens", "input", "prompt_tokens", "promptTokens", "prompt", "promptTokenCount", "gen_ai.usage.input_tokens", "gen_ai.usage.prompt_tokens") ?? 0;
  const output = number(value, "output_tokens", "outputTokens", "output", "completion_tokens", "completionTokens", "completion", "completionTokenCount", "candidatesTokenCount", "gen_ai.usage.output_tokens", "gen_ai.usage.completion_tokens") ?? 0;
  const cachedInput = number(value, "cached_input_tokens", "cachedInputTokens", "cachedInput", "cache_read_input_tokens", "cacheReadInputTokens", "prompt_cache_hit_tokens", "promptCacheHitTokens", "gen_ai.usage.cached_input_tokens")
    ?? nestedNumber(value, "input_tokens_details", "cached_tokens")
    ?? nestedNumber(value, "inputTokensDetails", "cachedTokens")
    ?? nestedNumber(value, "prompt_tokens_details", "cached_tokens")
    ?? nestedNumber(value, "promptTokensDetails", "cachedTokens");
  const reasoningOutput = number(value, "reasoning_output_tokens", "reasoningOutputTokens", "reasoningOutput", "reasoning_tokens", "reasoningTokens", "reasoning_token_count", "reasoningTokenCount", "thoughtsTokenCount", "gen_ai.usage.reasoning_output_tokens")
    ?? nestedNumber(value, "output_tokens_details", "reasoning_tokens")
    ?? nestedNumber(value, "outputTokensDetails", "reasoningTokens")
    ?? nestedNumber(value, "completion_tokens_details", "reasoning_tokens")
    ?? nestedNumber(value, "completionTokensDetails", "reasoningTokens");
  const total = number(value, "total_tokens", "totalTokens", "total", "totalTokenCount", "gen_ai.usage.total_tokens") ?? input + output + (reasoningOutput ?? 0);
  return usage({ input, output, total, cachedInput, reasoningOutput, source });
}

function parseAnthropic(value: Record<string, unknown>, source: string) {
  const input = number(value, "input_tokens", "inputTokens", "input", "prompt_tokens", "promptTokens") ?? 0;
  const output = number(value, "output_tokens", "outputTokens", "output", "completion_tokens", "completionTokens") ?? 0;
  const cacheCreationInput = number(value, "cache_creation_input_tokens", "cacheCreationInputTokens");
  const cacheReadInput = number(value, "cache_read_input_tokens", "cacheReadInputTokens");
  const total = number(value, "totalTokens", "total_tokens", "total") ?? input + output + (cacheCreationInput ?? 0) + (cacheReadInput ?? 0);
  return usage({ input, output, total, cacheCreationInput, cacheReadInput, cachedInput: cacheReadInput, source });
}

function parseGemini(value: Record<string, unknown>, source: string) {
  if (!has(value, "promptTokenCount", "prompt_token_count", "candidatesTokenCount", "candidates_token_count", "totalTokenCount", "total_token_count")) return undefined;
  const input = (number(value, "promptTokenCount", "prompt_token_count") ?? 0) + (number(value, "toolUsePromptTokenCount", "tool_use_prompt_token_count") ?? 0);
  const output = number(value, "candidatesTokenCount", "candidates_token_count") ?? 0;
  const reasoningOutput = number(value, "thoughtsTokenCount", "thoughts_token_count");
  const cachedInput = number(value, "cachedContentTokenCount", "cached_content_token_count");
  const total = number(value, "totalTokenCount", "total_token_count") ?? input + output + (reasoningOutput ?? 0);
  return usage({ input, output, total, cachedInput, reasoningOutput, source });
}

function parseCohere(value: Record<string, unknown>, source: string) {
  const tokenValues = record(first(value, "tokens", "billed_units", "billedUnits"));
  if (Object.keys(tokenValues).length === 0) return undefined;
  const input = number(tokenValues, "input_tokens", "inputTokens", "input") ?? 0;
  const output = number(tokenValues, "output_tokens", "outputTokens", "output") ?? 0;
  return usage({ input, output, total: number(tokenValues, "total_tokens", "totalTokens", "total") ?? input + output, source });
}

function parseBedrock(value: Record<string, unknown>, source: string) {
  if (!has(value, "inputTokens", "outputTokens", "cacheReadInputTokens", "cacheWriteInputTokens")) return undefined;
  const input = number(value, "inputTokens") ?? 0;
  const output = number(value, "outputTokens") ?? 0;
  const cacheCreationInput = number(value, "cacheWriteInputTokens");
  const cacheReadInput = number(value, "cacheReadInputTokens");
  const total = number(value, "totalTokens") ?? input + output + (cacheCreationInput ?? 0) + (cacheReadInput ?? 0);
  return usage({ input, output, total, cacheCreationInput, cacheReadInput, cachedInput: cacheReadInput, source });
}

function usage(value: TokenUsage): TokenUsage | undefined {
  if (value.input === 0 && value.output === 0 && value.total === 0) return undefined;
  return Object.fromEntries(Object.entries({ sourceKind: "official", scope: "event", ...value }).filter(([, item]) => item !== undefined)) as TokenUsage;
}

function normalizeProviderName(provider: string | undefined) {
  const value = provider?.trim().toLowerCase();
  if (!value) return undefined;
  if (["anthropic", "claude"].includes(value)) return "anthropic";
  if (["google", "gemini", "google-ai", "google_ai", "vertex", "vertex-ai"].includes(value)) return "google";
  if (["amazon", "aws", "bedrock", "amazon-bedrock"].includes(value)) return "bedrock";
  if (["xai", "x.ai", "grok"].includes(value)) return "xai";
  return value;
}

function inferProviderFromModel(model: string | undefined) {
  const value = model?.trim().toLowerCase() ?? "";
  if (/^(gpt-|o[1345](?:-|$)|chatgpt-|text-embedding-|dall-e)/.test(value)) return "openai";
  if (value.includes("claude") || value.startsWith("anthropic.")) return "anthropic";
  if (value.includes("gemini") || value.startsWith("gemma")) return "google";
  if (value.includes("mistral") || value.includes("mixtral") || value.includes("codestral")) return "mistral";
  if (value.startsWith("command-") || value.startsWith("embed-") || value.includes("cohere")) return "cohere";
  if (value.includes("grok") || value.startsWith("xai-")) return "xai";
  if (value.includes("deepseek")) return "deepseek";
  if (value.includes("llama") || value.startsWith("meta.")) return "meta";
  if (value.includes("nova") || value.includes("titan") || value.startsWith("amazon.")) return "bedrock";
  if (value.includes("sonar") || value.includes("perplexity")) return "perplexity";
  if (value.includes("qwen") || value.includes("dashscope")) return "alibaba";
  if (value.includes("glm") || value.includes("zhipu")) return "zhipu";
  if (value.includes("kimi") || value.includes("moonshot")) return "moonshot";
  return undefined;
}

function candidates(value: unknown) {
  const result: Record<string, unknown>[] = [];
  collect(value, result, 0);
  return result;
}

function collect(value: unknown, result: Record<string, unknown>[], depth: number) {
  if (depth > 4) return;
  const item = record(parseJson(value));
  if (Object.keys(item).length === 0) return;
  result.push(item);
  for (const key of ["usage", "usage_metadata", "usageMetadata", "token_usage", "tokenUsage", "tokens", "billed_units", "billedUnits", "response_usage", "responseUsage", "response", "result", "message", "output", "tool_response", "toolResponse", "body", "metadata", "metrics"]) {
    collect(item[key], result, depth + 1);
  }
}

function number(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0) return Math.floor(candidate);
    if (typeof candidate === "string" && /^\d+(?:\.\d+)?$/.test(candidate)) return Math.floor(Number(candidate));
  }
  return undefined;
}

function nestedNumber(value: Record<string, unknown>, parent: string, key: string) {
  return number(record(value[parent]), key);
}

function string(value: Record<string, unknown>, ...keys: string[]) {
  const candidate = first(value, ...keys);
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function first(value: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) if (value[key] !== undefined) return value[key];
  return undefined;
}

function has(value: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => value[key] !== undefined);
}

function parseJson(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
