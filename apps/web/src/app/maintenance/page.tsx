import { Database, Eraser, KeyRound, RotateCcw } from "lucide-react";

import { ConsoleHeader } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { parseLocale, type Locale } from "~/lib/i18n";
import {
  compactDatabaseAction,
  pruneRunsAction,
  restoreTombstoneAction,
  updatePrivacySettingsAction
} from "./actions";

export const dynamic = "force-dynamic";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

type StorageStats = {
  databasePath: string;
  databaseBytes?: number;
  runs: number;
  events: number;
  usageSessions: number;
  tombstones: number;
};

type Tombstone = { runId: string; deletedAt: string; reason?: string };
type PrivacySettings = { sensitiveKeys: string[]; replacement: string };

export default async function MaintenancePage({
  searchParams
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const locale = parseLocale(params.lang);
  const [stats, tombstones, privacy] = await Promise.all([
    getJson<StorageStats>("/maintenance/storage"),
    getJson<{ tombstones: Tombstone[] }>("/maintenance/tombstones?limit=50"),
    getJson<PrivacySettings>("/maintenance/privacy")
  ]);

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <ConsoleHeader locale={locale} path="/maintenance" />
      <section className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          {locale === "zh" ? "本地治理" : "Local governance"}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em]">
          {locale === "zh" ? "维护与隐私控制中心" : "Maintenance & privacy"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {locale === "zh" ? "管理本地 SQLite 容量、保留期、删除墓碑与写入前字段脱敏。" : "Manage local SQLite capacity, retention, tombstones, and pre-storage field redaction."}
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label={locale === "zh" ? "数据库" : "Database"} value={formatBytes(stats.databaseBytes)} />
          <Metric label="Runs" value={stats.runs.toLocaleString()} />
          <Metric label="Events" value={stats.events.toLocaleString()} />
          <Metric label={locale === "zh" ? "用量会话" : "Usage sessions"} value={stats.usageSessions.toLocaleString()} />
          <Metric label={locale === "zh" ? "墓碑" : "Tombstones"} value={stats.tombstones.toLocaleString()} />
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden py-0">
            <SectionTitle icon={Eraser} title={locale === "zh" ? "保留期与压缩" : "Retention & compaction"} />
            <CardContent className="space-y-5 p-5">
              <form action={pruneRunsAction} className="space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === "zh" ? "删除早于此日期的 Run" : "Delete Runs before"}
                  <input required type="date" name="before" className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                </label>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(["success", "error", "running"] as const).map((status) => (
                    <label key={status} className="flex items-center gap-2"><input type="checkbox" name="statuses" value={status} defaultChecked={status !== "running"} className="size-4 accent-primary" />{status}</label>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="keepTombstones" defaultChecked className="size-4 accent-primary" />{locale === "zh" ? "保留墓碑，阻止历史重新生成" : "Keep tombstones to prevent recreation"}</label>
                <Button type="submit" variant="destructive" size="sm">{locale === "zh" ? "执行清理" : "Prune Runs"}</Button>
              </form>
              <form action={compactDatabaseAction} className="border-t border-border pt-4">
                <Button type="submit" variant="outline" size="sm"><Database className="size-4" />{locale === "zh" ? "压缩数据库" : "Compact database"}</Button>
              </form>
              <p className="break-all font-mono text-[11px] text-muted-foreground">{stats.databasePath}</p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden py-0">
            <SectionTitle icon={KeyRound} title={locale === "zh" ? "写入前字段脱敏" : "Pre-storage field redaction"} />
            <CardContent className="p-5">
              <form action={updatePrivacySettingsAction} className="space-y-3">
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === "zh" ? "敏感字段名（逗号或换行分隔）" : "Sensitive field names (comma or newline separated)"}
                  <textarea name="sensitiveKeys" rows={7} defaultValue={privacy.sensitiveKeys.join("\n")} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm" />
                </label>
                <label className="block text-xs font-medium text-muted-foreground">
                  {locale === "zh" ? "替换文本" : "Replacement"}
                  <input name="replacement" defaultValue={privacy.replacement} required className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm" />
                </label>
                <Button type="submit" size="sm">{locale === "zh" ? "保存脱敏规则" : "Save redaction rules"}</Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-5 overflow-hidden py-0">
          <SectionTitle icon={RotateCcw} title={locale === "zh" ? "已删除 Run" : "Deleted Runs"} />
          <CardContent className="p-0">
            {tombstones.tombstones.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">{locale === "zh" ? "暂无删除墓碑。" : "No tombstones."}</p>
            ) : (
              <div className="divide-y divide-border">
                {tombstones.tombstones.map((entry) => (
                  <div key={entry.runId} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0"><p className="break-all font-mono text-xs text-foreground">{entry.runId}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.deletedAt, locale)} · {entry.reason ?? "-"}</p></div>
                    <form action={restoreTombstoneAction.bind(null, entry.runId)}><Button type="submit" variant="outline" size="sm"><RotateCcw className="size-4" />{locale === "zh" ? "允许重新采集" : "Allow recollection"}</Button></form>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Card className="py-0"><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold">{value}</p></CardContent></Card>;
}

function SectionTitle({ icon: Icon, title }: { icon: typeof Database; title: string }) {
  return <div className="flex items-center gap-2 border-b border-border bg-surface-muted/60 px-5 py-4"><Icon className="size-4 text-primary" /><h2 className="text-sm font-semibold">{title}</h2></div>;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${collectorUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
  return response.json() as Promise<T>;
}

function formatBytes(value?: number) {
  if (value === undefined) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 ** 2).toFixed(1)} MiB`;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
