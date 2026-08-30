const fs = require('fs');
const path = require('path');

function safeReadManifest(manifestPath) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object' || !manifest.minecraft) return null;
    return manifest;
  } catch (_) { return null; }
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
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    candidates.push(path.join(root, entry.name));
  }
  for (const dir of candidates) {
    const manifestPath = path.join(dir, 'manifest.json');
    const manifest = safeReadManifest(manifestPath);
    if (manifest) {
      found.push({
        id: makeId(dir), name: String(manifest.name || path.basename(dir)),
        version: String(manifest.version || '1.0.0'), minecraft: String(manifest.minecraft),
        loader: String(manifest.loader || 'fabric'), fabricLoader: manifest.fabricLoader ? String(manifest.fabricLoader) : null,
        mods: Array.isArray(manifest.mods) ? manifest.mods.length : 0, directory: dir, manifestPath, source
      });
    }
    if (recursive) for (const nested of scanRoot(dir, source, false)) found.push(nested);
  }
  return found;
}

function scanModpacks(baseDirs) {
  const all = [], seen = new Set();
  for (const item of baseDirs || []) {
    if (!item?.path) continue;
    for (const pack of scanRoot(item.path, item.source || 'local', Boolean(item.recursive))) {
      const key = path.resolve(pack.directory).toLowerCase();
      if (!seen.has(key)) { seen.add(key); all.push(pack); }
    }
  }
  return all.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

const SUSPICIOUS = [
  /(^|[\\/_-])x[-_ ]?ray(s)?([\\/_ .-]|$)/i,
  /fullbright/i, /wallhack/i, /ore.?xray/i, /see.?through/i,
  /diamond.?only/i, /cave.?finder/i, /entity.?finder/i
];
const ORE_PATHS = /(diamond|emerald|ancient.?debris|netherite|gold|iron|coal|copper|redstone|lapis|ore)/i;

function stringsFromFile(file) {
  try {
    const b = fs.readFileSync(file);
    return b.toString('latin1').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '\n');
  } catch (_) { return ''; }
}

function auditResourcePack(packFile) {
  const name = path.basename(packFile);
  const text = stringsFromFile(packFile);
  const suspicious = [];
  for (const re of SUSPICIOUS) if (re.test(name) || re.test(text)) suspicious.push(re.source.replace(/\\/g, ''));
  const oreHits = (text.match(ORE_PATHS/g) || []).length;
  const hasXray = suspicious.length > 0 || oreHits >= 12;
  return {
    file: name,
    path: packFile,
    status: hasXray ? 'suspicious' : 'clean',
    confidence: suspicious.length ? 'high' : oreHits >= 12 ? 'medium' : 'low',
    reasons: suspicious.length ? ['Nom ou contenu associé à une fonction de vision/triche détecté.'] : oreHits >= 12 ? ['Nombre élevé de références à des minerais détecté ; contrôle manuel recommandé.'] : [],
    note: 'Analyse heuristique : elle signale les packs suspects mais ne peut pas garantir à elle seule l’absence de triche.'
  };
}

function auditResourcePacks(packDirectory, runtimeDirectory) {
  const files = new Map();
  for (const root of [path.join(packDirectory || '', 'resourcepacks'), path.join(runtimeDirectory || '', 'resourcepacks')]) {
    if (!root || !fs.existsSync(root)) continue;
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) {}
    for (const e of entries) {
      if (e.isFile() && /\.(zip|mcpack)$/i.test(e.name)) files.set(e.name.toLowerCase(), path.join(root, e.name));
    }
  }
  const reports = [...files.values()].map(auditResourcePack);
  return { total: reports.length, suspicious: reports.filter(x => x.status === 'suspicious').length, packs: reports };
}

module.exports = { scanModpacks, auditResourcePacks };
