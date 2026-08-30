const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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

async function download(url, destination, label, expectedSha256) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && expectedSha256) {
    const existing = await sha256(destination);
    if (existing.toLowerCase() === expectedSha256.toLowerCase()) return;
  }

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}): ${url}`);
  const total = Number(response.headers.get('content-length') || 0);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);

  if (expectedSha256) {
    const actual = await sha256(destination);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      fs.rmSync(destination, { force: true });
      throw new Error(`Hash SHA-256 invalide pour ${label}`);
    }
  }
  send('progress', { phase: label, current: buffer.length, total, percent: total ? Math.round(buffer.length / total * 100) : 100 });
}

async function installModrinthMod(mod, manifest) {
  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.project)}/version`);
  url.searchParams.set('loaders', JSON.stringify(['fabric']));
  url.searchParams.set('game_versions', JSON.stringify([manifest.minecraft]));
  url.searchParams.set('version_type', 'release');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Modrinth ne propose pas de version compatible pour ${mod.name} (${response.status})`);
  const versions = await response.json();
  if (!Array.isArray(versions) || versions.length === 0) throw new Error(`Aucune version compatible de ${mod.name}`);

  const version = versions[0];
  const file = version.files.find(f => f.primary) || version.files[0];
  if (!file) throw new Error(`Fichier introuvable pour ${mod.name}`);

  const safeName = path.basename(file.filename);
  await download(file.url, path.join(GAME_DIR, 'mods', safeName), mod.name, file.hashes?.sha256);
  send('status', { text: `${mod.name} ${version.version_number} installé.` });
}

async function install() {
  const manifest = readManifest();
  fs.mkdirSync(GAME_DIR, { recursive: true });
  send('status', { text: `Installation de Minecraft ${manifest.minecraft}...` });

  const { Version } = await import('@xmcl/core');
  const installer = await import('@xmcl/installer');
  const resolved = await Version.parse(GAME_DIR, manifest.minecraft);

  await installer.completeInstallation(resolved, {
    tracker: event => {
      const phase = event.phase || 'minecraft';
      const downloadInfo = event.payload && event.payload.download;
      send('progress', downloadInfo
        ? { phase, current: downloadInfo.progress, total: downloadInfo.total, percent: downloadInfo.total ? Math.round(downloadInfo.progress / downloadInfo.total * 100) : 0 }
        : { phase, current: 0, total: 0, percent: 0 });
    }
  });

  send('status', { text: 'Installation du loader Fabric...' });
  const loaders = await installer.getLoaderArtifactListFor(manifest.minecraft, {});
  if (!loaders.length) throw new Error(`Aucun loader Fabric trouvé pour ${manifest.minecraft}`);
  const loader = loaders[0];
  const versionId = await installer.installFabricByLoaderArtifact(loader, GAME_DIR, {
    side: 'client',
    versionId: `fabric-loader-${loader.version}-${manifest.minecraft}`
  });

  for (const mod of manifest.mods || []) {
    await installModrinthMod(mod, manifest);
  }

  for (const file of manifest.files || []) {
    const target = path.join(GAME_DIR, file.path);
    const normalized = path.normalize(target);
    if (!normalized.startsWith(path.normalize(GAME_DIR + path.sep))) {
      throw new Error(`Chemin de fichier interdit dans le manifest: ${file.path}`);
    }
    await download(file.url, target, file.path, file.sha256);
  }

  const installed = {
    ...manifest,
    installedLoader: loader.version,
    installedVersionId: versionId
  };
  fs.writeFileSync(path.join(GAME_DIR, 'novus-manifest.json'), JSON.stringify(installed, null, 2));
  send('status', { text: 'Installation terminée.' });
  send('installed', { installed: true, gameDir: GAME_DIR });
  return { ok: true, gameDir: GAME_DIR, versionId };
}

async function launch() {
  const manifest = readManifest();
  const installedFile = path.join(GAME_DIR, 'novus-manifest.json');
  if (!fs.existsSync(installedFile)) throw new Error('Le modpack n’est pas installé.');
  const installed = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
  const { launch } = await import('@xmcl/core');

  send('status', 'Lancement de Minecraft...');
  // V1 is for local testing. Public multiplayer will use Microsoft authentication in V1.1.
  const proc = await launch({
    gamePath: GAME_DIR,
    javaPath: 'java',
    version: installed.installedVersionId,
    minMemory: 2,
    maxMemory: 6,
    authorization: {
      accessToken: '0',
      clientToken: 'novus-local',
      uuid: '00000000-0000-0000-0000-000000000000',
      name: 'NovusPlayer',
      userProperties: {},
      meta: { type: 'offline', demo: false }
    },
    extraExecOption: { detached: true }
  });

  proc.on('error', error => send('game-error', { message: error.message }));
  proc.on('exit', code => send('game-exit', { code }));
  send('status', { text: 'Minecraft est lancé.' });
  return { ok: true };
}

ipcMain.handle('get-info', () => {
  const manifest = readManifest();
  const installedPath = path.join(GAME_DIR, 'novus-manifest.json');
  return {
    name: manifest.name,
    version: manifest.version,
    minecraft: manifest.minecraft,
    loader: manifest.loader,
    gameDir: GAME_DIR,
    installed: fs.existsSync(installedPath)
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
