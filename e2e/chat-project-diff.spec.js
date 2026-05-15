import { test, expect } from '@playwright/test';

test.describe('Project diff comparison', () => {
  test.describe.configure({ timeout: 400000 });

  test('Run two projects, compare verdicts side-by-side', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
      localStorage.removeItem('archdisc.planTemplates');
      localStorage.removeItem('archdisc.session');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Helper: load a builtin template, run it, finish at "done".
    const runTemplate = async (labelMatch) => {
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

    // Project 1 — turbofan (engine domain, 13 steps).
    await panel.locator('[data-field="chat-input"]').fill('seed');  // ensure a project exists
    await panel.locator('[data-action="send"]').click();
    await page.waitForTimeout(500);
    await runTemplate('Turbofan engine');
    await panel.locator('[data-project-name]').dblclick();
    await panel.locator('[data-field="project-name"]').fill('Engine Variant');
    await panel.locator('[data-field="project-name"]').press('Enter');
    await page.waitForTimeout(500);

    // Project 2 — bracket (structure domain, 6 steps).
    await panel.locator('[data-action="new-project"]').click();
    await page.waitForTimeout(500);
    await runTemplate('Structural bracket');
    await panel.locator('[data-project-name]').dblclick();
    await panel.locator('[data-field="project-name"]').fill('Bracket Variant');
    await panel.locator('[data-field="project-name"]').press('Enter');
    await page.waitForTimeout(500);

    // Compare the active project (Bracket) against Engine Variant.
    const compareOpts = await panel.locator('[data-field="compare-project"] option').allTextContents();
    console.log(`\nCompare options: ${JSON.stringify(compareOpts)}`);
    expect(compareOpts).toContain('Engine Variant');
    await panel.locator('[data-field="compare-project"]').selectOption({ label: 'Engine Variant' });
    await page.waitForTimeout(800);

    // Diff table renders
    const diff = panel.locator('[data-diff-table]');
    await expect(diff).toBeVisible();
    // Column A is the active project (Bracket), B is Engine Variant
    const colA = await diff.locator('[data-diff-col-a]').textContent();
    const colB = await diff.locator('[data-diff-col-b]').textContent();
    console.log(`Diff columns: A="${colA}" B="${colB}"`);
    expect(colA).toBe('Bracket Variant');
    expect(colB).toBe('Engine Variant');

    // Domain row: structure vs engine
    const domainRow = diff.locator('[data-diff-row="domain"] td');
    const domainCells = await domainRow.allTextContents();
    console.log(`Domain row: ${JSON.stringify(domainCells)}`);
    expect(domainCells[1]).toBe('structure');
    expect(domainCells[2]).toBe('engine');

    // Plan-steps row: bracket 6 vs engine 13, delta +7
    const planRow = diff.locator('[data-diff-row="planSteps"] td');
    const planCells = await planRow.allTextContents();
    console.log(`Plan steps row: ${JSON.stringify(planCells)}`);
    expect(planCells[1]).toBe('6');
    expect(planCells[2]).toBe('13');
    expect(planCells[3]).toBe('+7');

    // Cost-total row exists and has numeric values for both.
    const costRow = diff.locator('[data-diff-row="costTotal"] td');
    const costCells = await costRow.allTextContents();
    console.log(`Cost total row: ${JSON.stringify(costCells)}`);
    expect(parseFloat(costCells[1])).toBeGreaterThan(0);
    expect(parseFloat(costCells[2])).toBeGreaterThan(0);

    // At least one cell carries the "win" highlight class.
    const winCount = await diff.locator('.chat-diff-win').count();
    console.log(`Win-highlighted cells: ${winCount}`);
    expect(winCount).toBeGreaterThan(0);

    // Close the diff — dispatchEvent since the button sits inside the
    // scrollable transcript and a real click can be intercepted.
    await diff.locator('[data-action="diff-close"]').dispatchEvent('click');
    await expect(diff).not.toBeVisible();
  });
});
