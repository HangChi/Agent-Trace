import { z } from "zod";

export const traceStatusSchema = z.enum(["running", "success", "error"]);

export const traceEventTypeSchema = z.enum([
  "run_started",
  "run_ended",
  "step_started",
  "step_ended",
  "llm_call",
  "tool_call",
  "retrieval",
  "memory_update",
  "error"
]);

export const traceErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  code: z.string().optional()
});

export const tokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  cachedInput: z.number().int().nonnegative().optional(),
  cacheCreationInput: z.number().int().nonnegative().optional(),
  cacheReadInput: z.number().int().nonnegative().optional(),
  reasoningOutput: z.number().int().nonnegative().optional(),
  estimated: z.boolean().optional(),
  method: z.string().optional(),
  source: z.string().optional(),
  sourceKind: z.enum(["official", "scan", "estimate"]).optional(),
  scope: z.enum(["event", "session"]).optional()
});

export const traceMetadataSchema = z
  .object({
    agent: z.string().optional(),
    surface: z.string().optional(),
    sessionId: z.string().optional(),
    turnId: z.string().optional(),
    promptId: z.string().optional(),
    toolUseId: z.string().optional(),
    hookEvent: z.string().optional(),
    permissionMode: z.string().optional(),
    cwd: z.string().optional(),
    redactionLevel: z.string().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    tokenUsage: tokenUsageSchema.optional(),
    costUsd: z.number().nonnegative().optional(),
    messageCount: z.number().int().nonnegative().optional()
  })
  .catchall(z.unknown());

export const traceEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  parentId: z.string().min(1).optional(),
  type: traceEventTypeSchema,
  name: z.string().min(1),
  status: traceStatusSchema,
  timestamp: z.string().datetime(),
  durationMs: z.number().int().nonnegative().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: traceErrorSchema.optional(),
  metadata: traceMetadataSchema.optional()
});

export const createTraceEventSchema = traceEventSchema.extend({
  timestamp: z.string().datetime().optional()
});

export const runSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: traceStatusSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  metadata: traceMetadataSchema.optional()
});

export const createRunSchema = runSchema.extend({
  status: traceStatusSchema.default("running"),
  startedAt: z.string().datetime().optional()
});

export const updateRunSchema = z.object({
  status: traceStatusSchema,
  endedAt: z.string().datetime().nullable().optional(),
  output: z.unknown().optional(),
  error: z.string().optional()
});

export type TraceStatus = z.infer<typeof traceStatusSchema>;
export type TraceEventType = z.infer<typeof traceEventTypeSchema>;
export type TraceError = z.infer<typeof traceErrorSchema>;
export type TokenUsage = z.infer<typeof tokenUsageSchema>;
export type TraceMetadata = z.infer<typeof traceMetadataSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type CreateTraceEvent = z.infer<typeof createTraceEventSchema>;
export type Run = z.infer<typeof runSchema>;
export type CreateRun = z.infer<typeof createRunSchema>;
export type UpdateRun = z.infer<typeof updateRunSchema>;

export type DashboardModelUsage = {
  model: string;
  provider?: string;
  tokenUsage: TokenUsage;
  costUsd?: number;
};

export type DashboardRunSummary = {
  commandCount: number;
  toolCount: number;
  mcpCount: number;
  skillCount: number;
  promptCount: number;
  turnCount: number;
  tokenUsage: TokenUsage;
  costUsd?: number;
  models: string[];
  modelUsage: DashboardModelUsage[];
  commands: string[];
  tools: string[];
  mcpTools: string[];
  skills: string[];
};

export type DashboardTraceMetadata = TraceMetadata & {
  category?: string;
  command?: string;
  toolName?: string;
  toolKind?: string;
  mcpServer?: string;
  mcpTool?: string;
  skillName?: string;
  source?: string;
  surfaceSource?: string;
};

export type DashboardRunMetadata = DashboardTraceMetadata & {
  summary?: DashboardRunSummary;
};

export type DashboardRun = Omit<Run, "metadata" | "status"> & {
  status: TraceStatus | string;
  metadata?: DashboardRunMetadata;
};

export type DashboardRunSort =
  | "startedAt"
  | "name"
  | "status"
  | "duration"
  | "tokens"
  | "cost";

export type DashboardRunFilters = {
  q?: string;
  status?: string;
  source?: string;
  model?: string;
  startedAfter?: string;
  startedBefore?: string;
  minCostUsd?: number;
  maxCostUsd?: number;
  sort?: DashboardRunSort;
  order?: "asc" | "desc";
};

export type DashboardRunPage = {
  runs: DashboardRun[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalRuns: number;
    runningRuns: number;
    failedRuns: number;
    agents: Array<{ agent: string; count: number }>;
  };
};

export type UsageSnapshotRow = {
  client: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd?: number;
  messageCount?: number;
  startedAt?: string;
  lastUsedAt?: string;
};

export type ScannerDiagnostic = {
  client: string;
  status: string;
  messageCount?: number;
  path?: string;
  pathExists?: boolean;
  warning?: string;
  actionHint?: string;
};

export type DashboardUsageSummary = {
  totalTokens: number;
  costUsd: number;
  clients: Array<{ client: string; totalTokens: number; costUsd: number }>;
  models: Array<{ model: string; provider?: string; totalTokens: number; costUsd: number }>;
};

export type DashboardScannerStatus = {
  scannedAt?: string;
  diagnostics: ScannerDiagnostic[];
  error?: string;
};

export type TranscriptTokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
};

export type TranscriptIngestionEvent = {
  kind: "prompt" | "turn";
  timestamp: string;
  text?: string;
  tokens?: TranscriptTokenUsage;
  tools?: string[];
  costUsd?: number;
  costEstimated?: boolean;
};

export type TranscriptIngestionSession = {
  client: "claude" | "codex" | "opencode";
  sessionId: string;
  title?: string;
  model?: string;
  provider?: string;
  contentMode: "preview" | "metadata";
  startedAt: string;
  lastUsedAt: string;
  events: TranscriptIngestionEvent[];
};

export type DashboardTraceEvent = Omit<TraceEvent, "metadata" | "status" | "type"> & {
  status: TraceStatus | string;
  type: TraceEventType | string;
  metadata?: DashboardTraceMetadata;
};

export type DashboardEventVisibility = "display" | "hidden" | "all";

export type DashboardEventFilters = {
  q?: string;
  status?: string;
  type?: string;
  category?: string;
};

export type DashboardTraceInsightKind =
  | "repeated_action"
  | "retry_loop"
  | "slow_step"
  | "token_hotspot"
  | "failure_cascade";

export type DashboardTraceInsight = {
  kind: DashboardTraceInsightKind;
  severity: "info" | "warning" | "error";
  eventIds: string[];
  title: string;
  evidence: Record<string, string | number>;
};

export type DashboardEventPage = {
  events: DashboardTraceEvent[];
  counts: {
    total: number;
    display: number;
    hidden: number;
    matching: number;
  };
  facets: {
    types: string[];
    categories: string[];
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalTokens: number;
    totalDurationMs: number;
    failedEvents: number;
    sourceMetadata: DashboardTraceMetadata;
    errorEvents: DashboardTraceEvent[];
    insights?: DashboardTraceInsight[];
  };
  visibility: DashboardEventVisibility;
};

export type RedactedRunExport = {
  schemaVersion: 1;
  exportedAt: string;
  redaction: "metadata";
  run: {
    id: string;
    name: "redacted-run";
    status: string;
    startedAt: string;
    endedAt?: string;
    metadata?: Record<string, unknown>;
  };
  events: Array<{
    id: string;
    runId: string;
    parentId?: string;
    type: string;
    name: string;
    status: string;
    timestamp: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }>;
};

export type DashboardRunMetric = {
  id: string;
  name: string;
  status: string;
  startedAt: string;
  durationMs: number;
  eventCount: number;
  failedEventCount: number;
  totalTokens: number;
  costUsd: number;
};

export type DashboardRunComparison = {
  runs: DashboardRunMetric[];
};

export type DashboardRunTrendPoint = {
  date: string;
  runCount: number;
  successfulRunCount: number;
  failedRunCount: number;
  averageDurationMs: number;
  totalTokens: number;
  costUsd: number;
};

export type DashboardRunTrends = {
  days: number;
  points: DashboardRunTrendPoint[];
};
