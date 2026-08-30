// Novus bootstrap: normalize Java version detection before loading the launcher.
// `java -version` writes its version to stderr on Windows/Java, while the
// launcher historically read only stdout. That made a valid Java 17 runtime
// look invalid after automatic installation.
const childProcess = require('child_process');
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

require('./main.js');
