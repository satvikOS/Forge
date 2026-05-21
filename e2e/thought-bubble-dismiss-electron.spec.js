import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';

/*
 * ThoughtBubble dismiss — headed Electron e2e
 *
 * SKIPPED: the ThoughtBubble is temporarily disabled (SHOW_THOUGHT_BUBBLE = false in
 * WorkbenchMechanical.jsx — the floating box obstructs the viewport / operation view).
 * Re-enable this spec (test.skip -> test) when the bubble is re-added.
 *
 * Verifies that:
 *   1. A selection causes the ThoughtBubble to appear.
 *   2. Clicking the close button dismisses it (removes it from the DOM).
 *   3. No renderer errors occurred.
 *
 * Selection is triggered via window.__archdiscSetSelection, which is
 * exposed by WorkbenchMechanical for exactly this purpose — driving the
 * bubble without needing a real 3D viewport pick (which is fiddly from
 * Playwright).
 */

test.setTimeout(600000);

test.skip('ThoughtBubble appears on selection and close button dismisses it', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const pageErrors = [];
  const win = await app.firstWindow();
  win.on('pageerror', (err) => pageErrors.push(err.message));

  await win.waitForLoadState('domcontentloaded');

  // Wait for the canvas to be visible (viewport initialised)
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 90000 });

  // Wait until WorkbenchMechanical has mounted and exposed __archdiscSetSelection
  await win.waitForFunction(
    () => typeof window.__archdiscSetSelection === 'function',
    null,
    { timeout: 90000 },
  );

  // ── Step 1: trigger a selection so the ThoughtBubble mounts ──────────────
  await win.evaluate(() => {
    window.__archdiscSetSelection({
      type: 'object',
      name: 'Test Box',
      solidId: 1,
      solid: null,
    });
  });

  // The bubble should now be in the DOM
  const bubble = win.locator('.thought-bubble');
  await expect(bubble).toBeVisible({ timeout: 10000 });

  // ── Step 2: click the close button ───────────────────────────────────────
  const closeBtn = win.locator('[data-testid="thought-bubble-close"]');
  await expect(closeBtn).toBeVisible({ timeout: 5000 });

  // Use dispatchEvent to be safe with the scrollable viewport container
  await closeBtn.dispatchEvent('click');

  // The bubble should unmount (selection cleared → {selection && ...} is false)
  await expect(bubble).toHaveCount(0, { timeout: 5000 });

  // ── Step 3: no renderer errors ────────────────────────────────────────────
  expect(pageErrors).toHaveLength(0);

  await app.close();
});
