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
