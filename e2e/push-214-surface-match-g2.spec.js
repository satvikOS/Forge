// PUSH-214 (Slice-165) — Real G2 Surface Match (Class-A surfacing).
//
// Drives the SurfaceMatchG2Panel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenSurfaceMatchG2 is a function +
//        the headless helper window.__forgeSurfaceMatchG2Helper exposes
//        every documented entry point (math + presets + solver +
//        verifier). Sanity-check the tensor-product Bezier primitives
//        headlessly: deCasteljau on a 2-point degenerate, surfaceEval on
//        a flat patch at the canonical corner, and the validateInputs
//        degree-mismatch error path.
//   01 — Open the panel via the `tools.surfaceMatchG2` menu action.
//        Assert every canonical test-id mounts (presets, refEdge/
//        tgtEdge buttons, sample slider, match button, close).
//   02 — Identity preset (saddle). Click Match G2, assert the solver
//        reports zero correction (post-match deviation across every
//        metric < 1e-5).
//   03 — Sphere-flat preset. Click Match G2, assert the post-match
//        G2 curvature deviation drops to < 1e-5 (curvature transfers
//        from sphere into the flat target's first 3 control rows).
//   04 — Flat-flat preset. Click Match G2 — both pre- and post-match
//        metrics are zero (no-op solve sanity).
//   05 — Close + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (identity match — zero correction)
//   - right (sphere↔flat match — curvature transfer)
//   - iso   (flat↔flat + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — headless solver budget
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-214-surface-match-g2');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'surface-match-g2-session.mp4');

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

// Wait for the panel to publish a match result on window.
async function waitForLastResult(timeoutMs = 60000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await page.evaluate(() => window.__forgeSurfaceMatchG2Last || null);
        if (r) return r;
        await pause(150);
    }
    return null;
}

// Trigger Match after wiping the previous mirror.
async function clickMatch() {
    await page.evaluate(() => { try { delete window.__forgeSurfaceMatchG2Last; } catch {} });
    await page.locator('[data-testid="forge-surface-match-g2-match"]').click();
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
        if (/push-214|surface.match|g2|forge|error|Error/i.test(t)) {
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
        console.error('[push-214] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin = null;
    try { ffmpegBin = require('ffmpeg-static'); } catch {}
    if (!ffmpegBin) {
        console.warn('[push-214] ffmpeg-static missing; leaving .webm in place');
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-214] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-214] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert helper surface + tensor-Bezier headless smoke', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenSurfaceMatchG2,
        close:   typeof window.__forgeCloseSurfaceMatchG2,
        helper:  typeof window.__forgeSurfaceMatchG2Helper,
        helperKeys: window.__forgeSurfaceMatchG2Helper
            ? Object.keys(window.__forgeSurfaceMatchG2Helper).sort()
            : [],
        eventName:  window.__forgeSurfaceMatchG2Helper?.EVENT_NAME,
        defaultSamples: window.__forgeSurfaceMatchG2Helper?.DEFAULT_SAMPLES,
        edges: window.__forgeSurfaceMatchG2Helper?.EDGES,
        g0Threshold: window.__forgeSurfaceMatchG2Helper?.G0_THRESHOLD,
        g2Threshold: window.__forgeSurfaceMatchG2Helper?.G2_THRESHOLD,
    }));
    console.log('[push-214] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('solveSurfaceMatchG2');
    expect(surface.helperKeys).toContain('verifyG2Match');
    expect(surface.helperKeys).toContain('normaliseSurface');
    expect(surface.helperKeys).toContain('deCasteljau');
    expect(surface.helperKeys).toContain('deCasteljauDeriv1');
    expect(surface.helperKeys).toContain('deCasteljauDeriv2');
    expect(surface.helperKeys).toContain('surfaceEval');
    expect(surface.helperKeys).toContain('surfaceDu');
    expect(surface.helperKeys).toContain('surfaceDv');
    expect(surface.helperKeys).toContain('surfaceDuu');
    expect(surface.helperKeys).toContain('surfaceDvv');
    expect(surface.helperKeys).toContain('surfaceLocalGeometry');
    expect(surface.helperKeys).toContain('edgeMeta');
    expect(surface.helperKeys).toContain('getEdgeRow');
    expect(surface.helperKeys).toContain('setEdgeRow');
    expect(surface.helperKeys).toContain('makeBicubicFlatPatch');
    expect(surface.helperKeys).toContain('makeBicubicSpherePatch');
    expect(surface.helperKeys).toContain('makeBicubicSaddlePatch');
    expect(surface.helperKeys).toContain('makeFlatRefTargetPair');
    expect(surface.helperKeys).toContain('makeSphereFlatPair');
    expect(surface.helperKeys).toContain('makeIdentityPair');
    expect(surface.eventName).toBe('forge:surface-match-g2-built');
    expect(surface.defaultSamples).toBeGreaterThan(0);
    expect(Array.isArray(surface.edges)).toBe(true);
    expect(surface.edges).toContain('v0');
    expect(surface.edges).toContain('v1');
    expect(surface.edges).toContain('u0');
    expect(surface.edges).toContain('u1');
    expect(surface.g0Threshold).toBeGreaterThan(0);
    expect(surface.g2Threshold).toBeGreaterThan(0);

    // Headless tensor-Bezier sanity.
    const smoke = await page.evaluate(() => {
        const h = window.__forgeSurfaceMatchG2Helper;
        const flat = h.makeBicubicFlatPatch({ cx: 0, cy: 0, z: 0, w: 100, h: 100 });
        const norm = h.normaliseSurface(flat);
        // Eval the corners — should match the control-point corners
        // exactly (Bezier interpolates corners).
        const p00 = h.surfaceEval(norm.P, norm.n, norm.m, 0, 0);
        const p10 = h.surfaceEval(norm.P, norm.n, norm.m, 1, 0);
        const p01 = h.surfaceEval(norm.P, norm.n, norm.m, 0, 1);
        const p11 = h.surfaceEval(norm.P, norm.n, norm.m, 1, 1);
        // Surface midpoint (u=0.5, v=0.5) should be (0, 0, 0) on a flat
        // patch centred at origin.
        const pMid = h.surfaceEval(norm.P, norm.n, norm.m, 0.5, 0.5);
        // Cross-derivative on a flat patch in z=0: ∂S/∂v should have
        // z-component 0.
        const dv0 = h.surfaceDv(norm.P, norm.n, norm.m, 0.5, 0);
        // De Casteljau on a 2-point curve → linear interp.
        const dc2 = h.deCasteljau([[0,0,0],[10,0,0]], 0.3);
        return { p00, p10, p01, p11, pMid, dv0, dc2,
                 n: norm.n, m: norm.m,
                 corner00: norm.P[0][0],
                 corner33: norm.P[3][3] };
    });
    console.log('[push-214] tensor-bezier smoke =', JSON.stringify(smoke));
    expect(smoke.n).toBe(3);
    expect(smoke.m).toBe(3);
    // Bezier interpolation property: corner control points lie on the surface.
    expect(smoke.p00[0]).toBeCloseTo(smoke.corner00[0], 6);
    expect(smoke.p00[1]).toBeCloseTo(smoke.corner00[1], 6);
    expect(smoke.p00[2]).toBeCloseTo(smoke.corner00[2], 6);
    expect(smoke.p11[0]).toBeCloseTo(smoke.corner33[0], 6);
    expect(smoke.p11[1]).toBeCloseTo(smoke.corner33[1], 6);
    expect(smoke.p11[2]).toBeCloseTo(smoke.corner33[2], 6);
    // Flat patch centred at origin → midpoint is at origin.
    expect(Math.abs(smoke.pMid[0])).toBeLessThan(1e-9);
    expect(Math.abs(smoke.pMid[1])).toBeLessThan(1e-9);
    expect(Math.abs(smoke.pMid[2])).toBeLessThan(1e-9);
    // Flat patch in z=0: ∂S/∂v has z-component 0.
    expect(Math.abs(smoke.dv0[2])).toBeLessThan(1e-9);
    // De Casteljau on 2-point linear curve.
    expect(smoke.dc2[0]).toBeCloseTo(3.0, 6);  // 0.3 * 10
    expect(smoke.dc2[1]).toBeCloseTo(0, 9);
    expect(smoke.dc2[2]).toBeCloseTo(0, 9);

    // Degree-mismatch error path: a degree-2 ref against a degree-3 target.
    const degenCheck = await page.evaluate(() => {
        const h = window.__forgeSurfaceMatchG2Helper;
        // Build a 3×3 bicubic flat patch (target).
        const tgt = h.makeBicubicFlatPatch({ cx: 0, cy: 0, z: 0, w: 100, h: 100 });
        // Build a "degree-2" reference by trimming a row.
        const ref = {
            controlPoints: [
                [[-50, -50, 0], [0, -50, 0], [50, -50, 0]],
                [[-50,   0, 0], [0,   0, 0], [50,   0, 0]],
                [[-50,  50, 0], [0,  50, 0], [50,  50, 0]],
            ],
        };
        const v = h.validateInputs({
            reference: ref, target: tgt,
            refEdge: 'v0', tgtEdge: 'v0',
        });
        return v;
    });
    console.log('[push-214] degree-mismatch =', JSON.stringify(degenCheck));
    expect(degenCheck.ok).toBe(false);
    expect(degenCheck.reason).toContain('boundary degree mismatch');

    await shot('host-surface-ok');
});

test('01 — open panel via tools.surfaceMatchG2', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.surfaceMatchG2');
    await page.waitForSelector('[data-testid="forge-surface-match-g2-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-surface-match-g2-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-preset-flat-flat"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-preset-sphere-flat"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-preset-identity"]')).toBeVisible();
    for (const e of ['v0', 'v1', 'u0', 'u1']) {
        await expect(page.locator(`[data-testid="forge-surface-match-g2-ref-edge-${e}"]`))
            .toBeVisible();
        await expect(page.locator(`[data-testid="forge-surface-match-g2-tgt-edge-${e}"]`))
            .toBeVisible();
    }
    await expect(page.locator('[data-testid="forge-surface-match-g2-samples-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-samples-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-match"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-surface-match-g2-close"]')).toBeVisible();

    // Default preset is flat-flat at u1/u0.
    const panel = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-surface-match-g2-panel"]');
        return {
            preset:  el?.dataset.preset,
            refEdge: el?.dataset.refEdge,
            tgtEdge: el?.dataset.tgtEdge,
            samples: el?.dataset.samples,
            ok:      el?.dataset.inputOk,
        };
    });
    console.log('[push-214] panel defaults =', JSON.stringify(panel));
    expect(panel.preset).toBe('flat-flat');
    expect(panel.refEdge).toBe('u1');
    expect(panel.tgtEdge).toBe('u0');
    expect(panel.ok).toBe('1');
});

test('02 — identity preset: zero correction post-match', async () => {
    await cameraTo('top');
    await page.locator('[data-testid="forge-surface-match-g2-preset-identity"]').click();
    await pause(200);
    await shot('identity-configured');

    await clickMatch();
    const r = await waitForLastResult(30000);
    expect(r).not.toBeNull();
    console.log('[push-214] identity result =', JSON.stringify({
        ok: r.ok, preset: r.preset,
        refEdge: r.refEdge, tgtEdge: r.tgtEdge,
        preG0: r.before?.g0Max,
        preG1: r.before?.normalDevMaxDeg,
        preG2: r.before?.meanCurvMaxDelta,
        postG0: r.after?.g0Max,
        postG1: r.after?.normalDevMaxDeg,
        postG2: r.after?.meanCurvMaxDelta,
        postK1: r.after?.princCurv1MaxDelta,
        postK2: r.after?.princCurv2MaxDelta,
    }));
    expect(r.ok).toBe(true);
    expect(r.preset).toBe('identity');
    // Identity case: both before and after should be at numerical floor.
    // The before / after metrics are IDENTICAL since the solver produces
    // zero correction on an identity input.
    expect(r.before.g0Max).toBeLessThan(1e-9);
    expect(r.after.g0Max).toBeLessThan(1e-9);
    // normalDev has a tiny floor due to acos rounding on parallel
    // normals — well under the 1e-3 threshold below.
    expect(r.after.normalDevMaxDeg).toBeLessThan(1e-5);
    expect(r.after.meanCurvMaxDelta).toBeLessThan(1e-9);
    expect(r.after.princCurv1MaxDelta).toBeLessThan(1e-9);
    expect(r.after.princCurv2MaxDelta).toBeLessThan(1e-9);
    // All G0/G1/G2 PASS at the module's published thresholds.
    expect(r.after.g0Pass).toBe(true);
    expect(r.after.g1Pass).toBe(true);
    expect(r.after.g2Pass).toBe(true);

    // Read the edited rows out of the panel — for identity solve the
    // values should EQUAL the reference's own first 3 control rows.
    const rowsHeadless = await page.evaluate(() => {
        const h = window.__forgeSurfaceMatchG2Helper;
        const pair = h.makeIdentityPair({});
        // Clone ref's first 3 rows at refEdge='v0' for comparison.
        const refRow0 = h.getEdgeRow(
            h.normaliseSurface(pair.reference).P,
            h.normaliseSurface(pair.reference).n,
            h.normaliseSurface(pair.reference).m,
            'v0', 0,
        );
        const refRow1 = h.getEdgeRow(
            h.normaliseSurface(pair.reference).P,
            h.normaliseSurface(pair.reference).n,
            h.normaliseSurface(pair.reference).m,
            'v0', 1,
        );
        const refRow2 = h.getEdgeRow(
            h.normaliseSurface(pair.reference).P,
            h.normaliseSurface(pair.reference).n,
            h.normaliseSurface(pair.reference).m,
            'v0', 2,
        );
        // Solve.
        const r = h.solveSurfaceMatchG2({
            reference: pair.reference,
            target:    pair.target,
            refEdge: 'v0', tgtEdge: 'v0',
        });
        // Compare row by row.
        const eq = (a, b) => Math.max(
            Math.abs(a[0]-b[0]), Math.abs(a[1]-b[1]), Math.abs(a[2]-b[2]));
        const row0err = refRow0.reduce(
            (acc, p, i) => Math.max(acc, eq(p, r.edited.row0[i])), 0);
        const row1err = refRow1.reduce(
            (acc, p, i) => Math.max(acc, eq(p, r.edited.row1[i])), 0);
        const row2err = refRow2.reduce(
            (acc, p, i) => Math.max(acc, eq(p, r.edited.row2[i])), 0);
        return { row0err, row1err, row2err };
    });
    console.log('[push-214] identity row errors =', JSON.stringify(rowsHeadless));
    expect(rowsHeadless.row0err).toBeLessThan(1e-9);
    expect(rowsHeadless.row1err).toBeLessThan(1e-9);
    expect(rowsHeadless.row2err).toBeLessThan(1e-9);

    await shot('identity-matched');
});

test('03 — sphere↔flat preset: G2 curvature transfer post-match < 1e-5', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-surface-match-g2-preset-sphere-flat"]').click();
    await pause(200);
    await shot('sphere-flat-configured');

    await clickMatch();
    const r = await waitForLastResult(30000);
    expect(r).not.toBeNull();
    console.log('[push-214] sphere-flat result =', JSON.stringify({
        ok: r.ok, preset: r.preset,
        refEdge: r.refEdge, tgtEdge: r.tgtEdge,
        preG0: r.before?.g0Max,
        preG1: r.before?.normalDevMaxDeg,
        preG2H: r.before?.meanCurvMaxDelta,
        preG2K1: r.before?.princCurv1MaxDelta,
        preG2K2: r.before?.princCurv2MaxDelta,
        postG0: r.after?.g0Max,
        postG1: r.after?.normalDevMaxDeg,
        postG2H: r.after?.meanCurvMaxDelta,
        postG2K1: r.after?.princCurv1MaxDelta,
        postG2K2: r.after?.princCurv2MaxDelta,
    }));
    expect(r.ok).toBe(true);
    expect(r.preset).toBe('sphere-flat');
    expect(r.refEdge).toBe('u1');
    expect(r.tgtEdge).toBe('u0');
    // Pre-match: G0 should already be ~0 because we glued boundary control
    // rows at fixture setup time. But G1 and G2 should show the sphere
    // vs flat mismatch.
    expect(r.before.g0Max).toBeLessThan(1e-9);
    // Pre-match normal deviation must show the kink between curved sphere
    // and flat target.
    expect(r.before.normalDevMaxDeg).toBeGreaterThan(0.01);
    // Pre-match mean curvature delta must show the sphere's curvature.
    expect(r.before.meanCurvMaxDelta).toBeGreaterThan(1e-4);

    // Post-match: G0/G1/G2 all drop to numerical floor.
    expect(r.after.g0Max).toBeLessThan(1e-9);
    expect(r.after.normalDevMaxDeg).toBeLessThan(1e-6);
    expect(r.after.meanCurvMaxDelta).toBeLessThan(1e-5);
    expect(r.after.princCurv1MaxDelta).toBeLessThan(1e-5);
    expect(r.after.princCurv2MaxDelta).toBeLessThan(1e-5);
    expect(r.after.g0Pass).toBe(true);
    expect(r.after.g1Pass).toBe(true);
    expect(r.after.g2Pass).toBe(true);

    // The post-match target's first 3 cross-boundary rows must now
    // contain the sphere's curvature. Headless check: read row 1 + row 2
    // from the panel's mirror and confirm they're NOT equal to the
    // original flat target's row 1/2 (i.e. the match really edited them).
    const change = await page.evaluate(() => {
        const h = window.__forgeSurfaceMatchG2Helper;
        const original = h.makeBicubicFlatPatch({ cx: 50, cy: 0, z: 0, w: 100, h: 100 });
        const origRow1 = h.getEdgeRow(original.controlPoints, 3, 3, 'u0', 1);
        const origRow2 = h.getEdgeRow(original.controlPoints, 3, 3, 'u0', 2);
        const edited = window.__forgeSurfaceMatchG2Last.editedRows;
        // Difference between edited and original (Manhattan).
        const dist = (a, b) =>
            Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
        const row1diff = origRow1.reduce(
            (acc, p, i) => acc + dist(p, edited.row1[i]), 0);
        const row2diff = origRow2.reduce(
            (acc, p, i) => acc + dist(p, edited.row2[i]), 0);
        return { row1diff, row2diff };
    });
    console.log('[push-214] post-match row drift =', JSON.stringify(change));
    // For a real curvature transfer the row-1 and row-2 must move
    // meaningfully — at least 0.1 mm in cumulative L1 distance.
    expect(change.row1diff).toBeGreaterThan(0.1);
    expect(change.row2diff).toBeGreaterThan(0.1);

    await shot('sphere-flat-matched');
});

test('04 — flat↔flat preset: no-op match (zero pre + zero post)', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-surface-match-g2-preset-flat-flat"]').click();
    await pause(200);
    await shot('flat-flat-configured');

    await clickMatch();
    const r = await waitForLastResult(30000);
    expect(r).not.toBeNull();
    console.log('[push-214] flat-flat result =', JSON.stringify({
        ok: r.ok, preset: r.preset,
        refEdge: r.refEdge, tgtEdge: r.tgtEdge,
        preG0: r.before?.g0Max,
        preG1: r.before?.normalDevMaxDeg,
        preG2: r.before?.meanCurvMaxDelta,
        postG0: r.after?.g0Max,
        postG1: r.after?.normalDevMaxDeg,
        postG2: r.after?.meanCurvMaxDelta,
    }));
    expect(r.ok).toBe(true);
    expect(r.preset).toBe('flat-flat');
    // Both flat in z=0: every metric is numerically zero both pre and post.
    expect(r.before.g0Max).toBeLessThan(1e-9);
    expect(r.before.meanCurvMaxDelta).toBeLessThan(1e-9);
    expect(r.after.g0Max).toBeLessThan(1e-9);
    expect(r.after.normalDevMaxDeg).toBeLessThan(1e-6);
    expect(r.after.meanCurvMaxDelta).toBeLessThan(1e-9);
    expect(r.after.g0Pass).toBe(true);
    expect(r.after.g1Pass).toBe(true);
    expect(r.after.g2Pass).toBe(true);
    await shot('flat-flat-matched');
});

test('05 — close panel + final shot', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-surface-match-g2-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-surface-match-g2-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
