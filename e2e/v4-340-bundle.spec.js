// Forge-340 5-calc bundle e2e.
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

test('340a — CMU shear φV_n = 607.3 kN OK', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCMUShearWorkbench && window.__forgeOpenCMUShearWorkbench());
    await page.waitForSelector('[data-testid="forge-cmsh-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cmsh-run"]');
    await page.waitForSelector('[data-testid="forge-cmsh-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cmsh-vn"]')).toContainText('φV_n = 607.3 kN');
    await expect(page.locator('[data-testid="forge-cmsh-ok"]')).toContainText('OK');
    await page.evaluate(() => window.__forgeCloseCMUShearWorkbench && window.__forgeCloseCMUShearWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('340b — Slip-critical φR_n = 288.83 kN', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSlipCritWorkbench && window.__forgeOpenSlipCritWorkbench());
    await page.waitForSelector('[data-testid="forge-sc-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-sc-run"]');
    await page.waitForSelector('[data-testid="forge-sc-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-sc-rn"]')).toContainText('φR_n total = 288.83 kN');
    await page.evaluate(() => window.__forgeCloseSlipCritWorkbench && window.__forgeCloseSlipCritWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('340c — Chilled beam Q_total = 0.511 kW (OA undersized)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenChBeamWorkbench && window.__forgeOpenChBeamWorkbench());
    await page.waitForSelector('[data-testid="forge-cb-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-cb-run"]');
    await page.waitForSelector('[data-testid="forge-cb-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-cb-q"]')).toContainText('Q_total = 0.511 kW');
    await expect(page.locator('[data-testid="forge-cb-ok"]')).toContainText('OA UNDERSIZED');
    await page.evaluate(() => window.__forgeCloseChBeamWorkbench && window.__forgeCloseChBeamWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('340d — Weld HI = 0.787 kJ/mm', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenWeldHIWorkbench && window.__forgeOpenWeldHIWorkbench());
    await page.waitForSelector('[data-testid="forge-whi-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-whi-run"]');
    await page.waitForSelector('[data-testid="forge-whi-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-whi-hi"]')).toContainText('HI = 0.787 kJ/mm');
    await page.evaluate(() => window.__forgeCloseWeldHIWorkbench && window.__forgeCloseWeldHIWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('340e — Markov stationary π* = [0.8333, 0.1667]', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMarkovWorkbench && window.__forgeOpenMarkovWorkbench());
    await page.waitForSelector('[data-testid="forge-mk-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-mk-run"]');
    await page.waitForSelector('[data-testid="forge-mk-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-mk-pi"]')).toContainText('π* = [0.8333, 0.1667]');
    await expect(page.locator('[data-testid="forge-mk-ok"]')).toContainText('converged');
    await page.evaluate(() => window.__forgeCloseMarkovWorkbench && window.__forgeCloseMarkovWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('340f — Tools menu lists all 5 Forge-340 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['CMU in-plane shear', 'Slip-critical bolts', 'Active chilled beam',
                       'Weld heat input', 'Markov chain stationary']) {
        expect(txt).toContain(lbl);
    }
});

test('340g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
