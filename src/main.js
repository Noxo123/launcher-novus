const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Client } = require('minecraft-launcher-core');

const GAME_DIR = path.join(app.getPath('userData'), 'minecraft');
const MANIFEST_PATH = path.join(__dirname, '..', 'modpack', 'manifest.json');
const FABRIC_INSTALLER_URL = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.3/fabric-installer-1.0.3.jar';
let win;

function send(event, payload) { if (win && !win.isDestroyed()) win.webContents.send(event, payload); }
function createWindow() {
  win = new BrowserWindow({ width: 1200, height: 760, minWidth: 950, minHeight: 650, backgroundColor: '#080a0f', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
function readManifest() { return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); }
function sha256(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file); stream.on('error', reject); stream.on('data', c => hash.update(c)); stream.on('end', () => resolve(hash.digest('hex'))); }); }
function offlineAuth(name = 'NovusPlayer') {
  const uuid = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest('hex');
  return { access_token: '0', client_token: crypto.randomUUID(), uuid, name, user_properties: '{}', meta: { type: 'mojang' } };
}
async function download(url, destination, label, expectedSha256) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && expectedSha256 && (await sha256(destination)).toLowerCase() === expectedSha256.toLowerCase()) return;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  if (expectedSha256 && (await sha256(destination)).toLowerCase() !== expectedSha256.toLowerCase()) { fs.rmSync(destination, { force: true }); throw new Error(`Hash SHA-256 invalide pour ${label}`); }
  send('progress', { phase: label, current: buffer.length, total: Number(response.headers.get('content-length') || buffer.length), percent: 100 });
}
async function installFabric(manifest) {
  const installerPath = path.join(GAME_DIR, 'fabric-installer.jar');
  send('status', { text: 'Téléchargement de Fabric...' });
  await download(FABRIC_INSTALLER_URL, installerPath, 'Fabric');
  send('status', { text: 'Installation de Fabric...' });
  await new Promise((resolve, reject) => {
    const child = spawn('java', ['-jar', installerPath, 'client', '-dir', GAME_DIR, '-mcversion', manifest.minecraft, '-loader', manifest.fabricLoader || '0.16.14', '-noprofile'], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', d => stderr += d.toString());
    child.stdout.on('data', d => send('status', { text: d.toString().trim() }));
    child.on('error', e => reject(new Error(`Java est introuvable. Installe Java 17 et ajoute-le au PATH. ${e.message}`)));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(`Installation Fabric échouée (${code}). ${stderr}`)));
  });
  fs.rmSync(installerPath, { force: true });
}
async function installModrinthMod(mod, manifest) {
  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(mod.project)}/version`);
  url.searchParams.set('loaders', JSON.stringify(['fabric'])); url.searchParams.set('game_versions', JSON.stringify([manifest.minecraft])); url.searchParams.set('version_type', 'release');
  const response = await fetch(url); if (!response.ok) throw new Error(`Modrinth : version compatible introuvable pour ${mod.name}`);
  const versions = await response.json(); if (!versions.length) throw new Error(`Aucune version compatible de ${mod.name}`);
  const version = versions[0]; const file = version.files.find(f => f.primary) || version.files[0];
  await download(file.url, path.join(GAME_DIR, 'mods', path.basename(file.filename)), mod.name, file.hashes?.sha256);
  send('status', { text: `${mod.name} ${version.version_number} installé.` });
}
async function prepareMinecraft(manifest) {
  send('status', { text: `Préparation de Minecraft ${manifest.minecraft}...` });
  const launcher = new Client();
  const proc = launcher.launch({ authorization: offlineAuth(), root: GAME_DIR, version: { number: manifest.minecraft, type: 'release' }, memory: { max: '6G', min: '2G' }, overrides: { detached: true } });
  await new Promise((resolve, reject) => {
    let done = false; const finish = () => { if (!done) { done = true; try { proc.kill(); } catch {} resolve(); } };
    launcher.on('debug', m => send('status', { text: String(m) })); launcher.on('download', m => send('status', { text: `Téléchargement : ${m}` })); launcher.on('error', reject); launcher.on('close', finish); setTimeout(finish, 5000);
  });
}
async function install() {
  const manifest = readManifest(); fs.mkdirSync(GAME_DIR, { recursive: true });
  await prepareMinecraft(manifest); await installFabric(manifest);
  for (const mod of manifest.mods || []) await installModrinthMod(mod, manifest);
  for (const file of manifest.files || []) {
    const target = path.resolve(GAME_DIR, file.path); if (!target.startsWith(path.resolve(GAME_DIR) + path.sep)) throw new Error(`Chemin interdit : ${file.path}`);
    await download(file.url, target, file.path, file.sha256);
  }
  fs.writeFileSync(path.join(GAME_DIR, 'novus-manifest.json'), JSON.stringify({ ...manifest, installedAt: new Date().toISOString() }, null, 2));
  send('status', { text: 'Installation terminée.' }); send('installed', { installed: true, gameDir: GAME_DIR }); return { ok: true, gameDir: GAME_DIR };
}
async function launch() {
  const installedFile = path.join(GAME_DIR, 'novus-manifest.json'); if (!fs.existsSync(installedFile)) throw new Error('Le modpack n’est pas installé.');
  const installed = JSON.parse(fs.readFileSync(installedFile, 'utf8')); const loader = installed.fabricLoader || '0.16.14';
  const launcher = new Client(); send('status', { text: 'Lancement de Minecraft...' });
  launcher.launch({ authorization: offlineAuth(), root: GAME_DIR, version: { number: `fabric-loader-${loader}-${installed.minecraft}`, type: 'custom' }, memory: { max: '6G', min: '2G' }, javaPath: 'java', overrides: { detached: true } });
  launcher.on('debug', m => send('status', { text: String(m) })); launcher.on('data', m => send('status', { text: String(m) })); launcher.on('close', code => send('game-exit', { code })); launcher.on('error', e => send('game-error', { message: e.message || String(e) }));
  send('status', { text: 'Minecraft est lancé.' }); return { ok: true };
}
ipcMain.handle('get-info', () => { const m = readManifest(); return { name: m.name, version: m.version, minecraft: m.minecraft, loader: m.loader, gameDir: GAME_DIR, installed: fs.existsSync(path.join(GAME_DIR, 'novus-manifest.json')) }; });
ipcMain.handle('install', async () => { try { return await install(); } catch (e) { send('error', { message: e.stack || e.message }); return { ok: false, error: e.message }; } });
ipcMain.handle('launch', async () => { try { return await launch(); } catch (e) { send('error', { message: e.stack || e.message }); return { ok: false, error: e.message }; } });
app.whenReady().then(createWindow); app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
