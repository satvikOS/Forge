// v4-208-sketchdof.spec.js — Forge-208 sketch DOF audit.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-208-sketchdof';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-208 · sketch DOF audit', () => {
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
      !!(window.forge && window.forge.sketchdof
         && typeof window.forge.sketchdof.audit === 'function'));
    expect(has).toBe(true);
  });

  test('02 over-constrained: line + 4 fixes (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.sketchdof.audit({
      entities:    [{ kind: 'line' }],
      constraints: [
        { kind: 'coincident' }, { kind: 'coincident' },
        { kind: 'horizontal' }, { kind: 'distance' },
      ],
    }));
    expect(r.totalDof).toBe(4);
    expect(r.constrainedDof).toBe(6);
    expect(r.freeDof).toBe(-2);
    expect(r.status).toBe('over');
    await shot(page, 'over');
  });

  test('03 fully-constrained: balanced sketch (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.sketchdof.audit({
      entities:    [{ kind: 'point' }, { kind: 'point' }],
      constraints: [{ kind: 'fix' }, { kind: 'fix' }],
    }));
    expect(r.totalDof).toBe(4);
    expect(r.constrainedDof).toBe(4);
    expect(r.status).toBe('fully');
    await shot(page, 'fully');
  });

  test('04 square fixture is under-constrained by 1 (cam #3)', async () => {
    const r = await page.evaluate(() => {
      return window.__forgeSketchDofAudit(window.__forgeSketchDofFixture());
    });
    expect(r.totalDof).toBe(16);
    expect(r.freeDof).toBe(1);
    expect(r.status).toBe('under');
    await shot(page, 'under');
  });

  test('05 panel open (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenSketchDofWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-sketchdof-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-sketchdof-run"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('06 add constraints + audit (cam #5)', async () => {
    // Add a distance constraint twice (2 more DOFs removed → -1, makes it
    // over-constrained).
    await page.locator('[data-testid="forge-sketchdof-add-distance"]').click();
    await page.locator('[data-testid="forge-sketchdof-add-distance"]').click();
    await page.locator('[data-testid="forge-sketchdof-run"]').click();
    await page.waitForSelector('[data-testid="forge-sketchdof-result"]', { timeout: 5000 });
    const status = await page.locator('[data-testid="forge-sketchdof-status"]').innerText();
    expect(status).toMatch(/OVER-CONSTRAINED/);
    await shot(page, 'panel-result-over');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
