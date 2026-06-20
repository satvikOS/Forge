#!/usr/bin/env node
/**
 * flagship_verify.mjs — LIGHT headless verification for the FORGE FLAGSHIP
 * program (#87). Builds each of the three flagship parametric projects EXACTLY
 * ONCE against a FRESH headless kernel and reports, per project:
 *   • unique body count + assembly instance count
 *   • total / assembled triangle counts
 *   • overall bounding box (envelope)
 *   • assembly coherence (solver converged + AABB index)
 *   • any kernel verb errors
 *
 * Deliberately ONE build per project (no looping heavy multi-body OCCT builds)
 * so it stays light while a LoRA train holds the GPU.
 *
 *   node forge-kernel/test/flagship_verify.mjs [ge9x|gearbox|turbopump|all]
 */
import { fileURLToPath } from 'url';
import path from 'path';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const FV4 = path.resolve(__filename, '..', '..', '..', 'frontend', 'src', 'forge-v4');

const PROJECTS = {
  ge9x: {
    title: 'GE9X-class high-bypass TURBOFAN',
    module: path.join(FV4, 'ge9xBuilder.js'),
    fn: 'buildGE9X',
  },
  gearbox: {
    title: 'PLANETARY GEARBOX (sun + N planets + ring + carrier)',
    module: path.join(FV4, 'planetaryGearboxBuilder.js'),
    fn: 'buildPlanetaryGearbox',
  },
  turbopump: {
    title: 'CENTRIFUGAL TURBOPUMP (LOX/RP-1 style)',
    module: path.join(FV4, 'turbopumpBuilder.js'),
    fn: 'buildTurbopump',
  },
};

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

function envelopeOf(res) {
  const env = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const b of res.bodies) {
    if (!b.bbox) continue;
    for (let a = 0; a < 3; a++) {
      env.min[a] = Math.min(env.min[a], b.bbox.min[a]);
      env.max[a] = Math.max(env.max[a], b.bbox.max[a]);
    }
  }
  return env;
}

async function verifyOne(key) {
  const spec = PROJECTS[key];
  const forge = makeHeadlessForge();        // FRESH kernel per project (handle isolation)
  const mod = await import(spec.module);
  const build = mod[spec.fn];

  console.log(`\n${'='.repeat(86)}`);
  console.log(`  FLAGSHIP — ${spec.title}`);
  console.log('='.repeat(86));

  const t0 = Date.now();
  const res = await build(forge);
  const dt = Date.now() - t0;

  // per-body table
  console.log('  ' + pad('body', 20) + pad('role', 9) + padL('handle', 7) + padL('×inst', 7)
    + padL('triangles', 11) + padL('verts', 9) + padL('vol(cm³)', 12));
  console.log('  ' + '─'.repeat(82));
  let allOk = true;
  for (const b of res.bodies) {
    const ok = b.triangles > 0; allOk = allOk && ok;
    const vol = b.volume != null ? (b.volume / 1000).toFixed(0) : '—';
    console.log('  ' + pad(b.name, 20) + pad(b.role, 9) + padL(b.handle, 7) + padL(b.instances, 7)
      + padL(b.triangles, 11) + padL(b.vertices, 9) + padL(vol, 12) + (ok ? '' : '  XZERO'));
  }
  console.log('  ' + '─'.repeat(82));
  console.log('  ' + pad(`TOTAL (${res.bodies.length} unique bodies)`, 43) + padL(res.totalTriangles, 11));
  console.log('  ' + pad(`ASSEMBLED (${res.assembly.instances} instances)`, 43) + padL(res.assembledTriangles, 11));

  // gear math / spec echo
  if (res.gearMath) {
    const g = res.gearMath;
    console.log(`\n  GEAR MATH  m=${g.module} φ=${g.pressureAngle}°  Zsun=${g.Zsun} Zplanet=${g.Zplanet} Zring=${g.Zring} (N=${g.planetCount})`);
    console.log(`             ratio (carrier fixed) = 1 + Zring/Zsun = ${g.ratio}   meshingOk=${g.meshingOk}   carrierCircleR=${g.carrierCircleR.toFixed(1)}mm`);
  }
  if (res.ge9xSpec) {
    const s = res.ge9xSpec;
    console.log(`\n  GE9X SPEC  fanØ=${s.fanDiameter}mm blades=${s.bladeCount} BPR=${s.bypassRatio} OPR=${s.opr} stages LPC/HPC/HPT/LPT=${s.lpcStages}/${s.hpcStages}/${s.hptStages}/${s.lptStages}`);
  }

  // assembly coherence
  const asm = res.assembly;
  console.log('\n  ASSEMBLY');
  console.log(`    unique bodies   : ${asm.bodies}`);
  console.log(`    instances       : ${asm.instances}`);
  console.log(`    mates           : ${asm.mates}`);
  console.log(`    solver          : converged=${asm.solve.converged} iters=${asm.solve.iterations} residual=${asm.solve.residual}`);
  console.log(`    AABB index hits : ${asm.aabbHits}/${asm.instances}`);
  console.log(`    coherent        : ${asm.coherent}`);

  // envelope
  const env = envelopeOf(res);
  console.log('\n  ENVELOPE (mm)');
  console.log(`    bbox min : [${env.min.map((v) => v.toFixed(0)).join(', ')}]`);
  console.log(`    bbox max : [${env.max.map((v) => v.toFixed(0)).join(', ')}]`);
  console.log(`    extents  : ${(env.max[0] - env.min[0]).toFixed(0)} × ${(env.max[1] - env.min[1]).toFixed(0)} × ${(env.max[2] - env.min[2]).toFixed(0)}`);

  // verb errors
  const verbErrors = res.verbLog.filter((v) => !v.ok);
  console.log(`\n  VERB LOG: ${res.verbLog.length} calls, ${verbErrors.length} errors`);
  for (const e of verbErrors) console.log(`    X ${e.name}: ${e.error}`);

  console.log(`\n  build time: ${dt} ms`);
  const pass = allOk && asm.coherent && verbErrors.length === 0;
  console.log(`  RESULT: ${pass ? 'PASS' : 'FAIL'}`);
  return { key, pass, bodies: res.bodies.length, instances: asm.instances,
    triangles: res.totalTriangles, assembledTriangles: res.assembledTriangles, env, dt };
}

async function main() {
  const which = (process.argv[2] || 'all').toLowerCase();
  const keys = which === 'all' ? Object.keys(PROJECTS) : [which];
  const results = [];
  for (const k of keys) {
    if (!PROJECTS[k]) { console.error(`unknown project '${k}'`); process.exit(2); }
    results.push(await verifyOne(k));
  }
  console.log(`\n${'='.repeat(86)}`);
  console.log('  FLAGSHIP VERIFICATION SUMMARY');
  console.log('='.repeat(86));
  for (const r of results) {
    console.log('  ' + pad(r.key, 12) + (r.pass ? 'PASS' : 'FAIL')
      + `  bodies=${r.bodies} instances=${r.instances} tris(unique)=${r.triangles} tris(assembled)=${r.assembledTriangles} ${r.dt}ms`);
  }
  const allPass = results.every((r) => r.pass);
  console.log(`\n  OVERALL: ${allPass ? 'ALL PASS' : 'SOME FAILED'}\n`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error('\n[flagship_verify ERROR]', e.stack || e); process.exit(1); });
