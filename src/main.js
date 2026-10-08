const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SubscriptionAccessError, request, decodeSubscription, parseServers, checkServers, measureLatency, VpnCore } = require('./core');

let win, tray, core, servers = [], selectedId = null, validationTimer = null, metricsTimer = null, isQuitting = false, shutdownStarted = false;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const cacheDir = () => path.join(app.getPath('userData'), 'subscriptions');
const logFile = () => path.join(app.getPath('userData'), 'logs', 'dadway-vpn.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024;
function sanitize(value) { return String(typeof value === 'string' ? value : JSON.stringify(value) || '').replace(/(vless|vmess|trojan|ss):\/\/[^\s"']+/gi, '$1://[СКРЫТО]').replace(/(https:\/\/[^\s?#]+\/sub\/)[^\s"']+/gi, '$1[СКРЫТО]').replace(/("(?:id|password|publicKey|shortId)"\s*:\s*")[^"]+/gi, '$1[СКРЫТО]'); }
function diagnostic(level, event, details) { try { const file = logFile(); fs.mkdirSync(path.dirname(file), { recursive: true }); if (fs.existsSync(file) && fs.statSync(file).size >= MAX_LOG_SIZE) { if (fs.existsSync(`${file}.1`)) fs.unlinkSync(`${file}.1`); fs.renameSync(file, `${file}.1`); } fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${event}${details === undefined ? '' : ` | ${sanitize(details)}`}\n`); } catch {} }
function errorDetails(e) { return { name: e?.name, message: e?.message, code: e?.code, statusCode: e?.statusCode, stack: e?.stack }; }
function emit(type, payload) { if (type === 'log') diagnostic('XRAY', 'core.output', payload); win?.webContents.send('vpn:event', { type, payload }); }
function loadSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function saveSettings(patch) { const value = { ...loadSettings(), ...patch }; fs.writeFileSync(settingsFile(), JSON.stringify(value, null, 2)); return value; }
function sources() { const saved = loadSettings().subscriptions; return Array.isArray(saved) ? saved : []; }
function saveSources(value) { saveSettings({ subscriptions: value }); }
function cacheFile(source) { return path.join(cacheDir(), `${source.id.replace(/[^a-z0-9_-]/gi, '_')}.txt`); }
function validUrl(value) { const u = new URL(value.trim()); if (u.protocol !== 'https:' || !u.hostname) throw new Error('Введите корректную HTTPS-ссылку подписки'); return value.trim(); }
function temporary(error) { return !(error instanceof SubscriptionAccessError) && ((!error.statusCode && ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)) || [408, 425, 429].includes(error.statusCode) || error.statusCode >= 500 || /timeout|время ожидания/i.test(error.message || '')); }
function subscriptionHwid() { const file = path.join(app.getPath('userData'), 'subscription-device-id'); let seed; try { seed = fs.readFileSync(file, 'utf8').trim(); if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seed)) throw new Error('invalid installation id'); } catch { seed = crypto.randomUUID(); fs.writeFileSync(file, seed, { mode: 0o600 }); } return crypto.createHash('sha256').update(`DadwayVPN-HWID-v1:ru.dadway.vpn.windows:${seed}`).digest('hex'); }
function migrateSettings() { const settings = loadSettings(); if (settings.subscriptionDefaultsVersion >= 2) return; const subscriptions = Array.isArray(settings.subscriptions) ? settings.subscriptions.filter(source => source.id !== 'dadway-zpp') : []; saveSettings({ subscriptions, subscriptionDefaultsVersion: 2, ...(settings.selectedId?.startsWith('dadway-zpp|') ? { selectedId: null } : {}) }); }

async function loadSource(source, allowCache = true) {
  const file = cacheFile(source); let text, fromCache = false;
  try { text = decodeSubscription(await request(source.url, { headers: { 'X-HWID': subscriptionHwid() }, sensitiveHeaders: ['X-HWID'] })); const parsed = parseServers(text, source); if (!parsed.length) throw new Error('Подписка не содержит поддерживаемых серверов'); fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(file, text); return { servers: parsed, fromCache }; }
  catch (error) { diagnostic('ERROR', 'subscription.source.failed', { sourceId: source.id, ...errorDetails(error) }); if (error instanceof SubscriptionAccessError) { if (fs.existsSync(file)) fs.unlinkSync(file); throw error; } if (!allowCache || !temporary(error) || !fs.existsSync(file)) throw error; text = fs.readFileSync(file, 'utf8'); fromCache = true; return { servers: parseServers(text, source), fromCache }; }
}
async function refresh(allowCache = true) {
  const active = sources().filter(s => s.enabled); if (!active.length) { servers = []; emit('servers', []); return { servers, fromCache: false, errors: [] }; }
  const results = await Promise.allSettled(active.map(s => loadSource(s, allowCache))); const errors = [], combined = []; let fromCache = false;
  results.forEach((result, i) => { if (result.status === 'fulfilled') { combined.push(...result.value.servers); fromCache ||= result.value.fromCache; } else errors.push({ sourceId: active[i].id, message: result.reason.message, statusCode: result.reason.statusCode }); });
  if (!combined.length) { servers = []; emit('servers', []); const e = results.find(r => r.status === 'rejected')?.reason; throw e || new Error('Нет доступных подписок'); }
  servers = combined; emit('servers', servers); servers = await checkServers(servers); emit('servers', servers); diagnostic('INFO', 'subscription.refresh.completed', { sources: active.length, servers: servers.length, errors }); return { servers, fromCache, errors };
}
function stopTimers() { if (validationTimer) clearInterval(validationTimer); if (metricsTimer) clearInterval(metricsTimer); validationTimer = metricsTimer = null; }
function startTimers(server) { stopTimers(); validationTimer = setInterval(async () => { const source = sources().find(s => s.id === server.subscriptionId && s.enabled); if (!source) { await core.disconnect(); stopTimers(); return emit('subscription-revoked', 'Подписка отключена или удалена'); } try { await loadSource(source, false); } catch (e) { if (e instanceof SubscriptionAccessError) { await core.disconnect(); stopTimers(); emit('subscription-revoked', e.message); } } }, 60000); metricsTimer = setInterval(() => core.metrics().then(v => emit('metrics', v)).catch(() => {}), 1000); }
function showWindow() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function updateTray() { if (!tray) return; const connected = Boolean(core?.proc); tray.setToolTip(`Dadway VPN — ${connected ? 'подключён' : 'отключён'}`); tray.setContextMenu(Menu.buildFromTemplate([
  { label: connected ? '● VPN подключён' : '○ VPN отключён', enabled: false },
  { label: 'Открыть Dadway VPN', click: showWindow },
  ...(connected ? [{ label: 'Отключить VPN', click: async () => { stopTimers(); await core.disconnect(); updateTray(); emit('disconnected', { reason: 'tray' }); } }] : []),
  { type: 'separator' }, { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }
])); }
function createTray() { const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'design-assets', 'launcher_icon_smooth-v4-source.png')).resize({ width: 20, height: 20 }); tray = new Tray(icon); tray.on('click', showWindow); tray.on('double-click', showWindow); updateTray(); }
function createWindow() { win = new BrowserWindow({ width: 500, height: 850, minWidth: 450, minHeight: 720, backgroundColor: '#080e13', title: 'Dadway VPN', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); win.loadFile(path.join(__dirname, 'renderer', 'index.html')); win.once('ready-to-show', () => win.show()); win.on('minimize', event => { event.preventDefault(); win.hide(); diagnostic('INFO', 'window.hidden_to_tray', { action: 'minimize' }); }); win.on('close', event => { if (!isQuitting) { event.preventDefault(); win.hide(); diagnostic('INFO', 'window.hidden_to_tray', { action: 'close' }); } }); win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; }); }

async function connectVpn(id, mode) { diagnostic('INFO', 'connection.requested', { selectedId: id, mode }); const fresh = await refresh(false), server = fresh.servers.find(s => s.id === id) || fresh.servers[0]; if (!server) throw new Error('Сервер не выбран'); selectedId = server.id; saveSettings({ selectedId, connectionMode: mode }); try { const pingMs = await measureLatency(server.host, server.port, 3); const state = await core.connect(server, mode); startTimers(server); updateTray(); diagnostic('INFO', 'connection.established', { server: server.name, protocol: server.protocol, mode, pingMs }); return { ...state, pingMs }; } catch (e) { updateTray(); diagnostic('ERROR', 'connection.failed', errorDetails(e)); throw e; } }

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else app.on('second-instance', showWindow);

app.whenReady().then(async () => {
  if (!gotLock) return;
  diagnostic('INFO', 'application.started', { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }); migrateSettings(); core = new VpnCore(app.getPath('userData'), process.resourcesPath, emit); await core.recover(); createWindow(); createTray(); selectedId = loadSettings().selectedId;
  ipcMain.handle('init', async () => { const [xrayVersion, loaded] = await Promise.all([core.version().catch(() => 'неизвестна'), refresh(true).then(r => r.servers).catch(e => { emit('error', e.message); return []; })]); return { settings: loadSettings(), subscriptions: sources(), appVersion: app.getVersion(), xrayVersion, servers: loaded }; });
  ipcMain.handle('refresh', () => refresh(true));
  ipcMain.handle('select', (_, id) => { selectedId = id; saveSettings({ selectedId: id }); return true; });
  ipcMain.handle('settings', (_, patch) => saveSettings(patch));
  ipcMain.handle('subscriptions', () => sources());
  ipcMain.handle('subscription:add', (_, value) => { const url = validUrl(value), current = sources(); if (current.some(s => s.url.toLowerCase() === url.toLowerCase())) throw new Error('Такая подписка уже добавлена'); const item = { id: crypto.randomUUID(), url, enabled: true }; saveSources([...current, item]); return sources(); });
  ipcMain.handle('subscription:toggle', (_, id, enabled) => { saveSources(sources().map(s => s.id === id ? { ...s, enabled: Boolean(enabled) } : s)); return sources(); });
  ipcMain.handle('subscription:remove', (_, id) => { const item = sources().find(s => s.id === id), file = item && cacheFile(item); saveSources(sources().filter(s => s.id !== id)); if (file && fs.existsSync(file)) fs.unlinkSync(file); if (selectedId?.startsWith(`${id}|`)) { selectedId = null; saveSettings({ selectedId: null }); } return sources(); });
  ipcMain.handle('connect', (_, id, mode) => connectVpn(id, mode));
  ipcMain.handle('disconnect', async () => { stopTimers(); await core.disconnect(); updateTray(); });
  ipcMain.handle('test', async () => { try { const value = await core.connectionTest(); diagnostic('INFO', 'connection.test.completed', value); return value; } catch (e) { diagnostic('ERROR', 'connection.test.failed', errorDetails(e)); throw e; } });
  ipcMain.handle('open', (_, url) => shell.openExternal(url));
  ipcMain.handle('saveLogs', async () => { const result = await dialog.showSaveDialog(win, { defaultPath: `dadway-vpn-diagnostics-${Date.now()}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] }); if (!result.canceled) { const header = `Dadway VPN ${app.getVersion()} diagnostics\r\nOS: ${process.platform} ${process.arch}\r\nElectron: ${process.versions.electron}\r\nXray secrets and subscription credentials are redacted.\r\n\r\n`; fs.writeFileSync(result.filePath, header + (fs.existsSync(logFile()) ? fs.readFileSync(logFile(), 'utf8') : '')); } return !result.canceled; });
});
process.on('uncaughtException', e => diagnostic('FATAL', 'process.uncaught_exception', errorDetails(e))); process.on('unhandledRejection', e => diagnostic('FATAL', 'process.unhandled_rejection', errorDetails(e)));
app.on('activate', showWindow);
app.on('before-quit', e => { isQuitting = true; stopTimers(); if (core?.proc && !shutdownStarted) { e.preventDefault(); shutdownStarted = true; core.disconnect().finally(() => app.quit()); } });
app.on('window-all-closed', () => { /* Tray keeps the application alive. */ });
