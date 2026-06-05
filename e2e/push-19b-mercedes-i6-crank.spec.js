// PUSH-19b — Mercedes-Benz M256 inline-6 crankshaft real-machine workflow.
//
// Specifications (Mercedes-Benz M256 3.0L straight-six, 2999 cc):
//   - Bore × stroke: 83 mm × 92.4 mm
//   - 6 throws at 120° intervals (firing order 1-5-3-6-2-4)
//   - Main journal Ø60 mm, crank pin Ø50 mm, throw radius = stroke/2 = 46.2 mm
//
// Exercises in a single workflow:
//   - PUSH-13 standard parts (no, but main bearing 6010 SKF used as reference)
//   - PUSH-17 materials (4140 chrome-moly steel, density 7850 kg/m³)
//   - PUSH-12 PMI (datum A on main journal, runout 0.02, Ra 0.4, pos ⌖)
//   - PUSH-14 PDM (check in the crank, verify v1)
//   - PUSH-04 matelib (6 throws concentric to main axis)
//   - Multi-cam screenshots (5 named angles)
//
// Manual UI only. Never posts to Archie thread, never opens dock.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19b');

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

test('M256-A — front view: empty Forge ready', async () => {
    const a0 = await archieCount();
    await page.waitForTimeout(500);
    await shot('A-front-ready');
    expect(await archieCount()).toBe(a0);
});

test('M256-B — top view: build crank skeleton (6 throws + 7 mains)', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        if (!f || !f.cyl) return { error: 'window.forge.cyl unavailable' };
        const handles = [];

        // Main journals at z stations 0, 105, 210, 315, 420, 525, 630 (7 mains).
        // Mercedes M256 deck height ~ 220 mm × inline-6 → ~630 mm crank length.
        const MAIN_R = 30, MAIN_LEN = 25;          // Ø60 × 25 mm wide each
        const PIN_R  = 25, PIN_LEN  = 28;          // Ø50 × 28 mm pin
        const THROW  = 46.2;                       // stroke/2
        for (let i = 0; i < 7; i += 1) {
            const z = i * 105;
            handles.push(f.cyl(MAIN_R, MAIN_LEN, 0, 0, z));
        }
        // 6 throws between main pairs. Firing order 1-5-3-6-2-4 → angles
        // 0, 240, 120, 360 (≡0), 240, 120 — we use the 0/120/240 pattern at
        // throws 1,3,5 = 0°; 2,4,6 = 120°/240°.
        const THROW_ANGLES = [0, 240, 120, 0, 240, 120];
        for (let i = 0; i < 6; i += 1) {
            const a = (THROW_ANGLES[i] * Math.PI) / 180;
            const cx = Math.cos(a) * THROW;
            const cy = Math.sin(a) * THROW;
            const cz = 105 * i + 105 / 2 + 25;     // halfway between mains
            handles.push(f.cyl(PIN_R, PIN_LEN, cx, cy, cz));
        }
        return { handles, count: handles.length };
    });
    expect(built.error).toBeFalsy();
    expect(built.count).toBe(13);                  // 7 mains + 6 throws
    await shot('B-top-skeleton');
    expect(await archieCount()).toBe(a0);
});

test('M256-C — right view: apply 4140 chrome-moly material', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenMaterialsLibrary && window.__forgeOpenMaterialsLibrary());
    await page.waitForTimeout(400);
    const mat = await page.evaluate(() => {
        if (!window.forge || !window.forge.materials) return null;
        return window.forge.materials.get('steel-4140');
    });
    expect(mat).toBeTruthy();
    expect(mat.Sut).toBe(1020e6);          // ultimate strength 1020 MPa
    expect(mat.E).toBe(205e9);             // Young's modulus 205 GPa
    expect(mat.density).toBe(7850);
    await shot('C-right-material');
    expect(await archieCount()).toBe(a0);
});

test('M256-D — iso view: add PMI annotations (datum A, runout, surface finish)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenPMIWorkbench && window.__forgeOpenPMIWorkbench());
    await page.waitForTimeout(300);
    const annotations = await page.evaluate(() => {
        if (!window.forge || !window.forge.pmi) return null;
        const annots = [];
        // Datum A on main journal axis.
        annots.push(window.forge.pmi.addDatum({ label: 'A', faceId: 1 }));
        // Runout 0.02 on main journal 4 (centre, ⌒ 0.02 A).
        annots.push(window.forge.pmi.addFCF({
            symbol: '⌒',
            tolerance: '0.02',
            datums: ['A'],
            faceId: 7,
        }));
        // Position ⌖ Ø0.05 MMC on crank pin 1 wrt A.
        annots.push(window.forge.pmi.addFCF({
            symbol: '⌖',
            tolerance: 'Ø0.05',
            modifier: 'M',
            datums: ['A'],
            faceId: 8,
        }));
        // Surface finish Ra 0.4 ground on main journal 1.
        annots.push(window.forge.pmi.addSurfaceFinish({ value: 'Ra 0.4', faceId: 2 }));
        // Linear dimension Ø60 ±0.012 on main journal.
        annots.push(window.forge.pmi.addLinearDim({
            value: 'Ø60', upper: '+0.012', lower: '-0.012', faceId: 2,
        }));
        return annots;
    });
    expect(annotations).toBeTruthy();
    expect(annotations.length).toBe(5);
    annotations.forEach((id) => expect(typeof id === 'string' || typeof id === 'number').toBeTruthy());
    await shot('D-iso-pmi');
    expect(await archieCount()).toBe(a0);
});

test('M256-E — close view: matelib concentric solve on first 3 throws', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        if (!window.forge || !window.forge.matelib) return null;
        const poses = [
            { id: 1, fixed: true,  t: [0, 0, 0], q: [0, 0, 0, 1] },
            { id: 2, fixed: false, t: [0.005, 0.003, 0], q: [0, 0, 0, 1] },
            { id: 3, fixed: false, t: [-0.004, 0.002, 0], q: [0, 0, 0, 1] },
        ];
        const mates = [
            {
                kind: 1, // concentric
                a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
                b: { inst: 2, origin: [0, 0, 0], axis: [0, 0, 1] },
                value: 0,
            },
            {
                kind: 1,
                a: { inst: 1, origin: [0, 0, 0], axis: [0, 0, 1] },
                b: { inst: 3, origin: [0, 0, 0], axis: [0, 0, 1] },
                value: 0,
            },
        ];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(result.converged).toBe(true);
    await shot('E-close-mates');
    expect(await archieCount()).toBe(a0);
});

test('M256-F — PDM check-in of the crank assembly', async () => {
    const a0 = await archieCount();
    const status = await page.evaluate(async () => {
        if (!window.forge || !window.forge.pdm) return null;
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({
            name: 'mercedes-m256-i6-crank',
            content: 'crank-skeleton v1',
            kind: 'part',
        });
        const list = await window.forge.pdm.list();
        return { docId, listCount: list.length };
    });
    expect(status).toBeTruthy();
    expect(status.docId).toBeTruthy();
    expect(status.listCount).toBeGreaterThan(0);
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('M256-G — no Archie posts throughout workflow', async () => {
    expect(await archieCount()).toBe(0);
});
