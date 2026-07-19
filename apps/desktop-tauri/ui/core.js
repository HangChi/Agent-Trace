(function () {
  const API = "http://127.0.0.1:4319";
  const content = document.querySelector("#content");
  const health = document.querySelector("#health");
  const toastRoot = document.querySelector("#toast-root");
  const state = {
    lang: localStorage.getItem("agent-trace.lang") || "zh",
    theme: localStorage.getItem("agent-trace.theme") || "light",
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
    document.documentElement.classList.toggle("dark", state.theme === "dark");
    document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
    document.querySelector("#language").textContent = state.lang === "zh" ? "中" : "EN";
  }
  function nav() {
    const path = route().path;
    const primary = [
      ["/runs", tr("运行", "Runs"), "home"],
      ["/token-trace", "Token-Trace", "coins"]
    ];
    const secondary = [
      ["/analytics", tr("分析", "Analytics"), "chart"],
      ["/evaluations", tr("评测", "Evaluations"), "flask"],
      ["/sandbox", tr("回放", "Replay"), "shield"],
      ["/maintenance", tr("维护", "Maintenance"), "drive"]
    ];
    const link = ([href, label, iconName]) => `<a class="nav-link ${path.startsWith(href) ? "active" : ""}" href="#${href}">${icon(iconName)}<span>${escape(label)}</span></a>`;
    document.querySelector("#primary-nav").innerHTML = primary.map(link).join("");
    document.querySelector("#secondary-nav").innerHTML = secondary.map(link).join("");
  }
  function icon(name) {
    const paths = {
      home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
      coins: '<ellipse cx="8" cy="8" rx="5" ry="3"/><path d="M3 8v4c0 1.7 2.2 3 5 3s5-1.3 5-3V8"/><path d="M8 18c.9 1.1 2.8 2 5 2 2.8 0 5-1.3 5-3v-4"/><path d="M13 10c2.8 0 5-1.3 5-3s-2.2-3-5-3c-.7 0-1.4.1-2 .2"/>',
      chart: '<path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/>',
      flask: '<path d="M9 3h6"/><path d="M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M7.5 15h9"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
      drive: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M3 10h18"/><path d="M7 15h.01"/><path d="M11 15h2"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
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
