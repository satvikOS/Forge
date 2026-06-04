// Forge-331 5-calc bundle e2e (beam reactions + tank anchor + heat pump + base shear + PV shade).
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

test('331a — Beam M_max = 46.67 kN·m, δ = 8.09 mm', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBeamReactionsWorkbench && window.__forgeOpenBeamReactionsWorkbench());
    await page.waitForSelector('[data-testid="forge-bmr-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bmr-run"]');
    await page.waitForSelector('[data-testid="forge-bmr-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bmr-Mmax"]')).toContainText('M_max = 46.67 kN·m');
    await expect(page.locator('[data-testid="forge-bmr-defl"]')).toContainText('δ_max = 8.09 mm');
    await page.evaluate(() => window.__forgeCloseBeamReactionsWorkbench && window.__forgeCloseBeamReactionsWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('331b — Tank SELF-ANCHORED (SF = 9.30, uplift = 0)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenTankAnchorWorkbench && window.__forgeOpenTankAnchorWorkbench());
    await page.waitForSelector('[data-testid="forge-tnk-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-tnk-run"]');
    await page.waitForSelector('[data-testid="forge-tnk-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-tnk-ok"]')).toContainText('SELF-ANCHORED');
    await expect(page.locator('[data-testid="forge-tnk-uplift"]')).toContainText('uplift = 0.00 kN/bolt');
    await page.evaluate(() => window.__forgeCloseTankAnchorWorkbench && window.__forgeCloseTankAnchorWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('331c — Heat-pump COP_actual = 3.48, Q = 10.44 kW', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenHeatPumpWorkbench && window.__forgeOpenHeatPumpWorkbench());
    await page.waitForSelector('[data-testid="forge-hp-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-hp-run"]');
    await page.waitForSelector('[data-testid="forge-hp-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-hp-cop"]')).toContainText('COP_actual = 3.48');
    await expect(page.locator('[data-testid="forge-hp-q"]')).toContainText('Q = 10.44 kW');
    await page.evaluate(() => window.__forgeCloseHeatPumpWorkbench && window.__forgeCloseHeatPumpWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('331d — ASCE base shear V = 3409 kN (capped by C_s,max)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBaseShearWorkbench && window.__forgeOpenBaseShearWorkbench());
    await page.waitForSelector('[data-testid="forge-bs-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bs-run"]');
    await page.waitForSelector('[data-testid="forge-bs-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bs-v"]')).toContainText('V = 3409 kN');
    await page.evaluate(() => window.__forgeCloseBaseShearWorkbench && window.__forgeCloseBaseShearWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('331e — PV horizon SHADED (margin = -3°)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPVShadeWorkbench && window.__forgeOpenPVShadeWorkbench());
    await page.waitForSelector('[data-testid="forge-pvs-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-pvs-run"]');
    await page.waitForSelector('[data-testid="forge-pvs-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pvs-ok"]')).toContainText('SHADED');
    await page.evaluate(() => window.__forgeClosePVShadeWorkbench && window.__forgeClosePVShadeWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('331f — Tools menu lists all 5 Forge-331 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Beam reactions', 'API 650 tank wind', 'Heat-pump COP',
                       'ASCE 7 §12.8', 'PV horizon shading']) {
        expect(txt).toContain(lbl);
    }
});

test('331g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
