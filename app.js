// ===== Config =====
const BASE = "https://thot-engine.onrender.com";
const URL_COMPUTE = `${BASE}/compute`;
const URL_GLOBAL = `${BASE}/global_rms`;
const URL_DWARFS = `${BASE}/dwarfs`;

// ===== State =====
let galaxies = {}; // { filename: rows[] }
let lastCSV = "";
let lastPNGTarget = "plot";
let lastGlobalCSV = "";

// ===== DOM helpers =====
const $ = (id) => document.getElementById(id);

function setDot(kind){
  const d = $("dot");
  d.className = `dot ${kind}`;
}
function setStatus(msg, kind="warn"){
  setDot(kind);
  $("status").textContent = msg;
}
function setMicro(obj){
  $("microOut").textContent = JSON.stringify(obj ?? {}, null, 2);
}
function setPills(){
  const n = Object.keys(galaxies).length;
  $("pillCount").textContent = `ZIP: ${n ? n : "—"}`;
}
function enableUI(on){
  $("galaxySelect").disabled = !on;
  $("btnRunGalaxy").disabled = !on;
  $("btnGlobal").disabled = !on;
  $("btnDwarfs").disabled = !on;
}

// ===== Parse SPARC rotmod =====
// Supports whitespace or comma separated.
// Uses the column positions compatible with your previous Falcon parser:
// R, Vobs, eVobs, Vgas, Vdisk, Vbul
function parseRotmod(text){
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  const rows = [];
  for (const line of lines){
    const p = line.split(/[,\s]+/).filter(Boolean);
    if (p.length < 2) continue;

    const R_kpc = num(p[0]);
    const Vobs = num(p[1]);
    const Vgas = num(p[3] ?? 0);
    const Vdisk = num(p[4] ?? 0);
    const Vbul = num(p[5] ?? 0);

    if (!Number.isFinite(R_kpc) || !Number.isFinite(Vobs)) continue;
    rows.push({ R_kpc, Vobs, Vgas: Vgas||0, Vdisk: Vdisk||0, Vbul: Vbul||0 });
  }
  return rows;
}
function num(x){ const v = Number(x); return Number.isFinite(v) ? v : NaN; }

// ===== HTTP =====
async function postJSON(url, body){
  const r = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(body)
  });
  if (!r.ok){
    const t = await r.text().catch(()=> "");
    throw new Error(`HTTP ${r.status}: ${t}`);
  }
  return await r.json();
}

// ===== CSV helpers =====
function toCSV(rows){
  const cols = ["R_kpc","V_obs","V_pred"];
  const head = cols.join(",");
  const body = rows.map(r => cols.map(c => (r[c] ?? "")).join(",")).join("\n");
  return `${head}\n${body}`;
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
async function downloadPNG(plotId){
  if (!window.Plotly) throw new Error("Plotly not loaded");
  const div = $(plotId);
  const dataUrl = await Plotly.toImage(div, {format:"png", height:850, width:1400, scale:2});
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `${plotId}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ===== Plot =====
function drawGalaxy(macro){
  const r = macro.data.map(d => d.R_kpc);
  const vObs = macro.data.map(d => d.V_obs);
  const vPred = macro.data.map(d => d.V_pred);

  $("galaxyLabel").textContent = macro.galaxy;
  $("kpiRMS").textContent = macro.rms_kms.toFixed(3);
  $("kpiMode").textContent = (String(macro.galaxy).toLowerCase().includes("camb")) ? "CamB (HI/Joule)" : "Coherent";
  $("kpiRows").textContent = String(macro.data.length);

  Plotly.newPlot("plot", [
    { x:r, y:vObs, mode:"markers", name:"Observed", marker:{size:7} },
    { x:r, y:vPred, mode:"lines", name:"Predicted", line:{width:3} }
  ], {
    title: `Galaxy: ${macro.galaxy} — RMS=${macro.rms_kms.toFixed(3)} km/s`,
    xaxis:{title:"r (kpc)", gridcolor:"rgba(255,255,255,.06)"},
    yaxis:{title:"V (km/s)", gridcolor:"rgba(255,255,255,.06)"},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"rgba(230,238,251,.95)"}
  }, {responsive:true, displaylogo:false, scrollZoom:true});

  lastCSV = toCSV(macro.data);
  lastPNGTarget = "plot";
  $("btnCSV").disabled = false;
  $("btnPNG").disabled = false;
}

function drawBars(title, items, summaryText){
  const y = items.map(x => x.galaxy);
  const x = items.map(x => x.rms_kms);

  $("globalLabel").textContent = summaryText;

  Plotly.newPlot("plotGlobal", [
    { x, y, type:"bar", orientation:"h", name:"RMS" }
  ], {
    title,
    xaxis:{title:"RMS (km/s)", gridcolor:"rgba(255,255,255,.06)"},
    yaxis:{title:"Galaxy", gridcolor:"rgba(255,255,255,.06)"},
    margin:{l:240, r:20, t:60, b:50},
    paper_bgcolor:"rgba(0,0,0,0)",
    plot_bgcolor:"rgba(0,0,0,0)",
    font:{color:"rgba(230,238,251,.95)"}
  }, {responsive:true, displaylogo:false, scrollZoom:true});

  lastPNGTarget = "plotGlobal";
  $("btnPNG").disabled = false;

  // CSV global/dwarfs
  lastGlobalCSV = ["galaxy,rms_kms"].concat(items.map(it => `${it.galaxy},${it.rms_kms}`)).join("\n");
}

// ===== Pack for backend =====
function packAllGalaxies(){
  const names = Object.keys(galaxies);
  return { galaxies: names.map(n => ({ galaxy_name: n, rows: galaxies[n] })) };
}

// ===== Events =====
$("zipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try{
    setStatus("Cargando ZIP...", "warn");

    const zip = await JSZip.loadAsync(file);
    galaxies = {};

    const files = Object.keys(zip.files);
    for (const path of files){
      const entry = zip.files[path];
      if (entry.dir) continue;
      if (!(/\.(csv|dat)$/i.test(path))) continue;

      const content = await entry.async("string");
      const rows = parseRotmod(content);
      if (!rows.length) continue;

      const name = path.split("/").pop();
      galaxies[name] = rows;
    }

    const names = Object.keys(galaxies).sort();
    const sel = $("galaxySelect");
    sel.innerHTML = "";
    for (const n of names){
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = n;
      sel.appendChild(opt);
    }

    setPills();
    enableUI(names.length > 0);
    $("btnCSV").disabled = true;
    $("btnPNG").disabled = true;
    lastCSV = "";
    lastGlobalCSV = "";

    setStatus(`ZIP listo. Galaxias: ${names.length}`, names.length ? "ok" : "bad");
  }catch(err){
    console.error(err);
    setStatus(`Error ZIP: ${err.message}`, "bad");
  }
});

$("btnRunGalaxy").addEventListener("click", async () => {
  const name = $("galaxySelect").value;
  if (!name || !galaxies[name]) return;

  try{
    setStatus(`Calculando ${name} ...`, "warn");
    const res = await postJSON(URL_COMPUTE, { galaxy_name: name, rows: galaxies[name] });

    setMicro(res.micro);
    drawGalaxy(res.macro);

    setStatus(`OK: ${name} RMS=${res.macro.rms_kms.toFixed(3)} km/s`, "ok");
  }catch(err){
    console.error(err);
    setStatus(`Error compute: ${err.message}`, "bad");
  }
});

$("btnGlobal").addEventListener("click", async () => {
  try{
    const payload = packAllGalaxies();
    if (!payload.galaxies.length){ setStatus("Cargá ZIP primero.", "warn"); return; }

    setStatus("Calculando Global RMS (todas) ...", "warn");
    const res = await postJSON(URL_GLOBAL, payload);

    setMicro(res.micro);
    const items = res.global.per_galaxy;
    drawBars(
      `Global RMS — N=${res.global.count} — Global=${res.global.global_rms_kms.toFixed(3)} km/s`,
      items,
      `Global RMS: ${res.global.global_rms_kms.toFixed(3)} km/s · N=${res.global.count}`
    );

    setStatus(`OK: Global RMS=${res.global.global_rms_kms.toFixed(3)} km/s`, "ok");
  }catch(err){
    console.error(err);
    setStatus(`Error global: ${err.message}`, "bad");
  }
});

$("btnDwarfs").addEventListener("click", async () => {
  try{
    const payload = packAllGalaxies();
    if (!payload.galaxies.length){ setStatus("Cargá ZIP primero.", "warn"); return; }

    setStatus("Calculando Dwarfs RMS ...", "warn");
    const res = await postJSON(URL_DWARFS, payload);

    setMicro(res.micro);
    const items = res.dwarfs.per_galaxy;
    drawBars(
      `Dwarfs RMS — N=${res.dwarfs.count} — Dwarfs=${res.dwarfs.dwarfs_rms_kms.toFixed(3)} km/s`,
      items,
      `Dwarfs RMS: ${res.dwarfs.dwarfs_rms_kms.toFixed(3)} km/s · N=${res.dwarfs.count}`
    );

    setStatus(`OK: Dwarfs RMS=${res.dwarfs.dwarfs_rms_kms.toFixed(3)} km/s`, "ok");
  }catch(err){
    console.error(err);
    setStatus(`Error dwarfs: ${err.message}`, "bad");
  }
});

$("btnCSV").addEventListener("click", () => {
  const name = $("galaxySelect").value || "galaxy";
  if (lastCSV){
    downloadText(`${name}_pred.csv`, lastCSV);
    return;
  }
  if (lastGlobalCSV){
    downloadText(`global_rms.csv`, lastGlobalCSV);
    return;
  }
  setStatus("No hay CSV disponible todavía.", "warn");
});

$("btnPNG").addEventListener("click", async () => {
  try{
    await downloadPNG(lastPNGTarget);
  }catch(err){
    console.error(err);
    setStatus(`PNG error: ${err.message}`, "bad");
  }
});

$("btnReset").addEventListener("click", () => location.reload());

// Boot status
$("pillBackend").textContent = `Backend: ${BASE}`;
setStatus("Load ZIP para empezar.", "warn");