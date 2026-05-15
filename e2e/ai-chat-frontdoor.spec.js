import { test, expect } from '@playwright/test';

test.describe('AI Chat front-door — full Clarifier → Planner → Run loop', () => {
  test.describe.configure({ timeout: 600000 });

  test('Type goal → answer questions (defaults) → plan appears → Run executes through ribbon', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Open the chat launcher
    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Phase: idle. Submit a goal.
    await expect(panel.locator('.chat-phase')).toHaveText('idle');
    await panel.locator('[data-field="chat-input"]').fill('Build a turbofan engine for an A350-class airliner');
    await panel.locator('[data-action="send"]').click();
    await page.waitForTimeout(1500);

    // Phase: clarifying. Domain should be detected as engine (10 questions).
    await expect(panel.locator('.chat-phase')).toHaveText('clarifying');
    // Hit Enter to accept default on every question. Loop until we leave clarifying.
    let safety = 20;
    while (safety-- > 0) {
      const phase = await panel.locator('.chat-phase').textContent();
      if (phase !== 'clarifying') break;
      await panel.locator('[data-field="chat-input"]').press('Enter');
      await page.waitForTimeout(400);
    }
    expect(safety).toBeGreaterThan(0);   // didn't loop forever

    // Phase: planning → ready. Plan list should appear with > 5 steps.
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'ready',
      null, { timeout: 30000 }
    );
    const planSteps = panel.locator('.chat-plan-step');
    const stepCount = await planSteps.count();
    console.log(`\nPlan has ${stepCount} steps`);
    expect(stepCount).toBeGreaterThanOrEqual(10);
    // Plan source should be 'fallback-canonical' since no LLM is configured
    await expect(panel.locator('.chat-plan-head')).toContainText('fallback-canonical');

    // Hit Run
    await page.waitForTimeout(3000);  // human dwell — see the plan
    await panel.locator('[data-action="run-plan"]').click();
    await expect(panel.locator('.chat-phase')).toHaveText('running');

    // Wait until phase is 'done'
    await page.waitForFunction(
      () => document.querySelector('.chat-phase')?.textContent === 'done',
      null, { timeout: 240000 }    // 4 min budget for the 13-step plan
    );

    // Every step row should be in the done state
    const doneCount = await panel.locator('.chat-plan-step.status-done').count();
    const errorCount = await panel.locator('.chat-plan-step.status-error').count();
    console.log(`After Run: done=${doneCount}, error=${errorCount}`);
    expect(doneCount).toBe(stepCount);
    expect(errorCount).toBe(0);

    // Multiple foundation results should be on window after execution
    const sideEffects = await page.evaluate(() => ({
      missionRan:    !!window.__lastMissionResult,
      braytonRan:    !!window.__lastBraytonResult,
      combustorRan:  !!window.__lastCombustorResult,
      historyCount:  window.__archdiscHistory?.entries?.length ?? 0,
    }));
    console.log('Side effects:', sideEffects);
    expect(sideEffects.missionRan).toBe(true);
    expect(sideEffects.braytonRan).toBe(true);
    expect(sideEffects.historyCount).toBeGreaterThanOrEqual(stepCount);

    // ── Cert matrix should surface inline after Run ─────────────
    const cert = panel.locator('[data-cert-summary]');
    await expect(cert).toBeVisible();
    const stats = await cert.locator('.chat-cert-stats').textContent();
    console.log(`\nCert matrix banner: ${stats}`);
    expect(stats).toMatch(/\d+\/\d+ pass/);
    expect(stats).toMatch(/\d+ uncovered/);

    // Expand the list. Scroll the cert-head into the transcript's
    // visible area first — the panel's auto-scroll puts new messages
    // at the bottom, which can push the cert block below the input row.
    const head = cert.locator('.chat-cert-head');
    await head.scrollIntoViewIfNeeded();
    // dispatchEvent rather than .click() — the chat-panel's onClick
    // stopPropagation chain can swallow synthesized Playwright clicks
    // in headed mode; a direct synthetic event reliably fires React.
    await head.dispatchEvent('click');
    await page.waitForTimeout(1500);
    const passCount = await cert.locator('.chat-cert-row.cert-pass').count();
    const uncoveredCount = await cert.locator('.chat-cert-row.cert-uncovered').count();
    const totalRows = await cert.locator('.chat-cert-row').count();
    console.log(`Cert rows: ${totalRows} total — ${passCount} pass, ${uncoveredCount} uncovered`);
    expect(totalRows).toBeGreaterThanOrEqual(10);
    // The plan exercises engine tooling so several rules pass; bird
    // strike + noise + fuel + Linear Static FEA are intentionally
    // uncovered — proves both classes appear in the same matrix.
    expect(passCount).toBeGreaterThanOrEqual(5);
    expect(uncoveredCount).toBeGreaterThanOrEqual(3);

    // ── DFM banner appears alongside cert matrix ────────────────
    const dfm = panel.locator('[data-dfm-summary]');
    await expect(dfm).toBeVisible();
    const dfmLight = (await dfm.locator('.chat-dfm-light').first().textContent())?.trim();
    const dfmStats = await dfm.locator('.chat-dfm-stats').textContent();
    console.log(`\nDFM banner: ${dfmLight} — ${dfmStats}`);
    expect(['PASS', 'INFO', 'WARN', 'ERROR']).toContain(dfmLight);
    expect(dfmStats).toMatch(/\d+ err · \d+ warn · \d+ info/);

    // Expand DFM list and verify rows render (issue count >= 0).
    await dfm.locator('.chat-dfm-head').dispatchEvent('click');
    await page.waitForTimeout(800);
    const dfmRows = dfm.locator('.chat-dfm-row');
    const dfmRowCount = await dfmRows.count();
    expect(dfmRowCount).toBeGreaterThanOrEqual(1);
    console.log(`DFM rows visible: ${dfmRowCount}`);

    // ── Cert matrix downloads (.md + .json) ─────────────────────
    const mdBtn = cert.locator('[data-action="download-cert-md"]');
    const jsonBtn = cert.locator('[data-action="download-cert-json"]');

    const [mdDl] = await Promise.all([
      page.waitForEvent('download'),
      mdBtn.dispatchEvent('click'),
    ]);
    const mdName = mdDl.suggestedFilename();
    console.log(`\nMD download: ${mdName}`);
    expect(mdName).toMatch(/archdisc-cert-\d{4}-\d{2}-\d{2}\.md/);
    const mdPath = await mdDl.path();
    const fs = await import('fs');
    const mdBody = fs.readFileSync(mdPath, 'utf8');
    expect(mdBody).toContain('# ArchDisc Certification Matrix');
    expect(mdBody).toMatch(/Passed:\*\*\s*\d+/);

    const [jsonDl] = await Promise.all([
      page.waitForEvent('download'),
      jsonBtn.dispatchEvent('click'),
    ]);
    const jsonName = jsonDl.suggestedFilename();
    console.log(`JSON download: ${jsonName}`);
    expect(jsonName).toMatch(/archdisc-cert-\d{4}-\d{2}-\d{2}\.json/);
    const jsonBody = JSON.parse(fs.readFileSync(await jsonDl.path(), 'utf8'));
    expect(jsonBody.summary.total).toBe(14);
    expect(jsonBody.ruleReports.length).toBe(14);
    expect(jsonBody.ruleReports[0].ruleId).toBeTruthy();
  });
});
