const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });
let app, page;
test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
});
test.afterAll(async () => { if (app) await app.close().catch(() => {}); });

test('00 — open panel via tools.datumTargets', async () => {
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    const before = await page.evaluate(() => typeof window.__forgeOpenDatumTargets);
    await page.evaluate(() => window.__forgeOpenDatumTargets?.());
    await page.waitForTimeout(500);
    const panelExists = await page.locator('[data-testid="forge-datum-targets-panel"]').count();
    console.log('[push-176] openHook=', before, 'panelCount=', panelExists, 'errs=', errs);
    fs.mkdirSync(path.join(__dirname, '..', 'e2e-output', 'push-176-datum-targets'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'e2e-output', 'push-176-datum-targets', 'panel.png'), fullPage: true });
    expect(before).toBe('function');
});
