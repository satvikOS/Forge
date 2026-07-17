// native_vs_occt_fillet_prism.mjs — K3 NON-ORTHOGONAL fillet A/B gate.
//
// Verifies filletSolidStraightConvexEdgeAnalytic (the K3 general-dihedral broadening
// of the certified 90-degree analytic fillet): filleting ONE straight CONVEX side
// edge of a REGULAR n-gon prism, whose two adjacent planar side faces meet at a
// genuine NON-90 interior dihedral delta = (n-2)*180/n, must
//   (1) ride the NATIVE analytic path  -> kindOf(result) == 'nativeSolid'
//       (NOT 'nativeMesh' = the mesh-bridge fallback, NOT 'occt'),
//   (2) match the closed-form analytic removed volume
//         V_removed = (cot(delta/2) - theta/2) * R^2 * L,  theta = pi - delta
//       to <= 1e-6 rel  (== (1-pi/4)R^2 L at delta=90), AND
//   (3) match OCCT BRepFilletAPI (setNativeBrep(false)) volume on the SAME edge
//       to <= 5e-4 rel.
// Sweep n in {3,6,8} -> delta in {60,120,135} (acute + obtuse). REVERT-if-fail.
//
// Run: FORGE_KERNEL=/abs/build/Release/forge-kernel.node node test/native_vs_occt_fillet_prism.mjs
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = process.env.FORGE_KERNEL ||
  path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const f = require(KERNEL);
if (typeof f.setNativeBrep !== 'function') { console.error('addon lacks setNativeBrep — need -DFORGE_NATIVE_BREP=ON'); process.exit(1); }

const PI = Math.PI;
let pass = 0, total = 0;
const check = (c, m) => { total++; if (c) { pass++; console.log('  [PASS]', m); } else console.log('  [FAIL]', m); };

// The Z-parallel (vertical) side edge ids of a prism, keyed by midpoint so the SAME
// physical edge is picked in native and OCCT modes.
function verticalEdges(h) {
  const segs = f.direct.edgeSegments(h, 0.25);
  const out = new Map();
  for (const s of segs) {
    const p = s.points; if (p.length < 6) continue;
    const a = [p[0],p[1],p[2]], b = [p[p.length-3],p[p.length-2],p[p.length-1]];
    const d = [b[0]-a[0], b[1]-a[1], b[2]-a[2]];
    const L = Math.hypot(...d) || 1; const dir = [d[0]/L,d[1]/L,d[2]/L];
    if (Math.abs(Math.abs(dir[2])-1) > 1e-6) continue;   // vertical only
    const mid = [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
    const key = mid.slice(0,2).map(v=>v.toFixed(4)).join(',');
    if (!out.has(key)) out.set(key, { id: s.id, mid });
  }
  return [...out.values()];
}

const H = 10, RC = 5, R = 1;   // prism height, circumradius, fillet radius
const cases = [ {n:3, deltaDeg:60}, {n:6, deltaDeg:120}, {n:8, deltaDeg:135} ];

for (const {n, deltaDeg} of cases) {
  console.log(`\n[n=${n}] regular ${n}-gon prism, interior dihedral delta=${deltaDeg}deg, fillet R=${R}:`);
  const delta = deltaDeg * PI/180;
  const theta = PI - delta;                        // arc sweep = acos(nA.nB)
  const perLen = (1/Math.tan(delta/2)) - theta/2;  // cot(delta/2) - theta/2

  // ---- NATIVE ----
  f.setNativeBrep(true);
  const bn = f.makePrism(n, RC, H);
  const V0n = f.massProps(bn).volume;
  const vn = verticalEdges(bn);
  if (vn.length < 1) { check(false, `native: resolved a vertical side edge (${vn.length})`); continue; }
  const rn = f.part.filletEdges(bn, [vn[0].id], R);
  const kindN = f.kindOf(rn);
  const volN = f.massProps(rn).volume;
  const expected = V0n - perLen*R*R*H;
  console.log(`    native: prismVol=${V0n.toFixed(6)} kind=${kindN} filletVol=${volN.toFixed(6)} analytic=${expected.toFixed(6)} rel=${(Math.abs(volN-expected)/expected).toExponential(3)}`);
  check(kindN === 'nativeSolid', `native rode the GENERAL-dihedral analytic path (nativeSolid, NOT mesh/occt) — got ${kindN}`);
  check(Math.abs(volN-expected)/expected < 1e-6, `native fillet vol == analytic (cot(d/2)-theta/2)R^2 L to 1e-6`);

  // ---- OCCT ----
  f.setNativeBrep(false);
  const bo = f.makePrism(n, RC, H);
  const V0o = f.massProps(bo).volume;
  const vo = verticalEdges(bo);
  // pick the OCCT edge whose midpoint matches the native one we filleted
  let pick = vo[0];
  for (const e of vo) if (Math.hypot(e.mid[0]-vn[0].mid[0], e.mid[1]-vn[0].mid[1]) < 1e-4) pick = e;
  let kindO = 'n/a', volO = NaN;
  try {
    const ro = f.part.filletEdges(bo, [pick.id], R);
    kindO = f.kindOf(ro); volO = f.massProps(ro).volume;
  } catch (e) { console.log('    occt fillet threw:', e.message); }
  console.log(`    occt:   prismVol=${V0o.toFixed(6)} kind=${kindO} filletVol=${volO.toFixed(6)} nat<->occt rel=${(Math.abs(volN-volO)/volO).toExponential(3)}`);
  check(Number.isFinite(volO) && Math.abs(volN-volO)/volO < 5e-4, `native fillet vol == OCCT BRepFilletAPI vol to 5e-4`);
}

f.setNativeBrep(true);
console.log(`\n=== RESULT: ${pass} / ${total} checks passed ===`);
process.exit(pass === total ? 0 : 1);
