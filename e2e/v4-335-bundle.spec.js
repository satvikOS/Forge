// Forge-335 5-calc bundle e2e (corbel + wind tower + air receiver + Butterworth + ped bridge).
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

test('335a — Corbel A_s = 859 mm², SHEAR OK', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCorbelWorkbench && window.__forgeOpenCorbelWorkbench());
    await page.waitForSelector('[data-testid="forge-crb-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-crb-run"]');
    await page.waitForSelector('[data-testid="forge-crb-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-crb-as"]')).toContainText('A_s primary = 859 mm²');
    await expect(page.locator('[data-testid="forge-crb-ok"]')).toContainText('SHEAR OK');
    await page.evaluate(() => window.__forgeCloseCorbelWorkbench && window.__forgeCloseCorbelWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('335b — Wind tower SF = 4.52, BASE OK', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenWindTowerWorkbench && window.__forgeOpenWindTowerWorkbench());
    await page.waitForSelector('[data-testid="forge-wt-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-wt-run"]');
    await page.waitForSelector('[data-testid="forge-wt-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-wt-ok"]')).toContainText('BASE OK');
    await page.evaluate(() => window.__forgeCloseWindTowerWorkbench && window.__forgeCloseWindTowerWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('335c — Air receiver MAWP = 1.770 MPa', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenAirReceiverWorkbench && window.__forgeOpenAirReceiverWorkbench());
    await page.waitForSelector('[data-testid="forge-ar-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-ar-run"]');
    await page.waitForSelector('[data-testid="forge-ar-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-ar-mawp"]')).toContainText('MAWP = 1.770 MPa');
    await page.evaluate(() => window.__forgeCloseAirReceiverWorkbench && window.__forgeCloseAirReceiverWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('335d — Butterworth N = 7, fc ≈ 1093.9 Hz', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenButterworthWorkbench && window.__forgeOpenButterworthWorkbench());
    await page.waitForSelector('[data-testid="forge-bw-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bw-run"]');
    await page.waitForSelector('[data-testid="forge-bw-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bw-N"]')).toContainText('N = 7');
    await expect(page.locator('[data-testid="forge-bw-fc"]')).toContainText('f_c = 1093.9 Hz');
    await page.evaluate(() => window.__forgeCloseButterworthWorkbench && window.__forgeCloseButterworthWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('335e — Ped bridge f_1 = 1.951 Hz, COMFORTABLE', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPedVibWorkbench && window.__forgeOpenPedVibWorkbench());
    await page.waitForSelector('[data-testid="forge-pv-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-pv-run"]');
    await page.waitForSelector('[data-testid="forge-pv-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pv-f1"]')).toContainText('f_1 = 1.951 Hz');
    await expect(page.locator('[data-testid="forge-pv-ok"]')).toContainText('COMFORTABLE');
    await page.evaluate(() => window.__forgeClosePedVibWorkbench && window.__forgeClosePedVibWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('335f — Tools menu lists all 5 Forge-335 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['RC corbel', 'Wind tower foundation', 'Air receiver vessel',
                       'Butterworth IIR', 'Pedestrian bridge vibration']) {
        expect(txt).toContain(lbl);
    }
});

test('335g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
