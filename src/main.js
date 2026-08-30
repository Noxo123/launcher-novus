const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');

const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const MANIFEST_PATH = path.join(__dirname, '..', 'modpack', 'manifest.json');
const FABRIC_INSTALLER_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar';
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

  send('progress', {
    phase: label,
    current: buffer.length,
    total,
    percent: total ? Math.round(buffer.length / total * 100) : 100
  });
}

async function installFabric(manifest) {
  const installerPath = path.join(GAME_DIR, 'fabric-installer.jar');
  send('status', { text: 'Téléchargement de Fabric...' });
  await download(FABRIC_INSTALLER_URL, installerPath, 'Fabric');

  send('status', { text: 'Installation de Fabric...' });

  await new Promise((resolve, reject) => {
    const child = spawn('java', [
      '-jar', installerPath,
      'client',
      '-dir', GAME_DIR,
      '-mcversion', manifest.minecraft,
      '-loader', manifest.fabricLoader || '0.16.14',
      '-noprofile'
    ], { windowsHide: true });

    let stderr = '';
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.stdout.on('data', data => send('status', { text: data.toString().trim() }));
    child.on('error', error => reject(new Error(`Java est introuvable. Installe Java 17 et ajoute-le au PATH. ${error.message}`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Installation Fabric échouée (code ${code}). ${stderr}`));
    });
  });

  fs.rmSync(installerPath, { force: true });
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

  await download(
    file.url,
    path.join(GAME_DIR, 'mods', path.basename(file.filename)),
    mod.name,
    file.hashes?.sha256
  );

  send('status', { text: `${mod.name} ${version.version_number} installé.` });
}

async function install() {
  const manifest = readManifest();
  fs.mkdirSync(GAME_DIR, { recursive: true });

  send('status', { text: `Installation de Minecraft ${manifest.minecraft}...` });

  // MCLC downloads the vanilla client, libraries, assets and natives automatically.
  const launcher = new Client();
  const auth = Authenticator.offline('NovusPlayer');

  await new Promise((resolve, reject) => {
    const client = launcher.launch({
      authorization: auth,
      root: GAME_DIR,
      version: { number: manifest.minecraft, type: 'release' },
      memory: { max: '6G', min: '2G' },
      overrides: { detached: true }
    });

    let finished = false;
    const fail = error => {
      if (!finished) {
        finished = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };

    launcher.on('debug', message => send('status', { text: String(message) }));
    launcher.on('download', message => send('status', { text: `Téléchargement : ${message}` }));
    launcher.on('download-status', data => {
      if (data) send('progress', {
        phase: 'Minecraft',
        current: data.current || data.progress || 0,
        total: data.total || 0,
        percent: data.total ? Math.round((data.current || data.progress || 0) / data.total * 100) : 0
      });
    });
    launcher.on('close', () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    });
    launcher.on('error', fail);

    // MCLC launches the game immediately. We only use it here to populate the vanilla files.
    // Stop the temporary process once the required files are downloaded.
    setTimeout(() => {
      if (client && client.kill) client.kill();
      if (!finished) {
        finished = true;
        resolve();
      }
    }, 1500);
  });

  await installFabric(manifest);

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
    installedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(GAME_DIR, 'novus-manifest.json'), JSON.stringify(installed, null, 2));

  send('status', { text: 'Installation terminée.' });
  send('installed', { installed: true, gameDir: GAME_DIR });
  return { ok: true, gameDir: GAME_DIR };
}

async function launch() {
  const installedFile = path.join(GAME_DIR, 'novus-manifest.json');
  if (!fs.existsSync(installedFile)) throw new Error('Le modpack n’est pas installé.');

  const installed = JSON.parse(fs.readFileSync(installedFile, 'utf8'));
  const loaderVersion = installed.fabricLoader || '0.16.14';
  const customVersion = `fabric-loader-${loaderVersion}-${installed.minecraft}`;

  const launcher = new Client();
  const auth = Authenticator.offline('NovusPlayer');

  send('status', { text: 'Lancement de Minecraft...' });

  const proc = await launcher.launch({
    authorization: auth,
    root: GAME_DIR,
    version: {
      number: customVersion,
      type: 'custom'
    },
    memory: { max: '6G', min: '2G' },
    javaPath: 'java',
    overrides: { detached: true }
  });

  launcher.on('debug', message => send('status', { text: String(message) }));
  launcher.on('data', message => send('status', { text: String(message) }));
  launcher.on('close', code => send('game-exit', { code }));
  launcher.on('error', error => send('game-error', { message: error.message || String(error) }));

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
  try {
    return await install();
  } catch (error) {
    send('error', { message: error.stack || error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('launch', async () => {
  try {
    return await launch();
  } catch (error) {
    send('error', { message: error.stack || error.message });
    return { ok: false, error: error.message };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
