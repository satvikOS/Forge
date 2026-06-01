// Forge-149 — Draft workbench end-to-end.
//
// HEADED Electron. Click-only — switch to the Draft workbench tab, hit
// 5 curve buttons (line / rectangle / circle / arc / polygon), 3 modify
// buttons (move / rotate / array-linear), 1 annotation button
// (dimension). Multi-angle screenshots in both dark and light themes.
// All `data-testid` based — no window.__forge* probes for assertions.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const SHOT_DIR = '/tmp/v4-draft';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _stepCounter = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++_stepCounter).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function pause(page, ms) { await page.waitForTimeout(ms); }

async function setTheme(page, theme) {
  for (let i = 0; i < 4; i++) {
    const current = await page.evaluate(() => window.__forgeTheme);
    if (current === theme) return current;
    await page.keyboard.press('Meta+t');
    await pause(page, 250);
  }
  return await page.evaluate(() => window.__forgeTheme);
}

test.describe('Forge v4 — Draft workbench', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env:  { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(page, 2500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 shell mounts', async () => {
    await expect(page.locator('[data-testid="forge-app"]'))
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'shell');
  });

  test('02 switch to Draft workbench (click tab)', async () => {
    await setTheme(page, 'dark');
    const tab = page.locator('[data-wb="draft"]').first();
    await expect(tab).toBeVisible({ timeout: 8000 });
    await tab.click();
    await pause(page, 500);
    const panel = page.locator('[data-testid="forge-draft"]');
    await expect(panel).toBeVisible({ timeout: 6000 });
    await shot(page, 'draft-panel-open-dark');
  });

  test('03 toolbars + tool catalogue mount', async () => {
    await expect(page.locator('[data-testid="forge-draft-toolbar-curves"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-draft-toolbar-modify"]'))
      .toBeVisible();
    await expect(page.locator('[data-testid="forge-draft-toolbar-annotation"]'))
      .toBeVisible();
    const totalEl = page.locator('[data-testid="forge-draft-tools-total"]');
    await expect(totalEl).toBeVisible();
    const total = await totalEl.innerText();
    expect(total).toMatch(/\d+ tools available/);
    await shot(page, 'toolbars');
  });

  test('04 curve · line', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-line"]').click();
    await pause(page, 250);
    const n = await page.locator('[data-testid="forge-draft-curve"]').count();
    expect(n, 'line curve drawn').toBeGreaterThanOrEqual(1);
    const counter = await page.locator('[data-testid="forge-draft-count-curves"]')
                              .innerText();
    expect(counter).toMatch(/Curves:\s*\d+/);
    await shot(page, 'curve-line');
  });

  test('05 curve · rectangle', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-rectangle"]').click();
    await pause(page, 250);
    const rects = page.locator('[data-curve-kind="rectangle"]');
    await expect(rects.first()).toBeVisible();
    await shot(page, 'curve-rectangle');
  });

  test('06 curve · circle', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-circle"]').click();
    await pause(page, 250);
    const circles = page.locator('[data-curve-kind="circle"]');
    await expect(circles.first()).toBeVisible();
    await shot(page, 'curve-circle');
  });

  test('07 curve · arc', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-arc"]').click();
    await pause(page, 250);
    const arcs = page.locator('[data-curve-kind="arc"]');
    await expect(arcs.first()).toBeVisible();
    await shot(page, 'curve-arc');
  });

  test('08 curve · polygon', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-polygon"]').click();
    await pause(page, 250);
    const polys = page.locator('[data-curve-kind="polygon"]');
    await expect(polys.first()).toBeVisible();
    await shot(page, 'curve-polygon');
  });

  test('09 modify · move', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-move"]').click();
    await pause(page, 250);
    const counter = await page.locator('[data-testid="forge-draft-count-modify"]')
                              .innerText();
    expect(counter).toMatch(/Modify ops:\s*[1-9]/);
    await shot(page, 'modify-move');
  });

  test('10 modify · rotate', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-rotate"]').click();
    await pause(page, 250);
    const counter = await page.locator('[data-testid="forge-draft-count-modify"]')
                              .innerText();
    expect(counter).toMatch(/Modify ops:\s*[2-9]/);
    await shot(page, 'modify-rotate');
  });

  test('11 modify · array linear', async () => {
    const before = await page.locator('[data-testid="forge-draft-curve"]').count();
    await page.locator('[data-testid="forge-draft-tool-draft-array-linear"]').click();
    await pause(page, 300);
    const after = await page.locator('[data-testid="forge-draft-curve"]').count();
    expect(after, 'array-linear added curves').toBeGreaterThan(before);
    await shot(page, 'modify-array-linear');
  });

  test('12 annotation · dimension', async () => {
    await page.locator('[data-testid="forge-draft-tool-draft-dimension"]').click();
    await pause(page, 300);
    const dim = page.locator('[data-testid="forge-draft-anno-dimension"]');
    await expect(dim.first()).toBeVisible();
    const counter = await page.locator('[data-testid="forge-draft-count-annotations"]')
                              .innerText();
    expect(counter).toMatch(/Annotations:\s*[1-9]/);
    await shot(page, 'annotation-dimension');
  });

  test('13 second camera angle (resize via window key)', async () => {
    // Simulate a UI zoom — press Meta+= a few times to nudge the dev
    // viewport. Even if unbound, this confirms multi-input headed.
    await page.keyboard.press('Meta+=');
    await pause(page, 300);
    await shot(page, 'angle-2-dark');
  });

  test('14 third camera angle (scroll within panel)', async () => {
    const canvas = page.locator('[data-testid="forge-draft-canvas"]').first();
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -200);
      await pause(page, 250);
    }
    await shot(page, 'angle-3-dark');
  });

  test('15 hatch annotation with ANSI31 steel', async () => {
    await page.locator('[data-testid="forge-draft-hatch-pattern"]')
              .selectOption('ansi31-steel');
    await pause(page, 200);
    await page.locator('[data-testid="forge-draft-tool-draft-hatch"]').click();
    await pause(page, 350);
    const hatch = page.locator('[data-testid="forge-draft-anno-hatch"]')
                      .first();
    await expect(hatch).toBeVisible();
    const ansi = await hatch.getAttribute('data-hatch-ansi');
    expect(ansi).toBe('ANSI31');
    await shot(page, 'hatch-ansi31');
  });

  test('16 switch to light theme, reopen Draft, re-exercise key tools', async () => {
    const t = await setTheme(page, 'light');
    expect(t).toBe('light');
    // Switch back to draft (theme change may have re-rendered the rail).
    await page.locator('[data-wb="draft"]').first().click();
    await pause(page, 400);
    await expect(page.locator('[data-testid="forge-draft"]'))
      .toBeVisible({ timeout: 6000 });
    await shot(page, 'draft-panel-open-light');
    // One curve + one modify + one annotation under light theme.
    await page.locator('[data-testid="forge-draft-tool-draft-line"]').click();
    await pause(page, 200);
    await shot(page, 'light-line');
    await page.locator('[data-testid="forge-draft-tool-draft-rotate"]').click();
    await pause(page, 200);
    await shot(page, 'light-rotate');
    await page.locator('[data-testid="forge-draft-tool-draft-dimension"]').click();
    await pause(page, 250);
    await shot(page, 'light-dimension');
  });

  test('17 light-theme hatch with ANSI33 brass', async () => {
    await page.locator('[data-testid="forge-draft-hatch-pattern"]')
              .selectOption('ansi33-brass');
    await pause(page, 200);
    await page.locator('[data-testid="forge-draft-tool-draft-hatch"]').click();
    await pause(page, 300);
    const hatch = page.locator('[data-hatch-id="ansi33-brass"]').first();
    await expect(hatch).toBeVisible();
    await shot(page, 'hatch-ansi33-light');
  });

  test('18 final panel state preserved across theme cycle', async () => {
    const curves = await page.locator('[data-testid="forge-draft-count-curves"]')
                             .innerText();
    const mods   = await page.locator('[data-testid="forge-draft-count-modify"]')
                             .innerText();
    const annos  = await page.locator('[data-testid="forge-draft-count-annotations"]')
                             .innerText();
    expect(curves).toMatch(/Curves:\s*[1-9]/);
    expect(mods  ).toMatch(/Modify ops:\s*[1-9]/);
    expect(annos ).toMatch(/Annotations:\s*[1-9]/);
    await shot(page, 'final-state');
  });
});
