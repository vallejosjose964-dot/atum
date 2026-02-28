'use strict';

/**
 * Frontend similar a tu guía:
 * - Carga ZIP (CSVs) -> selector -> Run Galaxy -> grafica curva.
 * - Backend: ping + detección (si responde). Hoy da 503 desde este entorno.
 */

const $ = (id)=>document.getElementById(id);
const logEl = $('log');
const canvas = $('curve');
const ctx = canvas.getContext('2d');

const backendDot = $('backendDot');
const backendLabel = $('backendLabel');
const backendBaseInput = $('backendBase');

const zipInput = $('zipInput');
const btnLoadZip = $('btnLoadZip');
const fileSelect = $('fileSelect');

const btnPing = $('btnPing');
const btnReset = $('btnReset');

const btnRunGalaxy = $('btnRunGalaxy');
const btnRunDwarfs = $('btnRunDwarfs');
const btnRunLocuss = $('btnRunLocuss');
const btnGlobalRMS = $('btnGlobalRMS');
const btnGlobalCSV = $('btnGlobalCSV');

const btnPNG = $('btnPNG');
const btnCSV = $('btnCSV');

let zipObj = null;
let zipFiles = []; // {name, file}
let currentCSVText = null;

let lastCSVBlobUrl = null;

// ---------- Log / UI ----------
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
  btnGlobalCSV.disabled = true;
  if(lastCSVBlobUrl){
    URL.revokeObjectURL(lastCSVBlobUrl);
    lastCSVBlobUrl = null;
  }
}

// ---------- Canvas plot ----------
function clearCanvas(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // background subtle
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  // grid
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

  // axes
  ctx.beginPath();
  ctx.moveTo(pad, canvas.height-pad);
  ctx.lineTo(canvas.width-pad, canvas.height-pad);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pad, canvas.height-pad);
  ctx.lineTo(pad, pad);
  ctx.stroke();

  // labels
  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  ctx.font = '16px Inter, system-ui';
  ctx.fillText('r (kpc)', canvas.width/2 - 20, canvas.height - 24);
  ctx.save();
  ctx.translate(22, canvas.height/2 + 20);
  ctx.rotate(-Math.PI/2);
  ctx.fillText('V (km/s)', 0, 0);
  ctx.restore();

  // ticks
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

function plotSeries(series, bounds, label){
  const pad = 70;
  const xscale = (canvas.width-2*pad)/(bounds.xmax-bounds.xmin || 1);
  const yscale = (canvas.height-2*pad)/(bounds.ymax-bounds.ymin || 1);

  function X(x){ return pad + (x-bounds.xmin)*xscale; }
  function Y(y){ return canvas.height-pad - (y-bounds.ymin)*yscale; }

  ctx.lineWidth = 2.2;
  ctx.strokeStyle = 'rgba(110,231,255,0.90)';
  ctx.beginPath();
  for(let i=0;i<series.length;i++){
    const p = series[i];
    const x = X(p.r);
    const y = Y(p.v);
    if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  }
  ctx.stroke();

  // points
  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  for(const p of series){
    const x = X(p.r), y = Y(p.v);
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
  }

  // legend
  ctx.fillStyle = 'rgba(233,241,255,0.85)';
  ctx.font = '13px Inter, system-ui';
  ctx.fillText(label, pad+8, pad-18);
}

// ---------- CSV parsing ----------
function parseCSV(text){
  // basic CSV; handles commas/semicolons/tabs
  const lines = text.replace(/\r/g,'').split('\n').filter(l=>l.trim().length);
  if(lines.length < 2) throw new Error('CSV vacío o incompleto.');

  const delim = guessDelim(lines[0]);
  const headers = splitLine(lines[0], delim).map(h=>h.trim());
  const idxR = findCol(headers, [/^r$/i, /radius/i, /r_kpc/i, /kpc/i]);
  const idxV = findCol(headers, [/^v$/i, /vobs/i, /vel/i, /km\/s/i, /v_obs/i]);

  if(idxR < 0 || idxV < 0){
    throw new Error(`No encuentro columnas r y v. Headers: ${headers.join(' | ')}`);
  }

  const pts = [];
  for(let i=1;i<lines.length;i++){
    const cols = splitLine(lines[i], delim);
    const r = toNum(cols[idxR]);
    const v = toNum(cols[idxV]);
    if(Number.isFinite(r) && Number.isFinite(v)) pts.push({r,v});
  }
  if(pts.length < 2) throw new Error('No pude extraer puntos suficientes (r,v).');

  // sort by r
  pts.sort((a,b)=>a.r-b.r);
  return pts;
}

function guessDelim(line){
  const c = (s)=> (line.match(new RegExp('\\'+s,'g'))||[]).length;
  const commas = c(',');
  const semis = c(';');
  const tabs = c('\t');
  if(tabs>commas && tabs>semis) return '\t';
  if(semis>commas) return ';';
  return ',';
}
function splitLine(line, delim){
  // simple split (no quoted commas). good enough for SPARC-like tables.
  return line.split(delim);
}
function findCol(headers, patterns){
  for(let i=0;i<headers.length;i++){
    const h = headers[i].replace(/\s+/g,'').toLowerCase();
    for(const p of patterns){
      if(p.test(headers[i]) || p.test(h)) return i;
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

function boundsFor(pts){
  let xmin=Infinity, xmax=-Infinity, ymin=Infinity, ymax=-Infinity;
  for(const p of pts){
    xmin = Math.min(xmin,p.r); xmax=Math.max(xmax,p.r);
    ymin = Math.min(ymin,p.v); ymax=Math.max(ymax,p.v);
  }
  // pad
  const dx = (xmax-xmin)||1;
  const dy = (ymax-ymin)||1;
  return { xmin: xmin-0.05*dx, xmax: xmax+0.05*dx, ymin: Math.max(0, ymin-0.08*dy), ymax: ymax+0.08*dy };
}

function renderCurve(pts, label){
  clearCanvas();
  const b = boundsFor(pts);
  drawAxes(b);
  plotSeries(pts, b, label);
}

// ---------- ZIP load ----------
async function loadZip(){
  const f = zipInput.files && zipInput.files[0];
  if(!f) { log('Elegí un ZIP primero.'); return; }

  log(`Cargando ZIP: ${f.name} (${Math.round(f.size/1024)} KB)`);
  const ab = await f.arrayBuffer();
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
    log('ZIP cargado pero no encontré CSV/TXT adentro.');
    return;
  }

  for(const it of zipFiles){
    const opt = document.createElement('option');
    opt.value = it.name;
    opt.textContent = it.name;
    fileSelect.appendChild(opt);
  }
  fileSelect.disabled = false;
  log(`ZIP ok. Archivos: ${zipFiles.length}`);
}

async function readSelectedCSV(){
  if(!zipObj || !zipFiles.length) throw new Error('No hay ZIP/CSVs cargados.');
  const name = fileSelect.value || zipFiles[0].name;
  const it = zipFiles.find(x=>x.name===name) || zipFiles[0];
  const txt = await it.file.async('text');
  currentCSVText = txt;
  clearDownloads();
  btnCSV.disabled = false;
  // create csv download
  const blob = new Blob([txt], {type:'text/csv;charset=utf-8'});
  lastCSVBlobUrl = URL.createObjectURL(blob);
  return {name: it.name, text: txt};
}

// ---------- Backend ----------
async function pingBackend(){
  const base = backendBaseInput.value.trim().replace(/\/$/,'');
  log(`PING ${base}`);
  try{
    const r = await fetch(base, {method:'GET'});
    // many backends return 404 on /; still means alive. But 503 means dead.
    if(r.status === 503) throw new Error('HTTP 503 (Service Unavailable)');
    setBackendStatus('ok', `Backend: online (HTTP ${r.status})`);
    log(`Backend alive: HTTP ${r.status}`);
  }catch(e){
    setBackendStatus('bad', 'Backend: unreachable (503/timeout)');
    log(`Backend fail: ${e}`);
  }
}

// ---------- Actions ----------
async function runGalaxy(){
  try{
    const {name, text} = await readSelectedCSV();
    const pts = parseCSV(text);
    renderCurve(pts, name);
    log(`Run Galaxy OK: ${name} | puntos=${pts.length}`);
  }catch(e){
    log(`ERROR Run Galaxy: ${e}`);
  }
}

function notImplemented(label){
  log(`${label}: pendiente (cuando conectemos endpoints reales).`);
  // still show curve if there is selected file
  if(zipObj) runGalaxy();
}

function downloadPNG(){
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'curve.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
function downloadCSV(){
  if(!lastCSVBlobUrl) return;
  const a = document.createElement('a');
  a.href = lastCSVBlobUrl;
  a.download = 'curve.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function resetAll(){
  zipObj=null; zipFiles=[]; currentCSVText=null;
  zipInput.value='';
  fileSelect.innerHTML='<option value="">(sin ZIP cargado)</option>';
  fileSelect.disabled=true;
  clearDownloads();
  clearCanvas();
  log('RESET');
}

// ---------- Wiring ----------
btnLoadZip.addEventListener('click', loadZip);
btnPing.addEventListener('click', pingBackend);
btnReset.addEventListener('click', resetAll);

btnRunGalaxy.addEventListener('click', runGalaxy);
btnRunDwarfs.addEventListener('click', ()=>notImplemented('Run Dwarfs'));
btnRunLocuss.addEventListener('click', ()=>notImplemented('Run LoCuSS'));
btnGlobalRMS.addEventListener('click', ()=>notImplemented('Global RMS'));

btnPNG.addEventListener('click', downloadPNG);
btnCSV.addEventListener('click', downloadCSV);
btnGlobalCSV.addEventListener('click', ()=>log('Global CSV: pendiente.'));

(function boot(){
  clearCanvas();
  setBackendStatus('', 'Backend: no verificado');
  log('BOOT');
  log('Cargá un ZIP con CSVs -> seleccioná -> Run Galaxy -> aparece la curva.');
  log('Backend: hoy me devuelve 503 desde el entorno, por eso NO puedo ejecutar THOT acá.');
})();
