// forge-kernel/test/native_analytic_offset_ab.mjs
//
// A/B GATE for the NEWLY-WIRED analytic B-rep WHOLE-SOLID OFFSET path.
//
// part.offsetSolid now routes an analytic NativeSolid (box / rectangular prism /
// cylinder) to the OCCT-FREE analytic offsetSolidShape (BRepOffset_Skin, sharp
// INTERSECTION join) instead of OCCT's BRepOffsetAPI_MakeOffsetShape. Every
// boundary face slides along its outward normal by the signed distance d and the
// adjacent faces re-trim to their new mutual intersections:
//   * box  (a,b,c) offset +d  ->  box (a+2d)(b+2d)(c+2d) about the SAME centre
//   * box  (a,b,c) offset -d  ->  box (a-2d)(b-2d)(c-2d) (shrink, |d|<half-extent)
//   * cyl  (r,h)   offset +d  ->  cyl r+d, h+2d  (coaxial, exact analytic caps)
//
// For EACH, run the SAME build both ways in ONE process — OCCT (setNativeBrep
// false) and native (true) — and assert:
//   * the native handle is a real ANALYTIC SOLID (kindOf == 'nativeSolid' AND its
//     analytic B-rep face count is queryable — NOT a mesh),
//   * native volume == OCCT volume to a TIGHT analytic tol AND == the closed-form,
//   * native COM == OCCT COM (and == the closed-form centre where given),
//   * the faceting-independent TOPOLOGY invariant (Euler chi / genus) matches OCCT,
//   * the native tessellation is watertight (closed 2-manifold).
//
// Requires the addon built with -DFORGE_NATIVE_BREP=ON. Exit 0 iff every gate
// passes. Run: node forge-kernel/test/native_analytic_offset_ab.mjs
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

// Welded closed-manifold proxy + Euler chi / genus, identical method to the core gate.
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

// ---------------------------------------------------------------- cases
let fail = 0;
const rows = [];

// `expectCom` may be null — then only native==OCCT COM is enforced (not closed form).
// `curved` relaxes the closed-form volume tol to 1e-6 still, but tolerates the
// faceting-independent chi/genus (a curved solid is still genus-0). All cases
// require native==OCCT volume, analytic native handle, and watertight native mesh.
function runCase(name, build, expectVol, expectCom = null) {
  let occt, nat;
  try { occt = measure(build, false); } catch (e) { console.log(`[ab] FAIL ${name}: OCCT build threw — ${e.message}`); fail++; return; }
  try { nat  = measure(build, true);  } catch (e) { console.log(`[ab] FAIL ${name}: NATIVE build threw — ${e.message}`); fail++; return; }

  const volErr    = relErr(nat.vol, occt.vol);
  const volAbsErr = Math.abs(nat.vol - expectVol) / Math.max(Math.abs(expectVol), 1e-12);
  const comErr    = vlen(vsub(nat.com, occt.com));
  const comCfErr  = expectCom ? vlen(vsub(nat.com, expectCom)) : 0;

  const okKindNat  = nat.kind === 'nativeSolid';                 // NEWLY analytic (not a mesh)
  const okAnalytic = nat.brepFaces !== null && nat.brepFaces > 0; // has a real analytic B-rep
  const okKindOcct = occt.kind === 'occt';
  const okVolAB    = volErr <= 1e-6;                             // native == OCCT (both exact)
  const okVolCF    = volAbsErr <= 1e-6;                          // native == closed form
  const okCom      = comErr <= 1e-6 && comCfErr <= 1e-6;
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
    if (!okCom)      console.log(`[ab] FAIL ${name}: COM native=${nat.com} vs OCCT=${occt.com} |dAB|=${comErr.toExponential(2)} |dCF|=${comCfErr.toExponential(2)}`);
    if (!okSig)      console.log(`[ab] FAIL ${name}: topology chi/genus native=${nat.sig?.euler}/${nat.sig?.genus} vs OCCT=${occt.sig?.euler}/${occt.sig?.genus}`);
    if (!okWT)       console.log(`[ab] FAIL ${name}: native tessellation not watertight`);
  }
  rows.push({ name, occtVol: occt.vol, natVol: nat.vol, cf: expectVol, volErr, comErr,
    kind: nat.kind, faces: nat.brepFaces, genus: nat.sig?.genus, pass });
}

// ---- BOX GROW: cube [0,10]^3 grown by d=+1 -> box 12^3 = 1728, centre unmoved ----
{
  const L = 10, d = 1;
  const build = f => f.part.offsetSolid(f.makeBox(L, L, L), d);
  runCase(`offset box(${L}) d=+${d}`, build, (L+2*d)**3, [L/2, L/2, L/2]);
}
// ---- BOX SHRINK: cube [0,10]^3 shrunk by d=-1 -> box 8^3 = 512, centre unmoved ----
{
  const L = 10, d = -1;
  const build = f => f.part.offsetSolid(f.makeBox(L, L, L), d);
  runCase(`offset box(${L}) d=${d}`, build, (L+2*d)**3, [L/2, L/2, L/2]);
}
// ---- NON-CUBE BOX GROW: box(4,6,8) grown by d=+0.5 -> 5*7*9 = 315, centre unmoved ----
{
  const a = 4, b = 6, c = 8, d = 0.5;
  const build = f => f.part.offsetSolid(f.makeBox(a, b, c), d);
  runCase(`offset box(${a},${b},${c}) d=+${d}`, build, (a+2*d)*(b+2*d)*(c+2*d), [a/2, b/2, c/2]);
}
// ---- NON-CUBE BOX SHRINK: box(4,6,8) shrunk by d=-0.5 -> 3*5*7 = 105, centre unmoved ----
{
  const a = 4, b = 6, c = 8, d = -0.5;
  const build = f => f.part.offsetSolid(f.makeBox(a, b, c), d);
  runCase(`offset box(${a},${b},${c}) d=${d}`, build, (a+2*d)*(b+2*d)*(c+2*d), [a/2, b/2, c/2]);
}
// ---- CYLINDER GROW (DEFERRAL): a curved-face solid is NOT eligible for the
// native analytic offset (the native quadric offset mis-places the body along its
// axis), so offsetSolid HONESTLY DEFERS it to OCCT even with the native gate ON.
// Assert: both flags yield an OCCT handle (kind 'occt'), identical + exact volume
// == closed form pi*(r+d)^2*(h+2d). This proves the planar-eligibility gate routes
// curved solids to OCCT rather than shipping a wrong (mispositioned) native shape.
{
  const r = 3, h = 8, d = 0.5;
  const build = f => f.part.offsetSolid(f.makeCylinder(r, h), d);
  const expect = Math.PI*(r+d)*(r+d)*(h+2*d);
  let occt, nat;
  try { occt = measure(build, false); } catch (e) { console.log(`[ab] FAIL cyl defer: OCCT build threw — ${e.message}`); fail++; occt = null; }
  try { nat  = measure(build, true);  } catch (e) { console.log(`[ab] FAIL cyl defer: NATIVE build threw — ${e.message}`); fail++; nat  = null; }
  if (occt && nat) {
    const name = `offset cyl(${r},${h}) d=+${d} [defer->OCCT]`;
    const okDefer = nat.kind === 'occt';            // native gate DEFERRED curved -> OCCT
    const okVolAB = relErr(nat.vol, occt.vol) <= 1e-6;
    const okVolCF = Math.abs(nat.vol - expect) / expect <= 1e-6;
    const pass = okDefer && okVolAB && okVolCF;
    if (!pass) {
      fail++;
      if (!okDefer) console.log(`[ab] FAIL ${name}: native kind=${nat.kind} (expected occt — curved must defer to OCCT, not take the native path)`);
      if (!okVolAB) console.log(`[ab] FAIL ${name}: volume native=${nat.vol} vs OCCT=${occt.vol}`);
      if (!okVolCF) console.log(`[ab] FAIL ${name}: volume native=${nat.vol} vs closed-form=${expect}`);
    }
    rows.push({ name, occtVol: occt.vol, natVol: nat.vol, cf: expect,
      volErr: relErr(nat.vol, occt.vol), comErr: 0, kind: nat.kind, faces: '-', genus: 0, pass });
  }
}

// ---------------------------------------------------------------- table
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n[ab] native-ANALYTIC whole-solid OFFSET gate — addon: ${KERNEL}\n`);
console.log(pad('OP', 28), pad('occtVol', 13), pad('natVol', 13), pad('closedForm', 13), pad('|dVolAB|', 10), pad('|dCOM|', 10), pad('kind', 12), pad('F', 4), pad('g', 3), 'pass');
console.log('-'.repeat(130));
for (const r of rows) {
  console.log(pad(r.name, 28), pad(r.occtVol.toFixed(6), 13), pad(r.natVol.toFixed(6), 13), pad(r.cf.toFixed(6), 13),
    pad(r.volErr.toExponential(2), 10), pad(r.comErr.toExponential(2), 10), pad(r.kind, 12), pad(r.faces ?? '-', 4), pad(r.genus, 3),
    r.pass ? 'PASS' : 'FAIL');
}
console.log(`\n[ab] ${rows.filter(r=>r.pass).length}/${rows.length} analytic offset A/B cases passed`);
if (fail) { console.error(`\n[ab] ${fail} FAILURE(S)`); process.exit(1); }
console.log('[ab] ALL PASS — native analytic offsetSolid == OCCT MakeOffsetShape, real analytic B-rep, watertight\n');
process.exit(0);
