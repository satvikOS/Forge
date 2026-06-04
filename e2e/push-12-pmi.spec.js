// PUSH-12 — PMI / GD&T workbench e2e.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-12');

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

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('PUSH-12-A — panel opens with 7 tabs', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForSelector('[data-testid="forge-pmi-panel"]', { timeout: 6000 });
    for (const t of ['fcf', 'datum', 'linear', 'angular', 'surface', 'list', 'export']) {
        await expect(page.locator(`[data-testid="forge-pmi-tab-${t}"]`)).toBeVisible();
    }
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-B — symbols list includes flatness ⏥ + perpendicularity ⊥', async () => {
    const a0 = await archieCount();
    const syms = await page.evaluate(() => window.forge.pmi.symbols());
    expect(syms.length).toBe(14);
    expect(syms.find((s) => s.id === 'flatness').symbol).toBe('⏥');
    expect(syms.find((s) => s.id === 'perpendicularity').symbol).toBe('⊥');
    expect(syms.find((s) => s.id === 'position').symbol).toBe('⌖');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-C — add FCF flatness 0.05 mm', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-pmi-tab-fcf"]');
    await page.selectOption('[data-testid="forge-pmi-char"]', 'flatness');
    await page.fill('[data-testid="forge-pmi-tol"]', '0.05');
    await page.fill('[data-testid="forge-pmi-datums"]', 'A,B,C');
    await page.click('[data-testid="forge-pmi-fcf-add"]');
    await page.waitForTimeout(120);
    const list = await page.evaluate(() => window.forge.pmi.list());
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe('fcf');
    expect(list[0].characteristic).toBe('flatness');
    expect(list[0].toleranceValue).toBe(0.05);
    expect(list[0].datumRefs).toEqual(['A', 'B', 'C']);
    await shot('B-top-fcf-added');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-D — add datum A + linear + angular + surface', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-pmi-tab-datum"]');
    await page.fill('[data-testid="forge-pmi-datum-letter"]', 'A');
    await page.click('[data-testid="forge-pmi-datum-add"]');
    await page.click('[data-testid="forge-pmi-tab-linear"]');
    await page.fill('[data-testid="forge-pmi-linear-nom"]', '50');
    await page.fill('[data-testid="forge-pmi-linear-plus"]', '0.1');
    await page.fill('[data-testid="forge-pmi-linear-minus"]', '0.1');
    await page.click('[data-testid="forge-pmi-linear-add"]');
    await page.click('[data-testid="forge-pmi-tab-angular"]');
    await page.fill('[data-testid="forge-pmi-ang-nom"]', '45');
    await page.fill('[data-testid="forge-pmi-ang-plus"]', '0.5');
    await page.fill('[data-testid="forge-pmi-ang-minus"]', '0.5');
    await page.click('[data-testid="forge-pmi-angular-add"]');
    await page.click('[data-testid="forge-pmi-tab-surface"]');
    await page.fill('[data-testid="forge-pmi-surface-ra"]', '1.6');
    await page.click('[data-testid="forge-pmi-surface-add"]');
    const list = await page.evaluate(() => window.forge.pmi.list());
    expect(list.length).toBe(5);
    expect(list.map((a) => a.kind).sort()).toEqual(['angular', 'datum', 'fcf', 'linear', 'surface'].sort());
    await shot('C-right-multi-added');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-E — list tab shows all 5; delete removes one', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-pmi-tab-list"]');
    const items = await page.locator('[data-testid^="forge-pmi-item-"]').count();
    expect(items).toBe(5);
    await page.click('[data-testid="forge-pmi-del-ann-0001"]');
    await page.waitForTimeout(150);
    const remaining = await page.evaluate(() => window.forge.pmi.list().length);
    expect(remaining).toBe(4);
    await shot('D-iso-after-delete');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-F — export Y14.41 text includes FCF + DATUM + LINEAR markers', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-pmi-tab-export"]');
    await page.waitForSelector('[data-testid="forge-pmi-preview"]', { timeout: 3000 });
    const txt = await page.locator('[data-testid="forge-pmi-preview"]').innerText();
    expect(txt).toContain('DATUM');
    expect(txt).toContain('LINEAR');
    expect(txt).toContain('ANGULAR');
    expect(txt).toContain('SURFACE');
    expect(txt).toContain('Y14.41');
    await shot('E-close-export-preview');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-12-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
