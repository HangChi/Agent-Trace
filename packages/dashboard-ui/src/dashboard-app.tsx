"use client";

import {
  Activity, AlertCircle, BarChart3, CalendarDays, CheckCircle2, ChevronLeft,
  ChevronRight, Coins, Database, Eye, EyeOff, FlaskConical, HardDrive,
  Home, Languages, Moon, Play, RefreshCw, RotateCcw, Settings2, ShieldCheck,
  Sun, Trash2, Workflow, Wrench
} from "lucide-react";
import type {
  AnalyticsBreakdown, AnalyticsBudget, AnalyticsBudgetAlert, DashboardEventPage,
  DashboardRun, DashboardRunComparison, DashboardRunPage, DashboardRunTrends,
  DashboardScannerStatus, DashboardTraceInsight, DashboardUsageSummary,
  EvaluationDatasetReport, EvaluationDatasetSummary, PrivacySettings, ReplayTask
} from "@agent-trace/schema";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { DashboardAppProps, DashboardLocale, DashboardNavigate, DashboardRoute, DashboardRouterMode } from "./contracts";

type PageContext = {
  client: CollectorClient;
  locale: DashboardLocale;
  navigate: DashboardNavigate;
  route: DashboardRoute;
};

type Resource<T> = { data?: T; error?: string; loading: boolean; reload: () => void };
type JsonObject = Record<string, unknown>;

export class CollectorClient {
  constructor(private readonly base: string) {}

  get baseUrl() { return this.base; }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async send<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", value?: unknown): Promise<T> {
    return this.request<T>(path, {
      method,
      headers: value === undefined ? undefined : { "content-type": "application/json" },
      body: value === undefined ? undefined : JSON.stringify(value)
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.base}${path}`, { cache: "no-store", ...init });
    if (!response.ok) throw new Error(`Collector returned ${response.status}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}

function useResource<T>(key: string, load: () => Promise<T>): Resource<T> {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<Omit<Resource<T>, "reload">>({ loading: true });
  useEffect(() => {
    let active = true;
    setState(previous => ({ ...previous, loading: true, error: undefined }));
    void load().then(
      data => active && setState({ data, loading: false }),
      error => active && setState({ error: error instanceof Error ? error.message : String(error), loading: false })
    );
    return () => { active = false; };
  }, [key, version]);
  return { ...state, reload: () => setVersion(value => value + 1) };
}

function readRoute(mode: DashboardRouterMode, initialPath: string): DashboardRoute {
  if (typeof window === "undefined") return parseRoute(initialPath);
  if (mode === "hash") return parseRoute(window.location.hash.replace(/^#/, "") || initialPath);
  return parseRoute(`${window.location.pathname}${window.location.search}`);
}

function parseRoute(value: string): DashboardRoute {
  const [path, search = ""] = value.split("?", 2);
  return { path: path || "/runs", query: new URLSearchParams(search) };
}

function useDashboardRoute(mode: DashboardRouterMode, initialPath: string) {
  const [route, setRoute] = useState(() => readRoute(mode, initialPath));
  useEffect(() => {
    const event = mode === "hash" ? "hashchange" : "popstate";
    const update = () => setRoute(readRoute(mode, initialPath));
    window.addEventListener(event, update);
    update();
    return () => window.removeEventListener(event, update);
  }, [mode, initialPath]);
  const navigate = useCallback((path: string) => {
    if (mode === "hash") window.location.hash = path;
    else {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [mode]);
  return { route, navigate };
}

export function DashboardApp({ apiBase, routerMode = "browser", initialPath = "/runs" }: DashboardAppProps) {
  const { route, navigate } = useDashboardRoute(routerMode, initialPath);
  const client = useMemo(() => new CollectorClient(apiBase.replace(/\/$/, "")), [apiBase]);
  const [connected, setConnected] = useState(false);
  const [dark, setDark] = useState(false);
  const locale: DashboardLocale = route.query.get("lang") === "en" ? "en" : "zh";

  useEffect(() => {
    const stored = localStorage.getItem("agent-trace-theme");
    const next = stored === "dark" || (stored === null && matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(next);
  }, []);
  useEffect(() => { document.documentElement.classList.toggle("dark", dark); }, [dark]);
  useEffect(() => {
    let active = true;
    const check = () => void client.get("/health").then(() => active && setConnected(true), () => active && setConnected(false));
    check();
    const timer = window.setInterval(check, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [client]);

  const changeLocale = () => {
    const query = new URLSearchParams(route.query);
    locale === "zh" ? query.set("lang", "en") : query.delete("lang");
    navigate(withQuery(route.path, query));
  };
  const context = { client, locale, navigate, route };

  return (
    <div className="at-app">
      <DashboardShell
        connected={connected}
        dark={dark}
        locale={locale}
        navigate={navigate}
        path={route.path}
        routerMode={routerMode}
        onLocale={changeLocale}
        onTheme={() => { const next = !dark; localStorage.setItem("agent-trace-theme", next ? "dark" : "light"); setDark(next); }}
      />
      <main className="at-main">{renderRoute(context)}</main>
    </div>
  );
}

function renderRoute(context: PageContext) {
  const { path } = context.route;
  if (path === "/" || path === "/runs") return <RunsView {...context} />;
  if (path === "/runs/compare") return <RunCompareView {...context} />;
  if (path.startsWith("/runs/")) return <RunDetailView {...context} id={decodeURIComponent(path.slice(6))} />;
  if (path === "/token-trace") return <TokenTraceView {...context} />;
  if (path === "/analytics") return <AnalyticsView {...context} />;
  if (path === "/evaluations") return <EvaluationsView {...context} />;
  if (path === "/sandbox") return <SandboxView {...context} />;
  if (path === "/maintenance") return <MaintenanceView {...context} />;
  return <StatePanel title={tr(context.locale, "页面不存在", "Page not found")} body={path} />;
}

export function DashboardShell(props: {
  connected: boolean; dark: boolean; locale: DashboardLocale; navigate: DashboardNavigate;
  path: string; routerMode: DashboardRouterMode; onLocale: () => void; onTheme: () => void;
}) {
  const links = [
    ["/runs", tr(props.locale, "首页", "Home"), Home],
    ["/token-trace", "Token-Trace", Coins],
    ["/analytics", tr(props.locale, "分析", "Analytics"), BarChart3],
    ["/evaluations", tr(props.locale, "评测", "Evaluations"), FlaskConical],
    ["/sandbox", tr(props.locale, "回放", "Replay"), ShieldCheck],
    ["/maintenance", tr(props.locale, "维护", "Maintenance"), HardDrive]
  ] as const;
  return (
    <header className="at-header">
      <a className="at-brand" href={hrefFor(props.routerMode, "/runs")} onClick={linkClick(props.navigate, "/runs")}>
        <span className="at-logo"><Workflow size={20} /></span>
        <div><strong>Agent-Trace</strong><small>LOCAL OBSERVABILITY</small></div>
      </a>
      <nav className="at-nav">
        {links.map(([path, label, Icon]) => (
          <a key={path} className={props.path === path || (path === "/runs" && props.path.startsWith("/runs")) ? "active" : ""} href={hrefFor(props.routerMode, path)} onClick={linkClick(props.navigate, path)}>
            <Icon size={15} /><span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="at-header-actions">
        <span className={`at-connection ${props.connected ? "" : "off"}`}>{tr(props.locale, props.connected ? "已连接" : "连接中", props.connected ? "Connected" : "Connecting")}</span>
        <button type="button" title={tr(props.locale, "切换语言", "Switch language")} onClick={props.onLocale}><Languages size={15} />{props.locale === "zh" ? "中" : "EN"}</button>
        <button type="button" title={tr(props.locale, "切换主题", "Switch theme")} onClick={props.onTheme}>{props.dark ? <Sun size={15} /> : <Moon size={15} />}</button>
      </div>
    </header>
  );
}

export function RunsView(context: PageContext) {
  const { client, locale, navigate, route } = context;
  const page = Math.max(1, numberParam(route.query.get("page"), 1));
  const all = route.query.get("runs") === "all";
  const query = new URLSearchParams({ page: String(page), pageSize: "20" });
  if (all) query.set("includeUntracked", "true");
  for (const key of ["q", "status", "source", "model", "startedAfter", "startedBefore", "sort", "order"] as const) {
    const value = route.query.get(key); if (value) query.set(key, value);
  }
  const resource = useResource(`runs:${query}`, () => Promise.all([
    client.get<DashboardRunPage>(`/runs?${query}`),
    client.get<DashboardScannerStatus>("/usage/scanner").catch((): DashboardScannerStatus => ({ diagnostics: [] }))
  ]));
  const [selected, setSelected] = useState<string[]>([]);
  if (resource.loading && !resource.data) return <LoadingState locale={locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={locale} error={resource.error} retry={resource.reload} />;
  const [data, scanner] = resource.data;
  const sources = data.summary.agents.map(item => `${item.agent} ${item.count}`).join(" / ");
  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    if (all) next.set("runs", "all");
    if (locale === "en") next.set("lang", "en");
    for (const key of ["q", "status", "source", "model", "startedAfter", "startedBefore"] as const) {
      const value = String(form.get(key) || "").trim(); if (value) next.set(key, value);
    }
    navigate(withQuery("/runs", next));
  };
  const deleteIds = async (ids: string[]) => {
    if (!ids.length || !window.confirm(tr(locale, `确定删除 ${ids.length} 个 Run？`, `Delete ${ids.length} runs?`))) return;
    await client.send("/runs", "DELETE", { ids });
    setSelected([]); resource.reload();
  };
  return (
    <>
      <PageHead locale={locale} eyebrow="LOCAL AGENT OBSERVABILITY" title={tr(locale, "Agent 追踪台", "Agent console")} body={tr(locale, "集中查看 Agent 的命令、工具调用、Skills、MCP 与 Token 消耗，快速还原执行路径。", "Inspect commands, tools, skills, MCP usage, and token costs from one console.")} />
      <TelemetryStrip items={[
        [tr(locale, "全部运行", "All runs"), fmt(data.summary.totalRuns), ""],
        [tr(locale, "Agent 来源", "Agent sources"), fmt(data.summary.agents.length), sources],
        [tr(locale, "进行中", "Running"), fmt(data.summary.runningRuns), ""],
        [tr(locale, "异常", "Errors"), fmt(data.summary.failedRuns), scanner.scannedAt ? `${tr(locale, "扫描", "Scanned")} ${formatDate(scanner.scannedAt, locale)}` : ""]
      ]} />
      <form className="at-filter" onSubmit={applyFilters}>
        <Field label={tr(locale, "搜索", "Search")}><input className="at-control" name="q" defaultValue={route.query.get("q") || ""} placeholder={tr(locale, "名称、ID、会话或来源", "Name, ID, session, or source")} /></Field>
        <Field label={tr(locale, "状态", "Status")}><select className="at-control" name="status" defaultValue={route.query.get("status") || ""}><option value="">{tr(locale, "全部", "All")}</option><option value="success">{tr(locale, "成功", "Success")}</option><option value="running">{tr(locale, "进行中", "Running")}</option><option value="error">{tr(locale, "异常", "Error")}</option></select></Field>
        <Field label={tr(locale, "来源", "Source")}><input className="at-control" name="source" defaultValue={route.query.get("source") || ""} placeholder="codex" /></Field>
        <Field label={tr(locale, "模型", "Model")}><input className="at-control" name="model" defaultValue={route.query.get("model") || ""} placeholder="gpt-5" /></Field>
        <Field label={tr(locale, "开始日期", "From")}><input className="at-control" type="date" name="startedAfter" defaultValue={route.query.get("startedAfter") || ""} /></Field>
        <Field label={tr(locale, "结束日期", "To")}><input className="at-control" type="date" name="startedBefore" defaultValue={route.query.get("startedBefore") || ""} /></Field>
        <div className="at-actions"><button className="at-button primary">{tr(locale, "应用筛选", "Apply")}</button><button className="at-button" type="button" onClick={() => navigate(locale === "en" ? "/runs?lang=en" : "/runs")}>{tr(locale, "重置", "Reset")}</button></div>
      </form>
      <section className="at-card">
        <div className="at-card-head"><div><h2>{tr(locale, "最近运行", "Recent runs")} <Badge>{fmt(data.pagination.total)}</Badge></h2><p>{tr(locale, "本地 Collector 捕获到的最新追踪记录。", "Latest traces captured by the local Collector.")}</p></div><div className="at-actions">
          <button className="at-button" type="button" onClick={() => navigate(toggleAllUrl(route, locale, all))}>{all ? <EyeOff size={14} /> : <Eye size={14} />}{all ? tr(locale, "隐藏空记录", "Hide empty") : tr(locale, "显示全部记录", "Show all")}</button>
          <button className="at-button danger" type="button" disabled={!selected.length} onClick={() => void deleteIds(selected)}><Trash2 size={14} />{tr(locale, "批量删除", "Delete")}</button>
          <button className="at-button" type="button" disabled={selected.length < 2 || selected.length > 5} onClick={() => navigate(`/runs/compare?ids=${encodeURIComponent(selected.join(","))}`)}><Workflow size={14} />{tr(locale, "对比 Run", "Compare")}</button>
          <button className="at-button" type="button" onClick={resource.reload}><RefreshCw size={14} />{tr(locale, "刷新", "Refresh")}</button>
        </div></div>
        {data.runs.length ? <RunTable data={data} locale={locale} route={route} navigate={navigate} selected={selected} setSelected={setSelected} deleteOne={id => void deleteIds([id])} /> : <StatePanel title={tr(locale, "没有匹配的 Run", "No matching runs")} body={tr(locale, "调整筛选条件或显示全部记录。", "Change filters or show all records.")} />}
        <Pagination locale={locale} page={data.pagination.page} totalPages={data.pagination.totalPages} total={data.pagination.total} navigate={target => navigate(pageUrl(route, target))} />
      </section>
    </>
  );
}

function RunTable(props: { data: DashboardRunPage; locale: DashboardLocale; route: DashboardRoute; navigate: DashboardNavigate; selected: string[]; setSelected: (ids: string[]) => void; deleteOne: (id: string) => void }) {
  const { data, locale, route, navigate, selected, setSelected } = props;
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  return <div className="at-table-wrap"><table className="at-table at-run-table"><colgroup><col style={{ width: 42 }} /><col style={{ width: 330 }} /><col style={{ width: 135 }} /><col style={{ width: 105 }} /><col style={{ width: 145 }} /><col style={{ width: 175 }} /><col style={{ width: 145 }} /><col style={{ width: 125 }} /><col style={{ width: 140 }} /><col style={{ width: 100 }} /><col style={{ width: 60 }} /></colgroup><thead><tr>
    <th><input type="checkbox" aria-label={tr(locale, "全选", "Select all")} checked={data.runs.length > 0 && data.runs.every(run => selected.includes(run.id))} onChange={() => setSelected(data.runs.every(run => selected.includes(run.id)) ? [] : data.runs.map(run => run.id))} /></th>
    <th>{tr(locale, "运行", "Run")}</th><th>{tr(locale, "来源", "Source")}</th><th>{tr(locale, "状态", "Status")}</th><th>{tr(locale, "模型", "Model")}</th>
    <th>{tr(locale, "追踪内容", "Trace content")}</th>
    {(["tokens", "cost", "startedAt", "duration"] as const).map(column => <th key={column} className={column === "startedAt" ? "" : "num"}><button className="at-button" type="button" onClick={() => navigate(sortUrl(route, column))}>{sortLabel(locale, column)} ↕</button></th>)}<th />
  </tr></thead><tbody>{data.runs.map(run => { const summary = run.metadata?.summary; const agent = run.metadata?.agent || "manual"; const models = summary?.models || []; return <tr key={run.id}>
    <td><input type="checkbox" checked={selected.includes(run.id)} onChange={() => toggle(run.id)} aria-label={`${tr(locale, "选择", "Select")} ${run.name}`} /></td>
    <td><a href={`/runs/${encodeURIComponent(run.id)}`} onClick={linkClick(navigate, `/runs/${encodeURIComponent(run.id)}`)}><strong className="at-run-name" title={run.name}>{normalizeRunTitle(run.name) || run.id}</strong><div className="at-subtle" title={run.id}>{run.id}</div></a></td>
    <td><SourceBadge source={agent} /><div className="at-subtle">{run.metadata?.surface || run.metadata?.source || "local"}</div></td>
    <td><StatusBadge status={run.status} locale={locale} /></td>
    <td><strong className="at-run-name" title={models.join(" / ")}>{models[0] || run.metadata?.model || "-"}</strong>{models.length > 1 ? <div className="at-subtle">+{models.length - 1}</div> : null}</td>
    <td><div className="at-trace-badges">{summary?.commandCount ? <Badge>{summary.commandCount} {tr(locale, "命令", "cmd")}</Badge> : null}{summary?.toolCount ? <Badge>{summary.toolCount} {tr(locale, "工具", "tools")}</Badge> : null}{summary?.mcpCount ? <Badge>{summary.mcpCount} MCP</Badge> : null}{summary?.skillCount ? <Badge>{summary.skillCount} Skills</Badge> : null}{!summary?.commandCount && !summary?.toolCount && !summary?.mcpCount && !summary?.skillCount ? <span className="at-subtle">-</span> : null}</div></td>
    <td className="num"><strong className="at-mono">{fmt(summary?.tokenUsage.total || 0)}</strong><div className="at-subtle">{tr(locale, "输入", "in")} {fmt(summary?.tokenUsage.input || 0)} / {tr(locale, "输出", "out")} {fmt(summary?.tokenUsage.output || 0)}</div></td>
    <td className="num"><strong className="at-mono">{formatMoney(summary?.costUsd || 0)}</strong></td>
    <td><span className="at-mono">{formatDate(run.startedAt, locale)}</span></td>
    <td className="num"><span className="at-mono">{formatDuration(runDuration(run))}</span></td>
    <td><button className="at-button danger" type="button" title={tr(locale, "删除", "Delete")} onClick={() => props.deleteOne(run.id)}><Trash2 size={14} /></button></td>
  </tr>; })}</tbody></table></div>;
}

export function RunDetailView(context: PageContext & { id: string }) {
  const { client, locale, navigate, route, id } = context;
  const visibility = route.query.get("visibility") === "all" || route.query.get("visibility") === "hidden" ? route.query.get("visibility")! : "display";
  const query = new URLSearchParams({ page: route.query.get("page") || "1", pageSize: "100", visibility });
  for (const key of ["q", "status", "type", "category"] as const) { const value = route.query.get(key); if (value) query.set(key, value); }
  const resource = useResource(`run:${id}:${query}`, () => Promise.all([
    client.get<DashboardRun>(`/runs/${encodeURIComponent(id)}`),
    client.get<DashboardEventPage>(`/runs/${encodeURIComponent(id)}/events?${query}`),
    client.get<{ insights: DashboardTraceInsight[] }>(`/runs/${encodeURIComponent(id)}/insights`).catch(() => ({ insights: [] }))
  ]));
  if (resource.loading && !resource.data) return <LoadingState locale={locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={locale} error={resource.error} retry={resource.reload} />;
  const [run, events, insights] = resource.data;
  const summary = run.metadata?.summary;
  const saveOrganization = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await client.send(`/runs/${encodeURIComponent(id)}/organization`, "PATCH", {
      project: optionalText(form.get("project")),
      environment: optionalText(form.get("environment")),
      version: optionalText(form.get("version")),
      tags: String(form.get("tags") || "").split(",").map(value => value.trim()).filter(Boolean),
      note: optionalText(form.get("note")),
      favorite: form.get("favorite") === "on"
    });
    resource.reload();
  };
  const deleteRun = async () => {
    if (!window.confirm(tr(locale, "确定删除这个 Run？", "Delete this Run?"))) return;
    await client.send(`/runs/${encodeURIComponent(id)}`, "DELETE");
    navigate("/runs");
  };
  return <>
    <PageHead locale={locale} eyebrow="TRACE DETAIL" title={normalizeRunTitle(run.name) || run.id} body={run.id} />
    <div className="at-actions"><button className="at-button" onClick={() => navigate("/runs")}><ChevronLeft size={14} />{tr(locale, "返回列表", "Back")}</button><button className="at-button" onClick={() => navigate(`/sandbox?runId=${encodeURIComponent(id)}`)}><Play size={14} />{tr(locale, "回放", "Replay")}</button><a className="at-button" href={`${clientBase(client)}/runs/${encodeURIComponent(id)}/export`}>{tr(locale, "脱敏导出", "Redacted export")}</a><button className="at-button danger" onClick={() => void deleteRun()}><Trash2 size={14} />{tr(locale, "删除 Run", "Delete run")}</button></div>
    <TelemetryStrip items={[[tr(locale, "状态", "Status"), run.status, ""], [tr(locale, "事件", "Events"), fmt(events.counts.total), ""], ["Token", fmt(summary?.tokenUsage.total || events.summary.totalTokens), ""], [tr(locale, "成本", "Cost"), formatMoney(summary?.costUsd || 0), formatDuration(events.summary.totalDurationMs)]]} />
    <div className="at-grid-2"><section className="at-card"><div className="at-card-head"><h2>{tr(locale, "自动诊断", "Automatic diagnostics")}</h2></div>{insights.insights.length ? <div className="at-list">{insights.insights.map(item => <div className="at-list-item" key={`${item.kind}-${item.eventIds.join()}`}><strong>{item.title}</strong><p>{item.kind} · {item.severity} · {item.eventIds.length} events</p><div className="at-actions">{item.eventIds.slice(0, 4).map(eventId => <a className="at-badge" href={`#event-${eventId}`} key={eventId}>{eventId.slice(0, 12)}</a>)}</div></div>)}</div> : <StatePanel title={tr(locale, "未发现明显异常", "No notable issues")} body={tr(locale, "当前规则没有识别到可定位的问题。", "No deterministic issue was detected.")} />}</section>
    <section className="at-card"><div className="at-card-head"><h2>{tr(locale, "来源与组织", "Source and organization")}</h2></div><form className="at-card-body at-form" onSubmit={event => void saveOrganization(event)}><div className="at-grid-2"><Field label={tr(locale, "项目", "Project")}><input className="at-control" name="project" defaultValue={run.metadata?.project || ""} /></Field><Field label={tr(locale, "环境", "Environment")}><input className="at-control" name="environment" defaultValue={run.metadata?.environment || ""} /></Field><Field label={tr(locale, "版本", "Version")}><input className="at-control" name="version" defaultValue={run.metadata?.version || ""} /></Field><Field label={tr(locale, "标签（逗号分隔）", "Tags (comma-separated)")}><input className="at-control" name="tags" defaultValue={(run.metadata?.tags || []).join(", ")} /></Field></div><Field label={tr(locale, "备注", "Note")}><textarea className="at-control" name="note" defaultValue={run.metadata?.note || ""} /></Field><label className="at-checkbox"><input type="checkbox" name="favorite" defaultChecked={Boolean(run.metadata?.favorite)} /> {tr(locale, "收藏", "Favorite")}</label><button className="at-button primary">{tr(locale, "保存组织信息", "Save organization")}</button></form></section></div>
    <section className="at-card"><div className="at-card-head"><div><h2>{tr(locale, "事件时间线", "Event timeline")} <Badge>{events.counts.matching}</Badge></h2><p>{tr(locale, `显示 ${visibility} 事件`, `Showing ${visibility} events`)}</p></div><div className="at-actions">{(["display", "hidden", "all"] as const).map(mode => <button key={mode} className={`at-button ${mode === visibility ? "primary" : ""}`} onClick={() => { const next = new URLSearchParams(route.query); mode === "display" ? next.delete("visibility") : next.set("visibility", mode); navigate(withQuery(route.path, next)); }}>{mode}</button>)}</div></div>
      {events.events.length ? <div>{events.events.map(event => <details className="at-event" id={`event-${event.id}`} key={event.id}><summary><span className="at-subtle">{formatDate(event.timestamp, locale)}</span><Badge>{event.type}</Badge><strong>{event.name}</strong><StatusBadge status={event.status} locale={locale} /><span className="at-mono">{fmt(event.metadata?.tokenUsage?.total || 0)}</span></summary><div className="at-event-detail"><pre className="at-json">{JSON.stringify(event, null, 2)}</pre></div></details>)}</div> : <StatePanel title={tr(locale, "没有匹配事件", "No matching events")} body={tr(locale, "切换可见性或筛选条件。", "Change visibility or filters.")} />}
      <Pagination locale={locale} page={events.pagination.page} totalPages={events.pagination.totalPages} total={events.pagination.total} navigate={page => { const next = new URLSearchParams(route.query); next.set("page", String(page)); navigate(withQuery(route.path, next)); }} />
    </section>
    <div className="at-grid-2"><section className="at-card"><div className="at-card-head"><h2>Input</h2></div><div className="at-card-body"><pre className="at-json">{JSON.stringify(run.input ?? null, null, 2)}</pre></div></section><section className="at-card"><div className="at-card-head"><h2>Output</h2></div><div className="at-card-body"><pre className="at-json">{JSON.stringify(run.output ?? run.error ?? null, null, 2)}</pre></div></section></div>
  </>;
}

export function RunCompareView(context: PageContext) {
  const ids = (context.route.query.get("ids") || "").split(",").filter(Boolean).slice(0, 5);
  const resource = useResource(`compare:${ids.join()}`, () => context.client.get<DashboardRunComparison>(`/analytics/runs/compare?ids=${encodeURIComponent(ids.join(","))}`));
  if (ids.length < 2) return <StatePanel title={tr(context.locale, "请选择 2–5 个 Run", "Select 2–5 runs")} body={tr(context.locale, "返回列表后勾选需要比较的记录。", "Select runs from the list.")} />;
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  return <><PageHead locale={context.locale} eyebrow="REGRESSION COMPARISON" title={tr(context.locale, "Run 对比", "Run comparison")} body={tr(context.locale, "以第一个 Run 为基线比较状态、耗时、Token 与事件回归。", "Compare status, duration, tokens, and event regressions against the first run.")} /><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "运行指标", "Run metrics")} <Badge>{resource.data.regressionCount}</Badge></h2></div><div className="at-table-wrap"><table className="at-table"><thead><tr><th>Run</th><th>{tr(context.locale, "状态", "Status")}</th><th className="num">{tr(context.locale, "耗时", "Duration")}</th><th className="num">Token</th><th className="num">{tr(context.locale, "成本", "Cost")}</th></tr></thead><tbody>{resource.data.runs.map(run => <tr key={run.id}><td><strong className="at-run-name">{run.name}</strong><div className="at-subtle">{run.id}</div></td><td><StatusBadge status={run.status} locale={context.locale} /></td><td className="num">{formatDuration(run.durationMs)}</td><td className="num">{fmt(run.totalTokens)}</td><td className="num">{formatMoney(run.costUsd)}</td></tr>)}</tbody></table></div></section><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "事件差异", "Event differences")}</h2></div><div className="at-list">{resource.data.eventDiffs.map((diff, index) => <div className="at-list-item" key={`${diff.runId}-${diff.eventKey}-${index}`}><strong>{diff.name}</strong><p>{diff.type} · {diff.changes.join(", ") || "unchanged"} · {diff.regressions.join(", ") || "no regression"}</p></div>)}</div></section></>;
}

export function TokenTraceView(context: PageContext) {
  const resource = useResource("token-trace", () => Promise.all([context.client.get<DashboardUsageSummary>("/usage/summary"), context.client.get<DashboardRunTrends>("/analytics/runs/trends?days=90")]));
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  const [usage, trends] = resource.data;
  const max = Math.max(1, ...trends.points.map(point => point.totalTokens));
  return <><PageHead locale={context.locale} eyebrow="TOKEN TRACE" title={tr(context.locale, "本地 Token 用量", "Local token usage")} body={tr(context.locale, "按日、周、月观察客户端与模型的 Token 消耗和估算成本。", "Inspect daily, weekly, and monthly token usage and estimated cost.")} /><TelemetryStrip items={[["Token", fmt(usage.totalTokens), ""], [tr(context.locale, "估算成本", "Estimated cost"), formatMoney(usage.costUsd), ""], [tr(context.locale, "客户端", "Clients"), fmt(usage.clients.length), ""], [tr(context.locale, "模型", "Models"), fmt(usage.models.length), ""]]} /><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "近 90 天趋势", "90-day trend")}</h2><div className="at-actions"><Badge>{tr(context.locale, "日", "Day")}</Badge><Badge>{tr(context.locale, "周", "Week")}</Badge><Badge>{tr(context.locale, "月", "Month")}</Badge></div></div><div className="at-bars">{trends.points.slice(-31).map(point => <div className="at-bar" key={point.date} title={`${point.date}: ${fmt(point.totalTokens)}`}><div style={{ height: `${Math.max(4, point.totalTokens / max * 150)}px` }} /><small>{point.date.slice(5)}</small></div>)}</div></section><div className="at-grid-2"><UsageTable title={tr(context.locale, "客户端用量", "Client usage")} rows={usage.clients.map(item => [item.client, item.totalTokens, item.costUsd])} locale={context.locale} /><UsageTable title={tr(context.locale, "模型用量", "Model usage")} rows={usage.models.map(item => [item.model, item.totalTokens, item.costUsd])} locale={context.locale} /></div></>;
}

export function AnalyticsView(context: PageContext) {
  const dimension = context.route.query.get("dimension") || "model";
  const resource = useResource(`analytics:${dimension}`, () => Promise.all([context.client.get<AnalyticsBreakdown>(`/analytics/breakdown?dimension=${dimension}&days=30`), context.client.get<{ budgets: AnalyticsBudget[] }>("/analytics/budgets"), context.client.get<{ alerts: AnalyticsBudgetAlert[] }>("/analytics/alerts")]));
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  const [breakdown, budgets, alerts] = resource.data;
  const createBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await context.client.send("/analytics/budgets", "POST", {
      name: String(form.get("name") || ""),
      dimension: String(form.get("dimension") || "model"),
      value: String(form.get("value") || ""),
      period: String(form.get("period") || "daily"),
      maxCostUsd: optionalNumber(form.get("maxCostUsd")),
      maxTokens: optionalNumber(form.get("maxTokens")),
      maxRuns: optionalNumber(form.get("maxRuns")),
      enabled: true
    });
    event.currentTarget.reset();
    resource.reload();
  };
  const deleteBudget = async (id: string) => {
    if (!window.confirm(tr(context.locale, "删除这条预算规则？", "Delete this budget?"))) return;
    await context.client.send(`/analytics/budgets/${encodeURIComponent(id)}`, "DELETE");
    resource.reload();
  };
  return <><PageHead locale={context.locale} eyebrow="ANALYTICS" title={tr(context.locale, "分析与预算", "Analytics and budgets")} body={tr(context.locale, "按来源、模型、项目和环境分析运行质量，并管理预算告警。", "Analyze run quality by source, model, project, and environment and manage budgets.")} /><div className="at-actions">{["model", "source", "project", "environment"].map(value => <button key={value} className={`at-button ${dimension === value ? "primary" : ""}`} onClick={() => context.navigate(`/analytics?dimension=${value}${context.locale === "en" ? "&lang=en" : ""}`)}>{value}</button>)}</div><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "30 天分布", "30-day breakdown")}</h2></div><div className="at-table-wrap"><table className="at-table"><thead><tr><th>{dimension}</th><th className="num">Runs</th><th className="num">Token</th><th className="num">Cost</th><th className="num">Failure</th></tr></thead><tbody>{breakdown.groups.map(group => <tr key={group.key}><td><strong>{group.key || "-"}</strong></td><td className="num">{fmt(group.runCount)}</td><td className="num">{fmt(group.totalTokens)}</td><td className="num">{formatMoney(group.costUsd)}</td><td className="num">{(group.failureRate * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></section><div className="at-grid-2"><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "新建预算", "New budget")}</h2></div><form className="at-card-body at-form" onSubmit={event => void createBudget(event)}><div className="at-grid-2"><Field label={tr(context.locale, "名称", "Name")}><input className="at-control" name="name" required /></Field><Field label={tr(context.locale, "维度值", "Dimension value")}><input className="at-control" name="value" required /></Field><Field label={tr(context.locale, "维度", "Dimension")}><select className="at-control" name="dimension">{["project", "environment", "model", "source"].map(value => <option key={value}>{value}</option>)}</select></Field><Field label={tr(context.locale, "周期", "Period")}><select className="at-control" name="period"><option value="daily">daily</option><option value="monthly">monthly</option></select></Field><Field label={tr(context.locale, "最大成本 USD", "Max cost USD")}><input className="at-control" name="maxCostUsd" type="number" min="0" step="any" /></Field><Field label={tr(context.locale, "最大 Token", "Max tokens")}><input className="at-control" name="maxTokens" type="number" min="0" /></Field><Field label={tr(context.locale, "最大 Run", "Max runs")}><input className="at-control" name="maxRuns" type="number" min="0" /></Field></div><button className="at-button primary">{tr(context.locale, "创建预算", "Create budget")}</button></form></section><ListCard title={tr(context.locale, "告警", "Alerts")} items={alerts.alerts.map(item => [item.budgetName, `${item.metric}: ${fmt(item.actual)} / ${fmt(item.limit)}`])} /></div><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "预算规则", "Budget rules")} <Badge>{budgets.budgets.length}</Badge></h2></div><div className="at-list">{budgets.budgets.length ? budgets.budgets.map(item => <div className="at-list-item at-list-row" key={item.id}><div><strong>{item.name}</strong><p>{item.dimension}:{item.value} · {item.period} · {budgetLimits(item)}</p></div><button className="at-button danger" onClick={() => void deleteBudget(item.id)}><Trash2 size={14} />{tr(context.locale, "删除", "Delete")}</button></div>) : <StatePanel title={tr(context.locale, "暂无预算", "No budgets")} body={tr(context.locale, "创建预算规则后会在这里显示。", "Create a budget to see it here.")} />}</div></section></>;
}

export function EvaluationsView(context: PageContext) {
  const selected = context.route.query.get("dataset") || "";
  const resource = useResource(`evaluations:${selected}`, () => Promise.all([context.client.get<{ datasets: EvaluationDatasetSummary[] }>("/evaluations/datasets"), selected ? context.client.get<EvaluationDatasetReport>(`/evaluations/datasets/${encodeURIComponent(selected)}`) : Promise.resolve(undefined)]));
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  const [datasets, report] = resource.data;
  const createDataset = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const created = await context.client.send<EvaluationDatasetSummary>("/evaluations/datasets", "POST", { name: String(form.get("name") || ""), description: String(form.get("description") || ""), scoreWeights: parsePairs(form.get("scoreWeights")) }); context.navigate(`/evaluations?dataset=${created.id}`); };
  const addCase = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!report) return; const form = new FormData(event.currentTarget); await context.client.send(`/evaluations/datasets/${encodeURIComponent(report.dataset.id)}/cases`, "POST", { name: String(form.get("name") || ""), input: parseJson(form.get("input"), {}), expectedOutput: parseJson(form.get("expectedOutput"), undefined) }); event.currentTarget.reset(); resource.reload(); };
  const saveScore = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); await context.client.send("/evaluations/results", "POST", { caseId: String(form.get("caseId") || ""), runId: String(form.get("runId") || ""), scores: parsePairs(form.get("scores")), notes: optionalText(form.get("notes")) }); event.currentTarget.reset(); resource.reload(); };
  return <><PageHead locale={context.locale} eyebrow="EVALUATIONS" title={tr(context.locale, "评测", "Evaluations")} body={tr(context.locale, "管理评测集、用例和运行评分。", "Manage datasets, cases, and run scores.")} /><div className="at-grid-2"><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "评测集", "Datasets")}</h2></div><div className="at-list">{datasets.datasets.map(item => <a className="at-list-item" key={item.id} href={`/evaluations?dataset=${item.id}`} onClick={linkClick(context.navigate, `/evaluations?dataset=${item.id}`)}><strong>{item.name}</strong><p>{item.caseCount} cases · {item.resultCount} results · {(item.averageQualityScore * 100).toFixed(1)}%</p></a>)}</div><form className="at-card-body at-form" onSubmit={event => void createDataset(event)}><Field label={tr(context.locale, "名称", "Name")}><input className="at-control" name="name" required /></Field><Field label={tr(context.locale, "评分权重", "Score weights")}><input className="at-control" name="scoreWeights" defaultValue="correctness:0.7,efficiency:0.3" required /></Field><Field label={tr(context.locale, "说明", "Description")}><textarea className="at-control" name="description" /></Field><button className="at-button primary">{tr(context.locale, "创建评测集", "Create dataset")}</button></form></section><section className="at-card"><div className="at-card-head"><h2>{report?.dataset.name || tr(context.locale, "评测详情", "Evaluation detail")}</h2>{report ? <Badge>{(report.dataset.averageQualityScore * 100).toFixed(1)}%</Badge> : null}</div>{report ? <><div className="at-card-body at-grid-2"><form className="at-form" onSubmit={event => void addCase(event)}><Field label={tr(context.locale, "用例名称", "Case name")}><input className="at-control" name="name" required /></Field><Field label={tr(context.locale, "输入 JSON", "Input JSON")}><textarea className="at-control at-mono" name="input" defaultValue="{}" required /></Field><Field label={tr(context.locale, "期望输出 JSON", "Expected output JSON")}><textarea className="at-control at-mono" name="expectedOutput" /></Field><button className="at-button primary">{tr(context.locale, "添加用例", "Add case")}</button></form><form className="at-form" onSubmit={event => void saveScore(event)}><Field label={tr(context.locale, "用例", "Case")}><select className="at-control" name="caseId" required>{report.cases.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Run ID"><input className="at-control" name="runId" required /></Field><Field label={tr(context.locale, "评分", "Scores")}><input className="at-control" name="scores" defaultValue="correctness:0.8,efficiency:0.6" required /></Field><Field label={tr(context.locale, "备注", "Notes")}><input className="at-control" name="notes" /></Field><button className="at-button primary" disabled={!report.cases.length}>{tr(context.locale, "保存评分", "Save score")}</button></form></div><div className="at-list">{report.cases.map(item => <div className="at-list-item" key={item.id}><strong>{item.name}</strong><p>{item.results.length} results · {JSON.stringify(item.input)}</p>{item.results.map(result => <div className="at-result-row" key={result.id}><span className="at-mono">{result.runId}</span><strong>{(result.qualityScore * 100).toFixed(1)}%</strong></div>)}</div>)}</div></> : <StatePanel title={tr(context.locale, "选择评测集", "Select a dataset")} body={tr(context.locale, "查看用例与评分结果。", "Inspect cases and scores.")} />}</section></div></>;
}

export function SandboxView(context: PageContext) {
  const runId = context.route.query.get("runId") || "";
  const key = `sandbox:${runId}`;
  const resource = useResource(key, () => Promise.all([context.client.get<{ tasks: ReplayTask[] }>(`/sandbox/replays?limit=100${runId ? `&sourceRunId=${encodeURIComponent(runId)}` : ""}`), runId ? context.client.get<DashboardRun>(`/runs/${encodeURIComponent(runId)}`).catch(() => undefined) : Promise.resolve(undefined), runId ? context.client.get<DashboardEventPage>(`/runs/${encodeURIComponent(runId)}/events?page=1&pageSize=100&visibility=display`).catch(() => undefined) : Promise.resolve(undefined)]));
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  const [tasks, run, events] = resource.data;
  const load = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("runId") || ""); context.navigate(`/sandbox?runId=${encodeURIComponent(value)}`); };
  const replay = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); await context.client.send("/sandbox/replays", "POST", { sourceRunId: runId, sourceEventId: String(form.get("eventId") || ""), input: parseJson(form.get("input"), undefined), mockOutput: parseJson(form.get("mockOutput"), undefined), simulateError: form.get("simulateError") === "on", delayMs: Number(form.get("delayMs") || 0), timeoutMs: Number(form.get("timeoutMs") || 5000) }); resource.reload(); };
  const cancelReplay = async (id: string) => { if (!window.confirm(tr(context.locale, "取消这个回放任务？", "Cancel this replay?"))) return; await context.client.send(`/sandbox/replays/${encodeURIComponent(id)}`, "DELETE"); resource.reload(); };
  return <><PageHead locale={context.locale} eyebrow="SAFE REPLAY" title={tr(context.locale, "安全回放与调试沙箱", "Safe replay sandbox")} body={tr(context.locale, "在禁网、临时文件系统和模拟工具策略下回放事件。", "Replay events with network disabled, temporary storage, and mocked tools.")} /><TelemetryStrip items={[[tr(context.locale, "网络", "Network"), tr(context.locale, "禁用", "Disabled"), ""], [tr(context.locale, "工具执行", "Tool execution"), "Mock only", ""], [tr(context.locale, "文件系统", "Filesystem"), tr(context.locale, "临时", "Temporary"), ""], [tr(context.locale, "任务", "Tasks"), fmt(tasks.tasks.length), ""]]} /><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "载入来源 Run", "Load source run")}</h2></div><form className="at-card-body at-actions" onSubmit={load}><input className="at-control" style={{ maxWidth: 640 }} name="runId" defaultValue={runId} required placeholder="run-id" /><button className="at-button primary">{tr(context.locale, "载入", "Load")}</button>{run ? <button className="at-button" type="button" onClick={() => context.navigate(`/runs/${encodeURIComponent(runId)}`)}>{tr(context.locale, "查看详情", "View details")}</button> : null}</form></section>{run && events ? <section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "创建回放", "Create replay")}</h2><Badge>{normalizeRunTitle(run.name)}</Badge></div><form className="at-card-body at-form" onSubmit={event => void replay(event)}><div className="at-grid-3"><Field label="Event"><select className="at-control" name="eventId">{events.events.map(item => <option value={item.id} key={item.id}>{item.type} · {item.name}</option>)}</select></Field><Field label={tr(context.locale, "延迟毫秒", "Delay ms")}><input className="at-control" name="delayMs" type="number" defaultValue="0" /></Field><Field label={tr(context.locale, "超时毫秒", "Timeout ms")}><input className="at-control" name="timeoutMs" type="number" defaultValue="5000" /></Field></div><div className="at-grid-2"><Field label={tr(context.locale, "覆盖输入 JSON（可选）", "Override input JSON (optional)")}><textarea className="at-control at-mono" name="input" /></Field><Field label={tr(context.locale, "Mock 输出 JSON（可选）", "Mock output JSON (optional)")}><textarea className="at-control at-mono" name="mockOutput" /></Field></div><label className="at-checkbox"><input type="checkbox" name="simulateError" /> {tr(context.locale, "模拟错误", "Simulate error")}</label><button className="at-button primary">{tr(context.locale, "开始回放", "Start replay")}</button></form></section> : null}<section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "回放任务", "Replay tasks")} <Badge>{tasks.tasks.length}</Badge></h2></div><div className="at-list">{tasks.tasks.length ? tasks.tasks.map(item => <div className="at-list-item" key={item.id}><div className="at-list-row"><div><div className="at-actions"><StatusBadge status={item.status} locale={context.locale} /><strong className="at-mono">{item.id}</strong></div><p>{item.sourceRunId} · {item.sourceEventId} · {formatDate(item.createdAt, context.locale)}</p>{item.error ? <p className="at-error-text">{item.error}</p> : null}</div><div className="at-actions">{item.replayRunId ? <><button className="at-button" onClick={() => context.navigate(`/runs/${encodeURIComponent(item.replayRunId!)}`)}>{tr(context.locale, "查看生成 Run", "View replay run")}</button><button className="at-button" onClick={() => context.navigate(`/runs/compare?ids=${encodeURIComponent(`${item.sourceRunId},${item.replayRunId}`)}`)}>{tr(context.locale, "对比", "Compare")}</button></> : null}{item.status === "queued" || item.status === "running" ? <button className="at-button danger" onClick={() => void cancelReplay(item.id)}>{tr(context.locale, "取消", "Cancel")}</button> : null}</div></div></div>) : <StatePanel title={tr(context.locale, "暂无回放任务", "No replay tasks")} body={tr(context.locale, "创建任务后会在这里显示。", "Created replays appear here.")} />}</div></section></>;
}

export function MaintenanceView(context: PageContext) {
  const resource = useResource("maintenance", () => Promise.all([context.client.get<JsonObject>("/maintenance/storage"), context.client.get<{ tombstones: Array<{ runId: string; deletedAt: string }> }>("/maintenance/tombstones?limit=50"), context.client.get<PrivacySettings>("/maintenance/privacy")]));
  if (resource.loading && !resource.data) return <LoadingState locale={context.locale} />;
  if (resource.error || !resource.data) return <ErrorState locale={context.locale} error={resource.error} retry={resource.reload} />;
  const [stats, tombstones, privacy] = resource.data;
  const savePrivacy = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); await context.client.send("/maintenance/privacy", "PUT", { sensitiveKeys: String(form.get("sensitiveKeys") || "").split(/[\n,]/).map(value => value.trim()).filter(Boolean), replacement: String(form.get("replacement") || "[REDACTED]") }); resource.reload(); };
  const pruneRuns = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!window.confirm(tr(context.locale, "确定执行清理？", "Run retention cleanup?"))) return; const form = new FormData(event.currentTarget); const statuses = [form.get("success") === "on" ? "success" : "", form.get("error") === "on" ? "error" : ""].filter(Boolean); await context.client.send("/maintenance/prune", "POST", { before: new Date(`${String(form.get("before"))}T00:00:00.000Z`).toISOString(), statuses, keepTombstones: form.get("keepTombstones") === "on" }); resource.reload(); };
  const defaultBefore = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  return <><PageHead locale={context.locale} eyebrow="MAINTENANCE" title={tr(context.locale, "维护与隐私", "Maintenance and privacy")} body={tr(context.locale, "管理本地存储、隐私脱敏、保留策略和删除墓碑。", "Manage local storage, privacy redaction, retention, and tombstones.")} /><TelemetryStrip items={Object.entries(stats).slice(0, 4).map(([key, value]) => [key, typeof value === "number" ? fmt(value) : String(value ?? "-"), ""])} /><div className="at-grid-2"><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "隐私规则", "Privacy rules")}</h2></div><form className="at-card-body at-form" onSubmit={event => void savePrivacy(event)}><Field label={tr(context.locale, "敏感字段", "Sensitive keys")}><textarea className="at-control" name="sensitiveKeys" defaultValue={privacy.sensitiveKeys.join("\n")} /></Field><Field label={tr(context.locale, "替换文本", "Replacement")}><input className="at-control" name="replacement" defaultValue={privacy.replacement} /></Field><button className="at-button primary">{tr(context.locale, "保存", "Save")}</button></form></section><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "按日期清理", "Prune by date")}</h2></div><form className="at-card-body at-form" onSubmit={event => void pruneRuns(event)}><Field label={tr(context.locale, "删除此日期之前", "Delete before")}><input className="at-control" type="date" name="before" defaultValue={defaultBefore} required /></Field><div className="at-actions"><label className="at-checkbox"><input type="checkbox" name="success" defaultChecked /> success</label><label className="at-checkbox"><input type="checkbox" name="error" defaultChecked /> error</label><label className="at-checkbox"><input type="checkbox" name="keepTombstones" defaultChecked /> {tr(context.locale, "保留墓碑", "Keep tombstones")}</label></div><button className="at-button danger">{tr(context.locale, "执行清理", "Prune runs")}</button></form></section></div><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "数据库操作", "Database operations")}</h2></div><div className="at-card-body at-actions"><button className="at-button" onClick={() => void context.client.send("/maintenance/compact", "POST", {}).then(resource.reload)}><Database size={14} />{tr(context.locale, "压缩数据库", "Compact database")}</button><button className="at-button" onClick={resource.reload}><RefreshCw size={14} />{tr(context.locale, "刷新统计", "Refresh stats")}</button></div></section><section className="at-card"><div className="at-card-head"><h2>{tr(context.locale, "删除墓碑", "Deletion tombstones")} <Badge>{tombstones.tombstones.length}</Badge></h2></div><div className="at-list">{tombstones.tombstones.map(item => <div className="at-list-item at-list-row" key={item.runId}><div><strong>{item.runId}</strong><p>{formatDate(item.deletedAt, context.locale)}</p></div><button className="at-button" onClick={() => void context.client.send(`/runs/${encodeURIComponent(item.runId)}/tombstone`, "DELETE").then(resource.reload)}><RotateCcw size={14} />{tr(context.locale, "恢复 ID", "Restore ID")}</button></div>)}</div></section></>;
}

function PageHead({ eyebrow, title, body }: { locale: DashboardLocale; eyebrow: string; title: string; body: string }) { return <div className="at-page-head"><p className="at-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{body}</p></div>; }
function TelemetryStrip({ items }: { items: Array<[string, string, string]> }) { return <div className="at-stats">{items.map(([label, value, detail]) => <div className="at-stat" key={label}><span>{label}</span><strong>{value}</strong>{detail ? <small title={detail}>{detail}</small> : null}</div>)}</div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="at-field"><span>{label}</span>{children}</label>; }
function Badge({ children }: { children: ReactNode }) { return <span className="at-badge">{children}</span>; }
function StatusBadge({ status, locale }: { status: string; locale: DashboardLocale }) { const tone = status === "success" || status === "completed" ? "success" : status === "error" || status === "timeout" ? "error" : "running"; return <span className={`at-badge ${tone}`}>{status === "success" ? tr(locale, "成功", "Success") : status}</span>; }
function SourceBadge({ source }: { source: string }) { return <span className="at-badge">{source}</span>; }
function StatePanel({ title, body }: { title: string; body: string }) { return <div className="at-state"><div><AlertCircle size={28} /><h2>{title}</h2><p>{body}</p></div></div>; }
function LoadingState({ locale }: { locale: DashboardLocale }) { return <div className="at-state"><div><RefreshCw size={28} /><h2>{tr(locale, "正在加载", "Loading")}</h2><p>{tr(locale, "正在从本地 Collector 读取数据。", "Reading data from the local Collector.")}</p></div></div>; }
function ErrorState({ locale, error, retry }: { locale: DashboardLocale; error?: string; retry: () => void }) { return <div className="at-state"><div><AlertCircle className="at-error-text" size={28} /><h2>{tr(locale, "页面加载失败", "Page failed to load")}</h2><p>{error || "Failed to fetch"}</p><button className="at-button primary" onClick={retry}><RefreshCw size={14} />{tr(locale, "重试", "Retry")}</button></div></div>; }
function Pagination(props: { locale: DashboardLocale; page: number; totalPages: number; total: number; navigate: (page: number) => void }) { if (props.totalPages <= 1) return null; const start = Math.max(1, Math.min(props.page - 2, props.totalPages - 4)); const pages = Array.from({ length: Math.min(5, props.totalPages) }, (_, index) => start + index); return <div className="at-pagination"><span>{tr(props.locale, `第 ${props.page}/${props.totalPages} 页 · ${props.total} 条`, `Page ${props.page}/${props.totalPages} · ${props.total} items`)}</span><div className="at-page-buttons"><button disabled={props.page <= 1} onClick={() => props.navigate(props.page - 1)}><ChevronLeft size={14} /></button>{pages.map(page => <button className={page === props.page ? "active" : ""} key={page} onClick={() => props.navigate(page)}>{page}</button>)}<button disabled={props.page >= props.totalPages} onClick={() => props.navigate(props.page + 1)}><ChevronRight size={14} /></button></div></div>; }
function UsageTable({ title, rows, locale }: { title: string; rows: Array<[string, number, number]>; locale: DashboardLocale }) { return <section className="at-card"><div className="at-card-head"><h2>{title}</h2></div><div className="at-table-wrap"><table className="at-table"><thead><tr><th>{tr(locale, "名称", "Name")}</th><th className="num">Token</th><th className="num">{tr(locale, "成本", "Cost")}</th></tr></thead><tbody>{rows.map(([name, tokens, cost]) => <tr key={name}><td><strong>{name}</strong></td><td className="num">{fmt(tokens)}</td><td className="num">{formatMoney(cost)}</td></tr>)}</tbody></table></div></section>; }
function ListCard({ title, items }: { title: string; items: Array<[string, string]> }) { return <section className="at-card"><div className="at-card-head"><h2>{title}</h2></div><div className="at-list">{items.length ? items.map(([name, body], index) => <div className="at-list-item" key={`${name}-${index}`}><strong>{name}</strong><p>{body}</p></div>) : <StatePanel title="-" body="No data" />}</div></section>; }

function optionalText(value: FormDataEntryValue | null) { const text = String(value || "").trim(); return text || null; }
function optionalNumber(value: FormDataEntryValue | null) { const text = String(value || "").trim(); return text ? Number(text) : undefined; }
function parsePairs(value: FormDataEntryValue | null) { return Object.fromEntries(String(value || "").split(",").map(item => item.trim()).filter(Boolean).map(item => { const [key = "", raw = "0"] = item.split(":", 2); return [key.trim(), Number(raw.trim())]; }).filter(([key]) => key)); }
function parseJson<T>(value: FormDataEntryValue | null, fallback: T): T { const text = String(value || "").trim(); return text ? JSON.parse(text) as T : fallback; }
function budgetLimits(item: AnalyticsBudget) { return [item.maxCostUsd == null ? "" : formatMoney(item.maxCostUsd), item.maxTokens == null ? "" : `${fmt(item.maxTokens)} tok`, item.maxRuns == null ? "" : `${fmt(item.maxRuns)} runs`].filter(Boolean).join(" · ") || "-"; }
function tr(locale: DashboardLocale, zh: string, en: string) { return locale === "zh" ? zh : en; }
function fmt(value: number) { return new Intl.NumberFormat().format(Number.isFinite(value) ? value : 0); }
function formatMoney(value: number) { return `$${(Number.isFinite(value) ? value : 0).toFixed(value >= 100 ? 2 : 4)}`; }
function formatDate(value: string | undefined, locale: DashboardLocale) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date); }
function formatDuration(value: number) { if (!Number.isFinite(value) || value <= 0) return "-"; if (value < 1000) return `${Math.round(value)}ms`; if (value < 60_000) return `${(value / 1000).toFixed(1)}s`; return `${Math.floor(value / 60_000)}m ${Math.round(value % 60_000 / 1000)}s`; }
function runDuration(run: DashboardRun) { if (!run.endedAt) return 0; return Math.max(0, new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime()); }
export function normalizeRunTitle(value: string) { return String(value || "").replace(/<image\b[^>]*(?:>|$)/gi, "").replace(/# Files mentioned by the user:[\s\S]*?(?=## My request for Codex:|$)/i, "").replace(/## My request for Codex:/gi, "").replace(/\s+/g, " ").trim(); }
function numberParam(value: string | null, fallback: number) { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback; }
function withQuery(path: string, query: URLSearchParams) { const value = query.toString(); return value ? `${path}?${value}` : path; }
function pageUrl(route: DashboardRoute, page: number) { const next = new URLSearchParams(route.query); page <= 1 ? next.delete("page") : next.set("page", String(page)); return withQuery(route.path, next); }
function toggleAllUrl(route: DashboardRoute, locale: DashboardLocale, all: boolean) { const next = new URLSearchParams(route.query); next.delete("page"); all ? next.delete("runs") : next.set("runs", "all"); if (locale === "en") next.set("lang", "en"); return withQuery("/runs", next); }
function sortUrl(route: DashboardRoute, column: "tokens" | "cost" | "startedAt" | "duration") { const next = new URLSearchParams(route.query); const current = next.get("sort"); const order = next.get("order") === "asc" ? "asc" : "desc"; next.delete("page"); if (current === column && order === "asc") { next.delete("sort"); next.delete("order"); } else { next.set("sort", column); next.set("order", current === column ? "asc" : "desc"); } return withQuery(route.path, next); }
function sortLabel(locale: DashboardLocale, column: string) { const labels: Record<string, [string, string]> = { tokens: ["Tokens", "Tokens"], cost: ["成本", "Cost"], startedAt: ["开始时间", "Started"], duration: ["耗时", "Duration"] }; return tr(locale, ...(labels[column] || [column, column])); }
function hrefFor(mode: DashboardRouterMode, path: string) { return mode === "hash" ? `#${path}` : path; }
function linkClick(navigate: DashboardNavigate, path: string) { return (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); navigate(path); }; }
function clientBase(client: CollectorClient) { return client.baseUrl; }
