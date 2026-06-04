// Forge-330 5-calc bundle e2e (slope + IC engine + daylight + mass-haul + rail beam).
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

test('330a — Slope infinite FS = 1.238 (dry, β=25°, φ=30°)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenSlopeWorkbench && window.__forgeOpenSlopeWorkbench());
    await page.waitForSelector('[data-testid="forge-slp-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-slp-run"]');
    await page.waitForSelector('[data-testid="forge-slp-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-slp-fs"]')).toContainText('FS = 1.238');
    await expect(page.locator('[data-testid="forge-slp-ok"]')).toContainText('UNSTABLE');
    await page.evaluate(() => window.__forgeCloseSlopeWorkbench && window.__forgeCloseSlopeWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('330b — IC engine BMEP = 1131 kPa, P_b = 56.5 kW', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenEnginePerfWorkbench && window.__forgeOpenEnginePerfWorkbench());
    await page.waitForSelector('[data-testid="forge-eng-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-eng-run"]');
    await page.waitForSelector('[data-testid="forge-eng-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-eng-pb"]')).toContainText('P_b = 56.5 kW');
    await page.evaluate(() => window.__forgeCloseEnginePerfWorkbench && window.__forgeCloseEnginePerfWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('330c — Daylight factor DF = 2.61 %, LEED 2 % PASS', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenDaylightWorkbench && window.__forgeOpenDaylightWorkbench());
    await page.waitForSelector('[data-testid="forge-dl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-dl-run"]');
    await page.waitForSelector('[data-testid="forge-dl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-dl-df"]')).toContainText('DF = 2.61 %');
    await expect(page.locator('[data-testid="forge-dl-leed"]')).toContainText('PASS');
    await page.evaluate(() => window.__forgeCloseDaylightWorkbench && window.__forgeCloseDaylightWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('330d — Mass-haul net = 527.8 m³ waste', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMassHaulWorkbench && window.__forgeOpenMassHaulWorkbench());
    await page.waitForSelector('[data-testid="forge-mh-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-mh-run"]');
    await page.waitForSelector('[data-testid="forge-mh-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-mh-net"]')).toContainText('net = 527.8 m³ (waste)');
    await page.evaluate(() => window.__forgeCloseMassHaulWorkbench && window.__forgeCloseMassHaulWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('330e — Rail beam σ_max = 96.2 MPa', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenRailBeamWorkbench && window.__forgeOpenRailBeamWorkbench());
    await page.waitForSelector('[data-testid="forge-rbl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-rbl-run"]');
    await page.waitForSelector('[data-testid="forge-rbl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-rbl-sigma"]')).toContainText('σ_max = 96.2 MPa');
    await page.evaluate(() => window.__forgeCloseRailBeamWorkbench && window.__forgeCloseRailBeamWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('330f — Tools menu lists all 5 Forge-330 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Infinite-slope stability', 'IC engine BMEP',
                       'Daylight factor', 'Earthwork mass-haul', 'Rail beam-on-foundation']) {
        expect(txt).toContain(lbl);
    }
});

test('330g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
