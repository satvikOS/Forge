// bridge_chunk2_smoke — proves the chunk-2 ForgeToolBridge fixes call REAL
// kernel methods and return ok + valid numbers/geometry. This replays the
// exact run() bodies from ForgeToolBridge.js (solveStatic/solveModal/
// solveDynamic + io.exportStep/exportStl) against the native kernel.
//
// run:  node forge-kernel/test/bridge_chunk2_smoke.mjs
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

// ---- bridge helpers (verbatim from ForgeToolBridge.js) -------------------
const FACE_BIT = { '-x': 0, '+x': 1, '-y': 2, '+y': 3, '-z': 4, '+z': 5 };
const faceBit = (n, fb) => (typeof n === 'number' ? n | 0 : (FACE_BIT[String(n||'').toLowerCase().trim()] ?? fb));
function nodesOnFace(mesh, bit) { const o = []; for (let i = 0; i < mesh.nodeCount; i++) if (mesh.nodeToFace[i] & (1 << bit)) o.push(i); return o; }
function pinFaceBcs(mesh, bit) { return nodesOnFace(mesh, bit).map((id) => ({ nodeId: id, fx: true, fy: true, fz: true })); }
function distributeFaceLoad(mesh, bit, force) {
  const ids = nodesOnFace(mesh, bit); if (!ids.length) return { loads: [] };
  const n = ids.length, per = [force[0]/n, force[1]/n, force[2]/n];
  return { loads: ids.map((id) => ({ nodeId: id, fx: per[0], fy: per[1], fz: per[2] })) };
}
function feaMesh(shape, meshSizeMm) {
  const edgeM = (Number(meshSizeMm) > 0 ? Number(meshSizeMm) : 5) / 1000;
  const mesh = forge.fea.meshFromBrep(shape, edgeM);
  assert(mesh && mesh.nodeCount && mesh.elemCount, 'mesh empty');
  return mesh;
}

// ---- build the test body: 0.1 x 0.01 x 0.01 m steel cantilever ----------
// FEA is SI throughout: the kernel's meshFromBrep expects METRE coordinates
// (every fea/buckling/thermal smoke builds makeBox(0.100,0.010,0.010) and
// meshes at b/2 = 0.005 m). feaMesh() converts the meshSize-mm arg /1000.
const L = 0.100, b = 0.010, h = 0.010;       // metres
const beam = forge.makeBox(L, b, h);
const STEEL = { E: 210e9, nu: 0.3, rho: 7850 };
// massProps reports in the shape's units (m³ / m²) for this metre-scale box.
const VOL = L * b * h;                         // 1e-5 m³
const AREA = 2 * (L * b + L * h + b * h);      // m²

// ============================== simulate.fea-static ========================
{
  const mesh = feaMesh(beam, 5);
  const bcs = pinFaceBcs(mesh, faceBit('-x', 0));
  const loads = distributeFaceLoad(mesh, faceBit('+x', 1), [0, 0, -100]).loads;
  const r = forge.fea.solveStatic(mesh, STEEL, loads, [], bcs);
  const u = r.u || []; let maxDisp = 0;
  for (let i = 0; i < mesh.nodeCount; i++) {
    const d = Math.hypot(u[3*i]||0, u[3*i+1]||0, u[3*i+2]||0); if (d > maxDisp) maxDisp = d;
  }
  assert(Number.isFinite(r.maxVonMises) && r.maxVonMises > 0, 'static: maxVonMises invalid');
  assert(maxDisp > 0 && Number.isFinite(maxDisp), 'static: displacement invalid');
  console.log(`[fea-static] OK nodes=${mesh.nodeCount} elems=${mesh.elemCount} maxVM=${(r.maxVonMises/1e6).toFixed(3)} MPa maxDisp=${maxDisp.toExponential(3)} m residual=${r.residual}`);
}

// ============================== simulate.fea-modal =========================
{
  const mesh = feaMesh(beam, 5);
  const bcs = pinFaceBcs(mesh, faceBit('-x', 0));
  const r = forge.fea.solveModal(mesh, STEEL, bcs, 3);
  const eig = Array.from(r.eigenvalues || []);
  const fHz = eig.map((l) => (l > 0 ? Math.sqrt(l)/(2*Math.PI) : 0));
  assert(r.nModes >= 1 && eig.length >= 1, 'modal: no modes');
  assert(fHz.some((f) => f > 0 && Number.isFinite(f)), 'modal: no positive frequency');
  console.log(`[fea-modal]  OK modes=${r.nModes} f(Hz)=[${fHz.map((f)=>f.toFixed(1)).join(', ')}]`);
}

// ============================== simulate.fea-dynamic =======================
{
  const mesh = feaMesh(beam, 5);
  const bcs = pinFaceBcs(mesh, faceBit('-x', 0));
  const loads = distributeFaceLoad(mesh, faceBit('+x', 1), [0, 0, -100]).loads;
  const r = forge.fea.solveDynamic(mesh, STEEL, loads, bcs, 0.01, 0.001, 0, 0);
  const env = Array.from(r.maxStressEnvelope || []);
  const peakVM = env.length ? Math.max(...env) : 0;
  let maxDisp = 0;
  for (const step of (r.displacements || [])) for (let i = 0; i < mesh.nodeCount; i++) {
    const d = Math.hypot(step[3*i]||0, step[3*i+1]||0, step[3*i+2]||0); if (d > maxDisp) maxDisp = d;
  }
  assert(r.stepCount >= 1, 'dynamic: no steps');
  assert(Number.isFinite(peakVM) && peakVM > 0, 'dynamic: peak VM invalid');
  assert(maxDisp > 0 && Number.isFinite(maxDisp), 'dynamic: displacement invalid');
  console.log(`[fea-dynamic] OK steps=${r.stepCount} peakVM=${(peakVM/1e6).toFixed(3)} MPa maxDisp=${maxDisp.toExponential(3)} m cpuMs=${r.cpuMs}`);
}

// ============================== io.export-step =============================
{
  const fp = path.join('/tmp', 'forge-bridge-chunk2.step');
  const ok = forge.io.exportStep(beam, fp);
  assert(ok, 'export-step: kernel returned false');
  assert(fs.existsSync(fp) && fs.statSync(fp).size > 200, 'export-step: file not written');
  const re = forge.io.importStep(fp);
  const mp = forge.massProps(re);
  assert(Math.abs(mp.volume - VOL) < VOL * 1e-3, `export-step: round-trip vol ${mp.volume} != ${VOL}`);
  assert(Math.abs(mp.area - AREA) < AREA * 1e-3, `export-step: round-trip area ${mp.area} != ${AREA}`);
  console.log(`[io.export-step] OK ${fs.statSync(fp).size} bytes round-trip vol=${mp.volume.toExponential(4)} area=${mp.area.toExponential(4)}`);
  forge.release(re);
}

// ============================== io.export-stl ==============================
{
  const fp = path.join('/tmp', 'forge-bridge-chunk2.stl');
  const ok = forge.io.exportStl(beam, fp, 0.1, 0.5, false /* ascii = !binary, binary default */);
  assert(ok, 'export-stl: kernel returned false');
  assert(fs.existsSync(fp) && fs.statSync(fp).size > 200, 'export-stl: file not written');
  const re = forge.io.importStl(fp);
  const mp = forge.massProps(re);
  // STL is a faceted shell — surface area should land near the exact box area.
  assert(mp.area > AREA * 0.8 && mp.area < AREA * 1.2, `export-stl: re-imported area ${mp.area} not near ${AREA}`);
  console.log(`[io.export-stl]  OK ${fs.statSync(fp).size} bytes (binary) re-import area=${mp.area.toExponential(4)} (exact ${AREA.toExponential(4)})`);
  forge.release(re);
}

forge.release(beam);
console.log('\n[bridge-chunk2] ALL PASS');
