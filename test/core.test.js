const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const { decodeSubscription, parseServers, checkServers, request, outboundFromLink, buildConfig } = require('../src/core');

test('decodes base64 subscriptions and keeps plain links', () => {
  const link = 'vless://id@example.com:443#RU';
  assert.equal(decodeSubscription(Buffer.from(link).toString('base64')), link);
  assert.equal(decodeSubscription(link), link);
});
test('makes server ids source-aware and recognizes countries', () => {
  const source = { id: 'one', url: 'https://example.com/sub/secret' };
  const nodes = parseServers('vless://id@example.com:443#🇬🇧%20UK%20№1', source);
  assert.equal(nodes[0].subscriptionId, 'one'); assert.match(nodes[0].id, /^one\|/); assert.equal(nodes[0].country, 'gb');
});
test('normalizes REALITY client profile and supports XHTTP', () => {
  const outbound = outboundFromLink('vless://uuid@example.com:443?security=reality&sni=example.org&pbk=public&fp=chrome&type=xhttp&path=%2Fway&mode=auto#node');
  assert.equal(outbound.streamSettings.realitySettings.fingerprint, 'safari'); assert.equal(outbound.streamSettings.network, 'xhttp'); assert.equal(outbound.streamSettings.xhttpSettings.path, '/way');
});
test('builds independent proxy and TUN configurations with direct national zones', () => {
  const link = 'vless://uuid@example.com:443?security=tls&sni=example.org#node';
  const proxy = buildConfig(link, 'proxy'), tun = buildConfig(link, 'tun');
  assert.equal(proxy.inbounds.some(v => v.protocol === 'tun'), false); assert.equal(tun.inbounds[0].protocol, 'tun'); assert.deepEqual(proxy.routing.rules[1].domain, ['domain:ru', 'domain:by', 'domain:su']); assert.equal(tun.metrics.listen, '127.0.0.1:49227');
});
test('checks duplicate server endpoints only once', async () => {
  let connections = 0;
  const server = require('node:net').createServer(socket => { connections++; socket.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const checked = await checkServers([{ host: '127.0.0.1', port }, { host: '127.0.0.1', port }]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(connections, 1); assert.equal(checked.every(item => item.available), true);
  } finally { server.close(); }
});
test('does not forward HWID to another redirect origin', async () => {
  let leaked;
  const target = http.createServer((req, res) => { leaked = req.headers['x-hwid']; res.end('ok'); });
  await new Promise(resolve => target.listen(0, '127.0.0.1', resolve));
  const redirect = http.createServer((req, res) => { res.writeHead(302, { Location: `http://127.0.0.1:${target.address().port}/done` }); res.end(); });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  try { await request(`http://127.0.0.1:${redirect.address().port}/start`, { headers: { 'X-HWID': 'secret' }, sensitiveHeaders: ['X-HWID'] }); assert.equal(leaked, undefined); }
  finally { redirect.close(); target.close(); }
});
test('bundled Xray accepts proxy and TUN configurations', { skip: process.platform !== 'win32' }, () => {
  const executable = path.join(__dirname, '..', 'runtime', 'xray.exe');
  if (!fs.existsSync(executable)) return;
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dadway-config-'));
  try {
    for (const mode of ['proxy', 'tun']) {
      const config = path.join(folder, `${mode}.json`);
      fs.writeFileSync(config, JSON.stringify(buildConfig('vless://00000000-0000-0000-0000-000000000000@example.com:443?security=tls&sni=example.com#test', mode)));
      const result = spawnSync(executable, ['run', '-test', '-c', config], { encoding: 'utf8', cwd: path.dirname(executable) });
      const output = result.stderr || result.stdout;
      const expectedNonAdminTunFailure = mode === 'tun' && /Отказано в доступе|Access is denied/i.test(output);
      assert.ok(result.status === 0 || expectedNonAdminTunFailure, `${mode}: ${output}`);
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
