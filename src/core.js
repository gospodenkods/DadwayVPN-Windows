const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const https = require('node:https');
const http = require('node:http');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);

const SUBSCRIPTION_URL = 'https://devel.dadway.ru/sub/promo#https%3A%2F%2Fdadway.ru';
const SOCKS_PORT = 10808;
const HTTP_PORT = 10809;
const ACCESS_DENIED_STATUSES = new Set([401, 403, 404, 410]);

class SubscriptionAccessError extends Error {
  constructor(statusCode) {
    const messages = {
      403: 'Доступ к подписке запрещён',
      404: 'Подписка отключена',
      410: 'Срок действия подписки истёк'
    };
    super(messages[statusCode] || `Подписка недоступна (HTTP ${statusCode})`);
    this.name = 'SubscriptionAccessError';
    this.statusCode = statusCode;
  }
}

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: {
      'User-Agent': 'DadwayVPN/1.1 Windows',
      Accept: 'text/plain, */*',
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache'
    }, timeout: 20000, ...options }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return resolve(request(new URL(res.headers.location, url).href, options));
      }
      if (ACCESS_DENIED_STATUSES.has(res.statusCode)) {
        res.resume(); return reject(new SubscriptionAccessError(res.statusCode));
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume(); const error = new Error(`HTTP ${res.statusCode}`); error.statusCode = res.statusCode; return reject(error);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('Превышено время ожидания')));
    req.on('error', reject);
  });
}

function decodeSubscription(raw) {
  const text = raw.toString('utf8').trim();
  if (text.includes('://')) return text;
  try { return Buffer.from(text.replace(/\s/g, ''), 'base64').toString('utf8').trim(); } catch { return text; }
}

function parseServers(text) {
  return text.split(/\r?\n/).map(s => s.trim()).filter(s => /^(vless|vmess|trojan|ss):\/\//i.test(s)).map((link, index) => {
    try {
      let name = '', host = '', port = 0, protocol = link.split(':')[0].toLowerCase();
      if (protocol === 'vmess') {
        const raw = link.slice(8).split('#')[0];
        const data = JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        name = data.ps || data.add; host = data.add; port = Number(data.port);
      } else {
        const u = new URL(link); name = decodeURIComponent(u.hash.slice(1)) || u.hostname; host = u.hostname; port = Number(u.port || (protocol === 'trojan' ? 443 : 0));
      }
      if (!host || !port) return null;
      const low = name.toLowerCase();
      const country = /россия|russia|🇷🇺|\bru\b/.test(low) ? 'ru' : /германия|germany|🇩🇪|\bde\b/.test(low) ? 'de' : /сша|usa|united states|🇺🇸|\bus\b/.test(low) ? 'us' : /нидерланд|netherlands|holland|🇳🇱|\bnl\b/.test(low) ? 'nl' : 'unknown';
      return { id: `${host}:${port}:${index}`, name, link, host, port, protocol, country, latency: null, available: null };
    } catch { return null; }
  }).filter(Boolean);
}

function tcpPing(host, port, timeout = 3500) {
  return new Promise(resolve => {
    const start = Date.now(); const socket = net.createConnection({ host, port });
    const done = ok => { socket.destroy(); resolve(ok ? Date.now() - start : null); };
    socket.setTimeout(timeout); socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false));
  });
}

async function checkServers(servers) {
  return Promise.all(servers.map(async s => { const latency = await tcpPing(s.host, s.port); return { ...s, latency, available: latency !== null }; }));
}

function parseQuery(u) { return Object.fromEntries(u.searchParams.entries()); }
function streamSettings(q) {
  const network = q.type || 'tcp'; const security = q.security || (q.tls === 'tls' ? 'tls' : 'none');
  const s = { network, security };
  if (security === 'tls') s.tlsSettings = { serverName: q.sni || q.host || '', fingerprint: q.fp || 'chrome', allowInsecure: q.allowInsecure === '1' };
  if (security === 'reality') s.realitySettings = { serverName: q.sni || q.serverName || '', fingerprint: !q.fp || q.fp.toLowerCase() === 'chrome' ? 'safari' : q.fp, publicKey: q.pbk || '', shortId: q.sid || '', spiderX: q.spx || '' };
  if (network === 'ws') s.wsSettings = { path: q.path || '/', headers: q.host ? { Host: q.host } : {} };
  if (network === 'grpc') s.grpcSettings = { serviceName: q.serviceName || q.path || '' };
  if (network === 'xhttp') s.xhttpSettings = { path: q.path || '/', mode: q.mode || 'auto', host: q.host || '' };
  return s;
}

function outboundFromLink(link) {
  const protocol = link.split(':')[0].toLowerCase();
  if (protocol === 'vmess') {
    const data = JSON.parse(Buffer.from(link.slice(8).split('#')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const q = { type: data.net, security: data.tls, sni: data.sni, host: data.host, path: data.path, fp: data.fp };
    return { tag: 'proxy', protocol: 'vmess', settings: { vnext: [{ address: data.add, port: Number(data.port), users: [{ id: data.id, alterId: Number(data.aid || 0), security: data.scy || 'auto' }] }] }, streamSettings: streamSettings(q) };
  }
  const u = new URL(link); const q = parseQuery(u); const address = u.hostname; const port = Number(u.port || 443); const password = decodeURIComponent(u.username);
  if (protocol === 'vless') return { tag: 'proxy', protocol, settings: { vnext: [{ address, port, users: [{ id: password, encryption: q.encryption || 'none', flow: q.flow || '' }] }] }, streamSettings: streamSettings(q) };
  if (protocol === 'trojan') return { tag: 'proxy', protocol, settings: { servers: [{ address, port, password }] }, streamSettings: streamSettings(q) };
  if (protocol === 'ss') {
    let credentials = password;
    if (!credentials.includes(':')) credentials = Buffer.from(credentials.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const [method, pass] = credentials.split(':'); return { tag: 'proxy', protocol: 'shadowsocks', settings: { servers: [{ address, port, method, password: pass }] } };
  }
  throw new Error(`Протокол ${protocol} не поддерживается`);
}

function buildConfig(link) {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      { tag: 'socks-in', listen: '127.0.0.1', port: SOCKS_PORT, protocol: 'socks', settings: { udp: true }, sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true } },
      { tag: 'http-in', listen: '127.0.0.1', port: HTTP_PORT, protocol: 'http', settings: {}, sniffing: { enabled: true, destOverride: ['http', 'tls'], routeOnly: true } }
    ],
    outbounds: [outboundFromLink(link), { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' }],
    dns: { servers: ['1.1.1.1', '8.8.8.8'] },
    routing: { domainStrategy: 'IPIfNonMatch', rules: [
      { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
      { type: 'field', domain: ['domain:ru', 'domain:by', 'domain:su', 'regexp:\\.(ru|by|su)$'], outboundTag: 'direct' }
    ] }
  };
}

async function readRegistryValue(key, name) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name]);
    const line = stdout.split(/\r?\n/).find(value => value.trim().toLowerCase().startsWith(name.toLowerCase()));
    if (!line) return null;
    const match = line.trim().match(/^\S+\s+(REG_\S+)\s+(.*)$/i);
    return match ? { type: match[1], value: match[2].trim() } : null;
  } catch { return null; }
}

async function writeRegistryValue(key, name, entry) {
  if (!entry) {
    await execFileAsync('reg.exe', ['delete', key, '/v', name, '/f']).catch(() => {});
    return;
  }
  const value = entry.type === 'REG_DWORD' && /^0x/i.test(entry.value) ? String(parseInt(entry.value, 16)) : entry.value;
  await execFileAsync('reg.exe', ['add', key, '/v', name, '/t', entry.type, '/d', value, '/f']);
}

async function notifyProxyChanged() {
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition '[DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);'; [Win32.NativeMethods]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0)|Out-Null; [Win32.NativeMethods]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0)|Out-Null"
  ]).catch(() => {});
}

async function enableSystemProxy(snapshotFile) {
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  if (!fs.existsSync(snapshotFile)) {
    const snapshot = {};
    for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) snapshot[name] = await readRegistryValue(key, name);
    fs.writeFileSync(snapshotFile, JSON.stringify(snapshot));
  }
  await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyEnable', '/t', 'REG_DWORD', '/d', '1', '/f']);
  await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyServer', '/t', 'REG_SZ', '/d', `http=127.0.0.1:${HTTP_PORT};https=127.0.0.1:${HTTP_PORT}`, '/f']);
  await execFileAsync('reg.exe', ['add', key, '/v', 'ProxyOverride', '/t', 'REG_SZ', '/d', '<local>', '/f']);
  await notifyProxyChanged();
}

async function restoreSystemProxy(snapshotFile) {
  if (!fs.existsSync(snapshotFile)) return;
  const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  for (const name of ['ProxyEnable', 'ProxyServer', 'ProxyOverride']) await writeRegistryValue(key, name, snapshot[name]);
  fs.unlinkSync(snapshotFile);
  await notifyProxyChanged();
}

class VpnCore {
  constructor(userData, resourcesPath, onEvent) { this.userData = userData; this.resourcesPath = resourcesPath; this.onEvent = onEvent; this.proc = null; this.startedAt = 0; this.logs = []; this.stopping = false; }
  log(message) { const line = `[${new Date().toLocaleString('ru-RU')}] ${message}`; this.logs.push(line); if (this.logs.length > 500) this.logs.shift(); this.onEvent?.('log', line); }
  get bundledXrayPath() { return path.join(this.resourcesPath, 'runtime', 'xray.exe'); }
  get downloadedXrayPath() { return path.join(this.userData, 'runtime', 'xray.exe'); }
  get xrayPath() { return fs.existsSync(this.bundledXrayPath) ? this.bundledXrayPath : this.downloadedXrayPath; }
  get xrayDirectory() { return path.dirname(this.xrayPath); }
  get proxySnapshotPath() { return path.join(this.userData, 'proxy-state.json'); }
  get configPath() { return path.join(this.userData, 'config.json'); }
  async version() {
    const executable = await this.ensureXray();
    const { stdout } = await execFileAsync(executable, ['version'], { windowsHide: true, cwd: path.dirname(executable) });
    return stdout.match(/^Xray\s+([^\s]+)/m)?.[1] || 'неизвестна';
  }
  async recover() { await restoreSystemProxy(this.proxySnapshotPath).catch(error => this.log(`Не удалось восстановить системный прокси: ${error.message}`)); }
  async ensureXray() {
    if (fs.existsSync(this.bundledXrayPath)) return this.bundledXrayPath;
    if (fs.existsSync(this.downloadedXrayPath)) return this.downloadedXrayPath;
    fs.mkdirSync(path.dirname(this.downloadedXrayPath), { recursive: true });
    this.log('Загрузка Xray Core…');
    const api = JSON.parse((await request('https://api.github.com/repos/XTLS/Xray-core/releases/latest', { headers: { 'User-Agent': 'DadwayVPN-Windows' } })).toString());
    const asset = api.assets.find(a => a.name === 'Xray-windows-64.zip'); if (!asset) throw new Error('Архив Xray для Windows не найден');
    const zip = path.join(this.userData, 'xray.zip'); fs.writeFileSync(zip, await request(asset.browser_download_url));
    const ps = `Expand-Archive -LiteralPath '${zip.replaceAll("'", "''")}' -DestinationPath '${path.dirname(this.downloadedXrayPath).replaceAll("'", "''")}' -Force`;
    try {
      await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    } finally {
      if (fs.existsSync(zip)) fs.unlinkSync(zip);
    }
    if (!fs.existsSync(this.downloadedXrayPath)) throw new Error('После распаковки отсутствует xray.exe');
    this.log('Xray Core установлен'); return this.downloadedXrayPath;
  }
  async connect(server) {
    await this.disconnect(); const executable = await this.ensureXray();
    fs.writeFileSync(this.configPath, JSON.stringify(buildConfig(server.link), null, 2));
    this.proc = spawn(executable, ['run', '-c', this.configPath], { windowsHide: true, cwd: path.dirname(executable) }); this.startedAt = Date.now(); this.stopping = false;
    this.proc.stdout.on('data', d => this.log(d.toString().trim())); this.proc.stderr.on('data', d => this.log(d.toString().trim()));
    this.proc.once('exit', code => {
      const unexpected = !this.stopping && this.startedAt > 0;
      this.proc = null; this.startedAt = 0;
      if (unexpected) {
        this.log(`Xray неожиданно завершился с кодом ${code}`);
        restoreSystemProxy(this.proxySnapshotPath).finally(() => this.onEvent?.('disconnected', { reason: 'xray-exit', code }));
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 900);
      this.proc.once('error', error => { clearTimeout(timer); reject(error); });
      this.proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Xray завершился с кодом ${code}`)); });
    });
    await enableSystemProxy(this.proxySnapshotPath); this.log(`Подключено: ${server.name}`); return { connected: true, startedAt: this.startedAt };
  }
  async disconnect() {
    this.stopping = true;
    await restoreSystemProxy(this.proxySnapshotPath).catch(() => {});
    if (this.proc) { const proc = this.proc; this.proc = null; proc.kill(); this.log('VPN отключён'); }
    this.startedAt = 0;
    if (fs.existsSync(this.configPath)) fs.unlinkSync(this.configPath);
  }
  async externalIp() { const data = JSON.parse((await request('https://api.ipify.org?format=json')).toString()); return data.ip; }
}

function formatConnectionError(error) {
  const messages = {
    EIO: 'Не удалось запустить Xray Core. Переустановите Dadway VPN поверх текущей версии или разрешите Xray в антивирусе.',
    EACCES: 'Windows заблокировала запуск Xray Core. Разрешите приложение в антивирусе и повторите подключение.',
    EPERM: 'Недостаточно прав для запуска Xray Core или изменения системного прокси.',
    ENOENT: 'Файл Xray Core отсутствует. Переустановите Dadway VPN поверх текущей версии.'
  };
  if (messages[error?.code]) return messages[error.code];
  const message = String(error?.message || '').trim();
  if (!message || /[ÐÑÎÏ][\x80-\xBF]/.test(message)) return 'Не удалось подключить VPN. Подробности сохранены в журнале приложения.';
  return message;
}

module.exports = { SUBSCRIPTION_URL, SubscriptionAccessError, request, decodeSubscription, parseServers, checkServers, buildConfig, formatConnectionError, VpnCore, SOCKS_PORT, HTTP_PORT };
