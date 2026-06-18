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
  source: z.string().optional()
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
    tokenUsage: tokenUsageSchema.optional()
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
