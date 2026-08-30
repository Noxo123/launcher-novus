const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { Client } = require('minecraft-launcher-core');

const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const RUNTIME_DIR = path.join(app.getPath('userData'), 'runtime');
const JAVA_DIR = path.join(RUNTIME_DIR, 'jdk17');
const JAVA_ZIP = path.join(RUNTIME_DIR, 'jdk17.zip');
const MANIFEST_PATH = path.join(__dirname, '..', 'modpack', 'manifest.json');
const INSTALLED_MANIFEST_PATH = path.join(GAME_DIR, 'novus-manifest.json');
const FABRIC_INSTALLER_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar';
const JAVA_DOWNLOAD_URL = 'https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse';

let win;
let gameProcess = null;
let gameLauncher = null;
let launchInProgress = false;

function send(event, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f7f7f6',
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
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error('manifest.json introuvable.');
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
    try {
      const current = await sha256(destination);
      if (current.toLowerCase() === expectedSha256.toLowerCase()) return false;
    } catch (_) {}
    fs.rmSync(destination, { force: true });
  }

  send('status', { text: `Téléchargement : ${label}` });
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Novus-Launcher/1.1' }
  });
  if (!response.ok) throw new Error(`${label} : téléchargement impossible (${response.status})`);

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);

  if (expectedSha256) {
    const actual = await sha256(destination);
    if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
      fs.rmSync(destination, { force: true });
      throw new Error(`Hash SHA-256 invalide pour ${label}.`);
    }
  }

  send('progress', { phase: label, current: buffer.length, total: buffer.length, percent: 100 });
  return true;
}

function fabricVersionId(manifest) {
  return `fabric-loader-${manifest.fabricLoader}-${manifest.minecraft}`;
}

function fabricVersionJson(manifest) {
  const id = fabricVersionId(manifest);
  return path.join(GAME_DIR, 'versions', id, `${id}.json`);
}

function javaVersion(java) {
  try {
    return String(execFileSync(java, ['-version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }));
  } catch (e) {
    return `${e.stderr || ''}${e.stdout || ''}`;
  }
}

function isJava17(java) {
  return /version\s+"17(?:[.\-]|$)/.test(javaVersion(java));
}

function findJava() {
  const candidates = [];
  const bundled = path.join(JAVA_DIR, 'bin', 'java.exe');

  if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'Java', 'jdk-17', 'bin', 'java.exe'));
    candidates.push(path.join(process.env.ProgramFiles, 'Eclipse Adoptium', 'jdk-17', 'bin', 'java.exe'));
  }
  if (process.env['ProgramFiles(x86)']) {
    candidates.push(path.join(process.env['ProgramFiles(x86)'], 'Java', 'jdk-17', 'bin', 'java.exe'));
  }
  candidates.push('java.exe');
  candidates.push(bundled);

  for (const candidate of candidates) {
    try {
      if (isJava17(candidate)) return candidate;
    } catch (_) {}
  }
  return null;
}

async function installJava17() {
  const existing = findJava();
  if (existing) {
    send('status', { text: 'Java 17 x64 détecté.' });
    return existing;
  }

  if (process.platform !== 'win32') {
    throw new Error('Novus installe automatiquement Java 17 sur Windows uniquement.');
  }

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  send('status', { text: 'Java 17 x64 absent : téléchargement automatique...' });
  send('progress', { percent: 5, phase: 'Téléchargement de Java 17 x64' });
  await download(JAVA_DOWNLOAD_URL, JAVA_ZIP, 'Java 17 x64');

  if (fs.existsSync(JAVA_DIR)) fs.rmSync(JAVA_DIR, { recursive: true, force: true });
  fs.mkdirSync(JAVA_DIR, { recursive: true });
  send('status', { text: 'Installation automatique de Java 17 x64...' });

  await new Promise((resolve, reject) => {
    const command = `Expand-Archive -LiteralPath '${JAVA_ZIP.replace(/'/g, "''")}' -DestinationPath '${JAVA_DIR.replace(/'/g, "''")}' -Force`;
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { windowsHide: true });
    let stderr = '';
    ps.stderr.on('data', data => { stderr += data.toString(); });
    ps.on('error', reject);
    ps.on('close', code => code === 0 ? resolve() : reject(new Error(`Extraction de Java échouée (${code}) ${stderr}`)));
  });

  let java = null;
  function walk(dir, depth = 0) {
    if (depth > 5 || java) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'java.exe' && full.toLowerCase().endsWith(`${path.sep}bin${path.sep}java.exe`)) {
        java = full;
        return;
      }
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  }

  walk(JAVA_DIR);
  if (!java || !isJava17(java)) {
    throw new Error('Java 17 x64 a été téléchargé mais n’a pas pu être initialisé.');
  }

  try { fs.rmSync(JAVA_ZIP, { force: true }); } catch (_) {}
  send('progress', { percent: 15, phase: 'Java 17 x64 installé' });
  send('status', { text: 'Java 17 x64 installé automatiquement.' });
  return java;
}

async function installFabric(manifest) {
  const versionJson = fabricVersionJson(manifest);
  if (fs.existsSync(versionJson)) return;

  const installerPath = path.join(GAME_DIR, 'fabric-installer.jar');
  const java = await installJava17();
  await download(FABRIC_INSTALLER_URL, installerPath, 'Fabric Installer');

  send('status', { text: `Installation de Fabric Loader ${manifest.fabricLoader}...` });
  await new Promise((resolve, reject) => {
    const child = spawn(java, [
      '-jar', installerPath,
      'client',
      '-dir', GAME_DIR,
      '-mcversion', manifest.minecraft,
      '-loader', manifest.fabricLoader,
      '-noprofile',
      '-downloadMinecraft'
    ], { windowsHide: true, cwd: GAME_DIR });

    let stderr = '';
    child.stderr.on('data', data => { stderr += data.toString(); });
    child.stdout.on('data', data => {
      const text = data.toString().trim();
      if (text) send('status', { text: text.split(/\r?\n/).filter(Boolean).pop() });
    });
    child.on('error', error => reject(new Error(`Java/Fabric n'a pas pu démarrer : ${error.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Installation Fabric échouée (${code}). ${stderr.trim()}`)));
  });

  try { fs.rmSync(installerPath, { force: true }); } catch (_) {}
  if (!fs.existsSync(versionJson)) throw new Error(`Fabric n'a pas créé ${fabricVersionId(manifest)}.`);
}

async function getModrinthVersion(mod, manifest) {
  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.project)}/version`);
  url.searchParams.set('loaders', JSON.stringify(['fabric']));
  url.searchParams.set('game_versions', JSON.stringify([manifest.minecraft]));
  url.searchParams.set('version_type', 'release');

  const response = await fetch(url, { headers: { 'User-Agent': 'Novus-Launcher/1.1' } });
  if (!response.ok) throw new Error(`Modrinth : ${mod.name} (${response.status})`);
  const versions = await response.json();
  if (!Array.isArray(versions) || versions.length === 0) throw new Error(`Aucune version Fabric ${manifest.minecraft} compatible de ${mod.name}.`);

  const version = versions[0];
  const file = version.files?.find(f => f.primary) || version.files?.[0];
  if (!file?.url || !file?.filename) throw new Error(`Fichier de ${mod.name} introuvable sur Modrinth.`);
  return { version, file };
}

async function installModrinthMod(mod, manifest) {
  const { version, file } = await getModrinthVersion(mod, manifest);
  const destination = path.join(GAME_DIR, 'mods', path.basename(file.filename));
  const changed = await download(file.url, destination, `${mod.name} ${version.version_number}`, file.hashes?.sha256);
  return { ...mod, filename: path.basename(file.filename), version: version.version_number, sha256: file.hashes?.sha256 || null, changed };
}

function loadInstalledManifest() {
  try {
    if (!fs.existsSync(INSTALLED_MANIFEST_PATH)) return null;
    return JSON.parse(fs.readFileSync(INSTALLED_MANIFEST_PATH, 'utf8'));
  } catch (_) {
    return null;
  }
}

function manifestNeedsRepair(manifest) {
  const installed = loadInstalledManifest();
  if (!installed) return true;
  if (installed.version !== manifest.version || installed.minecraft !== manifest.minecraft || installed.fabricLoader !== manifest.fabricLoader) return true;
  if (!fs.existsSync(fabricVersionJson(manifest))) return true;
  const mods = manifest.mods || [];
  const installedMods = installed.installedMods || [];
  if (installedMods.length !== mods.length) return true;
  return false;
}

async function detectAndRepairMods(manifest) {
  const dir = path.join(GAME_DIR, 'mods');
  fs.mkdirSync(dir, { recursive: true });

  const currentJars = new Set(fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.jar')));
  const installed = loadInstalledManifest();
  const expected = new Set((installed?.installedMods || []).map(mod => mod.filename).filter(Boolean));
  const required = manifest.mods || [];

  send('status', { text: `Détection des mods : ${currentJars.size} fichier(s) trouvé(s)...` });

  const missingOrBroken = [];
  for (const mod of required) {
    const previous = (installed?.installedMods || []).find(x => x.project === mod.project);
    if (!previous?.filename || !currentJars.has(previous.filename)) {
      missingOrBroken.push(mod);
      continue;
    }
    if (previous.sha256) {
      const hash = await sha256(path.join(dir, previous.filename));
      if (hash.toLowerCase() !== previous.sha256.toLowerCase()) missingOrBroken.push(mod);
    }
  }

  if (missingOrBroken.length) {
    send('status', { text: `${missingOrBroken.length} mod(s) manquant(s) ou modifié(s) : réparation automatique...` });
    const repaired = [];
    for (let i = 0; i < missingOrBroken.length; i++) {
      repaired.push(await installModrinthMod(missingOrBroken[i], manifest));
      send('progress', { percent: 25 + Math.round(((i + 1) / missingOrBroken.length) * 50), phase: `${missingOrBroken[i].name} vérifié` });
    }
  }

  // Remove only jars that Novus previously managed and that are no longer part of the manifest.
  const requiredProjects = new Set(required.map(mod => mod.project));
  for (const managed of installed?.installedMods || []) {
    if (managed.project && !requiredProjects.has(managed.project) && managed.filename) {
      const obsolete = path.join(dir, managed.filename);
      if (fs.existsSync(obsolete)) fs.rmSync(obsolete, { force: true });
    }
  }

  const finalJars = fs.readdirSync(dir).filter(name => name.toLowerCase().endsWith('.jar'));
  send('game-log', { text: `[NOVUS] Mods détectés : ${finalJars.length}` });
  for (const jar of finalJars) send('game-log', { text: `[NOVUS] Mod : ${jar}` });

  return finalJars;
}

async function install() {
  const manifest = readManifest();
  fs.mkdirSync(GAME_DIR, { recursive: true });
  send('progress', { percent: 2, phase: 'Préparation du modpack' });

  await installJava17();
  send('progress', { percent: 15, phase: 'Java prêt' });
  await installFabric(manifest);
  send('progress', { percent: 30, phase: 'Fabric prêt' });

  const mods = manifest.mods || [];
  const installedMods = [];
  for (let i = 0; i < mods.length; i++) {
    installedMods.push(await installModrinthMod(mods[i], manifest));
    send('progress', { percent: 30 + Math.round(((i + 1) / Math.max(1, mods.length)) * 45), phase: `${mods[i].name} installé` });
  }

  for (const file of manifest.files || []) {
    const root = path.resolve(GAME_DIR);
    const target = path.resolve(GAME_DIR, file.path);
    if (!target.startsWith(root + path.sep)) throw new Error(`Chemin interdit : ${file.path}`);
    await download(file.url, target, file.path, file.sha256);
  }

  fs.writeFileSync(INSTALLED_MANIFEST_PATH, JSON.stringify({
    ...manifest,
    installedAt: new Date().toISOString(),
    fabricVersionId: fabricVersionId(manifest),
    installedMods
  }, null, 2));

  send('progress', { percent: 100, phase: 'Installation terminée' });
  send('status', { text: 'Novus est prêt à jouer.' });
  send('installed', { installed: true, gameDir: GAME_DIR, mods: installedMods });
  return { ok: true, gameDir: GAME_DIR, mods: installedMods };
}

async function ensureReady(manifest) {
  fs.mkdirSync(GAME_DIR, { recursive: true });
  const needsInstall = manifestNeedsRepair(manifest);
  if (needsInstall) {
    send('status', { text: 'Installation/mise à jour de Novus...' });
    await install();
  } else {
    await installJava17();
    await installFabric(manifest);
    await detectAndRepairMods(manifest);
  }

  if (!fs.existsSync(fabricVersionJson(manifest))) throw new Error(`Fabric est incomplet : ${fabricVersionId(manifest)}.`);
  await detectAndRepairMods(manifest);
}

async function launch(server) {
  const manifest = readManifest();
  if (launchInProgress || gameProcess) throw new Error('Minecraft est déjà en cours de lancement ou déjà lancé.');

  await ensureReady(manifest);
  const java = await installJava17();
  const versionId = fabricVersionId(manifest);
  const versionJson = fabricVersionJson(manifest);

  send('game-log', { text: `[NOVUS] Java : ${java}` });
  send('game-log', { text: `[NOVUS] Fabric : ${versionId}` });
  send('game-log', { text: `[NOVUS] Version JSON : ${versionJson}` });
  send('game-log', { text: `[NOVUS] Minecraft : ${GAME_DIR}` });

  launchInProgress = true;
  const launcher = new Client();
  gameLauncher = launcher;

  launcher.on('debug', message => send('game-log', { text: `[MCLC] ${String(message)}` }));
  launcher.on('data', message => send('game-log', { text: String(message) }));
  launcher.on('arguments', args => send('game-log', { text: `[MCLC] Arguments : ${Array.isArray(args) ? args.join(' ') : String(args)}` }));
  launcher.on('download-status', progress => send('game-progress', progress));
  launcher.on('error', error => send('game-error', { message: error?.stack || error?.message || String(error) }));
  launcher.on('close', code => {
    gameProcess = null;
    gameLauncher = null;
    launchInProgress = false;
    send('game-exit', { code });
    send('status', { text: code === 0 ? 'Minecraft est fermé.' : `Minecraft s’est arrêté avec le code ${code}.` });
  });

  const options = {
    authorization: offlineAuth(manifest.playerName || 'NovusPlayer'),
    root: GAME_DIR,
    version: {
      number: manifest.minecraft,
      type: 'release',
      custom: versionId
    },
    memory: {
      max: manifest.memoryMax || '4G',
      min: manifest.memoryMin || '2G'
    },
    javaPath: java
  };

  const targetServer = server?.host ? server : manifest.server;
  if (targetServer?.host) {
    options.server = {
      host: String(targetServer.host),
      port: Number(targetServer.port || 25565)
    };
  }

  send('progress', { percent: 100, phase: 'Lancement de Novus...' });
  send('status', { text: options.server ? `Connexion à ${options.server.host}...` : 'Lancement de Novus...' });

  try {
    // MCLC returns the actual ChildProcess. Do not override its paths: its
    // resolver needs to read the Fabric version JSON and assemble libraries,
    // natives and assets itself.
    const processHandle = await launcher.launch(options);
    if (!processHandle || typeof processHandle.on !== 'function') {
      throw new Error('Minecraft n’a pas retourné de processus. Consulte les logs [MCLC].');
    }

    gameProcess = processHandle;
    launchInProgress = false;
    processHandle.on('error', error => send('game-error', { message: `Processus Minecraft : ${error.stack || error.message}` }));
    processHandle.on('exit', (code, signal) => send('game-log', { text: `[NOVUS] Processus terminé : code=${code}, signal=${signal || 'none'}` }));

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
  return {
    access_token: '0',
    client_token: crypto.randomUUID(),
    uuid,
    name,
    user_properties: '{}',
    meta: { type: 'mojang' }
  };
}

ipcMain.handle('get-info', () => {
  const manifest = readManifest();
  const installed = loadInstalledManifest();
  const modsDir = path.join(GAME_DIR, 'mods');
  const detectedMods = fs.existsSync(modsDir) ? fs.readdirSync(modsDir).filter(name => name.toLowerCase().endsWith('.jar')) : [];
  return {
    name: manifest.name,
    version: manifest.version,
    minecraft: manifest.minecraft,
    loader: manifest.loader,
    fabricLoader: manifest.fabricLoader,
    gameDir: GAME_DIR,
    installed: Boolean(installed && fs.existsSync(fabricVersionJson(manifest))),
    mods: manifest.mods || [],
    detectedMods,
    server: manifest.server || {}
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

ipcMain.handle('launch', async (_event, server) => {
  try {
    return await launch(server);
  } catch (error) {
    send('error', { message: error.stack || error.message });
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('open-game-dir', () => {
  shell.openPath(GAME_DIR);
  return GAME_DIR;
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
