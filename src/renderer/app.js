const $ = id => document.getElementById(id);
const on = (id, event, handler) => { const el = $(id); if (el) el.addEventListener(event, handler); };
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value ?? ''; };
const setValue = (id, value) => { const el = $(id); if (el) el.value = value ?? ''; };
const setDisabled = (id, value) => { const el = $(id); if (el) el.disabled = !!value; };
const pages = { home:'ACCUEIL', modpack:'MODPACK', server:'SERVEUR', settings:'PARAMÈTRES' };
let info = null;
let discoveredPacks = [];
let selectedPack = null;

function setStatus(text, error=false) {
  setText('status', text);
  setText('topState', error ? 'ERREUR' : String(text).toUpperCase());
  const el = $('status'); if (el) el.classList.toggle('status-error', error);
}
function setProgress(percent, phase) {
  const v = Math.max(0, Math.min(100, Number(percent) || 0));
  const bar = $('bar'); if (bar) bar.style.width = `${v}%`;
  setText('percent', `${v}%`);
  if (phase) setText('phase', phase);
}
function setButtons(busy) {
  setDisabled('play', busy || !info?.installed);
  setDisabled('install', busy);
  setDisabled('modInstall', busy);
  setDisabled('playServer', busy || !info?.installed);
}
function pathEquals(a,b) { return !!a && !!b && String(a).replaceAll('\\','/').toLowerCase() === String(b).replaceAll('\\','/').toLowerCase(); }

function renderMods() {
  const list = $('modList'); if (!list) return;
  list.innerHTML = '';
  const mods = info?.mods || [];
  setText('modCount', mods.length);
  setText('tagMods', `${mods.length} MODS`);
  for (const mod of mods) {
    const row=document.createElement('div'); row.className='mod-row';
    const icon=document.createElement('div'); icon.className='mod-icon'; icon.textContent='◆';
    const body=document.createElement('div');
    const name=document.createElement('strong'); name.textContent=mod.name||mod.project||'Mod';
    const meta=document.createElement('small'); meta.textContent=`Fabric • Minecraft ${info?.minecraft||'?'}`;
    body.append(name,meta);
    const ok=document.createElement('span'); ok.className='mod-ok'; ok.textContent='AUTO';
    row.append(icon,body,ok); list.appendChild(row);
  }
}
function renderPackDiscovery() {
  const list=$('packList'); if (!list) return;
  list.innerHTML='';
  const count=discoveredPacks.length;
  setText('packCount',`${count} modpack${count>1?'s':''} détecté${count>1?'s':''}`);
  if(!count){const e=document.createElement('div');e.className='pack-empty';e.textContent='Aucun modpack trouvé.';list.appendChild(e);return;}
  for(const pack of discoveredPacks){
    const card=document.createElement('article'); card.className='pack-card';
    if(selectedPack&&pathEquals(pack.directory,selectedPack.directory)) card.classList.add('current-pack');
    card.addEventListener('click',()=>selectPack(pack));
    const icon=document.createElement('div');icon.className='pack-icon';icon.textContent='N';
    const body=document.createElement('div');body.className='pack-card-body';
    const title=document.createElement('strong');title.textContent=pack.name||'Modpack';
    const version=document.createElement('small');version.textContent=`v${pack.version||'1.0.0'} • Minecraft ${pack.minecraft||'?'} • ${pack.loader||'Fabric'}${pack.fabricLoader?' '+pack.fabricLoader:''}`;
    const source=document.createElement('span');source.textContent=`${pack.mods||0} mod${pack.mods===1?'':'s'} • ${pack.source||'local'}`;
    body.append(title,version,source);
    const badge=document.createElement('b');badge.textContent=selectedPack&&pathEquals(pack.directory,selectedPack.directory)?'SÉLECTIONNÉ':'SÉLECTIONNER';
    card.append(icon,body,badge);list.appendChild(card);
  }
}
async function refreshPacks(){
  try{discoveredPacks=await window.novus.getModpacks();if(selectedPack){const same=discoveredPacks.find(p=>pathEquals(p.directory,selectedPack.directory));if(same)selectedPack=same;}renderPackDiscovery();}
  catch(e){discoveredPacks=[];renderPackDiscovery();setStatus(`Impossible de lire les modpacks : ${e.message}`,true);}
}
async function selectPack(pack){
  if(selectedPack&&pathEquals(pack.directory,selectedPack.directory)) return;
  setStatus(`Sélection de ${pack.name||'modpack'}...`);
  try{
    const result=await window.novus.selectModpack(pack);
    if(!result?.ok){setStatus(`Échec : ${result?.error||'sélection impossible'}`,true);return;}
    selectedPack=result.pack||pack; info=await window.novus.getInfo(); updateUI(); renderPackDiscovery();
    setStatus(info.installed?'Prêt à jouer':'Prêt à installer');
  }catch(e){setStatus(`Échec : ${e.message}`,true);}
}
function loadServerFields(){
  const s=info?.server||{};
  setValue('serverInputName',s.name||'Novus Modded');setValue('serverInputHost',s.host||'');setValue('serverInputPort',s.port||25565);
  setText('serverName',s.name||'Novus Modded');setText('serverHost',s.host||'Serveur à configurer');setText('serverPort',s.port||25565);setText('serverBadge',s.host?'CONFIGURÉ':'À CONFIGURER');
}
function updateUI(){
  const mods=info?.mods||[];
  setText('packName',info?.name||'Sélectionne un modpack.');
  setText('version',info?.version||'—');
  setText('details',`Minecraft ${info?.minecraft||'?'} • ${info?.loader||'Fabric'} ${info?.fabricLoader||''} • ${mods.length} mods`);
  setText('packCardTitle',`${info?.loader||'Fabric'}${mods.length?` • ${mods.length} mods`:''}`);
  setText('gameDir',info?.gameDir||'Chargement…');
  setText('accountName',localStorage.getItem('novusPlayer')||'Novus Player');
  setValue('playerName',localStorage.getItem('novusPlayer')||'NovusPlayer');setValue('memoryMax',localStorage.getItem('novusMemoryMax')||'4G');setValue('memoryMin',localStorage.getItem('novusMemoryMin')||'2G');
  setText('tagLoader',String(info?.loader||'FABRIC').toUpperCase());setText('tagMods',`${mods.length} MODS`);
  loadServerFields();renderMods();setButtons(false);
}
async function refresh(){
  try{info=await window.novus.getInfo();selectedPack=info?.selectedPack||selectedPack;updateUI();setStatus(info?.installed?'Prêt à jouer':'Prêt à installer');setText('phase',info?.installed?'Modpack installé et vérifié.':'Installe Minecraft, Fabric et les mods.');}
  catch(e){setStatus(`Erreur de chargement : ${e.message}`,true);setButtons(false);}
}
async function doInstall(){
  setButtons(true);setProgress(0,'Préparation...');setStatus('Installation en cours...');
  try{const r=await window.novus.install();if(r?.ok){setProgress(100,'Installation terminée');await refresh();await refreshPacks();}else{setStatus(`Échec : ${r?.error||'installation impossible'}`,true);setButtons(false);}}
  catch(e){setStatus(`Échec : ${e.message}`,true);setButtons(false);}
}
async function addLocalMod(){
  try{setStatus('Ajout du mod...');const r=await window.novus.addLocalMod();if(r?.ok){await refresh();await refreshPacks();setStatus('Mod ajouté et analysé.');}else if(r?.cancelled){setStatus('Ajout annulé.');}else setStatus(`Échec : ${r?.error||'ajout impossible'}`,true);}
  catch(e){setStatus(`Échec : ${e.message}`,true);}
}
async function runSecurityAudit(){
  const list=$('auditList');setText('auditSummary','Analyse…');if(list)list.innerHTML='<p>Analyse des resource packs en cours…</p>';
  try{const r=await window.novus.securityAudit();const items=r?.packs||r?.resources||[];setText('auditSummary',r?.safe===false?'ATTENTION':'CONTRÔLÉ');setText('securityBadge',r?.safe===false?'SUSPECT':'OK');setText('securityTitle',r?.safe===false?'Ressources suspectes détectées':'Ressources contrôlées');setText('securityText',r?.summary||`${items.length} resource pack(s) analysé(s).`);if(list){list.innerHTML='';if(!items.length){list.innerHTML='<p>Aucun resource pack trouvé.</p>';}else for(const item of items){const p=document.createElement('p');p.textContent=`${item.name||item.file||'Resource pack'} — ${item.suspicious?'SUSPECT':'OK'}`;list.appendChild(p);}}}
  catch(e){setText('auditSummary','ERREUR');if(list)list.innerHTML=`<p>Audit impossible : ${e.message}</p>`;}
}
async function play(server=null){
  setButtons(true);setStatus(server?'Connexion au serveur...':'Lancement de Novus...');
  try{const r=await window.novus.launch(server);if(!r?.ok){setStatus(`Échec : ${r?.error||'Minecraft n’a pas pu être lancé.'}`,true);setButtons(false);}}
  catch(e){setStatus(`Échec : ${e.message}`,true);setButtons(false);}
}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.page').forEach(x=>x.classList.remove('active-page'));const page=$(`page-${b.dataset.page}`);if(page)page.classList.add('active-page');setText('crumb',pages[b.dataset.page]||'ACCUEIL');}));
on('install','click',doInstall);on('modInstall','click',doInstall);on('play','click',()=>play());on('openDir','click',()=>window.novus.openGameDir());on('refreshPacks','click',refreshPacks);on('addMod','click',addLocalMod);on('modAdd2','click',addLocalMod);on('runAudit','click',runSecurityAudit);on('quickRefresh','click',async()=>{await refresh();await refreshPacks();});on('quickFolder','click',()=>window.novus.openGameDir());
on('saveServer','click',()=>{const host=($('serverInputHost')?.value||'').trim(),port=Number($('serverInputPort')?.value);if(!host){setText('serverMessage','Entre une adresse de serveur.');return;}if(!port||port<1||port>65535){setText('serverMessage','Port invalide.');return;}const server={name:($('serverInputName')?.value||'').trim()||'Novus Modded',host,port};localStorage.setItem('novusServer',JSON.stringify(server));if(info)info.server=server;loadServerFields();setText('serverMessage','Serveur enregistré.');});
on('playServer','click',()=>{const host=($('serverInputHost')?.value||'').trim(),port=Number($('serverInputPort')?.value);if(host)play({host,port});else setText('serverMessage','Configure le serveur avant de jouer.');});
on('saveSettings','click',()=>{const n=($('playerName')?.value||'').trim()||'NovusPlayer';localStorage.setItem('novusPlayer',n);localStorage.setItem('novusMemoryMax',($('memoryMax')?.value||'4G').trim()||'4G');localStorage.setItem('novusMemoryMin',($('memoryMin')?.value||'2G').trim()||'2G');setText('accountName',n);setStatus('Paramètres enregistrés');});
if(window.novus){
  window.novus.onStatus(d=>setStatus(d?.text||'Novus'));
  window.novus.onProgress(d=>setProgress(d?.percent,d?.phase));
  window.novus.onInstalled(()=>refresh());
  window.novus.onError(d=>{setStatus(`Erreur : ${d?.message||'erreur inconnue'}`,true);setButtons(false);});
  window.novus.onGameError(d=>{setStatus(`Minecraft : ${d?.message||'erreur de lancement'}`,true);setButtons(false);});
  window.novus.onGameExit(d=>{setStatus(`Minecraft fermé (${d?.code??0})`);setButtons(false);});
}
Promise.all([refresh(),refreshPacks()]).catch(e=>setStatus(`Erreur : ${e.message}`,true));
