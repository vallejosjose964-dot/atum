'use strict';

const $ = (id)=>document.getElementById(id);

const microAStar = $('microAStar');
const microTau = $('microTau');
const microMW = $('microMW');
const microDelta = $('microDelta');
const microEta = $('microEta');
const microLambda = $('microLambda');

function setMicro(resp){
  const micro = resp && resp.micro ? resp.micro : null;
  if(!micro) return;

  const exp = (x, n=4) => (Number.isFinite(Number(x)) ? Number(x).toExponential(n) : '—');
  const fix = (x, n=6) => (Number.isFinite(Number(x)) ? Number(x).toFixed(n) : '—');

  microAStar.textContent  = exp(micro.a_star_m_s2, 4);
  microTau.textContent    = exp(micro.tau, 4);
  microMW.textContent     = micro.mW_GeV ?? '—';
  microDelta.textContent  = fix(micro.delta_r_vci, 6);
  microEta.textContent    = fix(micro.eta_vci, 6);
  microLambda.textContent = exp(micro.lambda_eff_m2, 4);
}

async function testMicro(){
  const r = await fetch('https://thot-engine.onrender.com/compute', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({
      galaxy_name:'test',
      rows:[{R_kpc:1,Vobs:100,Vgas:10,Vdisk:20,Vbul:5}]
    })
  });
  const data = await r.json();
  setMicro(data);
}

testMicro();
