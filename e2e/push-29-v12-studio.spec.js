// PUSH-29 — V12 Studio: build the Mercedes M120 V12 from scratch using
// real ribbon CAD tools, one click + one parameter dialog at a time.
// Screenshot after every tool operation. Spec-driven from
// specs/mercedes-m120-v12-full.json.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(1800000);                                 // 30 min budget
test.describe.configure({ mode: 'serial' });

let app, page, spec;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-29-v12-studio');
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 300) { await page.waitForTimeout(ms); }

async function clickTab(tab) {
    await page.locator(`[data-testid="forge-v12studio-tab-${tab}"]`).click();
    await pause(150);
}

async function runTool(tab, toolId, params, screenshotLabel) {
    await clickTab(tab);
    await page.locator(`[data-testid="forge-v12studio-tool-${toolId}"]`).click();
    await page.waitForSelector('[data-testid="forge-v12studio-dialog"]', { timeout: 4000 });
    await pause(200);
    for (const [field, value] of Object.entries(params || {})) {
        const input = page.locator(`[data-testid="forge-v12studio-input-${field}"]`);
        if (await input.count() > 0) {
            await input.first().click();
            await page.keyboard.press('Meta+A');
            await page.keyboard.type(String(value), { delay: 12 });
            await pause(50);
        }
    }
    await page.locator('[data-testid="forge-v12studio-dialog-confirm"]').click();
    await page.waitForSelector('[data-testid="forge-v12studio-dialog"]', { state: 'detached', timeout: 5000 }).catch(() => {});
    await pause(400);
    if (screenshotLabel) await shot(screenshotLabel);
}

test.beforeAll(async () => {
    spec = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'specs', 'mercedes-m120-v12-full.json'),
        'utf8',
    ));
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(1000);
    // Clean ANY pre-existing meshes added by other workbenches before our run.
});

test.afterAll(async () => {
    try { await pause(3000); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — open V12 Studio via Cmd-K palette', async () => {
    await shot('forge-boot-empty');
    await page.keyboard.press('Meta+K');
    await pause(500);
    await page.keyboard.type('V12 Studio', { delay: 50 });
    await pause(500);
    await shot('palette-typed');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="forge-v12studio-panel"]', { timeout: 8000 });
    await pause(700);
    await shot('studio-opened');
});

// ============================================================ Crankshaft
test('01 — crank main: new part → sketch XY → circle Ø70 → finish → linear pattern 7×106', async () => {
    await runTool('sketch', 'new-part', { name: 'crank-mains' }, 'new-part-crank-mains');
    await runTool('sketch', 'sketch-xy', {}, 'sketch-xy');
    await runTool('sketch', 'sk-circle', { r: spec.crankshaft.main_journal_OD_mm / 2, cx: 0, cy: 0 }, 'circle-r35');
    await runTool('sketch', 'finish-sketch', {}, 'finish-sketch');
    // linear pattern uses pendingProfile — extrudes 26 mm and patterns 7× along X.
    await runTool('pattern', 'lpattern', {
        count: spec.block.main_bearings_count,
        distance: spec.crankshaft.main_journal_width_mm,
        dx: spec.block.cylinder_pitch_mm,
        dy: 0,
    }, 'lpattern-7-mains');
});

test('02 — switch to iso view', async () => {
    await runTool('view', 'view-iso', {}, 'view-iso-mains');
});

test('03 — crank throw 1: new part → sketch XY → circle Ø60 → finish → extrude 24 → translate', async () => {
    await runTool('sketch', 'new-part', { name: 'crank-throw-1' }, 'new-part-throw-1');
    await runTool('sketch', 'sketch-xy', {}, 'sketch-xy-throw');
    await runTool('sketch', 'sk-circle', { r: spec.crankshaft.rod_journal_OD_mm / 2, cx: 0, cy: 0 }, 'circle-r30');
    await runTool('sketch', 'finish-sketch', {}, 'finish-sketch-throw');
    await runTool('solid', 'extrude', { dist: spec.crankshaft.rod_journal_width_mm }, 'extrude-24');
    // Translate throw to its actual position
    const a = (spec.crankshaft.throw_angles_deg[0] * Math.PI) / 180;
    await runTool('modify', 'translate', {
        dx: spec.block.cylinder_pitch_mm / 2,
        dy: Math.cos(a) * spec.crankshaft.throw_radius_mm,
        dz: Math.sin(a) * spec.crankshaft.throw_radius_mm,
    }, 'translate-throw-1');
});

test('04 — crank throws 2-6 via 5 more new-part + circle + extrude + translate cycles', async () => {
    for (let i = 1; i < 6; i += 1) {
        await runTool('sketch', 'new-part', { name: `crank-throw-${i + 1}` });
        await runTool('sketch', 'sketch-xy', {});
        await runTool('sketch', 'sk-circle', { r: spec.crankshaft.rod_journal_OD_mm / 2, cx: 0, cy: 0 });
        await runTool('sketch', 'finish-sketch', {});
        await runTool('solid', 'extrude', { dist: spec.crankshaft.rod_journal_width_mm });
        const a = (spec.crankshaft.throw_angles_deg[i] * Math.PI) / 180;
        await runTool('modify', 'translate', {
            dx: (i + 0.5) * spec.block.cylinder_pitch_mm,
            dy: Math.cos(a) * spec.crankshaft.throw_radius_mm,
            dz: Math.sin(a) * spec.crankshaft.throw_radius_mm,
        }, `throw-${i + 1}-placed`);
    }
});

// ============================================================ Block
test('05 — block envelope: new part → sketch XY → rect 636×220 → finish → extrude 280', async () => {
    await runTool('sketch', 'new-part', { name: 'block' }, 'new-part-block');
    await runTool('sketch', 'sketch-xy', {}, 'block-sketch-xy');
    await runTool('sketch', 'sk-rect', {
        w: spec.block.block_length_mm, h: spec.block.block_height_mm, cx: 0, cy: 0,
    }, 'block-rect');
    await runTool('sketch', 'finish-sketch', {}, 'block-finish');
    await runTool('solid', 'extrude', { dist: spec.block.block_height_mm }, 'block-extruded');
});

test('06 — fillet block edges r=8 mm', async () => {
    await runTool('modify', 'fillet', { r: 8 }, 'block-filleted');
});

// ============================================================ Bores
test('07 — bore bank: new part → sketch XY → circle Ø89 → finish → linear pattern 6×106', async () => {
    await runTool('sketch', 'new-part', { name: 'bores' }, 'new-part-bores');
    await runTool('sketch', 'sketch-xy', {}, 'bore-sketch-xy');
    await runTool('sketch', 'sk-circle', { r: spec.bore.diameter_mm / 2, cx: 0, cy: 0 }, 'bore-circle');
    await runTool('sketch', 'finish-sketch', {}, 'bore-finish');
    await runTool('pattern', 'lpattern', {
        count: 6,
        distance: spec.bore.depth_mm,
        dx: spec.block.cylinder_pitch_mm,
        dy: 0,
    }, 'bores-pattern');
});

// ============================================================ Cylinder Head
test('09 — head: new part → sketch XY → rect 636×100 → finish → extrude 80 → fillet 4', async () => {
    await runTool('sketch', 'new-part', { name: 'head-bank-A' }, 'new-part-head');
    await runTool('sketch', 'sketch-xy', {}, 'head-sketch-xy');
    await runTool('sketch', 'sk-rect', { w: spec.block.block_length_mm, h: 100, cx: 0, cy: 0 }, 'head-rect');
    await runTool('sketch', 'finish-sketch', {}, 'head-finish');
    await runTool('solid', 'extrude', { dist: 80 }, 'head-extruded');
    await runTool('modify', 'fillet', { r: 4 }, 'head-filleted');
});

// ============================================================ Final wide
test('10 — final iso view, capture assembly', async () => {
    await runTool('view', 'view-iso', {}, 'final-iso');
    await pause(1500);
    await shot('final-wide');
});

test('11 — verify at least 10 ops in history', async () => {
    const ops = parseInt(await page.locator('[data-testid="forge-v12studio-history-count"]').innerText(), 10);
    expect(ops).toBeGreaterThan(20);
});

test('12 — no Archie posts in the whole CAD session', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
