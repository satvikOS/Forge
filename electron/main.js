const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1280,
    minHeight: 720,
    title: 'ArchDisc — AI-Powered CAD Platform',
    icon: path.join(__dirname, 'icon.ico'),
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
