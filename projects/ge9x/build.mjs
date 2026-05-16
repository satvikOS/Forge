/**
 * GE9X — end-to-end build orchestrator.
 *
 * Generates the complete published-spec GE9X engineering deliverable:
 * geometry, simulations, animations and reports, into dist/.
 * Run:  node projects/ge9x/build.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GE9X, overallLength, fanDiameter } from './lib/spec.mjs';
import { buildEngine } from './lib/geometry.mjs';
import { toBinarySTL, toOBJ, toGLTF, meshStats } from './lib/meshio.mjs';
import { runAllSimulations } from './lib/simulate.mjs';
import { buildWorkingAnimation, buildAssemblyAnimation } from './lib/animate.mjs';
import { buildReport, buildReadme } from './lib/report.mjs';
import { makeZip } from './lib/zip.mjs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, 'dist');
const out = (rel, data) => {
  const p = join(DIST, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
  return p;
};

console.log('GE9X engineering model — build start');
console.log(`  fan diameter: ${fanDiameter().mm.toFixed(0)} mm (${fanDiameter().inch.toFixed(1)} in)`);
console.log(`  overall length: ${overallLength().toFixed(0)} mm`);

// ── Stage 2: geometry ──────────────────────────────────────────────
console.log('\n[geometry]');
const { modules, assembly } = buildEngine();
let totalTris = 0;
const moduleStats = {};
for (const [name, mesh] of Object.entries(modules)) {
  const st = meshStats(mesh);
  moduleStats[name] = st;
  totalTris += st.triangles;
  out(`geometry/modules/${name}.stl`, toBinarySTL(mesh));
  out(`geometry/modules/${name}.obj`, toOBJ(mesh, name));
  console.log(`  ${name.padEnd(12)} ${st.triangles.toString().padStart(7)} tris  ${st.vertices} verts`);
}
out('geometry/ge9x-assembly.stl', toBinarySTL(assembly));
out('geometry/ge9x-assembly.obj', toOBJ(assembly, 'ge9x'));
out('geometry/ge9x-assembly.gltf', toGLTF(assembly, 'GE9X'));
console.log(`  ASSEMBLY    ${meshStats(assembly).triangles} tris total (${(totalTris)} across modules)`);

// ── Stages 3-6: simulations ────────────────────────────────────────
console.log('\n[simulations]');
const sims = runAllSimulations();
const c = sims.cycle.points;
console.log(`  cycle — takeoff thrust ${c.takeoff.thrust_kN.toFixed(1)} kN ` +
  `(${c.takeoff.thrust_lbf.toFixed(0)} lbf), published ${GE9X.performance.takeoffThrust_kN} kN, ` +
  `err ${sims.cycle.validation.takeoffThrust.errorPct.toFixed(1)}%`);
console.log(`  cycle — takeoff OPR ${c.takeoff.OPR.toFixed(1)} (published ~${GE9X.performance.overallPressureRatio})`);
console.log(`  cycle — cruise SFC ${c.cruise.SFC_lb_per_lbf_hr.toFixed(3)} lb/lbf/hr`);
console.log(`  struct — fan blade ${sims.structural.fanBlade.mass_kg.toFixed(1)} kg, ` +
  `centrifugal ${sims.structural.fanBlade.centrifugalForce_kN.toFixed(0)} kN, ` +
  `SF ${sims.structural.fanBlade.safetyFactor_combined.toFixed(2)}`);
console.log(`  struct — LP critical ${sims.structural.rotordynamics.LP.criticalSpeed_rpm?.toFixed(0)} rpm, ` +
  `HP critical ${sims.structural.rotordynamics.HP.criticalSpeed_rpm?.toFixed(0)} rpm`);
console.log(`  cert  — FBO containment ${sims.certification.fbo.containmentEnergy_kJ.toFixed(0)} kJ, ` +
  `bird-strike ${sims.certification.birdStrike.impactEnergy_kJ.toFixed(1)} kJ`);
console.log(`  therm — HPT hotspot ${sims.thermalCFD.hptCooling.hotspot_K.toFixed(0)} K ` +
  `(limit ${sims.thermalCFD.hptCooling.materialLimit_K} K, within=${sims.thermalCFD.hptCooling.withinLimit})`);
console.log(`  cfd   — cavity Re100 max dev from Ghia ${sims.thermalCFD.cfdBenchmark.maxDeviationFromGhia.toFixed(4)}`);
out('simulations/all-simulations.json', JSON.stringify(sims, null, 2));

// ── Stage 7: animations ────────────────────────────────────────────
console.log('\n[animations]');
const working = buildWorkingAnimation();
out('animations/working/working-spoolup.svg', working.svg);
for (const fr of working.frames) out(`animations/${fr.name}`, fr.buffer);
console.log(`  working  — ${working.frames.length} PNG frames + animated SVG (${working.meta.turns} revolutions)`);

const assembly2 = buildAssemblyAnimation();
out('animations/assembly/assembly-sequence.svg', assembly2.svg);
for (const fr of assembly2.frames) out(`animations/${fr.name}`, fr.buffer);
console.log(`  assembly — ${assembly2.frames.length} PNG frames + animated SVG`);
console.log(`  assembly order: ${assembly2.meta.order.join(' → ')}`);
out('animations/README.txt',
  'GE9X animations\n\n'
  + '  working/   front-view fan spool-up — 16 blades 0→redline\n'
  + '  assembly/  side-view module assembly sequence\n\n'
  + 'Each folder has an animated SVG (plays standalone) and a numbered\n'
  + 'PNG frame sequence. Encode to MP4 with, e.g.:\n'
  + '  ffmpeg -framerate 24 -i working/frame_%04d.png -pix_fmt yuv420p working.mp4\n');

// ── Stage 8: reports + package ─────────────────────────────────────
console.log('\n[reports + package]');
const geometryInfo = { moduleStats, assemblyTriangles: meshStats(assembly).triangles };
const animMeta = { working: working.meta, assembly: assembly2.meta };
out('GE9X-report.html', buildReport(sims, geometryInfo));
out('README.txt', buildReadme(sims, geometryInfo, animMeta));
console.log('  GE9X-report.html + README.txt written');

// Collect every artifact in dist/ and pack a single source zip.
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}
const allFiles = walk(DIST);
const entries = allFiles.map((p) => ({
  path: 'GE9X/' + relative(DIST, p).replace(/\\/g, '/'),
  data: readFileSync(p),
}));
const zip = makeZip(entries);
const zipPath = join(HERE, 'GE9X-EngineeringModel.zip');
writeFileSync(zipPath, zip);
console.log(`  packaged ${entries.length} files → GE9X-EngineeringModel.zip ` +
  `(${(zip.length / 1024 / 1024).toFixed(1)} MB)`);

console.log('\nGE9X build — COMPLETE. Deliverable: projects/ge9x/GE9X-EngineeringModel.zip');
