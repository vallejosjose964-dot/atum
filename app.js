'use strict';

/**
 * ATUM Frontend
 * - Lee ZIP desde el mismo repo (GitHub Pages) vía fetch -> JSZip.
 * - Parse CSV -> arma JSON exacto que requiere tu backend FastAPI.
 * - Llama:
 *   GET  /health
 *   POST /compute      {galaxy_name, rows:[{R_kpc,Vobs,Vgas,Vdisk,Vbul}]}
 *   POST /global_rms   {galaxies:[{galaxy_name, rows:[...]}]}
 *   POST /dwarfs       idem
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

const btnPing = $('btnPing');
const btnCompute = $('btnCompute');
const btnGlobalRMS = $('btnGlobalRMS');
const btnDwarfs = $('btnDwarfs');
const btnReset = $('btnReset');

const microAStar = $('microAStar');
const microStatus = $('microStatus');

const btnPNG = $('btnPNG');
const btnCSV = $('btnCSV');

const resultsBody = $('resultsBody');

let zipObj = null;
let zipFiles = []; // {name, file}
let currentCSVText = null;
let lastCSVBlobUrl = null;

// ---------- log ----------
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

function clearDownloads(){
  btnCSV.disabled = true;
  if(lastCSVBlobUrl){
    URL.revokeObjectURL(lastCSVBlobUrl);
    lastCSVBlobUrl = null;
  }
}

// ---------- canvas ----------
function clearCanvas(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  const gx = 10, gy = 8;
  for(let i=1;i<gx;i++){
    const x = i*canvas.width/gx;
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
  }
  for(let j=1;j<gy;j++){
    const y = j*canvas.height/gy;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
  }
}
function drawAxes(bounds){
  const pad = 70;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(pad, canvas.height-pad);
  ctx.lineTo(canvas.width-pad, canvas.height-pad);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad, canvas.height-pad);
  ctx.lineTo(pad, pad);
  ctx.stroke();

  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  ctx.font = '16px Inter, system-ui';
  ctx.fillText('r (kpc)', canvas.width/2 - 20, canvas.height - 24);
  ctx.save();
  ctx.translate(22, canvas.height/2 + 20);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('V (km/s)', 0, 0);
  ctx.restore();

  ctx.fillStyle = 'rgba(233,241,255,0.70)';
  ctx.font = '12px Inter, system-ui';
  const ticks = 5;
  for(let i=0;i<=ticks;i++){
    const t = i/ticks;
    const x = pad + t*(canvas.width-2*pad);
    const val = bounds.xmin + t*(bounds.xmax-bounds.xmin);
    ctx.fillText(val.toFixed(1), x-10, canvas.height-pad+18);
  }
  for(let j=0;j<=ticks;j++){
    const t = j/ticks;
    const y = canvas.height-pad - t*(canvas.height-2*pad);
    const val = bounds.ymin + t*(bounds.ymax-bounds.ymin);
    ctx.fillText(val.toFixed(1), 28, y+4);
  }
}
function plotSeries(series, bounds, label, strokeStyle){
  const pad = 70;
  const xscale = (canvas.width-2*pad)/(bounds.xmax-bounds.xmin || 1);
  const yscale = (canvas.height-2*pad)/(bounds.ymax-bounds.ymin || 1);
  const X = (x)=> pad + (x-bounds.xmin)*xscale;
  const Y = (y)=> canvas.height-pad - (y-bounds.ymin)*yscale;

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = strokeStyle;
  ctx.beginPath();
  for(let i=0;i<series.length;i++){
    const p = series[i];
    const x = X(p.r);
    const y = Y(p.v);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  for(const p of series){
    const x = X(p.r), y = Y(p.v);
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  }

  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  ctx.font = '13px Inter, system-ui';
  ctx.fillText(label, pad+8, pad-18);
}
function boundsFor(seriesA, seriesB=null){
  let xmin=Infinity, xmax=-Infinity, ymin=Infinity, ymax=-Infinity;
  const eat = (arr)=>{
    for(const p of arr){
      xmin = Math.min(xmin,p.r); xmax=Math.max(xmax,p.r);
      ymin = Math.min(ymin,p.v); ymax=Math.max(ymax,p.v);
    }
  };
  eat(seriesA);
  if(seriesB && seriesB.length) eat(seriesB);
  const dx = (xmax-xmin)||1;
  const dy = (ymax-ymin)||1;
  return { xmin: xmin-0.05*dx, xmax: xmax+0.05*dx, ymin: Math.max(0, ymin-0.08*dy), ymax: ymax+0.08*dy };
}
function renderCurve(obs, model, label){
  clearCanvas();
  const b = boundsFor(obs, model);
  drawAxes(b);
  plotSeries(obs, b, `OBS: ${label}`, 'rgba(110,231,255,0.92)');
  if(model && model.length){
    plotSeries(model, b, `MODEL`, 'rgba(167,139,250,0.85)');
  }
}

// ---------- CSV parsing ----------
function parseCSV(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length);
  if(lines.length < 2) throw new Error('CSV vacío o incompleto.');

  const delim = guessDelim(lines[0]);
  const headers = splitLine(lines[0], delim).map(h=>h.trim());
  const idx = {
    R_kpc: findCol(headers, [/^r$/i, /r_kpc/i, /radius/i, /kpc/i]),
    Vobs:  findCol(headers, [/^v$/i, /^vobs$/i, /v_obs/i, /vobs/i, /vel/i, /km\/s/i]),
    Vgas:  findCol(headers, [/vgas/i, /gas/i]),
    Vdisk: findCol(headers, [/vdisk/i, /disk/i]),
    Vbul:  findCol(headers, [/vbul/i, /bul/i, /bulge/i]),
  };
  if(idx.R_kpc < 0 || idx.Vobs < 0){
    throw new Error(`No encuentro columnas R_kpc/Vobs. Headers: ${headers.join(' | ')}`);
  }

  const rows = [];
  const obs = [];
  for(let i=1;i<lines.length;i++){
    const cols = splitLine(lines[i], delim);
    const R_kpc = toNum(cols[idx.R_kpc]);
    const Vobs = toNum(cols[idx.Vobs]);
    if(!Number.isFinite(R_kpc) || !Number.isFinite(Vobs)) continue;

    const row = {
      R_kpc,
      Vobs,
      Vgas:  idx.Vgas>=0  ? (toNum(cols[idx.Vgas])  || 0) : 0,
      Vdisk: idx.Vdisk>=0 ? (toNum(cols[idx.Vdisk]) || 0) : 0,
      Vbul:  idx.Vbul>=0  ? (toNum(cols[idx.Vbul])  || 0) : 0,
    };
    rows.push(row);
    obs.push({r: R_kpc, v: Vobs});
  }
  if(rows.length < 2) throw new Error('No pude extraer puntos suficientes.');
  obs.sort((a,b)=>a.r-b.r);
  return {rows, obs};
}
function guessDelim(line){
  const count = (s)=> (line.match(new RegExp('\\'+s,'g'))||[]).length;
  const commas = count(',');
  const semis = count(';');
  const tabs = count('\t');
  if(tabs>commas && tabs>semis) return '\t';
  if(semis>commas) return ';';
  return ',';
}
function splitLine(line, delim){ return line.split(delim); }
function findCol(headers, patterns){
  for(let i=0;i<headers.length;i++){
    const raw = headers[i];
    const norm = raw.replace(/\s+/g,'').toLowerCase();
    for(const p of patterns){
      if(p.test(raw) || p.test(norm)) return i;
    }
  }
  return -1;
}
function toNum(x){
  if(x==null) return NaN;
  const s = String(x).trim().replace(',', '.');
  const v = Number(s);
  return v;
}

// ---------- ZIP load ----------
async function loadZipFromUrl(url){
  log(`Fetch ZIP: ${url}`);
  const r = await fetch(url, { method:'GET' });
  if(!r.ok) throw new Error(`No pude bajar ZIP (${r.status}). Tip: el ZIP debe estar en el repo y ser público.`);
  const ab = await r.arrayBuffer();
  zipObj = await JSZip.loadAsync(ab);

  zipFiles = [];
  zipObj.forEach((path, file)=>{
    if(file.dir) return;
    if(/\.(csv|txt)$/i.test(path)){
      zipFiles.push({name:path, file});
    }
  });

  zipFiles.sort((a,b)=>a.name.localeCompare(b.name));
  fileSelect.innerHTML = '';
  if(!zipFiles.length){
    fileSelect.disabled = true;
    fileSelect.innerHTML = '<option value="">(no hay CSV/TXT en el ZIP)</option>';
    log('ZIP bajado pero no encontré CSV/TXT.');
    return;
  }

  for(const it of zipFiles){
    const opt = document.createElement('option');
    opt.value = it.name;
    opt.textContent = it.name;
    fileSelect.appendChild(opt);
  }
  fileSelect.disabled = false;
  log(`ZIP listo. Archivos: ${zipFiles.length}`);
}

async function readSelectedCSV(){
  if(!zipObj || !zipFiles.length) throw new Error('No hay ZIP/CSVs cargados.');
  const name = fileSelect.value || zipFiles[0].name;
  const it = zipFiles.find(x=>x.name===name) || zipFiles[0];
  const txt = await it.file.async('text');
  currentCSVText = txt;

  clearDownloads();
  btnCSV.disabled = false;
  const blob = new Blob([txt], {type:'text/csv;charset=utf-8'});
  lastCSVBlobUrl = URL.createObjectURL(blob);

  return {name: it.name, text: txt};
}

// ---------- Backend calls ----------
function baseUrl(){
  return backendBaseInput.value.trim().replace(/\/$/,'');
}
async function pingBackend(){
  const url = baseUrl() + '/health';
  log(`PING ${url}`);
  try{
    const r = await fetch(url, {method:'GET'});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json().catch(()=>null);
    setBackendStatus('ok', `Backend: online (${r.status})`);
    log(`PING ok: ${JSON.stringify(j)||'ok'}`);
  }catch(e){
    setBackendStatus('bad', 'Backend: unreachable');
    log(`PING fail: ${e}`);
  }
}
async function postJSON(path, payload){
  const url = baseUrl() + path;
  const r = await fetch(url, {
    method:'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });
  const ct = (r.headers.get('content-type')||'').toLowerCase();
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if(!r.ok){
    const msg = (typeof data === 'string') ? data : JSON.stringify(data);
    throw new Error(`HTTP ${r.status} :: ${msg.slice(0,300)}`);
  }
  return data;
}

// Extract model curve from backend response if present.
// Accepts many shapes: macro.curve, macro.points, macro.model_curve, etc.
function extractModelCurve(resp){
  const m = resp && resp.macro ? resp.macro : null;
  if(!m) return null;

  const candidates = [
    m.curve, m.points, m.model_curve, m.model, m.v_curve, m.V_curve
  ].filter(Boolean);

  for(const c of candidates){
    if(Array.isArray(c) && c.length){
      // try to map keys
      const first = c[0];
      const keyR = ('R_kpc' in first) ? 'R_kpc' : (('r' in first)?'r':(('R' in first)?'R':null));
      const keyV = ('Vmodel' in first) ? 'Vmodel' : (('V' in first)?'V':(('v' in first)?'v':(('Vtot' in first)?'Vtot':null)));
      if(keyR && keyV){
        return c.map(p=>({r:Number(p[keyR]), v:Number(p[keyV])})).filter(p=>Number.isFinite(p.r)&&Number.isFinite(p.v)).sort((a,b)=>a.r-b.r);
      }
    }
  }

  // maybe arrays
  if(Array.isArray(m.R_kpc) && Array.isArray(m.Vmodel) && m.R_kpc.length === m.Vmodel.length){
    return m.R_kpc.map((r,i)=>({r:Number(r), v:Number(m.Vmodel[i])})).filter(p=>Number.isFinite(p.r)&&Number.isFinite(p.v)).sort((a,b)=>a.r-b.r);
  }
  return null;
}

function setMicro(resp){
  const micro = resp && resp.micro ? resp.micro : null;
  if(!micro) return;
  microAStar.textContent = (micro.a_star_m_s2 ?? micro['a_star_m_s2'] ?? '—');
  microStatus.textContent = (micro.status ?? micro['status'] ?? 'ok');
}

function setResultsRows(rows){
  resultsBody.innerHTML = '';
  if(!rows || !rows.length){
    resultsBody.innerHTML = '<tr><td class="mono">—</td><td>—</td><td class="muted">Sin resultados.</td></tr>';
    return;
  }
  for(const r of rows){
    const tr = document.createElement('tr');
    const gal = r.galaxy || r.galaxy_name || r.name || '—';
    const rms = (r.rms_kms ?? r.rms ?? '—');
    const det = r.detail || r.message || '';
    tr.innerHTML = `<td class="mono">${escapeHtml(gal)}</td><td>${escapeHtml(rms)}</td><td class="muted">${escapeHtml(det)}</td>`;
    resultsBody.appendChild(tr);
  }
}
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

// ---------- Actions ----------
async function loadRepoZip(){
  try{
    const url = (repoZipUrl.value || './Rotmod_LTG.zip').trim();
    await loadZipFromUrl(url);
  }catch(e){
    log(`ERROR Load ZIP: ${e}`);
  }
}

async function computeSingle(){
  try{
    const {name, text} = await readSelectedCSV();
    const galaxy_name = name.replace(/\.(csv|txt)$/i,'');
    const {rows, obs} = parseCSV(text);

    log(`POST /compute galaxy=${galaxy_name} rows=${rows.length}`);
    const resp = await postJSON('/compute', { galaxy_name, rows });
    setMicro(resp);

    const model = extractModelCurve(resp);
    renderCurve(obs, model, galaxy_name);

    const rms = resp?.macro?.rms_kms ?? resp?.macro?.rms ?? '—';
    setResultsRows([{galaxy: galaxy_name, rms_kms: rms, detail: 'compute'}]);
    log(`OK /compute rms=${rms}`);
  }catch(e){
    log(`ERROR compute: ${e}`);
  }
}

async function buildGlobalPayload(){
  if(!zipObj || !zipFiles.length) throw new Error('Cargá el ZIP primero.');
  const galaxies = [];
  // read sequential to avoid memory spikes
  for(const it of zipFiles){
    const txt = await it.file.async('text');
    const galaxy_name = it.name.split('/').pop().replace(/\.(csv|txt)$/i,'');
    try{
      const {rows} = parseCSV(txt);
      galaxies.push({galaxy_name, rows});
    }catch(err){
      // skip bad files but log
      log(`SKIP ${it.name}: ${err}`);
    }
  }
  if(!galaxies.length) throw new Error('No pude construir payload global (ningún CSV válido).');
  return {galaxies};
}

async function runGlobalRMS(){
  try{
    const payload = await buildGlobalPayload();
    log(`POST /global_rms galaxies=${payload.galaxies.length}`);
    const resp = await postJSON('/global_rms', payload);
    setMicro(resp);
    const global = resp?.global;
    const list = global?.per_galaxy || [];
    const gRms = global?.global_rms_kms;
    // show top 20 worst + global line
    const rows = [{galaxy:'GLOBAL', rms_kms: gRms ?? '—', detail:`count=${global?.count ?? list.length}`}]
      .concat(list.slice(0,20).map(x=>({galaxy:x.galaxy, rms_kms:x.rms_kms, detail:''})));
    setResultsRows(rows);
    log(`OK /global_rms global_rms_kms=${gRms}`);
  }catch(e){
    log(`ERROR global_rms: ${e}`);
  }
}

async function runDwarfs(){
  try{
    const payload = await buildGlobalPayload();
    log(`POST /dwarfs galaxies=${payload.galaxies.length}`);
    const resp = await postJSON('/dwarfs', payload);
    setMicro(resp);
    const d = resp?.dwarfs;
    const list = d?.per_galaxy || [];
    const dRms = d?.dwarfs_rms_kms;
    const rows = [{galaxy:'DWARFS', rms_kms: dRms ?? '—', detail:`count=${d?.count ?? list.length}`}]
      .concat(list.slice(0,20).map(x=>({galaxy:x.galaxy, rms_kms:x.rms_kms, detail:''})));
    setResultsRows(rows);
    log(`OK /dwarfs dwarfs_rms_kms=${dRms}`);
  }catch(e){
    log(`ERROR dwarfs: ${e}`);
  }
}

// ---------- downloads ----------
function downloadPNG(){
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'atum_curve.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function downloadCSV(){
  if(!lastCSVBlobUrl) return;
  const a = document.createElement('a');
  a.href = lastCSVBlobUrl;
  a.download = 'selected_curve.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function resetAll(){
  zipObj=null; zipFiles=[]; currentCSVText=null;
  fileSelect.innerHTML='<option value="">(sin ZIP cargado)</option>';
  fileSelect.disabled=true;
  clearDownloads();
  clearCanvas();
  microAStar.textContent='—';
  microStatus.textContent='—';
  resultsBody.innerHTML='<tr><td class="mono">—</td><td>—</td><td class="muted">Esperando ejecución…</td></tr>';
  log('RESET');
}

// ---------- wiring ----------
btnLoadRepo.addEventListener('click', loadRepoZip);
btnPing.addEventListener('click', pingBackend);
btnCompute.addEventListener('click', computeSingle);
btnGlobalRMS.addEventListener('click', runGlobalRMS);
btnDwarfs.addEventListener('click', runDwarfs);
btnReset.addEventListener('click', resetAll);
btnPNG.addEventListener('click', downloadPNG);
btnCSV.addEventListener('click', downloadCSV);

// auto-load ZIP from repo (non-fatal)
(async function boot(){
  clearCanvas();
  setBackendStatus('', 'Backend: no verificado');
  log('BOOT ATUM');
  log('1) Ping backend  2) Load ZIP from Repo  3) Compute');
  try{
    const url = (repoZipUrl.value || './Rotmod_LTG.zip').trim();
    await loadZipFromUrl(url);
    log('Auto-load ZIP OK.');
  }catch(e){
    log('Auto-load ZIP: no disponible (ok).');
  }
})();
