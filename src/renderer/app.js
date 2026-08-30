const $ = id => document.getElementById(id);
const pages = { home: 'ACCUEIL', modpack: 'MODPACK', server: 'SERVEUR', settings: 'PARAMÈTRES' };
let info = null;

function setStatus(text, error = false) { $('status').textContent = text; $('status').classList.toggle('status-error', error); }
function setProgress(percent, phase) { const value = Math.max(0, Math.min(100, Number(percent) || 0)); $('bar').style.width = `${value}%`; $('percent').textContent = `${value}%`; if (phase) $('phase').textContent = phase; }
function setButtons(busy) { $('play').disabled = busy || !info?.installed; $('install').disabled = busy; $('modInstall').disabled = busy; $('playServer').disabled = busy || !info?.installed; }
function renderMods() {
  const list = $('modList'); list.innerHTML = '';
  for (const mod of info?.mods || []) { const row = document.createElement('div'); row.className = 'mod-row'; row.innerHTML = `<div class="mod-icon">◆</div><div><strong>${mod.name}</strong><small>Modrinth • Fabric • Minecraft ${info.minecraft}</small></div><span class="mod-ok">AUTO</span>`; list.appendChild(row); }
}
function loadServerFields() {
  const s = info?.server || {}; $('serverInputName').value = s.name || 'Novus Modded'; $('serverInputHost').value = s.host || ''; $('serverInputPort').value = s.port || 25565;
  $('serverName').textContent = s.name || 'Novus Modded'; $('serverHost').textContent = s.host || 'Serveur à configurer'; $('serverPort').textContent = s.port || 25565;
  $('serverBadge').textContent = s.host ? 'CONFIGURÉ' : 'À CONFIGURER';
}
async function refresh() {
  info = await window.novus.getInfo();
  $('packName').textContent = info.name; $('version').textContent = info.version; $('packVersion').textContent = info.version;
  $('details').textContent = `Minecraft ${info.minecraft} • ${info.loader} ${info.fabricLoader || ''} • ${info.mods.length} mods`;
  $('gameDir').textContent = info.gameDir; $('accountName').textContent = localStorage.getItem('novusPlayer') || 'Novus Player';
  $('playerName').value = localStorage.getItem('novusPlayer') || 'NovusPlayer'; $('memoryMax').value = localStorage.getItem('novusMemoryMax') || '4G'; $('memoryMin').value = localStorage.getItem('novusMemoryMin') || '2G';
  loadServerFields(); renderMods(); setButtons(false);
  setStatus(info.installed ? 'Prêt à jouer' : 'Prêt à installer');
  $('phase').textContent = info.installed ? 'Novus est installé et vérifié.' : 'Installe Minecraft, Fabric et les mods.';
}
async function doInstall() {
  setButtons(true); setProgress(0, 'Préparation...'); setStatus('Installation en cours...');
  const result = await window.novus.install();
  if (result.ok) { setProgress(100, 'Installation terminée'); setStatus('Prêt à jouer'); await refresh(); }
  else { setStatus(`Échec : ${result.error}`, true); setButtons(false); }
}
async function play(server = null) {
  setButtons(true); setStatus(server ? 'Connexion au serveur...' : 'Lancement de Novus...');
  const result = await window.novus.launch(server);
  if (!result.ok) { setStatus(`Échec : ${result.error}`, true); setButtons(false); }
}

document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(x => x.classList.remove('active')); button.classList.add('active');
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active-page'));
  $(`page-${button.dataset.page}`).classList.add('active-page'); $('crumb').textContent = pages[button.dataset.page];
}));
$('install').addEventListener('click', doInstall); $('modInstall').addEventListener('click', doInstall); $('play').addEventListener('click', () => play());
$('openDir').addEventListener('click', () => window.novus.openGameDir());
$('saveServer').addEventListener('click', () => { const host = $('serverInputHost').value.trim(); const port = Number($('serverInputPort').value); if (!host) { $('serverMessage').textContent = 'Entre une adresse de serveur.'; return; } if (!port || port < 1 || port > 65535) { $('serverMessage').textContent = 'Port invalide.'; return; } localStorage.setItem('novusServer', JSON.stringify({ name: $('serverInputName').value.trim() || 'Novus Modded', host, port })); info.server = { name: $('serverInputName').value.trim() || 'Novus Modded', host, port }; loadServerFields(); $('serverMessage').textContent = 'Serveur enregistré dans ce launcher.'; });
$('playServer').addEventListener('click', () => { const host = $('serverInputHost').value.trim(); const port = Number($('serverInputPort').value); if (host) play({ host, port }); else $('serverMessage').textContent = 'Configure le serveur avant de jouer.'; });
$('saveSettings').addEventListener('click', () => { const name = $('playerName').value.trim() || 'NovusPlayer'; localStorage.setItem('novusPlayer', name); localStorage.setItem('novusMemoryMax', $('memoryMax').value.trim() || '4G'); localStorage.setItem('novusMemoryMin', $('memoryMin').value.trim() || '2G'); $('accountName').textContent = name; setStatus('Paramètres enregistrés'); });
window.novus.onStatus(data => setStatus(data.text)); window.novus.onProgress(data => setProgress(data.percent, data.phase)); window.novus.onInstalled(() => refresh());
window.novus.onError(data => { setStatus(`Erreur : ${data.message}`, true); setButtons(false); }); window.novus.onGameError(data => { setStatus(`Minecraft : ${data.message}`, true); setButtons(false); });
window.novus.onGameExit(data => { setStatus(`Minecraft fermé (${data.code ?? 0})`); setButtons(false); });
refresh().catch(error => setStatus(`Erreur : ${error.message}`, true));
