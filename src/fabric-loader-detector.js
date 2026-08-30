const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function compareVersions(a, b) {
  const pa = String(a).split(/[.+-]/).map(x => Number.parseInt(x, 10)).map(n => Number.isFinite(n) ? n : 0);
  const pb = String(b).split(/[.+-]/).map(x => Number.parseInt(x, 10)).map(n => Number.isFinite(n) ? n : 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function minimumFromPredicate(predicate) {
  if (Array.isArray(predicate)) {
    const candidates = predicate.map(minimumFromPredicate).filter(Boolean).sort(compareVersions);
    return candidates[0] || null;
  }
  if (typeof predicate !== 'string' || !predicate.trim() || predicate.trim() === '*') return null;
  const value = predicate.trim();
  const match = value.match(/(?:^|\s)(?:>=|>|=|~|\^)?\s*(\d+(?:\.\d+){0,3})/);
  if (!match) return null;
  const version = match[1];
  if (value.startsWith('>') && !value.startsWith('>=')) {
    const parts = version.split('.').map(Number);
    parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
    return parts.join('.');
  }
  return version;
}

function extractMinimumFabricLoader(metadata) {
  const dependency = metadata?.depends?.fabricloader ?? metadata?.depends?.['fabric-loader'];
  return dependency ? minimumFromPredicate(dependency) : null;
}

async function readFabricMetadata(jarPath) {
  const buffer = await fs.promises.readFile(jarPath);
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('fabric.mod.json');
  if (!entry) return null;
  try { return JSON.parse(await entry.async('string')); } catch (_) { return null; }
}

async function detectFabricLoader(gameDir, send = () => {}) {
  const modsDir = path.join(gameDir, 'mods');
  if (!fs.existsSync(modsDir)) return { version: null, mods: [] };

  const jars = (await fs.promises.readdir(modsDir)).filter(name => name.toLowerCase().endsWith('.jar'));
  const requirements = [];
  const mods = [];

  for (const filename of jars) {
    try {
      const metadata = await readFabricMetadata(path.join(modsDir, filename));
      if (!metadata) continue;
      const required = extractMinimumFabricLoader(metadata);
      mods.push({ file: filename, id: metadata.id || filename, version: metadata.version || 'unknown', fabricLoader: required });
      if (required) requirements.push(required);
    } catch (error) {
      send(`[NOVUS] Impossible de lire ${filename}: ${error.message}`);
    }
  }

  requirements.sort(compareVersions);
  const version = requirements.length ? requirements[requirements.length - 1] : null;
  if (version) send(`[NOVUS] Fabric Loader minimal détecté automatiquement : ${version}`);
  return { version, mods };
}

module.exports = { compareVersions, extractMinimumFabricLoader, detectFabricLoader };
