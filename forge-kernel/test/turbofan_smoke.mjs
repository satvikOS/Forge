#!/usr/bin/env node
/**
 * turbofan_smoke.mjs — headless build + tessellation assertion + SVG "screenshot"
 * for the parametric high-bypass turbofan (frontend/src/forge-v4/turbofanBuilder.js).
 *
 * Runs buildTurbofan against a FRESH headless kernel, asserts every named body
 * tessellates (triangles > 0) and the assembly is coherent (solver converged +
 * every body indexed in the spatial AABB), then projects a front-view (looking
 * down the engine axis) and a side silhouette of the whole engine to SVG as a
 * headless screenshot. Prints a per-body triangle-count table + totals.
 *
 *   node forge-kernel/test/turbofan_smoke.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const BUILDER = path.resolve(__filename, '..', '..', '..',
  'frontend', 'src', 'forge-v4', 'turbofanBuilder.js');
const OUT_DIR = path.resolve(__filename, '..', '_turbofan_out');

async function main() {
  const forge = makeHeadlessForge();
  const { buildTurbofan } = await import(BUILDER);

  const t0 = Date.now();
  const res = await buildTurbofan(forge);
  const dt = Date.now() - t0;

  // ── per-body table ──
  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);
  console.log('\n  HIGH-BYPASS TURBOFAN — headless B-rep build');
  console.log('  ' + '─'.repeat(82));
  console.log('  ' + pad('body', 16) + pad('role', 8) + padL('handle', 7) + padL('×inst', 7)
    + padL('triangles', 11) + padL('verts', 9) + padL('volume(cm³)', 14));
  console.log('  ' + '─'.repeat(82));
  let allOk = true;
  for (const b of res.bodies) {
    const ok = b.triangles > 0;
    allOk = allOk && ok;
    const vol = b.volume != null ? (b.volume / 1000).toFixed(0) : '—';
    console.log('  ' + pad(b.name, 16) + pad(b.role, 8) + padL(b.handle, 7) + padL(b.instances, 7)
      + padL(b.triangles, 11) + padL(b.vertices, 9) + padL(vol, 14) + (ok ? '' : '  XZERO'));
  }
  console.log('  ' + '─'.repeat(82));
  console.log('  ' + pad(`TOTAL  (${res.bodies.length} unique bodies)`, 38)
    + padL(res.totalTriangles, 11));
  console.log('  ' + pad(`ASSEMBLED (all ${res.assembly.instances} instances)`, 38)
    + padL(res.assembledTriangles, 11));

  // ── assembly coherence ──
  const asm = res.assembly;
  console.log('\n  ASSEMBLY');
  console.log(`    unique bodies   : ${asm.bodies}`);
  console.log(`    instances       : ${asm.instances}  (blades replicated into polar rings)`);
  console.log(`    concentric mates: ${asm.mates}  (all coaxial on engine +X axis)`);
  console.log(`    solver          : converged=${asm.solve.converged} iters=${asm.solve.iterations} residual=${asm.solve.residual}`);
  console.log(`    AABB index hits : ${asm.aabbHits}/${asm.instances}`);
  console.log(`    coherent        : ${asm.coherent}`);

  // ── overall envelope ──
  const env = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of res.bodies) {
    if (!b.bbox) continue;
    for (let a = 0; a < 3; a++) {
      env.min[a] = Math.min(env.min[a], b.bbox.min[a]);
      env.max[a] = Math.max(env.max[a], b.bbox.max[a]);
    }
  }
  const len = (env.max[0] - env.min[0]) / 1000;
  const dia = Math.max(env.max[1] - env.min[1], env.max[2] - env.min[2]) / 1000;
  console.log('\n  ENVELOPE');
  console.log(`    length (axial X): ${len.toFixed(2)} m`);
  console.log(`    max diameter    : ${dia.toFixed(2)} m`);

  // ── headless "screenshot": project the whole engine to SVG (front + side) ──
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let svgFront = null, svgSide = null;
  if (forge.drawings && typeof forge.drawings.projectView === 'function'
      && typeof forge.drawings.emitSVG === 'function') {
    // Fuse a lightweight silhouette set (nacelle + fan + core casing) so the
    // projection is a representative engine outline, not 18 overlapping rings.
    try {
      const byName = Object.fromEntries(res.bodies.map((b) => [b.name, b.handle]));
      const silhouetteNames = ['nacelle', 'core_casing', 'fan_disk',
        'combustor', 'lpt_s5_disk'];
      let sil = null;
      for (const n of silhouetteNames) {
        if (byName[n] == null) continue;
        sil = sil == null ? byName[n] : forge.fuse(sil, byName[n]);
      }
      if (sil != null) {
        for (const [dir, file, set] of [
          ['front', 'turbofan_front.svg', (v) => { svgFront = v; }],
          ['right', 'turbofan_side.svg', (v) => { svgSide = v; }],
        ]) {
          const view = forge.drawings.projectView(sil, dir);
          const svg = forge.drawings.emitSVG(view);
          const fp = path.join(OUT_DIR, file);
          fs.writeFileSync(fp, typeof svg === 'string' ? svg : JSON.stringify(view));
          set(fp);
        }
      }
    } catch (e) {
      console.log(`\n  [screenshot] projection skipped: ${e.message}`);
    }
  }
  console.log('\n  HEADLESS SCREENSHOT (hidden-line projection → SVG)');
  console.log(`    front view: ${svgFront || '— (projector unavailable)'}`);
  console.log(`    side view : ${svgSide || '— (projector unavailable)'}`);

  // ── verb error scan ──
  const verbErrors = res.verbLog.filter((v) => !v.ok);
  console.log(`\n  VERB LOG: ${res.verbLog.length} calls, ${verbErrors.length} errors`);
  for (const e of verbErrors) console.log(`    ✗ ${e.name}: ${e.error}`);

  console.log(`\n  build time: ${dt} ms`);

  const pass = allOk && asm.coherent && verbErrors.length === 0;
  console.log(`\n  RESULT: ${pass ? 'PASS — every body tessellates, assembly coherent' : 'FAIL'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('\n[turbofan_smoke ERROR]', e.stack || e); process.exit(1); });
