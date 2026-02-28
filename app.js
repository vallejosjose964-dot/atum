const BASE = "https://TU-SERVICIO.onrender.com"; // <-- tu Render
const URL_COMPUTE = `${BASE}/compute`;
const URL_GLOBAL  = `${BASE}/global_rms`;
const URL_DWARFS  = `${BASE}/dwarfs`;

let galaxies = {}; // { name: rows[] }

const $ = (id) => document.getElementById(id);

$("zipFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setStatus("Loading ZIP...");
  const zip = await JSZip.loadAsync(file);
  galaxies = {};

  // lee .csv o .dat del zip
  for (const filename of Object.keys(zip.files)) {
    const entry = zip.files[filename];
    if (entry.dir) continue;
    if (!(/\.(csv|dat)$/i.test(filename))) continue;

    const content = await entry.async("string");
    const rows = parseRotmod(content);
    if (rows.length) {
      const base = filename.split("/").pop(); // nombre corto
      galaxies[base] = rows;
    }
  }

  // poblar selector
  const sel = $("galaxySelect");
  sel.innerHTML = "";
  Object.keys(galaxies).sort().forEach(name => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  setStatus(`ZIP loaded. Galaxies: ${Object.keys(galaxies).length}`);
});

function parseRotmod(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.startsWith("#"));

  // asume columnas: R Vobs eVobs Vgas Vdisk Vbul (como tu Falcon)
  const rows = [];
  for (const line of lines) {
    const p = line.split(/[,\s]+/).filter(Boolean);
    if (p.length < 2) continue;

    const R_kpc = num(p[0]);
    const Vobs  = num(p[1]);
    const Vgas  = num(p[3] ?? 0);
    const Vdisk = num(p[4] ?? 0);
    const Vbul  = num(p[5] ?? 0);

    if (!Number.isFinite(R_kpc) || !Number.isFinite(Vobs)) continue;

    rows.push({ R_kpc, Vobs, Vgas: Vgas||0, Vdisk: Vdisk||0, Vbul: Vbul||0 });
  }
  return rows;
}
function num(x){ const v = Number(x); return Number.isFinite(v) ? v : NaN; }

function setStatus(msg){ $("statusOutput").textContent = msg; }
function setMicro(m){ $("microOutput").textContent = JSON.stringify(m, null, 2); }

$("runGalaxy").addEventListener("click", async () => {
  const name = $("galaxySelect").value;
  if (!name || !galaxies[name]) return;

  setStatus(`Computing galaxy: ${name} ...`);
  const res = await postJSON(URL_COMPUTE, { galaxy_name: name, rows: galaxies[name] });

  setMicro(res.micro);
  setStatus(`RMS ${name}: ${res.macro.rms_kms.toFixed(3)} km/s`);
  drawGalaxy(res.macro);
});

$("runGlobal").addEventListener("click", async () => {
  const payload = packAllGalaxies();
  if (!payload) return;

  setStatus("Computing GLOBAL RMS (all galaxies) ...");
  const res = await postJSON(URL_GLOBAL, payload);

  setMicro(res.micro);
  setStatus(`Global RMS: ${res.global.global_rms_kms.toFixed(3)} km/s | N=${res.global.count}`);
  drawBar("plotGlobal", "Global RMS (all)", res.global.per_galaxy);
});

$("runDwarfs").addEventListener("click", async () => {
  const payload = packAllGalaxies();
  if (!payload) return;

  setStatus("Computing DWARFS RMS ...");
  const res = await postJSON(URL_DWARFS, payload);

  setMicro(res.micro);
  setStatus(`Dwarfs RMS: ${res.dwarfs.dwarfs_rms_kms.toFixed(3)} km/s | N=${res.dwarfs.count}`);
  drawBar("plotGlobal", "Dwarfs RMS", res.dwarfs.per_galaxy);
});

function packAllGalaxies(){
  const names = Object.keys(galaxies);
  if (!names.length) { setStatus("Load ZIP first."); return null; }
  // Enviar todo al backend como lista
  return { galaxies: names.map(n => ({ galaxy_name: n, rows: galaxies[n] })) };
}

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

function drawGalaxy(macro){
  const r = macro.data.map(d => d.R_kpc);
  const vObs = macro.data.map(d => d.V_obs);
  const vPred = macro.data.map(d => d.V_pred);

  Plotly.newPlot("plot", [
    { x:r, y:vObs, mode:"markers", name:"Observed" },
    { x:r, y:vPred, mode:"lines", name:"Predicted" }
  ], { title: `${macro.galaxy} | RMS=${macro.rms_kms.toFixed(3)} km/s`, xaxis:{title:"r (kpc)"}, yaxis:{title:"V (km/s)"} });
}

function drawBar(divId, title, items){
  const y = items.map(x => x.galaxy);
  const x = items.map(x => x.rms_kms);
  Plotly.newPlot(divId, [
    { x, y, type:"bar", orientation:"h", name:"RMS" }
  ], { title, xaxis:{title:"RMS (km/s)"}, margin:{l:220} });
}