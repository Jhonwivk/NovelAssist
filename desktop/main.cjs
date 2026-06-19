/**
 * Electron 桌面客户端主进程。
 *
 * 两种模式：
 * - 开发（!app.isPackaged，即 `pnpm desktop:dev`）：用系统 node / uv / npx，
 *   跑 `node dist/main.js` + `uv run uvicorn --reload` + `npx next start`，
 *   依赖已 build 的 dist / .next / .venv（与旧行为一致）。
 * - 打包（app.isPackaged，即 `pnpm app:build` 产物）：用 bundle 进 extraResources 的
 *   独立 Node + 可重定位 Python（python-build-standalone），跑
 *   backend(dist) + ai-service(uvicorn) + frontend(Next standalone server.js)。
 *   所有「可写状态」（SQLite DB / ai-service .env）落到 app.getPath('userData')，
 *   首次启动同步拷贝 template.db + default.env，再 spawn 服务。
 */
const { app, BrowserWindow, shell } = require('electron');
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 调试日志（打包后 GUI 启动拿不到 stdout；写到 userData 便于排查）
const DEBUG_LOG = path.join(app.getPath('userData'), 'main-debug.log');
function dbg(msg) {
  try { fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}
dbg('=== main.cjs loaded; isPackaged=' + app.isPackaged + ' ===');

const isDev = !app.isPackaged;
// 开发：__dirname = <root>/desktop；打包：__dirname = <Contents/Resources>/app.asar/desktop
const RES = isDev ? path.join(__dirname, '..') : process.resourcesPath;
const PORTS = { frontend: 3000, backend: 3001, ai: 8000 };

// 运行时二进制
const NODE = isDev
  ? 'node'
  : path.join(RES, 'node', 'bin', 'node');
const PYTHON = isDev
  ? (process.platform === 'win32' ? 'python' : 'python3')
  : path.join(RES, 'python', 'bin', 'python3.12');

// 可写状态（仅打包模式真正依赖 userData；开发用 repo 内文件）
// 注意：必须在 BACKEND_DIR/FRONTEND_DIR 之前声明（它们引用 USER）。
const USER = app.getPath('userData');
const DB_DIR = path.join(USER, 'db');
const AI_STATE_DIR = path.join(USER, 'ai-service');
const DB_PATH = path.join(DB_DIR, 'novelassist.db');
const ENV_PATH = path.join(AI_STATE_DIR, '.env');

// 代码根：backend/frontend 从 userData 运行（解压自 tar.gz，含被过滤的 node_modules）；
// ai-service 源码只读在 Resources。
const BACKEND_DIR = isDev
  ? path.join(__dirname, '..', 'apps', 'backend')
  : path.join(USER, 'backend');
const FRONTEND_DIR = isDev
  ? path.join(__dirname, '..', 'apps', 'frontend')
  : path.join(USER, 'frontend', 'apps', 'frontend'); // Next standalone 嵌套 apps/frontend
const AI_CODE_DIR = isDev
  ? path.join(__dirname, '..', 'apps', 'ai-service')
  : path.join(RES, 'ai-service');

let processes = [];
let mainWindow = null;
let loadingWindow = null;
let aiProcess = null;
let aiRestartTimer = null;

/** 轮询等待服务就绪 */
function waitFor(url, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode < 500) { resolve(); return; }
        retry();
      });
      req.on('error', retry);
      req.setTimeout(2000, () => { req.destroy(); retry(); });
      function retry() {
        if (Date.now() - start > timeout) { reject(new Error(`Timeout waiting for ${url}`)); return; }
        setTimeout(check, 1000);
      }
    }
    check();
  });
}

/** 启动子进程（带日志） */
function startProcess(name, command, args, options = {}) {
  const cwd = options.cwd || RES;
  const proc = spawn(command, args, {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `[${name}]`;
  proc.stdout?.on('data', (d) => process.stdout.write(`${prefix} ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`${prefix} ${d}`));
  proc.on('exit', (code) => {
    if (code !== null && code !== 0) console.error(`${prefix} exited with code ${code}`);
  });
  processes.push(proc);
  return proc;
}

function killAll() {
  if (aiEnvListener) { try { fs.unwatchFile(ENV_PATH, aiEnvListener); } catch {} aiEnvListener = null; }
  if (aiRestartTimer) { clearTimeout(aiRestartTimer); aiRestartTimer = null; }
  for (const p of processes) {
    try { p.kill('SIGTERM'); } catch {}
  }
  processes = [];
}

/** 首次启动 / 升级：解压 backend/frontend tar.gz + 拷贝 template.db/default.env 到 userData（同步，spawn 前完成） */
function firstRunSetup() {
  fs.mkdirSync(DB_DIR, { recursive: true });
  fs.mkdirSync(AI_STATE_DIR, { recursive: true });

  // 代码版本戳 = bundled backend.tar.gz 的 mtime。重新打包后 mtime 变 → 自动重解压，
  // 保证新代码生效（否则 userData 里旧解压的 backend/frontend 不会被覆盖，升级不生效）。
  const stampFile = path.join(USER, '.code-version');
  let bundledStamp = '';
  try { bundledStamp = String(fs.statSync(path.join(RES, 'backend.tar.gz')).mtimeMs); } catch {}
  let storedStamp = '';
  try { storedStamp = fs.readFileSync(stampFile, 'utf8').trim(); } catch {}
  const codeChanged = !!bundledStamp && bundledStamp !== storedStamp;

  // backend / frontend 整树解压（含被 electron-builder 过滤的 node_modules）
  const archives = [
    ['backend.tar.gz', 'backend'],
    ['frontend.tar.gz', 'frontend'],
  ];
  for (const [tarName, dirName] of archives) {
    const target = path.join(USER, dirName);
    const tar = path.join(RES, tarName);
    const needExtract = (!fs.existsSync(target) || codeChanged) && fs.existsSync(tar);
    dbg('extract check: ' + dirName + ' exists=' + fs.existsSync(target) + ' codeChanged=' + codeChanged + ' needExtract=' + needExtract);
    if (needExtract) {
      try {
        if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }); // 清旧版再解压
        dbg('extracting ' + tarName);
        execSync(`tar -xzf "${tar}" -C "${USER}"`, { stdio: 'ignore' });
        dbg('extracted ' + dirName);
      } catch (e) {
        dbg('extract FAILED ' + tarName + ': ' + e.message);
        console.error(`[electron] failed to extract ${tarName}:`, e.message);
      }
    }
  }
  if (codeChanged) { try { fs.writeFileSync(stampFile, bundledStamp); } catch {} }

  const templateDb = path.join(RES, 'db', 'template.db');
  if (!fs.existsSync(DB_PATH) && fs.existsSync(templateDb)) {
    fs.copyFileSync(templateDb, DB_PATH);
    console.log('[electron] initialized DB at', DB_PATH);
  }
  const defaultEnv = path.join(RES, 'ai-service', 'default.env');
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(defaultEnv)) {
    fs.copyFileSync(defaultEnv, ENV_PATH);
    console.log('[electron] initialized ai-service .env at', ENV_PATH);
  }
}

function spawnBackend() {
  const env = {
    PORT: String(PORTS.backend),
    AI_SERVICE_URL: `http://localhost:${PORTS.ai}`,
    DATABASE_URL: isDev ? 'file:./dev.db' : `file:${DB_PATH}`,
    CORS_ORIGIN: `http://localhost:${PORTS.frontend}`,
  };
  return startProcess('backend', NODE, ['dist/main.js'], { cwd: BACKEND_DIR, env });
}

function spawnAi() {
  if (aiProcess) {
    try { aiProcess.kill('SIGTERM'); } catch {}
    processes = processes.filter((p) => p !== aiProcess);
  }
  if (isDev) {
    aiProcess = startProcess('ai', 'uv', [
      'run', 'uvicorn', 'app.main:app', '--reload', '--port', String(PORTS.ai),
    ], { cwd: AI_CODE_DIR });
  } else {
    aiProcess = startProcess('ai', PYTHON, [
      '-m', 'uvicorn', 'app.main:app', '--port', String(PORTS.ai), '--host', '127.0.0.1',
    ], {
      cwd: AI_STATE_DIR, // pydantic-settings 从 cwd 读 ./env；POST /config 写 NA_ENV_FILE
      env: {
        PYTHONPATH: AI_CODE_DIR,
        PYTHONDONTWRITEBYTECODE: '1',
        NA_ENV_FILE: ENV_PATH,
        CORS_ORIGINS: `http://localhost:${PORTS.frontend}`,
      },
    });
  }
  return aiProcess;
}

function spawnFrontend() {
  if (isDev) {
    return startProcess('frontend', 'npx', ['next', 'start', '-p', String(PORTS.frontend)], {
      cwd: FRONTEND_DIR,
    });
  }
  // 打包：Next standalone server.js
  return startProcess('frontend', NODE, ['server.js'], {
    cwd: FRONTEND_DIR,
    env: { PORT: String(PORTS.frontend), HOSTNAME: '127.0.0.1' },
  });
}

/** 打包模式下：监听 ai-service .env 变化 → 重启 ai 进程（无 --reload，由 main 拥有生命周期）。
 *  用 fs.watchFile（stat 轮询）而非 fs.watch：macOS FSEvents 对「原地重写单个文件」不可靠。 */
let aiEnvListener = null;
function watchAiEnv() {
  if (isDev) return;
  if (aiEnvListener) { try { fs.unwatchFile(ENV_PATH, aiEnvListener); } catch {} }
  const listener = (curr, prev) => {
    // 用 fs.watchFile 自带的 prev/curr 比较，避免「自维护 baseline 与首次回调竞争」
    if (prev.mtimeMs && curr.mtimeMs !== prev.mtimeMs) {
      if (aiRestartTimer) clearTimeout(aiRestartTimer);
      aiRestartTimer = setTimeout(() => {
        dbg('ai-service .env changed → restarting ai-service');
        console.log('[electron] ai-service .env changed → restarting ai-service');
        spawnAi();
      }, 800);
    }
  };
  try {
    fs.watchFile(ENV_PATH, { interval: 1500 }, listener);
    aiEnvListener = listener;
    dbg('watching ai .env: ' + ENV_PATH);
  } catch (e) {
    dbg('could not watch ai .env: ' + e.message);
    console.warn('[electron] could not watch ai .env:', e.message);
  }
}

function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 480, height: 320,
    frame: false, resizable: false, minimizable: false, maximizable: false,
    transparent: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true },
  });
  loadingWindow.loadURL('data:text/html,' + encodeURIComponent(`
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0f1115;color:#e8eaed;font-family:system-ui;border-radius:12px;">
      <div style="font-size:32px;margin-bottom:16px;">📖</div>
      <div style="font-size:15px;font-weight:600;">NovelAssist</div>
      <div style="font-size:12px;color:#9aa0a6;margin-top:6px;">正在启动创作环境…</div>
      <div style="margin-top:16px;width:120px;height:3px;background:#252932;border-radius:2px;overflow:hidden;">
        <div style="width:100%;height:100%;background:#7c5cff;animation:sh 1.2s infinite;"></div>
      </div>
      <style>@keyframes sh{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}</style>
    </div>
  `));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1024, minHeight: 600,
    show: false,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  mainWindow.loadURL(`http://localhost:${PORTS.frontend}`);
  mainWindow.once('ready-to-show', () => {
    if (loadingWindow) { loadingWindow.close(); loadingWindow = null; }
    mainWindow.show();
    mainWindow.focus();
  });

  // 外链在系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://localhost')) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    dbg('whenReady fired; RES=' + RES + ' USER=' + USER);
    if (app.isPackaged) {
      dbg('firstRunSetup start');
      firstRunSetup();
      dbg('firstRunSetup done');
    }
    createLoadingWindow();
    dbg('loading window created');

    console.log(`[electron] Starting services (mode: ${isDev ? 'dev' : 'packaged'})...`);
    dbg('spawning backend');
    spawnBackend();
    dbg('spawning ai');
    spawnAi();
    dbg('spawning frontend');
    spawnFrontend();
    watchAiEnv();
    dbg('all spawned');

    try {
      await waitFor(`http://localhost:${PORTS.frontend}`, 60000);
      dbg('frontend ready');
      console.log('[electron] All services ready, opening window...');
      createMainWindow();
    } catch (err) {
      dbg('waitFor failed: ' + err.message);
      console.error('[electron] Failed to start:', err.message);
      if (loadingWindow) { loadingWindow.close(); loadingWindow = null; }
      createMainWindow();
    }
  } catch (e) {
    dbg('FATAL in whenReady: ' + (e && e.stack || e));
    console.error('[electron] FATAL:', e);
  }
});

app.on('window-all-closed', () => {
  killAll();
  app.quit();
});

app.on('before-quit', () => {
  killAll();
});
