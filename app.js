'use strict';
/**
 * ATUM frontend
 * - Auto: ping backend, load dataset ZIP from repo, preview, compute first file.
 * - Parses SPARC .dat (tab/space) + csv/txt
 * - Calls backend (FastAPI):
 *   GET  /health
 *   POST /compute      {galaxy_name, rows:[{R_kpc,Vobs,Vgas,Vdisk,Vbul}]}
 *   POST /global_rms   {galaxies:[{galaxy_name, rows:[...]}]}
 *   POST /dwarfs       {galaxies:[...]}
 *
 * Micro buttons:
 * - Prefer POST /micro {particle:"W"|"Z"|"MU"} if you add it.
 * - If /micro not present, buttons will show message in log (no fake compute).
 */

const $ = (id)=>document.getElementById(id);
const logEl = $('log');
const canvas = $('curve');
const ctx = canvas.getContext('2d');

const backendDot = $('backendDot');
const backendLabel = $('backendLabel');
const backendBaseInput = $('backendBase');

const repoZipUrl = $('repoZipUrl');
// fuerza URL absoluta al ZIP en GitHub Pages
try{
  const autoZip = new URL('Rotmod_LTG.zip', window.location.href).href;
  if (repoZipUrl && (!repoZipUrl.value || repoZipUrl.value.includes('./Rotmod_LTG.zip'))) {
    repoZipUrl.value = autoZip;
  }
}catch(_){}
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
  dwarfs: './Rotmod_LTG.zip' // dwarfs filtered server-side by name, you can change to ./dwarfs.zip when you have it
};

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
  const b = boundsFor(obs, model);
  drawAxes(b, 'r (kpc)', 'V (km/s)');
  plotSeries(obs, b, 'OBS', 'rgba(110,231,255,0.95)');
  if(model && model.length){
    plotSeries(model, b, 'MODEL', 'rgba(167,139,250,0.88)');
  }
}

// ---------- parsing (SPARC .dat or csv) ----------
function parseSPARCDat(text){
  const lines=text.replace(/\r/g,'').split('\n')
    .map(l=>l.trim())
    .filter(l=>l && !l.startsWith('#'));
  if(lines.length<2) throw new Error('Archivo .dat sin datos.');
  const rows=[];
  const obs=[];
  for(const l of lines){
    const cols=l.split(/\s+/); // tabs or spaces
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
  // try dat anyway
  return parseSPARCDat(text);
}

// ---------- ZIP load from repo ----------
async function loadZipFromUrl(url){
  log(`Fetch ZIP: ${url}`);
  const r=await fetch(url, {method:'GET'});
  if(!r.ok) throw new Error(`No pude bajar ZIP (${r.status}). Revisa nombre/ruta/case-sensitive.`);
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
    btnPreview.disabled=true;
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
  log(`ZIP listo. Archivos: ${zipFiles.length}`);
}

async function readSelected(){
  if(!zipObj || !zipFiles.length) throw new Error('Cargá el dataset primero.');
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
  const candidates=[m.curve,m.points,m.model_curve,m.model,m.v_curve,m.V_curve].filter(Boolean);
  for(const c of candidates){
    if(Array.isArray(c) && c.length){
      const first=c[0];
      const keyX = ('R_kpc' in first) ? 'R_kpc' : (('r' in first)?'r':(('R' in first)?'R':null));
      const keyY = ('Vmodel' in first) ? 'Vmodel' : (('V' in first)?'V':(('v' in first)?'v':(('Vtot' in first)?'Vtot':null)));
      if(keyX && keyY){
        return c.map(p=>({x:Number(p[keyX]), y:Number(p[keyY])}))
                .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
                .sort((a,b)=>a.x-b.x);
      }
    }
  }
  if(Array.isArray(m.R_kpc) && Array.isArray(m.Vmodel) && m.R_kpc.length===m.Vmodel.length){
    return m.R_kpc.map((x,i)=>({x:Number(x), y:Number(m.Vmodel[i])}))
            .filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))
            .sort((a,b)=>a.x-b.x);
  }
  return null;
}
function setMicro(resp){
  const micro=resp && resp.micro ? resp.micro : null;
  if(!micro) return;
  microAStar.textContent = String(micro.a_star_m_s2 ?? micro['a_star_m_s2'] ?? '—');
  microStatus.textContent = String(micro.status ?? micro['status'] ?? 'ok');
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

// ---------- actions ----------
function setMode(mode){
  activeMode = mode;
  // visual
  for(const [m, el] of [['galaxies',btnGalaxies],['clusters',btnClusters],['dwarfs',btnDwarfs]]){
    el.classList.toggle('active', m===mode);
  }
  // url hint
  repoZipUrl.value = DATASET_URLS[mode] || repoZipUrl.value;
  // reset loaded dataset state
  zipObj=null; zipFiles=[];
  fileSelect.disabled=true; fileSelect.innerHTML='<option value="">(sin dataset cargado)</option>';
  btnPreview.disabled=true;
  clearDownloads();
  log(`MODE -> ${mode} | dataset=${repoZipUrl.value}`);
}

async function loadDataset(){
  const url=(repoZipUrl.value||'').trim();
  if(!url) { log('Dataset URL vacío.'); return; }
  try{
    await loadZipFromUrl(url);
    // auto select first item
    if(zipFiles.length){
      fileSelect.value = zipFiles[0].name;
    }
  }catch(e){
    log(`ERROR Load dataset: ${e}`);
  }
}

async function preview(){
  try{
    const {name, text} = await readSelected();
    const parsed = parseCurveFile(name, text);
    renderCurve(parsed.obs, null, name.replace(/\.(dat|csv|txt)$/i,''));
    log(`PREVIEW ok: ${name}`);
  }catch(e){
    log(`ERROR preview: ${e}`);
  }
}

async function computeSelected(){
  try{
    const {name, text} = await readSelected();
    const galaxy_name = name.split('/').pop()
      .replace(/\.(dat|csv|txt)$/i,'')
      .replace(/_rotmod$/i,'');

    const parsed = parseCurveFile(name, text);

    const resp = await postJSON('/compute', {galaxy_name, rows: parsed.rows});
    setMicro(resp);

    const model = extractModelCurve(resp);
    renderCurve(parsed.obs, model, galaxy_name);

    // RMS
    const rmsVal = resp?.macro?.rms_kms ?? resp?.macro?.rms ?? null;
    const rmsStr = (rmsVal === null || rmsVal === undefined) ? '—' : String(rmsVal);

    // RMS grande
    const big = document.getElementById('bigRMS');
    if(big) big.textContent = `RMS: ${rmsStr} km/s`;

    // Resumen simple (Centro / Medio / Borde) desde OBS
    const obs = parsed?.obs || [];
    const f = (x)=> (Number.isFinite(x) ? x.toFixed(2) : '—');

    let rowsOut = [{obj: galaxy_name, rms: `${rmsStr} km/s`, detail:'RMS total'}];
    if(obs.length >= 3){
      const center = Number(obs[0].y);
      const mid    = Number(obs[Math.floor(obs.length/2)].y);
      const edge   = Number(obs[obs.length-1].y);
      rowsOut = [
        {obj: `${galaxy_name} — Centro`, rms: `${f(center)} km/s`, detail:'r mínimo'},
        {obj: `${galaxy_name} — Medio`,  rms: `${f(mid)} km/s`,    detail:'r medio'},
        {obj: `${galaxy_name} — Borde`,  rms: `${f(edge)} km/s`,   detail:'r máximo'},
        {obj: `${galaxy_name} — RMS`,    rms: `${rmsStr} km/s`,    detail:'RMS total'}
      ];
    }

    setResults(rowsOut);
    log(`OK compute ${galaxy_name} rms=${rmsStr}`);
  }catch(e){
    log(`ERROR compute: ${e}`);
  }
}

setResults(rowsOut);
log(`OK compute ${galaxy_name} rms=${rmsStr}`);

// --------- resumen físico claro ----------
const obs = parsed.obs;
if (obs.length > 2) {
  const center = obs[0].y.toFixed(2);
  const mid = obs[Math.floor(obs.length/2)].y.toFixed(2);
  const edge = obs[obs.length-1].y.toFixed(2);

  setResults([
    {obj: galaxy_name + " (Centro)", rms: center + " km/s", detail:"r mínimo"},
    {obj: galaxy_name + " (Medio)", rms: mid + " km/s", detail:"r medio"},
    {obj: galaxy_name + " (Borde)", rms: edge + " km/s", detail:"r máximo"},
    {obj: galaxy_name, rms: rms + " km/s", detail:"RMS total"}
  ]);
}
    const rms = resp?.macro?.rms_kms ?? resp?.macro?.rms ?? '—';
    setResults([{obj: galaxy_name, rms, detail:'compute'}]);
    log(`OK compute ${galaxy_name} rms=${rms}`);
  }catch(e){
    log(`ERROR compute: ${e}`);
  }
}

async function globalRMS(){
  try{
    if(!zipObj || !zipFiles.length) throw new Error('Cargá el dataset primero.');
    const galaxies=[];
    for(const it of zipFiles){
      const txt=await it.file.async('text');
      const galaxy_name = it.name.split('/').pop().replace(/\.(dat|csv|txt)$/i,'').replace(/_rotmod$/i,'');
      try{
        const {rows}=parseCurveFile(it.name, txt);
        galaxies.push({galaxy_name, rows});
      }catch(err){
        log(`SKIP ${it.name}: ${err}`);
      }
    }
    if(!galaxies.length) throw new Error('No hay archivos válidos en ZIP.');
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
  }
}

// Micro buttons (prefer /micro)
async function microOnly(particle){
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
    // expected: {micro:{...}}
    setMicro(data);
    setResults([{obj:`MICRO ${particle}`, rms:'—', detail:'micro-only'}]);
    log('OK micro-only');
  }catch(e){
    log(`MICRO no disponible (falta endpoint /micro). ${e}`);
    log('Solución mínima: agregar en backend: @app.post("/micro") -> return {"micro": micro_engine()}');
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

// boot sequence: 4 puntos
(async function boot(){
  clearCanvas();
  setBackendStatus('', 'Backend: verificando…');
  setResults([{obj:'—', rms:'—', detail:'Inicializando…'}]);
  log('BOOT ATUM');
  log('Auto: 1) Ping backend  2) Load dataset  3) Preview  4) Compute example');
  setMode('galaxies');

  // 1) ping
  const ok = await pingBackend();
  if(!ok){
    log('Backend no responde. Si es Render Free, esperá y probá Ping de nuevo.');
    return;
  }

  // 2) load dataset
  try{
    await loadDataset();
  }catch(e){
    log(`Auto-load dataset falló: ${e}`);
    return;
  }

  // 3) preview
  try{ await preview(); }catch(e){}

  // 4) compute first file
  try{ await computeSelected(); }catch(e){}
})();
