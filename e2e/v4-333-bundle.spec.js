// Forge-333 5-calc bundle e2e (flange + ogee + grounding + response spectrum + buoyancy).
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

test('333a — Flange A_m = 1131 mm², n ≥ 13', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBoltedFlangeWorkbench && window.__forgeOpenBoltedFlangeWorkbench());
    await page.waitForSelector('[data-testid="forge-flg-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-flg-run"]');
    await page.waitForSelector('[data-testid="forge-flg-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-flg-am"]')).toContainText('A_m = 1131 mm²');
    await expect(page.locator('[data-testid="forge-flg-nb"]')).toContainText('n bolts ≥ 13');
    await page.evaluate(() => window.__forgeCloseBoltedFlangeWorkbench && window.__forgeCloseBoltedFlangeWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('333b — Ogee Q = 218.4 m³/s', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenOgeeWorkbench && window.__forgeOpenOgeeWorkbench());
    await page.waitForSelector('[data-testid="forge-og-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-og-run"]');
    await page.waitForSelector('[data-testid="forge-og-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-og-Q"]')).toContainText('Q = 218.4 m³/s');
    await page.evaluate(() => window.__forgeCloseOgeeWorkbench && window.__forgeCloseOgeeWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('333c — Grounding R_g = 6.42 Ω', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenGroundGridWorkbench && window.__forgeOpenGroundGridWorkbench());
    await page.waitForSelector('[data-testid="forge-gg-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-gg-run"]');
    await page.waitForSelector('[data-testid="forge-gg-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-gg-rg"]')).toContainText('R_g = 6.42 Ω');
    await page.evaluate(() => window.__forgeCloseGroundGridWorkbench && window.__forgeCloseGroundGridWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('333d — Response-spectrum peak at T ≈ 0.528 s', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenResponseSpectrumWorkbench && window.__forgeOpenResponseSpectrumWorkbench());
    await page.waitForSelector('[data-testid="forge-rs-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-rs-run"]');
    await page.waitForSelector('[data-testid="forge-rs-result"]', { timeout: 7000 });
    await expect(page.locator('[data-testid="forge-rs-tpeak"]')).toContainText('at T = 0.528 s');
    await page.evaluate(() => window.__forgeCloseResponseSpectrumWorkbench && window.__forgeCloseResponseSpectrumWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('333e — Buoyancy GM = 0.623 m, STABLE', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBuoyancyWorkbench && window.__forgeOpenBuoyancyWorkbench());
    await page.waitForSelector('[data-testid="forge-by-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-by-run"]');
    await page.waitForSelector('[data-testid="forge-by-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-by-gm"]')).toContainText('GM = 0.623 m');
    await expect(page.locator('[data-testid="forge-by-ok"]')).toContainText('STABLE');
    await page.evaluate(() => window.__forgeCloseBuoyancyWorkbench && window.__forgeCloseBuoyancyWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('333f — Tools menu lists all 5 Forge-333 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Bolted flange', 'Spillway ogee', 'Substation grounding',
                       'Response spectrum', 'Floating-body stability']) {
        expect(txt).toContain(lbl);
    }
});

test('333g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
