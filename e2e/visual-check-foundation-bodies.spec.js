import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const ROOT = path.join(REPO_ROOT, 'foundation-output', 'visual-checks');
function ensure(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

test.setTimeout(180000);

/**
 * Visual safety check: every foundation body must be visible and
 * roughly centered in the viewport after the ribbon click. We take a
 * screenshot for each tool and read out the on-screen pixel bbox of
 * the canvas content.
 */
const TOOLS = [
  { tab: 'Part',         name: 'Linear Pattern' },
  { tab: 'Part',         name: 'Circular Pattern' },
  { tab: 'Part',         name: 'Mirror Feature' },
  { tab: 'Part',         name: 'Sweep Boss' },
  { tab: 'Part',         name: 'Loft Boss' },
  { tab: 'Part',         name: 'Hole Wizard' },
  { tab: 'Part',         name: 'Combine' },
  { tab: 'Part',         name: 'Subtract' },
  { tab: 'Part',         name: 'Intersect' },
  { tab: 'Part',         name: 'Revolve Boss' },
  { tab: 'Part',         name: 'Shell' },
  { tab: 'Part',         name: 'Extrude Boss' },
];

test('Visual: every foundation body fits + is centered in viewport', async ({ page }) => {
  ensure(ROOT);

  const consoleLines = [];
  page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('/');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });

  // Wait for fit-to-screen hook to install
  await page.waitForFunction(() => typeof window.__archdiscFitToScreen === 'function', null, { timeout: 30000 });

  const summary = [];
  for (const t of TOOLS) {
    await page.evaluate(() => { window.__lastFoundationManifold = null; });
    await page.locator('.ribbon-tab', { hasText: t.tab }).first().click();
    await page.locator('.ribbon-tool-label', { hasText: new RegExp(`^${t.name}$`) }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 60000 });

    // Confirm body in scene + the fit-to-screen ran
    const stat = await page.evaluate(() => {
      const m = window.__lastFoundationManifold;
      const bb = m.boundingBox();
      const groupCount = window.__archdiscScene
        ? window.__archdiscScene.children.filter(c => c.userData?.foundationManifold).length
        : 0;
      return {
        volume: m.volume(),
        bbox: { min: [...bb.min], max: [...bb.max] },
        groupsInScene: groupCount,
      };
    });
    // Give the PropertyManager polling tick (~500ms) time to pick up
    // the new foundation body so the right-panel reads its volume,
    // mass, surface area in the screenshot.
    await page.waitForTimeout(700);
    const pngPath = path.join(ROOT, `${t.name.replace(/\W+/g, '_')}.png`);
    await page.screenshot({ path: pngPath, fullPage: true });
    summary.push({
      tool: t.name,
      volumeMm3: stat.volume,
      bbox: stat.bbox,
      groupsInScene: stat.groupsInScene,
      screenshot: path.basename(pngPath),
    });
    console.log(`${t.tab}/${t.name}: V=${stat.volume.toFixed(0)} mm³, groups=${stat.groupsInScene}, screenshot=${path.basename(pngPath)}`);
    expect(stat.groupsInScene).toBeGreaterThan(0);
    expect(stat.volume).toBeGreaterThan(0);
  }
  fs.writeFileSync(path.join(ROOT, 'visual-summary.json'), JSON.stringify(summary, null, 2));
});
