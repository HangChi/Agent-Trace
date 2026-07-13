import type { DashboardScannerStatus, ScannerDiagnostic } from "@agent-trace/schema";

export type { ScannerDiagnostic } from "@agent-trace/schema";

export async function fetchScannerStatus(
  collectorUrl: string,
  fetcher: typeof fetch = fetch
): Promise<DashboardScannerStatus> {
  try {
    const response = await fetcher(`${collectorUrl}/usage/scanner`, { cache: "no-store" });
    if (!response.ok) return { diagnostics: [], error: `Collector returned ${response.status}` };
    const body = asRecord(await response.json());
    const diagnostics = (Array.isArray(body.diagnostics) ? body.diagnostics : [])
      .map((item) => normalizeDiagnostic(asRecord(item)))
      .filter((item): item is ScannerDiagnostic => item !== undefined)
      .sort((a, b) => statusRank(a.status) - statusRank(b.status));
    return {
      scannedAt: getString(body.scannedAt),
      diagnostics,
      error: getString(body.error)
    };
  } catch (error) {
    return { diagnostics: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeDiagnostic(record: Record<string, unknown>): ScannerDiagnostic | undefined {
  const client = getString(record.client);
  const status = getString(record.status);
  if (!client || !status) return undefined;
  const messageCount = getNumber(record.messageCount);
  return {
    client,
    status,
    messageCount: messageCount > 0 ? messageCount : undefined,
    path: getString(record.path),
    pathExists: typeof record.pathExists === "boolean" ? record.pathExists : undefined,
    warning: getString(record.warning),
    actionHint: getString(record.actionHint)
  };
}

function statusRank(status: string) {
  const ranks: Record<string, number> = {
    needs_sync: 0,
    needs_login: 1,
    error: 2,
    missing: 3,
    waiting: 4,
    synced: 5,
    available: 6
  };
  return ranks[status] ?? 7;
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function getNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
