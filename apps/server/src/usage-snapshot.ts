export type StoredUsageEvent = {
  id: string;
  metadataJson: string | null;
};

export function getStaleUsageScanEventIds(
  existingEvents: StoredUsageEvent[],
  currentEventIds: ReadonlySet<string>,
  complete: boolean,
  scanClients?: ReadonlySet<string>
) {
  if (!complete) {
    return [];
  }

  return existingEvents
    .filter((event) => {
      const metadata = getJsonObject(event.metadataJson);

      return (
        metadata?.source === "usage-scan" &&
        !currentEventIds.has(event.id) &&
        (scanClients === undefined ||
          (typeof metadata.usageClient === "string" && scanClients.has(metadata.usageClient)))
      );
    })
    .map((event) => event.id);
}

export function isUsageScanJson(value: string | null) {
  return getJsonSource(value) === "usage-scan";
}

function getJsonSource(value: string | null) {
  return getJsonObject(value)?.source;
}

function getJsonObject(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
