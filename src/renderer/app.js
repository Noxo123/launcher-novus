const $ = id => document.getElementById(id);
const installButton = $('install');
const playButton = $('play');

function setStatus(text) { $('status').textContent = text; }
function setProgress(percent, phase) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  $('bar').style.width = `${value}%`;
  $('percent').textContent = `${value}%`;
  if (phase) $('phase').textContent = phase;
}

async function refresh() {
  const info = await window.novus.getInfo();
  $('packName').textContent = info.name;
  $('version').textContent = `v${info.version}`;
  $('details').textContent = `Minecraft ${info.minecraft} • ${info.loader}`;
  $('gameDir').textContent = info.gameDir;
  playButton.disabled = !info.installed;
  setStatus(info.installed ? 'Prêt à jouer' : 'Prêt à installer');
}

installButton.addEventListener('click', async () => {
  installButton.disabled = true;
  playButton.disabled = true;
  setProgress(0, 'Préparation...');
  setStatus('Installation en cours...');
  const result = await window.novus.install();
  installButton.disabled = false;
  if (result.ok) {
    playButton.disabled = false;
    setProgress(100, 'Installation terminée');
    setStatus('Prêt à jouer');
  }
});

playButton.addEventListener('click', async () => {
  playButton.disabled = true;
  setStatus('Lancement de Minecraft...');
  await window.novus.launch();
  setTimeout(() => { playButton.disabled = false; }, 1500);
});

window.novus.onStatus(data => setStatus(data.text));
window.novus.onProgress(data => setProgress(data.percent, data.phase));
window.novus.onInstalled(() => refresh());
window.novus.onError(data => {
  setStatus(`Erreur : ${data.message}`);
  $('statusDot').classList.add('error');
  installButton.disabled = false;
  playButton.disabled = false;
});
window.novus.onGameError(data => setStatus(`Minecraft : ${data.message}`));
window.novus.onGameExit(data => setStatus(`Minecraft fermé (${data.code ?? 0})`));

refresh().catch(error => setStatus(`Erreur : ${error.message}`));
