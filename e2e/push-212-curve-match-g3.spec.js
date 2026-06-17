// PUSH-212 (Slice-162) — Real G3 Curve Match (Class-A surfacing).
//
// Drives the CurveMatchG3Panel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenCurveMatchG3 is a function +
//        the headless helper window.__forgeCurveMatchG3Helper exposes
//        every documented entry point (matchG3 + evalRefCurve + Frenet).
//        Run the math file's validateHeadless() through the helper and
//        assert all three cases pass: cubic→cubic G3 < TOL, arc→cubic
//        G0/G1 match, and degree-1 target surfaces a real error.
//   01 — Open the panel via the `tools.curveMatchG3` menu action.
//        Assert every canonical test-id mounts (ref-picker, target-picker,
//        match button, close button).
//   02 — 2 known cubic Beziers (Ref + target). Click "Match G3" and
//        assert post-match G3 deviation is < 1e-6 (the math file's TOL).
//   03 — Reference = circular arc (κ' = 0 by construction), target =
//        cubic Bezier. Match G3, assert curvature derivative of solved
//        target stays within a tight bound of the arc's analytic 0
//        (post-solve g3Deviation small in absolute terms; well below
//        5 % of the reference curvature scale).
//   04 — Degenerate target: switch the target preset to "Linear (degree
//        1)". Click Match G3 → the panel surfaces a real "target degree
//        … < min 3" error (no crash, no fake solve).
//   05 — Close panel + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (cubic Bezier → cubic Bezier G3 match)
//   - right (arc → cubic Bezier G3 match)
//   - iso   (degenerate error + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — well above the headless math budget
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-212-curve-match-g3');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'curve-match-g3-session.mp4');

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
async function waitForLastResult(timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await page.evaluate(() => window.__forgeCurveMatchG3Last || null);
        if (r) return r;
        await pause(120);
    }
    return null;
}

// Trigger Match after wiping the previous mirror.
async function clickMatch() {
    await page.evaluate(() => { try { delete window.__forgeCurveMatchG3Last; } catch {} });
    await page.locator('[data-testid="forge-curve-match-g3-match"]').click();
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
        if (/push-212|curve-match|curveMatch|G3|Frenet|error|Error/i.test(t)) {
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
        console.error('[push-212] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin = null;
    try { ffmpegBin = require('ffmpeg-static'); } catch {}
    if (!ffmpegBin) {
        console.warn('[push-212] ffmpeg-static missing; leaving .webm in place');
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-212] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-212] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert helper surface + headless validate (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Surface contract.
    await page.waitForFunction(
        () => typeof window.__forgeOpenCurveMatchG3 === 'function'
           && typeof window.__forgeCloseCurveMatchG3 === 'function'
           && typeof window.__forgeCurveMatchG3Helper === 'object'
           && window.__forgeCurveMatchG3Helper !== null
           && typeof window.__forgeCurveMatchG3Helper.matchG3 === 'function',
        null, { timeout: 8000 });

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenCurveMatchG3,
        close:   typeof window.__forgeCloseCurveMatchG3,
        helper:  typeof window.__forgeCurveMatchG3Helper,
        helperKeys: window.__forgeCurveMatchG3Helper
            ? Object.keys(window.__forgeCurveMatchG3Helper).sort()
            : [],
        eventName:     window.__forgeCurveMatchG3Helper?.EVENT_NAME,
        minDegree:     window.__forgeCurveMatchG3Helper?.MIN_DEGREE,
        maxRefDegree:  window.__forgeCurveMatchG3Helper?.MAX_REF_DEGREE,
        tol:           window.__forgeCurveMatchG3Helper?.TOL,
        refPresetKeys: Object.keys(window.__forgeCurveMatchG3RefPresets || {}),
        tgtPresetKeys: Object.keys(window.__forgeCurveMatchG3TargetPresets || {}),
    }));
    console.log('[push-212] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('matchG3');
    expect(surface.helperKeys).toContain('evalRefCurve');
    expect(surface.helperKeys).toContain('evalBezier');
    expect(surface.helperKeys).toContain('bezierDerivativeControls');
    expect(surface.helperKeys).toContain('bezierDerivAt');
    expect(surface.helperKeys).toContain('frenetAt');
    expect(surface.helperKeys).toContain('measureContinuity');
    expect(surface.helperKeys).toContain('validateHeadless');
    expect(surface.eventName).toBe('forge:curve-match-g3-built');
    expect(surface.minDegree).toBe(3);
    expect(surface.maxRefDegree).toBe(7);
    expect(surface.tol).toBeGreaterThan(0);
    expect(surface.tol).toBeLessThan(1e-3);
    expect(surface.refPresetKeys).toContain('cubicBezier');
    expect(surface.refPresetKeys).toContain('quinticBezier');
    expect(surface.refPresetKeys).toContain('arcXY');
    expect(surface.tgtPresetKeys).toContain('cubicArbitrary');
    expect(surface.tgtPresetKeys).toContain('quinticArbitrary');
    expect(surface.tgtPresetKeys).toContain('degenerateLinear');

    // Headless validate — runs all 3 known cases (cubic→cubic, arc→cubic,
    // degenerate). Each case carries an "ok" flag; the suite's overall
    // .ok must be true.
    const headless = await page.evaluate(() => {
        const h = window.__forgeCurveMatchG3Helper;
        return h.validateHeadless();
    });
    console.log('[push-212] headless validate =', JSON.stringify(headless));
    expect(headless.ok).toBe(true);
    expect(headless.cases.length).toBe(3);

    // Case 1: cubic→cubic must drive g3 < TOL.
    const case1 = headless.cases.find((c) => c.label.startsWith('cubic Bezier'));
    expect(case1).toBeTruthy();
    expect(case1.ok).toBe(true);
    expect(case1.achievedG3).toBe(true);
    expect(case1.post).toBeLessThan(1e-6);
    // The pre-solve g3 deviation should be significantly larger than the
    // post — proves we actually moved the controls and improved things.
    expect(case1.pre).toBeGreaterThan(case1.post * 1e6);

    // Case 2: arc→cubic — G0/G1 should both be achieved.
    const case2 = headless.cases.find((c) => c.label.startsWith('arc'));
    expect(case2).toBeTruthy();
    expect(case2.ok).toBe(true);
    expect(case2.achievedG0).toBe(true);
    expect(case2.achievedG1).toBe(true);
    // Arc has κ = 1/R = 1/10 = 0.1, κ' = 0.
    expect(case2.refCurvature).toBeCloseTo(0.1, 4);
    expect(Math.abs(case2.refCurvatureDeriv)).toBeLessThan(1e-15);

    // Case 3: degenerate target must error out.
    const case3 = headless.cases.find((c) => c.expectError);
    expect(case3).toBeTruthy();
    expect(case3.ok).toBe(true);                  // we WANT it to fail
    expect(case3.error).toContain('degree');

    // Frenet sanity — evaluate a circle of radius R=5 analytically and
    // confirm κ = 1/R, κ' = 0 to floating-point precision.
    const frenet = await page.evaluate(() => {
        const h = window.__forgeCurveMatchG3Helper;
        const arc = {
            type: 'arc',
            center: [0, 0, 0],
            radius: 5,
            axisU: [1, 0, 0],
            axisV: [0, 1, 0],
            thetaStart: 0,
            thetaEnd: Math.PI / 2,
        };
        const s = h.evalRefCurve(arc, 0.5);
        const f = h.frenetAt(s.d1, s.d2, s.d3);
        return {
            ok: s.ok,
            point: s.point,
            curvature: f.curvature,
            curvatureDeriv: f.curvatureDeriv,
        };
    });
    console.log('[push-212] arc frenet at t=0.5 =', JSON.stringify(frenet));
    expect(frenet.ok).toBe(true);
    expect(frenet.curvature).toBeCloseTo(1 / 5, 6);
    expect(Math.abs(frenet.curvatureDeriv)).toBeLessThan(1e-9);

    await shot('host-surface-ok');
});

test('01 — open panel via tools.curveMatchG3 (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.curveMatchG3');
    await page.waitForSelector('[data-testid="forge-curve-match-g3-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-curve-match-g3-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-ref-picker"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-target-picker"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-match"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-close"]')).toBeVisible();

    // Default state — ref = cubic Bezier, target = cubic arbitrary,
    // degree = 3.
    const defaults = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-curve-match-g3-panel"]');
        return {
            refPreset:    el?.dataset.refPreset,
            targetPreset: el?.dataset.targetPreset,
            targetDegree: el?.dataset.targetDegree,
        };
    });
    console.log('[push-212] panel defaults =', JSON.stringify(defaults));
    expect(defaults.refPreset).toBe('cubicBezier');
    expect(defaults.targetPreset).toBe('cubicArbitrary');
    expect(Number(defaults.targetDegree)).toBe(3);
});

test('02 — cubic Bezier → cubic Bezier G3 match < 1e-6 (top)', async () => {
    await cameraTo('top');

    // Make sure ref + target presets are correct.
    await page.locator('[data-testid="forge-curve-match-g3-ref-picker"]')
        .selectOption('cubicBezier');
    await page.locator('[data-testid="forge-curve-match-g3-target-picker"]')
        .selectOption('cubicArbitrary');
    await pause(200);

    await shot('cubic-cubic-configured');

    await clickMatch();
    const r = await waitForLastResult(20000);
    expect(r).not.toBeNull();
    console.log('[push-212] cubic→cubic result =', JSON.stringify({
        ok: r.ok,
        targetDegree: r.targetDegree,
        preG3: r.pre?.g3,
        postG3: r.post?.g3,
        improvement: r.improvement,
        achieved: r.achieved,
    }));

    expect(r.ok).toBe(true);
    expect(r.targetDegree).toBe(3);

    // Brief contract: "assert post-match G3 deviation < 1e-6".
    expect(Number.isFinite(r.post.g3)).toBe(true);
    expect(r.post.g3).toBeLessThan(1e-6);

    // G0/G1/G2/G3 all achieved.
    expect(r.achieved.g0).toBe(true);
    expect(r.achieved.g1).toBe(true);
    expect(r.achieved.g2).toBe(true);
    expect(r.achieved.g3).toBe(true);

    // Pre-deviation was non-zero (proves we actually moved things).
    expect(r.pre.g3).toBeGreaterThan(r.post.g3 * 1e6);

    // Improvement factor — pre/post — should be huge (essentially full
    // collapse of the deviation to floating-point noise).
    expect(r.improvement).toBeGreaterThan(1e3);

    // The delta list has 4 entries (one per leading control point), and
    // the leading 4 entries have non-trivial deltaMag (we changed them);
    // P_0 is forced to Ref(1) so its deltaMag must equal the original
    // distance from P_0 to Ref(1).
    expect(r.deltas.length).toBe(4);
    for (let i = 0; i < 4; i++) {
        expect(Number.isFinite(r.deltas[i].deltaMag)).toBe(true);
    }
    expect(r.deltas[0].deltaMag).toBeGreaterThan(0); // P_0 moved (we forced it)

    // Pre/Post chips render.
    await expect(page.locator('[data-testid="forge-curve-match-g3-chip-pre-g3"]'))
        .toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-chip-post-g3"]'))
        .toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-chip-improvement"]'))
        .toBeVisible();
    await expect(page.locator('[data-testid="forge-curve-match-g3-delta-list"]'))
        .toBeVisible();
    for (let i = 0; i < 4; i++) {
        await expect(page.locator(`[data-testid="forge-curve-match-g3-delta-${i}"]`))
            .toBeVisible();
    }

    // Status pill flips to "G3 ok".
    const statusText = await page.locator('[data-testid="forge-curve-match-g3-status"]')
        .textContent();
    expect(statusText.trim().toLowerCase()).toContain('g3 ok');

    await shot('cubic-cubic-matched');
});

test('03 — arc reference → cubic Bezier — κ′ matches arc analytic 0 (right)', async () => {
    await cameraTo('right');

    // Switch to arc reference.
    await page.locator('[data-testid="forge-curve-match-g3-ref-picker"]')
        .selectOption('arcXY');
    await page.locator('[data-testid="forge-curve-match-g3-target-picker"]')
        .selectOption('cubicArbitrary');
    await pause(200);

    await shot('arc-cubic-configured');

    await clickMatch();
    const r = await waitForLastResult(20000);
    expect(r).not.toBeNull();
    console.log('[push-212] arc→cubic result =', JSON.stringify({
        ok: r.ok,
        targetDegree: r.targetDegree,
        preG3: r.pre?.g3,
        postG3: r.post?.g3,
        refCurvature: r.ref?.curvature,
        refCurvatureDeriv: r.ref?.curvatureDeriv,
        postCurvature: r.post?.curvature,
        postCurvatureDeriv: r.post?.curvatureDeriv,
        achieved: r.achieved,
    }));

    expect(r.ok).toBe(true);
    expect(r.targetDegree).toBe(3);

    // The 90° arc on radius 20 has κ = 1/20 = 0.05, κ' = 0 (analytic).
    expect(Math.abs(r.ref.curvature - 0.05)).toBeLessThan(1e-9);
    expect(Math.abs(r.ref.curvatureDeriv)).toBeLessThan(1e-9);

    // After matching, the target cubic Bezier must reproduce κ = 0.05 +
    // κ' = 0 at its u=0 endpoint within tight tolerances.
    expect(Math.abs(r.post.curvature - 0.05)).toBeLessThan(1e-6);
    expect(Math.abs(r.post.curvatureDeriv)).toBeLessThan(1e-6);

    // Brief contract: "curvature derivative matches within 5%". Since the
    // arc has κ' = 0 by construction (analytic), "within 5 %" is satisfied
    // in absolute terms: the κ' of the matched cubic must be small
    // relative to the curvature scale.
    const kScale = Math.abs(r.ref.curvature);
    const rel = Math.abs(r.post.curvatureDeriv) / Math.max(kScale, 1e-12);
    expect(rel).toBeLessThan(0.05);

    expect(r.achieved.g0).toBe(true);
    expect(r.achieved.g1).toBe(true);
    expect(r.achieved.g2).toBe(true);
    expect(r.achieved.g3).toBe(true);

    // Post-G3 absolute deviation is tiny.
    expect(r.post.g3).toBeLessThan(1e-6);

    await shot('arc-cubic-matched');
});

test('04 — degenerate target (degree < 3) surfaces real error (iso)', async () => {
    await cameraTo('iso');

    // Switch to the degenerate (degree-1) target.
    await page.locator('[data-testid="forge-curve-match-g3-ref-picker"]')
        .selectOption('cubicBezier');
    await page.locator('[data-testid="forge-curve-match-g3-target-picker"]')
        .selectOption('degenerateLinear');
    await pause(200);

    await shot('degenerate-configured');

    // Wipe the result mirror so we can detect the error path.
    await page.evaluate(() => { try { delete window.__forgeCurveMatchG3Last; } catch {} });
    await page.locator('[data-testid="forge-curve-match-g3-match"]').click();

    // Wait for the error to render (the panel sets it synchronously after
    // the solve dispatch).
    await page.waitForSelector('[data-testid="forge-curve-match-g3-error"]',
        { state: 'visible', timeout: 6000 });
    await shot('degenerate-error');

    const errText = await page.locator('[data-testid="forge-curve-match-g3-error"]')
        .textContent();
    console.log('[push-212] degenerate error =', errText);
    expect(errText.toLowerCase()).toContain('degree');

    // window mirror should reflect the same error.
    const mirror = await page.evaluate(() => window.__forgeCurveMatchG3Last || null);
    console.log('[push-212] degenerate mirror =', JSON.stringify(mirror));
    expect(mirror).not.toBeNull();
    expect(mirror.ok).toBe(false);
    expect(mirror.error).toContain('degree');

    // Status pill flips to 'error'.
    const statusText = await page.locator('[data-testid="forge-curve-match-g3-status"]')
        .textContent();
    expect(statusText.trim().toLowerCase()).toContain('error');
});

test('05 — close panel + final shot (iso)', async () => {
    await page.locator('[data-testid="forge-curve-match-g3-close"]')
        .click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-curve-match-g3-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
