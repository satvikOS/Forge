const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Forge-112 — ffmpeg-static binary path, loaded lazily so a dev environment
// missing the dep can still boot the rest of the shell. Resolved once at
// require-time; the IPC handler below surfaces a clear error if it's null.
let ffmpegBinary = null;
try {
  ffmpegBinary = require('ffmpeg-static');
} catch (err) {
  console.warn('[forge.video] ffmpeg-static not installed:', err.message);
}

// File I/O dialog plumbing (Forge-87): renderer calls the bridge in preload,
// preload sends a request to main, main shows the native dialog and returns
// the chosen path. The actual STEP/IGES/STL/BREP import then runs in the
// renderer via window.forge.io.* against the chosen path.
ipcMain.handle('io:openDialog', async (_evt, opts) => {
  const r = await dialog.showOpenDialog({
    title: opts.title || 'Open',
    filters: opts.filters || [],
    properties: ['openFile'],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('io:saveDialog', async (_evt, opts) => {
  const r = await dialog.showSaveDialog({
    title: opts.title || 'Save',
    defaultPath: opts.defaultPath || 'untitled',
    filters: opts.filters || [],
  });
  return r.canceled ? null : r.filePath;
});

// Forge-103 — project-bundle ZIP exporter blob writer.
//
// Renderer builds the ZIP entirely in memory with JSZip, then ships the
// bytes here for atomic write. We accept either a base64 string or a
// raw Uint8Array (Electron's structured-clone marshals both as Buffer
// in the main process). Returns { ok, bytes, path } so the renderer can
// report exact size in a toast.
ipcMain.handle('io:writeBlob', async (_evt, { filepath, base64, bytes }) => {
  try {
    if (!filepath || typeof filepath !== 'string') {
      throw new Error('io:writeBlob: filepath required');
    }
    let buf;
    if (base64 != null) {
      buf = Buffer.from(String(base64), 'base64');
    } else if (bytes != null) {
      // Uint8Array → Buffer (zero-copy when possible).
      buf = Buffer.from(bytes.buffer ? bytes.buffer : bytes,
                        bytes.byteOffset || 0,
                        bytes.byteLength != null ? bytes.byteLength : bytes.length);
    } else {
      throw new Error('io:writeBlob: base64 or bytes required');
    }
    // Make sure the parent directory exists.
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filepath, buf);
    return { ok: true, path: filepath, bytes: buf.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Forge-112 — transcode a WebM (VP9 from MediaRecorder) to H.264 MP4 using
// the bundled ffmpeg-static binary. The renderer writes the recorded blob
// to disk first via io:writeBlob, then calls this with the resulting path.
//
// Args: { srcPath } — absolute path to a .webm on the local filesystem.
// The output is written next to it with a .mp4 extension (foo.webm →
// foo.mp4). We hard-fail loudly on any ffmpeg error — codec missing,
// permission denied, malformed input — rather than silently fall back to
// a copy of the .webm; the operator needs the real stderr to debug.
ipcMain.handle('io:transcodeWebmToMp4', async (_evt, { srcPath } = {}) => {
  const startedAt = Date.now();
  try {
    if (!srcPath || typeof srcPath !== 'string') {
      throw new Error('srcPath required');
    }
    if (!fs.existsSync(srcPath)) {
      throw new Error(`source not found: ${srcPath}`);
    }
    if (!ffmpegBinary) {
      throw new Error('ffmpeg-static binary unavailable — `npm install ffmpeg-static` at repo root');
    }
    // Derive the mp4 path from the source path. We deliberately replace
    // the trailing .webm (case-insensitive) rather than always appending
    // .mp4 so foo.webm → foo.mp4 (not foo.webm.mp4).
    const mp4Path = srcPath.replace(/\.webm$/i, '') + '.mp4';
    // Clean any stale artefact so a previous-run mp4 can't masquerade
    // as a successful transcode if ffmpeg actually fails partway.
    try { fs.unlinkSync(mp4Path); } catch { /* fresh */ }

    // -y: overwrite if it crept back. -c:v libx264 + crf 18 + preset slow
    // gives near-visually-lossless quality. yuv420p for QuickTime/Safari
    // compatibility. +faststart relocates moov atom to the front so the
    // file is playable while still downloading.
    const args = [
      '-y',
      '-i', srcPath,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      mp4Path,
    ];

    const result = await new Promise((resolve) => {
      const child = spawn(ffmpegBinary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('error', (err) => resolve({ code: -1, stderr: err.message, stdout }));
      child.on('close', (code) => resolve({ code, stderr, stdout }));
    });

    const durationMs = Date.now() - startedAt;
    if (result.code !== 0) {
      // Surface ffmpeg's tail of stderr (full log is too noisy for a toast).
      const tail = result.stderr.split('\n').filter(Boolean).slice(-6).join('\n');
      return {
        ok: false,
        durationMs,
        error: `ffmpeg exit ${result.code}\n${tail || '(no stderr)'}`,
      };
    }
    if (!fs.existsSync(mp4Path)) {
      return {
        ok: false,
        durationMs,
        error: `ffmpeg reported success but ${mp4Path} is missing`,
      };
    }
    const bytes = fs.statSync(mp4Path).size;
    return { ok: true, mp4Path, durationMs, bytes };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - startedAt, error: err.message };
  }
});

// Forge-195 — Multi-window: spawn a secondary BrowserWindow loading the
// same renderer with an optional initial workbench so the user can dock
// drawings in one window + 3D model in another. State coordination
// happens through the renderer's localStorage broadcast (no main-process
// shared state to maintain).
const secondaryWindows = new Map();
ipcMain.handle('win:newWindow', async (_evt, opts = {}) => {
  try {
    const id = `win-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const win = new BrowserWindow({
      width: opts.width  || 1200,
      height: opts.height || 900,
      x: opts.x, y: opts.y,
      title: opts.title || 'ArchDisc Forge — secondary',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webgl: true,
        preload: path.join(__dirname, 'preload.js'),
        sandbox: false,
      },
      backgroundColor: '#0a0e14',
      show: false,
    });
    const isDev = process.argv.includes('--dev');
    const hash = opts.initialWb ? `#wb=${encodeURIComponent(opts.initialWb)}` : '';
    if (isDev) {
      win.loadURL('http://localhost:3000/' + hash);
    } else {
      const filePath = path.join(__dirname, '..', 'frontend', 'dist', 'index.html');
      win.loadFile(filePath, { hash: hash.slice(1) });
    }
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => secondaryWindows.delete(id));
    secondaryWindows.set(id, win);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('win:listWindows', async () => {
  return {
    ids: Array.from(secondaryWindows.keys()),
    count: secondaryWindows.size,
  };
});
ipcMain.handle('win:closeWindow', async (_evt, { id } = {}) => {
  const w = id ? secondaryWindows.get(id) : null;
  if (!w) return { ok: false, error: 'window not found' };
  try { w.close(); } catch {}
  return { ok: true };
});

// Forge-197 — Embedded HTTP webhook receiver. Listens on an
// unprivileged loopback port and forwards JSON payloads to the renderer
// as 'webhook:received' events on the focused BrowserWindow's
// webContents. Useful for triggering an export / render / e2e in
// response to upstream CI completion.
const http = require('http');
const crypto = require('crypto');
let webhookServer = null;
let webhookPort = 0;
let webhookSecret = null;
let webhookCount = 0;
ipcMain.handle('webhook:start', async (_evt, { port = 9595, secret = null } = {}) => {
  if (webhookServer) {
    try { webhookServer.close(); } catch {}
    webhookServer = null;
  }
  try {
    webhookSecret = (typeof secret === 'string' && secret.length > 0) ? secret : null;
    webhookCount = 0;
    webhookServer = http.createServer((req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405; res.end('POST only');
        return;
      }
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) {
          res.statusCode = 413; res.end('payload too large');
          req.connection.destroy();
        }
      });
      req.on('end', () => {
        try {
          if (webhookSecret) {
            const sig = req.headers['x-hub-signature-256'] || '';
            const hmac = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
            const expected = `sha256=${hmac}`;
            if (sig !== expected) {
              res.statusCode = 401; res.end('bad signature');
              return;
            }
          }
          let parsed = null;
          try { parsed = JSON.parse(body); } catch { parsed = { raw: body }; }
          webhookCount += 1;
          const payload = {
            url:        req.url,
            headers:    req.headers,
            method:     req.method,
            body:       parsed,
            receivedAt: Date.now(),
          };
          for (const win of BrowserWindow.getAllWindows()) {
            try { win.webContents.send('webhook:received', payload); } catch {}
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, count: webhookCount }));
        } catch (e) {
          res.statusCode = 500; res.end('handler error: ' + e.message);
        }
      });
    });
    await new Promise((resolve, reject) => {
      webhookServer.once('error', reject);
      webhookServer.listen(port, '127.0.0.1', resolve);
    });
    webhookPort = webhookServer.address().port;
    return { ok: true, port: webhookPort, requireSignature: !!webhookSecret };
  } catch (err) {
    webhookServer = null;
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('webhook:stop', async () => {
  if (!webhookServer) return { ok: true, alreadyStopped: true };
  try { webhookServer.close(); } catch {}
  webhookServer = null;
  return { ok: true };
});
ipcMain.handle('webhook:status', async () => ({
  running: !!webhookServer, port: webhookPort, count: webhookCount,
  requireSignature: !!webhookSecret,
}));

// electron-updater drives auto-update against the GitHub Releases the CI
// workflow publishes. Loaded lazily/guarded so a dev run without the dep
// installed still works.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.warn('[updater] electron-updater not available:', err.message);
}

let mainWindow;

// --------------------------------------------------------------- updater
function initAutoUpdater() {
  // Auto-update only makes sense for packaged builds; skip in dev.
  if (!autoUpdater || !app.isPackaged) {
    if (!app.isPackaged) console.log('[updater] dev run — auto-update skipped');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  const notifyRenderer = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  };

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking for update'));
  autoUpdater.on('update-available', (info) => {
    console.log('[updater] update available:', info.version);
    notifyRenderer('update:available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => console.log('[updater] up to date'));
  autoUpdater.on('download-progress', (p) => {
    console.log(`[updater] downloading ${Math.round(p.percent)}%`);
    notifyRenderer('update:progress', { percent: p.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] update downloaded:', info.version);
    // checkForUpdatesAndNotify shows a native OS notification; the update
    // installs on next quit (autoInstallOnAppQuit).
    notifyRenderer('update:downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => console.error('[updater] error:', err == null ? 'unknown' : (err.stack || err).toString()));

  // Renderer-driven controls: quitAndInstall + manual re-check.
  const { ipcMain } = require('electron');
  ipcMain.on('updater:quitAndInstall', () => {
    try { autoUpdater.quitAndInstall(); }
    catch (err) { console.error('[updater] quitAndInstall failed:', err.message); }
  });
  ipcMain.on('updater:check', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] manual check failed:', err.message);
    });
  });

  // Fires the check + native "update ready" notification.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] checkForUpdatesAndNotify failed:', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 1050,
    minWidth: 1400,
    minHeight: 900,
    title: 'ArchDisc Forge',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      enableWebSQL: false,
      // Bridge the native Forge kernel into the renderer via contextBridge.
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false, // preload needs `require` to load the .node addon
    },
    backgroundColor: '#000000',
    show: false,
  });

  // Load the built frontend
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize();
  });

  // Application menu
  const menu = Menu.buildFromTemplate([
    {
      label: 'ArchDisc',
      submenu: [
        { label: 'About ArchDisc', click: () => showAbout() },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: () => {} },
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => mainWindow.webContents.send('menu:new') },
        { label: 'Open Project', accelerator: 'CmdOrCtrl+O', click: () => {} },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu:save') },
        { label: 'Save As...', accelerator: 'CmdOrCtrl+Shift+S', click: () => {} },
        { type: 'separator' },
        { label: 'Export', submenu: [
          { label: 'STEP (.step)', click: () => mainWindow.webContents.send('menu:export', 'step') },
          { label: 'STL (.stl)', click: () => mainWindow.webContents.send('menu:export', 'stl') },
          { label: 'OBJ (.obj)', click: () => mainWindow.webContents.send('menu:export', 'obj') },
          { label: 'glTF (.gltf)', click: () => mainWindow.webContents.send('menu:export', 'gltf') },
          { label: 'G-Code (.nc)', click: () => mainWindow.webContents.send('menu:export', 'gcode') },
        ]},
        { type: 'separator' },
        { role: 'quit' },
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu:undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => mainWindow.webContents.send('menu:redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Shaded', click: () => mainWindow.webContents.send('menu:display', 'shaded') },
        { label: 'Wireframe', click: () => mainWindow.webContents.send('menu:display', 'wireframe') },
        { label: 'X-Ray', click: () => mainWindow.webContents.send('menu:display', 'xray') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ]
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Documentation', click: () => shell.openExternal('https://archdisc.com/docs') },
        { label: 'Keyboard Shortcuts', click: () => {} },
        { type: 'separator' },
        { label: 'About ArchDisc', click: () => showAbout() },
      ]
    },
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => { mainWindow = null; });
}

function showAbout() {
  const { dialog } = require('electron');
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'About ArchDisc',
    message: 'ArchDisc — AI-Powered CAD Platform',
    detail: `Version 1.0.0\n\nProprietary B-Rep Geometry Kernel\n40+ modules, 8700+ lines\n\nBuilt with ArchDisc Technology`,
    buttons: ['OK'],
  });
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
