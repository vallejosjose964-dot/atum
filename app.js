'use strict';

/**
 * Millennium Falcon — Frontend from scratch
 * - No motor matemático aquí.
 * - Modo Local: stubs para validar flujo/UI.
 * - Modo Backend: llama THOT (configurable).
 *
 * Cambiás endpoints acá y listo. Nada más.
 */

const CONFIG = {
  backendBase: 'https://thot-engine.onrender.com',
  // Endpoints propuestos (AJUSTAR cuando confirmes los reales):
  endpoints: {
    ping: '/health',         // GET
    macro: '/macro',         // POST (files/form-data o json)
    micro: '/micro',         // POST
    both: '/run',            // POST (micro+macro)
    globalRms: '/global/rms',// POST
  },
  requestTimeoutMs: 45000
};

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const logEl = $('log');
const statusLine = $('statusLine');
const backendDot = $('backendDot');
const backendLabel = $('backendLabel');
const modeSel = $('mode');
const fileInput = $('fileInput');

const btnPing = $('btnPing');
const btnClear = $('btnClear');
const btnRunMacro = $('btnRunMacro');
const btnRunMicro = $('btnRunMicro');
const btnRunBoth = $('btnRunBoth');
const btnGlobalRMS = $('btnGlobalRMS');
const btnGlobalCSV = $('btnGlobalCSV');

const resultsBody = $('resultsBody');

let lastGlobalCSV = null; // Blob URL

// ---------- Utils ----------
function now(){
  const d = new Date();
  return d.toISOString().replace('T',' ').slice(0,19);
}
function log(msg){
  logEl.textContent += `[${now()}] ${msg}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}
function setStatus(msg){ statusLine.textContent = msg; }

function setBackendStatus(state, label){
  backendDot.classList.remove('ok','bad');
  if(state === 'ok') backendDot.classList.add('ok');
  else if(state === 'bad') backendDot.classList.add('bad');
  backendLabel.textContent = label;
}

function getMode(){
  return modeSel.value; // 'local' | 'backend'
}

function filesSelected(){
  return fileInput.files && fileInput.files.length ? Array.from(fileInput.files) : [];
}

function resetResults(){
  resultsBody.innerHTML = '';
  btnGlobalCSV.disabled = true;
  if(lastGlobalCSV){
    URL.revokeObjectURL(lastGlobalCSV);
    lastGlobalCSV = null;
  }
}

function addResultRow({name, type, output, detail}){
  const tr = document.createElement('tr');
  const idx = resultsBody.children.length + 1;
  tr.innerHTML = `
    <td>${idx}</td>
    <td>${escapeHtml(name || '-')}</td>
    <td>${escapeHtml(type || '-')}</td>
    <td>${escapeHtml(output || '-')}</td>
    <td>${escapeHtml(detail || '')}</td>
  `;
  resultsBody.appendChild(tr);
}

function escapeHtml(s){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

function abortableFetch(url, opts = {}){
  const ctrl = new AbortController();
  const to = setTimeout(()=>ctrl.abort('timeout'), CONFIG.requestTimeoutMs);
  return fetch(url, {...opts, signal: ctrl.signal}).finally(()=>clearTimeout(to));
}

// ---------- Backend calls ----------
async function pingBackend(){
  const url = CONFIG.backendBase + CONFIG.endpoints.ping;
  setStatus('Ping backend...');
  try{
    const r = await abortableFetch(url, { method:'GET' });
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    setBackendStatus('ok', `Backend: online (${r.status})`);
    setStatus('Backend online.');
    log(`PING ok: ${url}`);
    return true;
  }catch(err){
    setBackendStatus('bad', `Backend: unreachable`);
    setStatus('Backend no responde.');
    log(`PING fail: ${url} :: ${err}`);
    return false;
  }
}

async function postToBackend(endpointKey, payload){
  const url = CONFIG.backendBase + CONFIG.endpoints[endpointKey];
  const r = await abortableFetch(url, payload);
  const ct = (r.headers.get('content-type')||'').toLowerCase();
  let data = null;
  if(ct.includes('application/json')) data = await r.json();
  else data = await r.text();
  if(!r.ok){
    const msg = typeof data === 'string' ? data : JSON.stringify(data);
    throw new Error(`HTTP ${r.status} :: ${msg.slice(0,300)}`);
  }
  return data;
}

function buildFormData(){
  const fd = new FormData();
  for(const f of filesSelected()){
    fd.append('files', f, f.name);
  }
  return fd;
}

// ---------- Local stubs (sin teoría, sólo UI) ----------
async function localStub(kind){
  // Simula una ejecución y devuelve resultados con la misma forma para UI.
  const files = filesSelected();
  const n = Math.max(1, files.length || 1);
  const out = [];
  for(let i=0;i<n;i++){
    const fname = files[i]?.name || `demo_${i+1}.csv`;
    out.push({
      name: fname,
      type: kind.toUpperCase(),
      output: 'OK',
      detail: kind === 'globalRms' ? 'RMS=0.20 (stub)' : 'Resultado (stub)'
    });
  }
  await new Promise(r=>setTimeout(r, 250));
  return { results: out, csv: kind === 'globalRms' ? makeCSV(out) : null };
}

function makeCSV(rows){
  const header = ['name','type','output','detail'];
  const lines = [header.join(',')];
  for(const r of rows){
    lines.push([r.name,r.type,r.output, String(r.detail).replaceAll(',',';')].join(','));
  }
  return lines.join('\n');
}

// ---------- Run actions ----------
async function run(kind){
  resetResults();
  const mode = getMode();
  const files = filesSelected();

  log(`RUN ${kind} | mode=${mode} | files=${files.length}`);

  setStatus(`Corriendo ${kind}...`);

  try{
    let data;

    if(mode === 'backend'){
      // En backend: NO invento formato final. Envío form-data "files" y listo.
      // Si tu backend usa JSON, lo cambiamos después (sin tocar UI).
      const fd = buildFormData();
      data = await postToBackend(kind, { method:'POST', body: fd });
    }else{
      data = await localStub(kind);
    }

    // Normalización: acepto json tipo {results:[...], csv:"..."} o texto.
    if(typeof data === 'string'){
      addResultRow({ name:'-', type: kind.toUpperCase(), output:'OK', detail: data.slice(0,160) + (data.length>160?'…':'') });
    }else{
      const results = data.results || data.items || [];
      if(results.length){
        for(const r of results){
          addResultRow({
            name: r.name || r.object || r.galaxy || '-',
            type: r.type || kind.toUpperCase(),
            output: r.output || r.status || 'OK',
            detail: r.detail || r.message || JSON.stringify(r).slice(0,160)
          });
        }
      }else{
        addResultRow({ name:'-', type: kind.toUpperCase(), output:'OK', detail: 'Respuesta JSON recibida (sin results).' });
      }

      if(data.csv){
        const blob = new Blob([data.csv], {type:'text/csv;charset=utf-8'});
        lastGlobalCSV = URL.createObjectURL(blob);
        btnGlobalCSV.disabled = false;
      }
    }

    setStatus(`Listo: ${kind}.`);
    log(`DONE ${kind}`);
  }catch(err){
    setStatus(`Error en ${kind}.`);
    addResultRow({ name:'-', type: kind.toUpperCase(), output:'ERROR', detail: String(err) });
    log(`ERR ${kind}: ${err}`);
  }
}

// ---------- CSV download ----------
function downloadGlobalCSV(){
  if(!lastGlobalCSV) return;
  const a = document.createElement('a');
  a.href = lastGlobalCSV;
  a.download = 'global_results.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ---------- Wiring ----------
btnPing.addEventListener('click', pingBackend);

btnClear.addEventListener('click', ()=>{
  fileInput.value = '';
  resetResults();
  setStatus('Limpio.');
  log('CLEAR');
});

btnRunMacro.addEventListener('click', ()=>run('macro'));
btnRunMicro.addEventListener('click', ()=>run('micro'));
btnRunBoth.addEventListener('click', ()=>run('both'));
btnGlobalRMS.addEventListener('click', ()=>run('globalRms'));
btnGlobalCSV.addEventListener('click', downloadGlobalCSV);

modeSel.addEventListener('change', ()=>{
  const m = getMode();
  log(`MODE -> ${m}`);
  if(m === 'backend'){
    setBackendStatus('', 'Backend: no verificado');
  }else{
    setBackendStatus('', 'Backend: (modo local)');
  }
});

// Boot
(function init(){
  log('BOOT');
  setBackendStatus('', 'Backend: no verificado');
  setStatus('Listo.');
})();
