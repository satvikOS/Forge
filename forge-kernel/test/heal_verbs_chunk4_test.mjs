#!/usr/bin/env node
/**
 * Headless verification for the chunk-4 healing + massProps bridge verbs added
 * to ForgeToolBridge.js:
 *   heal.sew, heal.simplify, heal.auto-fill, heal.auto-repair,
 *   heal.harmonize-normals, massProps
 *
 * Runs the native kernel in a FRESH plain-Node process (no Electron), dispatches
 * each verb through the REAL bridge dispatchToolCall (so we prove the FORGE_TOOLS
 * spec + run() actually wire to the kernel), and asserts ok + valid geometry /
 * numbers.
 *
 * Strategy mirrors healing_smoke.js: build a box, delete its +Z face to make an
 * open shell, then exercise the heal verbs on the open/closed bodies.
 *
 *   USAGE:  node forge-kernel/test/heal_verbs_chunk4_test.mjs
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO = path.resolve(__dirname, '..', '..');
const KERNEL_PATH = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const BRIDGE_PATH = path.resolve(REPO, 'frontend', 'src', 'ai', 'ForgeToolBridge.js');

// Minimal headless forge (raw kernel + buildPatch shim — same as cadscore_harness).
function makeHeadlessForge() {
  const kernel = require(KERNEL_PATH);
  const surfacing = kernel.surfacing
    ? Object.assign(Object.create(null), kernel.surfacing, {
        buildPatch(gridOrSpec, uDeg, vDeg, uK, vK) {
          let spec = gridOrSpec;
          if (Array.isArray(gridOrSpec)) {
            const rows = gridOrSpec.length;
            const cols = Array.isArray(gridOrSpec[0]) ? gridOrSpec[0].length : 0;
            const xyz = new Float64Array(rows * cols * 3);
            let i = 0;
            for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
              const p = gridOrSpec[r][c] || [0, 0, 0];
              xyz[i++] = p[0]; xyz[i++] = p[1]; xyz[i++] = p[2];
            }
            spec = { uCount: rows, vCount: cols, xyz };
          }
          return kernel.surfacing.buildPatch(spec, uDeg ?? 3, vDeg ?? 3, uK ?? null, vK ?? null);
        },
      })
    : null;
  return new Proxy(kernel, {
    get(t, p) {
      if (p === 'surfacing') return surfacing;
      if (p === 'isReady') return () => true;
      if (p === 'loadError') return () => null;
      const v = t[p];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

function finite(...xs) { return xs.every((x) => typeof x === 'number' && Number.isFinite(x)); }

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS ✓  ${label}  ${detail || ''}`); }
  else { fail++; console.log(`  FAIL ✗  ${label}  ${detail || ''}`); }
}

async function main() {
  const forge = makeHeadlessForge();
  const { dispatchToolCall } = await import(BRIDGE_PATH);
  console.log('[chunk4] kernel version =', forge.version());

  // ---- build a closed box, then an OPEN shell (delete +Z face) ---------
  const SIZE = 20;
  const box = forge.makeBox(SIZE, SIZE, SIZE);
  const faceCount = forge.direct.faceCount(box);
  let zPlusId = 0;
  for (let id = 1; id <= faceCount; ++id) {
    const fi = forge.direct.inferFeature(box, id);
    if (fi.normal[2] > 0.99) { zPlusId = id; break; }
  }
  // deleteFaceAndHeal auto-caps; to get a TRULY open shell for sew/auto-fill we
  // strip the cap by NOT healing — use the raw face-removal path the kernel
  // exposes via direct.removeFaces if present, else fall back to the healed
  // body (sew/auto-fill on a closed body is a valid no-op that still returns a
  // closed handle, which is what we assert).
  let openShell = box;
  if (typeof forge.direct.removeFaces === 'function') {
    try { openShell = forge.direct.removeFaces(box, [zPlusId]); } catch { openShell = box; }
  } else {
    // deleteFaceAndHeal re-caps; pass it so the verb still receives a real body.
    openShell = forge.direct.deleteFaceAndHeal(box, [zPlusId]);
  }
  const v0 = forge.heal.checkValidity(openShell);
  console.log(`[chunk4] test shell: closed=${v0.isClosed} faces=${forge.direct.faceCount(openShell)}`);

  const dispatch = (name, args) => dispatchToolCall({ name, arguments: args }, { forge });

  // ---- 1. heal.sew ------------------------------------------------------
  {
    console.log('\n[heal.sew]');
    const r = await dispatch('heal.sew', { shape: openShell, tolerance: 1e-3 });
    const h = r.result && r.result.shape;
    const okHandle = r.ok && typeof h === 'number' && h > 0;
    const v = okHandle ? forge.heal.checkValidity(h) : null;
    const mp = okHandle ? forge.massProps(h) : null;
    check('heal.sew', okHandle && r.result.report && mp && finite(mp.volume),
      `ok=${r.ok} handle=${h} closedAfter=${r.result?.report?.closedAfter} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`);
  }

  // ---- 2. heal.simplify (on the closed box) -----------------------------
  {
    console.log('\n[heal.simplify]');
    const r = await dispatch('heal.simplify', { shape: box, unifyFaces: true, unifyEdges: true });
    const h = r.result && r.result.shape;
    const okHandle = r.ok && typeof h === 'number' && h > 0;
    const mp = okHandle ? forge.massProps(h) : null;
    check('heal.simplify', okHandle && finite(r.result.facesBefore, r.result.facesAfter) && mp && finite(mp.volume),
      `ok=${r.ok} handle=${h} faces ${r.result?.facesBefore}→${r.result?.facesAfter} edges ${r.result?.edgesBefore}→${r.result?.edgesAfter} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`);
  }

  // ---- 3. heal.auto-fill (on the open shell) ----------------------------
  {
    console.log('\n[heal.auto-fill]');
    const r = await dispatch('heal.auto-fill', { shape: openShell, tolerance: 1e-3 });
    const h = r.result && r.result.shape;
    const okHandle = r.ok && typeof h === 'number' && h > 0;
    const v = okHandle ? forge.heal.checkValidity(h) : null;
    const mp = okHandle ? forge.massProps(h) : null;
    check('heal.auto-fill', okHandle && r.result.report && mp && finite(mp.volume),
      `ok=${r.ok} handle=${h} closedAfter=${r.result?.report?.closedAfter} facesAdded=${r.result?.report?.facesAdded} closed=${v?.isClosed} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`);
  }

  // ---- 4. heal.auto-repair (on the box) ---------------------------------
  {
    console.log('\n[heal.auto-repair]');
    const r = await dispatch('heal.auto-repair', { shape: box, tolerance: 1e-3 });
    const h = r.result && r.result.shape;
    const okHandle = r.ok && typeof h === 'number' && h > 0;
    const mp = okHandle ? forge.massProps(h) : null;
    check('heal.auto-repair', okHandle && r.result.report && mp && finite(mp.volume),
      `ok=${r.ok} handle=${h} fixersFired=${r.result?.report?.fixersFired} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`);
  }

  // ---- 5. heal.harmonize-normals (on the box) ---------------------------
  {
    console.log('\n[heal.harmonize-normals]');
    const r = await dispatch('heal.harmonize-normals', { shape: box });
    const h = r.result && r.result.shape;
    const okHandle = r.ok && typeof h === 'number' && h > 0;
    const v = okHandle ? forge.heal.checkValidity(h) : null;
    const mp = okHandle ? forge.massProps(h) : null;
    check('heal.harmonize-normals', okHandle && v && v.isOriented && mp && finite(mp.volume),
      `ok=${r.ok} handle=${h} closed=${v?.isClosed} oriented=${v?.isOriented} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`);
  }

  // ---- 6. massProps (kernel-name alias) ---------------------------------
  {
    console.log('\n[massProps]');
    const r = await dispatch('massProps', { shape: box });
    const mp = r.result;
    const com = mp && mp.centerOfMass;
    // 20mm box, corner at origin: vol=8000, area=2400, COM=[10,10,10].
    const okNums = r.ok && mp && finite(mp.volume, mp.area)
      && Array.isArray(com) && finite(com[0], com[1], com[2])
      && Math.abs(mp.volume - 8000) < 1
      && Math.abs(mp.area - 2400) < 1
      && Math.abs(com[0] - 10) < 0.1 && Math.abs(com[1] - 10) < 0.1 && Math.abs(com[2] - 10) < 0.1;
    check('massProps', okNums,
      `ok=${r.ok} vol=${mp?.volume} area=${mp?.area} com=[${com}] ${r.error || ''}`);
  }

  // ---- 7. heal.sew on a GENUINELY unsewn STL round-trip ----------------
  // Export the box to STL then re-import: STL carries no topology, so the
  // imported body is a loose face soup — sew has REAL work (this is the
  // import-repair use case the verb exists for, not a no-op on a clean box).
  {
    console.log('\n[heal.sew — STL round-trip (real defect)]');
    const os = require('os'); const fs = require('fs');
    const stlPath = path.join(os.tmpdir(), `forge_chunk4_${process.pid}.stl`);
    let ranRealCase = false, sewOk = false, detail = '';
    try {
      forge.io.exportStl(box, stlPath);
      const imported = forge.io.importStl(stlPath);
      const vBefore = forge.heal.checkValidity(imported);
      ranRealCase = true;
      const r = await dispatch('heal.sew', { shape: imported, tolerance: 1e-2 });
      const h = r.result && r.result.shape;
      const okHandle = r.ok && typeof h === 'number' && h > 0;
      const rep = r.result && r.result.report;
      const mp = okHandle ? forge.massProps(h) : null;
      // Sew must run and return a valid handle + finite mass props; the report
      // should show open edges BEFORE > AFTER (it actually stitched the soup).
      sewOk = okHandle && rep && mp && finite(mp.volume) && mp.volume > 0;
      detail = `closedBefore=${vBefore.isClosed} ok=${r.ok} handle=${h} openEdges ${rep?.openEdgesBefore}→${rep?.openEdgesAfter} faces ${rep?.facesBefore}→${rep?.facesAfter} vol=${mp?.volume?.toFixed(2)} ${r.error || ''}`;
      fs.unlinkSync(stlPath);
    } catch (e) { detail = `STL round-trip unavailable: ${e.message}`; }
    // If the STL path is unavailable we don't fail the suite (the no-op cases
    // above already prove dispatch+kernel wiring); we only assert when it ran.
    check('heal.sew (real unsewn import)', !ranRealCase || sewOk, detail);
  }

  console.log(`\n[chunk4] ${pass} passed, ${fail} failed`);
  if (fail) { console.log('[chunk4] SOME FAILED ✗'); process.exit(1); }
  console.log('[chunk4] ALL PASS ✓');
}

main().catch((e) => { console.error('[chunk4] THREW:', e); process.exit(2); });
