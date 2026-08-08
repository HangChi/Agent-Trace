import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { cleanPromptPreview } from "./transcript.js";

type WorkBuddySessionRow = {
  id?: string;
  title?: string;
  customTitle?: string;
};

export function readWorkBuddySessionTitles(home: string) {
  const path = join(home, ".workbuddy", "workbuddy.db");
  if (!existsSync(path)) return new Map<string, string>();

  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(path, { readOnly: true });
    database.exec("PRAGMA busy_timeout = 250");
    const rows = database.prepare(`
      SELECT id, title, custom_title AS customTitle
      FROM sessions
      WHERE deleted_at IS NULL
    `).all() as WorkBuddySessionRow[];
    const titles = new Map<string, string>();
    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id.trim() : "";
      const title = cleanPromptPreview(row.customTitle) || cleanPromptPreview(row.title);
      if (id && title) titles.set(id, title);
    }
    return titles;
  } catch {
    return new Map<string, string>();
  } finally {
    database?.close();
  }
}
