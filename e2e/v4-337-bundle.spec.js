// Forge-337 5-calc bundle e2e.
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

test('337a — Biaxial footing σ_max = 316.67 kPa', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBiaxFootWorkbench && window.__forgeOpenBiaxFootWorkbench());
    await page.waitForSelector('[data-testid="forge-bf-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bf-run"]');
    await page.waitForSelector('[data-testid="forge-bf-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bf-max"]')).toContainText('σ_max = 316.67 kPa');
    await page.evaluate(() => window.__forgeCloseBiaxFootWorkbench && window.__forgeCloseBiaxFootWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('337b — Aluminum 6061-T6 F_a = 115.64 MPa', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenADMWorkbench && window.__forgeOpenADMWorkbench());
    await page.waitForSelector('[data-testid="forge-adm-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-adm-run"]');
    await page.waitForSelector('[data-testid="forge-adm-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-adm-fa"]')).toContainText('F_a = 115.64 MPa');
    await page.evaluate(() => window.__forgeCloseADMWorkbench && window.__forgeCloseADMWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('337c — Morison F_res = 15.94 kN/m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMorisonWorkbench && window.__forgeOpenMorisonWorkbench());
    await page.waitForSelector('[data-testid="forge-mr-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-mr-run"]');
    await page.waitForSelector('[data-testid="forge-mr-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-mr-res"]')).toContainText('F_res = 15.94 kN/m');
    await page.evaluate(() => window.__forgeCloseMorisonWorkbench && window.__forgeCloseMorisonWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('337d — Fourier T(5mm,10s) = 461.6 °C', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFourierWorkbench && window.__forgeOpenFourierWorkbench());
    await page.waitForSelector('[data-testid="forge-fh-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-fh-run"]');
    await page.waitForSelector('[data-testid="forge-fh-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-fh-T"]')).toContainText('T(x,t) = 461.6 °C');
    await page.evaluate(() => window.__forgeCloseFourierWorkbench && window.__forgeCloseFourierWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('337e — SA Rosenbrock converges near (1, 1)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSAWorkbench && window.__forgeOpenSAWorkbench());
    await page.waitForSelector('[data-testid="forge-sa-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-sa-run"]');
    await page.waitForSelector('[data-testid="forge-sa-result"]', { timeout: 7000 });
    const txt = await page.locator('[data-testid="forge-sa-pt"]').innerText();
    const m = txt.match(/\(([-\d.]+),\s*([-\d.]+)\)/);
    expect(m).not.toBeNull();
    expect(Math.abs(parseFloat(m[1]) - 1.0)).toBeLessThan(0.5);
    expect(Math.abs(parseFloat(m[2]) - 1.0)).toBeLessThan(0.5);
    await page.evaluate(() => window.__forgeCloseSAWorkbench && window.__forgeCloseSAWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('337f — Tools menu lists all 5 Forge-337 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Biaxial footing', 'Aluminum extrusion', 'Morison wave force',
                       'Semi-infinite heat', 'Simulated annealing']) {
        expect(txt).toContain(lbl);
    }
});

test('337g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
