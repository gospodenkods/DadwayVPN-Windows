const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dadway', {
  init: () => ipcRenderer.invoke('init'), refresh: () => ipcRenderer.invoke('refresh'), select: id => ipcRenderer.invoke('select', id),
  connect: (id, mode) => ipcRenderer.invoke('connect', id, mode), disconnect: () => ipcRenderer.invoke('disconnect'), test: () => ipcRenderer.invoke('test'),
  settings: patch => ipcRenderer.invoke('settings', patch), subscriptions: () => ipcRenderer.invoke('subscriptions'),
  addSubscription: url => ipcRenderer.invoke('subscription:add', url), toggleSubscription: (id, enabled) => ipcRenderer.invoke('subscription:toggle', id, enabled), removeSubscription: id => ipcRenderer.invoke('subscription:remove', id),
  open: url => ipcRenderer.invoke('open', url), saveLogs: () => ipcRenderer.invoke('saveLogs'), onEvent: fn => ipcRenderer.on('vpn:event', (_, e) => fn(e))
});
