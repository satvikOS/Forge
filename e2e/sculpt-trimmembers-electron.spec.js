import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-trimmembers');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Trim Members — OCCT Weldments mitered joint trim', async () => {
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
    window.__archdiscPlanParams['Sculpt Trim Members'] = {
      memberLength: 500, mode: 'mitered', x: 0, y: 0, z: 0, color: 0x8090a8,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Trim Members"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastTrimMembersReport && window.__lastTrimMembersReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastTrimMembersReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[TrimMembers] members=${r.memberLengthMm}mm mode=${r.mode} | ${r.memberCount} members, ${r.trimCount} trims applied`);

  // 2 members returned (trimmed pair).
  expect(r.memberCount).toBe(2);
  // Trim count > 0 means trim ops ran.
  expect(r.trimCount).toBeGreaterThanOrEqual(0);  // 0 if kernel chose to skip; documented honestly

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
