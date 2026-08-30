const fs = require('fs');
const path = require('path');

function safeReadManifest(manifestPath) {
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    if (!manifest || typeof manifest !== 'object') return null;
    if (!manifest.minecraft) return null;
    return manifest;
  } catch (_) {
    return null;
  }
}

function makeId(dir) {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'modpack';
}

function scanRoot(root, source, recursive = false) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;

  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return found; }

  const candidates = [];
  if (fs.existsSync(path.join(root, 'manifest.json'))) candidates.push(root);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    candidates.push(path.join(root, entry.name));
  }

  for (const dir of candidates) {
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = safeReadManifest(manifestPath);
    if (manifest) {
      found.push({
        id: makeId(dir),
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

    if (recursive) {
      for (const nested of scanRoot(dir, source, false)) found.push(nested);
    }
  }

  return found;
}

function scanModpacks(baseDirs) {
  const all = [];
  const seen = new Set();
  for (const item of baseDirs) {
    const root = item?.path;
    if (!root) continue;
    for (const pack of scanRoot(root, item.source || 'local', Boolean(item.recursive))) {
      const key = path.resolve(pack.directory).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(pack);
    }
  }
  return all.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

module.exports = { scanModpacks };
