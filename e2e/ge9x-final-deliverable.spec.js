import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.join(process.cwd(), 'engine-output', 'GE9X');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(900000);

test('GE9X final deliverable: HTML report bundling everything', async ({ page }) => {
  ensure(OUT);

  // Read existing showcase screenshots and embed as base64
  const showcaseDir = path.join(OUT, 'showcase');
  const screenshotsBase64 = {};
  if (fs.existsSync(showcaseDir)) {
    for (const f of fs.readdirSync(showcaseDir).sort()) {
      if (f.endsWith('.png')) {
        const data = fs.readFileSync(path.join(showcaseDir, f));
        screenshotsBase64[f] = `data:image/png;base64,${data.toString('base64')}`;
      }
    }
  }
  console.log(`Embedding ${Object.keys(screenshotsBase64).length} screenshots as base64`);

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async (params) => {
    const m = await import('/src/kernel/index.js');
    const builderMod = await import('/src/engines/GE9XBuilder.js');
    const {
      PartIDRegistry, InteractionRecorder, RealWorldTestRunner,
      HTMLReportBuilder,
    } = m;
    const GE9XBuilder = builderMod.default;
    const { GE9X_SPECS } = builderMod;

    PartIDRegistry.reset();
    InteractionRecorder.reset();
    InteractionRecorder.start({ project: 'GE9X', user: 'satvik' });

    // Build engine
    const ge9x = GE9XBuilder.build();

    // Run full test campaign across all blade types and key components
    const campaign = await RealWorldTestRunner.runCampaign({
      scenarios: [
        'bird_strike', 'fod_ingestion', 'rotor_overspeed',
        'fatigue_hcf', 'thermal_cycle', 'load_static',
        'drop_test', 'blade_off', 'lightning_strike',
      ],
      filter: e => ['BLD', 'DSK', 'CSG', 'HUB'].includes(e.subsystem)
        && ['FAN', 'HPT', 'LPT', 'HPC', 'LPC'].includes(e.category),
      maxParts: 12,
    });

    // Cross-validation
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

    const validation = [
      { name: 'Fan diameter (m)', expected: 3.4, actual: GE9X_SPECS.fanDia },
      { name: 'Fan blade count', expected: 16, actual: fanBlades },
      { name: 'LPC (booster) stages', expected: 3, actual: lpcStages },
      { name: 'HPC stages', expected: 11, actual: hpcStages },
      { name: 'HPT stages', expected: 2, actual: hptStages },
      { name: 'LPT stages', expected: 6, actual: lptStages },
      { name: 'TAPS swirler-injectors', expected: 30, actual: fuelNozzles },
      { name: 'Engine length (m)', expected: 5.69, actual: GE9X_SPECS.length },
      { name: 'Bypass ratio', expected: 9.9, actual: GE9X_SPECS.bypassRatio },
      { name: 'Pressure ratio (overall)', expected: 60, actual: GE9X_SPECS.pressureRatio },
    ];

    const specs = [
      { label: 'Fan diameter', value: `${GE9X_SPECS.fanDia} m (134 in)` },
      { label: 'Fan blades', value: `${GE9X_SPECS.fanBlades} composite (4th-gen woven)` },
      { label: 'Bypass ratio', value: `${GE9X_SPECS.bypassRatio}:1` },
      { label: 'Pressure ratio', value: `${GE9X_SPECS.pressureRatio}:1 (overall)` },
      { label: 'Mass flow', value: '~1361 kg/s' },
      { label: 'Thrust', value: '470 kN takeoff (105,000 lbf)' },
      { label: 'Architecture', value: '2-spool turbofan' },
      { label: 'Compressor stages', value: `${GE9X_SPECS.lpcStages} LPC + ${GE9X_SPECS.hpcStages} HPC` },
      { label: 'Combustor', value: 'TAPS III with CMC liner' },
      { label: 'Turbine stages', value: `${GE9X_SPECS.hptStages} HPT (CMC s1) + ${GE9X_SPECS.lptStages} LPT` },
      { label: 'Length', value: `${GE9X_SPECS.length} m` },
      { label: 'Application', value: 'Boeing 777X' },
    ];

    InteractionRecorder.stop();

    // Build HTML
    const html = HTMLReportBuilder.build({
      project: 'GE9X — General Electric Aviation',
      subtitle: 'Reconstructed entirely in ArchDisc · cross-validated against published specs',
      screenshots: params.screenshots,
      validation,
      specs,
    });

    return {
      partCount: ge9x.partCount(),
      registered: PartIDRegistry.size(),
      campaignTotal: campaign.totalRuns,
      campaignPass: campaign.pass,
      campaignFail: campaign.fail,
      validation,
      htmlSize: html.length,
      html,
    };
  }, { screenshots: screenshotsBase64 });

  console.log(`\nComponents: ${result.partCount.toLocaleString()}`);
  console.log(`Tests: ${result.campaignTotal} (PASS: ${result.campaignPass}, FAIL: ${result.campaignFail})`);
  console.log(`Validation: ${result.validation.filter(v => v.actual === v.expected).length}/${result.validation.length} pass`);
  console.log(`HTML report: ${(result.htmlSize / 1024).toFixed(0)} KB`);

  fs.writeFileSync(path.join(OUT, 'GE9X-Report.html'), result.html);
  console.log(`Written: ${path.join(OUT, 'GE9X-Report.html')}`);

  // Sanity check: file is valid HTML
  expect(result.html.startsWith('<!doctype html>')).toBe(true);
  expect(result.html.includes('GE9X')).toBe(true);
  expect(result.partCount).toBeGreaterThan(20000);
});
