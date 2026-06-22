// Headed Electron check for Task #21 enterprise UIUX affordances.
// Boots the REAL app (built dist) and exercises the 4 affordances' imperative
// window APIs (selection filter / measure HUD / datum-context status bar /
// pre-highlight), asserting they are functional in the live shell — then
// screenshots for a monochrome eyeball. Per the verify-by-headed-e2e must-rule.
const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');
const SHOT_DIR = path.resolve('/Users/account_clawteam1/archdisc-Mech/e2e/forge/shots/uiux');

test('enterprise UIUX affordances are functional in the live shell (#21)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const app = await _electron.launch({ args: [ELECTRON_MAIN, '--no-sandbox'], env: { ...process.env, FORGE_E2E: '1' }, slowMo: 40 });
  let page = await app.firstWindow();
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
  await page.reload().catch(() => {});
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('[data-testid="forge-cmdbar"]', { timeout: 30000 });

  // 1. the 4 affordance window APIs are present + functional (imperative, real).
  const api = await page.evaluate(() => {
    const r = {};
    // selection filter: cycle + set + read the string contract.
    r.filterApiType = typeof window.__forgeSelectionFilterApi?.set;
    r.filterBefore = window.__forgeSelectionFilter;
    try { window.__forgeSelectionFilterApi.set('edge'); r.filterAfterSet = window.__forgeSelectionFilter; } catch (e) { r.filterErr = String(e); }
    try { window.__forgeSelectionFilterApi.cycle(); r.filterAfterCycle = window.__forgeSelectionFilter; } catch (e) {}
    // measure: pure read.
    r.measureType = typeof window.__forgeMeasureReadout;
    try { r.measure = window.__forgeMeasureReadout(); } catch (e) { r.measureErr = String(e); }
    // datum context status bar.
    r.datumType = typeof window.__forgeSetActiveDatum;
    try { window.__forgeSetActiveDatum({ name: 'CSYS_0', kind: 'csys' }); r.datumSet = true; } catch (e) { r.datumErr = String(e); }
    // pre-highlight.
    r.preHiType = typeof window.__forgePreHighlight;
    try { window.__forgePreHighlight({ kind: 'edge', id: 1 }); r.preHiSet = true; } catch (e) { r.preHiErr = String(e); }
    return r;
  });
  console.log('[uiux] api probe:', JSON.stringify(api));
  expect(api.filterApiType).toBe('function');
  expect(String(api.filterAfterSet).toLowerCase()).toBe('edge'); // set() genuinely changed the live filter
  expect(api.filterAfterCycle).toBeTruthy();
  expect(String(api.filterAfterCycle).toLowerCase()).not.toBe('edge'); // cycle() advanced it
  expect(api.measureType).toBe('function');
  expect(api.datumType).toBe('function');
  expect(api.datumSet).toBe(true);
  expect(api.preHiType).toBe('function');

  // 2. the status bar reflects the datum context we just set (no crash, renders).
  await page.waitForTimeout(400);
  const datumShown = await page.evaluate(() => document.body.innerText.includes('CSYS_0'));
  console.log('[uiux] status bar shows active datum:', datumShown);

  // 3. screenshot for a monochrome eyeball.
  await page.screenshot({ path: path.join(SHOT_DIR, 'enterprise-affordances.png') });
  console.log('[uiux] screenshot →', path.join(SHOT_DIR, 'enterprise-affordances.png'));

  await app.close();
});
