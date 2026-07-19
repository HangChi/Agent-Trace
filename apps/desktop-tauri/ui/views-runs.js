(function (AT) {
  const { content, state, tr, escape, fmtDate, fmtNumber, fmtMoney, fmtDuration, json, status, stat, pageHead, empty, loading, toast, api, body, formJson, setHash, route, queryPath } = AT;

  AT.views.runs = async function runsView() {
    loading();
    const current = route();
    const params = current.query;
    const page = Math.max(1, Number(params.get("page") || 1));
    const query = new URLSearchParams({ includeUntracked: "true", page: String(page), pageSize: "50", sort: params.get("sort") || "startedAt", order: params.get("order") || "desc" });
    for (const key of ["q", "status", "source", "model", "project", "environment", "tag", "favorite", "startedAfter", "startedBefore"]) if (params.get(key)) query.set(key, params.get(key));
    const [data, scanner] = await Promise.all([api(`/runs?${query}`), api("/usage/scanner").catch(() => ({ diagnostics: [] }))]);
    content.innerHTML = pageHead(
      tr("运行观测", "RUN OBSERVABILITY"),
      tr("Agent 运行", "Agent runs"),
      tr("搜索、筛选、比较和管理本地 Collector 中的所有 Run。", "Search, filter, compare, and manage every Run in the local Collector."),
      `<button class="button" id="runs-refresh">${tr("刷新", "Refresh")}</button>`
    ) + `
      <div class="stats">
        ${stat(tr("总 Run", "Total runs"), fmtNumber(data.summary.totalRuns))}
        ${stat(tr("运行中", "Running"), fmtNumber(data.summary.runningRuns))}
        ${stat(tr("失败", "Failed"), fmtNumber(data.summary.failedRuns))}
        ${stat(tr("最近扫描", "Last scan"), scanner.scannedAt ? fmtDate(scanner.scannedAt) : tr("尚未扫描", "Not scanned"))}
      </div>
      <form id="run-filters" class="runs-filter">
        <label class="field filter-search">${tr("搜索", "Search")}<input class="control" name="q" value="${escape(params.get("q") || "")}" placeholder="${tr("名称、ID、会话或来源", "Name, ID, session, or source")}" /></label>
        <label class="field">${tr("状态", "Status")}<select class="control" name="status">${option("", tr("全部", "All"), params.get("status"))}${option("running", tr("进行中", "Running"), params.get("status"))}${option("success", tr("成功", "Success"), params.get("status"))}${option("error", tr("异常", "Error"), params.get("status"))}</select></label>
        <label class="field">${tr("来源", "Source")}<input class="control" name="source" value="${escape(params.get("source") || "")}" placeholder="codex" /></label>
        <label class="field">${tr("模型", "Model")}<input class="control" name="model" value="${escape(params.get("model") || "")}" placeholder="gpt-5" /></label>
        <label class="field">${tr("开始日期", "From")}<input class="control" type="date" name="startedAfter" value="${escape(params.get("startedAfter") || "")}" /></label>
        <label class="field">${tr("结束日期", "To")}<input class="control" type="date" name="startedBefore" value="${escape(params.get("startedBefore") || "")}" /></label>
        <details class="advanced-filters"><summary>${tr("更多筛选", "More filters")}</summary><div class="advanced-filter-grid">
          <label class="field">${tr("项目", "Project")}<input class="control" name="project" value="${escape(params.get("project") || "")}" /></label>
          <label class="field">${tr("环境", "Environment")}<input class="control" name="environment" value="${escape(params.get("environment") || "")}" /></label>
          <label class="field">${tr("标签", "Tag")}<input class="control" name="tag" value="${escape(params.get("tag") || "")}" /></label>
          <label class="field">${tr("收藏", "Favorite")}<select class="control" name="favorite">${option("", tr("全部 Run", "All runs"), params.get("favorite"))}${option("true", tr("仅收藏", "Favorites only"), params.get("favorite"))}</select></label>
          <label class="field">${tr("排序", "Sort")}<select class="control" name="sort">${option("startedAt", tr("开始时间", "Started"), params.get("sort") || "startedAt")}${option("duration", tr("耗时", "Duration"), params.get("sort"))}${option("tokens", "Token", params.get("sort"))}${option("cost", tr("成本", "Cost"), params.get("sort"))}</select></label>
          <label class="field">${tr("顺序", "Order")}<select class="control" name="order">${option("desc", tr("降序", "Descending"), params.get("order") || "desc")}${option("asc", tr("升序", "Ascending"), params.get("order"))}</select></label>
        </div></details>
        <div class="filter-actions"><button class="button primary" type="submit">${tr("应用筛选", "Apply filters")}</button><button class="button" type="button" id="clear-filters">${tr("重置", "Reset")}</button><span class="action-spacer"></span><button class="button" type="button" id="compare-selected" ${state.selectedRuns.size < 2 ? "disabled" : ""}>${tr("对比 Run", "Compare runs")} (${state.selectedRuns.size})</button><button class="button danger" type="button" id="delete-selected" ${state.selectedRuns.size < 1 ? "disabled" : ""}>${tr("删除已选", "Delete selected")} (${state.selectedRuns.size})</button></div>
      </form>
      <section class="card">
        <div class="card-head"><h2>${tr("Run 列表", "Runs")}</h2><span class="muted tiny">${fmtNumber(data.pagination.total)} ${tr("条结果", "results")}</span></div>
        <div class="table-wrap">${data.runs.length ? runTable(data.runs) : empty(tr("没有匹配的 Run。新 Hook/SDK 数据会实时显示在这里。", "No matching runs. New Hook/SDK data will appear here."))}</div>
        <div class="pagination"><span class="muted tiny">${tr("第", "Page")} ${data.pagination.page} / ${data.pagination.totalPages} ${tr("页", "")}</span><div class="pager-buttons"><button class="button small" id="prev-page" ${data.pagination.page <= 1 ? "disabled" : ""}>← ${tr("上一页", "Previous")}</button><button class="button small" id="next-page" ${data.pagination.page >= data.pagination.totalPages ? "disabled" : ""}>${tr("下一页", "Next")} →</button></div></div>
      </section>`;

    document.querySelector("#runs-refresh").addEventListener("click", runsView);
    document.querySelector("#run-filters").addEventListener("submit", event => {
      event.preventDefault();
      const values = formJson(event.currentTarget);
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
      setHash(queryPath("/runs", next));
    });
    document.querySelector("#clear-filters").addEventListener("click", () => setHash("/runs"));
    document.querySelector("#compare-selected").addEventListener("click", () => setHash(`/runs/compare?ids=${encodeURIComponent([...state.selectedRuns].slice(0, 5).join(","))}`));
    document.querySelector("#delete-selected").addEventListener("click", async () => {
      const ids = [...state.selectedRuns];
      if (!ids.length || !confirm(tr(`确定删除已选的 ${ids.length} 个 Run？`, `Delete ${ids.length} selected Runs?`))) return;
      const result = await api("/runs", { method: "DELETE", body: body({ ids }) });
      state.selectedRuns.clear(); toast(`${tr("已删除", "Deleted")} ${result.deleted} Runs`); runsView();
    });
    document.querySelector("#prev-page").addEventListener("click", () => changePage(params, page - 1));
    document.querySelector("#next-page").addEventListener("click", () => changePage(params, page + 1));
    document.querySelectorAll("[data-run-id]").forEach(row => row.addEventListener("click", event => {
      if (event.target.closest("input,button")) return;
      setHash(`/runs/${encodeURIComponent(row.dataset.runId)}`);
    }));
    document.querySelectorAll(".run-select").forEach(input => input.addEventListener("change", () => {
      input.checked ? state.selectedRuns.add(input.value) : state.selectedRuns.delete(input.value);
      runsView();
    }));
    document.querySelectorAll(".delete-run").forEach(button => button.addEventListener("click", async () => {
      if (!confirm(tr("确定删除这个 Run？", "Delete this Run?"))) return;
      await api(`/runs/${encodeURIComponent(button.dataset.id)}`, { method: "DELETE" });
      state.selectedRuns.delete(button.dataset.id); toast(tr("Run 已删除", "Run deleted")); runsView();
    }));
  };

  function runTable(runs) {
    return `<table><thead><tr><th></th><th>${tr("名称", "Name")}</th><th>${tr("状态", "Status")}</th><th>Agent</th><th>${tr("开始时间", "Started")}</th><th>Token</th><th>${tr("成本", "Cost")}</th><th></th></tr></thead><tbody>${runs.map(run => {
      const summary = run.metadata?.summary || {};
      return `<tr class="clickable" data-run-id="${escape(run.id)}"><td><input class="run-select" type="checkbox" value="${escape(run.id)}" ${state.selectedRuns.has(run.id) ? "checked" : ""}></td><td><strong class="run-name">${escape(run.name)}</strong><div class="muted run-id">${escape(run.id)}</div></td><td>${status(run.status)}</td><td>${escape(run.metadata?.agent || "manual")}</td><td class="numeric">${fmtDate(run.startedAt)}</td><td class="numeric">${fmtNumber(summary.tokenUsage?.total)}</td><td class="numeric">${fmtMoney(summary.costUsd)}</td><td><button class="button small danger delete-run" data-id="${escape(run.id)}">${tr("删除", "Delete")}</button></td></tr>`;
    }).join("")}</tbody></table>`;
  }
  function changePage(params, page) { const next = new URLSearchParams(params); next.set("page", String(page)); setHash(queryPath("/runs", next)); }
  function option(value, label, selected) { return `<option value="${escape(value)}" ${String(selected || "") === value ? "selected" : ""}>${escape(label)}</option>`; }

  AT.views.runDetail = async function runDetailView(id) {
    loading();
    const current = route();
    const view = current.query.get("view") === "tree" ? "tree" : "timeline";
    const visibility = ["display", "hidden", "all"].includes(current.query.get("visibility")) ? current.query.get("visibility") : "display";
    const page = Math.max(1, Number(current.query.get("page") || 1));
    const eventQuery = new URLSearchParams({ visibility, page: String(view === "tree" ? 1 : page), pageSize: String(view === "tree" ? 500 : 100) });
    for (const key of ["q", "status", "type", "category"]) if (current.query.get(key) && current.query.get(key) !== "all") eventQuery.set(key, current.query.get(key));
    const [run, firstEvents, insightBody] = await Promise.all([
      api(`/runs/${encodeURIComponent(id)}`),
      api(`/runs/${encodeURIComponent(id)}/events?${eventQuery}`),
      api(`/runs/${encodeURIComponent(id)}/insights`).catch(() => ({ insights: [] }))
    ]);
    const events = firstEvents;
    if (view === "tree" && firstEvents.pagination.totalPages > 1) {
      const pages = await Promise.all(Array.from({ length: firstEvents.pagination.totalPages - 1 }, (_, index) => {
        const next = new URLSearchParams(eventQuery); next.set("page", String(index + 2));
        return api(`/runs/${encodeURIComponent(id)}/events?${next}`);
      }));
      events.events = firstEvents.events.concat(pages.flatMap(item => item.events));
    }
    const renderedEvents = view === "tree" ? treeEvents(events.events) : events.events.map(event => ({ event, depth: 0 }));
    const summary = run.metadata?.summary || {};
    const tags = Array.isArray(run.metadata?.tags) ? run.metadata.tags : [];
    content.innerHTML = pageHead(
      tr("Trace 详情", "TRACE DETAIL"), run.name, `${run.id} · ${fmtDate(run.startedAt)}`,
      `<a class="button" href="#/runs">← ${tr("返回", "Back")}</a><a class="button" href="#/sandbox?runId=${encodeURIComponent(id)}">${tr("回放", "Replay")}</a><button class="button" id="export-run">${tr("脱敏导出", "Redacted export")}</button><button class="button danger" id="delete-detail">${tr("删除", "Delete")}</button>`
    ) + `
      <div class="stats">${stat(tr("状态", "Status"), run.status)}${stat(tr("事件", "Events"), fmtNumber(events.counts.total))}${stat("Token", fmtNumber(summary.tokenUsage?.total))}${stat(tr("成本", "Cost"), fmtMoney(summary.costUsd))}${stat(tr("失败事件", "Failed events"), fmtNumber(events.summary.failedEvents))}</div>
      <div class="grid two">
        <section class="card"><div class="card-head"><h2>${tr("组织信息", "Organization")}</h2></div><div class="card-body">
          <form id="organization-form" class="form-grid">
            ${field("project", tr("项目", "Project"), run.metadata?.project)}${field("environment", tr("环境", "Environment"), run.metadata?.environment)}${field("version", tr("版本", "Version"), run.metadata?.version)}${field("tags", tr("标签（逗号分隔）", "Tags (comma-separated)"), tags.join(", "))}
            <label class="field full">${tr("备注", "Note")}<textarea class="control" name="note">${escape(run.metadata?.note || "")}</textarea></label>
            <label class="field"><span><input type="checkbox" name="favorite" ${run.metadata?.favorite ? "checked" : ""}> ${tr("收藏", "Favorite")}</span></label>
            <div class="form-actions"><button class="button primary" type="submit">${tr("保存", "Save")}</button></div>
          </form>
        </div></section>
        <section class="card"><div class="card-head"><h2>${tr("确定性洞察", "Deterministic insights")}</h2></div><div>${insightBody.insights.length ? insightBody.insights.map(insight => `<div class="insight"><span>${status(insight.severity)}</span><div><strong>${escape(insight.title)}</strong><div class="muted tiny mono">${escape(JSON.stringify(insight.evidence))}</div><div class="muted tiny">${escape(insight.eventIds.join(", "))}</div></div></div>`).join("") : empty(tr("没有发现重试、慢步骤、Token 热点或失败级联。", "No retry, slow-step, token-hotspot, or failure-cascade findings."))}</div></section>
      </div>
      <section class="card" style="margin-top:16px"><div class="card-head"><div><h2>${view === "tree" ? tr("Trace 树", "Trace tree") : tr("事件时间线", "Event timeline")}</h2><span class="muted tiny">${events.counts.matching} / ${events.counts.total} ${tr("个事件", "events")}</span></div><div class="section-actions"><button class="button small detail-view ${view === "timeline" ? "primary" : ""}" data-view="timeline">${tr("时间线", "Timeline")}</button><button class="button small detail-view ${view === "tree" ? "primary" : ""}" data-view="tree">${tr("树视图", "Tree")}</button><button class="button small visibility" data-visibility="${visibility === "display" ? "all" : "display"}">${visibility === "display" ? tr("显示隐藏事件", "Show hidden events") : tr("仅核心事件", "Core events only")}</button></div></div>
        <form id="event-filters" class="toolbar card-body">
          <input class="control grow" name="q" value="${escape(current.query.get("q") || "")}" placeholder="${tr("搜索事件名称或类型…", "Search event name or type…")}" />
          <select class="control" name="status">${option("all", tr("全部状态", "All statuses"), current.query.get("status") || "all")}${option("running", tr("运行中", "Running"), current.query.get("status"))}${option("success", tr("成功", "Success"), current.query.get("status"))}${option("error", tr("失败", "Error"), current.query.get("status"))}</select>
          <select class="control" name="type">${option("all", tr("全部类型", "All types"), current.query.get("type") || "all")}${events.facets.types.map(item => option(item, item, current.query.get("type"))).join("")}</select>
          <select class="control" name="category">${option("all", tr("全部分类", "All categories"), current.query.get("category") || "all")}${events.facets.categories.map(item => option(item, item, current.query.get("category"))).join("")}</select>
          <button class="button primary">${tr("筛选", "Filter")}</button><button class="button" type="button" id="clear-event-filters">${tr("清除", "Clear")}</button>
        </form>
        <div>${renderedEvents.length ? renderedEvents.map(item => eventRow(item.event, id, item.depth)).join("") : empty(tr("没有匹配的事件。", "No matching events."))}</div>
        ${view === "timeline" && events.pagination.totalPages > 1 ? `<div class="pagination"><span class="muted tiny">${tr("第", "Page")} ${events.pagination.page} / ${events.pagination.totalPages} ${tr("页", "")}</span><div class="pager-buttons"><button class="button small event-page" data-page="${events.pagination.page - 1}" ${events.pagination.page <= 1 ? "disabled" : ""}>← ${tr("上一页", "Previous")}</button><button class="button small event-page" data-page="${events.pagination.page + 1}" ${events.pagination.page >= events.pagination.totalPages ? "disabled" : ""}>${tr("下一页", "Next")} →</button></div></div>` : ""}
      </section>
      <div class="grid two" style="margin-top:16px"><section class="card"><div class="card-head"><h2>Input</h2></div><div class="card-body"><pre class="json">${json(run.input)}</pre></div></section><section class="card"><div class="card-head"><h2>Output</h2></div><div class="card-body"><pre class="json">${json(run.output || run.error)}</pre></div></section></div>`;
    document.querySelector("#organization-form").addEventListener("submit", async event => {
      event.preventDefault(); const values = formJson(event.currentTarget);
      await api(`/runs/${encodeURIComponent(id)}/organization`, { method: "PATCH", body: body({ project: values.project || null, environment: values.environment || null, version: values.version || null, tags: values.tags ? values.tags.split(",").map(item => item.trim()).filter(Boolean) : [], note: values.note || null, favorite: event.currentTarget.favorite.checked }) });
      toast(tr("组织信息已保存", "Organization saved")); runDetailView(id);
    });
    document.querySelector("#event-filters").addEventListener("submit", event => {
      event.preventDefault();
      const next = new URLSearchParams(current.query);
      for (const key of ["q", "status", "type", "category"]) next.delete(key);
      for (const [key, value] of Object.entries(formJson(event.currentTarget))) if (value && value !== "all") next.set(key, value);
      next.delete("page"); setHash(queryPath(`/runs/${encodeURIComponent(id)}`, next));
    });
    document.querySelector("#clear-event-filters").addEventListener("click", () => setDetailQuery(id, current.query, { q: null, status: null, type: null, category: null, page: null }));
    document.querySelectorAll(".detail-view").forEach(button => button.addEventListener("click", () => setDetailQuery(id, current.query, { view: button.dataset.view === "timeline" ? null : button.dataset.view, page: null })));
    document.querySelectorAll(".visibility").forEach(button => button.addEventListener("click", () => setDetailQuery(id, current.query, { visibility: button.dataset.visibility === "display" ? null : button.dataset.visibility, page: null })));
    document.querySelectorAll(".event-page").forEach(button => button.addEventListener("click", () => setDetailQuery(id, current.query, { page: button.dataset.page })));
    document.querySelector("#delete-detail").addEventListener("click", async () => { if (!confirm(tr("确定删除这个 Run？", "Delete this Run?"))) return; await api(`/runs/${encodeURIComponent(id)}`, { method: "DELETE" }); setHash("/runs"); });
    document.querySelector("#export-run").addEventListener("click", async () => {
      const response = await fetch(`${AT.API}/runs/${encodeURIComponent(id)}/export`); if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `agent-trace-${id}.json`; link.click(); URL.revokeObjectURL(link.href);
    });
  };
  function field(name, label, value) { return `<label class="field">${escape(label)}<input class="control" name="${name}" value="${escape(value || "")}"></label>`; }
  function setDetailQuery(id, current, changes) {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(changes)) value == null || value === "" ? next.delete(key) : next.set(key, value);
    setHash(queryPath(`/runs/${encodeURIComponent(id)}`, next));
  }
  function treeEvents(events) {
    const nodes = new Map(events.map(event => [event.id, { event, children: [] }]));
    const roots = [];
    for (const node of nodes.values()) {
      const parent = node.event.parentId && nodes.get(node.event.parentId);
      if (parent && parent !== node) parent.children.push(node); else roots.push(node);
    }
    const output = []; const visited = new Set();
    function visit(node, depth) {
      if (visited.has(node.event.id)) return;
      visited.add(node.event.id); output.push({ event: node.event, depth });
      node.children.sort((a, b) => String(a.event.timestamp).localeCompare(String(b.event.timestamp))).forEach(child => visit(child, depth + 1));
    }
    roots.sort((a, b) => String(a.event.timestamp).localeCompare(String(b.event.timestamp))).forEach(node => visit(node, 0));
    for (const node of nodes.values()) visit(node, 0);
    return output;
  }
  function eventRow(event, runId, depth = 0) {
    const tokens = event.metadata?.tokenUsage?.total || 0;
    return `<details class="event-row" id="event-${escape(event.id)}"><summary style="display:contents"><span class="mono muted">${fmtDate(event.timestamp)}</span><span>${escape(event.type)}</span><strong style="padding-left:${Math.min(depth, 8) * 18}px">${depth ? "↳ " : ""}${escape(event.name)}</strong><span>${status(event.status)}</span><span class="mono">${tokens ? fmtNumber(tokens) + " tok" : fmtDuration(event.durationMs)}</span></summary><div class="event-detail"><div class="section-actions"><span class="mono tiny">${escape(event.id)}</span><a class="button small" href="#/sandbox?runId=${encodeURIComponent(runId)}&eventId=${encodeURIComponent(event.id)}">${tr("回放此事件", "Replay event")}</a></div><strong>Metadata</strong><pre class="json">${json(event.metadata)}</pre>${event.input !== undefined ? `<strong>Input</strong><pre class="json">${json(event.input)}</pre>` : ""}${event.output !== undefined || event.error !== undefined ? `<strong>Output / Error</strong><pre class="json">${json(event.output || event.error)}</pre>` : ""}</div></details>`;
  }

  AT.views.compare = async function compareView() {
    loading(); const ids = (route().query.get("ids") || "").split(",").filter(Boolean).slice(0, 5);
    if (ids.length < 2) { content.innerHTML = empty(tr("请在 Run 列表中选择 2–5 个 Run。", "Select 2–5 Runs from the Runs page.")); return; }
    const data = await api(`/analytics/runs/compare?ids=${encodeURIComponent(ids.join(","))}`);
    content.innerHTML = pageHead(tr("回归比较", "REGRESSION COMPARISON"), tr("Run 对比", "Run comparison"), tr("以第一个 Run 为基线比较状态、耗时和 Token。", "Compare status, duration, and tokens using the first Run as baseline."), `<a class="button" href="#/runs">← ${tr("返回", "Back")}</a>`) + `
      <div class="stats">${stat(tr("参与 Run", "Runs"), data.runs.length)}${stat(tr("回归项", "Regressions"), data.regressionCount)}</div>
      <section class="card"><div class="card-head"><h2>${tr("运行指标", "Run metrics")}</h2></div><div class="table-wrap"><table><thead><tr><th>Run</th><th>${tr("状态", "Status")}</th><th>${tr("耗时", "Duration")}</th><th>${tr("事件", "Events")}</th><th>${tr("失败", "Failed")}</th><th>Token</th><th>${tr("成本", "Cost")}</th></tr></thead><tbody>${data.runs.map(run => `<tr><td><a href="#/runs/${encodeURIComponent(run.id)}"><strong>${escape(run.name)}</strong></a></td><td>${status(run.status)}</td><td>${fmtDuration(run.durationMs)}</td><td>${run.eventCount}</td><td>${run.failedEventCount}</td><td>${fmtNumber(run.totalTokens)}</td><td>${fmtMoney(run.costUsd)}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="card"><div class="card-head"><h2>${tr("事件差异", "Event differences")}</h2></div><div class="table-wrap">${data.eventDiffs.length ? `<table><thead><tr><th>Run</th><th>${tr("事件", "Event")}</th><th>${tr("变化", "Changes")}</th><th>${tr("回归", "Regressions")}</th></tr></thead><tbody>${data.eventDiffs.map(diff => `<tr><td class="mono">${escape(diff.runId)}</td><td>${escape(diff.type)} · ${escape(diff.name)} #${diff.occurrence}</td><td>${diff.changes.map(item => `<span class="tag">${escape(item)}</span>`).join("")}</td><td>${diff.regressions.map(item => `<span class="tag" style="color:var(--danger)">${escape(item)}</span>`).join("")}</td></tr>`).join("")}</tbody></table>` : empty(tr("没有差异。", "No differences."))}</div></section>`;
  };

  AT.views.tokenTrace = async function tokenTraceView() {
    loading();
    const current = route(); const view = current.query.get("view") === "calendar" ? "calendar" : "overview";
    const [usage, trends] = await Promise.all([api("/usage/summary"), api("/analytics/runs/trends?days=90")]);
    const maxTokens = Math.max(1, ...trends.points.map(point => point.totalTokens || 0));
    const months = [...new Set(trends.points.map(point => point.date.slice(0, 7)))];
    const month = months.includes(current.query.get("month")) ? current.query.get("month") : months.at(-1);
    content.innerHTML = pageHead("TOKEN-TRACE", tr("Token 与成本轨迹", "Token and cost trace"), tr("按客户端、模型和日期查看本地用量快照。", "Inspect local usage snapshots by client, model, and day."), `<button class="button token-view ${view === "overview" ? "primary" : ""}" data-view="overview">${tr("概览", "Overview")}</button><button class="button token-view ${view === "calendar" ? "primary" : ""}" data-view="calendar">${tr("日历", "Calendar")}</button><button class="button" id="token-refresh">${tr("刷新", "Refresh")}</button>`) + `
      <div class="stats">${stat(tr("总 Token", "Total tokens"), fmtNumber(usage.totalTokens))}${stat(tr("API 等价成本", "API-equivalent cost"), fmtMoney(usage.costUsd))}${stat(tr("客户端", "Clients"), usage.clients.length)}${stat(tr("模型", "Models"), usage.models.length)}</div>
      ${view === "overview" ? tokenOverview(usage, trends, maxTokens) : tokenCalendar(trends, months, month, maxTokens)}`;
    document.querySelector("#token-refresh").addEventListener("click", tokenTraceView);
    document.querySelectorAll(".token-view").forEach(button => button.addEventListener("click", () => setHash(button.dataset.view === "calendar" ? `/token-trace?view=calendar&month=${month}` : "/token-trace")));
    document.querySelectorAll(".month-nav").forEach(button => button.addEventListener("click", () => setHash(`/token-trace?view=calendar&month=${button.dataset.month}`)));
  };
  function tokenOverview(usage, trends, maxTokens) {
    const active = trends.points.filter(point => point.totalTokens > 0);
    const peak = trends.points.reduce((best, point) => !best || point.totalTokens > best.totalTokens ? point : best, null);
    const trendTotal = trends.points.reduce((sum, point) => sum + point.totalTokens, 0);
    const aggregate = period => Object.values(trends.points.reduce((groups, point) => {
      const key = period === "month" ? point.date.slice(0, 7) : weekStart(point.date);
      const item = groups[key] ||= { key, tokens: 0, runs: 0, cost: 0 };
      item.tokens += point.totalTokens; item.runs += point.runCount; item.cost += point.costUsd; return groups;
    }, {}));
    const weekly = aggregate("week").slice(-8); const monthly = aggregate("month");
    return `<section class="card"><div class="card-head"><h2>${tr("最近 90 天趋势", "Last 90 days")}</h2><span class="muted tiny">UTC</span></div><div class="trend-layout"><aside class="trend-summary"><span>${tr("总 Token", "Total tokens")}</span><strong>${fmtNumber(trendTotal)}</strong><dl><div><dt>${tr("活跃天数", "Active days")}</dt><dd>${active.length} / ${trends.points.length}</dd></div><div><dt>${tr("日均 Token", "Daily average")}</dt><dd>${fmtNumber(trendTotal / Math.max(1, trends.points.length))}</dd></div><div><dt>${tr("峰值日期", "Peak day")}</dt><dd>${peak?.date || "—"}</dd></div></dl></aside><div class="trend-chart">${tokenLineChart(trends.points, maxTokens)}</div></div></section>
      <div class="grid two" style="margin-top:16px"><section class="card"><div class="card-head"><h2>${tr("周汇总", "Weekly totals")}</h2></div>${periodBars(weekly)}</section><section class="card"><div class="card-head"><h2>${tr("月汇总", "Monthly totals")}</h2></div>${periodBars(monthly)}</section></div>
      <div class="grid two" style="margin-top:16px"><section class="card"><div class="card-head"><h2>${tr("客户端用量", "Usage by client")}</h2></div><div class="table-wrap">${usage.clients.length ? `<table><thead><tr><th>${tr("客户端", "Client")}</th><th>Token</th><th>${tr("成本", "Cost")}</th></tr></thead><tbody>${usage.clients.map(item => `<tr><td>${escape(item.client)}</td><td class="mono">${fmtNumber(item.totalTokens)}</td><td>${fmtMoney(item.costUsd)}</td></tr>`).join("")}</tbody></table>` : empty(tr("暂无 Usage Snapshot。", "No usage snapshots."))}</div></section><section class="card"><div class="card-head"><h2>${tr("模型用量", "Usage by model")}</h2></div><div class="table-wrap">${usage.models.length ? `<table><thead><tr><th>${tr("模型", "Model")}</th><th>Provider</th><th>Token</th><th>${tr("成本", "Cost")}</th></tr></thead><tbody>${usage.models.map(item => `<tr><td>${escape(item.model)}</td><td>${escape(item.provider || "—")}</td><td class="mono">${fmtNumber(item.totalTokens)}</td><td>${fmtMoney(item.costUsd)}</td></tr>`).join("")}</tbody></table>` : empty(tr("暂无模型用量。", "No model usage."))}</div></section></div>`;
  }
  function tokenLineChart(points, maxTokens) {
    const chart = points.map((point, index) => ({ ...point, x: 20 + index * (1080 / Math.max(1, points.length - 1)), y: 18 + (1 - point.totalTokens / maxTokens) * 124 }));
    const line = chart.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    const area = chart.length ? `M ${chart[0].x} 148 ${chart.map(point => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")} L ${chart.at(-1).x} 148 Z` : "";
    const labels = points.filter((_, index) => index % 14 === 0 || index === points.length - 1);
    return `<svg viewBox="0 0 1120 154" preserveAspectRatio="none" role="img" aria-label="Token trend"><defs><linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--primary)" stop-opacity=".24"/><stop offset="1" stop-color="var(--primary)" stop-opacity=".015"/></linearGradient><linearGradient id="trend-line"><stop offset="0" stop-color="var(--primary)"/><stop offset="1" stop-color="var(--trace)"/></linearGradient></defs>${[22,64,106,148].map(y => `<line x1="20" x2="1100" y1="${y}" y2="${y}" stroke="var(--border)" stroke-dasharray="3 6" vector-effect="non-scaling-stroke"/>`).join("")}<path d="${area}" fill="url(#trend-area)"/><polyline points="${line}" fill="none" stroke="url(#trend-line)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg><div class="trend-labels">${labels.map(point => `<span><small>${escape(point.date.slice(5))}</small><strong>${fmtNumber(point.totalTokens)}</strong></span>`).join("")}</div>`;
  }
  function periodBars(items) {
    const max = Math.max(1, ...items.map(item => item.tokens));
    return `<div class="period-bars" style="grid-template-columns:repeat(${items.length},minmax(42px,1fr))">${items.map(item => `<div class="period-bar" title="${escape(item.key)} · ${fmtNumber(item.tokens)} Token · ${item.runs} Run"><strong>${fmtNumber(item.tokens)}</strong><div><span style="height:${item.tokens ? Math.max(3, item.tokens / max * 100) : 0}%"></span></div><small>${escape(item.key.slice(5))}</small></div>`).join("")}</div>`;
  }
  function tokenCalendar(trends, months, month, maxTokens) {
    const points = trends.points.filter(point => point.date.startsWith(`${month}-`)); const map = new Map(points.map(point => [point.date, point]));
    const [year, index] = month.split("-").map(Number); const days = new Date(Date.UTC(year, index, 0)).getUTCDate(); const offset = new Date(Date.UTC(year, index - 1, 1)).getUTCDay();
    const cells = Array.from({ length: offset }, () => "").concat(Array.from({ length: days }, (_, day) => {
      const date = `${month}-${String(day + 1).padStart(2, "0")}`; const point = map.get(date) || { date, totalTokens: 0, runCount: 0, failedRunCount: 0, costUsd: 0 };
      return `<div class="day heat-${Math.min(4, Math.ceil((point.totalTokens || 0) / maxTokens * 4))}"><strong>${day + 1}</strong><span>${fmtNumber(point.totalTokens)} tok</span><span>${point.runCount} runs${point.failedRunCount ? ` · ${point.failedRunCount} failed` : ""}</span><span>${fmtMoney(point.costUsd)}</span></div>`;
    }));
    const total = points.reduce((sum, point) => sum + point.totalTokens, 0); const cost = points.reduce((sum, point) => sum + point.costUsd, 0); const runs = points.reduce((sum, point) => sum + point.runCount, 0);
    const position = months.indexOf(month); const previous = months[position - 1]; const next = months[position + 1];
    return `<div class="stats">${stat(tr("月份", "Month"), month)}${stat("Run", fmtNumber(runs))}${stat("Token", fmtNumber(total))}${stat(tr("成本", "Cost"), fmtMoney(cost))}</div><section class="card"><div class="card-head"><h2>${month}</h2><div class="section-actions"><button class="button small month-nav" data-month="${previous || month}" ${previous ? "" : "disabled"}>←</button><button class="button small month-nav" data-month="${next || month}" ${next ? "" : "disabled"}>→</button></div></div><div class="card-body"><div class="calendar">${[tr("日", "Sun"), tr("一", "Mon"), tr("二", "Tue"), tr("三", "Wed"), tr("四", "Thu"), tr("五", "Fri"), tr("六", "Sat")].map(item => `<strong class="tiny muted" style="text-align:center">${item}</strong>`).join("")}${cells.map(cell => cell || "<div></div>").join("")}</div></div></section>`;
  }
  function weekStart(value) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - date.getUTCDay()); return date.toISOString().slice(0, 10); }
})(window.AT);
