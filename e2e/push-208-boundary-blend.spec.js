// PUSH-208 (Slice-155) — Real N-sided Boundary Blend (Class-A surfacing).
//
// Drives the BoundaryBlendPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenBoundaryBlend is a function +
//        the headless helper window.__forgeBoundaryBlendHelper exposes
//        every documented entry point (math + presets + meshing).
//        Sanity-check the MVC + N-gon primitives headlessly: corners,
//        meanValueCoords at canonical points (centroid + corner +
//        midpoint), and the validateInputs degenerate path.
//   01 — Open the panel via the `tools.boundaryBlend` menu action.
//        Assert every canonical test-id mounts (presets, slider, build,
//        close).
//   02 — 3-sided Bezier test. Choose the 'triangle' preset, drop the
//        grid to a reasonable resolution, click Build. Assert the
//        result mesh has > 100 triangles, every per-edge G1 deviation
//        is finite and the global max is < 5° (the ICEM "first-pass
//        acceptable" threshold).
//   03 — 5-sided test (pentagon polyline). Re-build, assert the result
//        carries N=5 and produces a valid mesh; loop quickly through
//        every N ∈ {3..8} to prove the math scales.
//   04 — Degenerate (all curves collinear). Click the explicit
//        'collinear (err)' preset, hit Build, assert the panel
//        surfaces the real "collinear" reason (no fake mesh emitted,
//        no crash).
//   05 — Close + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (3-sided Bezier build + G1 assertions)
//   - right (5-sided + scan N=3..8)
//   - iso   (degenerate error + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — well above the headless math budget
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-208-boundary-blend');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'boundary-blend-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
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

// Wait for the panel to publish a build result on window.
async function waitForLastResult(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await page.evaluate(() => window.__forgeBoundaryBlendLast || null);
        if (r) return r;
        await pause(150);
    }
    return null;
}

// Trigger Build after wiping the previous mirror.
async function clickBuild() {
    await page.evaluate(() => { try { delete window.__forgeBoundaryBlendLast; } catch {} });
    await page.locator('[data-testid="forge-boundary-blend-build"]').click();
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
        if (/push-208|boundary|blend|forge|error|Error/i.test(t)) {
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
        console.error('[push-208] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin = null;
    try { ffmpegBin = require('ffmpeg-static'); } catch {}
    if (!ffmpegBin) {
        console.warn('[push-208] ffmpeg-static missing; leaving .webm in place');
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-208] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-208] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert helper surface + MVC headless smoke', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenBoundaryBlend,
        close:   typeof window.__forgeCloseBoundaryBlend,
        helper:  typeof window.__forgeBoundaryBlendHelper,
        helperKeys: window.__forgeBoundaryBlendHelper
            ? Object.keys(window.__forgeBoundaryBlendHelper).sort()
            : [],
        eventName:  window.__forgeBoundaryBlendHelper?.EVENT_NAME,
        minSides:   window.__forgeBoundaryBlendHelper?.MIN_SIDES,
        maxSides:   window.__forgeBoundaryBlendHelper?.MAX_SIDES,
        defaultGrid: window.__forgeBoundaryBlendHelper?.DEFAULT_GRID,
        threshold:  window.__forgeBoundaryBlendHelper?.G1_THRESHOLD_DEG,
    }));
    console.log('[push-208] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('buildNSidedBlend');
    expect(surface.helperKeys).toContain('buildTestTriangle');
    expect(surface.helperKeys).toContain('buildTestNGon');
    expect(surface.helperKeys).toContain('buildCollinearDegenerate');
    expect(surface.helperKeys).toContain('validateInputs');
    expect(surface.helperKeys).toContain('analyseG1');
    expect(surface.helperKeys).toContain('blendPoint');
    expect(surface.helperKeys).toContain('meanValueCoords');
    expect(surface.helperKeys).toContain('nGonCorners');
    expect(surface.helperKeys).toContain('tessellateBlend');
    expect(surface.helperKeys).toContain('evalCurve');
    expect(surface.helperKeys).toContain('evalCurveTangent');
    expect(surface.helperKeys).toContain('buildBlendMesh');
    expect(surface.helperKeys).toContain('buildBoundaryCurvesPreview');
    expect(surface.eventName).toBe('forge:boundary-blend-built');
    expect(surface.minSides).toBe(3);
    expect(surface.maxSides).toBe(8);
    expect(surface.defaultGrid).toBeGreaterThan(0);
    expect(surface.threshold).toBeGreaterThan(0);

    // Headless MVC sanity. nGonCorners(5) should produce 5 points on the
    // unit circle; meanValueCoords at the centre should be uniform (1/N
    // everywhere); meanValueCoords at a corner should collapse to (1, 0,
    // 0, ...) for that corner; on the midpoint of edge 0 should give
    // (0.5, 0.5, 0, ...).
    const mvc = await page.evaluate(() => {
        const h = window.__forgeBoundaryBlendHelper;
        const N = 5;
        const corners = h.nGonCorners(N);
        const centre = h.meanValueCoords(N, corners, 0, 0);
        const cornerHit = h.meanValueCoords(N, corners, corners[0][0], corners[0][1]);
        const edge0Mid = h.meanValueCoords(N, corners,
            (corners[0][0] + corners[1][0]) / 2,
            (corners[0][1] + corners[1][1]) / 2);
        return {
            cornersLen: corners.length,
            cornersFirst: corners[0],
            centre,
            cornerHit,
            edge0Mid,
            cornerSumOk: corners.every(
                (p) => Math.abs(Math.hypot(p[0], p[1]) - 1) < 1e-9),
        };
    });
    console.log('[push-208] mvc =', JSON.stringify(mvc));
    expect(mvc.cornersLen).toBe(5);
    expect(mvc.cornersSumOk = mvc.cornerSumOk).toBe(true);
    // Centroid → uniform 1/N.
    expect(mvc.centre.length).toBe(5);
    for (const w of mvc.centre) {
        expect(w).toBeCloseTo(1 / 5, 6);
    }
    // Corner-hit → one-hot at corner 0.
    expect(mvc.cornerHit[0]).toBeCloseTo(1, 6);
    expect(mvc.cornerHit[1]).toBeCloseTo(0, 6);
    expect(mvc.cornerHit[2]).toBeCloseTo(0, 6);
    expect(mvc.cornerHit[3]).toBeCloseTo(0, 6);
    expect(mvc.cornerHit[4]).toBeCloseTo(0, 6);
    // Edge 0 midpoint → λ_0 ≈ λ_1 ≈ 0.5, λ_2..4 ≈ 0.
    expect(mvc.edge0Mid[0]).toBeCloseTo(0.5, 4);
    expect(mvc.edge0Mid[1]).toBeCloseTo(0.5, 4);
    expect(Math.abs(mvc.edge0Mid[2])).toBeLessThan(1e-4);
    expect(Math.abs(mvc.edge0Mid[3])).toBeLessThan(1e-4);
    expect(Math.abs(mvc.edge0Mid[4])).toBeLessThan(1e-4);

    // Degenerate input must report a real error without throwing.
    const degen = await page.evaluate(() => {
        const h = window.__forgeBoundaryBlendHelper;
        const inputs = h.buildCollinearDegenerate({ N: 3, length: 100 });
        return h.validateInputs(inputs);
    });
    console.log('[push-208] degen validate =', JSON.stringify(degen));
    expect(degen.ok).toBe(false);
    expect(degen.reason).toContain('collinear');

    await shot('host-surface-ok');
});

test('01 — open panel via tools.boundaryBlend', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.boundaryBlend');
    await page.waitForSelector('[data-testid="forge-boundary-blend-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-boundary-blend-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-preset-triangle"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-preset-pentagon"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-preset-oct"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-preset-degenerate"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-curve-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-grid-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-grid-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-build"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-close"]')).toBeVisible();

    // Default preset is the 3-Bezier triangle.
    const panel = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-boundary-blend-panel"]');
        return {
            n:      el?.dataset.nSides,
            gridU:  el?.dataset.gridU,
            gridV:  el?.dataset.gridV,
            preset: el?.dataset.preset,
            ok:     el?.dataset.inputOk,
        };
    });
    console.log('[push-208] panel defaults =', JSON.stringify(panel));
    expect(Number(panel.n)).toBe(3);
    expect(panel.preset).toBe('triangle');
    expect(panel.ok).toBe('1');
});

test('02 — 3-sided Bezier build → > 100 triangles + G1 < 5°', async () => {
    await cameraTo('top');
    // Make sure triangle preset is active.
    await page.locator('[data-testid="forge-boundary-blend-preset-triangle"]').click();
    await pause(200);

    // Drop grid to 20 for snappy build (still >> 100 triangles).
    await page.locator('[data-testid="forge-boundary-blend-grid-input"]').fill('20');
    await pause(150);

    await shot('triangle-configured');
    await clickBuild();
    const r = await waitForLastResult(60000);
    expect(r).not.toBeNull();
    console.log('[push-208] triangle result =', JSON.stringify({
        ok: r.ok,
        N: r.N,
        vertices: r.vertexCount,
        triangles: r.triangleCount,
        g1Max: r.g1?.globalMaxDeg,
        g1Avg: r.g1?.globalAvgDeg,
        g1Pass: r.g1?.pass,
    }));
    expect(r.ok).toBe(true);
    expect(r.N).toBe(3);
    expect(r.triangleCount).toBeGreaterThan(100);
    // Vertex count = centroid + N sub-quad rings of (gU+1)·gV = 3·(21)·20 + 1.
    expect(r.vertexCount).toBeGreaterThan(100);
    // G1 chips render.
    await expect(page.locator('[data-testid="forge-boundary-blend-chip-g1-max"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-boundary-blend-chip-g1-avg"]')).toBeVisible();
    // Per-edge G1 list renders.
    await expect(page.locator('[data-testid="forge-boundary-blend-g1-edge-list"]')).toBeVisible();
    for (let i = 0; i < 3; i++) {
        await expect(page.locator(`[data-testid="forge-boundary-blend-g1-edge-${i}"]`))
            .toBeVisible();
    }
    // Real numbers — every per-edge max is finite, the global max is < 5°.
    expect(Number.isFinite(r.g1.globalMaxDeg)).toBe(true);
    expect(Number.isFinite(r.g1.globalAvgDeg)).toBe(true);
    expect(r.g1.threshold).toBeCloseTo(5.0, 6);
    expect(r.g1.perEdge.length).toBe(3);
    for (const e of r.g1.perEdge) {
        expect(Number.isFinite(e.maxDeg)).toBe(true);
        expect(Number.isFinite(e.avgDeg)).toBe(true);
        expect(e.samples).toBeGreaterThan(0);
    }
    expect(r.g1.globalMaxDeg).toBeLessThan(5.0);

    // Scene was published.
    const hasGroup = await page.evaluate(() => !!window.__forgeBoundaryBlendGroup);
    console.log('[push-208] scene group =', hasGroup);
    // If renderer hasn't published its scene yet, __forgeBoundaryBlendGroup is
    // null but the math still completed — assert truthiness only when
    // window.__forgeScene exists.
    const sceneExists = await page.evaluate(() => !!window.__forgeScene);
    if (sceneExists) {
        expect(hasGroup).toBe(true);
    }

    await shot('triangle-built');
});

test('03 — 5-sided + scan N=3..8 polylines all build', async () => {
    await cameraTo('right');
    // Pentagon preset first — full UI flow.
    await page.locator('[data-testid="forge-boundary-blend-preset-pentagon"]').click();
    await pause(200);
    // Keep grid 20.
    await clickBuild();
    const r5 = await waitForLastResult(60000);
    expect(r5).not.toBeNull();
    console.log('[push-208] pentagon =', JSON.stringify({
        N: r5.N, tris: r5.triangleCount, g1Max: r5.g1?.globalMaxDeg,
    }));
    expect(r5.ok).toBe(true);
    expect(r5.N).toBe(5);
    expect(r5.triangleCount).toBeGreaterThan(100);
    expect(r5.g1.perEdge.length).toBe(5);
    await shot('pentagon-built');

    // Scan every supported N headlessly so we prove the math reaches N=8.
    const scan = await page.evaluate(() => {
        const h = window.__forgeBoundaryBlendHelper;
        const out = [];
        for (let N = h.MIN_SIDES; N <= h.MAX_SIDES; N++) {
            const inputs = h.buildTestNGon({ N, size: 80 });
            const r = h.buildNSidedBlend({
                ...inputs, gridU: 12, gridV: 12,
            });
            out.push({
                N,
                ok: r.ok,
                reason: r.ok ? null : r.reason,
                tris: r.ok ? r.triangleCount : 0,
                verts: r.ok ? r.vertexCount : 0,
                g1Max: r.ok ? r.g1.globalMaxDeg : null,
                g1EdgeCount: r.ok ? r.g1.perEdge.length : 0,
            });
        }
        return out;
    });
    console.log('[push-208] N-scan =', JSON.stringify(scan));
    expect(scan.length).toBe(6);
    for (const s of scan) {
        expect(s.ok).toBe(true);
        expect(s.tris).toBeGreaterThan(20);
        expect(s.g1EdgeCount).toBe(s.N);
        expect(Number.isFinite(s.g1Max)).toBe(true);
        // Coarse 12×12 grid still keeps deviation bounded (well under
        // 30°; polyline boundaries with planar ribbons hold G1 cleanly).
        expect(s.g1Max).toBeLessThan(30);
    }
    // Spot-check N=8 specifically.
    const n8 = scan.find((s) => s.N === 8);
    expect(n8.ok).toBe(true);
    expect(n8.g1EdgeCount).toBe(8);

    await shot('n-scan-ok');
});

test('04 — degenerate (collinear) input surfaces real error', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-boundary-blend-preset-degenerate"]').click();
    await pause(200);
    await shot('degen-configured');

    // Build button must be disabled because validateInputs already failed.
    const buildDisabled = await page.locator('[data-testid="forge-boundary-blend-build"]')
        .isDisabled();
    console.log('[push-208] build disabled =', buildDisabled);
    expect(buildDisabled).toBe(true);

    // The input-error chip is visible and quotes the real reason.
    await expect(page.locator('[data-testid="forge-boundary-blend-input-err"]'))
        .toBeVisible();
    const inputErr = await page.locator('[data-testid="forge-boundary-blend-input-err"]')
        .textContent();
    console.log('[push-208] input err =', inputErr);
    expect(inputErr).toMatch(/collinear/i);

    // Headless build through the helper still returns the failure object
    // (no fake mesh emitted) — proves the panel surfaces the real error
    // by reading the math layer directly.
    const headlessFail = await page.evaluate(() => {
        const h = window.__forgeBoundaryBlendHelper;
        const inputs = h.buildCollinearDegenerate({ N: 3, length: 100 });
        const r = h.buildNSidedBlend({ ...inputs, gridU: 10, gridV: 10 });
        return { ok: r.ok, reason: r.reason };
    });
    console.log('[push-208] headless degen =', JSON.stringify(headlessFail));
    expect(headlessFail.ok).toBe(false);
    expect(headlessFail.reason).toContain('collinear');

    // No crash — panel is still mounted and reachable.
    await expect(page.locator('[data-testid="forge-boundary-blend-panel"]')).toBeVisible();
    await shot('degen-error');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-boundary-blend-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-boundary-blend-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
