// Detail-level UI capture: native-resolution element crops of the redesigned
// command palette (icons + rows), ribbon strip, and inspector — to judge icon +
// typography quality up close. No model/serve needed.
const { test, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
const OUT = path.resolve('/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/uiux');

test('UI DETAIL — icon + typography close-ups', async () => {
  test.setTimeout(4 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await _electron.launch({ args: [ELECTRON_MAIN, '--no-sandbox'], env: { ...process.env, FORGE_E2E: '1' }, slowMo: 30 });
  let page = await app.firstWindow();
  if (page.url().startsWith('devtools://')) page = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} }).catch(() => {});
  await page.reload().catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const clip = async (tag, x, y, w, h) => { await page.screenshot({ path: path.join(OUT, `detail_${tag}.png`), clip: { x, y, width: w, height: h } }).catch(() => {}); };
  const vp = page.viewportSize() || { width: 1280, height: 800 };

  // top strip: menu + ribbon (icons + tool labels)
  await clip('top_ribbon', 0, 0, vp.width, 90);
  // open palette + type to surface rows WITH per-tool icons
  await page.keyboard.press('Meta+k').catch(() => {});
  await page.waitForTimeout(400);
  await page.evaluate(() => { try { window.__forgeOpenCommandPalette && window.__forgeOpenCommandPalette(true); } catch (_) {} }).catch(() => {});
  await page.waitForTimeout(500);
  await page.locator('[data-testid="forge-cmd-palette-input"]').fill('fillet').catch(() => {});
  await page.waitForTimeout(600);
  const palette = page.locator('[data-testid="forge-cmd-palette-results"]');
  if (await palette.count()) { try { await palette.screenshot({ path: path.join(OUT, 'detail_palette_results.png') }); } catch (_) {} }
  await page.locator('[data-testid="forge-cmd-palette-input"]').fill('extrude revolve sweep hole pattern mirror').catch(() => {});
  await page.waitForTimeout(500);
  if (await palette.count()) { try { await palette.screenshot({ path: path.join(OUT, 'detail_palette_feature.png') }); } catch (_) {} }
  await page.keyboard.press('Escape').catch(() => {});
  // right inspector strip
  await clip('right_inspector', Math.max(0, vp.width - 240), 0, 240, Math.min(vp.height, 520));
  // status bar
  await clip('status_bar', 0, Math.max(0, vp.height - 36), vp.width, 36);
  await page.evaluate(() => { window.onbeforeunload = null; }).catch(() => {});
  await app.close();
  console.log(`[ui-detail] shots -> ${OUT}`);
});
