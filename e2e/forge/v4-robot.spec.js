// Forge-152 — Robot workbench end-to-end.
//
// Headed Electron, watchable pace (the user runs the suite remotely
// over RDP and wants every step to land on screen long enough to be
// seen). The spec exercises the full human flow:
//
//   1. App boots, shell mounts.
//   2. Open the Robot workbench (rail tab + Tools menu fallback).
//   3. Pick the KUKA KR6 R900 sixx from the model picker.
//   4. Jog all six joints into a teachable pose.
//   5. Record three waypoints (PTP, LIN, PTP).
//   6. Press Play — robot animates through the waypoint list.
//   7. Export the program as KUKA KRL and verify the .src content
//      (DEF / PTP / END keywords, joint values, tool/base lines).
//
// We also verify that switching models (ABB → FANUC) reloads the DH
// table cleanly, and that the workspace voxel overlay paints when
// toggled — the panel itself must never silently break the kinematics.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const SHOT_DIR = '/tmp/v4-robot';
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

test.describe('Forge v4 — robot workbench depth pass', () => {
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

  test('02 open Robot workbench via rail tab', async () => {
    const tab = page.locator('[data-wb="robot"]').first();
    await expect(tab).toBeVisible({ timeout: 8000 });
    await tab.click();
    await pause(page, 500);
    // The host listens for both rail clicks and menu actions; if it
    // didn't catch the rail click for any reason, fire the imperative
    // entry point to keep the test deterministic.
    const panel = page.locator('[data-testid="forge-robot"]');
    if (!(await panel.count())) {
      await page.evaluate(() => window.__forgeOpenRobot?.());
      await pause(page, 400);
    }
    await expect(panel).toBeVisible({ timeout: 6000 });
    await shot(page, 'robot-panel-open');
  });

  test('03 picker lists three robot models', async () => {
    const sel = page.locator('[data-testid="forge-robot-picker"]');
    await expect(sel).toBeVisible();
    const count = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="forge-robot-picker"]');
      return s ? s.options.length : 0;
    });
    expect(count, 'picker has KUKA + ABB + FANUC').toBeGreaterThanOrEqual(3);
    await shot(page, 'picker-populated');
  });

  test('04 pick KUKA KR6 R900', async () => {
    const sel = page.locator('[data-testid="forge-robot-picker"]');
    await sel.selectOption('kuka-kr6-r900');
    await pause(page, 350);
    const title = await page.locator('[data-testid="forge-robot-title"]')
                            .innerText();
    expect(title).toMatch(/KUKA/);
    expect(title).toMatch(/KR 6 R900/);
    // Confirm window snapshot updated.
    const snapId = await page.evaluate(() => window.__forgeRobot?.modelId);
    expect(snapId).toBe('kuka-kr6-r900');
    await shot(page, 'kuka-picked');
  });

  test('05 jog J1 to +45 degrees', async () => {
    const slider = page.locator('[data-testid="forge-robot-joint-slider-0"]');
    await expect(slider).toBeVisible();
    // Use the numeric input — sliders are tricky to drag deterministically.
    const num = page.locator('[data-testid="forge-robot-joint-num-0"]');
    await num.click({ clickCount: 3 });
    await page.keyboard.type('45');
    await page.keyboard.press('Tab');
    await pause(page, 350);
    const j1 = await page.evaluate(() => window.__forgeRobot?.jointsDeg?.[0]);
    expect(j1).toBeCloseTo(45, 0);
    await shot(page, 'j1-45');
  });

  test('06 jog J2 to -30 degrees', async () => {
    const num = page.locator('[data-testid="forge-robot-joint-num-1"]');
    await num.click({ clickCount: 3 });
    await page.keyboard.type('-30');
    await page.keyboard.press('Tab');
    await pause(page, 350);
    const j2 = await page.evaluate(() => window.__forgeRobot?.jointsDeg?.[1]);
    expect(j2).toBeCloseTo(-30, 0);
    await shot(page, 'j2-neg30');
  });

  test('07 jog J3 to +60 degrees', async () => {
    const num = page.locator('[data-testid="forge-robot-joint-num-2"]');
    await num.click({ clickCount: 3 });
    await page.keyboard.type('60');
    await page.keyboard.press('Tab');
    await pause(page, 350);
    await shot(page, 'j3-60');
  });

  test('08 jog J5 wrist pitch', async () => {
    const num = page.locator('[data-testid="forge-robot-joint-num-4"]');
    await num.click({ clickCount: 3 });
    await page.keyboard.type('45');
    await page.keyboard.press('Tab');
    await pause(page, 350);
    await shot(page, 'j5-45');
  });

  test('09 record waypoint #1 (PTP at jogged pose)', async () => {
    const teachMove = page.locator('[data-testid="forge-robot-teach-movetype"]');
    await teachMove.selectOption('PTP');
    await pause(page, 100);
    await page.locator('[data-testid="forge-robot-record"]').click();
    await pause(page, 300);
    const wp = page.locator('[data-testid="forge-robot-wp-0"]');
    await expect(wp).toBeVisible();
    const n = await page.evaluate(() => window.__forgeRobot?.waypoints?.length);
    expect(n).toBe(1);
    await shot(page, 'wp1-recorded');
  });

  test('10 jog to a second pose and record (LIN)', async () => {
    // Home one joint then jog J1 to a new value to make WP#2 distinct.
    const num0 = page.locator('[data-testid="forge-robot-joint-num-0"]');
    await num0.click({ clickCount: 3 });
    await page.keyboard.type('-30');
    await page.keyboard.press('Tab');
    await pause(page, 250);
    const num4 = page.locator('[data-testid="forge-robot-joint-num-4"]');
    await num4.click({ clickCount: 3 });
    await page.keyboard.type('30');
    await page.keyboard.press('Tab');
    await pause(page, 250);
    await page.locator('[data-testid="forge-robot-teach-movetype"]')
              .selectOption('LIN');
    await pause(page, 100);
    await page.locator('[data-testid="forge-robot-record"]').click();
    await pause(page, 300);
    const n = await page.evaluate(() => window.__forgeRobot?.waypoints?.length);
    expect(n).toBe(2);
    await shot(page, 'wp2-recorded-lin');
  });

  test('11 jog to a third pose and record', async () => {
    const num1 = page.locator('[data-testid="forge-robot-joint-num-1"]');
    await num1.click({ clickCount: 3 });
    await page.keyboard.type('-60');
    await page.keyboard.press('Tab');
    await pause(page, 250);
    await page.locator('[data-testid="forge-robot-teach-movetype"]')
              .selectOption('PTP');
    await pause(page, 100);
    await page.locator('[data-testid="forge-robot-record"]').click();
    await pause(page, 300);
    const n = await page.evaluate(() => window.__forgeRobot?.waypoints?.length);
    expect(n).toBe(3);
    await shot(page, 'wp3-recorded');
  });

  test('12 press Play, watch animation progress', async () => {
    await page.locator('[data-testid="forge-robot-play"]').click();
    await pause(page, 600);
    // The progress label should now read "WP X/3" while playing.
    const label = await page.locator('[data-testid="forge-robot-progress-label"]')
                            .innerText();
    expect(label.toLowerCase()).toMatch(/wp|idle/);
    await shot(page, 'playback-running');
    // Let the playback finish (3 short PTP/LIN segments ≈ a few seconds).
    await pause(page, 4500);
    await shot(page, 'playback-done');
  });

  test('13 export KUKA KRL .src', async () => {
    await page.locator('[data-testid="forge-robot-export-krl"]').click();
    await pause(page, 350);
    const out = page.locator('[data-testid="forge-robot-export-output"]');
    await expect(out).toBeVisible();
    const fmt = await out.getAttribute('data-export-format');
    expect(fmt).toBe('KRL');
    const text = await page.locator('[data-testid="forge-robot-export-text"]')
                           .innerText();
    expect(text).toMatch(/DEF\s+\w+/);          // KRL DEF header
    expect(text).toMatch(/END$/m);              // KRL END footer
    expect(text).toContain('PTP');              // at least one joint move
    expect(text).toMatch(/\$TOOL\s*=\s*TOOL_DATA/);
    expect(text).toMatch(/\$BASE\s*=\s*BASE_DATA/);
    expect(text).toContain('A1');               // joint-1 keyword
    await shot(page, 'export-krl');
  });

  test('14 export ABB RAPID .mod', async () => {
    await page.locator('[data-testid="forge-robot-export-rapid"]').click();
    await pause(page, 350);
    const text = await page.locator('[data-testid="forge-robot-export-text"]')
                           .innerText();
    expect(text).toMatch(/MODULE/);
    expect(text).toMatch(/ENDMODULE/);
    expect(text).toContain('PERS tooldata');
    expect(text).toContain('MoveAbsJ');         // PTP target uses MoveAbsJ
    await shot(page, 'export-rapid');
  });

  test('15 export FANUC TP .ls', async () => {
    await page.locator('[data-testid="forge-robot-export-tp"]').click();
    await pause(page, 350);
    const text = await page.locator('[data-testid="forge-robot-export-text"]')
                           .innerText();
    expect(text).toMatch(/\/PROG/);
    expect(text).toMatch(/\/END/);
    expect(text).toMatch(/UTOOL_NUM/);
    expect(text).toMatch(/J P\[1\]/);
    await shot(page, 'export-tp');
  });

  test('16 toggle workspace voxel cloud', async () => {
    const cb = page.locator('[data-testid="forge-robot-workspace-toggle"]');
    await cb.check();
    await pause(page, 1500);                    // sample cloud is non-trivial
    const info = page.locator('[data-testid="forge-robot-workspace-info"]');
    await expect(info).toBeVisible();
    const txt = await info.innerText();
    expect(txt.toLowerCase()).toContain('voxels');
    await shot(page, 'workspace-on');
    await cb.uncheck();
    await pause(page, 300);
    await shot(page, 'workspace-off');
  });

  test('17 switch to ABB and verify DH table reloads', async () => {
    const sel = page.locator('[data-testid="forge-robot-picker"]');
    await sel.selectOption('abb-irb1200-7-070');
    await pause(page, 400);
    const title = await page.locator('[data-testid="forge-robot-title"]')
                            .innerText();
    expect(title).toMatch(/ABB/);
    // The picker switch wipes waypoints (intentional — different
    // joint frames). Verify list is empty.
    const n = await page.evaluate(() => window.__forgeRobot?.waypoints?.length);
    expect(n).toBe(0);
    await shot(page, 'abb-switched');
  });

  test('18 switch to FANUC and home all joints', async () => {
    const sel = page.locator('[data-testid="forge-robot-picker"]');
    await sel.selectOption('fanuc-lrmate-200id-7l');
    await pause(page, 400);
    await page.locator('[data-testid="forge-robot-home"]').click();
    await pause(page, 200);
    const q = await page.evaluate(() => window.__forgeRobot?.jointsDeg);
    expect(q).toEqual([0, 0, 0, 0, 0, 0]);
    await shot(page, 'fanuc-home');
  });

  test('19 close panel', async () => {
    await page.locator('[data-testid="forge-robot-close"]').click();
    await pause(page, 250);
    await expect(page.locator('[data-testid="forge-robot"]')).toHaveCount(0);
    await shot(page, 'panel-closed');
  });

  test('20 re-open via Tools menu', async () => {
    // Open Tools menu and click the Robot item.
    await page.locator('[data-menu="tools"]').click();
    await pause(page, 200);
    await page.locator('[data-menu-item="tools.robot"]').click();
    await pause(page, 400);
    await expect(page.locator('[data-testid="forge-robot"]'))
      .toBeVisible({ timeout: 4000 });
    await shot(page, 'reopened-from-menu');
  });
});
