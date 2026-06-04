// PUSH-14 — PDM vault end-to-end. Adds a doc, checks out, checks in (v2),
// shows history, rolls back to v1, attaches an ECN. Multi-cam screenshots.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-14');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

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

test('PUSH-14-A — vault panel opens and lists empty', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPDMWorkbench && window.__forgeOpenPDMWorkbench());
    await page.waitForSelector('[data-testid="forge-pdm-panel"]', { timeout: 6000 });
    await page.waitForTimeout(300);
    await shot('A-front-empty-vault');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-B — Add commits the first version', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-pdm-add"]');
    await page.waitForTimeout(500);
    await page.waitForSelector('[data-testid^="forge-pdm-row-doc-"]', { timeout: 4000 });
    await shot('B-top-after-add');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-C — Checkout marks the row CHECKED OUT', async () => {
    const a0 = await archieCount();
    const row = page.locator('[data-testid^="forge-pdm-row-doc-"]').first();
    const docTestId = await row.getAttribute('data-testid');
    const docId = docTestId.replace('forge-pdm-row-', '');
    await page.click(`[data-testid="forge-pdm-checkout-${docId}"]`);
    await page.waitForTimeout(400);
    const after = await row.innerText();
    expect(after).toContain('CHECKED OUT');
    await shot('C-right-checked-out');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-D — Check-in commits v2 and releases lock', async () => {
    const a0 = await archieCount();
    const row = page.locator('[data-testid^="forge-pdm-row-doc-"]').first();
    const docTestId = await row.getAttribute('data-testid');
    const docId = docTestId.replace('forge-pdm-row-', '');
    await page.click(`[data-testid="forge-pdm-checkin-${docId}"]`);
    await page.waitForTimeout(400);
    const after = await row.innerText();
    expect(after).toContain('v2');
    expect(after).toContain('available');
    await shot('D-iso-v2-released');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-E — History shows both versions; rollback to v1 commits v3', async () => {
    const a0 = await archieCount();
    const row = page.locator('[data-testid^="forge-pdm-row-doc-"]').first();
    const docTestId = await row.getAttribute('data-testid');
    const docId = docTestId.replace('forge-pdm-row-', '');
    await page.click(`[data-testid="forge-pdm-history-${docId}"]`);
    await page.waitForSelector('[data-testid="forge-pdm-history"]', { timeout: 4000 });
    await expect(page.locator('[data-testid="forge-pdm-v-1"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pdm-v-2"]')).toBeVisible();
    await page.click('[data-testid="forge-pdm-rollback-1"]');
    await page.waitForTimeout(500);
    const after = await row.innerText();
    expect(after).toContain('v3');
    await shot('E-close-rolled-back');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-F — ECN attaches to the document without error', async () => {
    const a0 = await archieCount();
    const row = page.locator('[data-testid^="forge-pdm-row-doc-"]').first();
    const docTestId = await row.getAttribute('data-testid');
    const docId = docTestId.replace('forge-pdm-row-', '');
    await page.click(`[data-testid="forge-pdm-ecn-${docId}"]`);
    await page.waitForTimeout(300);
    const err = page.locator('[data-testid="forge-pdm-error"]');
    expect(await err.count()).toBe(0);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-14-G — no Archie posts across all PDM actions', async () => {
    expect(await archieCount()).toBe(0);
});
