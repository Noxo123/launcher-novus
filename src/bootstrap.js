// Novus bootstrap: Java normalization + automatic Fabric Loader detection.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { detectFabricLoader, compareVersions } = require('./fabric-loader-detector');

const originalExecFileSync = childProcess.execFileSync;
const originalSpawnSync = childProcess.spawnSync;

childProcess.execFileSync = function patchedExecFileSync(file, args = [], options = {}) {
  const isVersionCheck = Array.isArray(args) && args.length === 1 && args[0] === '-version';
  if (!isVersionCheck) return originalExecFileSync.call(childProcess, file, args, options);

  const result = originalSpawnSync.call(childProcess, file, args, {
    ...options,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${file} -version`);
    error.status = result.status;
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    throw error;
  }
  return output;
};

async function prepareAutomaticFabricLoader() {
  const manifestPath = path.resolve(__dirname, '..', 'modpack', 'manifest.json');
  const gameDir = path.join(app.getPath('userData'), 'minecraft');

  if (!fs.existsSync(manifestPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return;
  }

  const detected = await detectFabricLoader(gameDir, text => console.log(text));
  if (!detected.version) return;

  const configured = manifest.fabricLoader || '0.0.0';
  if (compareVersions(detected.version, configured) <= 0) return;

  manifest.fabricLoader = detected.version;
  manifest.version = `${manifest.version || '0.1.0'}-auto-loader`;

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(file, options) {
    if (path.resolve(String(file)) === manifestPath) {
      const encoding = typeof options === 'string' ? options : options?.encoding;
      const content = JSON.stringify(manifest, null, 2);
      return encoding === 'buffer' ? Buffer.from(content) : content;
    }
    return originalReadFileSync.call(fs, file, options);
  };

  console.log(`[NOVUS] Loader manifest ajusté automatiquement vers ${detected.version}.`);
}

prepareAutomaticFabricLoader()
  .catch(error => console.warn(`[NOVUS] Détection Fabric ignorée : ${error.message}`))
  .finally(() => require('./main.js'));
