"use server";

import { revalidatePath } from "next/cache";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

export async function updateRunOrganizationAction(id: string, formData: FormData): Promise<void> {
  const response = await fetch(`${collectorUrl}/runs/${encodeURIComponent(id)}/organization`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      project: nullableText(formData.get("project")),
      environment: nullableText(formData.get("environment")),
      version: nullableText(formData.get("version")),
      tags: text(formData.get("tags"))
        .split(/[\n,]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
      note: nullableText(formData.get("note")),
      favorite: formData.get("favorite") === "on"
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Collector returned ${response.status} while updating Run organization.`);
  }

  revalidatePath("/runs");
  revalidatePath(`/runs/${id}`);
}

function nullableText(value: FormDataEntryValue | null) {
  const normalized = text(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}
