// ================================
// THOT Frontend (Falcon-style UI)
// - Reads local Rotmod ZIP
// - Parses .dat/.txt rotmod tables
// - Sends chosen galaxy (or all) to Render backend
// - Backend returns micro + macro results
// ================================

"use strict";

// ==== CONFIG ====
const BASE = "https://thot-engine.onrender.com";
const URL_COMPUTE = `${BASE}/compute`;
const URL_GLOBAL  = `${BASE}/global_rms`;
const URL_DWARFS  = `${BASE}/dwarfs`;

// ==== STATE ====
let galaxies = {};              // { filename: rows[] }
let lastCSV = "";               // csv content for download
let lastPNGTarget = "plot";     // 'plot' or 'plotGlobal'
let lastAction = "—";

// ==== DOM ====
const $ = (id) => document.getElementById(id);

$("backendLabel").textContent = BASE;

function setDot(kind){
  const d = $("dot");
  d.className = `dot ${kind}`;
}
function setStatus(msg, kind="warn"){
  setDot(kind);
  $("status").textContent = msg;
}
function setCount(){
  const n = Object.keys(galaxies).length;
  $("zipCount").textContent = n ? String(n) : "—";
}
function setRMS(v){ $("rmsLabel").textContent = v ?? "—"; }
function setMicro(obj){ $("microOut").textContent = JSON.stringify(obj ?? {}, null, 2); }
function setLast(lbl){ lastAction = lbl; $("lastLabel").textContent = lbl; }

function enableUI(on){
  $("galaxySelect").disabled = !on;
  $("btnRunGalaxy").disabled = !on;
  $("btnGlobal").disabled = !on;
  $("btnDwarfs").disabled = !on;
}

function setProgress(pct){
  const p = Math.max(0, Math.min(100, pct));
  $("progbar").style.width = `${p}%`;
}

// ==== Utils ====
function num(x){
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

// ---- Robust parsing for SPARC rotmod files ----
// Typical .dat columns (space/tab): R  Vobs  eV  Vgas  Vdisk  Vbul  ...
// We map: 0->R_kpc, 1->Vobs, 3->Vgas, 4->Vdisk, 5->Vbul
function parseRotmod(text){
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  const rows = [];
  for(const line of lines){
    const p = line.split(/\s+/).filter(Boolean);
    if(p.length < 2) continue;

    const R_kpc = num(p[0]);
    const Vobs  = num(p[1]);

    // tolerate missing columns
    const Vgas  = num(p[3] ?? 0);
    const Vdisk = num(p[4] ?? 0);
    const Vbul  = num(p[5] ?? 0);

    if(!Number.isFinite(R_kpc) || !Number.isFinite(Vobs)) continue;

    rows.push({
      R_kpc,
      Vobs,
      Vgas: Number.isFinite(Vgas) ? Vgas : 0,
      Vdisk: Number.isFinite(Vdisk) ? Vdisk : 0,
      Vbul: Number.isFinite(Vbul) ? Vbul : 0
    });
  }
  return rows;
}

// ==== HTTP ====
async function postJSON(url, body){
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  if(!r.ok){
    const t = await r.text().catch(()=> "");
    throw new Error(`HTTP ${r.status}: ${t}`);
  }
  return await r.json();
}

// ==== ZIP loading (LOCAL ONLY) ====
async function loadZipFromFile(file){
  setProgress(0);
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  galaxies = {};
  const paths = Object.keys(zip.files).filter(p => !zip.files[p].dir);
  const dataFiles = paths.filter(p => /\.(dat|txt)$/i.test(p));

  if(!dataFiles.length){
    setProgress(0);
    return 0;
  }

  let done = 0;
  for(const path of dataFiles){
    const entry = zip.files[path];
    const txt = await entry.async("string");
    const rows = parseRotmod(txt);
    if(rows.length){
      const shortName = path.split("/").pop();
      galaxies[shortName] = rows;
    }
    done++;
    setProgress(Math.round((done / dataFiles.length) * 100));
  }

  // Populate selector
  const sel = $("galaxySelect");
  sel.innerHTML = "";
  Object.keys(galaxies).sort().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  setCount();
  enableUI(Object.keys(galaxies).length > 0);
  return Object.keys(galaxies).length;
}

// ==== Plotting ====
function drawGalaxy(macro){
  const r = macro.data.map(d => d.R_kpc);
  const vObs = macro.data.map(d => d.V_obs);
  const vPred = macro.data.map(d => d.V_pred);

  Plotly.newPlot("plot", [
    { x:r, y:vObs, mode:"markers", name:"Observed", marker:{size:7} },
    { x:r, y:vPred, mode:"lines", name:"Predicted", line:{width:3} }
  ], {
    title: `${macro.galaxy} — RMS=${macro.rms_kms.toFixed(3)} km/s`,
    xaxis:{title:"r (kpc)"},
    yaxis:{title:"V (km/s)"},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#e9f1ff"}
  }, {responsive:true, displaylogo:false, scrollZoom:true});

  lastPNGTarget = "plot";
  $("btnPNG").disabled = false;
}

function drawBars(title, items){
  const y = items.map(it => it.galaxy);
  const x = items.map(it => it.rms_kms);

  Plotly.newPlot("plotGlobal", [
    { x, y, type:"bar", orientation:"h", name:"RMS" }
  ], {
    title,
    xaxis:{title:"RMS (km/s)"},
    margin:{l:260, r:20, t:60, b:40},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"#e9f1ff"}
  }, {responsive:true, displaylogo:false, scrollZoom:true});

  lastPNGTarget = "plotGlobal";
  $("btnPNG").disabled = false;
}

// ==== CSV ====
function toCSV(rows){
  const cols = ["R_kpc","V_obs","V_pred"];
  return cols.join(",") + "\n" + rows.map(r => cols.map(c => r[c]).join(",")).join("\n");
}
function downloadText(filename, text){
  const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ==== Pack all for backend ====
function packAll(){
  const names = Object.keys(galaxies);
  return { galaxies: names.map(n => ({ galaxy_name: n, rows: galaxies[n] })) };
}

// ==== UI Handlers ====
$("zipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if(!file) return;

  try{
    setStatus("Cargando ZIP local...", "warn");
    $("btnCSV").disabled = true;
    $("btnPNG").disabled = true;
    lastCSV = "";
    setMicro({});
    setRMS("—");
    setLast("ZIP loading");

    const n = await loadZipFromFile(file);
    if(!n){
      setStatus("ZIP cargado pero no encontré archivos .dat/.txt dentro.", "bad");
      return;
    }
    setStatus(`ZIP listo: ${n} galaxias. Elegí una y ejecutá.`, "ok");
    setLast("ZIP loaded");
  }catch(err){
    console.error(err);
    setStatus(`ERROR ZIP: ${err.message}`, "bad");
  }
});

$("btnRunGalaxy").addEventListener("click", async () => {
  const name = $("galaxySelect").value;
  if(!name || !galaxies[name]) return;

  try{
    setStatus(`Calculando ${name} ...`, "warn");
    setLast(`compute:${name}`);
    const res = await postJSON(URL_COMPUTE, { galaxy_name: name, rows: galaxies[name] });

    setMicro(res.micro);
    drawGalaxy(res.macro);

    const rms = res.macro.rms_kms.toFixed(3);
    setRMS(rms);
    setStatus(`OK: ${name} RMS=${rms} km/s`, "ok");

    lastCSV = toCSV(res.macro.data);
    $("btnCSV").disabled = false;
  }catch(err){
    console.error(err);
    setStatus(`ERROR compute: ${err.message}`, "bad");
  }
});

$("btnGlobal").addEventListener("click", async () => {
  try{
    const payload = packAll();
    if(!payload.galaxies.length){
      setStatus("Primero cargá el ZIP.", "warn");
      return;
    }

    setStatus("Calculando Global RMS (todas) ...", "warn");
    setLast("global_rms");
    const res = await postJSON(URL_GLOBAL, payload);

    setMicro(res.micro);
    drawBars(`Global RMS — N=${res.global.count} — Global=${res.global.global_rms_kms.toFixed(3)} km/s`,
             res.global.per_galaxy);

    const grms = res.global.global_rms_kms.toFixed(3);
    setRMS(grms);
    setStatus(`OK: Global RMS=${grms} km/s`, "ok");

    const items = res.global.per_galaxy;
    lastCSV = ["galaxy,rms_kms"].concat(items.map(it => `${it.galaxy},${it.rms_kms}`)).join("\n");
    $("btnCSV").disabled = false;
  }catch(err){
    console.error(err);
    setStatus(`ERROR global: ${err.message}`, "bad");
  }
});

$("btnDwarfs").addEventListener("click", async () => {
  try{
    const payload = packAll();
    if(!payload.galaxies.length){
      setStatus("Primero cargá el ZIP.", "warn");
      return;
    }

    setStatus("Calculando Dwarfs RMS ...", "warn");
    setLast("dwarfs");
    const res = await postJSON(URL_DWARFS, payload);

    setMicro(res.micro);
    drawBars(`Dwarfs RMS — N=${res.dwarfs.count} — Dwarfs=${res.dwarfs.dwarfs_rms_kms.toFixed(3)} km/s`,
             res.dwarfs.per_galaxy);

    const drms = res.dwarfs.dwarfs_rms_kms.toFixed(3);
    setRMS(drms);
    setStatus(`OK: Dwarfs RMS=${drms} km/s`, "ok");

    const items = res.dwarfs.per_galaxy;
    lastCSV = ["galaxy,rms_kms"].concat(items.map(it => `${it.galaxy},${it.rms_kms}`)).join("\n");
    $("btnCSV").disabled = false;
  }catch(err){
    console.error(err);
    setStatus(`ERROR dwarfs: ${err.message}`, "bad");
  }
});

$("btnCSV").addEventListener("click", () => {
  if(!lastCSV){
    setStatus("No hay CSV todavía.", "warn");
    return;
  }
  const name = $("galaxySelect").value || "result";
  downloadText(`${name}.csv`, lastCSV);
});

$("btnPNG").addEventListener("click", async () => {
  try{
    const div = $(lastPNGTarget);
    const dataUrl = await Plotly.toImage(div, {format:"png", height:850, width:1400, scale:2});
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${lastPNGTarget}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }catch(err){
    console.error(err);
    setStatus(`ERROR PNG: ${err.message}`, "bad");
  }
});

$("btnReset").addEventListener("click", () => location.reload());

// Drag & drop ZIP
const dz = $("dropzone");
dz.addEventListener("dragover", (e)=>{ e.preventDefault(); dz.style.borderColor = "rgba(75,124,255,.8)"; });
dz.addEventListener("dragleave", ()=>{ dz.style.borderColor = "#2a3a52"; });
dz.addEventListener("drop", async (e)=>{
  e.preventDefault();
  dz.style.borderColor = "#2a3a52";
  const file = e.dataTransfer?.files?.[0];
  if(!file) return;
  $("zipFile").files = e.dataTransfer.files; // reflect selection
  // trigger same handler
  const evt = new Event("change");
  $("zipFile").dispatchEvent(evt);
});

// Boot
setStatus("Cargá el ZIP local para empezar.", "warn");
enableUI(false);
setCount();
setRMS("—");
setMicro({});
setLast("—");
setProgress(0);
