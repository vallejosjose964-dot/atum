"use strict"; window.__MF_VERSION__="MFv11_CLEAR_CAMB_2026-02-21"; console.log("[MF]", window.__MF_VERSION__); const $=(id)=>document.getElementById(id); const el=new Proxy({}, {get(_,k){return $(k);}}); const CONST={ ML_UNIV:0.51, ASTAR:1.5e-10, KPC_TO_M:3.085677581491367e19, KMPS_TO_MPS:1000 }; const KERNEL_MODE="SQRT"; const HI={ V_HI:5.0, SIGMA_HI:8.0, get C(){ return (this.V_HI/this.SIGMA_HI)**2; }, get sqrtC(){ return Math.sqrt(this.C); } }; const state={zip:null, files:[], galaxies:[], currentGalaxy:null, lastCSV:null, lastGlobalCSV:null, lastDwarfsCSV:null, lastPNGTarget:null}; function setText(id,txt){const n=$(id); if(n) n.textContent=txt;} function enable(id,on){const n=$(id); if(n) n.disabled=!on;} function safeNum(x){const v=Number(x); return Number.isFinite(v)?v:NaN;} function rms(arr){let s=0,n=0; for(const v of arr){if(Number.isFinite(v)){s+=v*v; n++;}} return n?Math.sqrt(s/n):NaN;} function vbar2(row){ const vgas=row.Vgas, vdisk=row.Vdisk, vbul=row.Vbul; if(![vgas,vdisk,vbul].every(Number.isFinite)) return NaN; return vgas*vgas + CONST.ML_UNIV*(vdisk*vdisk + vbul*vbul); } function aN(row){ const vb2=vbar2(row); const r=row.R_kpc*CONST.KPC_TO_M; if(!Number.isFinite(vb2) || !(r>0)) return NaN; return (vb2*(CONST.KMPS_TO_MPS**2))/r; } function aKernel(aN_,aStar){ if(!(aN_>0) || !(aStar>0)) return 0; if(KERNEL_MODE==="OHM_HALF") return 0.5*(aN_+Math.sqrt(aN_*aN_+4*aN_*aStar)); return Math.sqrt(aN_*aN_ + aN_*aStar); } function isCamB(name){ return String(name||"").toLowerCase().includes("camb"); } function getAstar(){ const user=safeNum(el.astarOverride?.value); return (Number.isFinite(user)&&user>0)?user:CONST.ASTAR; } function parseRotmodText(text){ const lines=String(text).split(/\r?\n/).map(l=>l.trim()).filter(l=>l && !l.startsWith("#")); if(!lines.length) return []; const header=/[A-Za-z]/.test(lines[0]) ? lines[0].split(/[\s,]+/).map(s=>s.trim()) : null; const start=header?1:0; const idx=(h,n)=>h.findIndex(x=>x.toLowerCase()===n.toLowerCase()); const rows=[]; for(let i=start;i<lines.length;i++){ const p=lines[i].split(/[\s,]+/); if(p.length<2) continue; let R_kpc,Vobs,eVobs,Vgas,Vdisk,Vbul; if(header){ const pick=(n,f)=>{const j=idx(header,n); return safeNum(p[(j>=0)?j:f]);}; R_kpc=pick("R",0); Vobs=pick("Vobs",1); eVobs=pick("eVobs",2); Vgas=pick("Vgas",3); Vdisk=pick("Vdisk",4); Vbul=pick("Vbul",5); }else{ R_kpc=safeNum(p[0]); Vobs=safeNum(p[1]); eVobs=safeNum(p[2]); Vgas=safeNum(p[3]); Vdisk=safeNum(p[4]); Vbul=safeNum(p[5]); } if(!Number.isFinite(R_kpc)||!Number.isFinite(Vobs)) continue; rows.push({R_kpc,Vobs,eVobs:Number.isFinite(eVobs)?eVobs:NaN,Vgas:Number.isFinite(Vgas)?Vgas:0,Vdisk:Number.isFinite(Vdisk)?Vdisk:0,Vbul:Number.isFinite(Vbul)?Vbul:0}); } return rows; } function compute(name,rows){ const aStar=getAstar(); setText("kpiAstar", aStar.toExponential(3)); const camB=isCamB(name); const factor = camB ? HI.C : 1.0; const residuals=[], table=[]; for(const row of rows){ const aN_=aN(row); const aEff=aKernel(aN_,aStar); const r=row.R_kpc*CONST.KPC_TO_M; const V_kernel = Math.sqrt(Math.max(0,r*aEff))/CONST.KMPS_TO_MPS; const V_real = V_kernel * factor; table.push({ ...row, V_kernel, V_real, C: camB ? HI.C : "", sqrtC: camB ? HI.sqrtC : "", camB_factor: camB ? factor : "", aN_mps2:aN_, aEff_mps2:aEff }); if(Number.isFinite(V_real) && Number.isFinite(row.Vobs)) residuals.push(V_real-row.Vobs); } return {table, RMS:rms(residuals), camB, factor}; } function toCSV(table){ const cols=["R_kpc","Vobs","eVobs","Vgas","Vdisk","Vbul","V_kernel","V_real","C","sqrtC","camB_factor","aN_mps2","aEff_mps2"]; return [cols.join(",")].concat(table.map(r=>cols.map(c=>(r[c]??"")).join(","))).join("\n"); } function downloadText(filename,text){ const blob=new Blob([text],{type:"text/plain;charset=utf-8"}); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); } async function downloadPNG(plotId){ if(!window.Plotly) throw new Error("Plotly not loaded"); const div=$(plotId); const dataUrl=await Plotly.toImage(div,{format:"png",height:850,width:1400,scale:2}); const a=document.createElement("a"); a.href=dataUrl; a.download=`${state.currentGalaxy||plotId}.png`; document.body.appendChild(a); a.click(); a.remove(); } function proLayout(title,xTitle,yTitle,left=70){ return { title:{text:title,x:0.02,xanchor:"left"}, xaxis:{title:xTitle,gridcolor:"rgba(255,255,255,.08)",zeroline:false}, yaxis:{title:yTitle,gridcolor:"rgba(255,255,255,.08)",zeroline:false}, margin:{l:left,r:30,t:70,b:55}, paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)", font:{family:"system-ui,-apple-system,Segoe UI,Roboto,Arial",color:"rgba(245,248,255,.92)"}, legend:{orientation:"h",y:1.12,x:0.02} }; } function proConfig(){return {responsive:true,displaylogo:false,scrollZoom:true};} function populateGalaxySelect(){ const sel=el.galaxySelect; if(!sel) return; sel.innerHTML=""; for(const g of state.galaxies){const o=document.createElement("option");o.value=g;o.textContent=g;sel.appendChild(o);} sel.disabled=state.galaxies.length===0; setText("heroDataset", state.galaxies.length?`SPARC ZIP (${state.galaxies.length})`:"—"); } async function loadZipFromArrayBuffer(ab,label){ if(!window.JSZip) throw new Error("JSZip not loaded"); const zip=await JSZip.loadAsync(ab); state.zip=zip; const files=[]; zip.forEach((path,entry)=>{ if(!entry.dir && /\.(csv|dat)$/i.test(path)) files.push({name:path,entry}); }); state.files=files; state.galaxies=files.map(f=>f.name.split("/").pop()).filter(n=>/_rotmod\.(csv|dat)$/i.test(n)).sort((a,b)=>a.localeCompare(b)); populateGalaxySelect(); setText("zipStatus", `SPARC listo: ${state.galaxies.length} galaxias (${label}). ` + `CamB law: C=(V_HI/σ_HI)^2=(5/8)^2=${HI.C.toFixed(6)} ; V_real = C · V_kernel` ); ["btnRunGalaxy","btnGlobalRMS","btnRunDwarfs"].forEach(id=>enable(id,true)); if(state.galaxies.length){ el.galaxySelect.value=state.galaxies[0]; await runSelectedGalaxy().catch(()=>{}); } } async function readGalaxy(name){ const lname=String(name||"").toLowerCase(); const f=state.files.find(x=>{const p=x.name.toLowerCase(); return p.endsWith("/"+lname)||p.endsWith(lname);}); if(!f) throw new Error("Galaxy not found in ZIP: "+name); const txt=await f.entry.async("string"); return parseRotmodText(txt); } function setLawBanner(name, factor){ const banner = $("lawBanner"); if(!banner) return; if(isCamB(name)){ banner.textContent = `CamB (descoherente / Joule HI): C=(V_HI/σ_HI)^2=(5/8)^2=${HI.C.toFixed(6)} ⇒ V_real = C·V_kernel (factor=${factor.toFixed(6)})`; banner.style.display = "block"; }else{ banner.textContent = `Coherente: V_real = V_kernel (sin Joule/HI).`; banner.style.display = "block"; } } async function runSelectedGalaxy(){
  const name = el.galaxySelect?.value;
  if(!name) throw new Error("No galaxy selected");

  state.currentGalaxy = name;
  setText("kpiGalaxy", name);
  setText("heroSelected", name);

  // Read dataset row table (from ZIP/repo) — keep Falcon loader
  const rowsRaw = await readGalaxy(name);

  // Map to backend schema (Pydantic)
  const rows = rowsRaw.map(r=>({
    R_kpc: Number(r.R_kpc ?? r.R ?? r.r ?? r[0]),
    Vobs:  Number(r.Vobs  ?? r.V_obs ?? r.vobs ?? r[1]),
    Vgas:  Number(r.Vgas  ?? r.V_gas ?? r.vgas ?? r[3] ?? 0) || 0,
    Vdisk: Number(r.Vdisk ?? r.V_disk?? r.vdisk?? r[4] ?? 0) || 0,
    Vbul:  Number(r.Vbul  ?? r.V_bul ?? r.vbul ?? r[5] ?? 0) || 0,
  })).filter(r=>Number.isFinite(r.R_kpc) && Number.isFinite(r.Vobs));

  // Call backend (macro computed server-side; micro returned too)
  const base = String(el.backendUrl?.value || BASE).replace(/\/+$/,"");
  setText("backendUrlLabel", base);

  const res = await postJSON(base + "/compute", { galaxy_name: name, rows });

  // Micro panel
  if(res?.micro) applyMicroToUI(res.micro);

  // Macro result
  const macro = res?.macro;
  if(!macro || !macro.data) throw new Error("Backend returned no macro data");

  // Prepare Falcon-like table naming for plot
  const table = macro.data.map(d=>({
    R_kpc: d.R_kpc,
    Vobs:  d.V_obs,
    V_real: d.V_pred,
    eVobs: 0
  }));

  const RMS = Number(macro.rms_kms);

  state.lastCSV = toCSV(table);
  setText("kpiRMS", Number.isFinite(RMS) ? RMS.toFixed(2) : "—");
  setText("heroRms", Number.isFinite(RMS) ? (RMS.toFixed(2) + " km/s") : "—");

  // Keep Falcon banner logic (CamB etc) using name only
  setLawBanner(name, 1.0);

  const x = table.map(r=>r.R_kpc);
  const yObs = table.map(r=>r.Vobs);
  const yPred = table.map(r=>r.V_real);

  const obs = {x, y:yObs, mode:"markers", name:"Observed", marker:{size:7}};
  const pred = {x, y:yPred, mode:"lines", name:"Predicted", line:{width:3}};

  Plotly.newPlot(el.plotSparc, [obs, pred],
    proLayout(name, "r (kpc)", "V (km/s)"),
    proConfig()
  );

  state.lastPNGTarget="plotSparc";
  enable("btnCSV", true);
  enable("btnPNG", true);
} async function runGlobalRMS(){
  const base = String(el.backendUrl?.value || BASE).replace(/\/+$/,"");
  setText("backendUrlLabel", base);

  const names = await listGalaxies();
  if(!names?.length) throw new Error("No galaxies loaded");

  // Build payload by reading each galaxy file (Falcon loader) and mapping to backend schema
  const galaxiesPayload = [];
  for(const name of names){
    const rowsRaw = await readGalaxy(name);
    const rows = rowsRaw.map(r=>({
      R_kpc: Number(r.R_kpc ?? r.R ?? r.r ?? r[0]),
      Vobs:  Number(r.Vobs  ?? r.V_obs ?? r.vobs ?? r[1]),
      Vgas:  Number(r.Vgas  ?? r.V_gas ?? r.vgas ?? r[3] ?? 0) || 0,
      Vdisk: Number(r.Vdisk ?? r.V_disk?? r.vdisk?? r[4] ?? 0) || 0,
      Vbul:  Number(r.Vbul  ?? r.V_bul ?? r.vbul ?? r[5] ?? 0) || 0,
    })).filter(r=>Number.isFinite(r.R_kpc) && Number.isFinite(r.Vobs));
    galaxiesPayload.push({galaxy_name:name, rows});
  }

  const res = await postJSON(base + "/global_rms", {galaxies: galaxiesPayload});
  if(res?.micro) applyMicroToUI(res.micro);

  const g = res?.global;
  if(!g?.per_galaxy) throw new Error("Backend returned no global data");

  // Plot bars Falcon-style
  const items = g.per_galaxy;
  Plotly.newPlot(el.plotGlobal, [{
    x: items.map(it=>it.rms_kms),
    y: items.map(it=>it.galaxy),
    type:"bar",
    orientation:"h",
    name:"RMS"
  }], proLayout(`Global RMS — N=${g.count} — Global=${Number(g.global_rms_kms).toFixed(3)} km/s`, "RMS (km/s)", "Galaxy"),
     proConfig());

  // CSV
  state.lastCSV = ["galaxy,rms_kms"].concat(items.map(it=>`${it.galaxy},${it.rms_kms}`)).join("\n");
  state.lastPNGTarget="plotGlobal";
  enable("btnGlobalCSV", true);
  enable("btnPNG", true);
} function isDwarfName(name){ const s=String(name||"").toLowerCase(); return s.includes("camb")||s.includes("draco")||s.includes("ursa")||s.includes("sextans")||s.includes("carina")||s.includes("fornax")||s.includes("sculptor")||s.includes("leo"); } async function runDwarfs(){
  const base = String(el.backendUrl?.value || BASE).replace(/\/+$/,"");
  setText("backendUrlLabel", base);

  const names = await listGalaxies();
  if(!names?.length) throw new Error("No galaxies loaded");

  const galaxiesPayload = [];
  for(const name of names){
    const rowsRaw = await readGalaxy(name);
    const rows = rowsRaw.map(r=>({
      R_kpc: Number(r.R_kpc ?? r.R ?? r.r ?? r[0]),
      Vobs:  Number(r.Vobs  ?? r.V_obs ?? r.vobs ?? r[1]),
      Vgas:  Number(r.Vgas  ?? r.V_gas ?? r.vgas ?? r[3] ?? 0) || 0,
      Vdisk: Number(r.Vdisk ?? r.V_disk?? r.vdisk?? r[4] ?? 0) || 0,
      Vbul:  Number(r.Vbul  ?? r.V_bul ?? r.vbul ?? r[5] ?? 0) || 0,
    })).filter(r=>Number.isFinite(r.R_kpc) && Number.isFinite(r.Vobs));
    galaxiesPayload.push({galaxy_name:name, rows});
  }

  const res = await postJSON(base + "/dwarfs", {galaxies: galaxiesPayload});
  if(res?.micro) applyMicroToUI(res.micro);

  const d = res?.dwarfs;
  if(!d?.per_galaxy) throw new Error("Backend returned no dwarfs data");

  const items = d.per_galaxy;
  Plotly.newPlot(el.plotGlobal, [{
    x: items.map(it=>it.rms_kms),
    y: items.map(it=>it.galaxy),
    type:"bar",
    orientation:"h",
    name:"RMS"
  }], proLayout(`Dwarfs RMS — N=${d.count} — Dwarfs=${Number(d.dwarfs_rms_kms).toFixed(3)} km/s`, "RMS (km/s)", "Galaxy"),
     proConfig());

  state.lastCSV = ["galaxy,rms_kms"].concat(items.map(it=>`${it.galaxy},${it.rms_kms}`)).join("\n");
  state.lastPNGTarget="plotGlobal";
  enable("btnDwarfsCSV", true);
  enable("btnPNG", true);
} function loadScript(src){ return new Promise((resolve,reject)=>{ const s=document.createElement("script"); s.src=src; s.async=true; s.onload=()=>resolve(src); s.onerror=()=>reject(new Error("Failed to load "+src)); document.head.appendChild(s); }); } async function ensureLibs(){ const tasks=[]; if(!window.JSZip) tasks.push(loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js")); if(!window.Plotly) tasks.push(loadScript("https://cdn.plot.ly/plotly-2.35.2.min.js")); if(tasks.length){ setText("zipStatus","Loading libraries (Plotly/JSZip)..."); await Promise.all(tasks); } } async function tryAutoloadZip(){ const candidates=["./Rotmod_LTG.zip","Rotmod_LTG.zip","./rotmod_ltg.zip","rotmod_ltg.zip"]; for(const url of candidates){ try{ const res=await fetch(url,{cache:"no-store"}); if(!res.ok) throw new Error("HTTP "+res.status); const ab=await res.arrayBuffer(); await loadZipFromArrayBuffer(ab,url); return true; }catch(e){ console.warn("[ZIP] fail",url,e.message||e); } } setText("zipStatus","Auto-load FAILED. Subí Rotmod_LTG.zip al repo o cargalo manualmente con 'Load ZIP'."); enable("btnLoadZip",true); return false; } function wire(){ ["btnRunGalaxy","btnGlobalRMS","btnCSV","btnPNG","btnGlobalCSV","btnRunDwarfs","btnDwarfsCSV","btnDwarfsPNG"].forEach(id=>enable(id,false)); el.btnRunGalaxy?.addEventListener("click", ()=>runSelectedGalaxy().catch(e=>alert(e.message||e))); el.btnGlobalRMS?.addEventListener("click", ()=>runGlobalRMS().catch(e=>alert(e.message||e))); el.btnCSV?.addEventListener("click", ()=>{ if(state.lastCSV) downloadText(`${state.currentGalaxy||"galaxy"}_pred.csv`, state.lastCSV); }); el.btnPNG?.addEventListener("click", ()=>{ if(state.lastPNGTarget) downloadPNG(state.lastPNGTarget).catch(e=>alert(e.message||e)); }); el.btnGlobalCSV?.addEventListener("click", ()=>{ if(state.lastGlobalCSV) downloadText("global_rms.csv", state.lastGlobalCSV); }); el.btnRunDwarfs?.addEventListener("click", ()=>runDwarfs().catch(e=>alert(e.message||e))); el.btnDwarfsCSV?.addEventListener("click", ()=>{ if(state.lastDwarfsCSV) downloadText("dwarfs_rms.csv", state.lastDwarfsCSV); }); el.btnDwarfsPNG?.addEventListener("click", ()=>downloadPNG("plotDwarfs").catch(e=>alert(e.message||e))); el.btnLoadZip?.addEventListener("click", ()=>el.sparcFile?.click()); el.sparcFile?.addEventListener("change", async (ev)=>{ const f=ev.target.files && ev.target.files[0]; if(!f) return; try{ setText("zipStatus","Cargando ZIP local..."); await loadZipFromArrayBuffer(await f.arrayBuffer(),"local"); } catch(e){ console.error(e); setText("zipStatus","ZIP local FAILED: "+(e.message||e)); alert("ZIP error: "+(e.message||e)); } finally{ try{ el.sparcFile.value=""; }catch(_){ } } }); el.btnReset?.addEventListener("click", ()=>location.reload()); el.btnRunLocuss?.addEventListener("click", ()=>{ if(el.locussOut) el.locussOut.textContent="LoCuSS module: pending integration (kept stable)."; }); } 

function applyMicroToUI(micro){
  try{
    // UI expects mW, mμ, me
    const mW = Number(micro.mW_GeV ?? micro.mW ?? micro.mw);
    const mMu = Number(micro.m_mu_pred_MeV ?? micro.mMu_MeV ?? micro.mmu);
    const mE = Number(micro.m_e_pred_MeV ?? micro.mE_MeV ?? micro.me);

    setText("kpi_mW", Number.isFinite(mW) ? mW.toFixed(3) : "—");
    setText("kpi_mMu", Number.isFinite(mMu) ? mMu.toFixed(4) : "—");
    setText("kpi_mE", Number.isFinite(mE) ? mE.toFixed(4) : "—");
  }catch(e){
    console.warn("applyMicroToUI failed", e);
  }
}
// ===== Backend (Micro) integration =====
async function pingBackend(){
  const base = String(el.backendUrl?.value || "https://thot-engine.onrender.com").replace(/\/+$/,"");
  setText("backendUrlLabel", base);
  try{
    const res = await fetch(base + "/health", {cache:"no-store"});
  // Backend buttons
  el.btnMicro?.addEventListener("click", ()=>refreshMicro());
  el.btnPing?.addEventListener("click", async ()=>{
    const ok = await pingBackend();
    if(el.zipStatus){
      el.zipStatus.textContent = ok ? "Backend: OK" : "Backend: OFFLINE / SLEEPING";
    }
  });

    if(!res.ok) throw new Error("HTTP " + res.status);
    const j = await res.json();
    return !!j.ok;
  }catch(e){
    console.warn("[backend] health fail:", e.message||e);
    return false;
  }
}

async function refreshMicro(){
  const base = String(el.backendUrl?.value || "https://thot-engine.onrender.com").replace(/\/+$/,"");
  setText("backendUrlLabel", base);
  setText("kpi_mW","…"); setText("kpi_mMu","…"); setText("kpi_mE","…");
  try{
    // warm up / health first (Render often sleeps)
    await pingBackend();
    let res = await fetch(base + "/micro", {cache:"no-store"});
    if(res.status===404){
      // fallback: call /compute with a tiny payload to extract micro
      const tmp = await fetch(base + "/compute", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({galaxy_name:"MICRO_ONLY", rows:[{R_kpc:1,Vobs:1,Vgas:0,Vdisk:0,Vbul:0}]})});
      res = tmp;
    }
    if(!res.ok) throw new Error("HTTP " + res.status);
    const j0 = await res.json();
    const j = (j0 && j0.micro) ? j0.micro : j0;
    const mW = Number(j.mW_GeV ?? j.mW);
    const mMu = Number(j.m_mu_pred_MeV ?? j.mMu_MeV);
    const mE = Number(j.m_e_pred_MeV ?? j.mE_MeV);
    setText("kpi_mW", Number.isFinite(mW) ? mW.toFixed(3) : "—");
    setText("kpi_mMu", Number.isFinite(mMu) ? mMu.toFixed(4) : "—");
    setText("kpi_mE", Number.isFinite(mE) ? mE.toFixed(4) : "—");
  }catch(e){
    setText("kpi_mW","ERR");
    setText("kpi_mMu","ERR");
    setText("kpi_mE","ERR");
    console.error("[backend] micro error:", e);
  }
}


document.addEventListener("DOMContentLoaded", async ()=>{ try{ wire(); await ensureLibs(); await tryAutoloadZip();
      await refreshMicro(); } catch(e){ console.error(e); setText("zipStatus","Fatal: "+(e.message||e)); } });