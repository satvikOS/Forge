// v4-209-animation.spec.js — Forge-209 animation timeline.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-209-animation';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-209 · animation timeline', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.animation
         && typeof window.forge.animation.duration === 'function'
         && typeof window.forge.animation.evaluateAll === 'function'
         && typeof window.forge.animation.sampleRange === 'function'));
    expect(has).toBe(true);
  });

  test('02 single-track linear lerp (cam #1)', async () => {
    const r = await page.evaluate(() => {
      const t = [{
        name: 'a', interpolation: 'linear',
        keys: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [10, 0, 0] },
        ],
      }];
      const d = window.forge.animation.duration(t);
      const at0 = window.forge.animation.evaluateAll(t, 0);
      const atMid = window.forge.animation.evaluateAll(t, 0.5);
      const at1 = window.forge.animation.evaluateAll(t, 1);
      return { d,
        v0: at0[0].value[0],
        vM: atMid[0].value[0],
        v1: at1[0].value[0],
      };
    });
    expect(r.d).toBeCloseTo(1, 12);
    expect(r.v0).toBeCloseTo(0,  12);
    expect(r.vM).toBeCloseTo(5,  12);
    expect(r.v1).toBeCloseTo(10, 12);
    await shot(page, 'linear');
  });

  test('03 clamp before / after the range (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const t = [{
        name: 'a', interpolation: 'linear',
        keys: [{ time: 0, value: [0,0,0] }, { time: 1, value: [10,0,0] }],
      }];
      return {
        before: window.forge.animation.evaluateAll(t, -2)[0].value[0],
        after:  window.forge.animation.evaluateAll(t,  3)[0].value[0],
      };
    });
    expect(r.before).toBe(0);
    expect(r.after).toBe(10);
    await shot(page, 'clamp');
  });

  test('04 cubic round-trips keyframes (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const t = [{
        name: 'a', interpolation: 'cubic',
        keys: [
          { time: 0, value: [0, 0, 0] },
          { time: 1, value: [1, 0, 0] },
          { time: 2, value: [4, 0, 0] },
        ],
      }];
      return {
        v0: window.forge.animation.evaluateAll(t, 0)[0].value[0],
        v1: window.forge.animation.evaluateAll(t, 1)[0].value[0],
        v2: window.forge.animation.evaluateAll(t, 2)[0].value[0],
      };
    });
    expect(r.v0).toBeCloseTo(0, 12);
    expect(r.v1).toBeCloseTo(1, 12);
    expect(r.v2).toBeCloseTo(4, 12);
    await shot(page, 'cubic');
  });

  test('05 sampleRange equal spacing (cam #4)', async () => {
    const r = await page.evaluate(() => {
      const t = [{
        name: 'a', interpolation: 'linear',
        keys: [{ time: 0, value: [0,0,0] }, { time: 1, value: [10,0,0] }],
      }];
      const f = window.forge.animation.sampleRange(t, 0, 1, 11);
      return { n: f.length, times: f.map((x) => x.time), midX: f[5].values[0].value[0] };
    });
    expect(r.n).toBe(11);
    expect(r.times[0]).toBe(0);
    expect(r.times[10]).toBe(1);
    expect(r.midX).toBeCloseTo(5, 12);
    await shot(page, 'samplerange');
  });

  test('06 open the workbench, scrub the slider (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenAnimationWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-animation-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-animation-state"]')).toBeVisible();
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="forge-animation-scrub"]');
      const v = '2.0';
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const timeText = await page.locator('[data-testid="forge-animation-time"]').innerText();
    expect(timeText).toMatch(/t = 2\.000/);
    await shot(page, 'scrubbed');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
