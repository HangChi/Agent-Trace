"use server";

import { revalidatePath } from "next/cache";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function createBudgetAction(formData: FormData): Promise<void> {
  await request("/analytics/budgets", {
    method: "POST",
    body: JSON.stringify({
      name: text(formData.get("name")),
      dimension: text(formData.get("dimension")),
      value: text(formData.get("value")),
      period: text(formData.get("period")),
      maxCostUsd: optionalNumber(formData.get("maxCostUsd")),
      maxTokens: optionalNumber(formData.get("maxTokens")),
      maxRuns: optionalNumber(formData.get("maxRuns")),
      enabled: true
    })
  });
  revalidatePath("/analytics");
}

export async function deleteBudgetAction(id: string): Promise<void> {
  await request(`/analytics/budgets/${encodeURIComponent(id)}`, { method: "DELETE" });
  revalidatePath("/analytics");
}

async function request(path: string, init: RequestInit) {
  const response = await fetch(`${collectorUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function optionalNumber(value: FormDataEntryValue | null) {
  const source = text(value);
  return source === "" ? undefined : Number(source);
}
