const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

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

  // Fires the check + native "update ready" notification.
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] checkForUpdatesAndNotify failed:', err.message);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: 'ArchDisc — AI-Powered CAD Platform',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webgl: true,
      enableWebSQL: false,
    },
    backgroundColor: '#0d0d1a',
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
