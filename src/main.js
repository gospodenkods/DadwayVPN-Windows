const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { SUBSCRIPTION_URL, SubscriptionAccessError, request, decodeSubscription, parseServers, checkServers, VpnCore } = require('./core');

let win, core, servers = [], selectedId = null, subscriptionValidationTimer = null;
const cacheFile = () => path.join(app.getPath('userData'), 'subscription-zpp.txt');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const logFile = () => path.join(app.getPath('userData'), 'logs', 'dadway-vpn.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024;
function sanitize(value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  return String(text || '')
    .replace(/(vless|vmess|trojan|ss):\/\/[^\s"']+/gi, '$1://[СКРЫТО]')
    .replace(/(\/sub\/[^?#\s]+)[^\s]*/gi, '$1#[СКРЫТО]')
    .replace(/("(?:id|password|publicKey|shortId)"\s*:\s*")[^"]+/gi, '$1[СКРЫТО]');
}
function rotateLog() {
  const file = logFile();
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_LOG_SIZE) return;
    const previous = `${file}.1`; if (fs.existsSync(previous)) fs.unlinkSync(previous); fs.renameSync(file, previous);
  } catch { }
}
function diagnostic(level, event, details) {
  try {
    fs.mkdirSync(path.dirname(logFile()), { recursive: true }); rotateLog();
    const suffix = details === undefined ? '' : ` | ${sanitize(details)}`;
    fs.appendFileSync(logFile(), `${new Date().toISOString()} [${level}] ${event}${suffix}\n`, 'utf8');
  } catch { }
}
function errorDetails(error) { return { name: error?.name, message: error?.message, code: error?.code, statusCode: error?.statusCode, stack: error?.stack }; }
function emit(type, payload) { if (type === 'log') diagnostic('XRAY', 'core.output', payload); win?.webContents.send('vpn:event', { type, payload }); }
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
  const started = Date.now(); diagnostic('INFO', 'subscription.refresh.started', { useCache, allowCacheFallback, cacheExists: fs.existsSync(cacheFile()) });
  let text;
  let fromCache = false;
  try {
    if (useCache && fs.existsSync(cacheFile())) {
      text = fs.readFileSync(cacheFile(), 'utf8'); fromCache = true;
      diagnostic('INFO', 'subscription.cache.loaded', { bytes: Buffer.byteLength(text) });
    } else {
      text = decodeSubscription(await request(SUBSCRIPTION_URL)); fs.writeFileSync(cacheFile(), text);
      diagnostic('INFO', 'subscription.remote.loaded', { bytes: Buffer.byteLength(text) });
    }
  } catch (error) {
    diagnostic('ERROR', 'subscription.refresh.failed', errorDetails(error));
    if (error instanceof SubscriptionAccessError) {
      removeSubscriptionCache(); servers = []; selectedId = null; emit('servers', []); throw error;
    }
    if (!allowCacheFallback || !isTemporarySubscriptionError(error) || !fs.existsSync(cacheFile())) throw error;
    text = fs.readFileSync(cacheFile(), 'utf8'); fromCache = true;
  }
  servers = parseServers(text); if (!servers.length) throw new Error('Подписка не содержит поддерживаемых серверов');
  diagnostic('INFO', 'subscription.parsed', { count: servers.length, protocols: [...new Set(servers.map(server => server.protocol))], fromCache });
  emit('servers', servers); servers = await checkServers(servers); emit('servers', servers); return { servers, fromCache };
}

function createWindow() {
  diagnostic('INFO', 'window.creating', { width: 480, height: 820 });
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
    diagnostic('DEBUG', 'subscription.validation.started');
    try { await validateSubscriptionAccess(); }
    catch (error) {
      if (!(error instanceof SubscriptionAccessError)) return;
      diagnostic('ERROR', 'subscription.validation.revoked', errorDetails(error));
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
  diagnostic('INFO', 'application.started', { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron, userData: app.getPath('userData') });
  core = new VpnCore(app.getPath('userData'), process.resourcesPath, emit);
  await core.recover();
  createWindow();
  const settings = loadSettings(); selectedId = settings.selectedId;
  ipcMain.handle('init', async () => {
    diagnostic('INFO', 'ipc.init');
    const [xrayVersion, loadedServers] = await Promise.all([
      core.version().catch(() => 'неизвестна'),
      refresh(false).then(result => result.servers).catch(e => { emit('error', e.message); return []; })
    ]);
    return { settings, appVersion: app.getVersion(), xrayVersion, servers: loadedServers };
  });
  ipcMain.handle('refresh', () => { diagnostic('INFO', 'ipc.refresh'); return refresh(false); });
  ipcMain.handle('select', (_, id) => { selectedId = id; diagnostic('INFO', 'server.selected', { id }); saveSettings({ ...loadSettings(), selectedId: id }); return true; });
  ipcMain.handle('connect', async (_, id) => {
    diagnostic('INFO', 'connection.requested', { selectedId: id });
    const refreshed = await refresh(false, false);
    const server = refreshed.servers.find(s => s.id === id) || refreshed.servers[0];
    if (!server) throw new Error('Сервер не выбран');
    selectedId = server.id; saveSettings({ ...loadSettings(), selectedId });
    try { const state = await core.connect(server); diagnostic('INFO', 'connection.established', { server: server.name, host: server.host, port: server.port, protocol: server.protocol }); startSubscriptionValidation(); return state; }
    catch (error) { diagnostic('ERROR', 'connection.failed', errorDetails(error)); throw error; }
  });
  ipcMain.handle('disconnect', () => { diagnostic('INFO', 'connection.disconnect.requested'); stopSubscriptionValidation(); return core.disconnect(); });
  ipcMain.handle('ip', async () => { diagnostic('INFO', 'diagnostics.external_ip.requested'); try { const ip = await core.externalIp(); diagnostic('INFO', 'diagnostics.external_ip.completed', { ip }); return ip; } catch (error) { diagnostic('ERROR', 'diagnostics.external_ip.failed', errorDetails(error)); throw error; } });
  ipcMain.handle('open', (_, url) => shell.openExternal(url));
  ipcMain.handle('saveLogs', async () => {
    diagnostic('INFO', 'logs.export.requested');
    const result = await dialog.showSaveDialog(win, { defaultPath: `dadway-vpn-diagnostics-${Date.now()}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] });
    if (!result.canceled) {
      const header = `Dadway VPN ${app.getVersion()} diagnostics\r\nOS: ${process.platform} ${process.arch}\r\nElectron: ${process.versions.electron}\r\nXray secrets and subscription credentials are redacted.\r\n\r\n`;
      const content = fs.existsSync(logFile()) ? fs.readFileSync(logFile(), 'utf8') : '';
      fs.writeFileSync(result.filePath, header + content, 'utf8'); diagnostic('INFO', 'logs.export.completed', { path: result.filePath, bytes: Buffer.byteLength(content) });
    }
    return !result.canceled;
  });
});
process.on('uncaughtException', error => diagnostic('FATAL', 'process.uncaught_exception', errorDetails(error)));
process.on('unhandledRejection', error => diagnostic('FATAL', 'process.unhandled_rejection', errorDetails(error)));
app.on('before-quit', e => { diagnostic('INFO', 'application.before_quit', { xrayRunning: Boolean(core?.proc) }); stopSubscriptionValidation(); if (core?.proc) { e.preventDefault(); core.disconnect().finally(() => { core.proc = null; app.quit(); }); } });
app.on('window-all-closed', () => app.quit());
