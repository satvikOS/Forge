#!/usr/bin/env node
/**
 * Headless verification for the handle-free CONTEXT + PATTERN verbs added to
 * ForgeToolBridge.js. Runs the native kernel in a FRESH plain-Node process
 * (no Electron), dispatches a context sequence with NO handle ids anywhere in
 * the tool_calls, and asserts the terminal `ctx.current` body is ONE valid
 * closed manifold solid with the expected hole topology (Betti b0/b1/b2).
 *
 *   Example 1 (box):       begin(box 100x60x20)
 *                        → subtract(cylinder Ø20 at centre)   [1 through-hole]
 *                        → bolt-circle(4, bcd 40, Ø6)          [4 through-holes]
 *                        → finish(fillet 2)
 *     expect: b0=1 (one body), b1=10 (5 through-holes ⇒ genus 5 ⇒ b1=2·5).
 *
 *   Example 2 (cylinder):  begin(cylinder Ø50 depth 20)
 *                        → add(cylinder Ø80 depth 8)           [flange, fused]
 *                        → bolt-circle(6, bcd 65, Ø6)          [6 through-holes]
 *                        → subtract(cylinder Ø20 at centre)    [centre bore]
 *                        → finish(fillet 1)
 *     expect: b0=1, b1=14 (7 through-holes ⇒ genus 7).
 *
 * Through-holes raise genus by 1 each (each adds a handle / tunnel). For a
 * single closed solid with H through-holes:  b0=1, b1=2H, b2=1.
 *
 * USAGE:  node forge-kernel/test/context_verbs_test.mjs
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

// ── Betti from a tessellation (welded by quantised position, Euler χ per comp) ──
function bettiNumbers(t) {
  const P = t.positions, I = t.indices;
  const nVraw = P.length / 3;
  const q = 1e-4;
  const keyOf = (i) => Math.round(P[i * 3] / q) + ',' + Math.round(P[i * 3 + 1] / q) + ',' + Math.round(P[i * 3 + 2] / q);
  const weld = new Map();
  const rep = new Int32Array(nVraw);
  let nV = 0;
  for (let i = 0; i < nVraw; i++) {
    const k = keyOf(i);
    let id = weld.get(k);
    if (id === undefined) { id = nV++; weld.set(k, id); }
    rep[i] = id;
  }
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  const nF = I.length / 3;
  const edgeSet = new Set();
  const edgeKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  for (let f = 0; f < nF; f++) {
    const a = rep[I[f * 3]], b = rep[I[f * 3 + 1]], c = rep[I[f * 3 + 2]];
    uni(a, b); uni(b, c); uni(c, a);
    edgeSet.add(edgeKey(a, b)); edgeSet.add(edgeKey(b, c)); edgeSet.add(edgeKey(c, a));
  }
  const compOf = (id) => find(id);
  const cV = new Map();
  for (let i = 0; i < nV; i++) { const r = compOf(i); cV.set(r, (cV.get(r) || 0) + 1); }
  const cE = new Map();
  for (const e of edgeSet) { const [a] = e.split(':'); const r = compOf(Number(a)); cE.set(r, (cE.get(r) || 0) + 1); }
  const cF = new Map();
  for (let f = 0; f < nF; f++) { const r = compOf(rep[I[f * 3]]); cF.set(r, (cF.get(r) || 0) + 1); }
  let b0 = 0, b1 = 0, b2 = 0;
  for (const [r, V] of cV) {
    const E = cE.get(r) || 0, F = cF.get(r) || 0;
    const chi = V - E + F;
    const genus = Math.max(0, Math.round((2 - chi) / 2));
    b0 += 1; b1 += 2 * genus; b2 += 1;
  }
  return { b0, b1, b2 };
}

function arrLen(x) {
  if (x == null) return 0;
  if (Array.isArray(x)) return x.length;
  if (typeof x.length === 'number') return x.length;
  if (typeof x === 'object') return Object.keys(x).length;
  return 0;
}
function checkValid(forge, h) {
  const v = forge.heal.checkValidity(h);
  const badF = arrLen(v.badFaces);
  const valid = !!v.isClosed && !!v.isManifold && !!v.isOriented && !v.hasSelfIntersect && badF === 0;
  return { valid, raw: v, badFaces: badF };
}

async function runExample(label, forge, dispatchSequence, calls, expect) {
  // CRITICAL: every call below carries NO handle id — only primitive + dims + at.
  const noHandles = calls.every((c) => {
    const a = c.arguments || {};
    return !('shape' in a) && !('a' in a) && !('b' in a);
  });
  const ctx = { current: null };
  const res = await dispatchSequence(calls, forge, ctx);
  const term = res.current ?? res.lastHandle;
  const cv = checkValid(forge, term);
  const t = forge.tessellate(term, 0.1, 0.5);
  const betti = bettiNumbers(t);
  const ok = cv.valid && betti.b0 === expect.b0 && betti.b1 === expect.b1 && betti.b2 === expect.b2;
  console.log(`\n[${label}]`);
  console.log(`  handle-free calls : ${noHandles ? 'YES (no shape/a/b in any args)' : 'NO — found a handle arg!'}`);
  console.log(`  errors            : ${res.errors.length ? JSON.stringify(res.errors) : 'none'}`);
  console.log(`  terminal handle   : ${term} (ctx.current=${res.current})`);
  console.log(`  validity          : isClosed=${cv.raw.isClosed} isManifold=${cv.raw.isManifold} isOriented=${cv.raw.isOriented} selfIntersect=${cv.raw.hasSelfIntersect} badFaces=${cv.badFaces} → VALID=${cv.valid}`);
  console.log(`  body count (b0)   : ${betti.b0}  (expect ${expect.b0})`);
  console.log(`  Betti (b0,b1,b2)  : (${betti.b0},${betti.b1},${betti.b2})  (expect (${expect.b0},${expect.b1},${expect.b2}))`);
  console.log(`  RESULT            : ${ok ? 'PASS ✓' : 'FAIL ✗'}`);
  return { ok, noHandles, betti, valid: cv.valid, errors: res.errors, term };
}

async function main() {
  const forge = makeHeadlessForge();
  const { dispatchSequence } = await import(BRIDGE_PATH);

  // ── Example 1: box plate, centre bore, 4-bolt circle, edge break ──
  // No handles anywhere — only primitive names, dims, and `at`.
  // The box is begun centred on the origin (at:[-dx/2,-dy/2,0]) so the implicit
  // Z-axis bolt circle and centre bore land at the part centre.
  const ex1c = [
    { name: 'part.begin',       arguments: { primitive: 'box', dx: 100, dy: 60, dz: 20, at: [-50, -30, 0] } },
    { name: 'part.subtract',    arguments: { primitive: 'cylinder', diameter: 20, depth: 20, at: [0, 0, 0] } },
    { name: 'part.bolt-circle', arguments: { count: 4, bcd: 40, diameter: 6 } },
    { name: 'part.finish',      arguments: { fillet: 2 } },
  ];
  const r1 = await runExample('Example 1 — box plate + centre bore + 4 bolt holes + fillet', forge, dispatchSequence, ex1c, { b0: 1, b1: 10, b2: 1 });

  // ── Example 2: cylinder body + flange + 6-bolt circle + centre bore ──
  const ex2 = [
    { name: 'part.begin',       arguments: { primitive: 'cylinder', diameter: 50, depth: 20 } },
    { name: 'part.add',         arguments: { primitive: 'cylinder', diameter: 80, depth: 8 } }, // flange at base
    { name: 'part.bolt-circle', arguments: { count: 6, bcd: 65, diameter: 6 } },
    { name: 'part.subtract',    arguments: { primitive: 'cylinder', diameter: 20, depth: 20, at: [0, 0, 0] } },
    { name: 'part.finish',      arguments: { fillet: 1 } },
  ];
  const r2 = await runExample('Example 2 — cylinder + flange + 6 bolt holes + centre bore + fillet', forge, dispatchSequence, ex2, { b0: 1, b1: 14, b2: 1 });

  const allOk = r1.ok && r2.ok && r1.noHandles && r2.noHandles;
  console.log(`\n================ SUMMARY ================`);
  console.log(`Example 1: valid=${r1.valid} betti=(${r1.betti.b0},${r1.betti.b1},${r1.betti.b2}) → ${r1.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Example 2: valid=${r2.valid} betti=(${r2.betti.b0},${r2.betti.b1},${r2.betti.b2}) → ${r2.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Both build ONE valid fused solid, handle-free: ${allOk ? 'YES ✓' : 'NO ✗'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[test error]', e.stack || e); process.exit(2); });
