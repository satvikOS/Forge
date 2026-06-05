// PUSH-25 — Mercedes M120 V12 built via the platform's real parameter
// dialogs. One persistent Forge session. For every part: trigger the
// Mech ribbon tool, the platform's ToolParamDialog opens visibly,
// values from specs/mercedes-m120-v12-full.json get typed into each
// field, then Run lands the real 3D body in the viewport.
//
// Geometry shows up as actual rendered meshes in the viewport — block,
// crank journals, crank throws, head, oil pan — not a side-panel chart.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(900000);
test.describe.configure({ mode: 'serial' });

let app, page, spec;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-25-v12-real');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 250) { await page.waitForTimeout(ms); }

async function runToolDialog(toolName, values) {
    // Trigger the ribbon tool via the platform's exposed runner; the
    // dialog (ToolParamDialog) is what we actually interact with — the
    // user sees inputs being filled and the Run button being clicked.
    await page.evaluate(({ tool }) => {
        // Clear bypass so the dialog opens visibly.
        try { window.__archdiscBypassDialog = false; } catch {}
        if (typeof window.__archdiscRunTool === 'function') {
            window.__archdiscRunTool('part', tool);
        }
    }, { tool: toolName });

    // Wait for the dialog modal to appear.
    await page.waitForSelector('.tpd-dialog', { timeout: 6000 });
    await pause(200);

    // Fill each field by name.
    for (const [field, val] of Object.entries(values)) {
        const input = page.locator(`.tpd-dialog input[data-field="${field}"]`);
        const n = await input.count();
        if (n === 0) continue;
        await input.first().click();
        await page.keyboard.press('Meta+A');
        await page.keyboard.type(String(val), { delay: 12 });
        await pause(60);
    }

    // Click Run.
    await page.locator('.tpd-dialog .tpd-btn-run').click();
    await page.waitForSelector('.tpd-dialog', { state: 'detached', timeout: 6000 }).catch(() => {});
    await pause(200);
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
    // Dismiss onboarding.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(1000);
});

test.afterAll(async () => {
    try { await pause(4000); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — Forge ready, Mech viewport empty', async () => {
    await shot('00-empty-viewport');
    // Mech runner should be available (it's the default workbench).
    const ok = await page.evaluate(() => typeof window.__archdiscRunTool === 'function');
    expect(ok).toBe(true);
});

test('01 — block envelope (Box 636 × 220 × 280)', async () => {
    await runToolDialog('Box', {
        dx: spec.block.block_length_mm,
        dy: spec.block.block_height_mm,
        dz: spec.block.block_height_mm,
        x: 0, y: 0, z: 0,
    });
    await shot('01-block');
});

test('02 — 7 main bearing journals (Cylinder Ø70 × 26)', async () => {
    const r = spec.crankshaft.main_journal_OD_mm / 2;
    const h = spec.crankshaft.main_journal_width_mm;
    const pitch = spec.block.cylinder_pitch_mm;
    for (let i = 0; i < spec.block.main_bearings_count; i += 1) {
        const x = i * pitch - spec.block.block_length_mm / 2;
        await runToolDialog('Cylinder', { radius: r, height: h, x, y: 0, z: 0, rx: 90, ry: 0, rz: 0 });
        if (i === 3) await shot('02a-mains-half');
    }
    await shot('02b-mains-done');
});

test('03 — 6 crank throws at 60° firing intervals (Cylinder Ø60 × 24)', async () => {
    const r = spec.crankshaft.rod_journal_OD_mm / 2;
    const h = spec.crankshaft.rod_journal_width_mm;
    const pitch = spec.block.cylinder_pitch_mm;
    const tr = spec.crankshaft.throw_radius_mm;
    const ang = spec.crankshaft.throw_angles_deg;
    for (let i = 0; i < 6; i += 1) {
        const a = (ang[i] * Math.PI) / 180;
        await runToolDialog('Cylinder', {
            radius: r, height: h,
            x: (i + 0.5) * pitch - spec.block.block_length_mm / 2,
            y: Math.cos(a) * tr,
            z: Math.sin(a) * tr,
            rx: 90, ry: 0, rz: 0,
        });
        if (i === 2) await shot('03a-throws-half');
    }
    await shot('03b-throws-done');
});

test('04 — 12 cylinder bores in V layout (Cylinder Ø89 × 86)', async () => {
    const r = spec.bore.diameter_mm / 2;
    const h = spec.bore.depth_mm;
    const pitch = spec.block.cylinder_pitch_mm;
    const half = spec.block.block_length_mm / 2;
    const bank = spec.block.bank_angle_deg / 2;
    for (let bankSign of [-1, 1]) {
        for (let i = 0; i < 6; i += 1) {
            const rxDeg = bankSign > 0 ? -bank : +bank;
            await runToolDialog('Cylinder', {
                radius: r, height: h,
                x: i * pitch - half,
                y: bankSign * 30,
                z: 80,
                rx: rxDeg, ry: 0, rz: 0,
            });
        }
        if (bankSign === -1) await shot('04a-bankA');
        else await shot('04b-bankB');
    }
});

test('05 — left + right cylinder heads (Box 636 × 60 × 80)', async () => {
    await runToolDialog('Box', {
        dx: spec.block.block_length_mm, dy: 60, dz: 80,
        x: 0, y: -90, z: 180,
        rx: -30, ry: 0, rz: 0,
    });
    await runToolDialog('Box', {
        dx: spec.block.block_length_mm, dy: 60, dz: 80,
        x: 0, y: +90, z: 180,
        rx: +30, ry: 0, rz: 0,
    });
    await shot('05-heads');
});

test('06 — oil pan (Box 636 × 200 × 80, below block)', async () => {
    await runToolDialog('Box', {
        dx: spec.block.block_length_mm, dy: 200, dz: 80,
        x: 0, y: 0, z: -180,
    });
    await shot('06-oil-pan');
});

test('07 — intake plenum (Box 600 × 150 × 60, on top centre)', async () => {
    await runToolDialog('Box', {
        dx: 600, dy: 150, dz: 60,
        x: 0, y: 0, z: 260,
    });
    await shot('07-plenum');
});

test('08 — fillet pass (default 0.15 m on last solid)', async () => {
    await page.evaluate(() => {
        try { window.__archdiscBypassDialog = true; } catch {}
        if (typeof window.__archdiscRunTool === 'function') {
            window.__archdiscRunTool('part', 'Fillet');
        }
    });
    await pause(800);
    await shot('08-fillet');
});

test('09 — final assembly view (zoom-fit)', async () => {
    // Fit-view shortcut (Forge: F key).
    await page.keyboard.press('f');
    await pause(800);
    await shot('09-final-assembly');
});

test('10 — at least one body landed in the scene', async () => {
    const count = await page.evaluate(() => {
        try {
            const s = window.__archdiscViewport?.scene;
            if (!s) return 0;
            let n = 0;
            s.traverse((o) => { if (o.isMesh) n += 1; });
            return n;
        } catch { return 0; }
    });
    expect(count).toBeGreaterThan(0);
});
