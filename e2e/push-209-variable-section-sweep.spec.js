// PUSH-209 (Slice-163) — Variable-Section Sweep with guide curves.
//
// Drives the VariableSectionSweepPanel through the real Electron UI:
//
//   00 — Boot. Confirm window.__forgeOpenVariableSectionSweep is a function
//        + the headless helper window.__forgeVariableSectionSweepHelper
//        exposes every documented entry point (math + presets + meshing).
//        Sanity-check the parallel-transport frame headlessly: build a
//        straight spine + verify N · T = 0 / B = T × N for every sample.
//   01 — Open the panel via the `tools.variableSectionSweep` menu action.
//        Assert every canonical test-id mounts (spine / profile / guide /
//        samples / build / close).
//   02 — Straight spine + circle profile + no guides. Build. Assert:
//          - swept tube is a cylinder (every section has identical radius)
//          - guide-touch error == 0 (no guides → no constraint to violate)
//          - vertex / triangle count match the (Ns × Np) × 2(Ns-1)·Np grid
//   03 — Straight spine + circle profile + 1 tapered guide. Build. Assert:
//          - profile morphs (radii at the constrained spoke shrink along Z)
//          - max guide-touch error < 1e-4
//          - the section at t=0.5 has the expected radius at the guide spoke
//   04 — Straight spine + 2 opposite guides. Build. Assert:
//          - both guides are touched (every per-guide max error < 1e-4)
//          - guide count = 2
//   05 — Close + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (cylinder build + zero-error assertion)
//   - right (1-guide tapered)
//   - iso   (2-guide opposite + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000); // 10 min — well above the headless math budget
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-209-variable-section-sweep');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'variable-section-sweep-session.mp4');

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
        const r = await page.evaluate(() => window.__forgeVariableSectionSweepLast || null);
        if (r) return r;
        await pause(150);
    }
    return null;
}

// Trigger Build after wiping the previous mirror.
async function clickBuild() {
    await page.evaluate(() => {
        try { delete window.__forgeVariableSectionSweepLast; } catch {}
    });
    await page.locator('[data-testid="forge-varsweep-build"]').click();
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
        if (/push-209|varsweep|variable.section|sweep|forge|error|Error/i.test(t)) {
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
        console.error('[push-209] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    let ffmpegBin = null;
    try { ffmpegBin = require('ffmpeg-static'); } catch {}
    if (!ffmpegBin) {
        console.warn('[push-209] ffmpeg-static missing; leaving .webm in place');
        return;
    }
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-209] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-209] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert helper surface + parallel-transport frame smoke', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenVariableSectionSweep,
        close:   typeof window.__forgeCloseVariableSectionSweep,
        helper:  typeof window.__forgeVariableSectionSweepHelper,
        helperKeys: window.__forgeVariableSectionSweepHelper
            ? Object.keys(window.__forgeVariableSectionSweepHelper).sort()
            : [],
        eventName:   window.__forgeVariableSectionSweepHelper?.EVENT_NAME,
        minSamples:  window.__forgeVariableSectionSweepHelper?.MIN_SAMPLES,
        maxSamples:  window.__forgeVariableSectionSweepHelper?.MAX_SAMPLES,
        defaultSamples: window.__forgeVariableSectionSweepHelper?.DEFAULT_SAMPLES,
        maxGuides:   window.__forgeVariableSectionSweepHelper?.MAX_GUIDES,
        tol:         window.__forgeVariableSectionSweepHelper?.GUIDE_TOUCH_TOL,
    }));
    console.log('[push-209] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('buildVariableSectionSweep');
    expect(surface.helperKeys).toContain('validateInputs');
    expect(surface.helperKeys).toContain('buildSpineFrames');
    expect(surface.helperKeys).toContain('morphProfile');
    expect(surface.helperKeys).toContain('projectGuide');
    expect(surface.helperKeys).toContain('tessellateSweep');
    expect(surface.helperKeys).toContain('normaliseProfile');
    expect(surface.helperKeys).toContain('evalProfileXYAtAngle');
    expect(surface.helperKeys).toContain('evalCurve');
    expect(surface.helperKeys).toContain('evalCurveTangent');
    expect(surface.helperKeys).toContain('buildStraightSpine');
    expect(surface.helperKeys).toContain('buildArcSpine');
    expect(surface.helperKeys).toContain('buildCircleProfile');
    expect(surface.helperKeys).toContain('buildTaperGuide');
    expect(surface.helperKeys).toContain('buildOppositeTaperGuide');
    expect(surface.helperKeys).toContain('angularDistance');
    expect(surface.helperKeys).toContain('buildSweepMesh');
    expect(surface.eventName).toBe('forge:variable-section-sweep-built');
    expect(surface.minSamples).toBe(2);
    expect(surface.maxSamples).toBeGreaterThanOrEqual(60);
    expect(surface.defaultSamples).toBeGreaterThan(0);
    expect(surface.maxGuides).toBe(4);
    expect(surface.tol).toBeGreaterThan(0);

    // Headless parallel-transport sanity. Build frames for a straight +Z
    // spine: every sample should give T = (0,0,1), N and B perpendicular to
    // T, and the frame should be RIGHT-HANDED (B = T × N).
    const ptSmoke = await page.evaluate(() => {
        const h = window.__forgeVariableSectionSweepHelper;
        const spine = h.buildStraightSpine({ height: 100 });
        const frames = h.buildSpineFrames({ spine, nSamples: 8 });
        const report = frames.map((f) => {
            const dotTN = f.T[0]*f.N[0] + f.T[1]*f.N[1] + f.T[2]*f.N[2];
            const dotTB = f.T[0]*f.B[0] + f.T[1]*f.B[1] + f.T[2]*f.B[2];
            const dotNB = f.N[0]*f.B[0] + f.N[1]*f.B[1] + f.N[2]*f.B[2];
            // B should equal T × N.
            const cross = [
                f.T[1]*f.N[2] - f.T[2]*f.N[1],
                f.T[2]*f.N[0] - f.T[0]*f.N[2],
                f.T[0]*f.N[1] - f.T[1]*f.N[0],
            ];
            const crossErr = Math.hypot(
                cross[0] - f.B[0], cross[1] - f.B[1], cross[2] - f.B[2]);
            return {
                t: f.t,
                T: f.T,
                lenN: Math.hypot(f.N[0], f.N[1], f.N[2]),
                lenB: Math.hypot(f.B[0], f.B[1], f.B[2]),
                dotTN, dotTB, dotNB, crossErr,
            };
        });
        return { frames: report, count: frames.length };
    });
    console.log('[push-209] parallel-transport frames =', JSON.stringify(ptSmoke.frames.slice(0, 3)));
    expect(ptSmoke.count).toBe(8);
    for (const f of ptSmoke.frames) {
        // T should be +Z for the straight spine.
        expect(Math.abs(f.T[2])).toBeCloseTo(1, 6);
        expect(Math.abs(f.T[0])).toBeLessThan(1e-6);
        expect(Math.abs(f.T[1])).toBeLessThan(1e-6);
        // Orthonormal.
        expect(f.lenN).toBeCloseTo(1, 6);
        expect(f.lenB).toBeCloseTo(1, 6);
        expect(Math.abs(f.dotTN)).toBeLessThan(1e-6);
        expect(Math.abs(f.dotTB)).toBeLessThan(1e-6);
        expect(Math.abs(f.dotNB)).toBeLessThan(1e-6);
        // Right-handed.
        expect(f.crossErr).toBeLessThan(1e-6);
    }

    // Profile normaliser smoke: a circle of radius R should produce N polar
    // samples each with radius R at evenly-spaced θ in [0, 2π).
    const profSmoke = await page.evaluate(() => {
        const h = window.__forgeVariableSectionSweepHelper;
        const prof = h.normaliseProfile({ type: 'circle', radius: 7 }, 16);
        return {
            len: prof.length,
            radii: prof.map((s) => s.radius),
            firstTheta: prof[0].theta,
            lastTheta: prof[prof.length - 1].theta,
        };
    });
    console.log('[push-209] profile =', JSON.stringify(profSmoke));
    expect(profSmoke.len).toBe(16);
    expect(profSmoke.firstTheta).toBeCloseTo(0, 6);
    expect(profSmoke.lastTheta).toBeCloseTo(15 * Math.PI * 2 / 16, 6);
    for (const r of profSmoke.radii) {
        expect(r).toBeCloseTo(7, 6);
    }

    await shot('host-surface-ok');
});

test('01 — open panel via tools.variableSectionSweep', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.variableSectionSweep');
    await page.waitForSelector('[data-testid="forge-varsweep-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All canonical control test-ids are present.
    await expect(page.locator('[data-testid="forge-varsweep-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-spine-straight"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-spine-arcXZ"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-profile-circle"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-profile-square"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-circle-radius"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-guide-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-add-tapered"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-add-opposite"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-clear-guides"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-samples-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-samples-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-profile-pts-slider"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-profile-pts-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-build"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-close"]')).toBeVisible();

    // Default state — straight spine, circle profile, no guides.
    const panel = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="forge-varsweep-panel"]');
        return {
            spine:        el?.dataset.spine,
            profile:      el?.dataset.profile,
            nSamples:     el?.dataset.nSamples,
            nProfilePts:  el?.dataset.nProfilePts,
            nGuides:      el?.dataset.nGuides,
            inputOk:      el?.dataset.inputOk,
        };
    });
    console.log('[push-209] panel defaults =', JSON.stringify(panel));
    expect(panel.spine).toBe('straight');
    expect(panel.profile).toBe('circle');
    expect(Number(panel.nGuides)).toBe(0);
    expect(panel.inputOk).toBe('1');
});

test('02 — straight + circle, no guides → cylinder, touch error == 0', async () => {
    await cameraTo('top');
    // Defaults already set — just build.
    // Drop n samples / profile pts to something small-but-believable for
    // a quick test (still tens of triangles).
    await page.locator('[data-testid="forge-varsweep-samples-input"]').fill('20');
    await pause(150);
    await page.locator('[data-testid="forge-varsweep-profile-pts-input"]').fill('24');
    await pause(150);

    await shot('cylinder-configured');
    await clickBuild();
    const r = await waitForLastResult(60000);
    expect(r).not.toBeNull();
    console.log('[push-209] cylinder result =', JSON.stringify({
        ok: r.ok,
        nSamples: r.nSamples,
        nProfilePts: r.nProfilePts,
        nGuides: r.nGuides,
        vertices: r.vertexCount,
        triangles: r.triangleCount,
        touchMax: r.guideTouchErrorMax,
        pass: r.pass,
    }));
    expect(r.ok).toBe(true);
    expect(r.nSamples).toBe(20);
    expect(r.nProfilePts).toBe(24);
    expect(r.nGuides).toBe(0);
    expect(r.vertexCount).toBe(20 * 24);
    expect(r.triangleCount).toBe(2 * (20 - 1) * 24);
    // No guides → no constraint to violate → error is exactly 0.
    expect(r.guideTouchErrorMax).toBe(0);
    expect(r.pass).toBe(true);

    // Headless: verify every section of the swept tube has identical radius
    // (i.e. it really is a cylinder). Reconstruct profile from positions.
    const cylSmoke = await page.evaluate(() => {
        const h = window.__forgeVariableSectionSweepHelper;
        const spine = h.buildStraightSpine({ height: 100 });
        const profile = h.buildCircleProfile({ radius: 20 });
        const r = h.buildVariableSectionSweep({
            spine, profile, guides: [], nSamples: 20, nProfilePts: 24,
        });
        if (!r.ok) return { ok: false, reason: r.reason };
        // For each sample, measure every spoke's distance from the spine.
        const Ns = r.stats.nSamples;
        const Np = r.stats.nProfilePts;
        const pos = r.positions;
        let minR = Infinity, maxR = 0;
        for (let i = 0; i < Ns; i++) {
            for (let k = 0; k < Np; k++) {
                const off = (i * Np + k) * 3;
                // Spine at this sample is (0, 0, t · 100).
                const t = i / (Ns - 1);
                const dx = pos[off]     - 0;
                const dy = pos[off + 1] - 0;
                const dz = pos[off + 2] - t * 100;
                // Radial in XY plane (T is +Z).
                const radial = Math.hypot(dx, dy);
                // The axial dz should be ~0.
                if (Math.abs(dz) > 1e-3) {
                    return { ok: false, reason: `axial dz=${dz} at i=${i} k=${k}` };
                }
                if (radial < minR) minR = radial;
                if (radial > maxR) maxR = radial;
            }
        }
        return { ok: true, minR, maxR, span: maxR - minR };
    });
    console.log('[push-209] cyl radii =', JSON.stringify(cylSmoke));
    expect(cylSmoke.ok).toBe(true);
    expect(cylSmoke.minR).toBeCloseTo(20, 4);
    expect(cylSmoke.maxR).toBeCloseTo(20, 4);
    expect(cylSmoke.span).toBeLessThan(1e-4);

    await shot('cylinder-built');
});

test('03 — straight + circle + 1 tapered guide → touch error < 1e-4', async () => {
    await cameraTo('right');
    // Add a single tapered guide.
    await page.locator('[data-testid="forge-varsweep-add-tapered"]').click();
    await pause(200);
    // Configure to 30 samples, 32 spokes for a more refined morph.
    await page.locator('[data-testid="forge-varsweep-samples-input"]').fill('30');
    await pause(100);
    await page.locator('[data-testid="forge-varsweep-profile-pts-input"]').fill('32');
    await pause(150);

    await shot('1guide-configured');
    await clickBuild();
    const r = await waitForLastResult(60000);
    expect(r).not.toBeNull();
    console.log('[push-209] 1-guide result =', JSON.stringify({
        ok: r.ok,
        nGuides: r.nGuides,
        nSamples: r.nSamples,
        touchMax: r.guideTouchErrorMax,
        pass: r.pass,
        perGuideMax: r.guideStats.map((g) => g.maxError),
    }));
    expect(r.ok).toBe(true);
    expect(r.nGuides).toBe(1);
    expect(r.nSamples).toBe(30);
    expect(r.nProfilePts).toBe(32);
    // The single tapered guide must be touched at every sample within tol.
    expect(r.guideTouchErrorMax).toBeLessThan(1e-4);
    expect(r.pass).toBe(true);

    // Per-guide chip renders.
    await expect(page.locator('[data-testid="forge-varsweep-guide-errs"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-guide-err-0"]')).toBeVisible();
    // Touch-max chip renders.
    await expect(page.locator('[data-testid="forge-varsweep-chip-touch-max"]')).toBeVisible();
    // Guide list shows 1 guide.
    await expect(page.locator('[data-testid="forge-varsweep-guide-0"]')).toBeVisible();

    // Headless verification: the section at t=0.5 should have its constrained
    // spoke at the midway radius (12.5 ≈ (20+5)/2). The spoke radius near
    // the guide angle should NOT equal the un-constrained 20 — proving the
    // morph happened.
    const morphSmoke = await page.evaluate(() => {
        const h = window.__forgeVariableSectionSweepHelper;
        const spine = h.buildStraightSpine({ height: 100 });
        const profile = h.buildCircleProfile({ radius: 20 });
        const guides = [h.buildTaperGuide({
            spineHeight: 100, baseRadius: 20, tipRadius: 5,
        })];
        const r = h.buildVariableSectionSweep({
            spine, profile, guides, nSamples: 30, nProfilePts: 32,
        });
        if (!r.ok) return { ok: false, reason: r.reason };
        // Find the morphed radius at the guide angle for the t=0.5 section.
        // Sample index = 15 (mid of 30).
        const midIdx = 15;
        const profMid = r.morphedProfiles[midIdx];
        // Guide-projected angle at this sample.
        const frame = r.frames[midIdx];
        const guidePoint = h.evalCurve(guides[0].curve, 0.5);
        // Decompose into local (N, B) plane.
        const dx = guidePoint[0] - frame.P[0];
        const dy = guidePoint[1] - frame.P[1];
        const dz = guidePoint[2] - frame.P[2];
        const gx = dx * frame.N[0] + dy * frame.N[1] + dz * frame.N[2];
        const gy = dx * frame.B[0] + dy * frame.B[1] + dz * frame.B[2];
        let gAngle = Math.atan2(gy, gx);
        if (gAngle < 0) gAngle += Math.PI * 2;
        const gRadius = Math.hypot(gx, gy);
        // Morphed profile at gAngle.
        const morphedAtGuide = h.evalProfileXYAtAngle(profMid, gAngle).radius;
        // Spoke at the opposite angle should still be ~20 (no constraint).
        const oppositeAngle = (gAngle + Math.PI) % (Math.PI * 2);
        const morphedAtOpposite = h.evalProfileXYAtAngle(profMid, oppositeAngle).radius;
        return {
            ok: true,
            gAngle, gRadius,
            morphedAtGuide,
            morphedAtOpposite,
            errAtGuide: Math.abs(morphedAtGuide - gRadius),
        };
    });
    console.log('[push-209] morph smoke =', JSON.stringify(morphSmoke));
    expect(morphSmoke.ok).toBe(true);
    // At the guide's projected angle, the morphed radius equals the guide's
    // radial reach (12.5 at t=0.5 since the taper is linear 20→5).
    expect(morphSmoke.gRadius).toBeCloseTo(12.5, 4);
    expect(morphSmoke.morphedAtGuide).toBeCloseTo(morphSmoke.gRadius, 5);
    expect(morphSmoke.errAtGuide).toBeLessThan(1e-4);
    // The opposite spoke is far from the guide, so its scale lerps back
    // toward 1.0 — i.e. radius back toward 20. Should NOT equal gRadius.
    expect(morphSmoke.morphedAtOpposite).toBeGreaterThan(morphSmoke.gRadius + 1);

    await shot('1guide-built');
});

test('04 — straight + circle + 2 opposite guides → both touched', async () => {
    await cameraTo('iso');
    // Add a second guide (opposite tapered). The first guide from step 03
    // is still in the panel state.
    await page.locator('[data-testid="forge-varsweep-add-opposite"]').click();
    await pause(200);
    // Configure to 40 samples, 48 spokes for tighter touching.
    await page.locator('[data-testid="forge-varsweep-samples-input"]').fill('40');
    await pause(100);
    await page.locator('[data-testid="forge-varsweep-profile-pts-input"]').fill('48');
    await pause(150);

    await shot('2guides-configured');
    await clickBuild();
    const r = await waitForLastResult(60000);
    expect(r).not.toBeNull();
    console.log('[push-209] 2-guide result =', JSON.stringify({
        ok: r.ok,
        nGuides: r.nGuides,
        nSamples: r.nSamples,
        touchMax: r.guideTouchErrorMax,
        pass: r.pass,
        perGuideMax: r.guideStats.map((g) => g.maxError),
    }));
    expect(r.ok).toBe(true);
    expect(r.nGuides).toBe(2);
    expect(r.nSamples).toBe(40);
    // BOTH guides must be touched within tol.
    expect(r.guideStats.length).toBe(2);
    for (const gs of r.guideStats) {
        expect(gs.maxError).toBeLessThan(1e-4);
    }
    expect(r.guideTouchErrorMax).toBeLessThan(1e-4);
    expect(r.pass).toBe(true);

    // Guide list shows 2 guides.
    await expect(page.locator('[data-testid="forge-varsweep-guide-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-guide-1"]')).toBeVisible();
    // Per-guide chip rows for both.
    await expect(page.locator('[data-testid="forge-varsweep-guide-err-0"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-varsweep-guide-err-1"]')).toBeVisible();

    // Headless: drive the build with 2 opposite guides directly, verify
    // every sample touches BOTH guides.
    const twoGuidesSmoke = await page.evaluate(() => {
        const h = window.__forgeVariableSectionSweepHelper;
        const spine = h.buildStraightSpine({ height: 100 });
        const profile = h.buildCircleProfile({ radius: 20 });
        const guides = [
            h.buildTaperGuide({ spineHeight: 100, baseRadius: 20, tipRadius: 5 }),
            h.buildOppositeTaperGuide({ spineHeight: 100, baseRadius: 20, tipRadius: 5 }),
        ];
        const r = h.buildVariableSectionSweep({
            spine, profile, guides, nSamples: 40, nProfilePts: 48,
        });
        if (!r.ok) return { ok: false, reason: r.reason };
        return {
            ok: true,
            guideErrs: r.stats.guideStats.map((gs) => gs.maxError),
            touchMax: r.stats.guideTouchErrorMax,
            triangleCount: r.triangleCount,
        };
    });
    console.log('[push-209] 2-guide headless =', JSON.stringify(twoGuidesSmoke));
    expect(twoGuidesSmoke.ok).toBe(true);
    expect(twoGuidesSmoke.guideErrs.length).toBe(2);
    for (const e of twoGuidesSmoke.guideErrs) {
        expect(e).toBeLessThan(1e-4);
    }
    expect(twoGuidesSmoke.touchMax).toBeLessThan(1e-4);
    expect(twoGuidesSmoke.triangleCount).toBe(2 * (40 - 1) * 48);

    await shot('2guides-built');
});

test('05 — close panel + final shot', async () => {
    await page.locator('[data-testid="forge-varsweep-close"]').click().catch(() => {});
    await pause(300);
    const visible = await page.locator('[data-testid="forge-varsweep-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
