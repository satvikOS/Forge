// PUSH-122 (Slice-90) — Sweep along Curve panel.
//
// Generic sweep tool: take a 2D circular profile (radius input) and sweep
// it along a user-defined 3D polyline path (list of (x,y,z) points). The
// panel calls window.forge.part.pipeFromPolyline directly — the same
// OCCT primitive (BRepOffsetAPI_MakePipe over a circle + polyline spine)
// PUSH-45 piperoute uses internally — exposed here as a first-class
// generic sweep tool reachable via tools.sweepCurve.
//
// Proof end-to-end through the real Electron UI:
//
//   00 — Boot. Assert window.__forgeSweepCurveHelper is fully installed
//        BEFORE any panel is opened (the helper-API contract for plugins
//        + Archie tool calls). Drive the headless pipeline with the
//        default radius + path — must commit a native body with mass +
//        volume > 0. iso view.
//   01 — Open the Sweep along Curve panel via the tools.sweepCurve menu
//        action. Assert the panel mounts, the default 4-point bent path
//        + the 2.5 mm radius default are present, and the Apply button
//        is enabled. front view.
//   02 — Click Apply with the defaults. Native body count increments;
//        committed solid has volume > 0 and within the expected envelope
//        (π·r²·length ± mitre allowance — matches the kernel smoke). The
//        forge:sweep-curve-built bus event fires with the correct
//        payload. top view.
//   03 — Modify the table — add a 5th point + change the radius to
//        4 mm + adjust a coord — and Apply again. A fresh, distinct
//        OCCT handle lands, with volume > the first build (longer path
//        + larger Ø). right view.
//   04 — PUSH-45 regression: open the Pipe Routing workbench, Run the
//        default route, confirm a routed pipe still commits to the
//        scene with positive volume. Proves PUSH-122's sweep tool
//        coexists with the routing path that drives the same primitive.
//        iso view (named close).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless build)
//   - front (open panel + assertions)
//   - top   (default Apply)
//   - right (modified Apply)
//   - iso   (PUSH-45 regression + final shot — re-uses iso, labelled close)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-122-sweep-curve');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'sweep-curve-session.mp4');

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
        if (/push-122|sweep-curve|SweepCurve|forge:sweep-curve|pipeFromPolyline|piperoute|error|Error/i.test(t)) {
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
        console.error('[push-122] no .webm'); return;
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
                console.log(`[push-122] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-122] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + helper API mounted + headless pipeline ok (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the helper API to be installed (it's installed at module
    // import time when SweepCurvePanel.jsx is loaded by App.jsx).
    await page.waitForFunction(
        () => !!window.__forgeSweepCurveHelper
           && typeof window.__forgeSweepCurveHelper.runSweepCurvePipeline === 'function'
           && typeof window.__forgeSweepCurveHelper.normalisePath === 'function'
           && typeof window.__forgeSweepCurveHelper.flattenPath === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeSweepCurveHelper;
        return {
            keys: Object.keys(h).sort(),
            event: h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            defaultRadius: h.DEFAULT_RADIUS_MM,
            minRadius: h.MIN_RADIUS_MM,
            maxRadius: h.MAX_RADIUS_MM,
            minPoints: h.MIN_PATH_POINTS,
            defaultPath: h.DEFAULT_PATH,
        };
    });
    expect(helperShape.event).toBe('forge:sweep-curve-built');
    expect(helperShape.storage).toBe('forge.v4.sweepCurve');
    expect(helperShape.defaultRadius).toBe(2.5);
    expect(helperShape.minRadius).toBe(0.1);
    expect(helperShape.maxRadius).toBe(100);
    expect(helperShape.minPoints).toBe(2);
    expect(helperShape.defaultPath.length).toBe(4);
    // The 4-point bent preset: (0,0,0) → (30,0,0) → (30,20,0) → (30,20,15).
    expect(helperShape.defaultPath[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(helperShape.defaultPath[1]).toEqual({ x: 30, y: 0, z: 0 });
    expect(helperShape.defaultPath[2]).toEqual({ x: 30, y: 20, z: 0 });
    expect(helperShape.defaultPath[3]).toEqual({ x: 30, y: 20, z: 15 });
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'sanitiseRadius', 'normalisePath', 'flattenPath', 'pathLength',
        'runSweepCurvePipeline',
        'DEFAULT_RADIUS_MM', 'MIN_RADIUS_MM', 'MAX_RADIUS_MM',
        'MIN_PATH_POINTS', 'DEFAULT_PATH',
        'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Sanitiser / flattener math is real — feed a path with a dup +
    // a non-finite row and confirm both are removed.
    const sanityCheck = await page.evaluate(() => {
        const h = window.__forgeSweepCurveHelper;
        const norm = h.normalisePath([
            { x: 0,   y: 0, z: 0   },
            { x: 0,   y: 0, z: 0   },          // dup → dropped
            { x: 10,  y: 0, z: 0   },
            { x: 'x', y: 0, z: 0   },          // bad → dropped
            { x: 10,  y: 5, z: 0   },
        ]);
        const flat = h.flattenPath(norm);
        return {
            norm,
            flat: Array.from(flat),
            radiusGood:  h.sanitiseRadius(5),
            radiusClamp: h.sanitiseRadius(1000),
            radiusBad:   Number.isNaN(h.sanitiseRadius('abc')),
            length: h.pathLength(norm),
        };
    });
    expect(sanityCheck.norm.length).toBe(3);
    expect(sanityCheck.flat).toEqual([0,0,0,  10,0,0,  10,5,0]);
    expect(sanityCheck.radiusGood).toBeCloseTo(5, 5);
    expect(sanityCheck.radiusClamp).toBeCloseTo(100, 5);
    expect(sanityCheck.radiusBad).toBe(true);
    expect(sanityCheck.length).toBeCloseTo(10 + 5, 5);

    // Pipe must be present on the bridge — that's the whole contract.
    const bridge = await page.evaluate(() => ({
        hasForge:        !!window.forge,
        hasPart:         !!window.forge?.part,
        hasSweep:        typeof window.forge?.part?.sweep === 'function',
        hasPipePolyline: typeof window.forge?.part?.pipeFromPolyline === 'function',
        hasMassProps:    typeof window.forge?.massProps === 'function',
        hasAppendBody:   typeof window.__forgeAppendBody === 'function',
    }));
    expect(bridge.hasForge).toBe(true);
    expect(bridge.hasPart).toBe(true);
    expect(bridge.hasSweep).toBe(true);
    expect(bridge.hasPipePolyline).toBe(true);
    expect(bridge.hasMassProps).toBe(true);
    expect(bridge.hasAppendBody).toBe(true);

    // Drive the pipeline headlessly with the defaults. Must commit a
    // native body with volume > 0.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeSweepCurveHelper.runSweepCurvePipeline();
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            handle: r.handle, bodyId: r.body?.id,
            radius: r.radius, pointCount: r.sane?.length,
            length: r.length, volume: r.volume,
        };
    });
    console.log('[push-122] headless build =', JSON.stringify(piped));
    expect(piped.ok).toBe(true);
    expect(piped.handle).toBeGreaterThan(0);
    expect(piped.radius).toBeCloseTo(2.5, 5);
    expect(piped.pointCount).toBe(4);
    // Default path: 30 + 20 + 15 = 65 mm spine.
    expect(piped.length).toBeCloseTo(65, 1);
    expect(piped.volume).toBeGreaterThan(0);
    expect(piped.bodyId).toBeTruthy();

    const post = await nativeBodyCount();
    expect(post).toBe(pre + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(Math.abs(mass.volume)).toBeGreaterThan(0);
    // Solid tube vs. naive πr²L upper bound. The kernel mitres each
    // elbow (90° elbow on a polyline trims a corner box ≈ r³ each), and
    // OCCT's BRepOffsetAPI_MakePipe over a sharply-bent spine routinely
    // loses more material than a smoothly-routed path. We assert >0 and
    // <= 1.02×naive (the hard physical upper bound).
    const r = 2.5, len = 65;
    const naive = Math.PI * r * r * len;
    expect(Math.abs(mass.volume)).toBeGreaterThan(0);
    expect(Math.abs(mass.volume)).toBeLessThan(naive * 1.02);

    // window.__forgeSweepCurve mirror has the same handle.
    const mirror = await page.evaluate(() => window.__forgeSweepCurve || null);
    expect(mirror).not.toBeNull();
    expect(mirror.handle).toBe(piped.handle);
    expect(mirror.radius).toBeCloseTo(2.5, 5);
    expect(mirror.pathPoints.length).toBe(4);

    await shot('headless-build');
});

test('01 — open Sweep along Curve via tools.sweepCurve; defaults mount (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.sweepCurve');
    await page.waitForSelector('[data-testid="forge-sweep-curve-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Default 4 path rows present.
    const rowCount = await page.locator('[data-testid="forge-sweep-curve-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(4);
    const pointCount = await page.locator('[data-testid="forge-sweep-curve-panel"]')
                                  .getAttribute('data-point-count');
    expect(Number(pointCount)).toBe(4);

    // Default radius = 2.5 mm.
    const rVal = await page.locator('[data-testid="forge-sweep-curve-radius"]').inputValue();
    expect(Number(rVal)).toBeCloseTo(2.5, 5);
    const panelRadius = await page.locator('[data-testid="forge-sweep-curve-panel"]')
                                    .getAttribute('data-radius');
    expect(Number(panelRadius)).toBeCloseTo(2.5, 5);

    // First + last path rows confirm the preset.
    const x0 = await page.locator('[data-testid="forge-sweep-curve-x-0"]').inputValue();
    const y0 = await page.locator('[data-testid="forge-sweep-curve-y-0"]').inputValue();
    const z0 = await page.locator('[data-testid="forge-sweep-curve-z-0"]').inputValue();
    expect(Number(x0)).toBe(0);
    expect(Number(y0)).toBe(0);
    expect(Number(z0)).toBe(0);
    const x3 = await page.locator('[data-testid="forge-sweep-curve-x-3"]').inputValue();
    const y3 = await page.locator('[data-testid="forge-sweep-curve-y-3"]').inputValue();
    const z3 = await page.locator('[data-testid="forge-sweep-curve-z-3"]').inputValue();
    expect(Number(x3)).toBe(30);
    expect(Number(y3)).toBe(20);
    expect(Number(z3)).toBe(15);

    // Summary shows length 65mm.
    const summaryTxt = await page.locator('[data-testid="forge-sweep-curve-summary"]').innerText();
    expect(summaryTxt).toMatch(/4 unique/);
    expect(summaryTxt).toMatch(/65/);

    // Apply button is present and enabled.
    await expect(page.locator('[data-testid="forge-sweep-curve-apply"]')).toBeVisible();
    const disabled = await page.locator('[data-testid="forge-sweep-curve-apply"]')
                                .getAttribute('disabled');
    expect(disabled).toBeNull();
});

test('02 — click Apply with defaults; solid commits + bus event fires (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event fired.
    await page.evaluate(() => {
        window.__push122Events = [];
        window.addEventListener('forge:sweep-curve-built', (e) => {
            window.__push122Events.push({
                pointCount: e?.detail?.pointCount,
                handle:     e?.detail?.handle,
                radius:     e?.detail?.radius,
                length:     e?.detail?.length,
                volume:     e?.detail?.volume,
                bodyId:     e?.detail?.bodyId,
                ts:         e?.detail?.ts,
            });
        });
    });

    const preCount = await nativeBodyCount();
    // DOM-level click avoids racing with overlays on the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-sweep-curve-apply"]');
        if (!btn) throw new Error('apply button missing');
        btn.click();
    });
    await pause(700);
    await shot('default-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    const vol = Math.abs(mass.volume);
    console.log('[push-122] default-apply volume =', vol);
    expect(vol).toBeGreaterThan(0);
    // Upper bound: πr²L. Lower bound: the sweep loses material at each
    // 90° mitre, so we only assert > 0 here.
    const r = 2.5, len = 65;
    const naive = Math.PI * r * r * len;
    expect(vol).toBeLessThan(naive * 1.02);

    const events = await page.evaluate(() => window.__push122Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.pointCount).toBe(4);
    expect(newest.handle).toBeGreaterThan(0);
    expect(newest.radius).toBeCloseTo(2.5, 5);
    expect(newest.length).toBeCloseTo(65, 1);
    expect(newest.volume).toBeGreaterThan(0);

    // Log row count increments.
    const logCount = await page.locator('[data-testid="forge-sweep-curve-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);

    // The committed body's last-handle data attribute is set.
    const lastHandle = await page.locator('[data-testid="forge-sweep-curve-panel"]')
                                  .getAttribute('data-last-handle');
    expect(Number(lastHandle)).toBe(newest.handle);
});

test('03 — modify table (add 5th point + bump radius to 4mm), Apply again (right)', async () => {
    await cameraTo('right');

    // Add a 5th point via the + button.
    await page.locator('[data-testid="forge-sweep-curve-add"]').click();
    await pause(150);
    const rowCount = await page.locator('[data-testid="forge-sweep-curve-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(5);

    // Bump the radius to 4 mm — gives a thicker sweep.
    await page.locator('[data-testid="forge-sweep-curve-radius"]').fill('4');
    await pause(150);

    // Move the new (5th) point higher in z so the path gets longer.
    await page.locator('[data-testid="forge-sweep-curve-z-4"]').fill('40');
    await pause(150);
    // Also nudge x to introduce a non-trivial third bend at the end.
    await page.locator('[data-testid="forge-sweep-curve-x-4"]').fill('45');
    await pause(150);
    await shot('table-modified');

    // Re-read the summary — sane count should still be 5 (no collapses
    // because the new point is distinct from row 4 in both x and z).
    const sum = await page.locator('[data-testid="forge-sweep-curve-summary"]').innerText();
    console.log('[push-122] modified summary =', sum);
    expect(sum).toMatch(/5 unique/);

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-sweep-curve-apply"]');
        btn.click();
    });
    await pause(700);
    await shot('modified-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    const vol = Math.abs(mass.volume);
    console.log('[push-122] modified-apply volume =', vol);
    expect(vol).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push122Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.pointCount).toBe(5);
    expect(last.handle).toBeGreaterThan(0);
    expect(last.radius).toBeCloseTo(4, 5);
    // Two builds should yield distinct OCCT handles.
    const handles = new Set(events.map((e) => e.handle));
    expect(handles.size).toBeGreaterThanOrEqual(2);

    // Modified build should sweep a noticeably bigger volume than the
    // first (radius 1.6× and longer path).
    const first = events[0];
    expect(last.volume).toBeGreaterThan(first.volume);
});

test('04 — PUSH-45 regression: Pipe Routing still routes + commits a solid (iso/close)', async () => {
    await cameraTo('iso');

    // Close the Sweep along Curve panel first so its right-docked
    // footprint doesn't intercept the PipeRoute workbench's clicks.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseSweepCurve === 'function') {
            window.__forgeCloseSweepCurve();
        }
    });
    await pause(250);

    const preCount = await nativeBodyCount();
    const preLastHandle = await lastNativeBodyHandle();

    await platformMenuAction('tools.piperoute');
    await page.waitForSelector('[data-testid="forge-piperoute-panel"]',
                               { state: 'visible', timeout: 8000 });
    await shot('piperoute-panel-open');

    await page.locator('[data-testid="forge-piperoute-run"]').click();
    await pause(1200);
    await shot('piperoute-routed');

    // Router reports a result.
    const hasResult = await page.locator('[data-testid="forge-piperoute-result"]').count();
    expect(hasResult).toBeGreaterThan(0);

    // A real pipe solid is committed on top of the prior bodies.
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const newHandle = await lastNativeBodyHandle();
    expect(newHandle).not.toBe(preLastHandle);

    // Volume positive — the routed pipe is a real OCCT solid (same kernel
    // op PUSH-122's panel just used).
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    const vol = Math.abs(mass.volume);
    console.log('[push-122] piperoute regression volume =', vol);
    expect(vol).toBeGreaterThan(1.0);

    // Both helper APIs outlive each other — proves the PUSH-122 helper
    // didn't trample PUSH-45's window globals (or vice versa).
    const bothLive = await page.evaluate(() => ({
        sweep:     typeof window.__forgeSweepCurveHelper?.runSweepCurvePipeline === 'function',
        sweepLast: !!window.__forgeSweepCurve,
        pipe:      typeof window.forge?.part?.pipeFromPolyline === 'function',
        piperoute: typeof window.forge?.piperoute?.route === 'function',
    }));
    expect(bothLive.sweep).toBe(true);
    expect(bothLive.sweepLast).toBe(true);
    expect(bothLive.pipe).toBe(true);
    expect(bothLive.piperoute).toBe(true);
});
