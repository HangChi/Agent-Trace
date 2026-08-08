import { Database, Eraser, KeyRound, RotateCcw } from "lucide-react";

import { ConsoleHeader } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { parseLocale, type Locale } from "~/lib/i18n";
import {
  compactDatabaseAction,
  purgeStoredCommandsAction,
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
type PrivacySettings = {
  sensitiveKeys: string[];
  replacement: string;
  commandCapture: "metadata" | "full";
};
type CommandStats = { runs: number; events: number };

export default async function MaintenancePage({
  searchParams
}: {
  searchParams: Promise<{ lang?: string | string[] }>;
}) {
  const params = await searchParams;
  const locale = parseLocale(params.lang);
  const [stats, tombstones, privacy, commandStats] = await Promise.all([
    getJson<StorageStats>("/maintenance/storage"),
    getJson<{ tombstones: Tombstone[] }>("/maintenance/tombstones?limit=50"),
    getJson<PrivacySettings>("/maintenance/privacy"),
    getJson<CommandStats>("/maintenance/privacy/commands")
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
                <fieldset className="space-y-2 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-medium text-muted-foreground">
                    {locale === "zh" ? "\u547d\u4ee4\u6b63\u6587\u91c7\u96c6" : "Command body capture"}
                  </legend>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="commandCapture" value="metadata" defaultChecked={privacy.commandCapture !== "full"} className="mt-0.5 size-4 accent-primary" />
                    <span>
                      <span className="block font-medium">{locale === "zh" ? "\u4ec5\u5143\u6570\u636e\uff08\u63a8\u8350\uff09" : "Metadata only (recommended)"}</span>
                      <span className="block text-xs text-muted-foreground">{locale === "zh" ? "\u8ffd\u8e2a\u547d\u4ee4\u7c7b\u578b\u3001\u5de5\u5177\u540d\u548c\u72b6\u6001\uff0c\u4e0d\u4fdd\u5b58\u547d\u4ee4\u6b63\u6587\u3002" : "Track command type, tool name, and status without storing the command body."}</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="radio" name="commandCapture" value="full" defaultChecked={privacy.commandCapture === "full"} className="mt-0.5 size-4 accent-primary" />
                    <span>
                      <span className="block font-medium">{locale === "zh" ? "\u4fdd\u5b58\u5b8c\u6574\u6b63\u6587" : "Store full body"}</span>
                      <span className="block text-xs text-status-error">{locale === "zh" ? "\u547d\u4ee4\u53ef\u80fd\u5305\u542b\u4ee4\u724c\u3001\u5bc6\u7801\u3001\u8def\u5f84\u6216\u5176\u4ed6\u654f\u611f\u4fe1\u606f\u3002" : "Commands may contain tokens, passwords, paths, or other sensitive data."}</span>
                    </span>
                  </label>
                </fieldset>
                <Button type="submit" size="sm">{locale === "zh" ? "保存脱敏规则" : "Save redaction rules"}</Button>
              </form>
              <form action={purgeStoredCommandsAction} className="mt-5 space-y-3 border-t border-border pt-4">
                <div>
                  <p className="text-sm font-medium">{locale === "zh" ? "\u6e05\u7406\u5df2\u4fdd\u5b58\u7684\u547d\u4ee4\u6b63\u6587" : "Purge stored command bodies"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {locale === "zh"
                      ? `\u5f53\u524d\u6709 ${commandStats.events.toLocaleString()} \u4e2a\u4e8b\u4ef6\uff08${commandStats.runs.toLocaleString()} \u4e2a Run\uff09\u4fdd\u5b58\u4e86\u547d\u4ee4\u6b63\u6587\u3002\u6e05\u7406\u540e\u4ecd\u4fdd\u7559\u547d\u4ee4\u5143\u6570\u636e\u3002`
                      : `${commandStats.events.toLocaleString()} events across ${commandStats.runs.toLocaleString()} Runs currently store command bodies. Metadata is retained after purging.`}
                  </p>
                </div>
                <label className="flex items-start gap-2 text-xs text-muted-foreground">
                  <input required type="checkbox" name="confirmCommandPurge" className="mt-0.5 size-4 accent-primary" />
                  {locale === "zh" ? "\u6211\u786e\u8ba4\u6c38\u4e45\u5220\u9664\u73b0\u6709\u547d\u4ee4\u6b63\u6587\uff1b\u6b64\u64cd\u4f5c\u65e0\u6cd5\u64a4\u9500\u3002" : "I confirm permanent deletion of existing command bodies; this cannot be undone."}
                </label>
                <Button type="submit" variant="destructive" size="sm" disabled={commandStats.events === 0}>
                  {locale === "zh" ? "\u6e05\u7406\u547d\u4ee4\u6b63\u6587" : "Purge command bodies"}
                </Button>
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
