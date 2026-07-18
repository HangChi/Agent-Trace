import Link from "next/link";
import type { DashboardRun, DashboardTraceEvent, ReplayTask } from "@agent-trace/schema";
import {
  Ban,
  CheckCircle2,
  Clock3,
  Code2,
  Eraser,
  FlaskConical,
  GitCompareArrows,
  Play,
  ShieldCheck,
  Square
} from "lucide-react";

import { ConsoleHeader } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import {
  formatDateTime,
  formatEventType,
  localizedHref,
  parseLocale,
  type Locale
} from "~/lib/i18n";
import { AutoRefresh } from "../runs/run-controls";
import { cancelReplayAction, createReplayAction } from "./actions";

export const dynamic = "force-dynamic";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";

const policy = {
  network: "disabled",
  toolExecution: "mock-only",
  filesystem: "temporary",
  environment: "sanitized"
} as const;

type SearchParamValue = string | string[] | undefined;

export default async function SandboxPage({
  searchParams
}: {
  searchParams: Promise<{
    lang?: SearchParamValue;
    runId?: SearchParamValue;
    eventId?: SearchParamValue;
  }>;
}) {
  const query = await searchParams;
  const locale = parseLocale(query.lang);
  const runId = value(query.runId).trim();
  const requestedEventId = value(query.eventId).trim();
  const [tasks, source] = await Promise.all([
    getJson<{ tasks: ReplayTask[] }>(
      `/sandbox/replays${runId ? `?sourceRunId=${encodeURIComponent(runId)}` : ""}`
    ),
    runId ? getSource(runId) : Promise.resolve({ run: undefined, events: [] })
  ]);
  const selectedEvent =
    source.events.find((event) => event.id === requestedEventId) ?? source.events[0];

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <AutoRefresh collectorUrl={collectorUrl} />
      <ConsoleHeader
        locale={locale}
        path={sandboxPath(runId, selectedEvent?.id)}
      />
      <section className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em]">
              {locale === "zh" ? "安全回放与调试沙箱" : "Safe replay & debug sandbox"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {locale === "zh"
                ? "在固定 Mock Worker 中复现单个事件，生成新的 Run；不会执行用户代码或真实工具调用。"
                : "Replay one event in a fixed mock worker and create a new Run without executing user code or real tools."}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <PolicyCard
            icon={Ban}
            title={locale === "zh" ? "网络禁用" : "Network disabled"}
            detail={policy.network}
          />
          <PolicyCard
            icon={Code2}
            title={locale === "zh" ? "仅 Mock 工具" : "Mock-only tools"}
            detail={policy.toolExecution}
          />
          <PolicyCard
            icon={Eraser}
            title={locale === "zh" ? "临时文件系统" : "Temporary filesystem"}
            detail={policy.filesystem}
          />
          <PolicyCard
            icon={ShieldCheck}
            title={locale === "zh" ? "环境变量净化" : "Sanitized environment"}
            detail={policy.environment}
          />
        </div>

        <Card className="mt-5 py-0">
          <CardContent className="p-5">
            <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              {locale === "en" ? <input type="hidden" name="lang" value="en" /> : null}
              <label className="min-w-0 flex-1 text-xs font-medium text-muted-foreground">
                {locale === "zh" ? "源 Run ID" : "Source Run ID"}
                <input
                  name="runId"
                  defaultValue={runId}
                  required
                  placeholder="run-id"
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground"
                />
              </label>
              <Button type="submit" variant="outline" size="sm">
                {locale === "zh" ? "载入 Run" : "Load Run"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {runId && !source.run ? (
          <Card className="mt-5 py-0">
            <CardContent className="p-5 text-sm text-status-error">
              {locale === "zh" ? "未找到该 Run。" : "Run not found."}
            </CardContent>
          </Card>
        ) : null}

        {source.run ? (
          <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="py-0">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{source.run.name}</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                      {source.run.id}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={localizedHref(`/runs/${encodeURIComponent(source.run.id)}`, locale)}>
                      {locale === "zh" ? "查看详情" : "View details"}
                    </Link>
                  </Button>
                </div>

                {source.events.length > 0 ? (
                  <form action={createReplayAction} className="mt-5 space-y-4 border-t border-border pt-5">
                    <input type="hidden" name="sourceRunId" value={source.run.id} />
                    <label className="block text-xs font-medium text-muted-foreground">
                      {locale === "zh" ? "源事件" : "Source event"}
                      <select
                        name="sourceEventId"
                        defaultValue={selectedEvent?.id}
                        className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                      >
                        {source.events.map((event) => (
                          <option key={event.id} value={event.id}>
                            {formatEventType(event.type, locale)} · {event.name} · {event.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <JsonInput
                        name="input"
                        label={locale === "zh" ? "覆盖输入（JSON，可选）" : "Input override (optional JSON)"}
                        placeholder={jsonPreview(selectedEvent?.input)}
                      />
                      <JsonInput
                        name="mockOutput"
                        label={locale === "zh" ? "Mock 输出（JSON，可选）" : "Mock output (optional JSON)"}
                        placeholder={jsonPreview(selectedEvent?.output)}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <NumberInput
                        name="timeoutMs"
                        label={locale === "zh" ? "超时（毫秒）" : "Timeout (ms)"}
                        defaultValue={5000}
                        min={100}
                        max={30000}
                      />
                      <NumberInput
                        name="delayMs"
                        label={locale === "zh" ? "模拟延迟（毫秒）" : "Simulated delay (ms)"}
                        defaultValue={0}
                        min={0}
                        max={30000}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="simulateError" className="size-4 accent-primary" />
                      {locale === "zh" ? "模拟工具错误" : "Simulate a tool error"}
                    </label>
                    <Button type="submit" size="sm">
                      <Play className="size-4" aria-hidden />
                      {locale === "zh" ? "开始安全回放" : "Start safe replay"}
                    </Button>
                    <p className="text-xs leading-5 text-muted-foreground">
                      {locale === "zh"
                        ? "覆盖项留空时沿用所选事件的原始输入与输出。回放数据会写入本地 SQLite。"
                        : "Leave overrides blank to reuse the selected event input and output. Replay data is stored in local SQLite."}
                    </p>
                  </form>
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">
                    {locale === "zh" ? "该 Run 没有可回放事件。" : "This Run has no replayable events."}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="h-fit py-0">
              <CardContent className="p-5">
                <h2 className="text-sm font-semibold">
                  {locale === "zh" ? "本次回放边界" : "Replay boundary"}
                </h2>
                <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  <li>{locale === "zh" ? "不接受 Shell、脚本或任意用户代码。" : "No shell, scripts, or arbitrary user code are accepted."}</li>
                  <li>{locale === "zh" ? "子进程只读取受控清单并返回 Mock 结果。" : "The child process only reads a controlled manifest and returns a mock result."}</li>
                  <li>{locale === "zh" ? "超时或取消会终止 Worker 并清理临时目录。" : "Timeout or cancellation terminates the worker and cleans its workspace."}</li>
                  <li>{locale === "zh" ? "网络禁用来自固定 Worker 能力边界，并非操作系统级网络沙箱。" : "Network is excluded by the fixed worker capability boundary, not an OS-level network sandbox."}</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        ) : null}

        <Card className="mt-5 overflow-hidden py-0">
          <div className="flex items-center gap-2 border-b border-border bg-surface-muted/60 px-5 py-4">
            <FlaskConical className="size-4 text-primary" aria-hidden />
            <h2 className="text-sm font-semibold">
              {locale === "zh" ? "回放任务" : "Replay tasks"}
            </h2>
          </div>
          <CardContent className="p-0">
            {tasks.tasks.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">
                {locale === "zh" ? "暂无回放任务。" : "No replay tasks yet."}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {tasks.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} locale={locale} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}

function TaskRow({ task, locale }: { task: ReplayTask; locale: Locale }) {
  const active = task.status === "queued" || task.status === "running";
  return (
    <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusIcon status={task.status} />
          <span className="text-sm font-medium">{statusLabel(task.status, locale)}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{task.id}</span>
        </div>
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {task.sourceRunId} · {task.sourceEventId} · {formatDateTime(task.createdAt, locale)}
        </p>
        {task.error ? <p className="mt-1 font-mono text-xs text-status-error">{task.error}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {task.replayRunId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={localizedHref(`/runs/${encodeURIComponent(task.replayRunId)}`, locale)}>
              {locale === "zh" ? "回放 Run" : "Replay Run"}
            </Link>
          </Button>
        ) : null}
        {task.replayRunId ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={localizedHref(`/runs/compare?ids=${encodeURIComponent(task.sourceRunId)},${encodeURIComponent(task.replayRunId)}`, locale)}>
              <GitCompareArrows className="size-4" aria-hidden />
              {locale === "zh" ? "对比" : "Compare"}
            </Link>
          </Button>
        ) : null}
        {active ? (
          <form action={cancelReplayAction.bind(null, task.id)}>
            <Button type="submit" variant="destructive" size="sm">
              <Square className="size-3" aria-hidden />
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function PolicyCard({ icon: Icon, title, detail }: { icon: typeof Ban; title: string; detail: string }) {
  return (
    <Card className="py-0">
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="size-4 text-primary" aria-hidden />
        <div><p className="text-sm font-medium">{title}</p><p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{detail}</p></div>
      </CardContent>
    </Card>
  );
}

function JsonInput({ name, label, placeholder }: { name: string; label: string; placeholder: string }) {
  return <label className="block text-xs font-medium text-muted-foreground">{label}<textarea name={name} rows={6} placeholder={placeholder} className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/60" /></label>;
}

function NumberInput({ name, label, defaultValue, min, max }: { name: string; label: string; defaultValue: number; min: number; max: number }) {
  return <label className="block text-xs font-medium text-muted-foreground">{label}<input type="number" name={name} defaultValue={defaultValue} min={min} max={max} required className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-sm text-foreground" /></label>;
}

function StatusIcon({ status }: { status: ReplayTask["status"] }) {
  if (status === "completed") return <CheckCircle2 className="size-4 text-status-success" aria-hidden />;
  return <Clock3 className={`size-4 ${status === "error" || status === "timeout" ? "text-status-error" : "text-muted-foreground"}`} aria-hidden />;
}

function statusLabel(status: ReplayTask["status"], locale: Locale) {
  const labels = locale === "zh"
    ? { queued: "排队中", running: "运行中", completed: "已完成", error: "失败", cancelled: "已取消", timeout: "已超时" }
    : { queued: "Queued", running: "Running", completed: "Completed", error: "Failed", cancelled: "Cancelled", timeout: "Timed out" };
  return labels[status];
}

async function getSource(runId: string) {
  const encoded = encodeURIComponent(runId);
  const [run, events] = await Promise.all([
    getOptionalJson<DashboardRun>(`/runs/${encoded}`),
    getOptionalJson<DashboardTraceEvent[]>(`/runs/${encoded}/events?legacy=1`)
  ]);
  return { run, events: events ?? [] };
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${collectorUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
  return response.json() as Promise<T>;
}

async function getOptionalJson<T>(path: string): Promise<T | undefined> {
  const response = await fetch(`${collectorUrl}${path}`, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
  return response.json() as Promise<T>;
}

function sandboxPath(runId?: string, eventId?: string) {
  const params = new URLSearchParams();
  if (runId) params.set("runId", runId);
  if (eventId) params.set("eventId", eventId);
  return `/sandbox${params.size ? `?${params}` : ""}`;
}

function jsonPreview(input: unknown) {
  return input === undefined ? "" : JSON.stringify(input, null, 2);
}

function value(input: SearchParamValue) {
  return Array.isArray(input) ? input[0] ?? "" : input ?? "";
}
