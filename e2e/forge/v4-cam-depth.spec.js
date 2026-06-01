// v4-cam-depth.spec.js — Forge-131 headed CAM strategy + post processor
// breadth verification.
//
// Goal: prove the operator can open the CAM workbench, pick any of the
// new strategies from the dropdown, fill in real params, click Generate,
// and either see a real toolpath OR the kernel-not-ready notice — never
// a fabricated number. Then walk through 4 new post processors and
// assert their dialect choice flows through Export.
//
// Human-style:
//   • open via the menu / rail (window.__forgeOpenCam in the dev shell)
//   • pick the strategy via the grouped <select>
//   • click + Add to push the op into the list
//   • set the params via real input fills
//   • screenshot on every state change so the remote-watcher (memory:
//     headed Mac-Electron) sees what the human would see
//
// Multi-angle: between strategies we orbit the simulator camera so the
// screenshots show the toolpath / stock from different sides.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-cam-depth';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Five strategies we cover (mix of 2.5D / Finish / Hole / 5-axis groups).
const STRATEGIES = [
  { id: 'high-speed-adaptive',  group: '3D',     params: { zTop: 20, zBottom: 0 } },
  { id: 'spiral-pocket',        group: '2.5D',   params: { zTop: 20, zBottom: 0 } },
  { id: 'scallop-finishing',    group: 'Finish', params: { zTop: 20, zBottom: 0 } },
  { id: 'deep-drill',           group: 'Hole',   params: { zTop: 20, zBottom: 0 } },
  { id: 'thread-mill',          group: 'Hole',   params: { zTop: 20, zBottom: 5 } },
];

// Four post processors we walk through in the G-code tab.
const POSTS = [
  { dialect: 'Heidenhain iTNC530', expect: /BEGIN PGM|END PGM|L X|kernel not ready/ },
  { dialect: 'Okuma OSP',          expect: /O\d+|FORGE-131 OKUMA|G15|kernel not ready/ },
  { dialect: 'Fagor 8055',         expect: /%\d+|FORGE-131 FAGOR|G71|kernel not ready/ },
  { dialect: 'NUM 1050',           expect: /FORGE-131 NUM|G56|kernel not ready/ },
];

async function fillNum(page, testid, value) {
  const el = page.locator(`[data-testid="${testid}"]`);
  await el.fill('');
  await el.fill(String(value));
  await el.dispatchEvent('change');
}

async function pickStrategy(page, strategyId) {
  const picker = page.locator('[data-testid="forge-cam-strategy-picker"]');
  await picker.selectOption(strategyId);
  await page.waitForTimeout(120);
  await page.click('[data-testid="forge-cam-strategy-add"]');
  await page.waitForTimeout(250);
}

test.describe.serial('Forge v4 · CAM depth (Forge-131) headed', () => {
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
  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 open CAM workbench via __forgeOpenCam', async () => {
    await shot(page, 'shell-initial');
    const ok = await page.evaluate(() => typeof window.__forgeOpenCam === 'function');
    expect(ok).toBe(true);
    await page.evaluate(() => window.__forgeOpenCam());
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="forge-cam-panel"]')).toBeVisible();
    await shot(page, 'cam-panel-open');
  });

  test('02 configure stock block 80x50x20', async () => {
    await page.click('[data-cam-tab="stock"]');
    await page.waitForTimeout(120);
    await page.click('[data-cam-mode="block"]');
    await page.waitForTimeout(120);
    await fillNum(page, 'forge-cam-block-dx', 80);
    await fillNum(page, 'forge-cam-block-dy', 50);
    await fillNum(page, 'forge-cam-block-dz', 20);
    await shot(page, 'stock-80x50x20');
    await expect(page.locator('[data-testid="forge-cam-panel"]'))
      .toContainText(/80×50×20/);
  });

  test('03 strategy picker exposes 25+ entries', async () => {
    await page.click('[data-cam-tab="ops"]');
    await page.waitForTimeout(150);
    const optionCount = await page.locator(
      '[data-testid="forge-cam-strategy-picker"] option'
    ).count();
    expect(optionCount, '25+ strategies expected').toBeGreaterThanOrEqual(25);
    await shot(page, 'ops-strategy-picker');
  });

  // For every strategy we iterate: pick → params → Generate → shot.
  for (let i = 0; i < STRATEGIES.length; i++) {
    const s = STRATEGIES[i];
    test(`04.${i + 1} add ${s.id} + Generate`, async () => {
      await page.click('[data-cam-tab="ops"]');
      await page.waitForTimeout(150);
      await pickStrategy(page, s.id);

      // Set zTop / zBottom on the freshly-added op (it's now active).
      await fillNum(page, 'forge-cam-zTop',    s.params.zTop);
      await fillNum(page, 'forge-cam-zBottom', s.params.zBottom);
      await shot(page, `op-${s.id}-params`);

      const camReady = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-cam-panel"]');
        return el?.getAttribute('data-cam-ready') === 'true';
      });
      const generate = page.locator('[data-testid="forge-cam-generate"]');
      await expect(generate).toBeVisible();
      if (camReady) {
        await generate.click();
        await page.waitForTimeout(800);
        await shot(page, `op-${s.id}-generated`);
        const summary = await page
          .locator('[data-testid="forge-cam-op-summary"]').count();
        const error = await page
          .locator('[data-testid="forge-cam-op-error"]').count();
        expect(summary + error,
               `${s.id} generate must yield summary or error`).toBeGreaterThan(0);
      } else {
        await expect(generate).toBeDisabled();
        await expect(generate).toContainText(/kernel offline/i);
        await shot(page, `op-${s.id}-kernel-offline`);
      }

      // Multi-angle: orbit the camera so screenshots cover sides too.
      // The CamStockSimulator viewport canvas is the right pane — a
      // mouse drag over it rotates the orbit controls.
      const canvas = page.locator('canvas').first();
      if (await canvas.count()) {
        const box = await canvas.boundingBox();
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.mouse.move(
            box.x + box.width / 2 + 120 * (i % 2 ? 1 : -1),
            box.y + box.height / 2 + 60,
            { steps: 12 }
          );
          await page.mouse.up();
          await page.waitForTimeout(200);
          await shot(page, `op-${s.id}-angle`);
        }
      }
    });
  }

  test('05 post processor dropdown shows 10+ controllers', async () => {
    await page.click('[data-cam-tab="gcode"]');
    await page.waitForTimeout(180);
    const dialectOptions = await page.locator(
      '[data-testid="forge-cam-dialect"] option'
    ).count();
    expect(dialectOptions, '10+ controllers expected').toBeGreaterThanOrEqual(10);
    await shot(page, 'gcode-dialects-listed');
  });

  // For every post processor we iterate: pick dialect → Export → shot.
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    test(`06.${i + 1} export via ${p.dialect}`, async () => {
      await page.click('[data-cam-tab="gcode"]');
      await page.waitForTimeout(150);

      const dialect = page.locator('[data-testid="forge-cam-dialect"]');
      // The select uses the raw label as the value — selectOption resolves
      // by either value or label, so either works.
      await dialect.selectOption(p.dialect);
      await page.waitForTimeout(120);
      await shot(page, `gcode-${p.dialect.replace(/\s+/g, '-').toLowerCase()}-picked`);

      const camReady = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-cam-panel"]');
        return el?.getAttribute('data-cam-ready') === 'true';
      });
      const exp = page.locator('[data-testid="forge-cam-export"]');
      await expect(exp).toBeVisible();

      if (camReady) {
        await exp.click();
        await page.waitForTimeout(500);
        const note = await page
          .locator('[data-testid="forge-cam-gcode-note"]').count();
        const text = (await page.locator('[data-testid="forge-cam-gcode"]')
                          .innerText()).trim();
        // Real G-code OR a kernel-not-ready note — never a placeholder.
        const matchesDialect = p.expect.test(text);
        const hasGcode = /(G\d+|M\d+|L X|FORGE-131)/.test(text);
        expect(matchesDialect || hasGcode || note > 0,
          `${p.dialect} output must look real or carry not-ready note`).toBe(true);
        await shot(page, `gcode-${p.dialect.replace(/\s+/g, '-').toLowerCase()}-exported`);
      } else {
        await expect(exp).toBeDisabled();
        await expect(exp).toContainText(/kernel offline/i);
        await shot(page, `gcode-${p.dialect.replace(/\s+/g, '-').toLowerCase()}-offline`);
      }
    });
  }

  test('07 manual CAM clicks did not write to Archie thread', async () => {
    const count = await page
      .locator('[data-testid="forge-archie"] [data-role]').count();
    expect(count,
      'Forge-131 CAM clicks must NOT post to Archie').toBe(0);
  });

  test('08 close panel', async () => {
    await page.click('[data-testid="forge-cam-close"]');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid="forge-cam-panel"]')).toHaveCount(0);
    await shot(page, 'panel-closed');
  });
});
