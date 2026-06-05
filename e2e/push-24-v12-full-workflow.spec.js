// PUSH-24 — Mercedes M120 V12 full 24-stage CAD workflow.
//
// Single persistent Forge session. EVERY interaction is mouse-click or
// keyboard input — no page.evaluate(window.forge.*) calls for the actual
// CAD work. The platform panel does all the engineering when its buttons
// are clicked.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(600000);                              // 10 min budget
test.describe.configure({ mode: 'serial' });

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-24-v12-full');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 700) { await page.waitForTimeout(ms); }

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);

    // Dismiss onboarding by clicking the visible "Set" button (or Escape).
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(800);
});

test.afterAll(async () => {
    try { await pause(3000); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — Forge ready, viewport empty', async () => {
    await shot('00-forge-empty');
});

test('01 — open command palette and search for V12 full workflow', async () => {
    await page.keyboard.press('Meta+K');
    await pause(600);
    await shot('01a-palette-empty');
    await page.keyboard.type('M120 V12 full', { delay: 60 });
    await pause(800);
    await shot('01b-palette-typed');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="forge-v12full-panel"]', { timeout: 8000 });
    await pause(800);
    await shot('01c-panel-open');
});

test('02 — verify spec is loaded in panel header', async () => {
    const header = await page.locator('[data-testid="forge-v12full-panel"]').innerText();
    expect(header).toContain('Mercedes-Benz M120');
    expect(header).toContain('5987');           // displacement cc
    expect(header).toContain('389');            // hp
    expect(header).toContain('6800');           // redline
    await shot('02-spec-loaded');
});

test('03 — click stages 1-7: crank build (sketch → extrude → pattern → fillet → material)', async () => {
    for (let i = 1; i <= 7; i += 1) {
        await page.locator(`[data-testid="forge-v12full-stage-${i}"]`).click();
        await page.waitForFunction(
            (id) => {
                const el = document.querySelector(`[data-testid="forge-v12full-stage-${id}"]`);
                return el && /[✓✗]/.test(el.textContent);
            },
            i, { timeout: 30000 },
        );
        await pause(400);
        if (i === 3) await shot('03a-mains-done');
        if (i === 4) await shot('03b-throws-done');
    }
    await shot('03c-crank-done');
});

test('04 — click stages 8-14: block build (sketch bore → bank A → bank B → cut → fillet → material)', async () => {
    for (let i = 8; i <= 14; i += 1) {
        await page.locator(`[data-testid="forge-v12full-stage-${i}"]`).click();
        await page.waitForFunction(
            (id) => {
                const el = document.querySelector(`[data-testid="forge-v12full-stage-${id}"]`);
                return el && /[✓✗]/.test(el.textContent);
            },
            i, { timeout: 30000 },
        );
        await pause(400);
        if (i === 10) await shot('04a-bankA');
        if (i === 11) await shot('04b-bankB');
    }
    await shot('04c-block-done');
});

test('05 — click stages 15-16: PMI + assembly mate', async () => {
    for (let i = 15; i <= 16; i += 1) {
        await page.locator(`[data-testid="forge-v12full-stage-${i}"]`).click();
        await page.waitForFunction(
            (id) => {
                const el = document.querySelector(`[data-testid="forge-v12full-stage-${id}"]`);
                return el && /[✓✗]/.test(el.textContent);
            },
            i, { timeout: 30000 },
        );
        await pause(400);
    }
    await shot('05-pmi-assembly');
});

test('06 — click stage 17: animated FEA (peak combustion 9.5 MPa, 6 s loop)', async () => {
    await page.locator('[data-testid="forge-v12full-stage-17"]').click();
    // wait for animation banner to appear, then capture mid-animation
    await page.waitForSelector('[data-testid="forge-v12full-animating"]', { timeout: 5000 }).catch(() => {});
    await pause(1500);
    await shot('06a-fea-anim-start');
    await pause(2000);
    await shot('06b-fea-anim-mid');
    await pause(3500);
    await shot('06c-fea-anim-end');
});

test('07 — click stage 18: modal animation (bending wave, 6 modes)', async () => {
    await page.locator('[data-testid="forge-v12full-stage-18"]').click();
    await pause(1500);
    await shot('07a-modal-start');
    await pause(2500);
    await shot('07b-modal-mid');
    await pause(3000);
    await shot('07c-modal-end');
});

test('08 — click stage 19: CFD streamlines (intake port flow)', async () => {
    await page.locator('[data-testid="forge-v12full-stage-19"]').click();
    await pause(1500);
    await shot('08a-cfd-start');
    await pause(2500);
    await shot('08b-cfd-mid');
    await pause(3000);
    await shot('08c-cfd-end');
});

test('09 — click stages 20-22: topology + drawings + export', async () => {
    for (let i = 20; i <= 22; i += 1) {
        await page.locator(`[data-testid="forge-v12full-stage-${i}"]`).click();
        await page.waitForFunction(
            (id) => {
                const el = document.querySelector(`[data-testid="forge-v12full-stage-${id}"]`);
                return el && /[✓✗]/.test(el.textContent);
            },
            i, { timeout: 60000 },
        );
        await pause(500);
    }
    await shot('09-topo-drawings-export');
});

test('10 — click stage 23: PBR render (rotating chrome crank, 6 s)', async () => {
    await page.locator('[data-testid="forge-v12full-stage-23"]').click();
    await pause(1500);
    await shot('10a-pbr-start');
    await pause(2500);
    await shot('10b-pbr-mid');
    await pause(3000);
    await shot('10c-pbr-end');
});

test('11 — click stage 24: PDM vault check-in', async () => {
    await page.locator('[data-testid="forge-v12full-stage-24"]').click();
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[data-testid="forge-v12full-stage-24"]');
            return el && /[✓✗]/.test(el.textContent);
        },
        null, { timeout: 30000 },
    );
    await pause(1000);
    await shot('11-pdm-done');
});

test('12 — final state: all 24 stages green', async () => {
    await pause(1500);
    await shot('12-final-all-done');
    for (let i = 1; i <= 24; i += 1) {
        const txt = await page.locator(`[data-testid="forge-v12full-stage-${i}"]`).innerText();
        expect(txt).toContain('✓');
    }
});

test('13 — no Archie posts in the whole CAD session', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
