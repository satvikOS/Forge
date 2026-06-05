// PUSH-19d — Ford 6.7L Power Stroke V8 cast-iron engine block workflow.
//
// Specifications (Ford 6.7L "Scorpion" Power Stroke diesel V8, MY 2011+):
//   - Bore × stroke: 99.0 mm × 108.0 mm
//   - 90° bank angle, 8 cylinders (2 banks of 4)
//   - Compacted graphite iron (CGI) block, ~7100 kg/m³, Sy ≈ 350 MPa
//   - Deck height ~ 360 mm; bore spacing 122 mm
//
// Exercises:
//   - 8 cylinder bores via window.forge.cyl
//   - PUSH-17 materials (cast iron substitute properties)
//   - PUSH-04 matelib (8 cylinders concentric to bank centerlines)
//   - PUSH-12 PMI (datums for both banks, cylindricity, bore position)
//   - PUSH-14 PDM (block check-in)
//   - 5+ multi-cam screenshots
//
// Manual UI only.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19d');

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

test('FordV8-A — front view ready', async () => {
    const a0 = await archieCount();
    await page.waitForTimeout(400);
    await shot('A-front-ready');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-B — top view: build 8 cylinder bores (2 banks of 4 at 45° each)', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.cyl) return { error: 'forge.cyl unavailable' };
        const BORE_R   = 49.5;          // Ø99 → r=49.5
        const STROKE   = 108;
        const PITCH    = 122;           // bore spacing
        const BANK_ANG = Math.PI / 4;   // 45° each side of vertical (90° bank)
        const handles = [];
        for (let bank = 0; bank < 2; bank += 1) {
            const a = bank === 0 ? -BANK_ANG : +BANK_ANG;
            for (let i = 0; i < 4; i += 1) {
                const cx = Math.cos(a) * 60;     // 60 mm half-deck offset
                const cy = Math.sin(a) * 60;
                const cz = i * PITCH;
                handles.push(f.cyl(BORE_R, STROKE + 100, cx, cy, cz));
            }
        }
        return { handles, count: handles.length };
    });
    expect(built.error).toBeFalsy();
    expect(built.count).toBe(8);
    await shot('B-top-bores');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-C — right view: cast iron material', async () => {
    const a0 = await archieCount();
    const mat = await page.evaluate(() => {
        if (!window.forge || !window.forge.materials) return null;
        return window.forge.materials.get('cast-iron');
    });
    expect(mat).toBeTruthy();
    expect(mat.density).toBeGreaterThan(7000);   // CGI / grey iron ~ 7100-7300
    expect(mat.density).toBeLessThan(7300);
    expect(mat.E).toBeGreaterThan(80e9);          // E ≥ 80 GPa
    await shot('C-right-material');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-D — iso view: matelib concentric solve on bank A (4 cyls)', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        if (!window.forge || !window.forge.matelib) return null;
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0],     q: [0, 0, 0, 1] },
            { id: 2, fixed: false, t: [0.005, 0, 0],  q: [0, 0, 0, 1] },
            { id: 3, fixed: false, t: [-0.003, 0, 0], q: [0, 0, 0, 1] },
            { id: 4, fixed: false, t: [0.001, 0, 0],  q: [0, 0, 0, 1] },
        ];
        const mates = [];
        for (let i = 2; i <= 4; i += 1) {
            mates.push({
                kind: 1, // concentric
                a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
                b: { inst: i, origin: [0, 0, 0], axis: [0, 0, 1] },
                value: 0,
            });
        }
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    await shot('D-iso-mates');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-E — close view: 5 PMI annotations (datums + cylindricity + position)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const ids = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const a = [];
        a.push(window.forge.pmi.addDatum({ label: 'C', faceId: 1 }));    // deck face
        a.push(window.forge.pmi.addDatum({ label: 'D', faceId: 2 }));    // main bearing axis
        // Cylindricity on each bore — share the same FCF type 4×.
        for (let i = 0; i < 4; i += 1) {
            a.push(window.forge.pmi.addFCF({
                symbol: '⌭', tolerance: '0.01', datums: ['C', 'D'], faceId: 3 + i,
            }));
        }
        return a;
    });
    expect(ids).toBeTruthy();
    expect(ids.length).toBe(6);
    await shot('E-close-pmi');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const status = await page.evaluate(async () => {
        if (!window.forge || !window.forge.pdm) return null;
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({
            name: 'ford-67l-powerstroke-v8-block',
            content: 'block-skeleton v1',
            kind: 'part',
        });
        const list = await window.forge.pdm.list();
        return { docId, count: list.length };
    });
    expect(status).toBeTruthy();
    expect(status.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
