// Forge-336 5-calc bundle e2e (pipe network + torsional vib + pier scour + economizer + fiber link).
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

test('336a — Pipe network converged', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPipeNetWorkbench && window.__forgeOpenPipeNetWorkbench());
    await page.waitForSelector('[data-testid="forge-pn-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-pn-run"]');
    await page.waitForSelector('[data-testid="forge-pn-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pn-conv"]')).toContainText('converged');
    await page.evaluate(() => window.__forgeClosePipeNetWorkbench && window.__forgeClosePipeNetWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('336b — Torsional vibration mode 1 ≈ 19.49 Hz', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenTorVibWorkbench && window.__forgeOpenTorVibWorkbench());
    await page.waitForSelector('[data-testid="forge-tv-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-tv-run"]');
    await page.waitForSelector('[data-testid="forge-tv-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-tv-mode1"]')).toContainText('19.49 Hz');
    await page.evaluate(() => window.__forgeCloseTorVibWorkbench && window.__forgeCloseTorVibWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('336c — Pier scour y_s = 4.75 m', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPierScourWorkbench && window.__forgeOpenPierScourWorkbench());
    await page.waitForSelector('[data-testid="forge-ps-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-ps-run"]');
    await page.waitForSelector('[data-testid="forge-ps-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-ps-ys"]')).toContainText('y_s = 4.75 m');
    await page.evaluate(() => window.__forgeClosePierScourWorkbench && window.__forgeClosePierScourWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('336d — Economizer ACTIVE, Q_free = 54.85 kW', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenEconomizerWorkbench && window.__forgeOpenEconomizerWorkbench());
    await page.waitForSelector('[data-testid="forge-ec-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-ec-run"]');
    await page.waitForSelector('[data-testid="forge-ec-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-ec-ok"]')).toContainText('ECONOMIZER ACTIVE');
    await expect(page.locator('[data-testid="forge-ec-q"]')).toContainText('Q_free = 54.85 kW');
    await page.evaluate(() => window.__forgeCloseEconomizerWorkbench && window.__forgeCloseEconomizerWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('336e — Fiber link margin 6 dB, L_max = 110 km', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenFiberLinkWorkbench && window.__forgeOpenFiberLinkWorkbench());
    await page.waitForSelector('[data-testid="forge-fl-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-fl-run"]');
    await page.waitForSelector('[data-testid="forge-fl-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-fl-margin"]')).toContainText('margin = 6.0 dB');
    await expect(page.locator('[data-testid="forge-fl-max"]')).toContainText('L_max = 110 km');
    await page.evaluate(() => window.__forgeCloseFiberLinkWorkbench && window.__forgeCloseFiberLinkWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('336f — Tools menu lists all 5 Forge-336 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Pipe network Hardy Cross', 'Torsional vibration', 'Bridge pier scour',
                       'Air-side economizer', 'Fiber link budget']) {
        expect(txt).toContain(lbl);
    }
});

test('336g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
