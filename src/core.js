const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const DEFAULT_SUBSCRIPTION_URL = 'https://devel.dadway.ru/sub/zpp#dadway.ru';
const SOCKS_PORT = 10808, HTTP_PORT = 10809, METRICS_PORT = 49227;
const ACCESS_DENIED_STATUSES = new Set([401, 403, 404, 410]);

class SubscriptionAccessError extends Error {
  constructor(statusCode) {
    const messages = { 403: 'Доступ к подписке запрещён', 404: 'Подписка отключена', 410: 'Срок действия подписки истёк' };
    super(messages[statusCode] || `Подписка недоступна (HTTP ${statusCode})`);
    this.name = 'SubscriptionAccessError'; this.statusCode = statusCode;
  }
}
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https:') ? https : http).get(url, { headers: { 'User-Agent': 'DadwayVPN/8.5.6 Windows', Accept: 'text/plain, */*', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, timeout: 20000, ...options }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve(request(new URL(res.headers.location, url).href, options)); }
      if (ACCESS_DENIED_STATUSES.has(res.statusCode)) { res.resume(); return reject(new SubscriptionAccessError(res.statusCode)); }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); const e = new Error(`HTTP ${res.statusCode}`); e.statusCode = res.statusCode; return reject(e); }
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания'))); req.on('error', reject);
  });
}
function decodeSubscription(raw) { const text = raw.toString('utf8').trim(); if (text.includes('://')) return text; try { return Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8').trim(); } catch { return text; } }
function sourceTitle(value) { try { const u = new URL(value); const p = u.pathname.split('/').filter(Boolean); return `${u.hostname}/${p.slice(0, 2).join('/')}${p.length > 2 ? '/…' : ''}`; } catch { return value; } }
function parseServers(text, source = null) {
  const seen = new Set();
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => /^(vless|vmess|trojan|ss):\/\//i.test(s)).map(link => {
    try {
      let name = '', host = '', port = 0; const protocol = link.split(':')[0].toLowerCase();
      if (protocol === 'vmess') { const data = JSON.parse(Buffer.from(link.slice(8).split('#')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); name = data.ps || data.add; host = data.add; port = Number(data.port); }
      else { const u = new URL(link); name = decodeURIComponent(u.hash.slice(1)) || u.hostname; host = u.hostname; port = Number(u.port || (protocol === 'trojan' ? 443 : 0)); }
      if (!host || !port) return null;
      const low = name.toLowerCase(); const country = /россия|russia|🇷🇺|(?:^|\s)ru(?:\s|$)/.test(low) ? 'ru' : /германия|germany|🇩🇪|(?:^|[-_\s])(?:de|ge)\s*(?:№|#)?\s*\d+$/.test(low) ? 'de' : /сша|usa|united states|🇺🇸|(?:^|\s)us(?:\s|$)/.test(low) ? 'us' : /нидерланд|netherlands|holland|🇳🇱|(?:^|\s)nl(?:\s|$)/.test(low) ? 'nl' : /великобритания|united kingdom|great britain|🇬🇧|(?:^|\s)(?:uk|gb)(?:\s|$)/.test(low) ? 'gb' : 'unknown';
      const legacyId = `${host}:${port}:${name.toLowerCase()}`, id = source ? `${source.id}|${legacyId}` : legacyId; if (seen.has(id)) return null; seen.add(id);
      return { id, legacyId, name, link, host, port, protocol, country, subscriptionId: source?.id || null, subscriptionTitle: source ? sourceTitle(source.url) : null, latency: null, available: null };
    } catch { return null; }
  }).filter(Boolean);
}
function tcpPing(host, port, timeout = 3500) { return new Promise(resolve => { const start = Date.now(), socket = net.createConnection({ host, port }); let settled = false; const done = ok => { if (settled) return; settled = true; socket.destroy(); resolve(ok ? Date.now() - start : null); }; socket.setTimeout(timeout); socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false)); }); }
async function checkServers(servers) { return Promise.all(servers.map(async s => { const latency = await tcpPing(s.host, s.port); return { ...s, latency, available: latency !== null }; })); }
function parseQuery(u) { return Object.fromEntries([...u.searchParams.entries()].map(([k, v]) => [k.toLowerCase(), v])); }
function streamSettings(q) {
  const network = q.type || q.net || 'tcp', security = q.security || (q.tls === 'tls' ? 'tls' : 'none'), s = { network, security };
  if (security === 'tls') s.tlsSettings = { serverName: q.sni || q.host || '', fingerprint: q.fp || 'chrome', allowInsecure: q.allowinsecure === '1' };
  if (security === 'reality') { if (!(q.sni || q.servername) || !q.pbk) throw new Error('В конфигурации REALITY отсутствуют SNI или publicKey'); s.realitySettings = { serverName: q.sni || q.servername, fingerprint: !q.fp || q.fp.toLowerCase() === 'chrome' ? 'safari' : q.fp, publicKey: q.pbk, shortId: q.sid || '', spiderX: q.spx || '', ...(q.pqv ? { mldsa65Verify: q.pqv } : {}) }; }
  if (network === 'ws') s.wsSettings = { path: q.path || '/', headers: q.host ? { Host: q.host } : {} };
  if (network === 'grpc') s.grpcSettings = { serviceName: q.servicename || q.path || '' };
  if (network === 'xhttp') s.xhttpSettings = { path: q.path || '/', ...(q.mode ? { mode: q.mode } : {}), ...(q.host ? { host: q.host } : {}) };
  return s;
}
function outboundFromLink(link) {
  const protocol = link.split(':')[0].toLowerCase();
  if (protocol === 'vmess') { const d = JSON.parse(Buffer.from(link.slice(8).split('#')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')); return { tag: 'proxy', protocol: 'vmess', settings: { vnext: [{ address: d.add, port: Number(d.port), users: [{ id: d.id, alterId: Number(d.aid || 0), security: d.scy || 'auto' }] }] }, streamSettings: streamSettings({ type: d.net, security: d.tls, sni: d.sni, host: d.host, path: d.path, fp: d.fp }) }; }
  const u = new URL(link), q = parseQuery(u), address = u.hostname, port = Number(u.port || 443), password = decodeURIComponent(u.username);
  if (protocol === 'vless') return { tag: 'proxy', protocol, settings: { vnext: [{ address, port, users: [{ id: password, encryption: q.encryption || 'none', ...(q.flow ? { flow: q.flow } : {}) }] }] }, streamSettings: streamSettings(q) };
  if (protocol === 'trojan') return { tag: 'proxy', protocol, settings: { servers: [{ address, port, password }] }, streamSettings: streamSettings(q) };
  if (protocol === 'ss') { let c = password; if (!c.includes(':')) c = Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); const i = c.indexOf(':'); if (i < 1) throw new Error('Некорректная ссылка Shadowsocks'); return { tag: 'proxy', protocol: 'shadowsocks', settings: { servers: [{ address, port, method: c.slice(0, i), password: c.slice(i + 1) }] } }; }
  throw new Error(`Протокол ${protocol} не поддерживается`);
}
function buildConfig(link, mode = 'proxy') {
  const inbounds = [{ tag: 'socks-in', listen: '127.0.0.1', port: SOCKS_PORT, protocol: 'socks', settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true } }, { tag: 'http-in', listen: '127.0.0.1', port: HTTP_PORT, protocol: 'http', settings: {}, sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: true } }];
  if (mode === 'tun') inbounds.unshift({ tag: 'tun-in', protocol: 'tun', settings: { name: 'Dadway', desc: 'Dadway VPN', mtu: 1500, gateway: ['10.88.0.1/16'], dns: ['1.1.1.1'], autoSystemRoutingTable: ['0.0.0.0/0'], autoOutboundsInterface: 'auto' }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true } });
  return { log: { loglevel: 'warning' }, inbounds, outbounds: [outboundFromLink(link), { tag: 'direct', protocol: 'freedom', settings: {} }, { tag: 'block', protocol: 'blackhole', settings: {} }], dns: { servers: ['1.1.1.1', '8.8.8.8'] }, routing: { domainStrategy: 'IPIfNonMatch', rules: [{ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' }, { type: 'field', domain: ['domain:ru', 'domain:by', 'domain:su'], outboundTag: 'direct' }, { type: 'field', inboundTag: mode === 'tun' ? ['tun-in', 'socks-in', 'http-in'] : ['socks-in', 'http-in'], outboundTag: 'proxy' }] }, metrics: { listen: `127.0.0.1:${METRICS_PORT}` }, stats: {}, policy: { system: { statsInboundDownlink: true, statsInboundUplink: true, statsOutboundDownlink: true, statsOutboundUplink: true } } };
}
async function readRegistryValue(key, name) { try { const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name]); const line = stdout.split(/\r?\n/).find(v => v.trim().toLowerCase().startsWith(name.toLowerCase())); const m = line?.trim().match(/^\S+\s+(REG_\S+)\s+(.*)$/i); return m ? { type: m[1], value: m[2].trim() } : null; } catch { return null; } }
async function writeRegistryValue(key, name, entry) { if (!entry) return execFileAsync('reg.exe', ['delete', key, '/v', name, '/f']).catch(() => {}); const value = entry.type === 'REG_DWORD' && /^0x/i.test(entry.value) ? String(parseInt(entry.value, 16)) : entry.value; await execFileAsync('reg.exe', ['add', key, '/v', name, '/t', entry.type, '/d', value, '/f']); }
async function notifyProxyChanged() { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'; [Win32.NativeMethods]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null; [Win32.NativeMethods]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null"]).catch(() => {}); }
async function enableSystemProxy(file) { const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'; if (!fs.existsSync(file)) { const snapshot = {}; for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) snapshot[name] = await readRegistryValue(key, name); fs.writeFileSync(file, JSON.stringify(snapshot)); } await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']); await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `http=127.0.0.1:${HTTP_PORT};https=127.0.0.1:${HTTP_PORT}`, '/f']); await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', '<local>', '/f']); await notifyProxyChanged(); }
async function restoreSystemProxy(file) { if (!fs.existsSync(file)) return; const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', snapshot = JSON.parse(fs.readFileSync(file, 'utf8')); for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) await writeRegistryValue(key, name, snapshot[name]); fs.unlinkSync(file); await notifyProxyChanged(); }
function waitForEndpoint(host, port, timeout = 10000) { const deadline = Date.now() + timeout; return new Promise((resolve, reject) => { const poll = () => { const socket = net.createConnection({ host, port }); let done = false; const finish = ok => { if (done) return; done = true; socket.destroy(); if (ok) resolve(); else if (Date.now() >= deadline) reject(new Error(`Локальный SOCKS-прокси ${host}:${port} не запустился за 10 секунд`)); else setTimeout(poll, 200); }; socket.setTimeout(250); socket.once('connect', () => finish(true)); socket.once('timeout', () => finish(false)); socket.once('error', () => finish(false)); }; poll(); }); }
async function isAdministrator() { try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "if (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 } else { exit 1 }"]); return true; } catch { return false; } }

class VpnCore {
  constructor(userData, resourcesPath, onEvent) { this.userData = userData; this.resourcesPath = resourcesPath; this.onEvent = onEvent; this.proc = null; this.startedAt = 0; this.stopping = false; this.connecting = null; this.mode = 'proxy'; }
  log(message) { this.onEvent?.('log', `[${new Date().toLocaleString('ru-RU')}] ${message}`); }
  get bundledXrayPath() { return path.join(this.resourcesPath, 'runtime', 'xray.exe'); } get downloadedXrayPath() { return path.join(this.userData, 'runtime', 'xray.exe'); } get xrayPath() { return fs.existsSync(this.bundledXrayPath) ? this.bundledXrayPath : this.downloadedXrayPath; } get proxySnapshotPath() { return path.join(this.userData, 'proxy-state.json'); } get configPath() { return path.join(this.userData, 'config.json'); }
  async version() { await this.ensureXray(); const { stdout } = await execFileAsync(this.xrayPath, ['version'], { windowsHide: true }); return stdout.match(/^Xray\s+([^\s]+)/m)?.[1] || 'неизвестна'; }
  async recover() { await restoreSystemProxy(this.proxySnapshotPath).catch(e => this.log(`Не удалось восстановить системный прокси: ${e.message}`)); }
  async ensureXray() { if (fs.existsSync(this.bundledXrayPath) || fs.existsSync(this.downloadedXrayPath)) return; fs.mkdirSync(path.dirname(this.downloadedXrayPath), { recursive: true }); const api = JSON.parse((await request('https://api.github.com/repos/XTLS/Xray-core/releases/latest')).toString()), asset = api.assets.find(a => a.name === 'Xray-windows-64.zip'); if (!asset) throw new Error('Архив Xray для Windows не найден'); const zip = path.join(this.userData, 'xray.zip'); fs.writeFileSync(zip, await request(asset.browser_download_url)); await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${path.dirname(this.downloadedXrayPath).replaceAll("'", "''")}' -Force`]); fs.unlinkSync(zip); }
  async connect(server, mode = 'proxy') { if (this.connecting) return this.connecting; this.connecting = this._connect(server, mode).finally(() => { this.connecting = null; }); return this.connecting; }
  async _connect(server, mode) { await this.disconnect(); await this.ensureXray(); if (!['proxy', 'tun'].includes(mode)) throw new Error('Неизвестный режим подключения'); if (mode === 'tun') { if (!(await isAdministrator())) { const e = new Error('Для режима TUN запустите Dadway VPN от имени администратора'); e.code = 'TUN_ADMIN_REQUIRED'; throw e; } if (!fs.existsSync(path.join(path.dirname(this.xrayPath), 'wintun.dll'))) throw new Error('Компонент wintun.dll не найден. Переустановите приложение.'); }
    this.mode = mode; fs.writeFileSync(this.configPath, JSON.stringify(buildConfig(server.link, mode), null, 2)); await execFileAsync(this.xrayPath, ['run', '-test', '-c', this.configPath], { windowsHide: true, cwd: path.dirname(this.xrayPath) });
    this.proc = spawn(this.xrayPath, ['run', '-c', this.configPath], { windowsHide: true, cwd: path.dirname(this.xrayPath) }); this.startedAt = Date.now(); this.stopping = false; this.proc.stdout.on('data', d => this.log(d.toString().trim())); this.proc.stderr.on('data', d => this.log(d.toString().trim())); this.proc.once('exit', code => { const unexpected = !this.stopping && this.startedAt > 0; this.proc = null; this.startedAt = 0; if (unexpected) { this.log(`Xray неожиданно завершился с кодом ${code}`); restoreSystemProxy(this.proxySnapshotPath).finally(() => this.onEvent?.('disconnected', { reason: 'xray-exit', code })); } });
    try { await waitForEndpoint('127.0.0.1', SOCKS_PORT); if (mode === 'proxy') await enableSystemProxy(this.proxySnapshotPath); return { connected: true, startedAt: this.startedAt, mode }; } catch (e) { await this.disconnect(); throw e; }
  }
  async disconnect() { this.stopping = true; await restoreSystemProxy(this.proxySnapshotPath).catch(() => {}); if (this.proc) { const proc = this.proc; this.proc = null; proc.kill(); this.log('VPN отключён'); } this.startedAt = 0; if (fs.existsSync(this.configPath)) fs.unlinkSync(this.configPath); }
  async connectionTest() { let failure; for (let i = 0; i < 3; i++) { try { const start = Date.now(), ip = await execFileAsync('curl.exe', ['--silent', '--show-error', '--fail', '--max-time', '12', '--proxy', `socks5h://127.0.0.1:${SOCKS_PORT}`, 'https://api.ipify.org']); const pingMs = Date.now() - start, speed = await execFileAsync('curl.exe', ['--silent', '--show-error', '--fail', '--max-time', '20', '--proxy', `socks5h://127.0.0.1:${SOCKS_PORT}`, '--output', 'NUL', '--write-out', '%{speed_download}', 'https://speed.cloudflare.com/__down?bytes=1000000']); return { ip: ip.stdout.trim(), pingMs, bytesPerSecond: Math.round(Number(speed.stdout) || 0) }; } catch (e) { failure = e; if (i < 2) await new Promise(r => setTimeout(r, 800)); } } throw failure; }
  async metrics() { const data = JSON.parse((await request(`http://127.0.0.1:${METRICS_PORT}/debug/vars`)).toString()); let down = 0, up = 0; const walk = (v, key = '') => { if (v && typeof v === 'object') for (const [k, child] of Object.entries(v)) walk(child, k); else if (typeof v === 'number') { if (/downlink/i.test(key)) down += v; if (/uplink/i.test(key)) up += v; } }; walk(data); return { down, up }; }
}
module.exports = { DEFAULT_SUBSCRIPTION_URL, SubscriptionAccessError, request, decodeSubscription, sourceTitle, parseServers, checkServers, outboundFromLink, buildConfig, waitForEndpoint, isAdministrator, VpnCore, SOCKS_PORT, HTTP_PORT, METRICS_PORT };
