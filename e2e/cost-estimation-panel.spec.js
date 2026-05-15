import { test, expect } from '@playwright/test';

test.describe('Cost Estimation panel', () => {
  test.describe.configure({ timeout: 180000 });

  test('Extrude Boss → Cost Estimation shows breakdown + CSV/JSON downloads', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Need a foundation body so Cost Estimation has volume/area.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);

    // 2. Manufacture → Cost Estimation
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Cost Estimation$/ }).first().click();

    const dlg = page.locator('.cep-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.cep-title')).toContainText('Cost Estimation');

    // 5 totals stats: mass, volume, cnc time, total cost, sell price
    const stats = dlg.locator('.cep-stat-value');
    await expect(stats).toHaveCount(5);
    const values = await stats.allTextContents();
    console.log(`\nCost totals: ${values.join(' | ')}`);
    expect(values[0]).toMatch(/\d+\.\d+\s*g/);          // mass
    expect(values[1]).toMatch(/\d+\.\d+\s*cm³/);         // volume
    expect(values[2]).toMatch(/\d+\.\d+\s*min/);         // cnc time
    expect(values[3]).toMatch(/^\$\d+\.\d{2}$/);         // total cost
    expect(values[4]).toMatch(/^\$\d+\.\d{2}$/);         // sell price

    // Sell price > total (margin applied)
    const total = parseFloat(values[3].replace(/[^\d.]/g, ''));
    const sell  = parseFloat(values[4].replace(/[^\d.]/g, ''));
    expect(sell).toBeGreaterThan(total);

    // 4 cost-breakdown bars (Material / CNC / Setup / Finish)
    const bars = dlg.locator('[data-cep-bars] .cep-bar-row');
    await expect(bars).toHaveCount(4);
    const barLabels = await bars.locator('.cep-bar-label').allTextContents();
    expect(barLabels).toEqual(['Material', 'CNC', 'Setup', 'Finish']);
    const barValues = await bars.locator('.cep-bar-value').allTextContents();
    console.log(`Breakdown: ${barLabels.map((l, i) => `${l} ${barValues[i]}`).join(', ')}`);
    for (const v of barValues) expect(v).toMatch(/^\$\d+\.\d{2}$/);

    // Sum of breakdown ≈ total
    const sum = barValues.reduce((s, v) => s + parseFloat(v.replace(/[^\d.]/g, '')), 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.05);

    // Human dwell
    await page.waitForTimeout(4000);

    // 3. CSV download
    const [csvDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="cep-csv"]').dispatchEvent('click'),
    ]);
    const csvName = csvDl.suggestedFilename();
    console.log(`\nCSV download: ${csvName}`);
    expect(csvName).toMatch(/archdisc-cost-\d{4}-\d{2}-\d{2}\.csv/);
    const fs = await import('fs');
    const csv = fs.readFileSync(await csvDl.path(), 'utf8');
    expect(csv).toContain('Component,Cost (USD)');
    expect(csv).toContain('Material,');
    expect(csv).toContain('Total,');

    // 4. JSON download
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="cep-json"]').dispatchEvent('click'),
    ]);
    const jsonName = jsonDl.suggestedFilename();
    console.log(`JSON download: ${jsonName}`);
    expect(jsonName).toMatch(/archdisc-cost-\d{4}-\d{2}-\d{2}\.json/);
    const json = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    expect(json.massKg).toBeGreaterThan(0);
    expect(json.totalCost).toBeGreaterThan(0);
    expect(json.materialCost + json.cncCost + json.setupCost + json.finishCost)
      .toBeCloseTo(json.totalCost, 4);

    // Close
    await dlg.locator('[data-action="cep-close"]').dispatchEvent('click');
    await expect(dlg).not.toBeVisible();
  });
});
