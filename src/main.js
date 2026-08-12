const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SUBSCRIPTION_URL, request, decodeSubscription, parseServers, checkServers, VpnCore } = require('./core');

let win, core, servers = [], selectedId = null;
const cacheFile = () => path.join(app.getPath('userData'), 'subscription-zpp.txt');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function emit(type, payload) { win?.webContents.send('vpn:event', { type, payload }); }
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSettings(data) { fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2)); }

async function refresh(useCache = false) {
  let text;
  try { if (useCache && fs.existsSync(cacheFile())) text = fs.readFileSync(cacheFile(), 'utf8'); else { text = decodeSubscription(await request(SUBSCRIPTION_URL)); fs.writeFileSync(cacheFile(), text); } }
  catch (e) { if (fs.existsSync(cacheFile())) text = fs.readFileSync(cacheFile(), 'utf8'); else throw e; }
  servers = parseServers(text); if (!servers.length) throw new Error('Подписка не содержит поддерживаемых серверов');
  emit('servers', servers); servers = await checkServers(servers); emit('servers', servers); return servers;
}

function createWindow() {
  win = new BrowserWindow({ width: 480, height: 820, minWidth: 430, minHeight: 700, backgroundColor: '#080e13', title: 'Dadway VPN', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

app.whenReady().then(async () => {
  core = new VpnCore(app.getPath('userData'), process.resourcesPath, emit);
  await core.recover();
  createWindow();
  const settings = loadSettings(); selectedId = settings.selectedId;
  ipcMain.handle('init', async () => {
    const [xrayVersion, loadedServers] = await Promise.all([
      core.version().catch(() => 'неизвестна'),
      refresh(true).catch(e => { emit('error', e.message); return []; })
    ]);
    return { settings, appVersion: app.getVersion(), xrayVersion, servers: loadedServers };
  });
  ipcMain.handle('refresh', () => refresh(false));
  ipcMain.handle('select', (_, id) => { selectedId = id; saveSettings({ ...loadSettings(), selectedId: id }); return true; });
  ipcMain.handle('connect', async (_, id) => { const server = servers.find(s => s.id === id); if (!server) throw new Error('Сервер не выбран'); return core.connect(server); });
  ipcMain.handle('disconnect', () => core.disconnect());
  ipcMain.handle('ip', () => core.externalIp());
  ipcMain.handle('open', (_, url) => shell.openExternal(url));
  ipcMain.handle('saveLogs', async () => { const result = await dialog.showSaveDialog(win, { defaultPath: `dadway-vpn-${Date.now()}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] }); if (!result.canceled) fs.writeFileSync(result.filePath, core.logs.join('\n')); return !result.canceled; });
});
app.on('before-quit', e => { if (core?.proc) { e.preventDefault(); core.disconnect().finally(() => { core.proc = null; app.quit(); }); } });
app.on('window-all-closed', () => app.quit());
