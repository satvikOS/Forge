import { test, expect } from '@playwright/test';

test.describe('Assembly Cost panel — multi-body rollup', () => {
  test.describe.configure({ timeout: 180000 });

  test('Two bodies in registry → assembly cost lists both + grand totals', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Build two bodies via the Part tab.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.locator('.ribbon-tool-label', { hasText: /^Revolve Boss$/ }).first().click();
    await page.waitForTimeout(2500);

    // 2. Manufacture → Assembly Cost
    await page.locator('.ribbon-tab', { hasText: 'Manufacture' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Assembly Cost$/ }).first().click();

    const dlg = page.locator('.acp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });
    await expect(dlg.locator('.acp-title')).toContainText('2 parts');

    // 3. Per-body line items (2 + 1 totals row)
    const rows = dlg.locator('[data-acp-table] tbody tr');
    const rowCount = await rows.count();
    expect(rowCount).toBe(3);  // 2 parts + 1 total

    // Read each row's first cell (td:nth-child(1))
    const partNames = [];
    for (let i = 0; i < rowCount; i++) {
      partNames.push((await rows.nth(i).locator('td').first().textContent())?.trim());
    }
    console.log(`\nRow first cells: ${JSON.stringify(partNames)}`);
    expect(partNames[0]).toContain('Extrude Boss');
    expect(partNames[1]).toContain('Revolve Boss');
    expect(partNames[2]).toBe('TOTAL');

    // 4. Headline totals (7 stats: Parts, Total mass, Material, CNC,
    //    Setup+Finish, Total, Sell price)
    const stats = dlg.locator('.acp-stat-value');
    await expect(stats).toHaveCount(7);
    const values = await stats.allTextContents();
    console.log(`\nAssembly totals: ${values.join(' | ')}`);
    expect(values[0]).toBe('2');                            // partCount
    expect(values[1]).toMatch(/\d+\s*g/);                    // total mass
    expect(values[5]).toMatch(/^\$\d+\.\d{2}$/);             // total cost
    expect(values[6]).toMatch(/^\$\d+\.\d{2}$/);             // sell price

    // Total cost = sum of subtotals — read the last cell of each row.
    const subtotalCells = [];
    for (let i = 0; i < rowCount; i++) {
      subtotalCells.push((await rows.nth(i).locator('td').last().textContent())?.trim() ?? '');
    }
    const part1 = parseFloat(subtotalCells[0].replace(/[^\d.]/g, ''));
    const part2 = parseFloat(subtotalCells[1].replace(/[^\d.]/g, ''));
    const total = parseFloat(subtotalCells[2].replace(/[^\d.]/g, ''));
    expect(Math.abs(part1 + part2 - total)).toBeLessThan(0.05);
    console.log(`Body subtotals: $${part1.toFixed(2)} + $${part2.toFixed(2)} = $${total.toFixed(2)}`);

    // Window slot mirrors
    const stash = await page.evaluate(() => window.__lastAssemblyCost);
    expect(stash.lineItems).toHaveLength(2);
    expect(stash.totals.partCount).toBe(2);
    expect(stash.totals.sellPrice).toBeGreaterThan(stash.totals.totalCost);

    // 5. Human dwell
    await page.waitForTimeout(5000);

    // 6. CSV export
    const [csvDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="acp-csv"]').dispatchEvent('click'),
    ]);
    const csvName = csvDl.suggestedFilename();
    console.log(`CSV download: ${csvName}`);
    expect(csvName).toMatch(/archdisc-assembly-cost-\d{4}-\d{2}-\d{2}\.csv/);
    const fs = await import('fs');
    const csv = fs.readFileSync(await csvDl.path(), 'utf8');
    expect(csv).toContain('Part,Source,Mass');
    expect(csv).toMatch(/Extrude Boss/);
    expect(csv).toMatch(/Revolve Boss/);
    expect(csv).toContain('TOTAL,');
    expect(csv).toMatch(/Sell @\d+% margin/);

    // 7. JSON export
    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="acp-json"]').dispatchEvent('click'),
    ]);
    const json = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    expect(json.lineItems).toHaveLength(2);
    expect(json.totals.totalCost).toBeCloseTo(total, 1);
  });
});
