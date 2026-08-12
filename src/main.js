const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SUBSCRIPTION_URL, SubscriptionAccessError, request, decodeSubscription, parseServers, checkServers, VpnCore } = require('./core');

let win, core, servers = [], selectedId = null, subscriptionValidationTimer = null;
const cacheFile = () => path.join(app.getPath('userData'), 'subscription-zpp.txt');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function emit(type, payload) { win?.webContents.send('vpn:event', { type, payload }); }
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSettings(data) { fs.writeFileSync(settingsFile(), JSON.stringify(data, null, 2)); }

function removeSubscriptionCache() { if (fs.existsSync(cacheFile())) fs.unlinkSync(cacheFile()); }
function isTemporarySubscriptionError(error) {
  if (error instanceof SubscriptionAccessError) return false;
  if (error.statusCode) return [408, 425, 429].includes(error.statusCode) || error.statusCode >= 500;
  return ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code) ||
    /timeout|время ожидания/i.test(error.message || '');
}

async function refresh(useCache = false, allowCacheFallback = true) {
  let text;
  let fromCache = false;
  try {
    if (useCache && fs.existsSync(cacheFile())) {
      text = fs.readFileSync(cacheFile(), 'utf8'); fromCache = true;
    } else {
      text = decodeSubscription(await request(SUBSCRIPTION_URL)); fs.writeFileSync(cacheFile(), text);
    }
  } catch (error) {
    if (error instanceof SubscriptionAccessError) {
      removeSubscriptionCache(); servers = []; selectedId = null; emit('servers', []); throw error;
    }
    if (!allowCacheFallback || !isTemporarySubscriptionError(error) || !fs.existsSync(cacheFile())) throw error;
    text = fs.readFileSync(cacheFile(), 'utf8'); fromCache = true;
  }
  servers = parseServers(text); if (!servers.length) throw new Error('Подписка не содержит поддерживаемых серверов');
  emit('servers', servers); servers = await checkServers(servers); emit('servers', servers); return { servers, fromCache };
}

function createWindow() {
  win = new BrowserWindow({ width: 480, height: 820, minWidth: 430, minHeight: 700, backgroundColor: '#080e13', title: 'Dadway VPN', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function stopSubscriptionValidation() {
  if (subscriptionValidationTimer) clearInterval(subscriptionValidationTimer);
  subscriptionValidationTimer = null;
}
function startSubscriptionValidation() {
  stopSubscriptionValidation();
  subscriptionValidationTimer = setInterval(async () => {
    try { await validateSubscriptionAccess(); }
    catch (error) {
      if (!(error instanceof SubscriptionAccessError)) return;
      removeSubscriptionCache(); servers = []; selectedId = null; emit('servers', []);
      stopSubscriptionValidation(); await core.disconnect(); emit('subscription-revoked', error.message);
    }
  }, 60_000);
}

async function validateSubscriptionAccess() {
  const text = decodeSubscription(await request(SUBSCRIPTION_URL));
  if (!parseServers(text).length) throw new Error('Подписка не содержит поддерживаемых серверов');
}

app.whenReady().then(async () => {
  core = new VpnCore(app.getPath('userData'), process.resourcesPath, emit);
  await core.recover();
  createWindow();
  const settings = loadSettings(); selectedId = settings.selectedId;
  ipcMain.handle('init', async () => {
    const [xrayVersion, loadedServers] = await Promise.all([
      core.version().catch(() => 'неизвестна'),
      refresh(false).then(result => result.servers).catch(e => { emit('error', e.message); return []; })
    ]);
    return { settings, appVersion: app.getVersion(), xrayVersion, servers: loadedServers };
  });
  ipcMain.handle('refresh', () => refresh(false));
  ipcMain.handle('select', (_, id) => { selectedId = id; saveSettings({ ...loadSettings(), selectedId: id }); return true; });
  ipcMain.handle('connect', async (_, id) => {
    const refreshed = await refresh(false, false);
    const server = refreshed.servers.find(s => s.id === id) || refreshed.servers[0];
    if (!server) throw new Error('Сервер не выбран');
    selectedId = server.id; saveSettings({ ...loadSettings(), selectedId });
    const state = await core.connect(server); startSubscriptionValidation(); return state;
  });
  ipcMain.handle('disconnect', () => { stopSubscriptionValidation(); return core.disconnect(); });
  ipcMain.handle('ip', () => core.externalIp());
  ipcMain.handle('open', (_, url) => shell.openExternal(url));
  ipcMain.handle('saveLogs', async () => { const result = await dialog.showSaveDialog(win, { defaultPath: `dadway-vpn-${Date.now()}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] }); if (!result.canceled) fs.writeFileSync(result.filePath, core.logs.join('\n')); return !result.canceled; });
});
app.on('before-quit', e => { stopSubscriptionValidation(); if (core?.proc) { e.preventDefault(); core.disconnect().finally(() => { core.proc = null; app.quit(); }); } });
app.on('window-all-closed', () => app.quit());
