const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

function readManifest(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || !manifest.minecraft) return null;
    return manifest;
  } catch (_) {
    return null;
  }
}

function scanModpackRoot(root, source) {
  const result = [];
  if (!root || !fs.existsSync(root)) return result;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return result; }

  const candidates = [];
  if (fs.existsSync(path.join(root, 'manifest.json'))) candidates.push(root);
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith('.')) candidates.push(path.join(root, entry.name));
  }

  for (const dir of candidates) {
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = readManifest(manifestPath);
    if (!manifest) continue;
    result.push({
      id: path.resolve(dir).toLowerCase(),
      name: String(manifest.name || path.basename(dir)),
      version: String(manifest.version || '1.0.0'),
      minecraft: String(manifest.minecraft),
      loader: String(manifest.loader || 'fabric'),
      fabricLoader: manifest.fabricLoader ? String(manifest.fabricLoader) : null,
      mods: Array.isArray(manifest.mods) ? manifest.mods.length : 0,
      directory: dir,
      manifestPath,
      source
    });
  }
  return result;
}

function scanModpacks() {
  const appData = process.env.APPDATA || '';
  const roots = [
    { path: path.join(appData, 'novus-launcher', 'modpacks'), source: 'NOVUS / modpacks' },
    { path: path.join(appData, 'novus-launcher', 'modpack'), source: 'NOVUS / modpack' },
    { path: path.join(process.cwd(), 'modpacks'), source: 'Launcher / modpacks' },
    { path: path.join(process.cwd(), 'modpack'), source: 'Launcher / modpack' },
    { path: path.join(__dirname, '..', 'modpacks'), source: 'Application / modpacks' },
    { path: path.join(__dirname, '..', 'modpack'), source: 'Application / modpack' }
  ];
  if (process.resourcesPath) {
    roots.push({ path: path.join(process.resourcesPath, 'modpacks'), source: 'Installation / modpacks' });
  }

  const packs = [];
  const seen = new Set();
  for (const root of roots) {
    for (const pack of scanModpackRoot(root.path, root.source)) {
      if (seen.has(pack.id)) continue;
      seen.add(pack.id);
      packs.push(pack);
    }
  }
  return packs.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

contextBridge.exposeInMainWorld('novus', {
  getInfo: () => ipcRenderer.invoke('get-info'),
  install: () => ipcRenderer.invoke('install'),
  launch: server => ipcRenderer.invoke('launch', server || null),
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),
  getModpacks: () => scanModpacks(),
  onStatus: callback => ipcRenderer.on('status', (_event, data) => callback(data)),
  onProgress: callback => ipcRenderer.on('progress', (_event, data) => callback(data)),
  onError: callback => ipcRenderer.on('error', (_event, data) => callback(data)),
  onInstalled: callback => ipcRenderer.on('installed', (_event, data) => callback(data)),
  onGameExit: callback => ipcRenderer.on('game-exit', (_event, data) => callback(data)),
  onGameError: callback => ipcRenderer.on('game-error', (_event, data) => callback(data)),
  onGameLog: callback => ipcRenderer.on('game-log', (_event, data) => callback(data))
});
