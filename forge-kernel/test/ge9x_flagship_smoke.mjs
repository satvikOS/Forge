#!/usr/bin/env node
/**
 * ge9x_flagship_smoke.mjs — ONE light headless build + verification of the
 * ~20,000-component PARAMETRIC GE9X flagship (frontend/src/forge-v4/ge9xBuilder.js).
 *
 * Instanced geometry keeps memory bounded: UNIQUE kernel bodies stay ~tens even
 * though total assembled COMPONENTS reach ~20k. Asserts every unique body
 * tessellates (triangles > 0), reports uniqueBodies / totalComponents / bbox,
 * and confirms zero kernel-verb errors. Does NOT build the kernel, train, or
 * launch Electron/Playwright.
 *
 *   node forge-kernel/test/ge9x_flagship_smoke.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const BUILDER = path.resolve(__filename, '..', '..', '..',
  'frontend', 'src', 'forge-v4', 'ge9xBuilder.js');

async function main() {
  const forge = makeHeadlessForge();
  const { buildGE9X } = await import(BUILDER);

  const m0 = process.memoryUsage().rss;
  const t0 = Date.now();
  const res = await buildGE9X(forge);
  const dt = Date.now() - t0;
  const mPeak = process.memoryUsage().rss;

  const pad = (s, n) => String(s).padEnd(n);
  const padL = (s, n) => String(s).padStart(n);

  console.log('\n  GE9X FLAGSHIP — ~20,000-component parametric high-bypass turbofan');
  console.log('  ' + '─'.repeat(86));
  console.log('  ' + pad('unique body', 26) + pad('role', 13) + padL('handle', 7)
    + padL('triangles', 11) + padL('verts', 9) + padL('vol(cm³)', 12));
  console.log('  ' + '─'.repeat(86));
  let allOk = true;
  for (const b of res.bodies) {
    const ok = b.triangles > 0; allOk = allOk && ok;
    const vol = b.volume != null ? (b.volume / 1000).toFixed(0) : '—';
    console.log('  ' + pad(b.name, 26) + pad(b.role, 13) + padL(b.handle, 7)
      + padL(b.triangles, 11) + padL(b.vertices, 9) + padL(vol, 12) + (ok ? '' : '  ZERO!'));
  }
  console.log('  ' + '─'.repeat(86));

  console.log('\n  HIERARCHY (modules → stages/rows → component counts)');
  let hierTotal = 0;
  for (const mod of res.hierarchy) {
    if (mod.stages) {
      const sum = mod.stages.reduce((a, s) => a + Object.entries(s)
        .filter(([k]) => k !== 'stage').reduce((x, [, v]) => x + (typeof v === 'number' ? v : 0), 0), 0);
      hierTotal += sum;
      console.log(`    ${pad(mod.module, 20)} ${mod.stages.length} stages → ${sum} components`);
      for (const st of mod.stages) {
        const parts = Object.entries(st).filter(([k]) => k !== 'stage')
          .map(([k, v]) => `${k}:${v}`).join('  ');
        console.log(`        stage ${st.stage}: ${parts}`);
      }
    } else if (mod.flanges) {
      const sum = mod.flanges.reduce((a, f) => a + f.bolts + f.nuts, 0);
      hierTotal += sum;
      console.log(`    ${pad(mod.module, 20)} ${mod.flanges.length} flanges → ${sum} components (bolts+nuts)`);
    } else if (mod.rows) {
      const sum = Object.values(mod.rows).reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0);
      hierTotal += sum;
      const parts = Object.entries(mod.rows).map(([k, v]) => `${k}:${v}`).join('  ');
      console.log(`    ${pad(mod.module, 20)} → ${sum} components`);
      console.log(`        ${parts}`);
    }
  }

  const env = res.bbox;
  const L = (env.max[0] - env.min[0]) / 1000;
  const DIA = Math.max(env.max[1] - env.min[1], env.max[2] - env.min[2]) / 1000;

  console.log('\n  TOTALS');
  console.log(`    unique kernel bodies : ${res.uniqueBodies}`);
  console.log(`    total components      : ${res.totalComponents}   (every assembly instance)`);
  console.log(`    hierarchy sum (check) : ${hierTotal} (+statics)`);
  console.log(`    total triangles       : ${res.totalTriangles} (unique bodies)`);

  console.log('\n  BOUNDING BOX (mm)');
  console.log(`    x (axial) : ${res.bboxMm.x.toFixed(0)}   y : ${res.bboxMm.y.toFixed(0)}   z : ${res.bboxMm.z.toFixed(0)}`);
  console.log(`    length    : ${L.toFixed(2)} m    max Ø : ${DIA.toFixed(2)} m`);

  const asm = res.assembly;
  console.log('\n  ASSEMBLY');
  console.log(`    instances        : ${asm.instances}`);
  console.log(`    concentric mates : ${asm.mates}  (one per unique body, coaxial on +X)`);
  console.log(`    solver           : converged=${asm.solve.converged} iters=${asm.solve.iterations} residual=${asm.solve.residual}`);
  console.log(`    AABB index hits  : ${asm.aabbHits}/${asm.instances}`);
  console.log(`    coherent         : ${asm.coherent}`);

  const verbErrors = res.verbLog.filter((v) => !v.ok);
  console.log(`\n  VERB LOG: ${res.verbLog.length} calls, ${verbErrors.length} errors`);
  for (const e of verbErrors.slice(0, 20)) console.log(`    x ${e.name}: ${e.error}`);

  console.log(`\n  build time: ${dt} ms   RSS: ${(m0 / 1048576).toFixed(0)} → ${(mPeak / 1048576).toFixed(0)} MB`);

  const pass = allOk && verbErrors.length === 0
    && res.uniqueBodies > 0 && res.totalComponents > 0
    && asm.aabbHits === asm.instances;
  console.log(`\n  RESULT: ${pass ? 'PASS — every unique body tessellates, all components indexed, no kernel errors' : 'FAIL'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('\n[ge9x_flagship_smoke ERROR]', e.stack || e); process.exit(1); });
