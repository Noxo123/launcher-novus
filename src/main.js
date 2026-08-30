const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('minecraft-launcher-core');

const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const MANIFEST_PATH = path.join(__dirname, '..', 'modpack', 'manifest.json');
const FABRIC_INSTALLER_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar';
let win;
let gameProcess = null;
let gameLauncher = null;
let launchInProgress = false;

function send(event, payload) { if (win && !win.isDestroyed()) win.webContents.send(event, payload); }
function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 820, minWidth: 1000, minHeight: 680, backgroundColor: '#f7f7f6', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
function readManifest() { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
function sha256(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file); stream.on('error', reject); stream.on('data', c => hash.update(c)); stream.on('end', () => resolve(hash.digest('hex'))); }); }
async function download(url, destination, label, expectedSha256) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && expectedSha256) {
    if ((await sha256(destination)).toLowerCase() === expectedSha256.toLowerCase()) return;
    fs.rmSync(destination, { force: true });
  }
  send('status', { text: `Téléchargement : ${label}` });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${label} : téléchargement impossible (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  if (expectedSha256 && (await sha256(destination)).toLowerCase() !== expectedSha256.toLowerCase()) {
    fs.rmSync(destination, { force: true });
    throw new Error(`Hash SHA-256 invalide pour ${label}`);
  }
  send('progress', { phase: label, current: buffer.length, total: buffer.length, percent: 100 });
}
function fabricVersionId(manifest) { return `fabric-loader-${manifest.fabricLoader}-${manifest.minecraft}`; }
function fabricVersionJson(manifest) { const id = fabricVersionId(manifest); return path.join(GAME_DIR, 'versions', id, `${id}.json`); }
function javaCommand() { return process.platform === 'win32' ? 'java.exe' : 'java'; }

async function installFabric(manifest) {
  const installerPath = path.join(GAME_DIR, 'fabric-installer.jar');
  await download(FABRIC_INSTALLER_URL, installerPath, 'Fabric Installer');
  send('status', { text: `Installation de Fabric Loader ${manifest.fabricLoader}...` });
  await new Promise((resolve, reject) => {
    const child = spawn(javaCommand(), ['-jar', installerPath, 'client', '-dir', GAME_DIR, '-mcversion', manifest.minecraft, '-loader', manifest.fabricLoader, '-noprofile', '-downloadMinecraft'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => stderr += d.toString());
    child.stdout.on('data', d => { const text = d.toString().trim(); if (text) send('status', { text: text.split(/\r?\n/).filter(Boolean).pop() }); });
    child.on('error', e => reject(new Error(`Java 17 est introuvable. ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Installation Fabric échouée (${code}). ${stderr.trim()}`)));
  });
  fs.rmSync(installerPath, { force: true });
  if (!fs.existsSync(fabricVersionJson(manifest))) throw new Error(`Fabric n'a pas créé ${fabricVersionId(manifest)}.`);
}
async function installModrinthMod(mod, manifest) {
  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.project)}/version`);
  url.searchParams.set('loaders', JSON.stringify(['fabric']));
  url.searchParams.set('game_versions', JSON.stringify([manifest.minecraft]));
  url.searchParams.set('version_type', 'release');
  const response = await fetch(url, { headers: { 'User-Agent': 'Novus-Launcher/1.0' } });
  if (!response.ok) throw new Error(`Modrinth : ${mod.name} (${response.status})`);
  const versions = await response.json();
  if (!versions.length) throw new Error(`Aucune version compatible de ${mod.name}.`);
  const version = versions[0];
  const file = version.files.find(f => f.primary) || version.files[0];
  if (!file?.url || !file?.filename) throw new Error(`Fichier de ${mod.name} introuvable.`);
  await download(file.url, path.join(GAME_DIR, 'mods', path.basename(file.filename)), `${mod.name} ${version.version_number}`, file.hashes?.sha256);
}
async function verifyMods(manifest) {
  const dir = path.join(GAME_DIR, 'mods');
  const jars = fs.existsSync(dir) ? fs.readdirSync(dir).filter(x => x.toLowerCase().endsWith('.jar')) : [];
  if (jars.length < (manifest.mods || []).length) throw new Error(`Mods incomplets : ${jars.length}/${(manifest.mods || []).length}.`);
}
async function install() {
  const manifest = readManifest();
  fs.mkdirSync(GAME_DIR, { recursive: true });
  send('progress', { percent: 5, phase: 'Préparation' });
  await installFabric(manifest);
  send('progress', { percent: 30, phase: 'Fabric installé' });
  fs.mkdirSync(path.join(GAME_DIR, 'mods'), { recursive: true });
  const mods = manifest.mods || [];
  for (let i = 0; i < mods.length; i++) {
    await installModrinthMod(mods[i], manifest);
    send('progress', { percent: 30 + Math.round(((i + 1) / Math.max(1, mods.length)) * 55), phase: `${mods[i].name} installé` });
  }
  await verifyMods(manifest);
  for (const file of manifest.files || []) {
    const root = path.resolve(GAME_DIR);
    const target = path.resolve(GAME_DIR, file.path);
    if (!target.startsWith(root + path.sep)) throw new Error(`Chemin interdit : ${file.path}`);
    await download(file.url, target, file.path, file.sha256);
  }
  fs.writeFileSync(path.join(GAME_DIR, 'novus-manifest.json'), JSON.stringify({ ...manifest, installedAt: new Date().toISOString(), fabricVersionId: fabricVersionId(manifest) }, null, 2));
  send('progress', { percent: 100, phase: 'Installation terminée' });
  send('status', { text: 'Novus est prêt à jouer.' });
  send('installed', { installed: true, gameDir: GAME_DIR });
  return { ok: true, gameDir: GAME_DIR };
}

async function launch(server) {
  const manifest = readManifest();
  if (!fs.existsSync(path.join(GAME_DIR, 'novus-manifest.json'))) throw new Error('Le modpack n’est pas installé.');
  if (!fs.existsSync(fabricVersionJson(manifest))) throw new Error('Fabric est incomplet. Fais une mise à jour.');
  await verifyMods(manifest);

  if (launchInProgress || gameProcess) throw new Error('Minecraft est déjà en cours de lancement ou déjà lancé.');
  launchInProgress = true;

  const launcher = new Client();
  gameLauncher = launcher;
  const options = {
    authorization: offlineAuth(manifest.playerName || 'NovusPlayer'),
    root: GAME_DIR,
    version: { number: fabricVersionId(manifest), type: 'custom' },
    memory: { max: manifest.memoryMax || '4G', min: manifest.memoryMin || '2G' },
    javaPath: javaCommand(),
    overrides: { detached: false }
  };
  if (server?.host) options.server = { host: server.host, port: Number(server.port || 25565) };

  send('progress', { percent: 100, phase: 'Lancement de Novus...' });
  send('status', { text: server?.host ? `Connexion à ${server.host}...` : 'Lancement de Novus...' });

  // minecraft-launcher-core 3.18.x exposes events on Client, while launch()
  // is async and resolves to the actual ChildProcess. The old code stored the
  // Promise returned by launch() as gameProcess, which caused the launcher/UI
  // to treat a Promise as a process and led to errors such as
  // "processHandle.on is not a function".
  launcher.on('debug', m => send('game-log', { text: String(m) }));
  launcher.on('data', m => send('game-log', { text: String(m) }));
  launcher.on('arguments', args => send('game-log', { text: `Minecraft arguments: ${args.join(' ')}` }));
  launcher.on('error', e => {
    gameProcess = null;
    gameLauncher = null;
    launchInProgress = false;
    send('game-error', { message: e?.message || String(e) });
  });
  launcher.on('close', code => {
    gameProcess = null;
    gameLauncher = null;
    launchInProgress = false;
    send('game-exit', { code });
  });

  try {
    const processHandle = await launcher.launch(options);

    if (!processHandle) {
      gameProcess = null;
      gameLauncher = null;
      launchInProgress = false;
      throw new Error('Minecraft n’a pas pu être lancé. Vérifie Java et les logs Novus.');
    }

    // IMPORTANT: processHandle is the real ChildProcess. Never call .on()
    // on the Promise returned by launcher.launch().
    if (typeof processHandle.on !== 'function') {
      gameProcess = null;
      gameLauncher = null;
      launchInProgress = false;
      throw new Error(`Le processus Minecraft retourné est invalide (${typeof processHandle}).`);
    }

    gameProcess = processHandle;
    launchInProgress = false;
    send('game-started', { started: true, pid: processHandle.pid || null });
    send('status', { text: 'Minecraft est lancé.' });
    return { ok: true, pid: processHandle.pid || null };
  } catch (error) {
    gameProcess = null;
    gameLauncher = null;
    launchInProgress = false;
    send('game-error', { message: error?.stack || error?.message || String(error) });
    throw error;
  }
}

function offlineAuth(name = 'NovusPlayer') {
  const uuid = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest('hex');
  return { access_token: '0', client_token: crypto.randomUUID(), uuid, name, user_properties: '{}', meta: { type: 'mojang' } };
}

ipcMain.handle('get-info', () => {
  const m = readManifest();
  return { name: m.name, version: m.version, minecraft: m.minecraft, loader: m.loader, fabricLoader: m.fabricLoader, gameDir: GAME_DIR, installed: fs.existsSync(path.join(GAME_DIR, 'novus-manifest.json')) && fs.existsSync(fabricVersionJson(m)), mods: m.mods || [], server: m.server || {} };
});
ipcMain.handle('install', async () => { try { return await install(); } catch (e) { send('error', { message: e.stack || e.message }); return { ok: false, error: e.message }; } });
ipcMain.handle('launch', async (_event, server) => { try { return await launch(server); } catch (e) { send('error', { message: e.stack || e.message }); return { ok: false, error: e.message }; } });
ipcMain.handle('open-game-dir', () => { shell.openPath(GAME_DIR); return GAME_DIR; });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
