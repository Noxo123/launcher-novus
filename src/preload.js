const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novus', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  install: () => ipcRenderer.invoke('install'),
  launch: () => ipcRenderer.invoke('launch'),
  onStatus: callback => ipcRenderer.on('status', (_event, data) => callback(data)),
  onProgress: callback => ipcRenderer.on('progress', (_event, data) => callback(data)),
  onError: callback => ipcRenderer.on('error', (_event, data) => callback(data)),
  onInstalled: callback => ipcRenderer.on('installed', (_event, data) => callback(data)),
  onGameExit: callback => ipcRenderer.on('game-exit', (_event, data) => callback(data)),
  onGameError: callback => ipcRenderer.on('game-error', (_event, data) => callback(data))
});
