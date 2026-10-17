// Kerf desktop (Electron). Serves the web app from app:// and gives it a
// small file/font/dialog API through preload.js.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { pathToFileURL } = require('url');

// if the GPU can't be used, keep WebGL (the 3D view) working in software
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const APP_DIR = path.join(__dirname, 'app');
const ROOT = process.env.KERF_ROOT || path.join(os.homedir(), 'Kerf'); // default project folder (examples, tutorial)
// tests: KERF_TEST=1 keeps the window hidden; KERF_USERDATA isolates the profile
if (process.env.KERF_USERDATA) app.setPath('userData', process.env.KERF_USERDATA);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

let win = null;
let fileToOpen = null;

function argFile(argv) {
  const f = argv.slice(1).find(a => /\.(kerf|scad)$/i.test(a) && fs.existsSync(a));
  return f ? path.resolve(f) : null;
}

function seedRoot() {
  if (fs.existsSync(ROOT) && fs.readdirSync(ROOT).some(n => n.endsWith('.kerf'))) return;
  fs.mkdirSync(ROOT, { recursive: true });
  fs.cpSync(path.join(APP_DIR, 'examples'), ROOT, { recursive: true, filter: s => !s.endsWith('manifest.json') });
}

const abs = p => (path.isAbsolute(p) ? p : path.join(ROOT, p));

function listDir(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) listDir(full, base, out);
    else if (/\.(kerf|scad|svg|png|jpe?g|gif|webp|bmp|ttf|otf)$/i.test(e.name)) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

ipcMain.handle('kerf:root', () => ROOT);
ipcMain.handle('kerf:list', () => listDir(ROOT).sort());
ipcMain.handle('kerf:read', (e, p) => fs.readFileSync(abs(p)));
ipcMain.handle('kerf:exists', (e, p) => fs.existsSync(abs(p)));
ipcMain.handle('kerf:write', (e, p, data) => {
  const f = abs(p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-kerf';
  fs.writeFileSync(tmp, typeof data === 'string' ? data : Buffer.from(data));
  fs.renameSync(tmp, f);
  return f;
});
ipcMain.handle('kerf:font', (e, name) => {
  const file = execFileSync('fc-match', ['-f', '%{file}', name], { encoding: 'utf8' }).trim();
  if (!/\.(ttf|otf)$/i.test(file)) throw new Error(`no TrueType/OpenType font for "${name}"`);
  return fs.readFileSync(file);
});
const kerfFilters = [{ name: 'Kerf designs', extensions: ['kerf', 'scad'] }, { name: 'All files', extensions: ['*'] }];
ipcMain.handle('kerf:openDialog', async () => {
  const r = await dialog.showOpenDialog(win, { defaultPath: ROOT, properties: ['openFile'], filters: kerfFilters });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('kerf:saveDialog', async (e, suggested) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: suggested ? abs(suggested) : path.join(ROOT, 'untitled.kerf'), filters: kerfFilters });
  if (r.canceled) return null;
  return /\.(kerf|scad)$/i.test(r.filePath) ? r.filePath : r.filePath + '.kerf';
});
ipcMain.handle('kerf:reveal', (e, p) => shell.showItemInFolder(abs(p)));
ipcMain.handle('kerf:takeFileToOpen', () => { const f = fileToOpen; fileToOpen = null; return f; });

function send(action) { if (win) win.webContents.send('kerf:menu', action); }

function buildMenu() {
  const item = (label, accelerator, action) => ({ label, accelerator, click: () => send(action) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: '&File', submenu: [
        item('&New…', 'CmdOrCtrl+N', 'new'),
        item('&Open…', 'CmdOrCtrl+O', 'open'),
        { type: 'separator' },
        item('&Save', 'CmdOrCtrl+S', 'save'),
        item('Save &As…', 'CmdOrCtrl+Shift+S', 'saveas'),
        { type: 'separator' },
        item('&Export SVG', 'CmdOrCtrl+E', 'export'),
        item('Show &export folder', null, 'reveal'),
        { type: 'separator' },
        { label: '&Quit', accelerator: 'CmdOrCtrl+Q', click: () => win && win.close() },
      ],
    },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: '&View', submenu: [
        item('&Render', 'F5', 'render'),
        item('3D fit', 'CmdOrCtrl+1', 'view:3d'), item('Parts', 'CmdOrCtrl+2', 'view:part'), item('Sheets', 'CmdOrCtrl+3', 'view:sheets'),
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' },
        { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    { label: '&Help', submenu: [item('&Tutorial', null, 'tutorial'), item('Language &reference', 'F1', 'help')] },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600,
    title: 'Kerf', backgroundColor: '#16181c', show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  if (!process.env.KERF_TEST) win.once('ready-to-show', () => win.show());
  // unsaved changes: the page's beforeunload asks; show a real dialog
  win.webContents.on('will-prevent-unload', e => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Discard changes', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Unsaved changes', message: 'You have unsaved changes. Close Kerf anyway?',
    });
    if (choice === 0) e.preventDefault();
  });
  // links in the help open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL('app://kerf/index.html');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (e, argv) => {
    const f = argFile(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (f) win.webContents.send('kerf:openPath', f);
    }
  });
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      const u = new URL(req.url);
      const p = path.normalize(path.join(APP_DIR, decodeURIComponent(u.pathname)));
      if (!p.startsWith(APP_DIR)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(p).toString());
    });
    try { seedRoot(); } catch (e) { console.error('could not set up', ROOT, e); }
    fileToOpen = argFile(process.argv);
    buildMenu();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
