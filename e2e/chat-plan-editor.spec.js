import { test, expect } from '@playwright/test';

test.describe('AI Chat plan editor', () => {
  test.describe.configure({ timeout: 300000 });

  test('User can reorder, delete, and add steps before Run', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Open chat + submit goal + answer all clarifications with defaults
    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });
    await panel.locator('[data-field="chat-input"]').fill('Design a small turbofan');
    await panel.locator('[data-action="send"]').click();
    let safety = 20;
    while (safety-- > 0) {
      const ph = await panel.locator('.chat-phase').textContent();
      if (ph !== 'clarifying') break;
      await panel.locator('[data-field="chat-input"]').press('Enter');
      await page.waitForTimeout(400);
    }
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'ready',
      null, { timeout: 30000 },
    );

    // Initial plan: canonical JET_ENGINE_PLAN has 13 steps
    let steps = panel.locator('.chat-plan-step');
    const initialCount = await steps.count();
    expect(initialCount).toBe(13);
    const initialTools = await steps.locator('.chat-step-tool').allTextContents();
    console.log(`\nInitial plan (${initialCount}):`);
    for (const t of initialTools) console.log(`  ${t}`);
    expect(initialTools[0]).toBe('Mission');
    expect(initialTools[1]).toBe('Brayton Cycle');

    // 1. Delete "Export STEP" — a leaf step with no downstream
    //    consumers, so the rest of the plan still runs end-to-end.
    const exportIdx = initialTools.indexOf('Export STEP');
    expect(exportIdx).toBeGreaterThanOrEqual(0);
    await steps.nth(exportIdx).locator('[data-action="step-delete"]').dispatchEvent('click');
    await page.waitForTimeout(800);
    let toolsAfterDelete = await panel.locator('.chat-plan-step .chat-step-tool').allTextContents();
    expect(toolsAfterDelete.length).toBe(12);
    expect(toolsAfterDelete).not.toContain('Export STEP');

    // 2. Move "Heat Exchanger" up one position (analysis-only, no
    //    dependency on the prior step).
    const hxIdx = toolsAfterDelete.indexOf('Heat Exchanger');
    expect(hxIdx).toBeGreaterThan(0);
    await panel.locator(`.chat-plan-step[data-step-index="${hxIdx}"] [data-action="step-up"]`)
      .dispatchEvent('click');
    await page.waitForTimeout(400);
    let toolsAfterMove = await panel.locator('.chat-plan-step .chat-step-tool').allTextContents();
    const newHxIdx = toolsAfterMove.indexOf('Heat Exchanger');
    expect(newHxIdx).toBe(hxIdx - 1);

    // 3. Add a new step at the end via the picker
    await panel.locator('[data-action="open-add-step"]').dispatchEvent('click');
    await page.waitForTimeout(400);
    const picker = panel.locator('.chat-add-picker');
    await expect(picker).toBeVisible();
    await picker.locator('.chat-add-filter').fill('Bolted');
    await page.waitForTimeout(300);
    await panel.locator('[data-add-tool="Bolted Joint"]').dispatchEvent('click');
    await page.waitForTimeout(500);
    let toolsAfterAdd = await panel.locator('.chat-plan-step .chat-step-tool').allTextContents();
    expect(toolsAfterAdd.length).toBe(13);
    expect(toolsAfterAdd[toolsAfterAdd.length - 1]).toBe('Bolted Joint');
    console.log(`\nEdited plan (${toolsAfterAdd.length}):`);
    for (const t of toolsAfterAdd) console.log(`  ${t}`);

    // 4. Click Run — confirm the edited plan executes
    await panel.locator('[data-action="run-plan"]').dispatchEvent('click');
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'done',
      null, { timeout: 240000 },
    );
    const doneCount = await panel.locator('.chat-plan-step.status-done').count();
    expect(doneCount).toBe(toolsAfterAdd.length);

    // Bolted Joint actually ran (the last step we added)
    const boltRan = await page.evaluate(() => !!window.__lastBoltResult);
    expect(boltRan).toBe(true);

    // Once running starts, edit buttons should be hidden on every step
    const editsCount = await panel.locator('.chat-step-edits').count();
    expect(editsCount).toBe(0);
  });
});
