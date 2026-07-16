"use server";

import { revalidatePath } from "next/cache";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function createReplayAction(formData: FormData): Promise<void> {
  await request("/sandbox/replays", {
    method: "POST",
    body: JSON.stringify({
      sourceRunId: text(formData.get("sourceRunId")),
      sourceEventId: text(formData.get("sourceEventId")),
      input: optionalJson(text(formData.get("input"))),
      mockOutput: optionalJson(text(formData.get("mockOutput"))),
      simulateError: formData.get("simulateError") === "on",
      timeoutMs: number(formData.get("timeoutMs"), 5000),
      delayMs: number(formData.get("delayMs"), 0)
    })
  });
  revalidatePath("/sandbox");
  revalidatePath("/runs");
}

export async function cancelReplayAction(id: string): Promise<void> {
  await request(`/sandbox/replays/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath("/sandbox");
}

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${collectorUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
}

function optionalJson(source: string) {
  return source ? JSON.parse(source) : undefined;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}
