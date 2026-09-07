const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildConfig, endpointPing, formatConnectionError, VpnCore } = require('../src/core');

test('uses bundled Xray directly with a Cyrillic profile path', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dadway-runtime-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'Летний дождь', 'AppData', 'Roaming', 'dadway-vpn-windows');
  const resources = path.join(root, 'Файлы приложения', 'resources');
  const bundledXray = path.join(resources, 'runtime', 'xray.exe');
  fs.mkdirSync(path.dirname(bundledXray), { recursive: true });
  fs.writeFileSync(bundledXray, 'test executable');

  const core = new VpnCore(userData, resources);
  const executable = await core.ensureXray();

  assert.equal(executable, bundledXray);
  assert.equal(core.xrayDirectory, path.dirname(bundledXray));
  assert.equal(fs.existsSync(path.join(userData, 'runtime')), false);
});

test('replaces Windows filesystem errors with a readable message', () => {
  const error = Object.assign(new Error('EIO, Îøèáêà ââîäà-âûâîäà'), { code: 'EIO' });

  assert.equal(
    formatConnectionError(error),
    'Не удалось запустить Xray Core. Переустановите Dadway VPN поверх текущей версии или разрешите Xray в антивирусе.'
  );
});

test('uses safari for XHTTP REALITY links that request chrome', () => {
  const link = 'vless://00000000-0000-0000-0000-000000000000@example.com:443?encryption=none&type=xhttp&security=reality&sni=www.ebay.de&fp=chrome&pbk=key&sid=abcd&path=%2Fapi';
  const config = buildConfig(link);

  assert.equal(config.outbounds[0].streamSettings.realitySettings.fingerprint, 'safari');
});

test('shows the fresh TCP latency of the VPN endpoint as ping', () => {
  assert.equal(endpointPing({ host: 'vpn.example', port: 443, latency: 47.4 }), 47);
  assert.equal(endpointPing({ host: 'vpn.example', port: 443, latency: null }), null);
  assert.equal(endpointPing({ host: 'vpn.example', port: 443 }), null);
});
