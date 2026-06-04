// Forge-341 5-calc bundle e2e.
const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');

test.setTimeout(180000);

let app, page;

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() {
    return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
}

test('341a — Soldier pile d_embed = 2.50 m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSoldierPileWorkbench && window.__forgeOpenSoldierPileWorkbench());
    await page.waitForSelector('[data-testid="forge-sp-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-sp-run"]');
    await page.waitForSelector('[data-testid="forge-sp-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-sp-d"]')).toContainText('d_embed = 2.50 m');
    await page.evaluate(() => window.__forgeCloseSoldierPileWorkbench && window.__forgeCloseSoldierPileWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('341b — Round HSS COMPACT, φM_n = 57.40 kN·m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenRoundHSSWorkbench && window.__forgeOpenRoundHSSWorkbench());
    await page.waitForSelector('[data-testid="forge-rh-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-rh-run"]');
    await page.waitForSelector('[data-testid="forge-rh-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-rh-class"]')).toContainText('COMPACT');
    await expect(page.locator('[data-testid="forge-rh-mn"]')).toContainText('φM_n = 57.40 kN·m');
    await page.evaluate(() => window.__forgeCloseRoundHSSWorkbench && window.__forgeCloseRoundHSSWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('341c — Plate HX ε = 0.865, Q = 216.9 kW', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPlateHXWorkbench && window.__forgeOpenPlateHXWorkbench());
    await page.waitForSelector('[data-testid="forge-px-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-px-run"]');
    await page.waitForSelector('[data-testid="forge-px-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-px-eps"]')).toContainText('ε = 0.865');
    await expect(page.locator('[data-testid="forge-px-q"]')).toContainText('Q = 216.9 kW');
    await page.evaluate(() => window.__forgeClosePlateHXWorkbench && window.__forgeClosePlateHXWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('341d — FOSM β = 4.472', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFOSMWorkbench && window.__forgeOpenFOSMWorkbench());
    await page.waitForSelector('[data-testid="forge-fo-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-fo-run"]');
    await page.waitForSelector('[data-testid="forge-fo-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-fo-b"]')).toContainText('β = 4.472');
    await page.evaluate(() => window.__forgeCloseFOSMWorkbench && window.__forgeCloseFOSMWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('341e — Flutter U_cr = 61.1 m/s FLUTTER PREDICTED', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFlutterWorkbench && window.__forgeOpenFlutterWorkbench());
    await page.waitForSelector('[data-testid="forge-fl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-fl-run"]');
    await page.waitForSelector('[data-testid="forge-fl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-fl-ucr"]')).toContainText('U_cr = 61.1 m/s');
    await expect(page.locator('[data-testid="forge-fl-ok"]')).toContainText('FLUTTER PREDICTED');
    await page.evaluate(() => window.__forgeCloseFlutterWorkbench && window.__forgeCloseFlutterWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('341f — Tools menu lists all 5 Forge-341 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Soldier-pile', 'Round HSS bending', 'Plate HX ε-NTU',
                       'FOSM reliability', 'Bridge deck flutter']) {
        expect(txt).toContain(lbl);
    }
});

test('341g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
