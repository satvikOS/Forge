// PUSH-223 (Slice-166) — Real Composite Shell FEA.
//
// Drives the CompositeFeaPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenCompositeFea +
//        window.__forgeCompositeFeaHelper install BEFORE the panel
//        mounts. Sanity-check the solver primitives headlessly
//        (sectionMatrices, membraneB, elementK, plyFailureReport,
//        solveCompositeShell, etc.).
//   01 — Open the Composite FEA panel via the tools.compositeFea menu
//        action. Assert every canonical test-id mounts (layup picker /
//        Lx / Ly / nx / ny / load type / load mag / BC type / Run /
//        close).
//   02 — [0/90/0/90] CFRP cross-ply + uniform tension. Assert solution
//        converges (finite, non-zero max |u|), per-ply RF computed,
//        first-ply failure flagged.
//   03 — Quasi-iso [0/+45/−45/90]s layup. Assert in-plane response
//        closer to isotropic (A11 ≈ A22, A11 / A66 ≈ 2.6 for the
//        textbook quasi-iso constant), much closer to isotropy than
//        the cross-ply.
//   04 — [0]_8 unidirectional + TENSION_Y (transverse tension). Assert
//        RF much lower than fibre-direction tension would give.
//   05 — Close panel.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (cross-ply tension)
//   - right (quasi-iso comparison)
//   - iso   (UD transverse + close)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — multiple shell solves inside Electron
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-223-composite-fea');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'composite-fea-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-'
        + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
    await page.evaluate((id) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
    }, actionId);
    await pause(400);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(250);
}

// Wait for the panel to publish the run snapshot on window.
async function waitForLastResult(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const has = await page.evaluate(() => !!window.__forgeCompositeFeaLast);
        if (has) {
            return await page.evaluate(() => {
                const r = window.__forgeCompositeFeaLast;
                return {
                    Lx_mm: r.Lx_mm, Ly_mm: r.Ly_mm,
                    nx: r.nx, ny: r.ny,
                    loadPattern: r.loadPattern,
                    loadMagnitude: r.loadMagnitude,
                    bcType: r.bcType,
                    nPlies: r.nPlies,
                    nElements: r.nElements,
                    N: r.N,
                    layupName: r.layupName,
                    layupPreset: r.layupPreset,
                    A_NperMM: r.A_NperMM,
                    B_NperMM: r.B_NperMM,
                    D_NmmPerMM: r.D_NmmPerMM,
                    As_NperMM: r.As_NperMM,
                    totalThickness_mm: r.totalThickness_mm,
                    maxAbsU: r.maxAbsU,
                    maxAbsW: r.maxAbsW,
                    maxAbsTheta: r.maxAbsTheta,
                    fpf: r.fpf,
                    perPlyTable: r.perPlyTable,
                    elapsedSolveMs: r.elapsedSolveMs,
                    elapsedTotalMs: r.elapsedTotalMs,
                };
            });
        }
        await pause(300);
    }
    return null;
}

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-223|composite|mindlin|abd|tsai|reserve|fea|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});

    // Dismiss onboarding (Forge-189) so it doesn't block button clicks.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        try { window.__forgeFinishTour?.(); } catch {}
    });
    await pause(400);
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(200);
    }
});

test.afterAll(async () => {
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) {
        try { await app.close({ timeout: 10000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR)
            ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
            : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) {
        console.error('[push-223] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin;
    try {
        ffmpegBin = require('ffmpeg-static');
    } catch (err) {
        console.error('[push-223] ffmpeg-static not available, skipping mp4 conversion:',
            err.message);
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-223] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-223] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert host window surface + helper API installed', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenCompositeFea,
        close:   typeof window.__forgeCloseCompositeFea,
        helper:  typeof window.__forgeCompositeFeaHelper,
        helperKeys: window.__forgeCompositeFeaHelper
            ? Object.keys(window.__forgeCompositeFeaHelper).sort()
            : [],
        loadPatterns: window.__forgeCompositeFeaHelper?.LOAD_PATTERNS,
        defaults: window.__forgeCompositeFeaHelper?.COMPOSITE_FEA_DEFAULTS,
        presets: window.__forgeCompositeFeaHelper?.LAYUP_PRESETS,
    }));
    console.log('[push-223] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    // Math primitives.
    expect(surface.helperKeys).toContain('shapeFunctions');
    expect(surface.helperKeys).toContain('jacobianAt');
    expect(surface.helperKeys).toContain('cartesianGradient');
    expect(surface.helperKeys).toContain('membraneB');
    expect(surface.helperKeys).toContain('bendingB');
    expect(surface.helperKeys).toContain('shearB');
    expect(surface.helperKeys).toContain('sectionMatrices');
    expect(surface.helperKeys).toContain('elementK');
    expect(surface.helperKeys).toContain('makeRectPlateMesh');
    expect(surface.helperKeys).toContain('assembleGlobalK');
    expect(surface.helperKeys).toContain('buildLoadVector');
    expect(surface.helperKeys).toContain('buildClampedLeftMask');
    expect(surface.helperKeys).toContain('applyDirichletInPlace');
    expect(surface.helperKeys).toContain('plyHeights');
    expect(surface.helperKeys).toContain('strainAtGauss');
    expect(surface.helperKeys).toContain('plyStress');
    expect(surface.helperKeys).toContain('solveCompositeShell');
    expect(surface.helperKeys).toContain('denseLUDecompose');
    expect(surface.helperKeys).toContain('denseLUSolve');
    expect(surface.helperKeys).toContain('GAUSS_1');
    expect(surface.helperKeys).toContain('GAUSS_2x2');
    // Layup helpers.
    expect(surface.helperKeys).toContain('makeQuasiIsoLayup');
    expect(surface.helperKeys).toContain('makeUnidirectionalLayup');
    expect(surface.helperKeys).toContain('makeSimpleSymmetricLayup');
    expect(surface.helperKeys).toContain('buildLayupFromPreset');
    expect(surface.helperKeys).toContain('computeABD');
    // Enums.
    expect(surface.loadPatterns.TENSION_X).toBe('tension-x');
    expect(surface.loadPatterns.TENSION_Y).toBe('tension-y');
    expect(surface.loadPatterns.SHEAR).toBe('shear');
    expect(surface.loadPatterns.BENDING).toBe('bending');
    expect(surface.loadPatterns.PRESSURE).toBe('pressure');
    expect(surface.defaults.SHEAR_CORRECTION).toBeCloseTo(5 / 6, 6);
    expect(surface.defaults.GAUSS_FULL).toBe(2);
    expect(surface.defaults.GAUSS_REDUCED).toBe(1);
    expect(surface.presets.QUASI_ISO).toBe('quasi-iso');
    expect(surface.presets.CROSS_PLY).toBe('cross-ply-0-90');
    expect(surface.presets.UD_0).toBe('unidirectional-0');
    expect(surface.presets.UD_90).toBe('unidirectional-90');

    // ─── Headless smoke: shape function partition-of-unity ───
    const shapeProbe = await page.evaluate(() => {
        const h = window.__forgeCompositeFeaHelper;
        // At any (ξ, η) the four bilinear N_i must sum to 1.
        const samples = [
            [-1, -1], [1, -1], [1, 1], [-1, 1],
            [0, 0], [0.3, -0.4], [-0.7, 0.5],
        ];
        return samples.map(([xi, eta]) => {
            const { N, dNdxi, dNdeta } = h.shapeFunctions(xi, eta);
            return {
                xi, eta,
                Nsum: N.reduce((a, b) => a + b, 0),
                dNdxiSum: dNdxi.reduce((a, b) => a + b, 0),
                dNdetaSum: dNdeta.reduce((a, b) => a + b, 0),
            };
        });
    });
    console.log('[push-223] shapeProbe =', JSON.stringify(shapeProbe));
    for (const r of shapeProbe) {
        expect(r.Nsum).toBeCloseTo(1, 9);
        expect(r.dNdxiSum).toBeCloseTo(0, 9);
        expect(r.dNdetaSum).toBeCloseTo(0, 9);
    }

    // ─── Headless smoke: 4-node element jacobian on a unit square ───
    const jacProbe = await page.evaluate(() => {
        const h = window.__forgeCompositeFeaHelper;
        const corners = [[0, 0], [10, 0], [10, 10], [0, 10]]; // 10×10 mm
        const j = h.jacobianAt(0, 0, corners);
        // For a 10×10 element, J = diag(5, 5), detJ = 25.
        return { J: Array.from(j.J), detJ: j.detJ, invJ: Array.from(j.invJ) };
    });
    console.log('[push-223] jacProbe =', JSON.stringify(jacProbe));
    expect(jacProbe.J[0]).toBeCloseTo(5, 9);
    expect(jacProbe.J[3]).toBeCloseTo(5, 9);
    expect(jacProbe.detJ).toBeCloseTo(25, 9);

    // ─── Headless smoke: section matrices from a known layup ───
    const secProbe = await page.evaluate(() => {
        const h = window.__forgeCompositeFeaHelper;
        const book = h.makeUnidirectionalLayup({
            material: 'UD CFRP', plyCount: 4, orientation_deg: 0,
        });
        const s = h.sectionMatrices(book);
        return {
            plyCount: h.expandPlies(book).length,
            tTotal: s.totalThickness_mm,
            A: s.A, D: s.D,
            As: s.As,
        };
    });
    console.log('[push-223] secProbe =', JSON.stringify(secProbe));
    // 4 plies × 0.125 mm = 0.5 mm.
    expect(secProbe.plyCount).toBe(4);
    expect(secProbe.tTotal).toBeCloseTo(0.5, 6);
    // A11 should dominate (UD at 0): A11 >> A22.
    expect(secProbe.A[0][0]).toBeGreaterThan(secProbe.A[1][1] * 5);
    // Off-diagonals A16, A26 zero for [0]_4.
    expect(Math.abs(secProbe.A[0][2])).toBeLessThan(1e-3);
    expect(Math.abs(secProbe.A[1][2])).toBeLessThan(1e-3);

    // ─── Headless smoke: solveCompositeShell end-to-end ───
    const solveProbe = await page.evaluate(() => {
        const h = window.__forgeCompositeFeaHelper;
        const book = h.buildLayupFromPreset(h.LAYUP_PRESETS.CROSS_PLY);
        const out = h.solveCompositeShell({
            layup: book, Lx_mm: 100, Ly_mm: 100, nx: 2, ny: 2,
            loadPattern: h.LOAD_PATTERNS.TENSION_X,
            loadMagnitude: 50,
        });
        return {
            N: out.N, nElements: out.nElements, nPlies: out.nPlies,
            maxAbsU: out.maxAbsU, maxAbsW: out.maxAbsW,
            fpfRF: out.fpf.RF, fpfPlyIdx: out.fpf.plyIndex,
            fpfCriterion: out.fpf.criterion,
        };
    });
    console.log('[push-223] solveProbe =', JSON.stringify(solveProbe));
    // (nx+1)(ny+1) = 9 nodes × 5 DOFs = 45 total DOFs.
    expect(solveProbe.N).toBe(45);
    expect(solveProbe.nElements).toBe(4);
    expect(solveProbe.nPlies).toBe(4);
    expect(Number.isFinite(solveProbe.maxAbsU)).toBe(true);
    expect(solveProbe.maxAbsU).toBeGreaterThan(0);
    expect(Number.isFinite(solveProbe.fpfRF)).toBe(true);
    expect(solveProbe.fpfPlyIdx).toBeGreaterThanOrEqual(0);
    expect(['max-stress', 'tsai-hill', 'tsai-wu']).toContain(solveProbe.fpfCriterion);

    await shot('host-surface-ok');
});

test('01 — open Composite FEA panel via tools.compositeFea', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.compositeFea');
    await page.waitForSelector('[data-testid="forge-composite-fea-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Every canonical control mounts.
    await expect(page.locator('[data-testid="forge-composite-fea-layup"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-lx"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-ly"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-nx"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-ny"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-loadtype"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-loadmag"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-bctype"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-run"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-close"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-layup-name"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-layup-plycount"]')).toBeVisible();

    // Defaults — cross-ply preset, 100 mm × 100 mm, 4×4 mesh, TENSION_X, 100 N/mm,
    // clamped-left.
    const defaults = await page.evaluate(() => ({
        layup:    document.querySelector('[data-testid="forge-composite-fea-layup"]').value,
        lx:       +document.querySelector('[data-testid="forge-composite-fea-lx"]').value,
        ly:       +document.querySelector('[data-testid="forge-composite-fea-ly"]').value,
        nx:       +document.querySelector('[data-testid="forge-composite-fea-nx"]').value,
        ny:       +document.querySelector('[data-testid="forge-composite-fea-ny"]').value,
        loadtype: document.querySelector('[data-testid="forge-composite-fea-loadtype"]').value,
        loadmag:  +document.querySelector('[data-testid="forge-composite-fea-loadmag"]').value,
        bctype:   document.querySelector('[data-testid="forge-composite-fea-bctype"]').value,
    }));
    console.log('[push-223] defaults =', JSON.stringify(defaults));
    expect(defaults.layup).toBe('cross-ply-0-90');
    expect(defaults.lx).toBeCloseTo(100, 6);
    expect(defaults.ly).toBeCloseTo(100, 6);
    expect(defaults.nx).toBe(4);
    expect(defaults.ny).toBe(4);
    expect(defaults.loadtype).toBe('tension-x');
    expect(defaults.loadmag).toBeCloseTo(100, 6);
    expect(defaults.bctype).toBe('clamped-left');
});

test('02 — [0/90/0/90] cross-ply CFRP + uniform tension → per-ply RF + FPF', async () => {
    await cameraTo('top');
    // Configure: cross-ply, 100×100 mm, 4×4 mesh, tension-x, 100 N/mm.
    await page.locator('[data-testid="forge-composite-fea-layup"]').selectOption('cross-ply-0-90');
    await page.locator('[data-testid="forge-composite-fea-lx"]').fill('100');
    await page.locator('[data-testid="forge-composite-fea-ly"]').fill('100');
    await page.locator('[data-testid="forge-composite-fea-nx"]').fill('4');
    await page.locator('[data-testid="forge-composite-fea-ny"]').fill('4');
    await page.locator('[data-testid="forge-composite-fea-loadtype"]').selectOption('tension-x');
    await page.locator('[data-testid="forge-composite-fea-loadmag"]').fill('100');
    await page.locator('[data-testid="forge-composite-fea-bctype"]').selectOption('clamped-left');
    await pause(250);
    await shot('crossply-configured');

    await page.evaluate(() => { try { delete window.__forgeCompositeFeaLast; } catch {} });
    await page.locator('[data-testid="forge-composite-fea-run"]').click();

    const snap = await waitForLastResult(60000);
    expect(snap).not.toBeNull();
    console.log('[push-223] crossply snap =', JSON.stringify({
        Lx: snap.Lx_mm, Ly: snap.Ly_mm,
        nx: snap.nx, ny: snap.ny,
        loadPattern: snap.loadPattern, mag: snap.loadMagnitude,
        nElements: snap.nElements, nPlies: snap.nPlies, N: snap.N,
        maxU: snap.maxAbsU, maxW: snap.maxAbsW, maxT: snap.maxAbsTheta,
        t: snap.totalThickness_mm,
        elapsedMs: snap.elapsedSolveMs,
        fpf: snap.fpf,
        a11: snap.A_NperMM[0][0], a22: snap.A_NperMM[1][1], a66: snap.A_NperMM[2][2],
    }));

    // Echo of inputs.
    expect(snap.Lx_mm).toBeCloseTo(100, 6);
    expect(snap.Ly_mm).toBeCloseTo(100, 6);
    expect(snap.nx).toBe(4);
    expect(snap.ny).toBe(4);
    expect(snap.loadPattern).toBe('tension-x');
    expect(snap.loadMagnitude).toBeCloseTo(100, 6);
    // [0/90]s = 4 plies @ 0.125 mm → 0.5 mm total.
    expect(snap.nPlies).toBe(4);
    expect(snap.totalThickness_mm).toBeCloseTo(0.5, 6);
    // Mesh sanity: (4+1)(4+1) = 25 nodes × 5 DOFs = 125 DOFs.
    expect(snap.N).toBe(125);
    expect(snap.nElements).toBe(16);

    // ─── Solution converges: max |u| finite + non-trivial ───
    expect(Number.isFinite(snap.maxAbsU)).toBe(true);
    expect(snap.maxAbsU).toBeGreaterThan(0);
    // For 100 N/mm on a 0.5 mm thick laminate, in-plane stress ≈ 200 MPa →
    // ε ≈ 200 / 73 GPa ≈ 2.7e-3 → over 100 mm length u ≈ 0.27 mm. Allow a
    // wide bracket since BC clamps Poisson too.
    expect(snap.maxAbsU).toBeLessThan(10);

    // ─── ABD diagnostics ───
    // For [0/90]s symmetric the B matrix must be exactly zero.
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            expect(Math.abs(snap.B_NperMM[i][j])).toBeLessThan(1e-3);
        }
    }
    // A11 ≈ A22 for cross-ply (balanced 0/90 + 0/90 reverse).
    const a11 = snap.A_NperMM[0][0], a22 = snap.A_NperMM[1][1];
    expect(Math.abs(a11 - a22) / a11).toBeLessThan(0.05);

    // ─── Per-ply RF table populated ───
    expect(Array.isArray(snap.perPlyTable)).toBe(true);
    expect(snap.perPlyTable.length).toBe(snap.nPlies);
    for (const row of snap.perPlyTable) {
        expect(Number.isFinite(row.minRF)).toBe(true);
        expect(row.minRF).toBeGreaterThan(0);
        expect(['max-stress', 'tsai-hill', 'tsai-wu']).toContain(row.criticalCriterion);
    }

    // ─── First-ply failure flagged ───
    expect(Number.isFinite(snap.fpf.RF)).toBe(true);
    expect(snap.fpf.RF).toBeGreaterThan(0);
    expect(snap.fpf.plyIndex).toBeGreaterThanOrEqual(0);
    expect(snap.fpf.plyIndex).toBeLessThan(snap.nPlies);
    expect(['max-stress', 'tsai-hill', 'tsai-wu']).toContain(snap.fpf.criterion);

    // ─── Chip + table render ───
    await expect(page.locator('[data-testid="forge-composite-fea-chip-elements"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-chip-dofs"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-chip-plies"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-chip-maxu"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-chip-a11"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-fpf-rf"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-fpf-ply"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-composite-fea-plytable"]')).toBeVisible();

    await shot('crossply-solved');
});

test('03 — quasi-iso layup → in-plane stiffness closer to isotropic', async () => {
    await cameraTo('right');
    await page.evaluate(() => { try { delete window.__forgeCompositeFeaLast; } catch {} });

    // Switch to quasi-iso preset.
    await page.locator('[data-testid="forge-composite-fea-layup"]').selectOption('quasi-iso');
    await pause(250);
    await shot('quasiiso-configured');

    await page.locator('[data-testid="forge-composite-fea-run"]').click();
    const snap = await waitForLastResult(60000);
    expect(snap).not.toBeNull();
    const a11 = snap.A_NperMM[0][0], a22 = snap.A_NperMM[1][1], a66 = snap.A_NperMM[2][2];
    const a12 = snap.A_NperMM[0][1];
    // For a quasi-iso laminate the in-plane ABD becomes isotropic-like:
    //   E_eff = (A11·A22 − A12²) / (A22·t)
    //   ν_eff = A12 / A22
    //   G_eff = A66 / t
    // The isotropy diagnostic: A11 ≈ A22 (balanced + 8 orientations) and
    // 2·A66 ≈ A11 − A12 (the classical thin-plate isotropy identity).
    console.log('[push-223] quasi-iso ABD =', JSON.stringify({
        a11, a22, a12, a66,
        a11_over_a22: a11 / a22,
        identity_lhs: 2 * a66,
        identity_rhs: a11 - a12,
        identity_ratio: (2 * a66) / (a11 - a12),
    }));
    // A11 ≈ A22 ± 1 %.
    expect(Math.abs(a11 - a22) / Math.max(a11, 1)).toBeLessThan(0.01);
    // Isotropy identity 2·A66 ≈ A11 − A12 within 5 %.
    expect(Math.abs(2 * a66 - (a11 - a12)) / (a11 - a12)).toBeLessThan(0.05);
    // For [0/+45/−45/90]s symmetric the B matrix is exactly zero.
    for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
            expect(Math.abs(snap.B_NperMM[i][j])).toBeLessThan(1e-3);
        }
    }
    // Symmetry of A.
    expect(Math.abs(snap.A_NperMM[0][1] - snap.A_NperMM[1][0])).toBeLessThan(1e-6);
    expect(Math.abs(snap.A_NperMM[0][2] - snap.A_NperMM[2][0])).toBeLessThan(1e-3);

    // ─── Cross-check: compare against headless cross-ply ABD ───
    const compare = await page.evaluate(() => {
        const h = window.__forgeCompositeFeaHelper;
        const cross = h.buildLayupFromPreset(h.LAYUP_PRESETS.CROSS_PLY);
        const quasi = h.buildLayupFromPreset(h.LAYUP_PRESETS.QUASI_ISO);
        // Both Are equal-thickness for the ABS comparison.
        const crossSec = h.sectionMatrices(cross);
        const quasiSec = h.sectionMatrices(quasi);
        const isoMetric = (A) => {
            const a11 = A[0][0], a22 = A[1][1], a66 = A[2][2], a12 = A[0][1];
            const ident = (a11 - a12) / Math.max(2 * a66, 1e-30);
            const diag  = a11 / Math.max(a22, 1e-30);
            return { ident, diag, a11, a22, a66, a12 };
        };
        return {
            cross: isoMetric(crossSec.A),
            quasi: isoMetric(quasiSec.A),
        };
    });
    console.log('[push-223] compare =', JSON.stringify(compare));
    // Cross-ply: identity ratio = (A11 − A12)/(2·A66) is FAR from 1 (UD
    // dominated — A66 ≪ A11 − A12). Quasi-iso: ratio is ≈ 1.
    expect(Math.abs(compare.quasi.ident - 1)).toBeLessThan(0.05);
    expect(Math.abs(compare.cross.ident - 1)).toBeGreaterThan(0.5);
    // Both are diagonal (A11 ≈ A22) but the magnitudes differ.
    expect(Math.abs(compare.quasi.diag - 1)).toBeLessThan(0.01);
    expect(Math.abs(compare.cross.diag - 1)).toBeLessThan(0.05);

    await shot('quasiiso-solved');
});

test('04 — [0]_8 UD + transverse tension → RF much lower than fibre tension', async () => {
    await cameraTo('iso');
    await page.evaluate(() => { try { delete window.__forgeCompositeFeaLast; } catch {} });

    // Switch to [0]_8 UD, transverse tension (TENSION_Y).
    await page.locator('[data-testid="forge-composite-fea-layup"]').selectOption('unidirectional-0');
    await page.locator('[data-testid="forge-composite-fea-loadtype"]').selectOption('tension-y');
    await page.locator('[data-testid="forge-composite-fea-loadmag"]').fill('100');
    // For UD, clamping at left in v allows the loaded edge (top) to extend
    // in y. The clamp is on left edge which doesn't fight the tension.
    await pause(250);
    await shot('ud-transverse-configured');

    await page.locator('[data-testid="forge-composite-fea-run"]').click();
    const snapTrans = await waitForLastResult(60000);
    expect(snapTrans).not.toBeNull();
    expect(snapTrans.layupPreset).toBe('unidirectional-0');
    expect(snapTrans.loadPattern).toBe('tension-y');
    expect(snapTrans.nPlies).toBe(8);
    // 8 plies × 0.125 mm = 1.0 mm.
    expect(snapTrans.totalThickness_mm).toBeCloseTo(1.0, 6);
    const rfTrans = snapTrans.fpf.RF;
    console.log('[push-223] UD transverse RF =', rfTrans,
        'criterion =', snapTrans.fpf.criterion,
        'mode =', snapTrans.fpf.mode);

    await page.evaluate(() => { try { delete window.__forgeCompositeFeaLast; } catch {} });
    // Now compare against fibre-direction tension at the same magnitude.
    await page.locator('[data-testid="forge-composite-fea-loadtype"]').selectOption('tension-x');
    await pause(250);
    await shot('ud-fibre-configured');
    await page.locator('[data-testid="forge-composite-fea-run"]').click();
    const snapFibre = await waitForLastResult(60000);
    expect(snapFibre).not.toBeNull();
    expect(snapFibre.loadPattern).toBe('tension-x');
    const rfFibre = snapFibre.fpf.RF;
    console.log('[push-223] UD fibre RF =', rfFibre,
        'criterion =', snapFibre.fpf.criterion,
        'mode =', snapFibre.fpf.mode);

    // ─── Transverse loading puts the matrix on the critical path:
    //     RF_transverse ≪ RF_fibre. Ratio should be ≥ 5× lower because
    //     Yt ≈ 60 MPa while Xt ≈ 2100 MPa.
    expect(rfTrans).toBeGreaterThan(0);
    expect(rfFibre).toBeGreaterThan(0);
    expect(rfFibre).toBeGreaterThan(rfTrans * 5);

    await shot('ud-rf-compared');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-composite-fea-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-composite-fea-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
