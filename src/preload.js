const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('novus', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  getModpacks: () => ipcRenderer.invoke('get-modpacks'),
  selectModpack: pack => ipcRenderer.invoke('select-modpack', pack),
  install: () => ipcRenderer.invoke('install'),
  launch: server => ipcRenderer.invoke('launch', server || null),
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),
  onStatus: cb => ipcRenderer.on('status', (_e, data) => cb(data)),
  onProgress: cb => ipcRenderer.on('progress', (_e, data) => cb(data)),
  onError: cb => ipcRenderer.on('error', (_e, data) => cb(data)),
  onInstalled: cb => ipcRenderer.on('installed', (_e, data) => cb(data)),
  onGameExit: cb => ipcRenderer.on('game-exit', (_e, data) => cb(data)),
  onGameError: cb => ipcRenderer.on('game-error', (_e, data) => cb(data)),
  onGameLog: cb => ipcRenderer.on('game-log', (_e, data) => cb(data))
});
