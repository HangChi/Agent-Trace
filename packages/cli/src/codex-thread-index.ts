import { readFileSync } from "node:fs";
import { join } from "node:path";

type IndexedTitle = {
  title: string;
  updatedAt: number;
  line: number;
};

export function parseCodexThreadIndex(text: string) {
  const indexed = new Map<string, IndexedTitle>();

  for (const [line, raw] of text.split(/\r?\n/).entries()) {
    try {
      const record = JSON.parse(raw) as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim().toLowerCase() : "";
      const title = typeof record.thread_name === "string" ? record.thread_name.trim() : "";
      if (!id || !title) continue;

      const parsedUpdatedAt = typeof record.updated_at === "string"
        ? Date.parse(record.updated_at)
        : Number.NaN;
      const updatedAt = Number.isFinite(parsedUpdatedAt)
        ? parsedUpdatedAt
        : Number.NEGATIVE_INFINITY;
      const previous = indexed.get(id);

      if (
        !previous ||
        updatedAt > previous.updatedAt ||
        (updatedAt === previous.updatedAt && line > previous.line)
      ) {
        indexed.set(id, { title, updatedAt, line });
      }
    } catch {
      // Ignore partial or malformed JSONL records.
    }
  }

  return new Map(Array.from(indexed, ([id, value]) => [id, value.title]));
}

export function readCodexThreadTitles(home: string) {
  try {
    return parseCodexThreadIndex(
      readFileSync(join(home, ".codex", "session_index.jsonl"), "utf8")
    );
  } catch {
    return new Map<string, string>();
  }
}
