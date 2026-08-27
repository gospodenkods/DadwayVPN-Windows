const { contextBridge, ipcRenderer } = require('electron');
async function connect(id) {
  const result = await ipcRenderer.invoke('connect', id);
  if (!result?.ok) throw new Error(result?.error || 'Не удалось подключить VPN');
  return result.state;
}
contextBridge.exposeInMainWorld('dadway', {
  init: () => ipcRenderer.invoke('init'), refresh: () => ipcRenderer.invoke('refresh'), select: id => ipcRenderer.invoke('select', id),
  connect, disconnect: () => ipcRenderer.invoke('disconnect'), ip: () => ipcRenderer.invoke('ip'),
  open: url => ipcRenderer.invoke('open', url), saveLogs: () => ipcRenderer.invoke('saveLogs'), onEvent: fn => ipcRenderer.on('vpn:event', (_, e) => fn(e))
});
