(function () {
  const API = "http://127.0.0.1:4319";
  const content = document.querySelector("#content");
  const health = document.querySelector("#health");
  const toastRoot = document.querySelector("#toast-root");
  const state = {
    lang: localStorage.getItem("agent-trace.lang") || "zh",
    theme: localStorage.getItem("agent-trace.theme") || "dark",
    renderToken: 0,
    selectedRuns: new Set()
  };

  function tr(zh, en) { return state.lang === "zh" ? zh : en; }
  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function fmtDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? escape(value) : new Intl.DateTimeFormat(state.lang === "zh" ? "zh-CN" : "en", { dateStyle: "medium", timeStyle: "medium" }).format(date);
  }
  function fmtNumber(value, digits = 0) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
  function fmtMoney(value) { return `$${Number(value || 0).toFixed(4)}`; }
  function fmtDuration(value) {
    const ms = Number(value || 0);
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
    return `${(ms / 60000).toFixed(1)} min`;
  }
  function json(value) { return escape(JSON.stringify(value ?? null, null, 2)); }
  function status(value) { return `<span class="status ${escape(value)}">${escape(value)}</span>`; }
  function stat(label, value, hint = "") { return `<div class="stat"><span>${escape(label)}</span><strong>${escape(value)}</strong>${hint ? `<span>${escape(hint)}</span>` : ""}</div>`; }
  function pageHead(eyebrow, title, subtitle, actions = "") {
    return `<div class="page-head"><div><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(title)}</h1><p class="subtitle">${escape(subtitle)}</p></div><div class="section-actions">${actions}</div></div>`;
  }
  function empty(message) { return `<div class="empty">${escape(message)}</div>`; }
  function loading() { content.innerHTML = `<div class="loading">${tr("正在加载…", "Loading…")}</div>`; }
  function errorView(error) {
    content.innerHTML = `<div class="error-box"><h2>${tr("页面加载失败", "Page failed to load")}</h2><p>${escape(error.message || error)}</p><button class="button" id="retry-view">${tr("重试", "Retry")}</button></div>`;
    document.querySelector("#retry-view")?.addEventListener("click", () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  }
  function toast(message, kind = "") {
    const node = document.createElement("div");
    node.className = `toast ${kind}`;
    node.textContent = message;
    toastRoot.append(node);
    setTimeout(() => node.remove(), 3600);
  }
  async function api(path, options = {}) {
    const headers = { ...(options.body === undefined ? {} : { "content-type": "application/json" }), ...(options.headers || {}) };
    const response = await fetch(`${API}${path}`, { cache: "no-store", ...options, headers });
    if (!response.ok) {
      let detail;
      try { detail = await response.json(); } catch { detail = {}; }
      throw new Error(detail.error || `Collector returned ${response.status}`);
    }
    if (response.status === 204) return undefined;
    const type = response.headers.get("content-type") || "";
    return type.includes("json") ? response.json() : response.text();
  }
  function body(value) { return JSON.stringify(value); }
  function formJson(form) {
    const result = {};
    for (const [key, value] of new FormData(form)) result[key] = String(value).trim();
    return result;
  }
  function parsePairs(value) {
    const result = {};
    for (const item of String(value || "").split(",")) {
      const [key, raw] = item.split(":");
      if (key?.trim() && Number.isFinite(Number(raw))) result[key.trim()] = Number(raw);
    }
    return result;
  }
  function setHash(path) { location.hash = path.startsWith("#") ? path : `#${path}`; }
  function route() {
    const raw = location.hash.slice(1) || "/runs";
    const [path, query = ""] = raw.split("?");
    return { path, query: new URLSearchParams(query), raw };
  }
  function queryPath(path, params) {
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }
  function applyTheme() {
    document.documentElement.classList.toggle("light", state.theme === "light");
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
    document.querySelector("#language").textContent = state.lang === "zh" ? "中" : "EN";
  }
  function nav() {
    const path = route().path;
    const items = [
      ["/runs", tr("运行", "Runs")],
      ["/token-trace", "Token-Trace"],
      ["/analytics", tr("分析", "Analytics")],
      ["/evaluations", tr("评测", "Evaluations")],
      ["/sandbox", tr("回放", "Replay")],
      ["/maintenance", tr("维护", "Maintenance")]
    ];
    document.querySelector("#primary-nav").innerHTML = items.map(([href, label]) => `<a class="nav-link ${path.startsWith(href) ? "active" : ""}" href="#${href}">${escape(label)}</a>`).join("");
  }
  async function checkHealth() {
    try {
      await api("/health");
      health.textContent = tr("已连接", "Connected");
      health.className = "health ok";
      return true;
    } catch {
      health.textContent = tr("未连接", "Disconnected");
      health.className = "health error";
      return false;
    }
  }

  document.querySelector("#language").addEventListener("click", () => {
    state.lang = state.lang === "zh" ? "en" : "zh";
    localStorage.setItem("agent-trace.lang", state.lang);
    applyTheme(); nav(); window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  document.querySelector("#theme").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("agent-trace.theme", state.theme);
    applyTheme();
  });

  window.AT = { API, content, state, tr, escape, fmtDate, fmtNumber, fmtMoney, fmtDuration, json, status, stat, pageHead, empty, loading, errorView, toast, api, body, formJson, parsePairs, setHash, route, queryPath, nav, checkHealth, applyTheme, views: {} };
})();
