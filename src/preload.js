const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dadway', {
  init: () => ipcRenderer.invoke('init'), refresh: () => ipcRenderer.invoke('refresh'), select: id => ipcRenderer.invoke('select', id),
  connect: id => ipcRenderer.invoke('connect', id), disconnect: () => ipcRenderer.invoke('disconnect'), ip: () => ipcRenderer.invoke('ip'),
  open: url => ipcRenderer.invoke('open', url), saveLogs: () => ipcRenderer.invoke('saveLogs'), onEvent: fn => ipcRenderer.on('vpn:event', (_, e) => fn(e))
});
