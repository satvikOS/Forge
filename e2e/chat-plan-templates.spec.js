import { test, expect } from '@playwright/test';

test.describe('Plan template library', () => {
  test.describe.configure({ timeout: 300000 });

  test('Load a builtin template, run it, save the plan as a new template', async ({ page }) => {
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

    // 1. Template dropdown lists the 4 builtins.
    const opts = await panel.locator('[data-field="template-load"] option').allTextContents();
    console.log(`\nTemplate options: ${JSON.stringify(opts)}`);
    expect(opts.some(o => o.includes('Turbofan engine'))).toBe(true);
    expect(opts.some(o => o.includes('Structural bracket'))).toBe(true);
    expect(opts.some(o => o.includes('Planetary gearbox'))).toBe(true);
    expect(opts.some(o => o.includes('ASME pressure vessel'))).toBe(true);

    // 2. Load the gearbox template → jumps straight to a ready plan.
    const gearboxLabel = opts.find(o => o.includes('Planetary gearbox'));
    await panel.locator('[data-field="template-load"]').selectOption({ label: gearboxLabel });
    await page.waitForTimeout(800);
    await expect(panel.locator('.chat-phase')).toHaveText('ready');
    const gearboxTools = await panel.locator('.chat-plan-step .chat-step-tool').allTextContents();
    console.log(`Gearbox template plan: ${JSON.stringify(gearboxTools)}`);
    expect(gearboxTools[0]).toBe('Gear Mesh');
    expect(gearboxTools).toContain('Shaft Sizing');
    expect(gearboxTools).toContain('Bearing Life');

    // 3. Run it through the ribbon.
    await panel.locator('[data-action="run-plan"]').click();
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'done',
      null, { timeout: 240000 },
    );
    const doneCount = await panel.locator('.chat-plan-step.status-done').count();
    expect(doneCount).toBe(gearboxTools.length);
    // Gear Mesh actually ran
    const gearRan = await page.evaluate(() => !!window.__lastGearResult);
    expect(gearRan).toBe(true);

    // 4. Save the current plan as a new template (prompt() auto-accepted).
    page.once('dialog', d => d.accept('My Gearbox Recipe'));
    await panel.locator('[data-action="save-template"]').click();
    await page.waitForTimeout(800);

    // 5. The new template appears in the dropdown.
    const optsAfter = await panel.locator('[data-field="template-load"] option').allTextContents();
    console.log(`After save: ${JSON.stringify(optsAfter)}`);
    expect(optsAfter.some(o => o.includes('My Gearbox Recipe'))).toBe(true);

    // 6. Persisted to localStorage.
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('archdisc.planTemplates') ?? '[]'));
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('My Gearbox Recipe');
    expect(stored[0].plan.length).toBe(gearboxTools.length);

    // 7. Survives reload.
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-action="open-chat"]').click();
    const panel2 = page.locator('.chat-panel');
    await expect(panel2).toBeVisible({ timeout: 5000 });
    const optsReload = await panel2.locator('[data-field="template-load"] option').allTextContents();
    expect(optsReload.some(o => o.includes('My Gearbox Recipe'))).toBe(true);
  });
});
