import { test, expect } from '@playwright/test';

test.describe('Multi-project chat library', () => {
  test.describe.configure({ timeout: 300000 });

  test('Create two projects, switch between them, delete one', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);
    // Clean state — drop any leftover projects from previous runs.
    await page.evaluate(() => {
      localStorage.removeItem('archdisc.projects');
      localStorage.removeItem('archdisc.activeProjectId');
      localStorage.removeItem('archdisc.session');
    });
    await page.reload();
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // 1. Open chat → no project yet. Type a prompt → auto-creates a project.
    await page.locator('[data-action="open-chat"]').click();
    const panel = page.locator('.chat-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    await panel.locator('[data-field="chat-input"]').fill('Design a small turbofan');
    await panel.locator('[data-action="send"]').click();
    await page.waitForTimeout(800);

    let name = await panel.locator('[data-project-name]').textContent();
    console.log(`\nProject 1 default name: "${name}"`);
    expect(name).toContain('Untitled project');

    // Rename to "Project A"
    await panel.locator('[data-project-name]').dblclick();
    await panel.locator('[data-field="project-name"]').fill('Project A');
    await panel.locator('[data-field="project-name"]').press('Enter');
    await page.waitForTimeout(500);
    await expect(panel.locator('[data-project-name]')).toHaveText('Project A');

    // Answer all clarifications → reach "ready" phase
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
    const projAplanCount = await panel.locator('.chat-plan-step').count();
    console.log(`Project A reaches ready with ${projAplanCount} plan steps`);
    expect(projAplanCount).toBeGreaterThanOrEqual(10);

    // 2. Click "+" to create a new project. State should clear.
    await panel.locator('[data-action="new-project"]').click();
    await page.waitForTimeout(500);
    await expect(panel.locator('.chat-phase')).toHaveText('idle');
    await expect(panel.locator('.chat-plan-step')).toHaveCount(0);
    name = await panel.locator('[data-project-name]').textContent();
    console.log(`Project 2 default name: "${name}"`);
    expect(name).toContain('Untitled project');

    // Rename to "Project B"
    await panel.locator('[data-project-name]').dblclick();
    await panel.locator('[data-field="project-name"]').fill('Project B');
    await panel.locator('[data-field="project-name"]').press('Enter');
    await page.waitForTimeout(500);
    await expect(panel.locator('[data-project-name]')).toHaveText('Project B');

    // Start a different prompt
    await panel.locator('[data-field="chat-input"]').fill('Design a bracket');
    await panel.locator('[data-action="send"]').click();
    await page.waitForTimeout(800);

    // 3. Switcher dropdown lists both projects
    const optionTexts = await panel.locator('[data-field="project-switch"] option').allTextContents();
    console.log(`Switcher: ${JSON.stringify(optionTexts)}`);
    expect(optionTexts).toContain('Project A');
    expect(optionTexts).toContain('Project B');

    // 4. Switch back to Project A → state should be the saved Project A snapshot
    await panel.locator('[data-field="project-switch"]').selectOption({ label: 'Project A' });
    await page.waitForTimeout(800);
    await expect(panel.locator('[data-project-name]')).toHaveText('Project A');
    await expect(panel.locator('.chat-phase')).toHaveText('ready');
    const stepsBack = await panel.locator('.chat-plan-step').count();
    console.log(`Switched back to Project A — ${stepsBack} plan steps`);
    expect(stepsBack).toBe(projAplanCount);

    // 5. Switch to B again → bracket prompt history present
    await panel.locator('[data-field="project-switch"]').selectOption({ label: 'Project B' });
    await page.waitForTimeout(800);
    await expect(panel.locator('[data-project-name]')).toHaveText('Project B');
    const projBMsgs = await panel.locator('.chat-msg-user .chat-msg-text').allTextContents();
    console.log(`Project B user messages: ${JSON.stringify(projBMsgs)}`);
    expect(projBMsgs.some(m => m.includes('bracket'))).toBe(true);

    // 6. Delete Project B → switcher drops it; active flips to Project A.
    page.once('dialog', d => d.accept());
    await panel.locator('[data-action="delete-project"]').click();
    await page.waitForTimeout(800);
    const optsAfterDelete = await panel.locator('[data-field="project-switch"] option').allTextContents();
    console.log(`After delete: ${JSON.stringify(optsAfterDelete)}`);
    expect(optsAfterDelete).not.toContain('Project B');
    expect(optsAfterDelete).toContain('Project A');
    await expect(panel.locator('[data-project-name]')).toHaveText('Project A');

    // localStorage now contains only one project entry.
    const stored = await page.evaluate(() => {
      return JSON.parse(localStorage.getItem('archdisc.projects') ?? '[]');
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('Project A');
  });
});
