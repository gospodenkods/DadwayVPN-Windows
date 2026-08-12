const $ = selector => document.querySelector(selector);
const flags = { ru: '🇷🇺', de: '🇩🇪', us: '🇺🇸', nl: '🇳🇱', unknown: '🌐' };
const DONATE_URL = 'https://pay.cloudtips.ru/p/19a29f12';
let servers = [], selectedId = null, connected = false, startedAt = 0, timer;

function toast(message, duration = 3600) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), duration); }
function friendlyError(error) {
  const raw = String(error?.message || error || '').replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^SubscriptionAccessError:\s*/i, '').trim();
  if (/подписка отключена|HTTP\s*404/i.test(raw)) return 'Подписка отключена. Продлите подписку и нажмите «Обновить список серверов».';
  if (/срок действия подписки ист[её]к|HTTP\s*410/i.test(raw)) return 'Срок действия подписки истёк. Продлите подписку и обновите список серверов.';
  if (/доступ к подписке запрещ[её]н|HTTP\s*(401|403)/i.test(raw)) return 'Нет доступа к подписке. Проверьте её адрес или обратитесь в поддержку.';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|время ожидания|network|fetch failed/i.test(raw)) return 'Не удалось связаться с сервером. Проверьте интернет и повторите попытку.';
  if (/\bEIO\b|input\/output|ошибк[аи] ввода.?вывода|копирован/i.test(raw)) return 'Не удалось запустить VPN-компонент. Перезапустите приложение. Если ошибка повторится, проверьте, не заблокировал ли антивирус Xray.';
  if (/ENOENT|xray\.exe|не найден/i.test(raw)) return 'VPN-компонент Xray не найден. Переустановите приложение и повторите попытку.';
  if (/EACCES|EPERM|access denied|доступ запрещ/i.test(raw)) return 'Windows заблокировала запуск VPN-компонента. Разрешите Dadway VPN и Xray в антивирусе, затем повторите попытку.';
  return raw || 'Не удалось выполнить операцию. Повторите попытку позже.';
}
function selected() { return servers.find(server => server.id === selectedId) || servers[0]; }

function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  localStorage.setItem('dadway-theme', value);
  const light = value === 'light';
  $('#themeToggle span').textContent = light ? '☾' : '☀';
  $('#themeToggle').title = light ? 'Включить тёмную тему' : 'Включить светлую тему';
  $('#themeToggle').setAttribute('aria-label', $('#themeToggle').title);
  $('#settingsTheme').setAttribute('aria-checked', String(light));
}
function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'); }

function render() {
  const server = selected();
  if (!server) {
    selectedId = null;
    $('#flag').textContent = '⛔'; $('#serverName').textContent = 'Подписка недоступна';
    $('#serverStatus').textContent = 'Серверы отсутствуют'; $('#serverStatus').className = 'danger';
    renderList(); return;
  }
  selectedId = server.id; $('#flag').textContent = flags[server.country] || flags.unknown; $('#serverName').textContent = server.name;
  $('#serverStatus').textContent = server.available === null ? '●  Проверка доступности…' : server.available ? `●  Доступен • ${server.latency} мс` : '●  Недоступен';
  $('#serverStatus').className = server.available ? 'success' : server.available === false ? 'danger' : 'warning'; renderList();
}
function renderList() {
  const list = $('#serverList'); list.innerHTML = '';
  servers.forEach(server => {
    const button = document.createElement('button'); button.className = `server-item ${server.id === selectedId ? 'selected' : ''}`; button.disabled = server.available === false;
    button.innerHTML = `<span class="country">${flags[server.country] || flags.unknown}</span><span><b></b><small>${server.available === null ? 'Проверка…' : server.available ? '● Доступен' : '● Недоступен'}</small></span><span class="latency">${server.latency ? `${server.latency} мс` : ''}</span>`;
    button.querySelector('b').textContent = server.name;
    button.onclick = async () => { selectedId = server.id; await window.dadway.select(server.id); render(); $('#serverDialog').close(); };
    list.appendChild(button);
  });
  $('#updated').textContent = servers.length ? `Обновлено только что • ${servers.length} серверов` : 'Подписка отключена или истекла';
}
async function refresh() {
  toast('Обновляем список серверов…'); $('#serverStatus').textContent = 'Проверка доступности…';
  try {
    const result = await window.dadway.refresh(); servers = result.servers; render();
    toast(result.fromCache ? 'Нет связи: показан сохранённый список' : 'Список серверов обновлён');
    if (result.fromCache) $('#updated').textContent = 'Нет связи с сервером • сохранённый список';
  } catch (error) { render(); toast(friendlyError(error), 6000); }
}
function renderDisconnected(status = 'Защита выключена') {
  connected = false; clearInterval(timer); startedAt = 0; const button = $('#connect'); button.classList.remove('on'); button.querySelector('span').textContent = 'ПОДКЛЮЧИТЬСЯ';
  $('#status').textContent = status; $('#status').className = 'danger'; $('#timer').textContent = '00:00:00'; $('#ip').textContent = '—';
}
async function toggle() {
  const server = selected(); if (!server) return toast('Дождитесь загрузки серверов'); const button = $('#connect'); button.disabled = true;
  try {
    if (connected) { await window.dadway.disconnect(); renderDisconnected(); }
    else {
      if (server.available === false) return toast('Выбранный сервер недоступен');
      $('#status').textContent = 'Подключение…'; $('#status').className = 'warning'; const state = await window.dadway.connect(server.id);
      connected = true; startedAt = state.startedAt; button.classList.add('on'); button.querySelector('span').textContent = 'ОТКЛЮЧИТЬСЯ'; $('#status').textContent = 'Защита включена'; $('#status').className = 'success';
      timer = setInterval(updateTimer, 1000); window.dadway.ip().then(ip => $('#ip').textContent = ip).catch(() => {}); toast('VPN подключён');
    }
  } catch (error) { renderDisconnected('Не удалось подключиться'); toast(friendlyError(error), 6000); } finally { button.disabled = false; }
}
function updateTimer() { const seconds = Math.floor((Date.now() - startedAt) / 1000); $('#timer').textContent = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':'); }

applyTheme(localStorage.getItem('dadway-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('#themeToggle').onclick = toggleTheme; $('#settingsTheme').onclick = toggleTheme; $('#connect').onclick = toggle; $('#refresh').onclick = refresh; $('#update').onclick = refresh;
$('#selected').onclick = () => $('#serverDialog').showModal(); $('#close').onclick = () => $('#serverDialog').close(); $('#settings').onclick = () => $('#settingsDialog').showModal(); $('.close-settings').onclick = () => $('#settingsDialog').close();
$('#website').onclick = () => window.dadway.open('https://dadway.ru'); $('#telegram').onclick = () => window.dadway.open('https://t.me/gds_technical'); $('#donate').onclick = () => window.dadway.open(DONATE_URL);
$('#logs').onclick = async () => { if (await window.dadway.saveLogs()) toast('Лог сохранён'); };
$('#test').onclick = async () => { if (!connected) return toast('Сначала подключите VPN'); try { $('#ip').textContent = await window.dadway.ip(); toast('IP обновлён'); } catch (error) { toast(friendlyError(error), 6000); } };
window.dadway.onEvent(event => { if (event.type === 'servers') { servers = event.payload; render(); } if (event.type === 'error') toast(friendlyError(event.payload), 6000); if (event.type === 'subscription-revoked') { servers = []; render(); renderDisconnected('Подписка отключена'); toast(friendlyError(event.payload), 6000); } if (event.type === 'disconnected') { renderDisconnected('Соединение прервано'); toast('VPN отключён. Настройки сети восстановлены.'); } });
window.dadway.init().then(data => { servers = data.servers; selectedId = data.settings.selectedId; $('#buildVersion').textContent = `Сборка: ${data.appVersion}`; $('#xrayVersion').textContent = `Xray: ${data.xrayVersion}`; render(); }).catch(error => toast(friendlyError(error), 6000));
