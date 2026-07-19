import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { readOpenCodeSession } from "./opencode-session.js";
import {
  cleanPromptPreview,
  parseClaudeTranscript,
  parseCodexTranscript,
  parseWorkBuddyTitle,
  parseWorkBuddyTranscript,
  type HistoryContentMode,
  type TranscriptEvent
} from "./transcript.js";

type UsageRowLike = {
  client: string;
  sessionId?: string;
  model?: string;
  provider?: string;
  costUsd?: number;
};

export type TranscriptDetail = {
  client: string;
  sessionId: string;
  title: string;
  model?: string;
  provider?: string;
  contentMode: HistoryContentMode;
  startedAt: string;
  lastUsedAt: string;
  events: TranscriptEvent[];
};

const transcriptClients = ["codex", "claude", "opencode", "workbuddy"];
const defaultFingerprints = new Map<string, string>();

export async function collectTranscriptDetails(
  home: string,
  rows: UsageRowLike[],
  contentMode: HistoryContentMode,
  fingerprints: Map<string, string> = defaultFingerprints
) {
  const grouped = groupRows(rows);
  const codexFiles = indexJsonlFiles([
    join(home, ".codex", "sessions"),
    join(home, ".codex", "archived_sessions")
  ]);
  const claudeFiles = indexJsonlFiles([join(home, ".claude", "projects")]);
  const workBuddyFiles = indexJsonlFiles([join(home, ".workbuddy", "projects")]);
  const openCodeDatabases = discoverOpenCodeDatabases(home);
  const transcripts: TranscriptDetail[] = [];
  const sessionKeys: string[] = [];

  for (const [key, sessionRows] of grouped) {
    const [client, sessionId] = splitSessionKey(key);
    const first = sessionRows[0]!;

    if (client === "opencode") {
      const fingerprint = databaseFingerprint(openCodeDatabases, contentMode, sessionId);
      const detail = readOpenCodeSession(openCodeDatabases, sessionId, contentMode);
      if (!detail.found || detail.events.length === 0) continue;
      sessionKeys.push(key);
      if (fingerprints.get(key) === fingerprint) continue;
      fingerprints.set(key, fingerprint);
      transcripts.push({
        client,
        sessionId,
        title: detail.title || `opencode:${sessionId}`,
        model: first.model,
        provider: first.provider,
        contentMode,
        startedAt: detail.startedAt || firstEventTime(detail.events),
        lastUsedAt: detail.lastUsedAt || lastEventTime(detail.events),
        events: detail.events
      });
      continue;
    }

    const file = client === "codex"
      ? resolveCodexFile(codexFiles, sessionId)
      : client === "claude"
        ? resolveClaudeFile(claudeFiles, sessionId)
        : resolveWorkBuddyFile(workBuddyFiles, sessionId);
    if (!file) continue;

    const fingerprint = fileFingerprint(file, contentMode);
    const text = readFileSync(file, "utf8");
    const parsed = client === "codex"
      ? parseCodexTranscript(text, contentMode)
      : client === "claude"
        ? parseClaudeTranscript(text, contentMode)
        : parseWorkBuddyTranscript(text, contentMode);
    if (parsed.length === 0) continue;

    sessionKeys.push(key);
    if (fingerprints.get(key) === fingerprint) continue;
    fingerprints.set(key, fingerprint);
    const events = distributeSessionCost(parsed, sumCost(sessionRows));
    transcripts.push({
      client,
      sessionId,
      title: client === "workbuddy"
        ? parseWorkBuddyTitle(text) || `workbuddy:${sessionId}`
        : transcriptTitle(client, sessionId, events),
      model: first.model,
      provider: first.provider,
      contentMode,
      startedAt: firstEventTime(events),
      lastUsedAt: lastEventTime(events),
      events
    });
  }

  return { clients: transcriptClients, sessionKeys, transcripts };
}

function transcriptTitle(client: string, sessionId: string, events: TranscriptEvent[]) {
  const prompt = events.find((event) => event.kind === "prompt" && event.text)?.text;
  const title = cleanPromptPreview(prompt)
    .replace(/^\[(?:image|\d+ images)\]\s*/i, "")
    .trim();
  if (title) {
    const characters = Array.from(title);
    return characters.length > 80
      ? `${characters.slice(0, 79).join("")}…`
      : title;
  }
  return `${client === "claude" ? "claude-code" : client}:${sessionId}`;
}

function groupRows(rows: UsageRowLike[]) {
  const grouped = new Map<string, UsageRowLike[]>();
  for (const row of rows) {
    if (!transcriptClients.includes(row.client) || !row.sessionId) continue;
    const key = `${row.client}:${normalizeSessionId(row.client, row.sessionId)}`;
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function indexJsonlFiles(roots: string[]) {
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files;
}

function walk(directory: string, files: string[]) {
  if (!existsSync(directory)) return;
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(directory, { withFileTypes: true }) as never;
  } catch {
    return;
  }

  for (const entry of entries as unknown as Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, files);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
}

function resolveCodexFile(files: string[], sessionId: string) {
  return files.find((file) => {
    const id = basename(file, ".jsonl");
    return id === sessionId || id.endsWith(`-${sessionId}`);
  });
}

function resolveClaudeFile(files: string[], sessionId: string) {
  return files.find((file) => basename(file, ".jsonl") === sessionId);
}

function resolveWorkBuddyFile(files: string[], sessionId: string) {
  return files.find((file) => basename(file, ".jsonl") === sessionId);
}

function discoverOpenCodeDatabases(home: string) {
  const directory = join(home, ".local", "share", "opencode");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(name))
    .sort()
    .map((name) => join(directory, name));
}

function fileFingerprint(path: string, contentMode: HistoryContentMode) {
  const stats = statSync(path);
  return `${path}\0${stats.size}\0${stats.mtimeMs}\0${contentMode}`;
}

function databaseFingerprint(paths: string[], contentMode: HistoryContentMode, sessionId: string) {
  return paths
    .map((path) => {
      const stats = statSync(path);
      return `${path}:${stats.size}:${stats.mtimeMs}`;
    })
    .concat(contentMode, sessionId)
    .join("\0");
}

function distributeSessionCost(events: TranscriptEvent[], sessionCost: number) {
  const totalTokens = events.reduce((sum, event) => sum + (event.tokens?.total ?? 0), 0);
  return events.map((event) => {
    if (event.kind !== "turn" || !event.tokens || totalTokens === 0 || sessionCost <= 0) return event;
    return {
      ...event,
      costUsd: sessionCost * (event.tokens.total / totalTokens),
      costEstimated: true
    };
  });
}

function firstEventTime(events: TranscriptEvent[]) {
  return eventTimes(events).sort()[0] ?? "";
}

function lastEventTime(events: TranscriptEvent[]) {
  return eventTimes(events).sort().at(-1) ?? "";
}

function eventTimes(events: TranscriptEvent[]) {
  return events.map((event) => event.timestamp).filter(isIso);
}

function isIso(value: string) {
  return Number.isFinite(new Date(value).getTime());
}

function sumCost(rows: UsageRowLike[]) {
  return rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
}

function normalizeSessionId(client: string, sessionId: string) {
  if (client !== "codex" || !sessionId.startsWith("rollout-")) return sessionId;
  return sessionId.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
  )?.[1]?.toLowerCase() ?? sessionId;
}

function splitSessionKey(key: string) {
  const index = key.indexOf(":");
  return [key.slice(0, index), key.slice(index + 1)] as const;
}
