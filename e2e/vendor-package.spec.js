import { test, expect } from '@playwright/test';
import { buildVendorPackage } from '../frontend/src/foundation/VendorPackage.js';

test.describe('Vendor Package — one-click bundled hand-off', () => {
  test.describe.configure({ timeout: 180000 });

  test('Foundation bundler produces a valid stored ZIP with expected entries', () => {
    // Synthesize a minimal manifold-like body so the bundler can run
    // without spinning up the full WASM kernel.
    const fakeManifold = synthesize({
      bbox: { min: [0, 0, 0], max: [50, 30, 20] },
      volume: 30000,
      surfaceArea: 6200,
      genus: 0,
      tris: 12,
    });
    const bodies = [{ id: 'b1', name: 'Demo Body', sourceTool: 'Extrude Boss', manifold: fakeManifold, volume_mm3: 30000 }];
    const pkg = buildVendorPackage({
      bodies,
      gcode: 'G0 X0 Y0\nG1 X50 Y30 F1500\nM30\n',
      gcodeSource: '3-Axis Milling',
      certMarkdown: '# Cert Matrix\n10/14 pass',
      // Caller-supplied pre-rasterised PDF (browser does the real one).
      drawingPdfs: [{ name: 'Demo Body', bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }],
    });

    console.log(`\nPackage files (${pkg.fileNames.length}):`);
    for (const n of pkg.fileNames) console.log(`  ${n}`);
    expect(pkg.fileNames).toContain('manifest.json');
    expect(pkg.fileNames.some(n => n.startsWith('drawings/') && n.endsWith('.svg'))).toBe(true);
    expect(pkg.fileNames.some(n => n.startsWith('drawings/') && n.endsWith('.pdf'))).toBe(true);
    expect(pkg.fileNames.some(n => n.startsWith('cam/'))).toBe(true);
    expect(pkg.fileNames).toContain('cost/cost.json');
    expect(pkg.fileNames).toContain('cost/cost.csv');
    expect(pkg.fileNames).toContain('dfm/dfm.json');
    expect(pkg.fileNames).toContain('cert/cert-matrix.md');

    // ZIP signature
    expect(pkg.zipBytes[0]).toBe(0x50);   // 'P'
    expect(pkg.zipBytes[1]).toBe(0x4b);   // 'K'
    expect(pkg.zipBytes[2]).toBe(0x03);
    expect(pkg.zipBytes[3]).toBe(0x04);

    // Manifest sanity
    expect(pkg.manifest.bodyCount).toBe(1);
    expect(pkg.manifest.totals.partCount).toBe(1);
    expect(pkg.manifest.totals.totalCost).toBeGreaterThan(0);
  });

  test('Ribbon Vendor Package downloads a non-trivial ZIP after a real run', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Create a body
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. (Optional) generate a G-code so the package includes CAM
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^3-Axis Milling$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastCAMProgram, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    // Close manufacture preview if it took over the screen
    const mppDlg = page.locator('.mpp-dialog');
    if (await mppDlg.isVisible()) {
      await mppDlg.locator('[data-action="mpp-close"]').dispatchEvent('click');
      await page.waitForTimeout(500);
    }

    // 3. Click Vendor Package and capture the download
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('.ribbon-tool-label', { hasText: /^Vendor Package$/ }).first().click(),
    ]);
    const name = dl.suggestedFilename();
    console.log(`\nVendor Package download: ${name}`);
    expect(name).toMatch(/archdisc-vendor-\d{4}-\d{2}-\d{2}\.zip/);
    const fs = await import('fs');
    const path = await dl.path();
    const zipBytes = fs.readFileSync(path);
    console.log(`ZIP size: ${(zipBytes.length / 1024).toFixed(1)} KB`);
    expect(zipBytes.length).toBeGreaterThan(2000);
    // ZIP magic
    expect(zipBytes[0]).toBe(0x50);
    expect(zipBytes[1]).toBe(0x4b);
    expect(zipBytes[2]).toBe(0x03);
    expect(zipBytes[3]).toBe(0x04);

    // Window metadata reflects the package
    const meta = await page.evaluate(() => window.__lastVendorPackage);
    console.log(`Manifest body count: ${meta.manifest.bodyCount}`);
    console.log(`Files: ${meta.fileNames.join(', ')}`);
    expect(meta.fileNames).toContain('manifest.json');
    expect(meta.fileNames.some(n => n.startsWith('cam/'))).toBe(true);  // CAM was run
    // The browser rasterised the drawing → a print-ready PDF entry.
    expect(meta.fileNames.some(n => n.startsWith('drawings/') && n.endsWith('.pdf'))).toBe(true);
    expect(meta.fileNames.some(n => n.startsWith('drawings/') && n.endsWith('.svg'))).toBe(true);
    expect(meta.sizeBytes).toBe(zipBytes.length);
  });
});

function synthesize({ bbox, volume, surfaceArea, genus, tris }) {
  return {
    boundingBox: () => bbox,
    volume: () => volume,
    surfaceArea: () => surfaceArea,
    genus: () => genus,
    getMesh: () => ({ triVerts: new Array(tris * 3).fill(0), vertProperties: [], numProp: 3 }),
  };
}
