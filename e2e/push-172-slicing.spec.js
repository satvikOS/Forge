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

test('00 — open panel via tools.slicing', async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'tools.slicing' } })));
    await page.waitForSelector('[data-testid="forge-slicing-panel"]', { state: 'visible', timeout: 6000 });
    fs.mkdirSync(path.join(__dirname, '..', 'e2e-output', 'push-172-slicing'), { recursive: true });
    await page.screenshot({ path: path.join(__dirname, '..', 'e2e-output', 'push-172-slicing', 'panel.png'), fullPage: true });
});
