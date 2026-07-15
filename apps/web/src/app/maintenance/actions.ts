"use server";

import { revalidatePath } from "next/cache";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function pruneRunsAction(formData: FormData): Promise<void> {
  const before = text(formData.get("before"));
  const statuses = formData.getAll("statuses").filter((value): value is string => typeof value === "string");

  await request("/maintenance/prune", {
    method: "POST",
    body: JSON.stringify({
      before: new Date(`${before}T00:00:00.000Z`).toISOString(),
      statuses,
      keepTombstones: formData.get("keepTombstones") === "on"
    })
  });
  revalidate();
}

export async function compactDatabaseAction(): Promise<void> {
  await request("/maintenance/compact", { method: "POST" });
  revalidatePath("/maintenance");
}

export async function restoreTombstoneAction(id: string): Promise<void> {
  await request(`/runs/${encodeURIComponent(id)}/tombstone`, { method: "DELETE" });
  revalidate();
}

export async function updatePrivacySettingsAction(formData: FormData): Promise<void> {
  const sensitiveKeys = text(formData.get("sensitiveKeys"))
    .split(/[\n,]/)
    .map((key) => key.trim())
    .filter(Boolean);
  const replacement = text(formData.get("replacement")).trim() || "[REDACTED]";

  await request("/maintenance/privacy", {
    method: "PUT",
    body: JSON.stringify({ sensitiveKeys, replacement })
  });
  revalidatePath("/maintenance");
}

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${collectorUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store"
  });

  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
}

function revalidate() {
  revalidatePath("/maintenance");
  revalidatePath("/runs");
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}
