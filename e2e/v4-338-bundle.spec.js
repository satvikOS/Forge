// Forge-338 5-calc bundle e2e.
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

test('338a — Composite slab φMn = 505.3 kN·m, PARTIAL', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCompSlabWorkbench && window.__forgeOpenCompSlabWorkbench());
    await page.waitForSelector('[data-testid="forge-cs-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cs-run"]');
    await page.waitForSelector('[data-testid="forge-cs-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cs-mn"]')).toContainText('φM_n = 505.3 kN·m');
    await expect(page.locator('[data-testid="forge-cs-ok"]')).toContainText('PARTIAL');
    await page.evaluate(() => window.__forgeCloseCompSlabWorkbench && window.__forgeCloseCompSlabWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('338b — Reverberation T_60 = 0.644 s', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenReverbWorkbench && window.__forgeOpenReverbWorkbench());
    await page.waitForSelector('[data-testid="forge-rv-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-rv-run"]');
    await page.waitForSelector('[data-testid="forge-rv-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-rv-t60"]')).toContainText('T_60 = 0.644 s');
    await page.evaluate(() => window.__forgeCloseReverbWorkbench && window.__forgeCloseReverbWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('338c — Methane T_ad = 2313 K', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFlameWorkbench && window.__forgeOpenFlameWorkbench());
    await page.waitForSelector('[data-testid="forge-fl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-fl-run"]');
    await page.waitForSelector('[data-testid="forge-fl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-fl-tad"]')).toContainText('T_ad = 2313 K');
    await page.evaluate(() => window.__forgeCloseFlameWorkbench && window.__forgeCloseFlameWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('338d — MSE T_max = 11.66 kN/m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMSEPullWorkbench && window.__forgeOpenMSEPullWorkbench());
    await page.waitForSelector('[data-testid="forge-msp-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-msp-run"]');
    await page.waitForSelector('[data-testid="forge-msp-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-msp-t"]')).toContainText('T_max = 11.66 kN/m');
    await page.evaluate(() => window.__forgeCloseMSEPullWorkbench && window.__forgeCloseMSEPullWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('338e — Bayes mean θ = 0.588, CI = [0.425, 0.751]', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBayesWorkbench && window.__forgeOpenBayesWorkbench());
    await page.waitForSelector('[data-testid="forge-by-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-by-run"]');
    await page.waitForSelector('[data-testid="forge-by-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-by-mean"]')).toContainText('mean θ = 0.588');
    await expect(page.locator('[data-testid="forge-by-ci"]')).toContainText('CI = [0.425, 0.751]');
    await page.evaluate(() => window.__forgeCloseBayesWorkbench && window.__forgeCloseBayesWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('338f — Tools menu lists all 5 Forge-338 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Composite floor slab', 'Sabine reverberation', 'Adiabatic flame',
                       'MSE wall pullout', 'Bayesian beta-binomial']) {
        expect(txt).toContain(lbl);
    }
});

test('338g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
