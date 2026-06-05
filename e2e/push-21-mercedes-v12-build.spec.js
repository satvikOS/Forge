// PUSH-21 — Mercedes-Benz M120 6.0L V12 engine build, click-and-keyboard
// only. No page.evaluate calls into window.forge for geometry — every
// part comes from a real button click on the V12EngineBuilder panel.
//
// What the remote-desktop watcher sees:
//
//   00 — Forge boot, onboarding dismissed.
//   01 — Cmd-K palette opens; user types "Mercedes M120" to find the
//        engine builder workbench under "Reference projects".
//   02 — Builder panel mounts: bore Ø89, stroke 80.2, 60°V, 7 mains.
//   03..28 — User clicks "Add part" 25 more times: 12 bores + 7 mains +
//            6 throws. The top-down plan-view SVG fills in cylinder
//            circles colour-coded by role; the parts list grows.
//   29 — Final state with V12 visible in the 2-D plan; counts 12/7/6.
//
// Pacing is slowed (≥600 ms between clicks, longer at milestones) so a
// human watching remotely can follow each part landing in the panel.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-21-mercedes-v12');
const TOTAL_PARTS = 25;        // 12 bores + 7 mains + 6 throws

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

async function pause(ms = 600) { await page.waitForTimeout(ms); }

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
});

test.afterAll(async () => {
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('M120-00 — Forge boot + dismiss onboarding', async () => {
    await shot('00-loaded');
    // Try clicking the welcome dialog away.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) {
        await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    } else {
        await page.keyboard.press('Escape');
    }
    await pause(900);
    await shot('00b-cleared');
});

test('M120-01 — open palette + search engine builder', async () => {
    await page.keyboard.press('Meta+K');
    await pause(700);
    await shot('01a-palette-open');
    await page.keyboard.type('Mercedes M120', { delay: 70 });
    await pause(700);
    await shot('01b-palette-typed');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="forge-v12-panel"]', { timeout: 8000 });
    await pause(900);
    await shot('01c-builder-open');
});

test('M120-02 — initial state shows 0 / 25 parts', async () => {
    const count = await page.locator('[data-testid="forge-v12-count"]').innerText();
    expect(count).toBe('0');
    const note = await page.locator('[data-testid="forge-v12-next-note"]').innerText();
    expect(note).toContain('Cyl 1 bank L');
    await shot('02-initial');
});

test('M120-03 — build first 6 bores (left bank front to rear)', async () => {
    for (let i = 0; i < 6; i += 1) {
        await page.locator('[data-testid="forge-v12-add-one"]').click();
        await pause(450);
    }
    const count = await page.locator('[data-testid="forge-v12-count"]').innerText();
    expect(parseInt(count, 10)).toBeGreaterThanOrEqual(6);
    await pause(900);
    await shot('03-six-bores');
});

test('M120-04 — finish all 12 bores (alternating L/R banks)', async () => {
    for (let i = 0; i < 6; i += 1) {
        await page.locator('[data-testid="forge-v12-add-one"]').click();
        await pause(450);
    }
    const bores = await page.locator('[data-testid="forge-v12-bore-count"]').innerText();
    expect(parseInt(bores, 10)).toBe(12);
    await pause(1000);
    await shot('04-twelve-bores');
});

test('M120-05 — build 7 main bearings (along crank centerline)', async () => {
    for (let i = 0; i < 7; i += 1) {
        await page.locator('[data-testid="forge-v12-add-one"]').click();
        await pause(500);
    }
    const mains = await page.locator('[data-testid="forge-v12-main-count"]').innerText();
    expect(parseInt(mains, 10)).toBe(7);
    await pause(1200);
    await shot('05-mains');
});

test('M120-06 — build 6 crank throws (60° intervals)', async () => {
    for (let i = 0; i < 6; i += 1) {
        await page.locator('[data-testid="forge-v12-add-one"]').click();
        await pause(550);
    }
    const throws = await page.locator('[data-testid="forge-v12-throw-count"]').innerText();
    expect(parseInt(throws, 10)).toBe(6);
    await pause(1200);
    await shot('06-throws');
});

test('M120-07 — final V12 complete', async () => {
    const count = await page.locator('[data-testid="forge-v12-count"]').innerText();
    expect(parseInt(count, 10)).toBe(TOTAL_PARTS);
    const note = await page.locator('[data-testid="forge-v12-next-note"]').innerText();
    expect(note).toContain('complete');
    await pause(1500);
    await shot('07-v12-complete');
});

test('M120-08 — wide final shot of the panel', async () => {
    await pause(900);
    await shot('08-final-wide');
});

test('M120-09 — no Archie posts during the build', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
