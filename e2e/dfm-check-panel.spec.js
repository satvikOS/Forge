import { test, expect } from '@playwright/test';
import { checkManifoldDFM } from '../frontend/src/foundation/DFMCheck.js';

test.describe('DFM Check panel + foundation rules', () => {
  test.describe.configure({ timeout: 180000 });

  test('Foundation rules trigger on representative geometries', () => {
    // 1. A thin sheet (200 × 100 × 0.5 mm). t = 2V/A = 2·10000/40100
    //    = 0.5 mm → triggers DFM-THICK error.
    const thinPlate = synthesize({
      bbox: { min: [0, 0, 0], max: [200, 100, 0.5] },
      volume: 200 * 100 * 0.5,
      surfaceArea: 2 * (200 * 100) + 2 * (200 + 100) * 0.5,
      genus: 0,
    });
    const rPlate = checkManifoldDFM(thinPlate);
    console.log(`\nThin plate: t = ${rPlate.metrics.characteristicThickness_mm.toFixed(2)} mm, aspect = ${rPlate.metrics.aspectRatio.toFixed(1)}`);
    expect(rPlate.summary.errors).toBeGreaterThanOrEqual(2);   // thickness + aspect
    expect(rPlate.issues.some(i => i.code === 'DFM-THICK' && i.severity === 'error')).toBe(true);
    expect(rPlate.issues.some(i => i.code === 'DFM-ASPECT' && i.severity === 'error')).toBe(true);

    // 2. A 30 × 30 × 30 mm cube. Bigish, square, no issues.
    const cube = synthesize({
      bbox: { min: [0, 0, 0], max: [30, 30, 30] },
      volume: 30 ** 3,
      surfaceArea: 6 * 30 * 30,
      genus: 0,
    });
    const rCube = checkManifoldDFM(cube);
    console.log(`Cube: t = ${rCube.metrics.characteristicThickness_mm.toFixed(2)} mm, aspect = ${rCube.metrics.aspectRatio.toFixed(1)}, overall = ${rCube.summary.overall}`);
    expect(rCube.summary.overall).toBe('pass');
    expect(rCube.issues).toHaveLength(0);

    // 3. A part with a through-hole (genus = 1) and 1500 cm³ volume.
    const torus = synthesize({
      bbox: { min: [-50, -50, -10], max: [50, 50, 10] },
      volume: 1.5e6,
      surfaceArea: 60000,
      genus: 1,
    });
    const rTorus = checkManifoldDFM(torus);
    console.log(`Torus-ish: genus = ${rTorus.metrics.genus}, vol = ${rTorus.metrics.volume_mm3 / 1000} cm³, infos = ${rTorus.summary.infos}`);
    expect(rTorus.issues.some(i => i.code === 'DFM-GENUS')).toBe(true);
    expect(rTorus.issues.some(i => i.code === 'DFM-HEAVY')).toBe(true);
  });

  test('Click DFM Check on a real body → panel pops with metrics + CSV/JSON', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Build a foundation body
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // Manufacture → DFM Check
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^DFM Check$/ }).first().click();

    const dlg = page.locator('.dfm-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });

    // Overall status pill
    const lightPill = dlg.locator('.dfm-header .dfm-light').first();
    const overall = (await lightPill.textContent())?.trim();
    console.log(`\nDFM overall: ${overall}`);
    expect(['PASS', 'INFO', 'WARN', 'FAIL']).toContain(overall);

    // 6 metric cards (aspect, thickness, smallest, genus, volume, mass)
    const metrics = dlg.locator('.dfm-metric-value');
    await expect(metrics).toHaveCount(6);
    const mValues = await metrics.allTextContents();
    console.log(`Metrics: ${mValues.join(' | ')}`);

    // 80 × 50 × 25 mm block: aspect ≤ 3.2, thickness ~14 mm → pass
    expect(mValues[0]).toMatch(/[1-9]\.\d{2}/);     // aspect
    expect(mValues[1]).toMatch(/\d+\.\d{2} mm/);     // thickness
    expect(mValues[2]).toMatch(/\d+\.\d{2} mm/);     // smallest dim

    // Dwell
    await page.waitForTimeout(5000);

    // CSV
    const [csvDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="dfm-csv"]').dispatchEvent('click'),
    ]);
    const csvName = csvDl.suggestedFilename();
    console.log(`CSV download: ${csvName}`);
    expect(csvName).toMatch(/archdisc-dfm-\d{4}-\d{2}-\d{2}\.csv/);
    const fs = await import('fs');
    const csv = fs.readFileSync(await csvDl.path(), 'utf8');
    expect(csv).toContain('Severity,Code,Title');

    // JSON
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="dfm-json"]').dispatchEvent('click'),
    ]);
    const json = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    expect(json.metrics.aspectRatio).toBeGreaterThan(0);
    expect(json.summary.overall).toBe(overall === 'PASS' ? 'pass' :
                                       overall === 'INFO' ? 'info' :
                                       overall === 'WARN' ? 'warn' : 'error');
  });
});

/** Build a fake manifold-like object that satisfies checkManifoldDFM's API. */
function synthesize({ bbox, volume, surfaceArea, genus }) {
  return {
    boundingBox: () => bbox,
    volume: () => volume,
    surfaceArea: () => surfaceArea,
    genus: () => genus,
  };
}
