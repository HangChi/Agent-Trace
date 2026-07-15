"use server";

import { revalidatePath } from "next/cache";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function createDatasetAction(formData: FormData): Promise<void> {
  await request("/evaluations/datasets", {
    method: "POST",
    body: JSON.stringify({
      name: text(formData.get("name")),
      description: text(formData.get("description")) || undefined,
      scoreWeights: keyValues(text(formData.get("scoreWeights")))
    })
  });
  revalidatePath("/evaluations");
}

export async function createCaseAction(datasetId: string, formData: FormData): Promise<void> {
  await request(`/evaluations/datasets/${encodeURIComponent(datasetId)}/cases`, {
    method: "POST",
    body: JSON.stringify({
      name: text(formData.get("name")),
      input: json(text(formData.get("input"))),
      expectedOutput: optionalJson(text(formData.get("expectedOutput")))
    })
  });
  revalidatePath("/evaluations");
}

export async function recordResultAction(formData: FormData): Promise<void> {
  await request("/evaluations/results", {
    method: "POST",
    body: JSON.stringify({
      caseId: text(formData.get("caseId")),
      runId: text(formData.get("runId")),
      scores: keyValues(text(formData.get("scores"))),
      notes: text(formData.get("notes")) || undefined
    })
  });
  revalidatePath("/evaluations");
}

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${collectorUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
}

function keyValues(source: string) {
  return Object.fromEntries(source.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [key, rawValue] = entry.split(":", 2);
    return [key?.trim(), Number(rawValue)];
  }).filter(([key, value]) => key && Number.isFinite(value)));
}

function json(source: string) {
  return JSON.parse(source);
}

function optionalJson(source: string) {
  return source ? json(source) : undefined;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
