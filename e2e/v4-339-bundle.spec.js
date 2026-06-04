// Forge-339 5-calc bundle e2e.
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

test('339a — CN runoff Q = 41.14 mm', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCNWorkbench && window.__forgeOpenCNWorkbench());
    await page.waitForSelector('[data-testid="forge-cn-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cn-run"]');
    await page.waitForSelector('[data-testid="forge-cn-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cn-Q"]')).toContainText('Q = 41.14 mm');
    await page.evaluate(() => window.__forgeCloseCNWorkbench && window.__forgeCloseCNWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('339b — Waveguide WR-90 PROPAGATING f_c=6.557 GHz', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenWaveguideWorkbench && window.__forgeOpenWaveguideWorkbench());
    await page.waitForSelector('[data-testid="forge-wg-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-wg-run"]');
    await page.waitForSelector('[data-testid="forge-wg-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-wg-fc"]')).toContainText('f_c = 6.557 GHz');
    await expect(page.locator('[data-testid="forge-wg-ok"]')).toContainText('PROPAGATING');
    await page.evaluate(() => window.__forgeCloseWaveguideWorkbench && window.__forgeCloseWaveguideWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('339c — Sluice Q = 4.46 m³/s free flow', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSluiceWorkbench && window.__forgeOpenSluiceWorkbench());
    await page.waitForSelector('[data-testid="forge-sl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-sl-run"]');
    await page.waitForSelector('[data-testid="forge-sl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-sl-Q"]')).toContainText('Q = 4.46 m³/s');
    await expect(page.locator('[data-testid="forge-sl-sub"]')).toContainText('free flow');
    await page.evaluate(() => window.__forgeCloseSluiceWorkbench && window.__forgeCloseSluiceWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('339d — Knock NO KNOCK (T_2=700K < T_a=900K)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenKnockWorkbench && window.__forgeOpenKnockWorkbench());
    await page.waitForSelector('[data-testid="forge-kn-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-kn-run"]');
    await page.waitForSelector('[data-testid="forge-kn-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-kn-ok"]')).toContainText('no knock');
    await page.evaluate(() => window.__forgeCloseKnockWorkbench && window.__forgeCloseKnockWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('339e — NPV $10707, IRR 8.14 %, payback 6.67 yr', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenNPVWorkbench && window.__forgeOpenNPVWorkbench());
    await page.waitForSelector('[data-testid="forge-np-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-np-run"]');
    await page.waitForSelector('[data-testid="forge-np-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-np-npv"]')).toContainText('NPV = $10707');
    await expect(page.locator('[data-testid="forge-np-irr"]')).toContainText('IRR = 8.14 %');
    await page.evaluate(() => window.__forgeCloseNPVWorkbench && window.__forgeCloseNPVWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('339f — Tools menu lists all 5 Forge-339 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['NRCS TR-55', 'Rectangular waveguide', 'Sluice gate',
                       'SI engine knock', 'Project NPV']) {
        expect(txt).toContain(lbl);
    }
});

test('339g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
