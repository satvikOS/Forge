// Forge-329 5-calc bundle e2e (geothermal + tension + bolted timber + conveyor + drift).
// Headed Mac-Electron; verifies (a) all 5 panels open + compute exact values from kernel
// smoke, (b) Tools menu lists 5 entries, (c) NONE of the panels posts to Archie.

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

test('329a — Geothermal bore length 35 kW → 1145 m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenGeothermalWorkbench && window.__forgeOpenGeothermalWorkbench());
    await page.waitForSelector('[data-testid="forge-geo-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-geo-run"]');
    await page.waitForSelector('[data-testid="forge-geo-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-geo-L"]')).toContainText('1145 m');
    await expect(page.locator('[data-testid="forge-geo-mton"]')).toContainText('115.1 m/ton');
    await page.evaluate(() => window.__forgeCloseGeothermalWorkbench && window.__forgeCloseGeothermalWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('329b — Tension member shear-lag U=0.9, P_d=516.4 kN', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenTensionWorkbench && window.__forgeOpenTensionWorkbench());
    await page.waitForSelector('[data-testid="forge-ten-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-ten-run"]');
    await page.waitForSelector('[data-testid="forge-ten-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-ten-Pd"]')).toContainText('P_d = 516.4 kN');
    await page.evaluate(() => window.__forgeCloseTensionWorkbench && window.__forgeCloseTensionWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('329c — Bolted timber Z·C_D = 19.07 kN', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBoltedTimberWorkbench && window.__forgeOpenBoltedTimberWorkbench());
    await page.waitForSelector('[data-testid="forge-bt-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bt-run"]');
    await page.waitForSelector('[data-testid="forge-bt-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bt-Zadj"]')).toContainText('Z·C_D = 19.07 kN');
    await page.evaluate(() => window.__forgeCloseBoltedTimberWorkbench && window.__forgeCloseBoltedTimberWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('329d — Conveyor power P = 14.40 kW', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenConveyorWorkbench && window.__forgeOpenConveyorWorkbench());
    await page.waitForSelector('[data-testid="forge-cnv-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cnv-run"]');
    await page.waitForSelector('[data-testid="forge-cnv-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cnv-P"]')).toContainText('P = 14.40 kW');
    await page.evaluate(() => window.__forgeCloseConveyorWorkbench && window.__forgeCloseConveyorWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('329e — Tall-building drift WITHIN LIMIT', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenDriftWorkbench && window.__forgeOpenDriftWorkbench());
    await page.waitForSelector('[data-testid="forge-drf-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-drf-run"]');
    await page.waitForSelector('[data-testid="forge-drf-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-drf-ok"]')).toContainText('WITHIN LIMIT');
    await page.evaluate(() => window.__forgeCloseDriftWorkbench && window.__forgeCloseDriftWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('329f — Tools menu lists all 5 Forge-329 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Geothermal bore length', 'Tension member shear-lag', 'Bolted timber',
                       'Conveyor belt power', 'Tall-building drift']) {
        expect(txt).toContain(lbl);
    }
});

test('329g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
