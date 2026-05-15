import { test, expect } from '@playwright/test';

test.describe('Chat session persistence across reload', () => {
  test.describe.configure({ timeout: 240000 });

  test('Run a plan, reload the page, chat panel re-hydrates with cert+DFM+cost', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Open chat, run the canonical plan with defaults.
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
    await panel.locator('[data-action="run-plan"]').click();
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'done',
      null, { timeout: 240000 },
    );

    // Capture pre-reload state for comparison
    const preCertStats = await panel.locator('.chat-cert-stats').textContent();
    const preDfmStats  = await panel.locator('.chat-dfm-stats').textContent();
    const preCostStats = await panel.locator('.chat-cost-stats').textContent();
    const preMsgs = await panel.locator('.chat-msg').count();
    const prePlanSteps = await panel.locator('.chat-plan-step').count();
    console.log(`\nPre-reload: ${preMsgs} messages, ${prePlanSteps} plan steps`);
    console.log(`           cert "${preCertStats}", dfm "${preDfmStats}", cost "${preCostStats}"`);

    // 2. Hard reload — like the user closing + reopening the browser.
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 3. Re-open the chat panel — state should re-hydrate from localStorage.
    await page.locator('[data-action="open-chat"]').click();
    const panel2 = page.locator('.chat-panel');
    await expect(panel2).toBeVisible({ timeout: 5000 });

    // Restored pill in the header
    await expect(panel2.locator('[data-restored]')).toBeVisible();
    await expect(panel2.locator('.chat-phase')).toHaveText('done');

    // Same chat history + plan
    const postMsgs = await panel2.locator('.chat-msg').count();
    const postPlanSteps = await panel2.locator('.chat-plan-step').count();
    console.log(`Post-reload: ${postMsgs} messages, ${postPlanSteps} plan steps`);
    expect(postMsgs).toBe(preMsgs);
    expect(postPlanSteps).toBe(prePlanSteps);

    // Same cert/DFM/cost banners
    const postCertStats = await panel2.locator('.chat-cert-stats').textContent();
    const postDfmStats  = await panel2.locator('.chat-dfm-stats').textContent();
    const postCostStats = await panel2.locator('.chat-cost-stats').textContent();
    expect(postCertStats).toBe(preCertStats);
    expect(postDfmStats).toBe(preDfmStats);
    expect(postCostStats).toBe(preCostStats);
    console.log(`Post banners: cert "${postCertStats}", dfm "${postDfmStats}", cost "${postCostStats}"`);

    // 4. Reset clears localStorage so the next reload starts blank.
    await panel2.locator('.chat-reset-btn').click();
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => localStorage.getItem('archdisc.session'));
    expect(stored).toBe(null);

    // Re-open → fresh idle state, no restored pill
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-action="open-chat"]').click();
    const panel3 = page.locator('.chat-panel');
    await expect(panel3).toBeVisible({ timeout: 5000 });
    await expect(panel3.locator('.chat-phase')).toHaveText('idle');
    await expect(panel3.locator('[data-restored]')).toHaveCount(0);
  });
});
