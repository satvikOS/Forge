// forge-kernel/test/native_analytic_chamfer_draft_ab.mjs
//
// A/B GATE for the NEWLY-WIRED analytic B-rep CHAMFER + DRAFT paths.
//
// part.chamferEdges / part.draftFaces now route the CANONICAL-CUBE cases to the
// OCCT-FREE analytic B-rep builders (ChamferAnalytic / DraftAnalytic) instead of
// the mesh bridge:
//   * chamfer : a SINGLE SYMMETRIC bevel of one straight convex edge of a cube
//               [0,L]^3  ->  chamferBoxEdgeAnalytic  (a real plane bevel face +
//               re-trimmed planar faces + clipped end pentagons).
//   * draft   : the four side walls of a cube [0,L]^3 tapered about the base
//               neutral plane z=0 (pull +Z)  ->  draftBoxAnalytic  (a square
//               frustum: four tilted planar trapezoids + two square caps).
//
// For EACH, run the SAME build both ways in ONE process — OCCT (setNativeBrep
// false) and native (true) — and assert:
//   * the native handle is a real ANALYTIC SOLID (kindOf == 'nativeSolid' AND its
//     analytic B-rep face count is queryable — NOT a mesh),
//   * native volume == OCCT volume to a TIGHT analytic tol (both are exact for a
//     planar bevel / planar frustum), and == the closed-form volume,
//   * native COM == OCCT COM,
//   * the faceting-independent TOPOLOGY invariant (Euler χ / genus) matches OCCT,
//   * the native tessellation is watertight (closed 2-manifold).
//
// Requires the addon built with -DFORGE_NATIVE_BREP=ON. Exit 0 iff every gate
// passes. Run: node forge-kernel/test/native_analytic_chamfer_draft_ab.mjs
//      FORGE_KERNEL=/abs/path/forge-kernel.node node ...   (override the addon)

import path from 'node:path';
import url from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let f;
try { f = require(KERNEL); }
catch (e) { console.error('[ab] FAILED to load', KERNEL, '\n', e); process.exit(1); }
if (typeof f.setNativeBrep !== 'function') {
  console.error('[ab] addon lacks setNativeBrep — build with -DFORGE_NATIVE_BREP=ON'); process.exit(1);
}

// ---------------------------------------------------------------- helpers
function relErr(a, b) { return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12); }
function vlen(a) { return Math.sqrt(a.reduce((s, x) => s + x * x, 0)); }
function vsub(a, b) { return a.map((x, i) => x - b[i]); }

// Welded closed-manifold proxy + Euler χ / genus, identical method to the core gate.
function topoSig(t) {
  const pos = t.positions, idx = t.indices;
  if (!pos || !idx || idx.length < 3) return null;
  const key = new Map(); const remap = new Int32Array(pos.length / 3); let next = 0;
  for (let v = 0; v < pos.length / 3; v++) {
    const q = `${Math.round(pos[3*v]/1e-6)},${Math.round(pos[3*v+1]/1e-6)},${Math.round(pos[3*v+2]/1e-6)}`;
    let id = key.get(q); if (id === undefined) { id = next++; key.set(q, id); } remap[v] = id;
  }
  const V = next, F = idx.length / 3; const und = new Set();
  let closed = true; const dir = new Map();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = remap[idx[i]], b = remap[idx[i+1]], c = remap[idx[i+2]];
    for (const [u, w] of [[a,b],[b,c],[c,a]]) {
      und.add(Math.min(u,w) * 0x100000000 + Math.max(u,w));
      dir.set(`${u},${w}`, (dir.get(`${u},${w}`) || 0) + 1);
    }
  }
  for (const [k, n] of dir) { const [u, w] = k.split(','); if (n !== (dir.get(`${w},${u}`) || 0)) { closed = false; break; } }
  const E = und.size, euler = V - E + F;
  return { V, E, F, euler, genus: (2 - euler) / 2, watertight: closed && dir.size > 0 };
}

function measure(buildFn, native) {
  f.setNativeBrep(native);
  const h = buildFn(f);
  const kind = f.kindOf(h);
  const mp = f.massProps(h);
  const t = f.tessellate(h, 0.02, 0.2);
  let brepFaces = null;
  try { brepFaces = f.direct.faceCount(h); } catch (e) { brepFaces = null; }  // throws for a mesh handle
  return { h, kind, vol: mp.volume, com: mp.centerOfMass, sig: topoSig(t), brepFaces };
}

// Pick THIS kernel's edge id for the box edge whose midpoint ≈ `mid`. On OCCT the
// id is the TopExp order (edgeById-compatible); on the native solid it is the
// sharp-convex-edge id part.chamferEdges reads — BOTH exposed by direct.edgeSegments,
// so the SAME geometric edge is selected on both backends (no id-order coincidence).
function pickEdgeByMidpoint(f, h, mid, tol = 1e-6) {
  const segs = f.direct.edgeSegments(h, 0.25);
  for (const s of segs) {
    const p = s.points; if (p.length < 6) continue;
    const a = [p[0], p[1], p[2]];
    const b = [p[p.length-3], p[p.length-2], p[p.length-1]];
    const m = [(a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2];
    if (vlen(vsub(m, mid)) <= tol) return s.id;
  }
  return -1;
}

// The 4 side walls of a box (outward normal ⟂ pull), as THIS kernel's own 0-based
// face ids — derived per kernel so the A/B drafts the SAME walls (as the core gate).
function boxSideFaces(f, h, pull) {
  const t = f.tessellate(h, 0.05, 0.3);
  const pos = t.positions, idx = t.indices, fid = t.faceIds;
  const acc = new Map();
  for (let tri = 0; tri < idx.length / 3; tri++) {
    const id = fid[tri];
    const a = idx[3*tri], b = idx[3*tri+1], c = idx[3*tri+2];
    const A = [pos[3*a],pos[3*a+1],pos[3*a+2]], B = [pos[3*b],pos[3*b+1],pos[3*b+2]], C = [pos[3*c],pos[3*c+1],pos[3*c+2]];
    const u = [B[0]-A[0],B[1]-A[1],B[2]-A[2]], v = [C[0]-A[0],C[1]-A[1],C[2]-A[2]];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L = Math.hypot(...n) || 1;
    if (!acc.has(id)) acc.set(id, [0,0,0]);
    const e = acc.get(id); e[0]+=n[0]/L; e[1]+=n[1]/L; e[2]+=n[2]/L;
  }
  const sides = [];
  for (const [id, e] of [...acc.entries()].sort((a,b)=>a[0]-b[0])) {
    const L = Math.hypot(...e) || 1;
    const dotPull = Math.abs((e[0]*pull[0]+e[1]*pull[1]+e[2]*pull[2]) / L);
    if (dotPull < 0.5) sides.push(id - 1);
  }
  return sides;
}

// ---------------------------------------------------------------- cases
let fail = 0;
const rows = [];

function runCase(name, build, expectVol, extra = {}) {
  let occt, nat;
  try { occt = measure(build, false); } catch (e) { console.log(`[ab] FAIL ${name}: OCCT build threw — ${e.message}`); fail++; return; }
  try { nat  = measure(build, true);  } catch (e) { console.log(`[ab] FAIL ${name}: NATIVE build threw — ${e.message}`); fail++; return; }

  const volErr = relErr(nat.vol, occt.vol);
  const volAbsErr = Math.abs(nat.vol - expectVol) / Math.max(Math.abs(expectVol), 1e-12);
  const comErr = vlen(vsub(nat.com, occt.com));

  const okKindNat  = nat.kind === 'nativeSolid';                 // NEWLY analytic (not a mesh)
  const okAnalytic = nat.brepFaces !== null && nat.brepFaces > 0; // has a real analytic B-rep
  const okKindOcct = occt.kind === 'occt';
  const okVolAB    = volErr <= 1e-6;                             // native == OCCT (both exact)
  const okVolCF    = volAbsErr <= 1e-6;                          // native == closed form
  const okCom      = comErr <= 1e-6;
  const okSig      = !!(occt.sig && nat.sig) &&
                     occt.sig.euler === nat.sig.euler && occt.sig.genus === nat.sig.genus;
  const okWT       = !!(nat.sig && nat.sig.watertight);

  const pass = okKindNat && okAnalytic && okKindOcct && okVolAB && okVolCF && okCom && okSig && okWT;
  if (!pass) {
    fail++;
    if (!okKindNat)  console.log(`[ab] FAIL ${name}: native kind=${nat.kind} (expected nativeSolid — analytic path not taken)`);
    if (!okAnalytic) console.log(`[ab] FAIL ${name}: native result is not an analytic B-rep (faceCount unavailable)`);
    if (!okKindOcct) console.log(`[ab] FAIL ${name}: OCCT kind=${occt.kind} (expected occt)`);
    if (!okVolAB)    console.log(`[ab] FAIL ${name}: volume native=${nat.vol} vs OCCT=${occt.vol} relErr=${volErr.toExponential(2)}`);
    if (!okVolCF)    console.log(`[ab] FAIL ${name}: volume native=${nat.vol} vs closed-form=${expectVol} relErr=${volAbsErr.toExponential(2)}`);
    if (!okCom)      console.log(`[ab] FAIL ${name}: COM native=${nat.com} vs OCCT=${occt.com} |d|=${comErr.toExponential(2)}`);
    if (!okSig)      console.log(`[ab] FAIL ${name}: topology χ/genus native=${nat.sig?.euler}/${nat.sig?.genus} vs OCCT=${occt.sig?.euler}/${occt.sig?.genus}`);
    if (!okWT)       console.log(`[ab] FAIL ${name}: native tessellation not watertight`);
  }
  rows.push({ name, occtVol: occt.vol, natVol: nat.vol, cf: expectVol, volErr, comErr,
    kind: nat.kind, faces: nat.brepFaces, genus: nat.sig?.genus, pass });
}

// ---- CHAMFER: single symmetric bevel of one convex edge of a cube ----
// Cube [0,4]^3, chamfer the TOP-FRONT edge (midpoint (2,0,4)) by setback d=0.5.
// Bevel removes the right-triangle prism (½ d² over edge length L): removed = ½·0.25·4 = 0.5.
{
  const L = 4, d = 0.5;
  const mid = [L/2, 0, L];
  const build = f => { const b = f.makeBox(L, L, L); return f.part.chamferEdges(b, [pickEdgeByMidpoint(f, b, mid)], d, -1); };
  const expect = L*L*L - 0.5 * d * d * L;   // 64 - 0.5 = 63.5
  runCase(`chamfer 1 edge d=${d} cube(${L})`, build, expect);
}
// A second setback to prove it is the analytic law, not a coincidence.
{
  const L = 3, d = 0.4;
  const mid = [L, L/2, L];   // top-right edge (v6-v7 style vertical? -> pick a top ring edge)
  const build = f => { const b = f.makeBox(L, L, L); return f.part.chamferEdges(b, [pickEdgeByMidpoint(f, b, mid)], d, -1); };
  const expect = L*L*L - 0.5 * d * d * L;
  runCase(`chamfer 1 edge d=${d} cube(${L})`, build, expect);
}

// ---- DRAFT: four side walls of a cube tapered about z=0 (pull +Z) ----
// Cube [0,4]^3, draft the 4 side walls by alpha; frustum volume ∫_0^L (L-2z·t)^2 dz.
function frustumVol(L, aDeg) {
  const t = Math.tan(aDeg * Math.PI / 180);
  // ∫_0^L (L - 2 z t)^2 dz = L^3 - 2 L^2 (L t) + (4/3) L (L t)^2  (t·z integrated)
  return L*L*L - 2*L*L*(L*t) + (4/3)*L*(L*t)*(L*t);
}
for (const [L, aDeg] of [[4, 6], [3, 10]]) {
  const build = f => { const b = f.makeBox(L, L, L);
    return f.part.draftFaces(b, { origin:[0,0,0], normal:[0,0,1] }, boxSideFaces(f, b, [0,0,1]), aDeg*Math.PI/180); };
  runCase(`draft 4 sides ${aDeg}deg cube(${L})`, build, frustumVol(L, aDeg));
}

// ---------------------------------------------------------------- table
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n[ab] native-ANALYTIC chamfer/draft gate — addon: ${KERNEL}\n`);
console.log(pad('OP', 34), pad('occtVol', 12), pad('natVol', 12), pad('closedForm', 12), pad('|dVolAB|', 10), pad('|dCOM|', 10), pad('kind', 12), pad('F', 4), pad('g', 3), 'pass');
console.log('-'.repeat(130));
for (const r of rows) {
  console.log(pad(r.name, 34), pad(r.occtVol.toFixed(6), 12), pad(r.natVol.toFixed(6), 12), pad(r.cf.toFixed(6), 12),
    pad(r.volErr.toExponential(2), 10), pad(r.comErr.toExponential(2), 10), pad(r.kind, 12), pad(r.faces ?? '-', 4), pad(r.genus, 3),
    r.pass ? 'PASS' : 'FAIL');
}
console.log(`\n[ab] ${rows.filter(r=>r.pass).length}/${rows.length} analytic chamfer/draft A/B cases passed`);
if (fail) { console.error(`\n[ab] ${fail} FAILURE(S)`); process.exit(1); }
console.log('[ab] ALL PASS — native analytic chamfer/draft == OCCT, real analytic B-rep, watertight\n');
process.exit(0);
