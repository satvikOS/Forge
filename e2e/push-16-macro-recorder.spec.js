// PUSH-16 — Macro recorder + playback end-to-end. Multi-cam.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-16');

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

test('PUSH-16-A — macro panel opens', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMacroRecorder && window.__forgeOpenMacroRecorder());
    await page.waitForSelector('[data-testid="forge-macro-panel"]', { timeout: 5000 });
    await shot('A-front-panel-open');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-B — record captures dispatched events', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-macro-rec"]');
    await page.waitForTimeout(150);
    // Fire 3 synthetic actions.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'view.iso' } }));
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'view.front' } }));
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: 'tools.steelcol' } }));
    });
    await page.waitForTimeout(200);
    await page.click('[data-testid="forge-macro-stop"]');
    const txt = await page.locator('[data-testid="forge-macro-events"]').innerText();
    expect(txt).toContain('view.iso');
    expect(txt).toContain('view.front');
    expect(txt).toContain('tools.steelcol');
    await shot('B-top-captured');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-C — save persists and reloads via window.forge.macros.list', async () => {
    const a0 = await archieCount();
    await page.fill('[data-testid="forge-macro-name"]', 'demo-macro');
    await page.click('[data-testid="forge-macro-save"]');
    await page.waitForTimeout(150);
    const list = await page.evaluate(() => window.forge && window.forge.macros && window.forge.macros.list && window.forge.macros.list());
    expect(list).toBeTruthy();
    expect(list['demo-macro']).toBeTruthy();
    expect(Array.isArray(list['demo-macro'].events)).toBeTruthy();
    expect(list['demo-macro'].events.length).toBeGreaterThan(0);
    await shot('C-right-saved');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-D — playback dispatches events through forge:menu-action', async () => {
    const a0 = await archieCount();
    // Set up a tap to count dispatched IDs.
    await page.evaluate(() => {
        window.__playbackTap = [];
        window.__playbackHandler = (e) => {
            const id = e?.detail?.id;
            if (typeof id === 'string') window.__playbackTap.push(id);
        };
        window.addEventListener('forge:menu-action', window.__playbackHandler);
    });
    await page.evaluate(() => window.forge && window.forge.macros && window.forge.macros.run && window.forge.macros.run('demo-macro', { stepDelay: 30 }));
    await page.waitForTimeout(600);
    const tap = await page.evaluate(() => {
        window.removeEventListener('forge:menu-action', window.__playbackHandler);
        return window.__playbackTap;
    });
    expect(tap.length).toBeGreaterThanOrEqual(3);
    expect(tap.includes('view.iso')).toBeTruthy();
    await shot('D-iso-replayed');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-E — Cmd-K → "macros" finds the entry', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCommandPalette && window.__forgeOpenCommandPalette(true));
    await page.waitForSelector('[data-testid="forge-cmd-palette-input"]', { timeout: 4000 });
    await page.fill('[data-testid="forge-cmd-palette-input"]', 'macro');
    await page.waitForTimeout(150);
    const txt = await page.locator('[data-testid="forge-cmd-palette-results"]').innerText();
    expect(txt.toLowerCase()).toContain('macro');
    await shot('E-close-palette-find');
    await page.keyboard.press('Escape');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-F — delete cleans the saved macro', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMacroRecorder && window.__forgeOpenMacroRecorder());
    await page.click('[data-testid="forge-macro-delete-demo-macro"]');
    await page.waitForTimeout(200);
    const list = await page.evaluate(() => window.forge && window.forge.macros && window.forge.macros.list && window.forge.macros.list());
    expect(list['demo-macro']).toBeUndefined();
    expect(await archieCount()).toBe(a0);
});

test('PUSH-16-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
