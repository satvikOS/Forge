import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'capstone');
const SS_ROOT = path.join(REPO_ROOT, 'foundation-output', 'screenshots');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(600000);

/**
 * Capstone — drive the Phone-Stand Bracket through every applicable
 * foundation module in sequence and emit a single HTML report bundling
 * all results.
 *
 * Pipeline:
 *   1. Build via Sketch2D + manifold-3d feature ops
 *   2. STL + STEP AP203 + 3-view SVG drawing + HTML print package
 *   3. Voxelize → linear-tet FEM mesh
 *   4. Static FEM (gravity load on lip)
 *   5. Modal (lowest natural frequency)
 *   6. Thermal FEM (hot base, cold lip)
 *   7. Thermo-mechanical coupling
 *   8. SIMP topology optimization (40 % volume target)
 *   9. Tolerance stack on the 4-hole pattern (fastener fit analysis)
 *  10. Feature recognition (verify CAM-friendly classification)
 *  11. Mesh repair (round-trip the surface)
 *  12. Live viewport render with stress contour
 */
test('Capstone — Phone-Stand Bracket through every foundation module', async ({ page }) => {
  ensure(ROOT); ensure(SS_ROOT);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const out = await page.evaluate(async () => {
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { solveLinearStatic } = await import('/src/foundation/LinearTetFEM.js');
    const { lowestNaturalFrequency } = await import('/src/foundation/ModalAnalysis.js');
    const { solveThermalSteady } = await import('/src/foundation/ThermalFEM.js');
    const { solveThermoMechanical } = await import('/src/foundation/ThermoMechanical.js');
    const { optimizeSIMP } = await import('/src/foundation/TopologyOptimization.js');
    const { Dimension, Stack, DIST, seededRng } = await import('/src/foundation/ToleranceStack.js');
    const { recognize } = await import('/src/foundation/FeatureRecognition.js');
    const { diagnose, repair } = await import('/src/foundation/MeshRepair.js');
    const { toBinarySTL, buildPrintReport } = await import('/src/foundation/STLExport.js');
    const { manifoldToSTEP } = await import('/src/foundation/StepExport.js');
    const { buildDrawingSVG } = await import('/src/foundation/Drawing2D.js');
    const { buildPartPackageHTML } = await import('/src/foundation/PrintPackage.js');
    const { buildTetSurfaceColoredMesh } = await import('/src/foundation/FEMVisualizer.js');
    const { StudioLighting } = await import('/src/kernel/index.js');

    const ALUM = { name: 'Aluminum 6061-T6', E: 68900, nu: 0.33, alpha: 23.6e-6,
                   density: 2.70e-6, yieldStrength: 276, k: 0.167 };

    const log = [];
    const tic = () => performance.now();
    const toc = (t0) => +((performance.now() - t0) / 1000).toFixed(3);
    const stage = (name, fn) => {
      const t0 = tic();
      const result = fn();
      const dt = toc(t0);
      log.push({ stage: name, elapsed_s: dt });
      return result;
    };

    // 1. Build geometry
    const bracket = await stage('1. build', async () => buildPhoneStandBracket()).then(p => p);

    // 2. Output formats
    const printReport = stage('2a. print-prep', () => buildPrintReport(bracket));
    const stlBytes = stage('2b. STL', () => toBinarySTL(bracket));
    const step = stage('2c. STEP AP203', () => manifoldToSTEP(bracket, { name: 'Phone-Stand Bracket', author: 'ArchDisc Foundation v1' }));
    const svg = stage('2d. drawing (HLR)', () => buildDrawingSVG(bracket, { name: 'Phone-Stand Bracket', material: 'Al 6061-T6' }));
    const enc = (a) => { let b = ''; for (let i = 0; i < a.length; i++) b += String.fromCharCode(a[i]); return btoa(b); };
    const stlB64 = enc(stlBytes);

    // 3. Voxelize
    const tetMesh = await stage('3. voxelize (cellSize 4 mm)', async () => TetMesh.fromManifold(bracket, { cellSize: 4 })).then(m => m);
    const meshStats = tetMesh.stats();

    // BCs (reused across solvers): clamp the base plate (z ≤ 0.5)
    const fixedNodes = tetMesh.selectNodes(([x, y, z]) => z <= 0.5);
    const lipNodes = tetMesh.selectNodes(([x, y, z]) => z > 7 && y > 4 && y < 12);

    // 4. Static FEM (gravity 30 N at lip — phone weight + safety factor)
    const staticFEM = stage('4. static FEM', () => solveLinearStatic({
      mesh: tetMesh, material: ALUM, fixedNodes,
      loads: lipNodes.map(n => ({ node: n, dof: 1, value: -30 / lipNodes.length })),
    }));

    // 5. Modal
    const modal = stage('5. modal', () => lowestNaturalFrequency({
      mesh: tetMesh, material: ALUM, fixedNodes, maxIter: 30,
    }));
    const modalHz = modal.freqHz * Math.sqrt(1000);   // mm-system → SI

    // 6. Thermal: hot base (90°C), cold lip (25°C)
    const thermal = stage('6. thermal FEM', () => solveThermalSteady({
      mesh: tetMesh, k: ALUM.k, Tref: 25,
      fixedTemperatures: [
        ...fixedNodes.map(n => ({ node: n, value: 90 })),
        ...lipNodes.map(n => ({ node: n, value: 25 })),
      ],
    }));

    // 7. Thermo-mechanical (clamped base + thermal field)
    const thermomech = await stage('7. thermo-mechanical', async () => solveThermoMechanical({
      mesh: tetMesh, material: ALUM,
      thermal: {
        k: ALUM.k, Tref: 25,
        fixedTemperatures: [
          ...fixedNodes.map(n => ({ node: n, value: 90 })),
          ...lipNodes.map(n => ({ node: n, value: 25 })),
        ],
      },
      structural: { fixedNodes, mechanicalLoads: [] },
    })).then(r => r);

    // 8. SIMP topology optimization (40% volume target)
    const simp = stage('8. SIMP topology opt', () => optimizeSIMP({
      mesh: tetMesh, material: ALUM,
      fixedNodes, loads: lipNodes.map(n => ({ node: n, dof: 1, value: -30 / lipNodes.length })),
      volumeFraction: 0.4, penalty: 3, filterRadius: 6, maxIter: 20, tol: 0.01,
    }));
    let aboveThresh = 0;
    for (const r of simp.densities) if (r > 0.5) aboveThresh++;

    // 9. Tolerance stack: 4-hole pattern fit with M3 fasteners
    // Holes are Ø4 in the bracket, fastener clearance is M3 (Ø3.0) → nominal 1.0 mm clearance
    // Real-world: 3D-printed bracket Ø4 +0.10/-0.05; M3 SHCS Ø3.0 ± 0.04
    const tolStack = stage('9. tolerance stack (M3 fit)', () => {
      const holeDia = new Dimension({ name: 'Hole', nominal: 4.0, tolPlus: 0.10, tolMinus: 0.05, distribution: DIST.NORMAL, cp: 1.33 });
      const fastDia = new Dimension({ name: 'Fastener', nominal: 3.0, tolPlus: 0.04, tolMinus: 0.04, distribution: DIST.NORMAL, cp: 1.33 });
      const stk = new Stack({
        inputs: [holeDia, fastDia],
        compute: (v) => v.Hole - v.Fastener,
        outputName: 'Clearance',
        spec: { lsl: 0.5, usl: 1.5, target: 1.0 },
      });
      const mc = stk.monteCarlo(50000, seededRng(7));
      return { worstCase: stk.worstCase(), rss: stk.rss(), mc, nominal: stk.evalNominal() };
    });

    // 10. Feature recognition
    const features = stage('10. feature recognition', () => recognize(bracket));

    // 11. Mesh repair round-trip
    const meshObj = bracket.getMesh();
    const repairBefore = stage('11a. diagnose', () => diagnose({
      numProp: meshObj.numProp,
      vertProperties: meshObj.vertProperties,
      triVerts: meshObj.triVerts,
    }));
    const repairResult = stage('11b. repair', () => repair({
      numProp: meshObj.numProp,
      vertProperties: meshObj.vertProperties,
      triVerts: meshObj.triVerts,
    }));

    // 12. Render stress contour in viewport
    const { mesh: stressMesh } = buildTetSurfaceColoredMesh(tetMesh, staticFEM.nodalVonMises);
    const scene = window.__three_scene;
    const renderer = window.__three_renderer;
    const toRemove = [];
    scene.traverse(o => { if (o !== scene && !o.isLight && !o.isCamera) toRemove.push(o); });
    for (const o of toRemove) o.parent?.remove(o);
    scene.add(stressMesh);
    const box = new THREE.Box3().setFromObject(stressMesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const lightsToRemove = [];
    scene.traverse(o => { if (o.isLight && !o.userData?.studio) lightsToRemove.push(o); });
    for (const l of lightsToRemove) scene.remove(l);
    StudioLighting.apply(scene, { THREE, targetCenter: center, targetSize: size.length(), intensity: 1.6 });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    return {
      log,
      meshStats,
      printReport,
      stl_kB: Math.round(stlBytes.length / 1024),
      step_kB: Math.round(step.length / 1024),
      svg_kB: Math.round(svg.length / 1024),
      static: {
        maxDispMm: staticFEM.maxDisplacement,
        maxStressMPa: staticFEM.maxStress,
        sf: staticFEM.safetyFactor,
        cgIters: staticFEM.cgIterations,
      },
      modal: { firstFreqHz: modalHz, iterations: modal.iterations, converged: modal.converged },
      thermal: { Tmin: thermal.minT, Tmax: thermal.maxT, cgIters: thermal.cgIterations },
      thermomech: {
        maxDispMm: thermomech.maxDisplacement,
        maxStressMPa: thermomech.maxStress,
        sf: thermomech.safetyFactor,
      },
      simp: {
        finalVolFrac: aboveThresh / simp.densities.length,
        finalCompliance: simp.compliance,
        iterations: simp.history.length,
      },
      tolStack: {
        nominal: tolStack.nominal,
        wcLow: tolStack.worstCase.low,
        wcHigh: tolStack.worstCase.high,
        rssSigma: tolStack.rss.sigma,
        mcMean: tolStack.mc.mean,
        mcStddev: tolStack.mc.stddev,
        mcCp: tolStack.mc.Cp,
        mcCpk: tolStack.mc.Cpk,
        ppm: tolStack.mc.defectsPerMillion,
        spec: tolStack.mc.spec,
      },
      features: {
        planar: features.summary.planarPatches,
        cylindrical: features.summary.cylindricalPatches,
        freeform: features.summary.freeformPatches,
        cylinderDiameters: features.summary.cylinders.map(c => c.diameter).slice(0, 8),
      },
      repair: {
        before: repairBefore,
        after: repairResult.after,
        operations: repairResult.operations,
      },
      bbox: { center: center.toArray(), size: size.toArray() },
      stl: stlB64, step, svg,
    };
  });

  // Renders
  const c = out.bbox.center;
  const dist = Math.max(...out.bbox.size) * 1.6;
  const renderView = async (name, cameraPos, fov, label) => {
    await page.evaluate(async (s) => {
      const cam = window.__three_camera;
      cam.position.set(...s.cameraPos);
      cam.lookAt(...s.lookAt);
      cam.fov = s.fov; cam.near = 0.001; cam.far = s.far;
      cam.updateProjectionMatrix();
      window.__three_renderer.render(window.__three_scene, cam);
    }, { cameraPos, lookAt: c, fov, far: dist * 30 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SS_ROOT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png — ${label}`);
  };
  await renderView('capstone-bracket-iso', [c[0] + dist * 0.7, c[1] + dist * 0.4, c[2] + dist * 0.6], 32, 'static FEM stress contour');
  await renderView('capstone-bracket-side', [c[0] + dist, c[1] + dist * 0.05, c[2]], 30, 'side');

  // Save STL/STEP/drawing
  fs.writeFileSync(path.join(ROOT, 'phone-stand-bracket.stl'), Buffer.from(out.stl, 'base64'));
  fs.writeFileSync(path.join(ROOT, 'phone-stand-bracket.step'), out.step);
  fs.writeFileSync(path.join(ROOT, 'phone-stand-bracket-drawing.svg'), out.svg);

  console.log(`\n=== CAPSTONE BRACKET LIFECYCLE ===`);
  console.log(`Stage timing:`);
  for (const s of out.log) console.log(`  ${s.stage.padEnd(30)} ${s.elapsed_s} s`);
  console.log(`\nStatic FEM:        σ_max = ${out.static.maxStressMPa.toFixed(2)} MPa, SF = ${out.static.sf.toFixed(1)}, δ = ${out.static.maxDispMm.toFixed(4)} mm`);
  console.log(`Modal:             f₁ = ${out.modal.firstFreqHz.toFixed(1)} Hz`);
  console.log(`Thermal:           T ∈ [${out.thermal.Tmin.toFixed(1)}, ${out.thermal.Tmax.toFixed(1)}] °C`);
  console.log(`Thermo-mechanical: σ_max = ${out.thermomech.maxStressMPa.toFixed(2)} MPa, SF = ${out.thermomech.sf.toFixed(1)}`);
  console.log(`SIMP:              vol-frac ${out.simp.finalVolFrac.toFixed(3)}, compliance ${out.simp.finalCompliance.toExponential(2)}`);
  console.log(`Tolerance stack:   μ = ${out.tolStack.mcMean.toFixed(3)}, σ = ${out.tolStack.mcStddev.toFixed(4)}, Cpk = ${out.tolStack.mcCpk.toFixed(2)}, ${out.tolStack.ppm.toFixed(0)} ppm`);
  console.log(`Features:          ${out.features.planar} planar + ${out.features.cylindrical} cylindrical (Ø ${out.features.cylinderDiameters.map(d => d.toFixed(2)).join(' Ø ')})`);
  console.log(`Mesh repair:       ${out.repair.before.triangles} → ${out.repair.after.triangles} tri, ops: ${out.repair.operations.map(o => o.op).join(', ')}`);
  console.log(`Outputs:           STL ${out.stl_kB} KB, STEP ${out.step_kB} KB, SVG ${out.svg_kB} KB`);

  // Build comprehensive HTML report
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Foundation Capstone — Phone-Stand Bracket Lifecycle</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;max-width:1100px;line-height:1.5;color:#1a1a1a}
h1{font-size:26px}h2{font-size:18px;border-bottom:1px solid #ddd;padding-bottom:6px;margin-top:32px}
.subtitle{color:#666;font-size:14px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px}
th,td{text-align:left;padding:6px 12px;border-bottom:1px solid #e1e4e8;vertical-align:top}
th{background:#f6f8fa;font-weight:600}
.stage{display:flex;justify-content:space-between;background:#f6f8fa;padding:6px 12px;margin:2px 0;border-radius:4px;font-size:13px;font-family:monospace}
.metric{display:inline-block;background:#e7f3ff;border-radius:4px;padding:3px 8px;margin:2px;font-size:12px;font-family:monospace}
.good{background:#d4edda;color:#155724}
.warn{background:#fff3cd;color:#856404}
.bad{background:#f8d7da;color:#721c24}
.actions a{display:inline-block;background:#2c5cba;color:white;padding:8px 14px;margin:4px;border-radius:4px;text-decoration:none;font-weight:600;font-size:13px}
img{max-width:100%;border:1px solid #ddd;border-radius:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
</style></head><body>
<h1>Foundation Capstone</h1>
<h2 style="border:none;margin:0 0 8px">Phone-Stand Bracket — full lifecycle</h2>
<div class="subtitle">${new Date().toISOString().slice(0, 10)} · Aluminum 6061-T6 (E = 68 900 MPa, ν = 0.33, α = 23.6e-6 / K, k = 0.167 W/(mm·K))</div>

<div class="actions">
  <a href="phone-stand-bracket.stl" download>Download STL (${out.stl_kB} KB)</a>
  <a href="phone-stand-bracket.step" download>Download STEP AP203 (${out.step_kB} KB)</a>
  <a href="phone-stand-bracket-drawing.svg" target="_blank">Open drawing (${out.svg_kB} KB)</a>
</div>

<div class="grid2" style="margin-top:24px">
  <div><img src="../screenshots/capstone-bracket-iso.png" alt="Static FEM stress contour"><div style="text-align:center;font-size:11px;color:#666;margin-top:4px">Static FEM stress contour (iso)</div></div>
  <div><img src="../screenshots/capstone-bracket-side.png" alt="Side"><div style="text-align:center;font-size:11px;color:#666;margin-top:4px">Side view</div></div>
</div>

<h2>Stage timing</h2>
${out.log.map(s => `<div class="stage"><span>${s.stage}</span><span>${s.elapsed_s} s</span></div>`).join('')}

<h2>Mesh + geometry</h2>
<table>
<tr><td>Manifold</td><td>${out.printReport.manifold ? '<span class="metric good">guaranteed</span>' : '<span class="metric bad">no</span>'}</td></tr>
<tr><td>Bounding box (mm)</td><td>${(out.printReport.boundingBoxMm.max[0] - out.printReport.boundingBoxMm.min[0]).toFixed(2)} × ${(out.printReport.boundingBoxMm.max[1] - out.printReport.boundingBoxMm.min[1]).toFixed(2)} × ${(out.printReport.boundingBoxMm.max[2] - out.printReport.boundingBoxMm.min[2]).toFixed(2)}</td></tr>
<tr><td>Volume / surface area</td><td>${out.printReport.volumeMm3.toFixed(1)} mm³ / ${out.printReport.surfaceAreaMm2.toFixed(1)} mm²</td></tr>
<tr><td>Surface mesh</td><td>${out.printReport.triangles} triangles, ${out.printReport.vertices} vertices</td></tr>
<tr><td>Tet mesh (FEM)</td><td>${out.meshStats.tetCount} tets, ${out.meshStats.vertexCount} nodes (cellSize ${out.meshStats.cellSize?.[0].toFixed(2) ?? '?'} mm)</td></tr>
</table>

<h2>4. Static FEM — gravity load</h2>
<table>
<tr><td>Load case</td><td>30 N downward at lip (phone weight + safety factor)</td></tr>
<tr><td>Boundary</td><td>Base plate clamped (z ≤ 0.5 mm)</td></tr>
<tr><td>Max displacement</td><td><span class="metric">${out.static.maxDispMm.toFixed(4)} mm</span></td></tr>
<tr><td>Max von Mises</td><td><span class="metric">${out.static.maxStressMPa.toFixed(2)} MPa</span></td></tr>
<tr><td>Safety factor (yield 276 MPa)</td><td><span class="metric ${out.static.sf > 2 ? 'good' : 'warn'}">${out.static.sf.toFixed(1)}</span></td></tr>
<tr><td>CG iterations</td><td>${out.static.cgIters}</td></tr>
</table>

<h2>5. Modal — first natural frequency</h2>
<table>
<tr><td>Lowest mode (clamped base)</td><td><span class="metric">${out.modal.firstFreqHz.toFixed(1)} Hz</span></td></tr>
<tr><td>Inverse iteration</td><td>${out.modal.iterations} steps · ${out.modal.converged ? '<span class="metric good">converged</span>' : '<span class="metric warn">max iters</span>'}</td></tr>
</table>

<h2>6. Steady thermal — base 90°C, lip 25°C</h2>
<table>
<tr><td>T range (°C)</td><td><span class="metric">${out.thermal.Tmin.toFixed(2)} — ${out.thermal.Tmax.toFixed(2)}</span></td></tr>
<tr><td>CG iterations</td><td>${out.thermal.cgIters}</td></tr>
</table>

<h2>7. Thermo-mechanical coupling</h2>
<table>
<tr><td>Max displacement (thermal expansion)</td><td><span class="metric">${out.thermomech.maxDispMm.toFixed(4)} mm</span></td></tr>
<tr><td>Max von Mises (thermal stress)</td><td><span class="metric">${out.thermomech.maxStressMPa.toFixed(2)} MPa</span></td></tr>
<tr><td>SF</td><td><span class="metric ${out.thermomech.sf > 1.5 ? 'good' : 'warn'}">${out.thermomech.sf.toFixed(1)}</span></td></tr>
</table>

<h2>8. SIMP topology optimization</h2>
<table>
<tr><td>Volume fraction (target 0.40)</td><td><span class="metric">${out.simp.finalVolFrac.toFixed(3)}</span></td></tr>
<tr><td>Final compliance</td><td><span class="metric">${out.simp.finalCompliance.toExponential(2)}</span></td></tr>
<tr><td>OC iterations</td><td>${out.simp.iterations}</td></tr>
</table>

<h2>9. Tolerance stack — Ø4 hole + M3 fastener clearance</h2>
<table>
<tr><td>Hole spec</td><td>Ø4.0 +0.10 / -0.05 (FDM print, normal Cp 1.33)</td></tr>
<tr><td>Fastener spec</td><td>Ø3.0 ± 0.04 (M3 SHCS shank)</td></tr>
<tr><td>Spec window</td><td>[${out.tolStack.spec.lsl}, ${out.tolStack.spec.usl}] mm clearance, target ${out.tolStack.spec.target}</td></tr>
<tr><td>Nominal clearance</td><td>${out.tolStack.nominal.toFixed(3)} mm</td></tr>
<tr><td>Worst-case range</td><td>[${out.tolStack.wcLow.toFixed(3)}, ${out.tolStack.wcHigh.toFixed(3)}] mm</td></tr>
<tr><td>RSS σ</td><td>${out.tolStack.rssSigma.toFixed(4)} mm</td></tr>
<tr><td>MC μ ± σ</td><td>${out.tolStack.mcMean.toFixed(3)} ± ${out.tolStack.mcStddev.toFixed(4)} mm</td></tr>
<tr><td>Cp / Cpk</td><td><span class="metric ${out.tolStack.mcCpk > 1.33 ? 'good' : 'warn'}">${out.tolStack.mcCp.toFixed(2)} / ${out.tolStack.mcCpk.toFixed(2)}</span></td></tr>
<tr><td>Defects per million</td><td><span class="metric ${out.tolStack.ppm < 1000 ? 'good' : (out.tolStack.ppm < 100000 ? 'warn' : 'bad')}">${out.tolStack.ppm.toFixed(0)}</span></td></tr>
</table>

<h2>10. Feature recognition (CAM-friendly classification)</h2>
<table>
<tr><td>Planar patches</td><td>${out.features.planar}</td></tr>
<tr><td>Cylindrical patches</td><td>${out.features.cylindrical}</td></tr>
<tr><td>Freeform patches</td><td>${out.features.freeform}</td></tr>
<tr><td>Cylinder diameters (mm)</td><td>${out.features.cylinderDiameters.map(d => d.toFixed(2)).join(' · ')}</td></tr>
</table>

<h2>11. Mesh repair round-trip</h2>
<table>
<tr><td>Surface mesh manifold?</td><td>${out.repair.before.isManifold ? '<span class="metric good">YES</span>' : '<span class="metric bad">no</span>'}</td></tr>
<tr><td>Operations applied</td><td>${out.repair.operations.length === 0 ? 'none (already clean)' : out.repair.operations.map(o => `<code>${o.op}</code>`).join(', ')}</td></tr>
<tr><td>After repair</td><td>${out.repair.after.triangles} tris, ${out.repair.after.boundaryEdges} boundary edges, ${out.repair.after.nonManifoldEdges} non-manifold</td></tr>
</table>

<div style="color:#888;font-size:12px;margin-top:32px">
This report is the output of one Playwright spec
(<code>e2e/foundation-capstone-lifecycle.spec.js</code>) that drives one
real part through 11 of the 24 foundation modules in sequence. Every
number is from the live solver run, not a curated value.
</div>
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'capstone-report.html'), html);
  fs.writeFileSync(path.join(ROOT, 'capstone-data.json'), JSON.stringify({
    log: out.log,
    static: out.static,
    modal: out.modal,
    thermal: out.thermal,
    thermomech: out.thermomech,
    simp: out.simp,
    tolStack: out.tolStack,
    features: out.features,
    repair: out.repair,
    meshStats: out.meshStats,
    printReport: out.printReport,
  }, null, 2));

  expect(out.static.maxStressMPa).toBeGreaterThan(0);
  expect(out.modal.firstFreqHz).toBeGreaterThan(0);
  expect(out.thermal.Tmax).toBeCloseTo(90, 1);
  expect(out.simp.finalVolFrac).toBeGreaterThan(0.2);
});
