import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(1200000);

test('GE9X: full lifecycle — build, render, test, validate, export', async ({ page }) => {
  ensure(OUT);
  ensure(path.join(OUT, 'screenshots'));
  ensure(path.join(OUT, 'analysis'));
  ensure(path.join(OUT, 'tests'));
  ensure(path.join(OUT, 'project'));
  ensure(path.join(OUT, 'session'));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);

  console.log('\n========================================');
  console.log('  GE9X FULL LIFECYCLE');
  console.log('========================================\n');

  // -----------------------------------------------------------------------
  // PHASE 1: Build engine + render + run test campaign
  // -----------------------------------------------------------------------
  const phase1 = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, InteractionRecorder, AssemblyBridge,
      RealWorldTestRunner, FocusController,
    } = m;
    const GE9XBuilder = builderMod.default;
    const { GE9X_SPECS } = builderMod;
    const THREE = await import('/node_modules/.vite/deps/three.js');

    PartIDRegistry.reset();
    InteractionRecorder.reset();
    InteractionRecorder.start({ project: 'GE9X', user: 'satvik' });

    // Build
    const tBuild = performance.now();
    const ge9x = GE9XBuilder.build();
    const buildTimeSec = (performance.now() - tBuild) / 1000;
    InteractionRecorder.recordToolInvoke('GE9XBuilder.build', { totalParts: ge9x.partCount() });

    // Render
    const tRender = performance.now();
    const root = AssemblyBridge.renderAssembly(ge9x, window.__three_scene, {
      instanceThreshold: 5,
    });
    const renderTimeSec = (performance.now() - tRender) / 1000;

    // Camera framing
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const dist = Math.max(size.x, size.y, size.z) * 1.6;
    window.__three_camera.position.set(
      center.x + dist * 1.0,
      center.y + dist * 0.4,
      center.z + dist * 0.3
    );
    window.__three_camera.lookAt(center);
    window.__three_camera.near = 0.001;
    window.__three_camera.far = dist * 20;
    window.__three_camera.updateProjectionMatrix();
    InteractionRecorder.recordCamera(window.__three_camera);
    if (window.__three_renderer) {
      window.__three_renderer.render(window.__three_scene, window.__three_camera);
    }

    // Real-world test campaign on critical components
    const tCampaign = performance.now();
    const campaign = await RealWorldTestRunner.runCampaign({
      scenarios: ['bird_strike', 'fod_ingestion', 'rotor_overspeed', 'fatigue_hcf', 'thermal_cycle'],
      filter: e => ['BLD', 'DSK'].includes(e.subsystem) && ['FAN', 'HPT', 'LPT'].includes(e.category),
      maxParts: 8,
    });
    const campaignTimeSec = (performance.now() - tCampaign) / 1000;

    // Stats
    const stats = PartIDRegistry.stats();

    return {
      partCount: ge9x.partCount(),
      registered: PartIDRegistry.size(),
      buildTimeSec: +buildTimeSec.toFixed(2),
      renderTimeSec: +renderTimeSec.toFixed(2),
      campaignTimeSec: +campaignTimeSec.toFixed(2),
      campaignTotalRuns: campaign.totalRuns,
      campaignPass: campaign.pass,
      campaignMarginal: campaign.marginal,
      campaignFail: campaign.fail,
      campaignError: campaign.error,
      campaignPassRate: +(campaign.passRate * 100).toFixed(1),
      campaignSample: campaign.results.slice(0, 5),
      stats,
      specs: GE9X_SPECS,
      box: { min: box.min.toArray(), max: box.max.toArray(), center: center.toArray() },
      sceneSize: { x: size.x, y: size.y, z: size.z },
    };
  });

  console.log(`Components built: ${phase1.partCount.toLocaleString()}`);
  console.log(`Build time: ${phase1.buildTimeSec}s | Render setup: ${phase1.renderTimeSec}s`);
  console.log(`Test campaign: ${phase1.campaignTotalRuns} runs in ${phase1.campaignTimeSec}s`);
  console.log(`  PASS: ${phase1.campaignPass}, MARGINAL: ${phase1.campaignMarginal}, FAIL: ${phase1.campaignFail}, ERROR: ${phase1.campaignError}`);
  console.log(`  Pass rate: ${phase1.campaignPassRate}%`);
  console.log(`Engine bounding box: x=${phase1.sceneSize.x.toFixed(2)}m, y=${phase1.sceneSize.y.toFixed(2)}m, z=${phase1.sceneSize.z.toFixed(2)}m`);

  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'screenshots', 'engine-overview.png'), fullPage: true });
  console.log('  ✓ Saved engine-overview.png');

  // -----------------------------------------------------------------------
  // PHASE 2: Cutaway rendering — section view
  // -----------------------------------------------------------------------
  await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer, InteractionRecorder } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'axial-half',
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(0, 0, 2.5),
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
    InteractionRecorder.recordToolInvoke('CutawayRenderer.apply', { mode: 'axial-half' });
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'screenshots', 'engine-cutaway-half.png'), fullPage: true });
  console.log('  ✓ Saved engine-cutaway-half.png');

  // Quadrant cut
  await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer } = m;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);
    CutawayRenderer.apply(window.__three_scene, window.__three_renderer, {
      mode: 'quadrant',
      axis: new THREE.Vector3(0, 0, 1),
      center: new THREE.Vector3(0, 0, 2.5),
      angleDeg: 90,
    });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'screenshots', 'engine-cutaway-quadrant.png'), fullPage: true });
  console.log('  ✓ Saved engine-cutaway-quadrant.png');

  // -----------------------------------------------------------------------
  // PHASE 3: Focus on a single fan blade — demonstrate panel click behavior
  // -----------------------------------------------------------------------
  const focusResult = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { CutawayRenderer, FocusController, PartIDRegistry, InteractionRecorder } = m;
    CutawayRenderer.restore(window.__three_scene, window.__three_renderer);

    // Find a fan blade
    const fanBlades = PartIDRegistry.bySubsystem('BLD').filter(e => e.category === 'FAN');
    const target = fanBlades[0];
    if (!target) return { error: 'No fan blades found' };

    InteractionRecorder.recordSelect(target.partID, 'panel');
    const r = FocusController.focusByPartID(target.partID,
      window.__three_scene, window.__three_camera, null,
      { dimOpacity: 0.04 });
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
    return { partID: target.partID, name: target.name, focused: !!r };
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'screenshots', 'focus-fan-blade.png'), fullPage: true });
  console.log(`  ✓ Focused on ${focusResult.partID} → ${focusResult.name}`);

  // Restore for final overview
  await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { FocusController } = m;
    FocusController.clearFocus(window.__three_scene);
    window.__three_renderer.render(window.__three_scene, window.__three_camera);
  });

  // -----------------------------------------------------------------------
  // PHASE 4: Cross-validation against published GE9X specs
  // -----------------------------------------------------------------------
  const validation = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { PartIDRegistry, InteractionRecorder } = m;
    const fanBlades = PartIDRegistry.bySubsystem('BLD').filter(e => e.category === 'FAN').length;
    const hpcStages = new Set(PartIDRegistry.bySubsystem('BLD')
      .filter(e => e.category === 'HPC').map(e => e.metadata.stage)).size;
    const lpcStages = new Set(PartIDRegistry.bySubsystem('BLD')
      .filter(e => e.category === 'LPC').map(e => e.metadata.stage)).size;
    const hptStages = new Set(PartIDRegistry.bySubsystem('BLD')
      .filter(e => e.category === 'HPT').map(e => e.metadata.stage)).size;
    const lptStages = new Set(PartIDRegistry.bySubsystem('BLD')
      .filter(e => e.category === 'LPT').map(e => e.metadata.stage)).size;
    const fuelNozzles = PartIDRegistry.bySubsystem('SWR').length;

    const checks = [
      { name: 'Fan blade count', expected: 16, actual: fanBlades },
      { name: 'LPC (booster) stages', expected: 3, actual: lpcStages },
      { name: 'HPC stages', expected: 11, actual: hpcStages },
      { name: 'HPT stages', expected: 2, actual: hptStages },
      { name: 'LPT stages', expected: 6, actual: lptStages },
      { name: 'TAPS swirler-injectors', expected: 30, actual: fuelNozzles },
    ];
    for (const c of checks) {
      InteractionRecorder.record('validation.check', c);
    }
    return checks;
  });

  console.log('\nCross-validation against published GE9X specs:');
  for (const c of validation) {
    const ok = c.actual === c.expected;
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}  ${c.name.padEnd(30)} expected=${c.expected}, actual=${c.actual}`);
  }

  // -----------------------------------------------------------------------
  // PHASE 5: Export full project to engine-output/GE9X/project/
  // -----------------------------------------------------------------------
  const exportResult = await page.evaluate(async () => {
    const m = await import('/src/kernel/index.js');
    const { ProjectExporter, InteractionRecorder } = m;
    const tree = ProjectExporter.buildFileTree({ includeGeometry: false });
    InteractionRecorder.recordExport('json+csv', 'engine-output/GE9X/project', {
      filesGenerated: tree.files.size,
    });
    // Convert Map to array for return
    const files = [];
    for (const [p, c] of tree.files) {
      files.push({ path: p, isString: typeof c === 'string', size: typeof c === 'string' ? c.length : (c.byteLength || 0) });
    }
    return {
      manifest: tree.manifest,
      stats: tree.stats,
      filesCount: tree.files.size,
      sampleFiles: files.slice(0, 30).map(f => f.path),
      // Get actual content for top-level files
      manifestJson: tree.files.get('manifest.json'),
      hierarchyJson: tree.files.get('hierarchy.json'),
      bomJson: tree.files.get('bom.json'),
      bomCsv: tree.files.get('bom.csv'),
      statsJson: tree.files.get('stats.json'),
      analysesJson: tree.files.get('analyses.json'),
      testsJson: tree.files.get('tests.json'),
      interactionsJsonl: tree.files.get('interactions.jsonl'),
    };
  });

  fs.writeFileSync(path.join(OUT, 'project', 'manifest.json'), exportResult.manifestJson);
  fs.writeFileSync(path.join(OUT, 'project', 'hierarchy.json'), exportResult.hierarchyJson);
  fs.writeFileSync(path.join(OUT, 'project', 'bom.json'), exportResult.bomJson);
  fs.writeFileSync(path.join(OUT, 'project', 'bom.csv'), exportResult.bomCsv);
  fs.writeFileSync(path.join(OUT, 'project', 'stats.json'), exportResult.statsJson);
  fs.writeFileSync(path.join(OUT, 'project', 'analyses.json'), exportResult.analysesJson);
  fs.writeFileSync(path.join(OUT, 'project', 'tests.json'), exportResult.testsJson);
  if (exportResult.interactionsJsonl) {
    fs.writeFileSync(path.join(OUT, 'session', 'interactions.jsonl'), exportResult.interactionsJsonl);
  }

  // Save validation report
  const validationReport = `GE9X CROSS-VALIDATION REPORT
============================
Generated: ${new Date().toISOString()}
Engine: GE Aviation GE9X-105B1A
Total components: ${phase1.partCount.toLocaleString()}

DIMENSIONAL & ARCHITECTURAL CHECKS
${validation.map(c => `  ${c.actual === c.expected ? '✓ PASS' : '✗ FAIL'}  ${c.name.padEnd(30)} expected=${c.expected}, actual=${c.actual}`).join('\n')}

REAL-WORLD TEST CAMPAIGN
  Total runs: ${phase1.campaignTotalRuns}
  PASS: ${phase1.campaignPass} (${phase1.campaignPassRate}%)
  MARGINAL: ${phase1.campaignMarginal}
  FAIL: ${phase1.campaignFail}
  ERROR: ${phase1.campaignError}

CATEGORY BREAKDOWN
${Object.entries(phase1.stats.byCategory).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`  ${k.padEnd(8)} ${v.toLocaleString().padStart(8)}`).join('\n')}

FILES EMITTED
  Total: ${exportResult.filesCount}
  Hierarchy depth: tree spans all categories
  Per-component metadata: parts/<CAT>/<SUB>/<ID>.json
  Test results: tests.json (aggregated)
  Analyses: analyses.json (aggregated)
  Session log: interactions.jsonl
  BOM: bom.csv + bom.json
`;
  fs.writeFileSync(path.join(OUT, 'VALIDATION_REPORT.txt'), validationReport);

  console.log(`\nFiles exported: ${exportResult.filesCount}`);
  console.log(`Validation report: ${path.join(OUT, 'VALIDATION_REPORT.txt')}`);
  console.log(`Project files: ${path.join(OUT, 'project')}`);
  console.log(`Screenshots: ${path.join(OUT, 'screenshots')}`);
  console.log('\nDone.');

  expect(phase1.partCount).toBeGreaterThan(20000);
  expect(phase1.registered).toBe(phase1.partCount);
  expect(focusResult.focused).toBe(true);
  expect(validation.find(v => v.name === 'Fan blade count')?.actual).toBe(16);
  expect(validation.find(v => v.name === 'HPC stages')?.actual).toBe(11);
});
