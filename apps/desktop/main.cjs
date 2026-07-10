const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, dialog, Menu, shell, Tray } = require("electron");
const tar = require("tar");

const productName = "Agent-Trace";
const host = "127.0.0.1";
const defaultCollectorPort = 4319;
const defaultDashboardPort = 3000;
const startupTimeoutMs = 60_000;
const closeBehaviorAsk = "ask";
const closeBehaviorExit = "exit";
const closeBehaviorMinimize = "minimize";
const desktopPreferencesFileName = "preferences.json";

let mainWindow;
let tray;
let dashboardUrl;
let isQuitting = false;
let isCloseDialogOpen = false;
const childProcesses = new Set();

app.setName(productName);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();

    if (mainWindow && dashboardUrl) {
      mainWindow.loadURL(`${dashboardUrl}/runs`);
    }
  });

  app.whenReady().then(startDesktopApp);

  app.on("activate", () => {
    showMainWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", () => {
    isQuitting = true;
    stopServices();
  });
}

async function startDesktopApp() {
  mainWindow = createWindow();
  showStatusPage(
    "Starting Agent-Trace",
    "Preparing the local collector and dashboard. First launch can take a minute while runtime files are unpacked."
  );

  try {
    const collector = await startCollectorService();
    startUsageScannerService(collector.url).catch((error) => {
      console.error(`Agent-Trace usage scanner could not start: ${error instanceof Error ? error.message : String(error)}`);
    });
    const dashboard = await startDashboardService(collector.url);
    dashboardUrl = dashboard.url;

    await mainWindow.loadURL(`${dashboard.url}/runs`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showErrorPage(message);
  }
}

async function startUsageScannerService(collectorUrl) {
  if (!isUsageScannerEnabled()) {
    return undefined;
  }

  const args = [
    "usage",
    "--watch",
    "--collector-url",
    collectorUrl,
    "--home",
    app.getPath("home"),
    "--interval-ms",
    "15000"
  ];
  const processOptions = {
    label: "usage scanner",
    reportFailure: false
  };

  if (app.isPackaged) {
    await preparePackagedRuntime("cli");
    const cliScript = getPackagedCliScript();

    return spawnPackagedNode(
      cliScript,
      {},
      path.dirname(path.dirname(cliScript)),
      args,
      processOptions
    );
  }

  return spawnPnpm(
    ["--filter", "@agent-trace/cli", "exec", "tsx", "src/index.ts", ...args],
    {},
    processOptions
  );
}

function isUsageScannerEnabled() {
  const configured = String(process.env.AGENT_TRACE_USAGE_SCAN ?? "").trim().toLowerCase();

  return configured !== "0" && configured !== "false" && configured !== "off";
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    icon: getWindowIconPath(),
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: productName,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("minimize", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    hideWindowToTray(window);
  });

  window.on("close", (event) => {
    handleWindowClose(event, window).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);

      showErrorPage(message);
    });
  });

  return window;
}

async function handleWindowClose(event, window) {
  if (isQuitting) {
    return;
  }

  event.preventDefault();

  const savedBehavior = getCloseBehaviorPreference();

  if (savedBehavior !== closeBehaviorAsk) {
    applyCloseBehavior(savedBehavior, window);
    return;
  }

  if (isCloseDialogOpen) {
    return;
  }

  isCloseDialogOpen = true;

  try {
    const result = await dialog.showMessageBox(window, {
      type: "question",
      buttons: ["退出程序", "最小化到托盘"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      checkboxLabel: "\u8bb0\u4f4f\u6211\u7684\u9009\u62e9",
      checkboxChecked: false,
      message: "关闭 Agent-Trace？",
      detail: "退出会停止本次由桌面端启动的本地服务；最小化到托盘会让服务继续运行。"
    });

    const behavior = result.response === 0 ? closeBehaviorExit : closeBehaviorMinimize;

    if (result.checkboxChecked) {
      setCloseBehaviorPreference(behavior);
    }

    applyCloseBehavior(behavior, window);
  } finally {
    isCloseDialogOpen = false;
  }
}

function applyCloseBehavior(behavior, window) {
  if (behavior === closeBehaviorExit) {
    quitDesktopApp();
    return;
  }

  hideWindowToTray(window);
}

function getCloseBehaviorPreference() {
  return parseCloseBehavior(readDesktopPreferences().closeBehavior);
}

function setCloseBehaviorPreference(behavior) {
  const preferences = readDesktopPreferences();
  preferences.closeBehavior = parseCloseBehavior(behavior);
  writeDesktopPreferences(preferences);
}

function readDesktopPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getDesktopPreferencesPath(), "utf8"));

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeDesktopPreferences(preferences) {
  const preferencesPath = getDesktopPreferencesPath();

  fs.mkdirSync(path.dirname(preferencesPath), { recursive: true });
  fs.writeFileSync(preferencesPath, `${JSON.stringify(preferences, null, 2)}\n`, "utf8");
}

function parseCloseBehavior(value) {
  return value === closeBehaviorExit || value === closeBehaviorMinimize || value === closeBehaviorAsk
    ? value
    : closeBehaviorAsk;
}

function getDesktopPreferencesPath() {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  return path.join(userDataDir, desktopPreferencesFileName);
}

function quitDesktopApp() {
  isQuitting = true;

  if (tray) {
    tray.destroy();
    tray = undefined;
  }

  app.quit();
}

function hideWindowToTray(window) {
  ensureTray();
  window.hide();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.focus();
}

function ensureTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(getWindowIconPath());
  tray.setToolTip(productName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 Agent-Trace", click: showMainWindow },
      { type: "separator" },
      { label: "退出 Agent-Trace", click: quitDesktopApp }
    ])
  );
  tray.on("click", showMainWindow);
  tray.on("double-click", showMainWindow);

  return tray;
}

function getWindowIconPath() {
  return path.join(__dirname, "assets", "icon.ico");
}

async function startCollectorService() {
  const port = getEnvPort("AGENT_TRACE_SERVER_PORT", "TOOLTRACE_SERVER_PORT", defaultCollectorPort);
  const url = `http://${host}:${port}`;
  const probe = await probeCollector(port);

  if (probe === "agent-trace") {
    return { url, reused: true };
  }

  if (probe === "busy") {
    throw new Error(
      `Port ${port} is already in use by another program. Close that program or set AGENT_TRACE_SERVER_PORT before launching Agent-Trace.`
    );
  }

  const databasePath = resolveDatabasePath();
  process.env.AGENT_TRACE_DB_PATH = databasePath;
  process.env.PORT = String(port);

  if (app.isPackaged) {
    await preparePackagedRuntime("server");
    const serverScript = getPackagedCollectorServerScript();

    spawnPackagedNode(
      serverScript,
      {
        PORT: String(port),
        AGENT_TRACE_DB_PATH: databasePath
      },
      path.dirname(path.dirname(serverScript))
    );
  } else {
    spawnPnpm(["--filter", "@agent-trace/server", "dev"], {
      PORT: String(port),
      AGENT_TRACE_DB_PATH: databasePath
    });
  }

  await waitForHttp(`${url}/health`, startupTimeoutMs);

  return { url, reused: false };
}

async function startDashboardService(collectorUrl) {
  const explicitPort = getOptionalEnvPort("AGENT_TRACE_WEB_PORT", "TOOLTRACE_WEB_PORT");
  const port = explicitPort ?? (await findAvailablePort(defaultDashboardPort));
  const url = `http://${host}:${port}`;

  if (explicitPort !== undefined && !(await isPortAvailable(explicitPort))) {
    throw new Error(
      `Dashboard port ${explicitPort} is already in use. Close that program or choose another AGENT_TRACE_WEB_PORT.`
    );
  }

  const env = {
    PORT: String(port),
    HOSTNAME: host,
    AGENT_TRACE_API_URL: collectorUrl,
    TOOLTRACE_API_URL: collectorUrl,
    AGENT_TRACE_DESKTOP_PREFERENCES_PATH: getDesktopPreferencesPath()
  };

  if (app.isPackaged) {
    await preparePackagedRuntime("web");
    const serverScript = getPackagedDashboardServerScript();

    spawnPackagedNode(serverScript, env, path.dirname(serverScript));
  } else {
    spawnPnpm(["--filter", "@agent-trace/web", "dev"], env);
  }

  await waitForHttp(`${url}/runs`, startupTimeoutMs);

  return { url };
}

function getPackagedCollectorServerScript() {
  const serverScript = path.join(
    getRuntimePath("server"),
    "app",
    "dist",
    "index.js"
  );

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Packaged collector server was not found at ${serverScript}.`);
  }

  return serverScript;
}

function getPackagedDashboardServerScript() {
  const serverScript = path.join(
    getRuntimePath("web"),
    "app",
    "apps",
    "web",
    "server.js"
  );

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Packaged dashboard server was not found at ${serverScript}.`);
  }

  return serverScript;
}

function getPackagedCliScript() {
  const cliScript = path.join(getRuntimePath("cli"), "app", "dist", "index.js");

  if (!fs.existsSync(cliScript)) {
    throw new Error(`Packaged usage scanner was not found at ${cliScript}.`);
  }

  return cliScript;
}

const runtimePathCache = new Map();

function getRuntimePath(name) {
  const cached = runtimePathCache.get(name);

  if (cached) {
    return cached;
  }

  throw new Error(`Packaged ${name} runtime has not been prepared.`);
}

async function preparePackagedRuntime(name) {
  const archivePath = path.join(process.resourcesPath, "archives", `${name}.tgz`);

  if (!fs.existsSync(archivePath)) {
    throw new Error(`Packaged ${name} archive was not found at ${archivePath}.`);
  }

  const archiveStat = fs.statSync(archivePath);
  const runtimeRoot = path.join(app.getPath("userData"), "runtime");
  const runtimeName = `${name}-${archiveStat.size}-${Math.floor(archiveStat.mtimeMs)}`;
  const runtimePath = path.join(runtimeRoot, runtimeName);
  const markerPath = path.join(runtimePath, ".agent-trace-runtime-ready");

  if (!fs.existsSync(markerPath)) {
    fs.rmSync(runtimePath, { recursive: true, force: true });
    fs.mkdirSync(runtimePath, { recursive: true });

    await tar.x({
      cwd: runtimePath,
      file: archivePath,
      preservePaths: false
    });

    fs.writeFileSync(markerPath, new Date().toISOString());
  }

  runtimePathCache.set(name, runtimePath);
  cleanupOldRuntimeDirs(runtimeRoot, name, runtimeName);

  return runtimePath;
}

function cleanupOldRuntimeDirs(runtimeRoot, name, keepName) {
  if (!fs.existsSync(runtimeRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${name}-`) || entry.name === keepName) {
      continue;
    }

    fs.rmSync(path.join(runtimeRoot, entry.name), { recursive: true, force: true });
  }
}

function resolveDatabasePath() {
  const configured = process.env.AGENT_TRACE_DB_PATH ?? process.env.TOOLTRACE_DB_PATH;

  if (configured) {
    return configured;
  }

  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });

  return path.join(userDataDir, "agent-trace.db");
}

async function probeCollector(port) {
  if (!(await canConnect(port))) {
    return "free";
  }

  const baseUrl = `http://${host}:${port}`;

  try {
    const health = await fetchJson(`${baseUrl}/health`, 1_500);

    if (health && health.service === "agent-trace") {
      return "agent-trace";
    }
  } catch {
    return "busy";
  }

  try {
    const runs = await fetchJson(`${baseUrl}/runs`, 1_500);

    if (Array.isArray(runs)) {
      return "agent-trace";
    }
  } catch {
    return "busy";
  }

  return "busy";
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });

    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function findAvailablePort(preferredPort) {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available dashboard port found starting at ${preferredPort}.`);
}

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, 1_500);

      if (response.ok) {
        return;
      }

      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${url}.${detail}`);
}

async function fetchJson(url, timeoutMs) {
  const response = await fetchWithTimeout(url, timeoutMs);

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.json();
}

function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnPnpm(args, env, processOptions = {}) {
  const pnpm = resolvePnpmCommand();

  return spawnManaged(pnpm.command, [...pnpm.args, ...args], {
    cwd: resolveWorkspaceRoot(),
    env,
    shell: process.platform === "win32" && pnpm.args.length === 0,
    ...processOptions
  });
}

function spawnPackagedNode(scriptPath, env, cwd, args = [], processOptions = {}) {
  // Reuse Electron's bundled Node.js runtime instead of shipping a separate
  // node.exe. ELECTRON_RUN_AS_NODE makes the Electron binary behave as plain Node.
  return spawnManaged(process.execPath, [scriptPath, ...args], {
    cwd,
    env: {
      ...env,
      NODE_ENV: "production",
      ELECTRON_RUN_AS_NODE: "1"
    },
    ...processOptions
  });
}

function spawnManaged(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: withoutUndefined({
      ...process.env,
      ...options.env
    }),
    shell: options.shell ?? false,
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true
  });

  childProcesses.add(child);

  child.once("error", (error) => {
    childProcesses.delete(child);

    if (!isQuitting && options.reportFailure !== false) {
      showErrorPage(error.message);
    } else if (!isQuitting) {
      console.error(`${options.label || command} failed: ${error.message}`);
    }
  });

  child.once("exit", (code) => {
    childProcesses.delete(child);

    if (!isQuitting && code !== 0 && code !== null && options.reportFailure !== false) {
      showErrorPage(`${command} exited with code ${code}.`);
    } else if (!isQuitting && code !== 0 && code !== null) {
      console.error(`${options.label || command} exited with code ${code}.`);
    }
  });

  return child;
}

function stopServices() {
  for (const child of childProcesses) {
    terminateChildProcess(child);
  }

  childProcesses.clear();
}

function terminateChildProcess(child) {
  if (child.killed || child.exitCode !== null || !child.pid) {
    return;
  }

  if (process.platform === "win32") {
    const result = spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });

    if (result.status === 0) {
      return;
    }
  }

  child.kill();
}

function resolveWorkspaceRoot() {
  return path.resolve(__dirname, "../..");
}

function resolvePnpmCommand() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && npmExecPath.toLowerCase().includes("pnpm")) {
    return {
      command: process.execPath,
      args: [npmExecPath]
    };
  }

  return {
    command: "pnpm",
    args: []
  };
}

function getEnvPort(primary, legacy, fallback) {
  return getOptionalEnvPort(primary, legacy) ?? fallback;
}

function getOptionalEnvPort(primary, legacy) {
  const raw = process.env[primary] ?? process.env[legacy];

  if (!raw) {
    return undefined;
  }

  const port = Number(raw);

  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : undefined;
}

function withoutUndefined(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined));
}

function showStatusPage(title, body) {
  if (!mainWindow) {
    return;
  }

  mainWindow.loadURL(toDataUrl(renderPage(title, body)));
}

function showErrorPage(message) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.loadURL(
    toDataUrl(
      renderPage(
        "Agent-Trace could not start",
        `${escapeHtml(message)}<br><br>Check port usage and restart the app.`
      )
    )
  );
}

function renderPage(title, body) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        align-items: center;
        background: #0f172a;
        color: #e2e8f0;
        display: flex;
        font-family: Segoe UI, system-ui, sans-serif;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
      }
      main {
        max-width: 560px;
        padding: 32px;
      }
      h1 {
        font-size: 28px;
        font-weight: 650;
        margin: 0 0 12px;
      }
      p {
        color: #94a3b8;
        font-size: 14px;
        line-height: 1.7;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${body}</p>
    </main>
  </body>
</html>`;
}

function toDataUrl(html) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
