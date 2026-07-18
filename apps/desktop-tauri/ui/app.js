(function () {
  const { API, applyTheme, checkHealth, errorView, nav, route, state, views } = window.AT;
  let refreshTimer;
  let changes;

  async function renderCurrent() {
    const token = ++state.renderToken;
    const current = route();
    nav();

    try {
      if (current.path === "/runs/compare") await views.compare(current);
      else if (current.path.startsWith("/runs/")) await views.runDetail(decodeURIComponent(current.path.slice(6)), current);
      else if (current.path === "/runs") await views.runs(current);
      else if (current.path === "/token-trace") await views.tokenTrace(current);
      else if (current.path === "/analytics") await views.analytics(current);
      else if (current.path === "/evaluations") await views.evaluations(current);
      else if (current.path === "/sandbox") await views.sandbox(current);
      else if (current.path === "/maintenance") await views.maintenance(current);
      else {
        location.replace("#/runs");
        return;
      }
    } catch (error) {
      if (token === state.renderToken) errorView(error);
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(renderCurrent, 180);
  }

  function connectChanges() {
    changes?.close();
    changes = new EventSource(`${API}/changes`);
    changes.addEventListener("change", scheduleRefresh);
    changes.onopen = checkHealth;
    changes.onerror = () => {
      const health = document.querySelector("#health");
      health.textContent = state.lang === "zh" ? "正在重连" : "Reconnecting";
      health.className = "health pending";
    };
  }

  window.addEventListener("hashchange", renderCurrent);
  window.addEventListener("unhandledrejection", event => {
    window.AT.toast(event.reason?.message || String(event.reason), "error");
  });

  applyTheme();
  nav();
  checkHealth();
  connectChanges();
  renderCurrent();
})();
