#!/usr/bin/env node
// Headless verification that the VALIDATED kernel solvers return REAL finite
// fields, exercised through the SAME call patterns + field extraction caeViz.js
// uses. NO rebuild, NO render. Prints peak σ, |u|_max, Re, ω(t_end).
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const HEX_FACES = [[0,1,2,3],[4,5,6,7],[0,1,5,4],[3,2,6,7],[0,3,7,4],[1,2,6,5]];
function nodalAverage(mesh, elemScalar) {
  const N = mesh.nodeCount, ENC = mesh.elemNodeCount || 8, E = mesh.elemCount;
  const acc = new Float64Array(N), cnt = new Float64Array(N);
  for (let e = 0; e < E; e++) {
    const v = elemScalar[e]; if (!Number.isFinite(v)) continue;
    for (let i = 0; i < ENC; i++) { const nid = mesh.tets[e*ENC+i]; acc[nid]+=v; cnt[nid]+=1; }
  }
  const out = new Float64Array(N);
  for (let n = 0; n < N; n++) out[n] = cnt[n] > 0 ? acc[n]/cnt[n] : 0;
  return out;
}
const allFinite = (a) => { for (let i=0;i<a.length;i++) if(!Number.isFinite(a[i])) return false; return true; };

let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log(`  [${ok?'PASS':'FAIL'}] ${name} — ${detail}`); ok?pass++:fail++; };

console.log('=== caeViz field verification (real solver output, no render) ===\n');

// ───────────────────────── (a) FEA von-Mises on a physical-scale blade proxy ──
// A fan blade is a long thin slab; a box at physical scale (0.6 m span) is a
// faithful FEA proxy for verifying the von-Mises field is real + finite.
console.log('[a] FEA static — fan-blade proxy (Ti-6Al-4V), real von-Mises field');
const mat = { E: 113.8e9, nu: 0.342, rho: 4430 };            // Ti-6Al-4V
const span = 0.6, chord = 0.12, thick = 0.02;                 // m (physical blade)
const blade = forge.makeBox(span, chord, thick);
const mesh = forge.fea.meshFromBrep(blade, chord / 4);        // auto-ish element size
const bcs = [], loadIds = [];
for (let i = 0; i < mesh.nodeCount; i++) {
  if (mesh.nodeToFace[i] & (1<<0)) bcs.push({ nodeId:i, fx:true, fy:true, fz:true }); // -X root
  if (mesh.nodeToFace[i] & (1<<1)) loadIds.push(i);                                    // +X tip
}
const F = [8000, 0, -2000];                                    // centrifugal pull + bend (N)
const loads = loadIds.map((id) => ({ nodeId:id, fx:F[0]/loadIds.length, fy:F[1]/loadIds.length, fz:F[2]/loadIds.length }));
const fr = forge.fea.solveStatic(mesh, mat, loads, [], bcs);
const nodal = nodalAverage(mesh, fr.vonMises);
let vMin=Infinity, vMax=-Infinity;
for (const v of nodal) { if(v<vMin)vMin=v; if(v>vMax)vMax=v; }
let maxDisp = 0;
for (let i=0;i<mesh.nodeCount;i++) maxDisp = Math.max(maxDisp, Math.hypot(fr.u[3*i],fr.u[3*i+1],fr.u[3*i+2]));
const peakMPa = fr.maxVonMises/1e6;
console.log(`    nodes=${mesh.nodeCount} elems=${mesh.elemCount} elemNodeCount=${mesh.elemNodeCount}`);
console.log(`    vonMises field length (per-element)=${fr.vonMises.length}`);
console.log(`    peak σ_max = ${peakMPa.toPrecision(5)} MPa  (raw ${fr.maxVonMises.toExponential(3)} Pa)`);
console.log(`    nodal-averaged field range = [${(vMin/1e6).toPrecision(4)}, ${(vMax/1e6).toPrecision(4)}] MPa`);
console.log(`    peak displacement = ${maxDisp.toExponential(4)} m   residual=${fr.residual?.toExponential(2)}`);
const SF = 880 / peakMPa;
console.log(`    safety factor (σ_yield 880 MPa / σ_max) = ${SF.toPrecision(4)}`);
check('FEA returns finite per-element vonMises array', fr.vonMises.length===mesh.elemCount && allFinite(fr.vonMises), `len=${fr.vonMises.length}`);
check('FEA peak σ_max finite & > 0', Number.isFinite(peakMPa) && peakMPa>0, `σ_max=${peakMPa.toPrecision(4)} MPa`);
check('nodal-averaged field finite & spans a range', allFinite(nodal) && vMax>vMin, `Δ=${((vMax-vMin)/1e6).toPrecision(3)} MPa`);

// Surface-skin face count sanity (the contour renders only outer faces).
const seen = new Map();
for (let e=0;e<mesh.elemCount;e++) for (const f of HEX_FACES) {
  const g=[mesh.tets[e*8+f[0]],mesh.tets[e*8+f[1]],mesh.tets[e*8+f[2]],mesh.tets[e*8+f[3]]];
  const k=[...g].sort((x,y)=>x-y).join(','); seen.set(k,(seen.get(k)||0)+1);
}
let outer=0; for (const c of seen.values()) if (c===1) outer++;
console.log(`    contour outer-skin quads=${outer} (→ ${outer*2} triangles, ${outer*6} verts)`);
check('contour outer skin non-empty', outer>0, `${outer} outer quads`);

// ───────────────────────── (b) CFD steady NS — core/bypass duct, |u| field ──
console.log('\n[b] CFD steady Navier-Stokes — duct (core/bypass proxy), real |u| field');
const cfg = {
  Nx:32, Ny:16, Nz:16,
  domain: Float64Array.from([0,0,0, 0.2,0.02,0.02]),
  rho:1.0, nu:1e-3, walls:[2,3,4,5], inlets:[{faceId:0,vx:0.1,vy:0,vz:0}], outlets:[1],
  maxIter:600, residualTol:1e-5,
};
const cr = forge.cfd.solveSteadyNS(cfg);
const { Nx, Ny, Nz } = cr;
const idxC = (i,j,k) => (k*Ny+j)*Nx+i;
let umin=Infinity, umax=-Infinity, nFinite=0;
for (let k=0;k<Nz;k++) for (let j=0;j<Ny;j++) for (let i=0;i<Nx;i++) {
  const c=idxC(i,j,k); const m=Math.hypot(cr.u[c], cr.v?cr.v[c]:0, cr.w?cr.w[c]:0);
  if (Number.isFinite(m)) { if(m<umin)umin=m; if(m>umax)umax=m; nFinite++; }
}
const iMid=Math.floor(Nx/2), kMid=Math.floor(Nz/2);
let rowPeak=0,rowSum=0,rowN=0;
for (let j=0;j<Ny;j++){ const uc=cr.u[idxC(iMid,j,kMid)]; if(Number.isFinite(uc)){rowPeak=Math.max(rowPeak,uc);rowSum+=uc;rowN++;} }
const peakOverMean = rowN ? rowPeak/(rowSum/rowN) : 0;
console.log(`    grid=${Nx}x${Ny}x${Nz}  iters=${cr.iterations}  finalResid=${cr.finalResidual?.toExponential(2)}`);
console.log(`    |u|_max = ${cr.maxVelocity.toPrecision(5)} m/s   Reynolds Re = ${cr.reynolds.toPrecision(5)}`);
console.log(`    |u| field range = [${umin.toExponential(3)}, ${umax.toExponential(3)}] m/s over ${nFinite} cells`);
console.log(`    mid-X parallel-plate peak/mean = ${peakOverMean.toFixed(3)} (analytic 1.5)`);
console.log(`    regime: ${cr.reynolds<2300?'laminar (Re<2300)':'Re>2300 — solver is laminar-only'}`);
check('CFD |u|_max finite & > 0', Number.isFinite(cr.maxVelocity)&&cr.maxVelocity>1e-6, `|u|_max=${cr.maxVelocity.toPrecision(4)}`);
check('CFD Reynolds finite', Number.isFinite(cr.reynolds), `Re=${cr.reynolds.toPrecision(4)}`);
check('CFD velocity field all-finite', allFinite(cr.u) && allFinite(cr.v) && allFinite(cr.w), `${nFinite} cells finite`);
check('CFD peak/mean ≈ 1.5 (±25%)', peakOverMean>=1.125 && peakOverMean<=1.875, `peak/mean=${peakOverMean.toFixed(3)}`);

// ───────────────────────── (c) Multibody rotor spin-up — ω(t) ──
console.log('\n[c] Multibody rotor spin-up — real ω(t) under constant torque');
const Izz=0.5, torque=2.0, tEnd=1.0, dt=1e-3, steps=1000;
const rr = forge.simulate.multibodyDynamics({
  bodies:[{ mass:5.0, inertia:[0.25,0,0,0,0.25,0,0,0,Izz], position:[0,0,0], orientation:[0,0,0], linVel:[0,0,0], angVel:[0,0,0] }],
  constraints:[], loads:[{ body:0, force:[0,0,0], torque:[0,0,torque] }], gravity:[0,0,0],
  dt, steps, alpha:0.0, sampleStride:1,
});
const sm = rr.samples;
const omega = sm.map(s => ({ t:s.t, w:s.angVel[0][2] }));
const last = sm[sm.length-1];
const wMeas=last.angVel[0][2], thMeas=last.orientation[0][2];
const accel=torque/Izz, wRef=accel*tEnd, thRef=0.5*accel*tEnd*tEnd;
const wErr=100*Math.abs(wMeas-wRef)/Math.abs(wRef);
const wAllFinite = omega.every(o => Number.isFinite(o.w));
console.log(`    samples=${sm.length}  α=T/Izz=${accel.toFixed(3)} rad/s²`);
console.log(`    ω(t): ${omega.filter((_,i)=>i%200===0).map(o=>`t=${o.t.toFixed(2)}→ω=${o.w.toFixed(3)}`).join('  ')}`);
console.log(`    ω(t_end)=${wMeas.toPrecision(5)} rad/s (${(wMeas*60/(2*Math.PI)).toFixed(1)} rpm)  ref αt=${wRef.toFixed(4)}  err=${wErr.toPrecision(3)}%`);
console.log(`    θ(t_end)=${thMeas.toPrecision(5)} rad  ref ½αt²=${thRef.toFixed(4)}  stable=${rr.stable}  energyDrift=${rr.energyDrift?.toExponential(2)}`);
check('multibody returns ω(t) samples', sm.length>0 && wAllFinite, `${sm.length} samples, all ω finite`);
check('rotor ω(t_end)=αt within 5%', wErr<5.0 && rr.stable, `ω=${wMeas.toPrecision(4)} vs ${wRef.toFixed(3)} err=${wErr.toPrecision(3)}%`);

console.log(`\n=== ${fail===0?'ALL FIELD CHECKS PASS':'SOME CHECKS FAILED'} (${pass} pass / ${fail} fail) ===`);
process.exit(fail===0?0:1);
