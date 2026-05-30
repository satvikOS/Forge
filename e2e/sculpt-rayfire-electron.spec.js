import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-rayfire');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Ray Fire — OCCT ray query, sphere R=20 along +X', async () => {
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
    window.__archdiscPlanParams['Sculpt Ray Fire'] = {
      sphereR: 20,
      originX: -50, originY: 0, originZ: 0,
      dirX: 1, dirY: 0, dirZ: 0,
      x: 0, y: 0, z: 0,
      colorBody: 0xa8c8e6, colorHit: 0xff4040, colorRay: 0x40ff40,
    };
  });
  await win.locator('[data-ribbon-tool-name="Sculpt Ray Fire"]').first().dispatchEvent('click');
  await win.waitForFunction(
    () => window.__lastRayFireReport && window.__lastRayFireReport.error !== 'in progress',
    null,
    { timeout: 8 * 60 * 1000 },
  );
  const r = await win.evaluate(() => window.__lastRayFireReport);
  if (r.error) throw new Error('handler error: ' + r.error);
  console.log(`[RayFire] sphere R=${r.sphereR} origin=(${r.origin.x},${r.origin.y},${r.origin.z}) dir=(${r.direction.x},${r.direction.y},${r.direction.z}) | ${r.hitCount} hits: ${r.hits.map((h, i) => `[${i}] p=(${h.point.x.toFixed(2)},${h.point.y.toFixed(2)},${h.point.z.toFixed(2)}) d=${h.distance.toFixed(2)} n=(${h.normal ? `${h.normal.x.toFixed(2)},${h.normal.y.toFixed(2)},${h.normal.z.toFixed(2)}` : 'null'}) state=${h.state}`).join(' | ')}`);

  // Sphere R=20 centred at origin, ray from (-50,0,0) along +X:
  //   entry at (-20, 0, 0), distance 30 mm
  //   exit  at ( 20, 0, 0), distance 70 mm
  expect(r.hitCount).toBe(2);
  expect(r.hits[0].distance).toBeCloseTo(30, 1);
  expect(r.hits[1].distance).toBeCloseTo(70, 1);
  expect(r.hits[0].point.x).toBeCloseTo(-20, 1);
  expect(r.hits[1].point.x).toBeCloseTo(20, 1);
  // Each hit's y, z should be near 0.
  for (const h of r.hits) {
    expect(Math.abs(h.point.y)).toBeLessThan(0.01);
    expect(Math.abs(h.point.z)).toBeLessThan(0.01);
  }
  // Hit normals: entry hit should have outward normal pointing -X (away
  // from sphere centre at the entry point); exit hit should point +X.
  if (r.hits[0].normal) {
    expect(r.hits[0].normal.x).toBeCloseTo(-1, 1);
  }
  if (r.hits[1].normal) {
    expect(r.hits[1].normal.x).toBeCloseTo(1, 1);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
