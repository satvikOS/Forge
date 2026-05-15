import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Project import / export round-trip', () => {
  test.describe.configure({ timeout: 300000 });

  test('Export a project to disk, wipe localStorage, re-import → state restored', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
      localStorage.removeItem('archdisc.session');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Build a project: prompt + defaults + plan ready.
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

    // Rename for a deterministic file name
    await panel.locator('[data-project-name]').dblclick();
    await panel.locator('[data-field="project-name"]').fill('Turbofan Export Test');
    await panel.locator('[data-field="project-name"]').press('Enter');
    await page.waitForTimeout(500);

    const preMsgs = await panel.locator('.chat-msg').count();
    const prePlanSteps = await panel.locator('.chat-plan-step').count();
    const preProjectName = await panel.locator('[data-project-name]').textContent();
    console.log(`\nExport project "${preProjectName}" — ${preMsgs} msgs, ${prePlanSteps} steps`);
    expect(preProjectName).toBe('Turbofan Export Test');

    // 2. Export. Capture download.
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      panel.locator('[data-action="export-project"]').click(),
    ]);
    const exportPath = path.join(os.tmpdir(), `archdisc-export-${Date.now()}.archdisc.json`);
    await dl.saveAs(exportPath);
    const filename = dl.suggestedFilename();
    console.log(`Exported as: ${filename}`);
    expect(filename).toMatch(/turbofan-export-test\.archdisc\.json/);

    // Quick sanity: file parses as the right schema
    const exported = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    expect(exported.schema).toBe('archdisc-project-1.0');
    expect(exported.project.name).toBe('Turbofan Export Test');
    expect(exported.project.snapshot.plan.length).toBe(prePlanSteps);

    // 3. Nuke localStorage to simulate a fresh machine.
    await page.evaluate(() => {
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
      localStorage.removeItem('archdisc.session');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('[data-action="open-chat"]').click();
    const panel2 = page.locator('.chat-panel');
    await expect(panel2).toBeVisible({ timeout: 5000 });
    await expect(panel2.locator('.chat-phase')).toHaveText('idle');

    // 4. Import the file. Playwright's setInputFiles drives the hidden input.
    await panel2.locator('[data-action="import-project"]').setInputFiles(exportPath);
    await page.waitForTimeout(1500);

    // Restored state
    await expect(panel2.locator('[data-project-name]')).toHaveText('Turbofan Export Test');
    await expect(panel2.locator('.chat-phase')).toHaveText('ready');
    const postPlanSteps = await panel2.locator('.chat-plan-step').count();
    console.log(`After import — ${postPlanSteps} steps`);
    expect(postPlanSteps).toBe(prePlanSteps);

    // 5. Re-import the same file → should produce a (2) suffix project
    await panel2.locator('[data-action="import-project"]').setInputFiles(exportPath);
    await page.waitForTimeout(1500);
    await expect(panel2.locator('[data-project-name]')).toHaveText('Turbofan Export Test (2)');
    const names = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('archdisc.projects') ?? '[]').map(p => p.name);
    });
    console.log(`Projects after second import: ${JSON.stringify(names)}`);
    expect(names).toContain('Turbofan Export Test');
    expect(names).toContain('Turbofan Export Test (2)');
  });
});
