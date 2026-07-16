import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CreateReplayTask,
  DashboardTraceEvent,
  ReplaySandboxPolicy,
  ReplayTask,
  ReplayTaskStatus,
  TraceEventType
} from "@agent-trace/schema";

import { publishChange } from "./change-feed.js";
import { db } from "./db.js";
import {
  createEvent,
  createRun,
  getRunById,
  listEventsByRunId,
  updateRun
} from "./storage.js";

const maxPayloadBytes = 1_000_000;
const maxWorkerOutputBytes = 1_000_000;
const activeWorkers = new Map<string, ChildProcess>();

export const replaySandboxPolicy: ReplaySandboxPolicy = {
  network: "disabled",
  toolExecution: "mock-only",
  filesystem: "temporary",
  environment: "sanitized"
};

type StoredReplayRequest = CreateReplayTask & {
  sourceEvent: DashboardTraceEvent;
  sourceProject?: string;
};

type ReplayTaskRow = {
  id: string;
  sourceRunId: string;
  sourceEventId: string;
  replayRunId: string | null;
  status: ReplayTaskStatus;
  policyJson: string;
  timeoutMs: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  workspaceCleaned: number;
};

export class ReplaySandboxError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 404 | 413) {
    super(code);
  }
}

export async function createReplayTask(input: CreateReplayTask): Promise<ReplayTask> {
  const [sourceRun, sourceEvents] = await Promise.all([
    getRunById(input.sourceRunId),
    listEventsByRunId(input.sourceRunId)
  ]);
  if (!sourceRun) throw new ReplaySandboxError("source_run_not_found", 404);
  const sourceEvent = sourceEvents.find((event) => event.id === input.sourceEventId);
  if (!sourceEvent) throw new ReplaySandboxError("source_event_not_found", 404);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const request: StoredReplayRequest = {
    ...input,
    input: input.input === undefined ? sourceEvent.input : input.input,
    mockOutput: input.mockOutput === undefined ? sourceEvent.output : input.mockOutput,
    sourceEvent,
    sourceProject: typeof sourceRun.metadata?.project === "string"
      ? sourceRun.metadata.project
      : undefined
  };
  const requestJson = JSON.stringify(request);
  if (Buffer.byteLength(requestJson) > maxPayloadBytes) {
    throw new ReplaySandboxError("replay_payload_too_large", 413);
  }

  db.$client.prepare(`
    INSERT INTO replay_tasks (
      id, source_run_id, source_event_id, status, request_json, policy_json,
      timeout_ms, created_at, workspace_cleaned
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, 0)
  `).run(
    id,
    input.sourceRunId,
    input.sourceEventId,
    requestJson,
    JSON.stringify(replaySandboxPolicy),
    input.timeoutMs,
    createdAt
  );
  publishChange("replay");
  queueMicrotask(() => void executeReplayTask(id));
  return getReplayTask(id)!;
}

export function getReplayTask(id: string): ReplayTask | undefined {
  const row = db.$client.prepare(`
    SELECT
      id, source_run_id AS sourceRunId, source_event_id AS sourceEventId,
      replay_run_id AS replayRunId, status, policy_json AS policyJson,
      timeout_ms AS timeoutMs, error, created_at AS createdAt,
      started_at AS startedAt, completed_at AS completedAt,
      workspace_cleaned AS workspaceCleaned
    FROM replay_tasks WHERE id = ?
  `).get(id) as ReplayTaskRow | undefined;
  return row ? toReplayTask(row) : undefined;
}

export function listReplayTasks(sourceRunId?: string, limit = 50): ReplayTask[] {
  const normalizedLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = sourceRunId
    ? db.$client.prepare(`
        SELECT
          id, source_run_id AS sourceRunId, source_event_id AS sourceEventId,
          replay_run_id AS replayRunId, status, policy_json AS policyJson,
          timeout_ms AS timeoutMs, error, created_at AS createdAt,
          started_at AS startedAt, completed_at AS completedAt,
          workspace_cleaned AS workspaceCleaned
        FROM replay_tasks WHERE source_run_id = ? ORDER BY created_at DESC LIMIT ?
      `).all(sourceRunId, normalizedLimit)
    : db.$client.prepare(`
        SELECT
          id, source_run_id AS sourceRunId, source_event_id AS sourceEventId,
          replay_run_id AS replayRunId, status, policy_json AS policyJson,
          timeout_ms AS timeoutMs, error, created_at AS createdAt,
          started_at AS startedAt, completed_at AS completedAt,
          workspace_cleaned AS workspaceCleaned
        FROM replay_tasks ORDER BY created_at DESC LIMIT ?
      `).all(normalizedLimit);
  return (rows as ReplayTaskRow[]).map(toReplayTask);
}

export function cancelReplayTask(id: string): ReplayTask | undefined {
  const task = getReplayTask(id);
  if (!task) return undefined;
  if (task.status !== "queued" && task.status !== "running") {
    return task;
  }
  const workspaceCleaned = task.status === "queued" ? 1 : 0;
  db.$client.prepare(`
    UPDATE replay_tasks
    SET status = 'cancelled', completed_at = ?, error = 'cancelled_by_user', workspace_cleaned = ?
    WHERE id = ?
  `).run(new Date().toISOString(), workspaceCleaned, id);
  activeWorkers.get(id)?.kill();
  publishChange("replay");
  return getReplayTask(id);
}

async function executeReplayTask(id: string) {
  const row = getStoredReplayRequest(id);
  if (!row || row.status !== "queued") return;
  const startedAt = new Date().toISOString();
  db.$client.prepare(`
    UPDATE replay_tasks SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'
  `).run(startedAt, id);
  publishChange("replay");
  let workspace: string | undefined;
  let outcome: WorkerOutcome = { kind: "error", error: "sandbox_worker_not_started" };

  try {
    workspace = await mkdtemp(join(tmpdir(), "agent-trace-replay-"));
    const manifestPath = join(workspace, "manifest.json");
    await writeFile(manifestPath, JSON.stringify({
      output: row.request.mockOutput,
      simulateError: row.request.simulateError,
      delayMs: row.request.delayMs
    }), { encoding: "utf8", flag: "wx" });
    outcome = await runWorker(id, manifestPath, workspace, row.request.timeoutMs);
    if (outcome.kind === "completed" && getReplayTask(id)?.status !== "cancelled") {
      await materializeReplay(id, row.request, outcome);
    }
  } catch (error) {
    outcome = { kind: "error", error: error instanceof Error ? error.message : String(error) };
  } finally {
    activeWorkers.delete(id);
    if (workspace) {
      await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
    finalizeTask(id, outcome);
  }
}

type WorkerOutcome =
  | { kind: "completed"; status: "success" | "error"; output?: unknown; error?: string; durationMs: number }
  | { kind: "timeout"; error: string }
  | { kind: "error"; error: string };

function runWorker(id: string, manifestPath: string, workspace: string, timeoutMs: number) {
  return new Promise<WorkerOutcome>((resolve) => {
    const child = spawn(process.execPath, ["-e", workerSource, manifestPath], {
      cwd: workspace,
      env: sanitizedWorkerEnvironment(workspace),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeWorkers.set(id, child);
    let stdout = "";
    let stderr = "";
    let settled = false;
    let terminationOutcome: WorkerOutcome | undefined;
    const finish = (outcome: WorkerOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      terminationOutcome = { kind: "timeout", error: `sandbox_timeout_${timeoutMs}ms` };
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > maxWorkerOutputBytes) {
        terminationOutcome = { kind: "error", error: "sandbox_output_too_large" };
        child.kill();
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({ kind: "error", error: error.message }));
    child.on("close", (code) => {
      if (settled) return;
      if (terminationOutcome) return finish(terminationOutcome);
      if (code !== 0) return finish({ kind: "error", error: stderr.trim() || `sandbox_exit_${code}` });
      try {
        const result = JSON.parse(stdout) as {
          status: "success" | "error";
          output?: unknown;
          error?: string;
          durationMs: number;
        };
        finish({ kind: "completed", ...result });
      } catch {
        finish({ kind: "error", error: "invalid_sandbox_output" });
      }
    });
  });
}

async function materializeReplay(
  taskId: string,
  request: StoredReplayRequest,
  outcome: Extract<WorkerOutcome, { kind: "completed" }>
) {
  const replayRunId = `replay:${taskId}`;
  const now = new Date().toISOString();
  await createRun({
    id: replayRunId,
    name: `Replay: ${request.sourceEvent.name}`,
    status: "running",
    startedAt: now,
    input: request.input,
    metadata: {
      source: "replay-sandbox",
      project: request.sourceProject,
      replay: {
        sourceRunId: request.sourceRunId,
        sourceEventId: request.sourceEventId,
        taskId
      },
      sandbox: replaySandboxPolicy
    }
  });
  await createEvent({
    id: `replay-event:${taskId}`,
    runId: replayRunId,
    type: request.sourceEvent.type as TraceEventType,
    name: request.sourceEvent.name,
    status: outcome.status,
    timestamp: now,
    durationMs: outcome.durationMs,
    input: request.input,
    output: outcome.output,
    error: outcome.status === "error" ? { message: outcome.error ?? "Simulated replay error" } : undefined,
    metadata: {
      ...request.sourceEvent.metadata,
      source: "replay-sandbox",
      replayMode: "mock",
      sourceRunId: request.sourceRunId,
      sourceEventId: request.sourceEventId,
      realSideEffects: false
    }
  });
  await updateRun(replayRunId, {
    status: outcome.status,
    endedAt: new Date().toISOString(),
    output: outcome.output,
    error: outcome.status === "error" ? outcome.error : undefined
  });
  db.$client.prepare("UPDATE replay_tasks SET replay_run_id = ? WHERE id = ?")
    .run(replayRunId, taskId);
}

function finalizeTask(id: string, outcome: WorkerOutcome) {
  const current = getReplayTask(id);
  if (!current) return;
  const completedAt = new Date().toISOString();
  if (current.status === "cancelled") {
    db.$client.prepare(`
      UPDATE replay_tasks SET workspace_cleaned = 1, completed_at = coalesce(completed_at, ?) WHERE id = ?
    `).run(completedAt, id);
  } else {
    const status: ReplayTaskStatus = outcome.kind === "completed"
      ? "completed"
      : outcome.kind === "timeout"
        ? "timeout"
        : "error";
    db.$client.prepare(`
      UPDATE replay_tasks
      SET status = ?, error = ?, completed_at = ?, workspace_cleaned = 1
      WHERE id = ?
    `).run(status, outcome.kind === "completed" ? null : outcome.error, completedAt, id);
  }
  publishChange("replay");
}

function getStoredReplayRequest(id: string) {
  const row = db.$client.prepare(`
    SELECT status, request_json AS requestJson FROM replay_tasks WHERE id = ?
  `).get(id) as { status: ReplayTaskStatus; requestJson: string } | undefined;
  return row ? { status: row.status, request: JSON.parse(row.requestJson) as StoredReplayRequest } : undefined;
}

function toReplayTask(row: ReplayTaskRow): ReplayTask {
  return {
    id: row.id,
    sourceRunId: row.sourceRunId,
    sourceEventId: row.sourceEventId,
    replayRunId: row.replayRunId ?? undefined,
    status: row.status,
    policy: JSON.parse(row.policyJson) as ReplaySandboxPolicy,
    timeoutMs: Number(row.timeoutMs),
    error: row.error ?? undefined,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    workspaceCleaned: row.workspaceCleaned === 1
  };
}

function sanitizedWorkerEnvironment(workspace: string): NodeJS.ProcessEnv {
  return {
    HOME: workspace,
    USERPROFILE: workspace,
    TEMP: workspace,
    TMP: workspace,
    NO_PROXY: "*",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR
  };
}

const workerSource = String.raw`
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const started = Date.now();
setTimeout(() => {
  process.stdout.write(JSON.stringify({
    status: manifest.simulateError ? "error" : "success",
    output: manifest.simulateError ? undefined : manifest.output,
    error: manifest.simulateError ? "Simulated replay error" : undefined,
    durationMs: Math.max(0, Date.now() - started)
  }));
}, manifest.delayMs);
`;
