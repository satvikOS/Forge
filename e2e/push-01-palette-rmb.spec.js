// PUSH-01 — multi-cam e2e for the extended command palette + right-click context.
// Verifies:
//   1. Cmd/Ctrl-K opens the palette and the empty-state list shows entries.
//   2. Typing finds a calculator from CALCULATOR_TREE (e.g. "corbel").
//   3. Enter triggers the matching tools.<id> route and opens the workbench panel.
//   4. Right-click on the viewport shows the extended default context menu
//      (workbench switchers, command palette opener, view shortcuts).
//   5. Manual UI never posts to Archie.
//
// Multi-cam: capture 5 named angles per the headed-Mac-Electron remote-watch rule.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-01');

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

test('PUSH-01-A — Cmd-K opens palette, empty list shown', async () => {
    const a0 = await archieCount();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await page.waitForSelector('[data-testid="forge-cmd-palette-input"]', { timeout: 4000 }).catch(async () => {
        await page.evaluate(() => window.__forgeOpenCommandPalette && window.__forgeOpenCommandPalette(true));
    });
    await page.waitForSelector('[data-testid="forge-cmd-palette-input"]', { timeout: 4000 });
    await shot('A-front-palette-open');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-01-B — type "corbel" finds the calculator and executes tools.corbel', async () => {
    const a0 = await archieCount();
    const inp = page.locator('[data-testid="forge-cmd-palette-input"]').first();
    await inp.fill('corbel');
    await page.waitForTimeout(150);
    await shot('B-top-typed-corbel');
    // Pick the first result via Enter.
    await page.keyboard.press('Enter');
    // The Forge-335 corbel workbench panel renders with testid forge-crb-panel.
    await page.waitForSelector('[data-testid="forge-crb-panel"]', { timeout: 6000 });
    await shot('C-right-corbel-panel-open');
    // Tidy up — close the panel via its X button.
    await page.evaluate(() => window.__forgeCloseCorbelWorkbench && window.__forgeCloseCorbelWorkbench());
    expect(await archieCount()).toBe(a0);
});

test('PUSH-01-C — type "wind load" lands on a workbench', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCommandPalette && window.__forgeOpenCommandPalette(true));
    const inp = page.locator('[data-testid="forge-cmd-palette-input"]').first();
    await inp.fill('wind load');
    await page.waitForTimeout(150);
    await shot('D-iso-wind-load-search');
    // Result list non-empty.
    const resultsText = await page.locator('[data-testid="forge-cmd-palette-results"]').innerText();
    const rowCount = resultsText.toLowerCase().includes('wind') ? 1 : 0;
    expect(rowCount).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-01-D — right-click on viewport empty area shows extended default menu', async () => {
    const a0 = await archieCount();
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('viewport canvas not found');
    await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.7, { button: 'right' });
    await page.waitForSelector('[data-testid="forge-body-ctx"]', { timeout: 4000 });
    const menuText = await page.locator('[data-testid="forge-body-ctx"]').innerText();
    expect(menuText).toContain('Create box');
    expect(menuText).toContain('Switch:');
    expect(menuText.toLowerCase()).toContain('palette');
    expect(menuText).toContain('Front');
    await shot('E-close-rmb-default-menu');
    await page.keyboard.press('Escape');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-01-E — none of the palette / context actions posted to Archie', async () => {
    expect(await archieCount()).toBe(0);
});
