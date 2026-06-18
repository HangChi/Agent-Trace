"use server";

import { revalidatePath } from "next/cache";

const collectorUrl = process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function deleteRunAction(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`${collectorUrl}/runs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      cache: "no-store"
    });

    if (!response.ok) {
      return { ok: false, error: `Collector returned ${response.status}` };
    }

    revalidatePath("/runs");

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Collector is unreachable"
    };
  }
}

export async function deleteRunsAction(
  ids: string[]
): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];

  if (uniqueIds.length === 0) {
    return { ok: true, deleted: 0 };
  }

  try {
    const response = await fetch(`${collectorUrl}/runs`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: uniqueIds }),
      cache: "no-store"
    });

    if (!response.ok) {
      return { ok: false, error: `Collector returned ${response.status}` };
    }

    const payload = (await response.json()) as { deleted?: unknown };

    revalidatePath("/runs");

    return {
      ok: true,
      deleted: typeof payload.deleted === "number" ? payload.deleted : uniqueIds.length
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Collector is unreachable"
    };
  }
}
