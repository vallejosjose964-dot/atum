'use strict';

/**
 * ATUM frontend (UX PRO)
 * Endpoints (FastAPI):
 *   GET  /health
 *   POST /compute      {galaxy_name, rows:[{R_kpc,Vobs,Vgas,Vdisk,Vbul}]}
 *   POST /global_rms   {galaxies:[{galaxy_name, rows:[...]}]}
 *   POST /dwarfs       {galaxies:[...]}
 *   POST /micro        {particle?: "W"|"Z"|"MUON"}  (si existe)
 */

const $ = (id)=>document.getElementById(id);
const logEl = $('log');
const canvas = $('curve');
const ctx = canvas.getContext('2d');

const backendDot = $('backendDot');
const backendLabel = $('backendLabel');
const backendBaseInput = $('backendBase');

const repoZipUrl = $('repoZipUrl');
const btnLoadRepo = $('btnLoadRepo');
const fileSelect = $('fileSelect');
const btnPreview = $('btnPreview');

const btnPing = $('btnPing');
const btnCompute = $('btnCompute');
const btnGlobalRMS = $('btnGlobalRMS');
const btnReset = $('btnReset');

const microAStar = $('microAStar');
const microStatus = $('microStatus');

const btnPNG = $('btnPNG');
const btnCSV = $('btnCSV');

const resultsBody = $('resultsBody');

const btnW = $('btnW');
const btnZ = $('btnZ');
const btnMuon = $('btnMuon');
const btnGalaxies = $('btnGalaxies');
const btnClusters = $('btnClusters');
const btnDwarfs = $('btnDwarfs');

let zipObj = null;
let zipFiles = []; // {name, file}
let currentText = null;
let lastBlobUrl = null;

let activeMode = 'galaxies'; // galaxies | clusters | dwarfs
const DATASET_URLS = {
  galaxies: './Rotmod_LTG.zip',
  clusters: './LoCuSS.zip',
  dwarfs: './Rotmod_LTG.zip' // si tenés un dwarfs.zip, cambialo acá
};

const macroVCenter = document.getElementById('macroVCenter');
const macroVEdge   = document.getElementById('macroVEdge');
const macroVMax    = document.getElementById('macroVMax');
const macroRCenter = document.getElementById('macroRCenter');
const macroREdge   = document.getElementById('macroREdge');
const macroSlope   = document.getElementById('macroSlope');

// ---------- helpers ----------

function now(){
  const d = new Date();
  return d.toISOString().replace('T',' ').slice(0,19);
}
function log(msg){
  logEl.textContent += `[${now()}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setBackendStatus(state, label){
  backendDot.classList.remove('ok','bad');
  if(state === 'ok') backendDot.classList.add('ok');
  if(state === 'bad') backendDot.classList.add('bad');
  backendLabel.textContent = label;
}
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}
function baseUrl(){ return backendBaseInput.value.trim().replace(/\/$/,''); }

function setBusy(busy){
  const all = [btnPing, btnLoadRepo, btnPreview, btnCompute, btnGlobalRMS, btnReset, btnW, btnZ, btnMuon];
  for(const el of all) el.disabled = !!busy;
  // downloads no se tocan acá
}
function clearDownloads(){
  btnCSV.disabled = true;
  if(lastBlobUrl){ URL.revokeObjectURL(lastBlobUrl); lastBlobUrl=null; }
}

// ---------- canvas ----------
function clearCanvas(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.20)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  const gx=10, gy=8;
  for(let i=1;i<gx;i++){
    const x=i*canvas.width/gx;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for(let j=1;j<gy;j++){
    const y=j*canvas.height/gy;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
}
function drawAxes(bounds, xlabel, ylabel){
  const pad=80;
  ctx.strokeStyle='rgba(255,255,255,0.25)';
  ctx.lineWidth=2;

  ctx.beginPath(); ctx.moveTo(pad, canvas.height-pad); ctx.lineTo(canvas.width-pad, canvas.height-pad); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad, canvas.height-pad); ctx.lineTo(pad, pad); ctx.stroke();

  ctx.fillStyle='rgba(233,241,255,0.85)';
  ctx.font='16px Inter, system-ui';
  ctx.fillText(xlabel, canvas.width/2 - 28, canvas.height - 26);
  ctx.save();
  ctx.translate(26, canvas.height/2 + 20);
  ctx.rotate(-Math.PI/2);
  ctx.fillText(ylabel, 0, 0);
  ctx.restore();

  ctx.fillStyle='rgba(233,241,255,0.70)';
  ctx.font='12px Inter, system-ui';
  const ticks=5;
  for(let i=0;i<=ticks;i++){
    const t=i/ticks;
    const x=pad + t*(canvas.width-2*pad);
    const v=bounds.xmin + t*(bounds.xmax-bounds.xmin);
    ctx.fillText(v.toFixed(2), x-12, canvas.height-pad+18);
  }
  for(let j=0;j<=ticks;j++){
    const t=j/ticks;
    const y=canvas.height-pad - t*(canvas.height-2*pad);
    const v=bounds.ymin + t*(bounds.ymax-bounds.ymin);
    ctx.fillText(v.toFixed(2), 30, y+4);
  }
}
function boundsFor(a, b=null){
  let xmin=Infinity, xmax=-Infinity, ymin=Infinity, ymax=-Infinity;
  const eat=(arr)=>{
    for(const p of arr){
      xmin=Math.min(xmin,p.x); xmax=Math.max(xmax,p.x);
      ymin=Math.min(ymin,p.y); ymax=Math.max(ymax,p.y);
    }
  };
  eat(a);
  if(b && b.length) eat(b);
  const dx=(xmax-xmin)||1, dy=(ymax-ymin)||1;
  return { xmin:xmin-0.05*dx, xmax:xmax+0.05*dx, ymin:Math.max(0,ymin-0.08*dy), ymax:ymax+0.10*dy };
}
function plotSeries(series, bounds, label, stroke){
  const pad=80;
  const xscale=(canvas.width-2*pad)/(bounds.xmax-bounds.xmin || 1);
  const yscale=(canvas.height-2*pad)/(bounds.ymax-bounds.ymin || 1);
  const X=(x)=> pad + (x-bounds.xmin)*xscale;
  const Y=(y)=> canvas.height-pad - (y-bounds.ymin)*yscale;

  ctx.strokeStyle=stroke;
  ctx.lineWidth=2.4;
  ctx.beginPath();
  for(let i=0;i<series.length;i++){
    const p=series[i];
    const x=X(p.x), y=Y(p.y);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.fillStyle='rgba(233,241,255,0.85)';
  for(const p of series){
    const x=X(p.x), y=Y(p.y);
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  }

  ctx.fillStyle='rgba(233,241,255,0.88)';
  ctx.font='13px Inter, system-ui';
  ctx.fillText(label, pad+10, 36);
}
function renderCurve(obs, model, label){
  clearCanvas();
  const b=boundsFor(obs, model);
  drawAxes(b, 'r (kpc)', 'V (km/s)');
  plotSeries(obs, b, `OBS: ${label}`, 'rgba(110,231,255,0.95)');
  if(model && model.length){
    plotSeries(model, b, `MODEL`, 'rgba(167,139,250,0.88)');
  }
}

// ---------- parsing ----------
function parseSPARCDat(text){
  const lines=text.replace(/\r/g,'').split('\n')
    .map(l=>l.trim())
    .filter(l=>l && !l.startsWith('#'));
  if(lines.length<2) throw new Error('Archivo .dat sin datos.');
  const rows=[];
  const obs=[];
  for(const l of lines){
    const cols=l.split(/\s+/);
    if(cols.length < 6) continue;
    const R=Number(cols[0]);
    const Vobs=Number(cols[1]);
    const Vgas=Number(cols[3]);
    const Vdisk=Number(cols[4]);
    const Vbul=Number(cols[5]);
    if(!Number.isFinite(R) || !Number.isFinite(Vobs)) continue;
    rows.push({R_kpc:R, Vobs, Vgas:(Number.isFinite(Vgas)?Vgas:0), Vdisk:(Number.isFinite(Vdisk)?Vdisk:0), Vbul:(Number.isFinite(Vbul)?Vbul:0)});
    obs.push({x:R, y:Vobs});
  }
  if(rows.length<2) throw new Error('No pude extraer puntos de .dat.');
  obs.sort((a,b)=>a.x-b.x);
  return {rows, obs};
}

function guessDelim(line){
  const c=(s)=> (line.match(new RegExp('\\'+s,'g'))||[]).length;
  const commas=c(','), semis=c(';'), tabs=c('\t');
  if(tabs>commas && tabs>semis) return '\t';
  if(semis>commas) return ';';
  return ',';
}
function parseCSV(text){
  const lines=text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length);
  if(lines.length<2) throw new Error('CSV vacío.');
  const delim=guessDelim(lines[0]);
  const headers=lines[0].split(delim).map(h=>h.trim());
  const find=(rxs)=>{
    for(let i=0;i<headers.length;i++){
      const raw=headers[i]; const n=raw.replace(/\s+/g,'').toLowerCase();
      for(const r of rxs){ if(r.test(raw)||r.test(n)) return i; }
    }
    return -1;
  };
  const idxR=find([/^r$/i,/r_kpc/i,/rad/i,/kpc/i,/radius/i]);
  const idxV=find([/^v$/i,/^vobs$/i,/v_obs/i,/vel/i,/km\/s/i]);
  const idxG=find([/vgas/i,/gas/i]);
  const idxD=find([/vdisk/i,/disk/i]);
  const idxB=find([/vbul/i,/bul/i,/bulge/i]);
  if(idxR<0 || idxV<0) throw new Error('CSV: faltan columnas R/V.');
  const rows=[], obs=[];
  for(let i=1;i<lines.length;i++){
    const cols=lines[i].split(delim);
    const R=Number(String(cols[idxR]).trim().replace(',','.'));
    const Vobs=Number(String(cols[idxV]).trim().replace(',','.'));
    if(!Number.isFinite(R)||!Number.isFinite(Vobs)) continue;
    const Vgas=idxG>=0?Number(String(cols[idxG]).trim().replace(',','.')):0;
    const Vdisk=idxD>=0?Number(String(cols[idxD]).trim().replace(',','.')):0;
    const Vbul=idxB>=0?Number(String(cols[idxB]).trim().replace(',','.')):0;
    rows.push({R_kpc:R, Vobs, Vgas:(Number.isFinite(Vgas)?Vgas:0), Vdisk:(Number.isFinite(Vdisk)?Vdisk:0), Vbul:(Number.isFinite(Vbul)?Vbul:0)});
    obs.push({x:R,y:Vobs});
  }
  if(rows.length<2) throw new Error('CSV: no pude extraer puntos.');
  obs.sort((a,b)=>a.x-b.x);
  return {rows, obs};
}

function parseCurveFile(name, text){
  const lower=name.toLowerCase();
  if(lower.endsWith('.dat')) return parseSPARCDat(text);
  if(lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCSV(text);
  return parseSPARCDat(text);
}

// ---------- ZIP load ----------
async function loadZipFromUrl(url){
  log(`Fetch ZIP: ${url}`);
  const r=await fetch(url, {method:'GET'});
  if(!r.ok) throw new Error(`No pude bajar ZIP (${r.status}). Revisa nombre/ruta (case-sensitive).`);
  const ab=await r.arrayBuffer();
  zipObj=await JSZip.loadAsync(ab);

  zipFiles=[];
  zipObj.forEach((path, file)=>{
    if(file.dir) return;
    if(/\.(dat|csv|txt)$/i.test(path)) zipFiles.push({name:path, file});
  });
  zipFiles.sort((a,b)=>a.name.localeCompare(b.name));

  fileSelect.innerHTML='';
  if(!zipFiles.length){
    fileSelect.disabled=true;
    fileSelect.innerHTML='<option value="">(ZIP sin archivos de curva)</option>';
    log('ZIP sin .dat/.csv/.txt');
    return;
  }
  for(const it of zipFiles){
    const opt=document.createElement('option');
    opt.value=it.name;
    opt.textContent=it.name;
    fileSelect.appendChild(opt);
  }
  fileSelect.disabled=false;
  btnPreview.disabled=false;
  btnCompute.disabled=false;
  btnGlobalRMS.disabled=false;
  log(`ZIP listo. Archivos: ${zipFiles.length}`);
}

async function readSelected(){
  if(!zipObj || !zipFiles.length) throw new Error('Cargá el dataset primero (Load).');
  const name=fileSelect.value || zipFiles[0].name;
  const it=zipFiles.find(x=>x.name===name) || zipFiles[0];
  const txt=await it.file.async('text');
  currentText=txt;

  clearDownloads();
  const blob=new Blob([txt], {type:'text/plain;charset=utf-8'});
  lastBlobUrl=URL.createObjectURL(blob);
  btnCSV.disabled=false;

  return {name: it.name, text: txt};
}

// ---------- backend ----------
async function pingBackend(){
  const url=baseUrl() + '/health';
  log(`PING ${url}`);
  try{
    const r=await fetch(url,{method:'GET'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    setBackendStatus('ok', `Backend: running`);
    log('PING ok');
    return true;
  }catch(e){
    setBackendStatus('bad', 'Backend: unreachable');
    log(`PING fail: ${e}`);
    return false;
  }
}
async function postJSON(path, payload){
  const url=baseUrl() + path;
  const r=await fetch(url,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  const data=ct.includes('application/json') ? await r.json() : await r.text();
  if(!r.ok){
    const msg=(typeof data==='string')?data:JSON.stringify(data);
    throw new Error(`HTTP ${r.status} :: ${msg.slice(0,300)}`);
  }
  return data;
}

function extractModelCurve(resp){
  const m = resp && resp.macro ? resp.macro : null;
  if(!m) return null;

  // Tu backend devuelve m.data con {R_kpc, V_obs, V_pred}
  if(Array.isArray(m.data) && m.data.length){
    return m.data
      .map(p=>({x:Number(p.R_kpc), y:Number(p.V_pred)}))
      .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
      .sort((a,b)=>a.x-b.x);
  }
  return null;
}
function setMicro(resp){
  const micro=resp && resp.micro ? resp.micro : null;
  if(!micro) return;
  microAStar.textContent = String(micro.a_star_m_s2 ?? '—');
  microStatus.textContent = 'ok';
}
function setResults(rows){
  resultsBody.innerHTML='';
  if(!rows || !rows.length){
    resultsBody.innerHTML='<tr><td class="mono">—</td><td>—</td><td class="muted">Sin resultados.</td></tr>';
    return;
  }
  for(const r of rows){
    const tr=document.createElement('tr');
    tr.innerHTML = `<td class="mono">${escapeHtml(r.obj)}</td><td>${escapeHtml(r.rms)}</td><td class="muted">${escapeHtml(r.detail||'')}</td>`;
    resultsBody.appendChild(tr);
  }
}

function setMacroStructure(resp){
  const s = resp?.macro?.structure;
  if(!s){
    macroVCenter.textContent = '—';
    macroVEdge.textContent   = '—';
    macroVMax.textContent    = '—';
    macroRCenter.textContent = '—';
    macroREdge.textContent   = '—';
    macroSlope.textContent   = '—';
    return;
  }

  const fmt = (x, n=2) => (Number.isFinite(Number(x)) ? Number(x).toFixed(n) : '—');

  macroVCenter.textContent = fmt(s.V_center, 2);
  macroVEdge.textContent   = fmt(s.V_edge, 2);
  macroVMax.textContent    = fmt(s.V_max, 2);
  macroRCenter.textContent = fmt(s.R_center, 3);
  macroREdge.textContent   = fmt(s.R_edge, 3);
  macroSlope.textContent   = fmt(s.slope_center, 3);
}

// ---------- actions ----------

function setMode(mode){
  activeMode = mode;

  for(const [m, el] of [['galaxies',btnGalaxies],['clusters',btnClusters],['dwarfs',btnDwarfs]]){
    el.classList.toggle('active', m===mode);
  }

  repoZipUrl.value = DATASET_URLS[mode] || repoZipUrl.value;

  zipObj=null; zipFiles=[];
  fileSelect.disabled=true;
  fileSelect.innerHTML='<option value="">(sin dataset cargado)</option>';
  btnPreview.disabled=true;
  btnCompute.disabled=true;
  btnGlobalRMS.disabled=true;
  clearDownloads();

  log(`MODE -> ${mode} | dataset=${repoZipUrl.value}`);
}

async function loadDataset(){
  const url=(repoZipUrl.value||'').trim();
  if(!url) { log('Dataset URL vacío.'); return; }
  setBusy(true);
  try{
    await loadZipFromUrl(url);
    if(zipFiles.length) fileSelect.value = zipFiles[0].name;
  }catch(e){
    log(`ERROR Load: ${e}`);
  }finally{
    setBusy(false);
  }
  
}

async function preview(){
  setBusy(true);
  try{
    const {name, text} = await readSelected();
    const parsed = parseCurveFile(name, text);
    renderCurve(parsed.obs, null, name.replace(/\.(dat|csv|txt)$/i,''));
    log(`PREVIEW ok: ${name}`);
  }catch(e){
    log(`ERROR preview: ${e}`);
  }finally{
    setBusy(false);
  }
}

async function computeSelected(){
  setBusy(true);
  try{
    const {name, text} = await readSelected();
    const galaxy_name = name.split('/').pop().replace(/\.(dat|csv|txt)$/i,'').replace(/_rotmod$/i,'');
    const parsed = parseCurveFile(name, text);

    const resp = await postJSON('/compute', {galaxy_name, rows: parsed.rows});
    setMicro(resp);

    const model = extractModelCurve(resp);
    renderCurve(parsed.obs, model, galaxy_name);

    const rms = resp?.macro?.rms_kms ?? '—';
    setResults([{obj: galaxy_name, rms, detail:'compute'}]);
    setMacroStructure(resp);
    log(`OK compute ${galaxy_name} rms=${rms}`);
  }catch(e){
    log(`ERROR compute: ${e}`);
  }finally{
    setBusy(false);
  }
}

async function globalRMS(){
  setBusy(true);
  try{
    if(!zipObj || !zipFiles.length) throw new Error('Cargá el dataset primero (Load).');

    log(`GLOBAL: preparando payload (${zipFiles.length} archivos) ...`);
    const galaxies=[];
    let okCount=0, skipCount=0;

    for(const it of zipFiles){
      const txt=await it.file.async('text');
      const galaxy_name = it.name.split('/').pop().replace(/\.(dat|csv|txt)$/i,'').replace(/_rotmod$/i,'');
      try{
        const {rows}=parseCurveFile(it.name, txt);
        galaxies.push({galaxy_name, rows});
        okCount++;
      }catch(err){
        skipCount++;
      }
    }
    if(!galaxies.length) throw new Error('No hay archivos válidos en ZIP.');

    log(`GLOBAL: ok=${okCount} skip=${skipCount} -> enviando al backend ...`);

    const endpoint = (activeMode==='dwarfs') ? '/dwarfs' : '/global_rms';
    const resp = await postJSON(endpoint, {galaxies});
    setMicro(resp);

    const block = (activeMode==='dwarfs') ? resp?.dwarfs : resp?.global;
    const list = block?.per_galaxy || [];
    const agg = (activeMode==='dwarfs') ? block?.dwarfs_rms_kms : block?.global_rms_kms;

    const head = (activeMode==='dwarfs') ? 'ENANAS' : (activeMode==='clusters' ? 'CLUSTERS' : 'GALAXIAS');

    const rowsOut = [{obj: head, rms: agg ?? '—', detail:`count=${block?.count ?? list.length}`}]
      .concat(list.slice(0,25).map(x=>({obj:x.galaxy, rms:x.rms_kms, detail:''})));

    setResults(rowsOut);
    log(`OK ${endpoint} agg=${agg}`);
  }catch(e){
    log(`ERROR globalRMS: ${e}`);
  }finally{
    setBusy(false);
  }
}

// Micro buttons (prefer /micro)
async function microOnly(particle){
  setBusy(true);
  const url = baseUrl() + '/micro';
  log(`MICRO ${particle}: POST ${url}`);
  try{
    const r = await fetch(url, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ particle })
    });
    const ct=(r.headers.get('content-type')||'').toLowerCase();
    const data=ct.includes('application/json') ? await r.json() : await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status} :: ${typeof data==='string'?data:JSON.stringify(data)}`);

    setMicro(data);
    setResults([{obj:`MICRO ${particle}`, rms:'—', detail:'micro-only'}]);
    log('OK micro-only');
  }catch(e){
    log(`MICRO no disponible o error: ${e}`);
  }finally{
    setBusy(false);
  }
}

// ---------- downloads ----------
function downloadPNG(){
  const a=document.createElement('a');
  a.href=canvas.toDataURL('image/png');
  a.download='atum_curve.png';
  document.body.appendChild(a); a.click(); a.remove();
}
function downloadFile(){
  if(!lastBlobUrl) return;
  const a=document.createElement('a');
  a.href=lastBlobUrl;
  a.download='selected_curve.txt';
  document.body.appendChild(a); a.click(); a.remove();
}

function resetAll(){
  zipObj=null; zipFiles=[]; currentText=null;
  fileSelect.innerHTML='<option value="">(sin dataset cargado)</option>';
  fileSelect.disabled=true;
  btnPreview.disabled=true;
  btnCompute.disabled=true;
  btnGlobalRMS.disabled=true;
  clearDownloads();
  clearCanvas();
  microAStar.textContent='—';
  microStatus.textContent='—';
  setResults([{obj:'—', rms:'—', detail:'Esperando…'}]);
  log('RESET');
}

// ---------- wiring ----------
btnPing.addEventListener('click', pingBackend);
btnLoadRepo.addEventListener('click', loadDataset);
btnPreview.addEventListener('click', preview);
btnCompute.addEventListener('click', computeSelected);
btnGlobalRMS.addEventListener('click', globalRMS);
btnReset.addEventListener('click', resetAll);

btnPNG.addEventListener('click', downloadPNG);
btnCSV.addEventListener('click', downloadFile);

btnGalaxies.addEventListener('click', ()=>setMode('galaxies'));
btnClusters.addEventListener('click', ()=>setMode('clusters'));
btnDwarfs.addEventListener('click', ()=>setMode('dwarfs'));

btnW.addEventListener('click', ()=>microOnly('W'));
btnZ.addEventListener('click', ()=>microOnly('Z'));
btnMuon.addEventListener('click', ()=>microOnly('MUON'));

// boot sequence
(async function boot(){
  clearCanvas();
  setBackendStatus('', 'Backend: verificando…');
  setResults([{obj:'—', rms:'—', detail:'Inicializando…'}]);
  log('BOOT ATUM');
  log('Auto: Ping -> Load -> Preview -> Compute');

  setMode('galaxies');

  const ok = await pingBackend();
  if(!ok){
    log('Backend no responde. Si es Render Free: primero Ping, luego reintentar.');
    return;
  }

  await loadDataset();
  try{ await preview(); }catch(e){}
  try{ await computeSelected(); }catch(e){}

})();
