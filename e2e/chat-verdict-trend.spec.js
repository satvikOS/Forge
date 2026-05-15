import { test, expect } from '@playwright/test';

test.describe('Verdict trend across runs', () => {
  test.describe.configure({ timeout: 400000 });

  test('Run a template twice in one project → 2-row trend table', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
      localStorage.removeItem('archdisc.planTemplates');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    const loadAndRun = async (labelMatch) => {
      const opts = await panel.locator('[data-field="template-load"] option').allTextContents();
      const label = opts.find(o => o.includes(labelMatch));
      await panel.locator('[data-field="template-load"]').selectOption({ label });
      await page.waitForTimeout(800);
      await expect(panel.locator('.chat-phase')).toHaveText('ready');
      await panel.locator('[data-action="run-plan"]').click();
      await page.waitForFunction(
        () => document.querySelector('.chat-phase')?.textContent === 'done',
        null, { timeout: 240000 },
      );
    };

    // Run 1 — bracket template.
    await loadAndRun('Structural bracket');
    // After one run there's no trend table yet (needs > 1 run).
    expect(await panel.locator('[data-trend-table]').count()).toBe(0);

    // Run 2 — gearbox template, same project (run-history preserved).
    await loadAndRun('Planetary gearbox');

    // Trend table now renders with 2 rows.
    const trend = panel.locator('[data-trend-table]');
    await expect(trend).toBeVisible();
    await expect(trend.locator('.chat-trend-head')).toContainText('2 runs');
    const rows = trend.locator('tbody tr');
    await expect(rows).toHaveCount(2);

    // Row 1 = bracket (6 steps), Row 2 = gearbox (7 steps).
    const r1 = await rows.nth(0).locator('td').allTextContents();
    const r2 = await rows.nth(1).locator('td').allTextContents();
    console.log(`\nTrend run 1: ${JSON.stringify(r1)}`);
    console.log(`Trend run 2: ${JSON.stringify(r2)}`);
    expect(r1[0]).toBe('#1');
    expect(r2[0]).toBe('#2');
    expect(r1[1]).toBe('6');     // bracket plan steps
    expect(r2[1]).toBe('7');     // gearbox plan steps
    // Cost column carries a $ value on both.
    expect(r1[4]).toMatch(/\$\d+\.\d{2}/);
    expect(r2[4]).toMatch(/\$\d+\.\d{2}/);

    // Survives a reload (persisted in the project snapshot).
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-action="open-chat"]').click();
    const panel2 = page.locator('.chat-panel');
    await expect(panel2).toBeVisible({ timeout: 5000 });
    await expect(panel2.locator('[data-trend-table] tbody tr')).toHaveCount(2);
    console.log('Trend survived reload with 2 rows');
  });
});
