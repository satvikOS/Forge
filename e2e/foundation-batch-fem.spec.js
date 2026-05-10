import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'fem');
const REPORT_ROOT = path.join(ROOT, 'reports');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

const ALUM = { name: 'Aluminum 6061-T6', E: 68900, nu: 0.33, density: 2.70e-6, yieldStrength: 276 };
const PETG = { name: 'PETG (3D-print)',  E: 2050,  nu: 0.40, density: 1.27e-6, yieldStrength: 50 };

/**
 * Run static FEM (cantilever-like loading) + lowest natural frequency
 * for every M8 demonstrator part. Emit one HTML report per part bundling
 * geometry + mesh + load case + results.
 */
test('Batch static FEM + modal on all M8 demonstrator parts', async ({ page }) => {
  ensure(REPORT_ROOT);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });

  const result = await page.evaluate(async (mat) => {
    const { TetMesh } = await import('/src/foundation/TetMesh.js');
    const { solveLinearStatic } = await import('/src/foundation/LinearTetFEM.js');
    const { lowestNaturalFrequency } = await import('/src/foundation/ModalAnalysis.js');
    const { buildPhoneStandBracket } = await import('/src/foundation/parts/PhoneStandBracket.js');
    const { buildBottleCap, buildBottleNeck } = await import('/src/foundation/parts/ThreadedBottleCap.js');
    const { buildLeafA, buildLeafB, buildHingePin } = await import('/src/foundation/parts/HingedBracketPair.js');
    const { buildPlanetary } = await import('/src/foundation/parts/PlanetaryGearset.js');
    const { buildEnclosureBase, buildEnclosureLid } = await import('/src/foundation/parts/SealedEnclosure.js');

    const planetary = await buildPlanetary();
    const parts = [
      // BCs use bbox-relative predicates so they adapt across mesh densities.
      // Each part picks a cellSize sized to give 200-3000 tets (good
      // FEM signal-to-noise + reasonable solve times).
      { basename: 'phone-stand-bracket', name: 'Phone-Stand Bracket', mfd: await buildPhoneStandBracket(),
        cellSize: 4, loadCase: 'gravity 50N at lip',
        loadFn: (m) => {
          // Fix the entire bottom face of the base plate (z ≤ 0.5)
          const fixed = m.selectNodes(([x, y, z]) => z <= 0.5);
          // Load on the lip (built at z 4..12, y 6..10)
          const loaded = m.selectNodes(([x, y, z]) => z > 7 && y > 4 && y < 12);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 1, value: -50 / loaded.length })) };
        }},
      { basename: 'bottle-cap-m28x2', name: 'Bottle Cap M28x2', mfd: await buildBottleCap(),
        cellSize: 3, loadCase: '20N axial torque equivalent',
        loadFn: (m) => {
          const fixed = m.selectNodes(([x, y, z]) => z < 1);
          const loaded = m.selectNodes(([x, y, z]) => z > 16);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 0, value: -20 / loaded.length })) };
        }},
      { basename: 'hinge-leaf-A', name: 'Hinge Leaf A', mfd: await buildLeafA(),
        cellSize: 3, loadCase: '10N at knuckle',
        loadFn: (m) => {
          const fixed = m.selectNodes(([x]) => x < 1);
          const loaded = m.selectNodes(([x]) => x > 48);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 2, value: -10 / loaded.length })) };
        }},
      { basename: 'hinge-pin', name: 'Hinge Pin Ø5.8', mfd: await buildHingePin(),
        cellSize: 1.5, loadCase: '5N shear in middle',
        loadFn: (m) => {
          const bbox = m.metadata.bbox;
          const zmin = bbox.min[2], zmax = bbox.max[2];
          const fixed = m.selectNodes(([x, y, z]) => z < zmin + 3);
          const loaded = m.selectNodes(([x, y, z]) => Math.abs(z) < 2);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 0, value: -5 / loaded.length })) };
        }},
      { basename: 'gear-sun-z12', name: 'Planetary Sun Gear Z=12', mfd: planetary.sun,
        cellSize: 1.0, loadCase: '8N tangential at tooth',
        loadFn: (m) => {
          // Bore + bottom face fixed
          const fixed = m.selectNodes(([x, y, z]) => Math.hypot(x, y) < 3 || z < 1);
          const loaded = m.selectNodes(([x, y, z]) => Math.hypot(x, y) > 5.5);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 1, value: -8 / loaded.length })) };
        }},
      { basename: 'gear-planet-z18', name: 'Planetary Planet Gear Z=18', mfd: planetary.planet,
        cellSize: 1.5, loadCase: '12N tangential at tooth',
        loadFn: (m) => {
          const fixed = m.selectNodes(([x, y, z]) => Math.hypot(x, y) < 2.5 || z < 1);
          const loaded = m.selectNodes(([x, y, z]) => Math.hypot(x, y) > 7.5);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 1, value: -12 / loaded.length })) };
        }},
      { basename: 'enclosure-base', name: 'Sealed Enclosure Base', mfd: await buildEnclosureBase(),
        cellSize: 4, loadCase: '15N down on PCB area',
        loadFn: (m) => {
          const fixed = m.selectNodes(([x, y, z]) => z < 1);
          const loaded = m.selectNodes(([x, y, z]) => z > 10 && z < 14 && x > 18 && x < 82 && y > 12 && y < 48);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 2, value: -15 / loaded.length })) };
        }},
      { basename: 'enclosure-lid', name: 'Sealed Enclosure Lid', mfd: await buildEnclosureLid(),
        cellSize: 4, loadCase: '20N down centered',
        loadFn: (m) => {
          const fixed = m.selectNodes(([x, y, z]) => z < 0.5 && (x < 12 || x > 88) && (y < 12 || y > 48));
          const loaded = m.selectNodes(([x, y, z]) => z > 4 && Math.abs(x - 50) < 15 && Math.abs(y - 30) < 8);
          return { fixed, loads: loaded.map(n => ({ node: n, dof: 2, value: -20 / loaded.length })) };
        }},
    ];

    const out = [];
    for (const p of parts) {
      const t0 = performance.now();
      let mesh;
      try {
        mesh = await TetMesh.fromManifold(p.mfd, { cellSize: p.cellSize ?? 4 });
      } catch (e) {
        out.push({ basename: p.basename, name: p.name, error: `voxelize: ${e.message}` });
        continue;
      }
      const meshSec = (performance.now() - t0) / 1000;

      const { fixed, loads } = p.loadFn(mesh);
      if (fixed.length === 0 || loads.length === 0) {
        out.push({ basename: p.basename, name: p.name, error: 'BC selection produced empty sets',
                   meshStats: mesh.stats() });
        continue;
      }

      const t1 = performance.now();
      let fem, modal;
      try {
        fem = solveLinearStatic({ mesh, material: mat, fixedNodes: fixed, loads });
      } catch (e) {
        out.push({ basename: p.basename, name: p.name, error: `static: ${e.message}` });
        continue;
      }
      const femSec = (performance.now() - t1) / 1000;

      const t2 = performance.now();
      try {
        modal = lowestNaturalFrequency({ mesh, material: mat, fixedNodes: fixed, maxIter: 30 });
      } catch (e) {
        modal = { freqHz: null, error: e.message };
      }
      const modalSec = (performance.now() - t2) / 1000;

      out.push({
        basename: p.basename, name: p.name,
        meshStats: mesh.stats(),
        loadCase: p.loadCase,
        boundaryConditions: { fixedNodes: fixed.length, loadNodes: loads.length, totalForceN: loads.reduce((s, l) => s + l.value, 0) },
        timing: { voxelize: +meshSec.toFixed(3), static: +femSec.toFixed(3), modal: +modalSec.toFixed(3) },
        static: {
          maxDisplacementMm: fem.maxDisplacement,
          maxVonMisesMPa: fem.maxStress,
          safetyFactor: fem.safetyFactor,
          cgIterations: fem.cgIterations,
          cgResidual: fem.cgResidual,
        },
        modal: modal && modal.freqHz != null ? {
          // Apply unit fix: ω in mm-system × sqrt(1000) = ω in SI
          firstNaturalFrequencyHz: modal.freqHz * Math.sqrt(1000),
          iterations: modal.iterations,
          converged: modal.converged,
        } : modal,
      });
    }
    return out;
  }, ALUM);

  console.log(`\n=== BATCH FEM + MODAL ===`);
  for (const r of result) {
    if (r.error) {
      console.log(`✗ ${r.name}: ${r.error}`);
      continue;
    }
    console.log(`✓ ${r.name}`);
    console.log(`    Mesh: ${r.meshStats.tetCount} tets / ${r.meshStats.vertexCount} nodes  (vox ${r.timing.voxelize}s)`);
    console.log(`    Load: ${r.loadCase}, ${r.boundaryConditions.fixedNodes} fixed nodes, ${Math.abs(r.boundaryConditions.totalForceN).toFixed(1)} N`);
    console.log(`    σ_max: ${r.static.maxVonMisesMPa.toFixed(2)} MPa, SF=${r.static.safetyFactor?.toFixed(1)}, δ_max: ${r.static.maxDisplacementMm.toFixed(4)} mm  (cg ${r.static.cgIterations}/${r.timing.static}s)`);
    if (r.modal && r.modal.firstNaturalFrequencyHz != null) {
      console.log(`    f₁: ${r.modal.firstNaturalFrequencyHz.toFixed(1)} Hz  (modal ${r.timing.modal}s)`);
    }
  }

  // Save individual JSON + an aggregate summary
  for (const r of result) {
    fs.writeFileSync(path.join(REPORT_ROOT, `${r.basename}.json`), JSON.stringify(r, null, 2));
  }
  fs.writeFileSync(path.join(ROOT, 'batch-summary.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    material: ALUM,
    parts: result.length,
    successes: result.filter(r => !r.error).length,
    failures: result.filter(r => r.error).length,
    results: result,
  }, null, 2));

  // Build an HTML index
  const rows = result.map(r => {
    if (r.error) return `<tr><td>${r.name}</td><td colspan="6" style="color:#a00">${r.error}</td></tr>`;
    return `<tr>
      <td>${r.name}</td>
      <td>${r.meshStats.tetCount}</td>
      <td>${r.static.maxVonMisesMPa.toFixed(2)}</td>
      <td>${r.static.safetyFactor != null ? r.static.safetyFactor.toFixed(1) : '—'}</td>
      <td>${r.static.maxDisplacementMm.toFixed(4)}</td>
      <td>${r.modal && r.modal.firstNaturalFrequencyHz != null ? r.modal.firstNaturalFrequencyHz.toFixed(1) : '—'}</td>
      <td>${r.timing.voxelize}+${r.timing.static}+${r.timing.modal}s</td>
    </tr>`;
  }).join('\n');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Foundation FEM + Modal — Batch Report</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;max-width:1100px;color:#1a1a1a}h1{font-size:24px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e1e4e8}
th{background:#f6f8fa;font-weight:600}.subtitle{color:#666;font-size:14px;margin-bottom:24px}</style></head>
<body><h1>Foundation FEM + Modal — Batch Report</h1>
<div class="subtitle">${result.length} parts · ${ALUM.name} (E=${ALUM.E} MPa, ν=${ALUM.nu}, ρ=${ALUM.density} kg/mm³, yield ${ALUM.yieldStrength} MPa) ·
generated ${new Date().toISOString().slice(0,10)}</div>
<table><thead><tr><th>Part</th><th>Tets</th><th>σ_vm max (MPa)</th><th>SF</th><th>δ max (mm)</th><th>f₁ (Hz)</th><th>Time</th></tr></thead>
<tbody>${rows}</tbody></table>
<div style="color:#888;font-size:12px;margin-top:24px">
Each part voxelized via point-in-mesh raycast (cell ≈ 4 mm), tet-meshed via Kuhn decomposition, solved with linear-tet FEM
+ Jacobi-PCG, modal via inverse iteration on K φ = ω² M φ. Linear tets are bending-stiff: static δ under-predicts and modal f
over-predicts the analytical answer by 5–25 % at this mesh density.
</div></body></html>`;
  fs.writeFileSync(path.join(ROOT, 'batch-report.html'), html);

  expect(result.filter(r => !r.error).length).toBeGreaterThanOrEqual(6);
});
