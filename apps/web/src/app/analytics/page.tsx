import type {
  AnalyticsBreakdown,
  AnalyticsBudget,
  AnalyticsBudgetAlert,
  AnalyticsDimension
} from "@agent-trace/schema";
import { AlertTriangle, BarChart3, Plus, Trash2 } from "lucide-react";
import Link from "next/link";

import { ConsoleHeader } from "~/components";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { localizedHref, parseLocale } from "~/lib/i18n";
import {
  analyticsDimensionLabel,
  budgetMetricLabel,
  budgetPeriodLabel
} from "~/lib/p1-labels";
import { createBudgetAction, deleteBudgetAction } from "./actions";

export const dynamic = "force-dynamic";

const collectorUrl =
  process.env.AGENT_TRACE_API_URL ?? process.env.TOOLTRACE_API_URL ?? "http://localhost:4319";
const dimensions: AnalyticsDimension[] = ["project", "environment", "model", "source"];

export default async function AnalyticsPage({
  searchParams
}: {
  searchParams: Promise<{ lang?: string | string[]; dimension?: string | string[] }>;
}) {
  const params = await searchParams;
  const locale = parseLocale(params.lang);
  const requestedDimension = Array.isArray(params.dimension) ? params.dimension[0] : params.dimension;
  const dimension = dimensions.includes(requestedDimension as AnalyticsDimension)
    ? requestedDimension as AnalyticsDimension
    : "project";
  const [breakdown, budgetBody, alertBody] = await Promise.all([
    getJson<AnalyticsBreakdown>(`/analytics/breakdown?dimension=${dimension}&days=30`),
    getJson<{ budgets: AnalyticsBudget[] }>("/analytics/budgets"),
    getJson<{ alerts: AnalyticsBudgetAlert[] }>("/analytics/alerts")
  ]);

  return (
    <main id="main-content" className="min-h-dvh bg-background text-foreground">
      <ConsoleHeader locale={locale} path={`/analytics?dimension=${dimension}`} collectorUrl={collectorUrl} />
      <section className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="flex items-start gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><BarChart3 className="size-5" /></span>
          <div><h1 className="text-2xl font-semibold tracking-[-0.04em]">{locale === "zh" ? "多维分析与预算" : "Analytics & budgets"}</h1><p className="mt-1 text-sm text-muted-foreground">{locale === "zh" ? "按业务维度聚合运行质量、Token 和成本，并监控预算。" : "Aggregate quality, tokens, and cost by business dimension and monitor guardrails."}</p></div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {dimensions.map((item) => (
            <Button key={item} variant={item === dimension ? "default" : "outline"} size="sm" asChild>
              <Link href={localizedHref(`/analytics?dimension=${item}`, locale)}>
                {analyticsDimensionLabel(locale, item)}
              </Link>
            </Button>
          ))}
        </div>

        <Card className="mt-4 overflow-hidden py-0">
          <Table containerClassName="overflow-x-auto">
            <TableHeader><TableRow className="bg-surface-muted/90 hover:bg-surface-muted/90"><TableHead>{analyticsDimensionLabel(locale, dimension)}</TableHead><TableHead>{locale === "zh" ? "Run 数" : "Runs"}</TableHead><TableHead>{locale === "zh" ? "失败率" : "Failure rate"}</TableHead><TableHead>{locale === "zh" ? "平均耗时" : "Avg duration"}</TableHead><TableHead>{locale === "zh" ? "Token 数" : "Tokens"}</TableHead><TableHead>{locale === "zh" ? "成本" : "Cost"}</TableHead></TableRow></TableHeader>
            <TableBody>{breakdown.groups.map((group) => <TableRow key={group.key}><TableCell className="font-medium">{group.key}</TableCell><TableCell>{group.runCount}</TableCell><TableCell>{(group.failureRate * 100).toFixed(1)}%</TableCell><TableCell>{formatDuration(group.averageDurationMs, locale)}</TableCell><TableCell>{group.totalTokens.toLocaleString()}</TableCell><TableCell>${group.costUsd.toFixed(4)}</TableCell></TableRow>)}</TableBody>
          </Table>
          {breakdown.groups.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{locale === "zh" ? "最近 30 天暂无数据。" : "No data in the last 30 days."}</p> : null}
        </Card>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.35fr]">
          <Card className="py-0"><CardContent className="p-5"><h2 className="text-sm font-semibold">{locale === "zh" ? "新建预算" : "New budget"}</h2><form action={createBudgetAction} className="mt-4 grid gap-3 sm:grid-cols-2"><Field name="name" label={locale === "zh" ? "名称" : "Name"} required /><label className="text-xs font-medium text-muted-foreground">{locale === "zh" ? "周期" : "Period"}<select name="period" className={controlClass}><option value="daily">{budgetPeriodLabel(locale, "daily")}</option><option value="monthly">{budgetPeriodLabel(locale, "monthly")}</option></select></label><label className="text-xs font-medium text-muted-foreground">{locale === "zh" ? "维度" : "Dimension"}<select name="dimension" className={controlClass}>{dimensions.map((item) => <option key={item} value={item}>{analyticsDimensionLabel(locale, item)}</option>)}</select></label><Field name="value" label={locale === "zh" ? "维度值" : "Dimension value"} required /><Field name="maxCostUsd" label={locale === "zh" ? "成本上限（美元）" : "Max cost (USD)"} type="number" step="0.0001" /><Field name="maxTokens" label={locale === "zh" ? "Token 上限" : "Token limit"} type="number" /><Field name="maxRuns" label={locale === "zh" ? "Run 数上限" : "Run limit"} type="number" /><div className="flex items-end"><Button type="submit" size="sm"><Plus className="size-4" />{locale === "zh" ? "创建预算" : "Create budget"}</Button></div></form></CardContent></Card>

          <Card className="overflow-hidden py-0"><div className="border-b border-border bg-surface-muted/60 px-5 py-4"><h2 className="text-sm font-semibold">{locale === "zh" ? "预算与告警" : "Budgets & alerts"}</h2></div><div className="divide-y divide-border">{alertBody.alerts.map((alert) => <div key={`${alert.budgetId}:${alert.metric}`} className="flex gap-3 bg-destructive/5 px-5 py-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" /><p className="text-sm"><span className="font-medium">{alert.budgetName}</span> · {budgetMetricLabel(locale, alert.metric)}：{alert.actual.toLocaleString()} / {alert.limit.toLocaleString()}</p></div>)}{budgetBody.budgets.map((budget) => <div key={budget.id} className="flex items-center justify-between gap-4 px-5 py-4"><div><p className="text-sm font-medium">{budget.name}</p><p className="mt-1 text-xs text-muted-foreground">{analyticsDimensionLabel(locale, budget.dimension)}={budget.value} · {budgetPeriodLabel(locale, budget.period)} · {formatLimits(budget, locale)}</p></div><form action={deleteBudgetAction.bind(null, budget.id)}><Button type="submit" size="icon-xs" variant="ghost" aria-label={locale === "zh" ? "删除预算" : "Delete budget"}><Trash2 className="size-3.5" /></Button></form></div>)}{budgetBody.budgets.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{locale === "zh" ? "尚未配置预算。" : "No budgets configured."}</p> : null}</div></Card>
        </div>
      </section>
    </main>
  );
}

const controlClass = "mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground";

function Field({ name, label, type = "text", required, step }: { name: string; label: string; type?: string; required?: boolean; step?: string }) {
  return <label className="text-xs font-medium text-muted-foreground">{label}<input name={name} type={type} required={required} step={step} min={type === "number" ? 0 : undefined} className={controlClass} /></label>;
}

function formatLimits(budget: AnalyticsBudget, locale: "zh" | "en") {
  return [
    budget.maxCostUsd === undefined ? undefined : `${locale === "zh" ? "成本" : "Cost"} $${budget.maxCostUsd}`,
    budget.maxTokens === undefined ? undefined : `${budget.maxTokens} ${locale === "zh" ? "Token" : "tokens"}`,
    budget.maxRuns === undefined ? undefined : `${budget.maxRuns} ${locale === "zh" ? "个 Run" : "runs"}`
  ].filter(Boolean).join(" / ");
}

function formatDuration(value: number, locale: "zh" | "en") {
  return locale === "zh" ? `${value.toLocaleString()} 毫秒` : `${value.toLocaleString()} ms`;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${collectorUrl}${path}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Collector returned ${response.status} for ${path}.`);
  return response.json() as Promise<T>;
}
