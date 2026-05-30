import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-selfintqa');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Self-Intersect QA — OCCT 2-tier QA on clean filleted cube', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);

  await win.evaluate(() => {
    window.__archdiscPlanParams = window.__archdiscPlanParams || {};
    window.__archdiscPlanParams['Sculpt Self-Intersect QA'] = {
      boxSize: 40, filletR: 4, deflection: 0.1,
      x: 0, y: 0, z: 0, color: 0x90e0a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Self-Intersect QA"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastSelfIntReport && window.__lastSelfIntReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastSelfIntReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[SelfIntQA] ${r.boxSize}³ fillet R=${r.filletR} defl=${r.deflection} | tier1: valid=${r.tier1Valid} si=${r.tier1SelfIntersects} count=${r.tier1Count} | tier2: intersecting=${r.tier2Intersecting} pairs=${r.tier2PairCount} | clean=${r.cleanBody}`);

  // Tier 1: intrinsic validity passes.
  expect(r.tier1Valid).toBe(true);
  // Tier 1: no solid overlap.
  expect(r.tier1SelfIntersects).toBe(false);
  expect(r.tier1Count).toBe(0);
  // Tier 2: no mesh-level self-intersection.
  expect(r.tier2Intersecting).toBe(false);
  expect(r.tier2PairCount).toBe(0);
  // Overall: body is clean.
  expect(r.cleanBody).toBe(true);

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
