// PUSH-132 (Slice-97) — Helical Sweep panel.
//
// Generic helical sweep tool: build a 3D helix polyline in pure JS
// (x=R cos t, y=R sin t, z=pitch·t/2π), feed the flat XYZ Float64Array
// to forge.part.pipeFromPolyline (the same OCCT BRepOffsetAPI_MakePipe
// primitive PUSH-45 piperoute / PUSH-122 sweepCurve use), commit a
// watertight solid spring / screw thread / auger body to the live scene.
//
// Proof end-to-end through the real Electron UI:
//
//   00 — Boot. Assert window.__forgeHelicalSweepHelper is fully installed
//        BEFORE any panel is opened (the helper-API contract for plugins
//        + Archie tool calls). Drive the headless pipeline with the
//        defaults (10-turn spring R=15 pitch=5 wire r=1.5) — must commit
//        a native body with mass + volume > 0. Assert axial length
//        ≈ N·pitch = 10·5 = 50 mm. iso view.
//   01 — Open the Helical Sweep panel via the tools.helicalSweep menu
//        action. Assert the panel mounts, the four numeric defaults are
//        present, derived turns = 10.0, Apply button enabled. front view.
//   02 — Click Apply with the defaults. Native body count increments;
//        committed solid has volume > 0 and within the expected envelope
//        (π·r²·arcLen ± mitre allowance, since the polyline approximates
//        the smooth helix). The forge:helical-sweep-built bus event
//        fires with the correct payload (turns=10, length=50). top view.
//   03 — Modify the inputs (pitch 5 → 2.5 mm so turns = 20 over the
//        same 50 mm length) and Apply again. A fresh, distinct OCCT
//        handle lands; arc length is longer (twice as many coils) so
//        volume increases. right view.
//   04 — Helper-API regression: drive a single-turn screw-thread
//        configuration headlessly (R=5, pitch=2, length=2, r=0.4) and
//        assert it still commits a positive-volume body. Proves the
//        same panel handles spring + thread cases. iso view (close).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless 10-turn spring build)
//   - front (open panel + assertions)
//   - top   (default Apply)
//   - right (modified Apply)
//   - iso   (single-turn thread regression + final shot — labelled close)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-132-helical-sweep');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'helical-sweep-session.mp4');

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

async function nativeBodyCount() {
    return await page.evaluate(() => (window.__forgeBodies || []).filter(
        (b) => b && b.kind === 'native').length);
}
async function lastNativeBodyMass() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length || !window.forge?.massProps) return null;
        const h = bodies[bodies.length - 1].handle;
        try { return window.forge.massProps(h); }
        catch { return null; }
    });
}
async function lastNativeBodyHandle() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length) return null;
        return bodies[bodies.length - 1].handle;
    });
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
        if (/push-132|helical-sweep|HelicalSweep|forge:helical-sweep|pipeFromPolyline|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss any first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});

    // Forge-189 onboarding tour blocks button clicks if active. Flip the
    // seen flag + dismiss any visible tour.
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
    await pause(800);
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
        console.error('[push-132] no .webm'); return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
                console.log(`[push-132] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-132] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + helper API mounted + 10-turn spring headless build (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the helper API to be installed (it's installed at module
    // import time when HelicalSweepPanel.jsx is loaded by App.jsx).
    await page.waitForFunction(
        () => !!window.__forgeHelicalSweepHelper
           && typeof window.__forgeHelicalSweepHelper.runHelicalSweepPipeline === 'function'
           && typeof window.__forgeHelicalSweepHelper.buildHelixPolyline === 'function'
           && typeof window.__forgeHelicalSweepHelper.flattenPolyline === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeHelicalSweepHelper;
        return {
            keys: Object.keys(h).sort(),
            event: h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            defaultR:       h.DEFAULT_PCD_RADIUS_MM,
            defaultPitch:   h.DEFAULT_PITCH_MM,
            defaultLength:  h.DEFAULT_LENGTH_MM,
            defaultProfile: h.DEFAULT_PROFILE_RADIUS_MM,
            segsPerTurn:    h.SEGMENTS_PER_TURN,
            minPoints:      h.MIN_POINTS,
        };
    });
    expect(helperShape.event).toBe('forge:helical-sweep-built');
    expect(helperShape.storage).toBe('forge.v4.helicalSweep');
    expect(helperShape.defaultR).toBe(15);
    expect(helperShape.defaultPitch).toBe(5);
    expect(helperShape.defaultLength).toBe(50);
    expect(helperShape.defaultProfile).toBe(1.5);
    expect(helperShape.segsPerTurn).toBeGreaterThanOrEqual(8);
    expect(helperShape.minPoints).toBe(2);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'sanitisePcdRadius', 'sanitisePitch', 'sanitiseLength', 'sanitiseProfileRadius',
        'buildHelixPolyline', 'flattenPolyline', 'polylineLength', 'turnCount',
        'runHelicalSweepPipeline',
        'DEFAULT_PCD_RADIUS_MM', 'DEFAULT_PITCH_MM', 'DEFAULT_LENGTH_MM',
        'DEFAULT_PROFILE_RADIUS_MM', 'SEGMENTS_PER_TURN', 'MAX_SEGMENTS',
        'MIN_POINTS', 'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Helix math is real: build a 1-turn helix with R=10 pitch=2; check
    // first + last point land exactly on (10,0,0) and (10,0,2), and the
    // sampled arc length matches the analytic value to within 0.5 %.
    const mathCheck = await page.evaluate(() => {
        const h = window.__forgeHelicalSweepHelper;
        const pts = h.buildHelixPolyline({ R: 10, pitch: 2, length: 2 });
        const arc = h.polylineLength(pts);
        const flat = h.flattenPolyline(pts);
        const turns = h.turnCount(2, 2);
        const rClamp = h.sanitisePcdRadius(10000);
        const rNaN   = h.sanitisePcdRadius('xyz');
        return {
            n: pts.length,
            first: pts[0],
            last:  pts[pts.length - 1],
            arc,
            flatLen: flat.length,
            // Analytic helix arc length for one turn:
            //   sqrt((2π·R)² + pitch²) = sqrt((2π·10)² + 4) ≈ 62.864 mm
            analytic: Math.sqrt((2*Math.PI*10)*(2*Math.PI*10) + 2*2),
            turns,
            rClampOk: rClamp === 1000,        // clamped to MAX_PCD_RADIUS_MM
            rNaNOk:   Number.isNaN(rNaN),
        };
    });
    expect(mathCheck.first.x).toBeCloseTo(10, 5);
    expect(mathCheck.first.y).toBeCloseTo(0, 5);
    expect(mathCheck.first.z).toBeCloseTo(0, 5);
    expect(mathCheck.last.x).toBeCloseTo(10, 5);
    expect(mathCheck.last.y).toBeCloseTo(0, 5);
    expect(mathCheck.last.z).toBeCloseTo(2, 5);
    expect(mathCheck.flatLen).toBe(mathCheck.n * 3);
    // Polyline approximation underestimates the true arc length but only
    // by ~0.07 % at 48 segments/turn. Allow ±1 % slack.
    expect(mathCheck.arc).toBeGreaterThan(mathCheck.analytic * 0.99);
    expect(mathCheck.arc).toBeLessThanOrEqual(mathCheck.analytic * 1.001);
    expect(mathCheck.turns).toBeCloseTo(1, 6);
    expect(mathCheck.rClampOk).toBe(true);
    expect(mathCheck.rNaNOk).toBe(true);

    // Pipe must be present on the bridge — that's the whole contract.
    const bridge = await page.evaluate(() => ({
        hasForge:        !!window.forge,
        hasPart:         !!window.forge?.part,
        hasPipePolyline: typeof window.forge?.part?.pipeFromPolyline === 'function',
        hasMassProps:    typeof window.forge?.massProps === 'function',
        hasAppendBody:   typeof window.__forgeAppendBody === 'function',
    }));
    expect(bridge.hasForge).toBe(true);
    expect(bridge.hasPart).toBe(true);
    expect(bridge.hasPipePolyline).toBe(true);
    expect(bridge.hasMassProps).toBe(true);
    expect(bridge.hasAppendBody).toBe(true);

    // Drive the pipeline headlessly with the 10-turn spring defaults
    // (R=15 pitch=5 length=50 → turns=10, wire r=1.5). Must commit a
    // native body with volume > 0 and arc length ≈ analytic value.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeHelicalSweepHelper.runHelicalSweepPipeline();
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            handle: r.handle, bodyId: r.body?.id,
            sanitised: r.sanitised,
            turns: r.turns,
            length: r.length, axialLength: r.axialLength,
            volume: r.volume, pointCount: r.points?.length,
        };
    });
    console.log('[push-132] headless build =', JSON.stringify(piped));
    expect(piped.ok).toBe(true);
    expect(piped.handle).toBeGreaterThan(0);
    expect(piped.sanitised.R).toBeCloseTo(15, 5);
    expect(piped.sanitised.pitch).toBeCloseTo(5, 5);
    expect(piped.sanitised.length).toBeCloseTo(50, 5);
    expect(piped.sanitised.r).toBeCloseTo(1.5, 5);
    expect(piped.turns).toBeCloseTo(10, 6);
    // The slice's headline assertion: total axial length ≈ N·pitch.
    expect(piped.axialLength).toBeCloseTo(10 * 5, 3);
    expect(piped.axialLength).toBeCloseTo(piped.turns * piped.sanitised.pitch, 3);
    // The 3D arc length is ≈ N·√((2πR)² + pitch²) for a helix.
    const analyticArc = 10 * Math.sqrt((2*Math.PI*15)*(2*Math.PI*15) + 5*5);
    expect(piped.length).toBeGreaterThan(analyticArc * 0.99);
    expect(piped.length).toBeLessThanOrEqual(analyticArc * 1.001);
    expect(piped.volume).toBeGreaterThan(0);
    expect(piped.bodyId).toBeTruthy();
    expect(piped.pointCount).toBeGreaterThan(10 * 8); // > 80 pts for 10 turns

    const post = await nativeBodyCount();
    expect(post).toBe(pre + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(Math.abs(mass.volume)).toBeGreaterThan(0);
    // Naive cylinder upper bound: π·r²·arcLen. The polyline sweep mitres
    // at every segment so volume sits below this.
    const naive = Math.PI * 1.5 * 1.5 * analyticArc;
    expect(Math.abs(mass.volume)).toBeLessThan(naive * 1.05);

    // window.__forgeHelicalSweep mirror exists with the same handle.
    const mirror = await page.evaluate(() => window.__forgeHelicalSweep || null);
    expect(mirror).not.toBeNull();
    expect(mirror.handle).toBe(piped.handle);
    expect(mirror.R).toBeCloseTo(15, 5);
    expect(mirror.pitch).toBeCloseTo(5, 5);
    expect(mirror.turns).toBeCloseTo(10, 6);
    expect(mirror.axialLength).toBeCloseTo(50, 3);

    await shot('headless-build');
});

test('01 — open Helical Sweep via tools.helicalSweep; defaults mount (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.helicalSweep');
    await page.waitForSelector('[data-testid="forge-helical-sweep-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // All four numeric defaults present.
    const Rval = await page.locator('[data-testid="forge-helical-sweep-pcd"]').inputValue();
    const pVal = await page.locator('[data-testid="forge-helical-sweep-pitch"]').inputValue();
    const Lval = await page.locator('[data-testid="forge-helical-sweep-length"]').inputValue();
    const rVal = await page.locator('[data-testid="forge-helical-sweep-profile"]').inputValue();
    expect(Number(Rval)).toBeCloseTo(15, 5);
    expect(Number(pVal)).toBeCloseTo(5, 5);
    expect(Number(Lval)).toBeCloseTo(50, 5);
    expect(Number(rVal)).toBeCloseTo(1.5, 5);

    // Panel data attributes mirror the sanitised numbers.
    const panel = page.locator('[data-testid="forge-helical-sweep-panel"]');
    expect(Number(await panel.getAttribute('data-pcd-radius'))).toBeCloseTo(15, 5);
    expect(Number(await panel.getAttribute('data-pitch'))).toBeCloseTo(5, 5);
    expect(Number(await panel.getAttribute('data-length'))).toBeCloseTo(50, 5);
    expect(Number(await panel.getAttribute('data-profile-radius'))).toBeCloseTo(1.5, 5);
    expect(Number(await panel.getAttribute('data-turns'))).toBeCloseTo(10, 6);
    const pointCount = Number(await panel.getAttribute('data-point-count'));
    expect(pointCount).toBeGreaterThan(10 * 8); // > 80 pts for 10 turns

    // Turns summary mentions "10" turns.
    const turnsTxt = await page.locator('[data-testid="forge-helical-sweep-turns"]').innerText();
    expect(turnsTxt).toMatch(/10\.000/);

    // Apply button is present + enabled.
    await expect(page.locator('[data-testid="forge-helical-sweep-apply"]')).toBeVisible();
    const disabled = await page.locator('[data-testid="forge-helical-sweep-apply"]')
                                .getAttribute('disabled');
    expect(disabled).toBeNull();
});

test('02 — click Apply with defaults; spring commits + bus event fires (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event fired.
    await page.evaluate(() => {
        window.__push132Events = [];
        window.addEventListener('forge:helical-sweep-built', (e) => {
            window.__push132Events.push({
                handle:       e?.detail?.handle,
                R:            e?.detail?.R,
                pitch:        e?.detail?.pitch,
                length:       e?.detail?.length,
                profileR:     e?.detail?.profileRadius,
                turns:        e?.detail?.turns,
                arcLength:    e?.detail?.arcLength,
                axialLength:  e?.detail?.axialLength,
                volume:       e?.detail?.volume,
                pointCount:   e?.detail?.pointCount,
                bodyId:       e?.detail?.bodyId,
                ts:           e?.detail?.ts,
            });
        });
    });

    const preCount = await nativeBodyCount();
    // DOM-level click avoids racing with overlays on the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-helical-sweep-apply"]');
        if (!btn) throw new Error('apply button missing');
        btn.click();
    });
    await pause(900);
    await shot('default-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    const vol = Math.abs(mass.volume);
    console.log('[push-132] default-apply volume =', vol);
    expect(vol).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push132Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.handle).toBeGreaterThan(0);
    expect(newest.R).toBeCloseTo(15, 5);
    expect(newest.pitch).toBeCloseTo(5, 5);
    expect(newest.length).toBeCloseTo(50, 5);
    expect(newest.profileR).toBeCloseTo(1.5, 5);
    expect(newest.turns).toBeCloseTo(10, 6);
    // The slice's headline assertion (sliced into the bus payload): the
    // axial length equals N·pitch ≈ 50 mm for the 10-turn spring.
    expect(newest.axialLength).toBeCloseTo(50, 3);
    expect(newest.axialLength).toBeCloseTo(newest.turns * newest.pitch, 3);
    expect(newest.volume).toBeGreaterThan(0);

    // Log row count increments.
    const logCount = await page.locator('[data-testid="forge-helical-sweep-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);

    // The committed body's last-handle data attribute is set.
    const lastHandle = await page.locator('[data-testid="forge-helical-sweep-panel"]')
                                  .getAttribute('data-last-handle');
    expect(Number(lastHandle)).toBe(newest.handle);
});

test('03 — bump pitch (5 → 2.5) so turns doubles to 20; Apply again (right)', async () => {
    await cameraTo('right');

    // Pitch 5 → 2.5 → turns = 50 / 2.5 = 20 (twice as many coils
    // over the same 50 mm axial extent).
    await page.locator('[data-testid="forge-helical-sweep-pitch"]').fill('2.5');
    await pause(200);
    await shot('inputs-modified');

    // Panel attrs reflect the new turns count.
    const panel = page.locator('[data-testid="forge-helical-sweep-panel"]');
    expect(Number(await panel.getAttribute('data-pitch'))).toBeCloseTo(2.5, 5);
    expect(Number(await panel.getAttribute('data-turns'))).toBeCloseTo(20, 6);

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-helical-sweep-apply"]');
        btn.click();
    });
    await pause(900);
    await shot('modified-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    const vol = Math.abs(mass.volume);
    console.log('[push-132] modified-apply volume =', vol);
    expect(vol).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push132Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.pitch).toBeCloseTo(2.5, 5);
    expect(last.turns).toBeCloseTo(20, 6);
    // Same headline assertion holds: axial length = N·pitch = 20·2.5 = 50.
    expect(last.axialLength).toBeCloseTo(50, 3);
    expect(last.axialLength).toBeCloseTo(last.turns * last.pitch, 3);
    expect(last.handle).toBeGreaterThan(0);

    // Two builds should yield distinct OCCT handles.
    const handles = new Set(events.map((e) => e.handle));
    expect(handles.size).toBeGreaterThanOrEqual(2);

    // Doubling the turn count over the same axial extent means the helix
    // arc is almost twice as long — volume should be > the first build.
    const first = events[0];
    expect(last.arcLength).toBeGreaterThan(first.arcLength * 1.5);
    expect(last.volume).toBeGreaterThan(first.volume);
});

test('04 — single-turn screw-thread regression (R=5 pitch=2 L=2 r=0.4) (iso/close)', async () => {
    await cameraTo('iso');

    // Close the Helical Sweep panel so its right-docked footprint doesn't
    // intercept any subsequent clicks. (No follow-on panel here, but
    // matches the convention used by PUSH-122.)
    await page.evaluate(() => {
        if (typeof window.__forgeCloseHelicalSweep === 'function') {
            window.__forgeCloseHelicalSweep();
        }
    });
    await pause(250);

    const preCount = await nativeBodyCount();
    const preLastHandle = await lastNativeBodyHandle();

    // Run the headless pipeline with a screw-thread configuration: a
    // single-turn thread, PCD radius 5 mm, pitch 2 mm/turn, length 2 mm
    // (so turns = 1), thread half-section radius 0.4 mm. This is a
    // micro-screw-style thread — proves the same panel handles both
    // spring + thread regimes without parameter-specific code paths.
    const piped = await page.evaluate(() => {
        const r = window.__forgeHelicalSweepHelper.runHelicalSweepPipeline({
            R: 5, pitch: 2, length: 2, profileRadius: 0.4,
        });
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            handle: r.handle,
            sanitised: r.sanitised,
            turns: r.turns,
            length: r.length, axialLength: r.axialLength,
            volume: r.volume, pointCount: r.points?.length,
        };
    });
    console.log('[push-132] thread headless build =', JSON.stringify(piped));
    expect(piped.ok).toBe(true);
    expect(piped.handle).toBeGreaterThan(0);
    expect(piped.sanitised.R).toBeCloseTo(5, 5);
    expect(piped.sanitised.pitch).toBeCloseTo(2, 5);
    expect(piped.sanitised.length).toBeCloseTo(2, 5);
    expect(piped.sanitised.r).toBeCloseTo(0.4, 5);
    expect(piped.turns).toBeCloseTo(1, 6);
    expect(piped.axialLength).toBeCloseTo(piped.turns * piped.sanitised.pitch, 3);
    expect(piped.volume).toBeGreaterThan(0);
    // Single-turn analytic arc: √((2π·5)² + 2²) ≈ 31.479 mm.
    const analyticArc = Math.sqrt((2*Math.PI*5)*(2*Math.PI*5) + 2*2);
    expect(piped.length).toBeGreaterThan(analyticArc * 0.99);
    expect(piped.length).toBeLessThanOrEqual(analyticArc * 1.001);

    // A real body was committed on top of the prior ones — distinct handle.
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const newHandle = await lastNativeBodyHandle();
    expect(newHandle).not.toBe(preLastHandle);
    expect(newHandle).toBe(piped.handle);
    await shot('thread-regression');

    // Both flavours of helical sweep coexist on the same window helper —
    // the spring + the thread were the same code path, just different
    // (R, pitch, length, r) tuples. Proves the panel is genuinely a
    // generic Helical Sweep tool, not a hard-coded spring builder.
    const live = await page.evaluate(() => ({
        helical: typeof window.__forgeHelicalSweepHelper?.runHelicalSweepPipeline === 'function',
        mirror:  !!window.__forgeHelicalSweep,
        pipe:    typeof window.forge?.part?.pipeFromPolyline === 'function',
    }));
    expect(live.helical).toBe(true);
    expect(live.mirror).toBe(true);
    expect(live.pipe).toBe(true);

    // Final mirror state reflects the most recent (thread) build.
    const mirror = await page.evaluate(() => window.__forgeHelicalSweep || null);
    expect(mirror).not.toBeNull();
    expect(mirror.handle).toBe(piped.handle);
    expect(mirror.R).toBeCloseTo(5, 5);
    expect(mirror.pitch).toBeCloseTo(2, 5);
});
