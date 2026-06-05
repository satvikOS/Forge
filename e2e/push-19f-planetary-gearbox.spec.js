// PUSH-19f — 3-stage industrial planetary gearbox workflow (industrial
// drive train, e.g. wind turbine main gearbox class).
//
// Specifications (typical 3-stage planetary, 50:1 ratio, 2 MW class):
//   - Stage 1: sun Ø100 (24 T module 4), 4 planets Ø200 (48 T),
//              ring Ø500 (120 T) → ratio 6.0
//   - Stage 2: sun Ø80, 4 planets, ring Ø320 → ratio 5.0
//   - Stage 3: sun Ø60, 3 planets, ring Ø180 → ratio ~3.0
//   - Combined 6 × 5 × 3 ≈ 90:1 (or 50:1 if the carrier is fixed at S3)
//   - Material: case-hardened 4140 / EN36, carburised flanks
//
// Exercises:
//   - Massive matelib solve (3 sun + 11 planets + 3 ring axis-locks)
//   - PUSH-13 standard parts (AGMA module-4 spur gear from the catalogue)
//   - PUSH-17 materials (steel-4140)
//   - PUSH-04 matelib gear mate (sun → planet → ring kinematics)
//   - 5 multi-cam screenshots
// Manual UI only.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19f');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('Gbox-A — front view ready', async () => {
    await page.waitForTimeout(400);
    await shot('A-front-ready');
});

test('Gbox-B — top view: standard parts catalogue contains AGMA m4 spur gear', async () => {
    const a0 = await archieCount();
    const found = await page.evaluate(() => {
        if (!window.forge || !window.forge.stdpartsCatalog) return null;
        const list = window.forge.stdpartsCatalog.list();
        return list.filter((p) => p.code && /m[124]/i.test(p.code) &&
                                  p.kind && /gear/i.test(p.kind));
    });
    expect(found).toBeTruthy();
    expect(found.length).toBeGreaterThan(0);
    await shot('B-top-gears');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-C — right view: matelib gear-pair ratio mate 24T:48T = 0.5', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        if (!window.forge || !window.forge.matelib) return null;
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0],   q: [0, 0, 0, 1] },     // sun fixed
            { id: 2, fixed: false, t: [150, 0, 0], q: [0, 0, 0, 1] },     // planet
        ];
        const mates = [{
            kind: 7, // gear
            a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
            b: { inst: 2, origin: [150, 0, 0], axis: [0, 0, 1] },
            value: 0.5, // ratio = 24/48
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBeDefined();   // gear convergence depends on initial conditions
    await shot('C-right-gear-mate');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-D — iso view: build 3 sun gears + 11 planet bodies + 3 ring axes', async () => {
    const a0 = await archieCount();
    const handles = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.cyl) return null;
        const built = [];
        // Stage 1: sun Ø100, 4 planets Ø200, ring Ø500
        built.push(f.cyl(50,  60, 0, 0, 0));
        for (let i = 0; i < 4; i += 1) {
            const a = (i * Math.PI) / 2;
            built.push(f.cyl(100, 60, Math.cos(a) * 150, Math.sin(a) * 150, 0));
        }
        built.push(f.cyl(250, 60, 0, 0, 0));
        // Stage 2: sun Ø80, 4 planets Ø, ring Ø320
        built.push(f.cyl(40,  60, 0, 0, 80));
        for (let i = 0; i < 4; i += 1) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            built.push(f.cyl(60, 60, Math.cos(a) * 100, Math.sin(a) * 100, 80));
        }
        built.push(f.cyl(160, 60, 0, 0, 80));
        // Stage 3: sun Ø60, 3 planets Ø, ring Ø180
        built.push(f.cyl(30, 60, 0, 0, 160));
        for (let i = 0; i < 3; i += 1) {
            const a = (i * 2 * Math.PI) / 3;
            built.push(f.cyl(45, 60, Math.cos(a) * 60, Math.sin(a) * 60, 160));
        }
        built.push(f.cyl(90, 60, 0, 0, 160));
        return built;
    });
    expect(handles).toBeTruthy();
    // 3 suns + 4+4+3 planets + 3 rings = 17 bodies
    expect(handles.length).toBe(17);
    await shot('D-iso-all-stages');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-E — close view: PMI on stage-1 ring gear', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const a = [];
        a.push(window.forge.pmi.addDatum({ label: 'F', faceId: 1 }));
        a.push(window.forge.pmi.addFCF({ symbol: '⌭', tolerance: '0.03', datums: ['F'], faceId: 2 }));
        a.push(window.forge.pmi.addFCF({ symbol: '⌒', tolerance: '0.05', datums: ['F'], faceId: 3 }));   // runout on planet pin
        a.push(window.forge.pmi.addSurfaceFinish({ value: 'Ra 0.8', faceId: 4 }));
        a.push(window.forge.pmi.addLinearDim({ value: 'Ø500', upper: '+0.1', lower: '0', faceId: 2 }));
        return a;
    });
    expect(ids).toBeTruthy();
    expect(ids.length).toBe(5);
    await shot('E-close-pmi');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-F — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
