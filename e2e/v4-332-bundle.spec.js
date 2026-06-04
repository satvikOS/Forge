// Forge-332 5-calc bundle e2e (pad-eye + horizontal sight + weld group + bolt preload + prestress).
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

test('332a — Pad-eye U = 0.447, PASS', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPadEyeWorkbench && window.__forgeOpenPadEyeWorkbench());
    await page.waitForSelector('[data-testid="forge-pe-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-pe-run"]');
    await page.waitForSelector('[data-testid="forge-pe-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-pe-u"]')).toContainText('U = 0.447');
    await expect(page.locator('[data-testid="forge-pe-ok"]')).toContainText('PASS');
    await page.evaluate(() => window.__forgeClosePadEyeWorkbench && window.__forgeClosePadEyeWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('332b — HSD m_req = 7.97 m (CLEAR)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenHSDWorkbench && window.__forgeOpenHSDWorkbench());
    await page.waitForSelector('[data-testid="forge-hsd-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-hsd-run"]');
    await page.waitForSelector('[data-testid="forge-hsd-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-hsd-mreq"]')).toContainText('m_req = 7.97 m');
    await expect(page.locator('[data-testid="forge-hsd-ok"]')).toContainText('CLEAR');
    await page.evaluate(() => window.__forgeCloseHSDWorkbench && window.__forgeCloseHSDWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('332c — Weld group U = 0.485, PASS', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenWeldGroupWorkbench && window.__forgeOpenWeldGroupWorkbench());
    await page.waitForSelector('[data-testid="forge-wg-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-wg-run"]');
    await page.waitForSelector('[data-testid="forge-wg-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-wg-u"]')).toContainText('U = 0.485');
    await expect(page.locator('[data-testid="forge-wg-ok"]')).toContainText('PASS');
    await page.evaluate(() => window.__forgeCloseWeldGroupWorkbench && window.__forgeCloseWeldGroupWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('332d — Bolt preload P_sep = 44.95 kN', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenBoltPreloadWorkbench && window.__forgeOpenBoltPreloadWorkbench());
    await page.waitForSelector('[data-testid="forge-bpre-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-bpre-run"]');
    await page.waitForSelector('[data-testid="forge-bpre-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-bpre-sep"]')).toContainText('P_sep = 44.95 kN');
    await page.evaluate(() => window.__forgeCloseBoltPreloadWorkbench && window.__forgeCloseBoltPreloadWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('332e — Prestress total loss = 368.1 MPa (26.4 %)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPrestressWorkbench && window.__forgeOpenPrestressWorkbench());
    await page.waitForSelector('[data-testid="forge-prs-panel"]', { timeout: 8000 });
    await page.click('[data-testid="forge-prs-run"]');
    await page.waitForSelector('[data-testid="forge-prs-result"]', { timeout: 5000 });
    await expect(page.locator('[data-testid="forge-prs-tot"]')).toContainText('Total = 368.1 MPa');
    await expect(page.locator('[data-testid="forge-prs-tot"]')).toContainText('26.4 %');
    await page.evaluate(() => window.__forgeClosePrestressWorkbench && window.__forgeClosePrestressWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('332f — Tools menu lists all 5 Forge-332 calcs', async () => {
    await page.evaluate(() => window.__forgeOpenToolsMenu && window.__forgeOpenToolsMenu());
    const txt = await page.locator('body').innerText();
    for (const lbl of ['Pad-eye lifting', 'Horizontal sight distance', 'Welded fillet group',
                       'Bolt preload', 'Prestress losses']) {
        expect(txt).toContain(lbl);
    }
});

test('332g — none of the bundle panels posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
