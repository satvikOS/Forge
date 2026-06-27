// native_multifillet_verify.mjs — runtime proof that part.filletEdges on a native
// solid with MULTIPLE vertex-disjoint straight-convex-planar edges now rides the
// ANALYTIC topology-sourced path (filletSolidStraightEdgesAnalytic) — a NativeSolid
// with EXACT volume — instead of the mesh-bridge, and that a SHARED-vertex selection
// honestly FALLS BACK to the mesh-bridge (NativeMesh). Requires build-native/.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build-native', 'Release', 'forge-kernel.node');
const f = require(KERNEL);
if (typeof f.setNativeBrep !== 'function') { console.error('addon lacks setNativeBrep — need -DFORGE_NATIVE_BREP=ON'); process.exit(1); }
f.setNativeBrep(true);

const PI = Math.PI;
let pass = 0, total = 0;
const check = (c, m) => { total++; if (c) { pass++; console.log('  [PASS]', m); } else console.log('  [FAIL]', m); };

// Box vertical (Z-parallel) edge ids via this kernel's own edge enumeration.
function verticalEdgeIds(h) {
  const segs = f.direct.edgeSegments(h, 0.25);
  const seen = new Map();
  for (const s of segs) {
    const p = s.points; if (p.length < 6) continue;
    const a = [p[0],p[1],p[2]], b = [p[p.length-3],p[p.length-2],p[p.length-1]];
    const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const L = Math.hypot(...d) || 1; const dir = [d[0]/L,d[1]/L,d[2]/L];
    if (Math.abs(Math.abs(dir[2])-1) > 1e-6) continue;
    const mid = [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
    const key = mid.map(v=>Math.round(v/1e-6)).join(',');
    if (!seen.has(key)) seen.set(key, s.id);
  }
  return [...seen.values()];
}
function allEdgeIds(h) {
  const segs = f.direct.edgeSegments(h, 0.25);
  const seen = new Map();
  for (const s of segs) {
    const p = s.points; if (p.length < 6) continue;
    const a = [p[0],p[1],p[2]], b = [p[p.length-3],p[p.length-2],p[p.length-1]];
    const mid = [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
    const key = mid.map(v=>Math.round(v/1e-6)).join(',');
    if (!seen.has(key)) seen.set(key, s.id);
  }
  return [...seen.values()];
}

const DX=12, DY=8, DZ=20, R=1.5, boxVol=DX*DY*DZ;

// ---- (1) MULTI-EDGE vertex-disjoint -> ANALYTIC native solid, exact volume -----
console.log('\n[1] fillet the 4 vertical edges of a 12x8x20 native box (vertex-disjoint):');
{
  const b = f.makeBox(DX, DY, DZ);
  check(f.kindOf(b) === 'nativeSolid', `source box is a NativeSolid (kind=${f.kindOf(b)})`);
  const ids = verticalEdgeIds(b);
  check(ids.length === 4, `resolved 4 vertical edge ids (${ids.length})`);
  const r = f.part.filletEdges(b, ids, R);
  const kind = f.kindOf(r);
  const vol = f.massProps(r).volume;
  const expectAnalytic = boxVol - 4*(1-PI/4)*R*R*DZ;
  const meshApprox = expectAnalytic;   // for reference; mesh would differ by ~1%
  console.log(`    -> kind=${kind} volume=${vol.toFixed(6)} analytic-expected=${expectAnalytic.toFixed(6)} relErr=${(Math.abs(vol-expectAnalytic)/expectAnalytic).toExponential(3)}`);
  check(kind === 'nativeSolid', 'multi-edge result rode the ANALYTIC path (NativeSolid, NOT mesh-bridge)');
  check(Math.abs(vol - expectAnalytic)/expectAnalytic < 1e-9, 'volume == box - 4*(1-pi/4)R^2*DZ EXACTLY (analytic, not mesh approximation)');
}

// ---- (2) SINGLE-EDGE still analytic ------------------------------------------
console.log('\n[2] fillet ONE edge of the box (single-edge analytic path):');
{
  const b = f.makeBox(DX, DY, DZ);
  const oneId = verticalEdgeIds(b)[0];
  const r = f.part.filletEdges(b, [oneId], R);
  const kind = f.kindOf(r);
  const vol = f.massProps(r).volume;
  const expect = boxVol - (1-PI/4)*R*R*DZ;
  console.log(`    -> kind=${kind} volume=${vol.toFixed(6)} expected=${expect.toFixed(6)}`);
  check(kind === 'nativeSolid', 'single-edge result is a NativeSolid (analytic)');
  check(Math.abs(vol - expect)/expect < 1e-9, 'single-edge volume exact');
}

// ---- (3) SHARED-VERTEX set -> honest mesh-bridge fallback --------------------
console.log('\n[3] fillet ALL edges (every corner shared) -> honest mesh-bridge fallback:');
{
  const b = f.makeBox(DX, DY, DZ);
  const ids = allEdgeIds(b);
  check(ids.length === 12, `resolved 12 distinct edges (${ids.length})`);
  const r = f.part.filletEdges(b, ids, R);
  const kind = f.kindOf(r);
  console.log(`    -> kind=${kind} (shared-vertex set: analytic refuses, mesh-bridge takes over)`);
  check(kind === 'nativeMesh', 'shared-vertex set falls back to the mesh-bridge (NativeMesh) — honest, no fabricated corner');
}

console.log(`\n=== RESULT: ${pass} / ${total} checks passed ===`);
process.exit(pass === total ? 0 : 1);
