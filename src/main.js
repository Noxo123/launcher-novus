const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const MINECRAFT_VERSION = '1.21.1';
const FABRIC_LOADER = '0.17.2';
const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const MANIFEST_PATH = path.join(__dirname, '..', 'modpack', 'manifest.json');

let win;

function send(event, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function download(url, destination, label) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length') || 0);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  send('progress', { phase: label, current: buffer.length, total, percent: total ? Math.round(buffer.length / total * 100) : 100 });
}

async function install() {
  const manifest = readManifest();
  fs.mkdirSync(GAME_DIR, { recursive: true });
  send('status', { text: `Installation de Minecraft ${manifest.minecraft}...` });

  // Dynamic import keeps Electron's CommonJS main process compatible with the ESM XMCL packages.
  const { Version } = await import('@xmcl/core');
  const installer = await import('@xmcl/installer');
  const minecraft = GAME_DIR;
  const resolved = await Version.parse(minecraft, manifest.minecraft);

  await installer.completeInstallation(resolved, {
    tracker: event => {
      const phase = event.phase || 'minecraft';
      const downloadInfo = event.payload && event.payload.download;
      send('progress', downloadInfo
        ? { phase, current: downloadInfo.progress, total: downloadInfo.total, percent: downloadInfo.total ? Math.round(downloadInfo.progress / downloadInfo.total * 100) : 0 }
        : { phase, current: 0, total: 0, percent: 0 });
    }
  });

  send('status', { text: `Installation de Fabric ${manifest.fabric.loader}...` });
  await installer.installFabric({ minecraft: manifest.minecraft, loader: manifest.fabric.loader }, minecraft);

  const files = manifest.files || [];
  for (const file of files) {
    const target = path.join(GAME_DIR, file.path);
    let valid = false;
    if (fs.existsSync(target) && file.sha256) {
      valid = (await sha256(target)).toLowerCase() === file.sha256.toLowerCase();
    }
    if (!valid) await download(file.url, target, file.path);
  }

  fs.writeFileSync(path.join(GAME_DIR, 'novus-manifest.json'), JSON.stringify(manifest, null, 2));
  send('status', { text: 'Installation terminée.' });
  send('installed', { installed: true, gameDir: GAME_DIR });
  return { ok: true, gameDir: GAME_DIR };
}

async function launch() {
  const manifest = readManifest();
  const { launch, Version } = await import('@xmcl/core');
  if (!fs.existsSync(GAME_DIR)) throw new Error('Le modpack n’est pas installé.');

  // V1 uses an offline local profile for local testing only.
  // Microsoft account authentication will be added in V1.1 before public multiplayer use.
  const username = 'NovusPlayer';
  const resolved = await Version.parse(GAME_DIR, manifest.minecraft);
  send('status', { text: 'Lancement de Minecraft...' });

  const proc = await launch({
    gamePath: GAME_DIR,
    javaPath: 'java',
    version: resolved.id,
    minMemory: 2,
    maxMemory: 6,
    authorization: {
      accessToken: '0',
      clientToken: 'novus-local',
      uuid: '00000000-0000-0000-0000-000000000000',
      name: username,
      userProperties: {},
      meta: { type: 'offline', demo: false }
    },
    detached: true
  });

  proc.on('error', error => send('game-error', { message: error.message }));
  proc.on('exit', code => send('game-exit', { code }));
  send('status', { text: 'Minecraft est lancé.' });
  return { ok: true };
}

ipcMain.handle('get-info', () => {
  const manifest = readManifest();
  return {
    name: manifest.name,
    version: manifest.version,
    minecraft: manifest.minecraft,
    loader: manifest.loader,
    gameDir: GAME_DIR,
    installed: fs.existsSync(path.join(GAME_DIR, 'novus-manifest.json'))
  };
});

ipcMain.handle('install', async () => {
  try { return await install(); }
  catch (error) {
    send('error', { message: error.stack || error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('launch', async () => {
  try { return await launch(); }
  catch (error) {
    send('error', { message: error.stack || error.message });
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
