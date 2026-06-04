// Forge-334 5-calc bundle e2e (vertical curve + clarifier + PV battery + silencer + thrust block).
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

test('334a — Vertical curve L=200 fails SSD (need 254 m)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenVCurveWorkbench && window.__forgeOpenVCurveWorkbench());
    await page.waitForSelector('[data-testid="forge-vc-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-vc-run"]');
    await page.waitForSelector('[data-testid="forge-vc-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-vc-ok"]')).toContainText('INSUFFICIENT SSD');
    await page.evaluate(() => window.__forgeCloseVCurveWorkbench && window.__forgeCloseVCurveWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('334b — Clarifier SOR = 31.83 m/d (secondary FAILS)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenClarifierWorkbench && window.__forgeOpenClarifierWorkbench());
    await page.waitForSelector('[data-testid="forge-cl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cl-run"]');
    await page.waitForSelector('[data-testid="forge-cl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cl-sor"]')).toContainText('SOR = 31.83 m/d');
    await page.evaluate(() => window.__forgeCloseClarifierWorkbench && window.__forgeCloseClarifierWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('334c — PV battery 75 cells, 20.64 kWh', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPVBattWorkbench && window.__forgeOpenPVBattWorkbench());
    await page.waitForSelector('[data-testid="forge-pvb-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-pvb-run"]');
    await page.waitForSelector('[data-testid="forge-pvb-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pvb-total"]')).toContainText('75 cells');
    await page.evaluate(() => window.__forgeClosePVBattWorkbench && window.__forgeClosePVBattWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('334d — Silencer IL = 7.50 dB, ΔP = 19.20 Pa', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSilencerWorkbench && window.__forgeOpenSilencerWorkbench());
    await page.waitForSelector('[data-testid="forge-sil-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-sil-run"]');
    await page.waitForSelector('[data-testid="forge-sil-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-sil-il"]')).toContainText('IL = 7.50 dB');
    await expect(page.locator('[data-testid="forge-sil-dp"]')).toContainText('ΔP = 19.20 Pa');
    await page.evaluate(() => window.__forgeCloseSilencerWorkbench && window.__forgeCloseSilencerWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('334e — Thrust block 90° bend: T = 177.72 kN', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenThrustBlockWorkbench && window.__forgeOpenThrustBlockWorkbench());
    await page.waitForSelector('[data-testid="forge-tb-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-tb-run"]');
    await page.waitForSelector('[data-testid="forge-tb-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-tb-t"]')).toContainText('T = 177.72 kN');
    await page.evaluate(() => window.__forgeCloseThrustBlockWorkbench && window.__forgeCloseThrustBlockWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('334f — Tools menu lists all 5 Forge-334 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Highway vertical curve', 'Wastewater clarifier', 'Off-grid PV battery',
                       'Duct silencer', 'Thrust block']) {
        expect(txt).toContain(lbl);
    }
});

test('334g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
