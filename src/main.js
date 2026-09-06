const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DEFAULT_SUBSCRIPTION_URL, SubscriptionAccessError, request, decodeSubscription, parseServers, checkServers, VpnCore } = require('./core');

let win, core, servers = [], selectedId = null, validationTimer = null, metricsTimer = null;
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
function sources() { const saved = loadSettings().subscriptions; return Array.isArray(saved) ? saved : [{ id: 'dadway-zpp', url: DEFAULT_SUBSCRIPTION_URL, enabled: true }]; }
function saveSources(value) { saveSettings({ subscriptions: value }); }
function cacheFile(source) { return path.join(cacheDir(), `${source.id.replace(/[^a-z0-9_-]/gi, '_')}.txt`); }
function validUrl(value) { const u = new URL(value.trim()); if (u.protocol !== 'https:' || !u.hostname) throw new Error('Введите корректную HTTPS-ссылку подписки'); return value.trim(); }
function temporary(error) { return !(error instanceof SubscriptionAccessError) && ((!error.statusCode && ['ECONNRESET', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code)) || [408, 425, 429].includes(error.statusCode) || error.statusCode >= 500 || /timeout|время ожидания/i.test(error.message || '')); }

async function loadSource(source, allowCache = true) {
  const file = cacheFile(source); let text, fromCache = false;
  try { text = decodeSubscription(await request(source.url)); const parsed = parseServers(text, source); if (!parsed.length) throw new Error('Подписка не содержит поддерживаемых серверов'); fs.mkdirSync(cacheDir(), { recursive: true }); fs.writeFileSync(file, text); return { servers: parsed, fromCache }; }
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
function createWindow() { win = new BrowserWindow({ width: 500, height: 850, minWidth: 450, minHeight: 720, backgroundColor: '#080e13', title: 'Dadway VPN', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); win.loadFile(path.join(__dirname, 'renderer', 'index.html')); win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; }); }

app.whenReady().then(async () => {
  diagnostic('INFO', 'application.started', { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }); core = new VpnCore(app.getPath('userData'), process.resourcesPath, emit); await core.recover(); createWindow(); selectedId = loadSettings().selectedId;
  ipcMain.handle('init', async () => { const [xrayVersion, loaded] = await Promise.all([core.version().catch(() => 'неизвестна'), refresh(true).then(r => r.servers).catch(e => { emit('error', e.message); return []; })]); return { settings: loadSettings(), subscriptions: sources(), appVersion: app.getVersion(), xrayVersion, servers: loaded }; });
  ipcMain.handle('refresh', () => refresh(true));
  ipcMain.handle('select', (_, id) => { selectedId = id; saveSettings({ selectedId: id }); return true; });
  ipcMain.handle('settings', (_, patch) => saveSettings(patch));
  ipcMain.handle('subscriptions', () => sources());
  ipcMain.handle('subscription:add', (_, value) => { const url = validUrl(value), current = sources(); if (current.some(s => s.url.toLowerCase() === url.toLowerCase())) throw new Error('Такая подписка уже добавлена'); const item = { id: crypto.randomUUID(), url, enabled: true }; saveSources([...current, item]); return sources(); });
  ipcMain.handle('subscription:toggle', (_, id, enabled) => { saveSources(sources().map(s => s.id === id ? { ...s, enabled: Boolean(enabled) } : s)); return sources(); });
  ipcMain.handle('subscription:remove', (_, id) => { const item = sources().find(s => s.id === id), file = item && cacheFile(item); saveSources(sources().filter(s => s.id !== id)); if (file && fs.existsSync(file)) fs.unlinkSync(file); if (selectedId?.startsWith(`${id}|`)) { selectedId = null; saveSettings({ selectedId: null }); } return sources(); });
  ipcMain.handle('connect', async (_, id, mode) => { diagnostic('INFO', 'connection.requested', { selectedId: id, mode }); const fresh = await refresh(false), server = fresh.servers.find(s => s.id === id) || fresh.servers[0]; if (!server) throw new Error('Сервер не выбран'); selectedId = server.id; saveSettings({ selectedId, connectionMode: mode }); try { const state = await core.connect(server, mode); startTimers(server); diagnostic('INFO', 'connection.established', { server: server.name, protocol: server.protocol, mode }); return state; } catch (e) { diagnostic('ERROR', 'connection.failed', errorDetails(e)); throw e; } });
  ipcMain.handle('disconnect', () => { stopTimers(); return core.disconnect(); });
  ipcMain.handle('test', async () => { try { const value = await core.connectionTest(); diagnostic('INFO', 'connection.test.completed', value); return value; } catch (e) { diagnostic('ERROR', 'connection.test.failed', errorDetails(e)); throw e; } });
  ipcMain.handle('open', (_, url) => shell.openExternal(url));
  ipcMain.handle('saveLogs', async () => { const result = await dialog.showSaveDialog(win, { defaultPath: `dadway-vpn-diagnostics-${Date.now()}.txt`, filters: [{ name: 'Текст', extensions: ['txt'] }] }); if (!result.canceled) { const header = `Dadway VPN ${app.getVersion()} diagnostics\r\nOS: ${process.platform} ${process.arch}\r\nElectron: ${process.versions.electron}\r\nXray secrets and subscription credentials are redacted.\r\n\r\n`; fs.writeFileSync(result.filePath, header + (fs.existsSync(logFile()) ? fs.readFileSync(logFile(), 'utf8') : '')); } return !result.canceled; });
});
process.on('uncaughtException', e => diagnostic('FATAL', 'process.uncaught_exception', errorDetails(e))); process.on('unhandledRejection', e => diagnostic('FATAL', 'process.unhandled_rejection', errorDetails(e)));
app.on('before-quit', e => { stopTimers(); if (core?.proc) { e.preventDefault(); core.disconnect().finally(() => app.quit()); } }); app.on('window-all-closed', () => app.quit());
