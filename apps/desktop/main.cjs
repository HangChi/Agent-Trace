const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const { app, BrowserWindow, shell } = require("electron");

const productName = "Agent-Trace";
const host = "127.0.0.1";
const defaultCollectorPort = 4319;
const defaultDashboardPort = 3000;
const startupTimeoutMs = 60_000;

let mainWindow;
let dashboardUrl;
let isQuitting = false;
const childProcesses = new Set();

app.setName(productName);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();

    if (dashboardUrl) {
      mainWindow.loadURL(`${dashboardUrl}/runs`);
    }
  });

  app.whenReady().then(startDesktopApp);

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
  showStatusPage("Starting Agent-Trace", "Preparing the local collector and dashboard.");

  try {
    const collector = await startCollectorService();
    const dashboard = await startDashboardService(collector.url);
    dashboardUrl = dashboard.url;

    await mainWindow.loadURL(`${dashboard.url}/runs`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showErrorPage(message);
  }
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

  return window;
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
    TOOLTRACE_API_URL: collectorUrl
  };

  if (app.isPackaged) {
    const serverScript = getPackagedDashboardServerScript();

    spawnPackagedNode(serverScript, env, path.dirname(serverScript));
  } else {
    spawnPnpm(["--filter", "@agent-trace/web", "dev"], env);
  }

  await waitForHttp(`${url}/runs`, startupTimeoutMs);

  return { url };
}

function getPackagedCollectorServerScript() {
  const serverScript = path.join(process.resourcesPath, "server", "app", "dist", "index.js");

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Packaged collector server was not found at ${serverScript}.`);
  }

  return serverScript;
}

function getPackagedDashboardServerScript() {
  const serverScript = path.join(process.resourcesPath, "web", "app", "apps", "web", "server.js");

  if (!fs.existsSync(serverScript)) {
    throw new Error(`Packaged dashboard server was not found at ${serverScript}.`);
  }

  return serverScript;
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

function spawnPnpm(args, env) {
  const pnpm = resolvePnpmCommand();

  return spawnManaged(pnpm.command, [...pnpm.args, ...args], {
    cwd: resolveWorkspaceRoot(),
    env,
    shell: process.platform === "win32" && pnpm.args.length === 0
  });
}

function spawnPackagedNode(scriptPath, env, cwd) {
  return spawnManaged(getPackagedNodeExecutable(), [scriptPath], {
    cwd,
    env: {
      ...env,
      NODE_ENV: "production"
    }
  });
}

function getPackagedNodeExecutable() {
  const executable = path.join(
    process.resourcesPath,
    "node",
    process.platform === "win32" ? "node.exe" : "node"
  );

  if (!fs.existsSync(executable)) {
    throw new Error(`Packaged Node runtime was not found at ${executable}.`);
  }

  return executable;
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

    if (!isQuitting) {
      showErrorPage(error.message);
    }
  });

  child.once("exit", (code) => {
    childProcesses.delete(child);

    if (!isQuitting && code !== 0 && code !== null) {
      showErrorPage(`${command} exited with code ${code}.`);
    }
  });

  return child;
}

function stopServices() {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill();
    }
  }

  childProcesses.clear();
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
