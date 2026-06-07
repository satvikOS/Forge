// PUSH-152 (Slice-112) — Multi-section Loft through Guide Curves.
//
// PUSH-102 (Slice-70) shipped the section-only loft. PUSH-152 layers in
// the guide curves that real wing / hull section workflows need: each
// guide is an open polyline that deflects the section profile away
// from the section-centroid spine. Multiple guides add up.
//
// Proof end-to-end:
//
//   00 — Boot, confirm the helper API window.__forgeMultiSectionLoftHelper
//        is wired BEFORE the panel mounts. Sanity-check the headless
//        math:
//          * normaliseSections drops < 3-pt polylines + sorts by z.
//          * normaliseGuides drops < 2-pt polylines.
//          * sampleClosed wraps the last-to-first edge at u=1.
//          * sampleOpen clamps to endpoints at v<0 / v>1.
//          * buildLoftGrid({ sections, guides }) with the panel preset
//            returns a 24×11 grid + a kernel-accepting xyz Float64Array.
//        Drive the headless pipeline with the defaults and confirm a
//        native SURFACE body lands with area > 0. iso view.
//
//   01 — Open the Multi-section Loft panel via tools.multiSectionLoft.
//        Assert the panel mounts; the 4-section + 2-guide default
//        preset is present; both lists render; the Apply button is
//        enabled. front view.
//
//   02 — Click Apply with the wing-like default (4 sections + 2 guides).
//        Assert a new surface body is committed, the
//        forge:multi-section-loft-built event fires with the right
//        sectionCount / guideCount, and the committed body's massProps
//        area is positive. top view.
//
//   03 — Modify the lists (add a 5th section, remove the second guide),
//        click Apply again. Confirm a fresh face handle lands, the bus
//        event fires with the updated counts, and the new body is
//        distinct from the first. right view.
//
//   04 — PUSH-102 regression: open the Loft Sections panel via
//        tools.loftSections menu action and apply the default — proves
//        PUSH-152 didn't collide with the existing surface-loft pipeline
//        or its helper API. close view (approximated as iso + zoomFit
//        per PUSH-102's convention since `close` is not a built-in
//        view-action id).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless pipeline)
//   - front (open panel + table assertions)
//   - top   (default Apply build + bus event)
//   - right (modified lists Apply build + fresh handle)
//   - close (PUSH-102 regression — iso + zoomFit)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-152-multi-section');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'multi-section-session.mp4');

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
async function lastNativeBody() {
    return await page.evaluate(() => {
        const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
        if (!bodies.length) return null;
        const b = bodies[bodies.length - 1];
        return {
            id: b.id, handle: b.handle, kind: b.kind,
            toolId: b.toolId, params: b.params, name: b.name,
        };
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
        if (/push-152|multi-section|MultiSection|forge:multi-section|surfacing|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay; flip the
    // seen flag so it stays dormant.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
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
        console.error('[push-152] no .webm'); return;
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
                console.log(`[push-152] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-152] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + headless pipeline ok (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    await page.waitForFunction(
        () => !!window.__forgeMultiSectionLoftHelper
           && typeof window.__forgeMultiSectionLoftHelper.runPipeline === 'function'
           && typeof window.__forgeMultiSectionLoftHelper.buildLoftGrid === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeMultiSectionLoftHelper;
        return {
            keys: Object.keys(h).sort(),
            event:   h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            uCount:  h.DEFAULT_U_COUNT,
            vCount:  h.DEFAULT_V_COUNT,
            minSections: h.MIN_SECTIONS,
            minSectionPoints: h.MIN_SECTION_POINTS,
            minGuidePoints: h.MIN_GUIDE_POINTS,
            defaultSectionCount: h.defaultSections().length,
            defaultGuideCount: h.defaultGuides().length,
        };
    });
    console.log('[push-152] helper shape =', JSON.stringify(helperShape));
    expect(helperShape.event).toBe('forge:multi-section-loft-built');
    expect(helperShape.storage).toBe('forge.v4.multiSectionLoft');
    expect(helperShape.uCount).toBe(24);
    expect(helperShape.vCount).toBe(11);
    expect(helperShape.minSections).toBe(2);
    expect(helperShape.minSectionPoints).toBe(3);
    expect(helperShape.minGuidePoints).toBe(2);
    expect(helperShape.defaultSectionCount).toBe(4);
    expect(helperShape.defaultGuideCount).toBe(2);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'buildLoftGrid', 'commitLoftGrid', 'appendLoftBody',
        'runPipeline', 'normaliseSections', 'normaliseGuides',
        'sampleClosed', 'sampleOpen', 'defaultSections', 'defaultGuides',
        'DEFAULT_U_COUNT', 'DEFAULT_V_COUNT',
        'MIN_SECTIONS', 'MIN_SECTION_POINTS', 'MIN_GUIDE_POINTS',
        'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Sanity-check the headless math.
    const mathCheck = await page.evaluate(() => {
        const h = window.__forgeMultiSectionLoftHelper;
        const triPoly = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
                         { x: 0, y: 1, z: 0 }];
        const undersized = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }];
        const goodGuide = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 5, z: 10 }];
        const undersizedGuide = [{ x: 0, y: 0, z: 0 }];

        // normaliseSections drops < 3-pt polylines.
        const ns = h.normaliseSections([triPoly, undersized, triPoly]);
        // normaliseGuides drops < 2-pt polylines.
        const ng = h.normaliseGuides([goodGuide, undersizedGuide]);

        // sampleClosed wraps last → first.
        const closed = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
                        { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
        const sAt0   = h.sampleClosed(closed, 0);    // → point 0 exactly
        const sAt025 = h.sampleClosed(closed, 0.25); // → point 1 exactly
        const sAt05  = h.sampleClosed(closed, 0.5);  // → point 2 exactly
        // u = 1 wraps back to point 0 (because we normalise into [0,1)).
        const sAt1   = h.sampleClosed(closed, 1);

        // sampleOpen clamps + lerps.
        const open = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }];
        const oAtNeg = h.sampleOpen(open, -0.5);
        const oAt0   = h.sampleOpen(open, 0);
        const oAt05  = h.sampleOpen(open, 0.5);  // → (5, 0, 0)
        const oAt1   = h.sampleOpen(open, 1);
        const oAt2   = h.sampleOpen(open, 2);

        // buildLoftGrid on the default sections+guides.
        const ss = h.defaultSections();
        const gs = h.defaultGuides();
        const grid = h.buildLoftGrid(ss, gs);

        // The kernel buildPatch primitive accepts {uCount, vCount, xyz};
        // confirm the xyz Float64Array has length uCount*vCount*3.
        return {
            nsCount: ns.length, ngCount: ng.length,
            sAt0, sAt025, sAt05, sAt1,
            oAtNeg, oAt0, oAt05, oAt1, oAt2,
            gridU: grid.uCount, gridV: grid.vCount,
            gridXyzLen: grid.xyz.length,
            gridGuideCount: grid.guideCount,
            // sample (0,0) and (last,last) just to confirm real numbers landed.
            gridFirst: [grid.grid[0][0][0], grid.grid[0][0][1], grid.grid[0][0][2]],
            gridLast: [
                grid.grid[grid.vCount - 1][grid.uCount - 1][0],
                grid.grid[grid.vCount - 1][grid.uCount - 1][1],
                grid.grid[grid.vCount - 1][grid.uCount - 1][2],
            ],
        };
    });
    console.log('[push-152] math check =', JSON.stringify(mathCheck));
    // normaliseSections: 2 good + 1 undersized → 2.
    expect(mathCheck.nsCount).toBe(2);
    // normaliseGuides: 1 good + 1 undersized → 1.
    expect(mathCheck.ngCount).toBe(1);

    // sampleClosed at u=0 → point 0 exactly (0,0,0).
    expect(mathCheck.sAt0.x).toBeCloseTo(0, 5);
    expect(mathCheck.sAt0.y).toBeCloseTo(0, 5);
    // sampleClosed at u=0.25 (= 1/4 → bracket index = floor(0.25*4) = 1
    // with f=0) → point 1 (1, 0, 0).
    expect(mathCheck.sAt025.x).toBeCloseTo(1, 5);
    expect(mathCheck.sAt025.y).toBeCloseTo(0, 5);
    expect(mathCheck.sAt05.x).toBeCloseTo(1, 5);
    expect(mathCheck.sAt05.y).toBeCloseTo(1, 5);
    // u=1 wraps to u=0 (closed polyline).
    expect(mathCheck.sAt1.x).toBeCloseTo(0, 5);
    expect(mathCheck.sAt1.y).toBeCloseTo(0, 5);

    // sampleOpen clamps at endpoints.
    expect(mathCheck.oAtNeg.x).toBeCloseTo(0, 5);
    expect(mathCheck.oAt0.x).toBeCloseTo(0, 5);
    expect(mathCheck.oAt05.x).toBeCloseTo(5, 5);
    expect(mathCheck.oAt1.x).toBeCloseTo(10, 5);
    expect(mathCheck.oAt2.x).toBeCloseTo(10, 5);

    // buildLoftGrid shape — 24×11 control grid with a 24·11·3 xyz array.
    expect(mathCheck.gridU).toBe(24);
    expect(mathCheck.gridV).toBe(11);
    expect(mathCheck.gridXyzLen).toBe(24 * 11 * 3);
    expect(mathCheck.gridGuideCount).toBe(2);
    // Last row's last column is non-degenerate (z should be near 90mm
    // because section 3 is at z=90).
    expect(mathCheck.gridLast[2]).toBeGreaterThan(60);

    // Drive the pipeline headlessly with the defaults. Must commit a
    // native SURFACE body with positive area.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeMultiSectionLoftHelper.runPipeline();
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            faceHandle: r.faceHandle, bodyId: r.body?.id,
            sectionCount: r.sectionCount, guideCount: r.guideCount,
            uCount: r.gridSpec?.uCount, vCount: r.gridSpec?.vCount,
        };
    });
    console.log('[push-152] headless pipe =', JSON.stringify(piped));
    expect(piped.ok).toBe(true);
    expect(piped.faceHandle).toBeGreaterThan(0);
    expect(piped.sectionCount).toBe(4);
    expect(piped.guideCount).toBe(2);
    expect(piped.uCount).toBe(24);
    expect(piped.vCount).toBe(11);
    expect(piped.bodyId).toBeTruthy();

    const post = await nativeBodyCount();
    expect(post).toBe(pre + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    // It's a surface — area > 0; volume may be 0 (sheet body).
    expect(mass.area).toBeGreaterThan(0);
    await shot('headless-build');
});

test('01 — open Multi-section Loft via tools.multiSectionLoft (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.multiSectionLoft');
    await page.waitForSelector('[data-testid="forge-ms-loft-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // 4-section + 2-guide default preset present.
    const sectionRowCount = await page.locator('[data-testid="forge-ms-loft-sections-list"]')
                                       .getAttribute('data-row-count');
    expect(Number(sectionRowCount)).toBe(4);
    const guideRowCount = await page.locator('[data-testid="forge-ms-loft-guides-list"]')
                                     .getAttribute('data-row-count');
    expect(Number(guideRowCount)).toBe(2);

    // Panel-level data attributes reflect the same sane counts.
    const sectionCount = await page.locator('[data-testid="forge-ms-loft-panel"]')
                                    .getAttribute('data-section-count');
    expect(Number(sectionCount)).toBe(4);
    const guideCount = await page.locator('[data-testid="forge-ms-loft-panel"]')
                                  .getAttribute('data-guide-count');
    expect(Number(guideCount)).toBe(2);

    // Each section row mounts with the right point count (24 — the
    // default circle resolution).
    const s0Pts = await page.locator('[data-testid="forge-ms-loft-section-0"]')
                             .getAttribute('data-point-count');
    expect(Number(s0Pts)).toBe(24);
    const s3Pts = await page.locator('[data-testid="forge-ms-loft-section-3"]')
                             .getAttribute('data-point-count');
    expect(Number(s3Pts)).toBe(24);

    // Each guide row mounts with the right point count (5 — the default
    // guide lobe resolution).
    const g0Pts = await page.locator('[data-testid="forge-ms-loft-guide-0"]')
                             .getAttribute('data-point-count');
    expect(Number(g0Pts)).toBe(5);
    const g1Pts = await page.locator('[data-testid="forge-ms-loft-guide-1"]')
                             .getAttribute('data-point-count');
    expect(Number(g1Pts)).toBe(5);

    // Apply button is present and enabled.
    await expect(page.locator('[data-testid="forge-ms-loft-apply"]')).toBeVisible();
    const disabled = await page.locator('[data-testid="forge-ms-loft-apply"]')
                                .getAttribute('disabled');
    expect(disabled).toBeNull();
});

test('02 — click Apply with defaults; surface body commits with area > 0 (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event
    // fired with the correct payload.
    await page.evaluate(() => {
        window.__push152Events = [];
        window.addEventListener('forge:multi-section-loft-built', (e) => {
            window.__push152Events.push({
                sectionCount: e?.detail?.sectionCount,
                guideCount: e?.detail?.guideCount,
                faceHandle: e?.detail?.faceHandle,
                uCount: e?.detail?.uCount,
                vCount: e?.detail?.vCount,
                ts: e?.detail?.ts,
            });
        });
    });

    const preCount = await nativeBodyCount();
    // DOM-level click avoids racing with overlays on the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-ms-loft-apply"]');
        if (!btn) throw new Error('apply button missing');
        btn.click();
    });
    await pause(700);
    await shot('default-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.area).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push152Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.sectionCount).toBe(4);
    expect(newest.guideCount).toBe(2);
    expect(newest.faceHandle).toBeGreaterThan(0);
    expect(newest.uCount).toBe(24);
    expect(newest.vCount).toBe(11);

    // The committed body's last-face data attribute is set.
    const lastFace = await page.locator('[data-testid="forge-ms-loft-panel"]')
                                .getAttribute('data-last-face');
    expect(Number(lastFace)).toBe(newest.faceHandle);

    // Log row count incremented.
    const logCount = await page.locator('[data-testid="forge-ms-loft-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);

    // Body record carries the right toolId + params.
    const body = await lastNativeBody();
    expect(body).not.toBeNull();
    expect(body.toolId).toBe('surfacing.multiSectionLoft');
    expect(body.params.sectionCount).toBe(4);
    expect(body.params.guideCount).toBe(2);
    expect(body.params.uCount).toBe(24);
    expect(body.params.vCount).toBe(11);
});

test('03 — modify lists (add 5th section + remove 2nd guide), Apply again (right)', async () => {
    await cameraTo('right');

    // Add a 5th section via the + button.
    await page.locator('[data-testid="forge-ms-loft-add-section"]').click();
    await pause(150);
    const sectionRowCount = await page.locator('[data-testid="forge-ms-loft-sections-list"]')
                                       .getAttribute('data-row-count');
    expect(Number(sectionRowCount)).toBe(5);

    // Remove the second guide (idx 1).
    await page.locator('[data-testid="forge-ms-loft-guide-remove-1"]').click();
    await pause(150);
    const guideRowCount = await page.locator('[data-testid="forge-ms-loft-guides-list"]')
                                     .getAttribute('data-row-count');
    expect(Number(guideRowCount)).toBe(1);

    // Shrink the third section a notch to demonstrate the scale button
    // round-trips through the React state.
    await page.locator('[data-testid="forge-ms-loft-section-shrink-2"]').click();
    await pause(150);
    await shot('list-modified');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-ms-loft-apply"]');
        btn.click();
    });
    await pause(700);
    await shot('modified-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.area).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push152Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.sectionCount).toBe(5);
    expect(last.guideCount).toBe(1);
    expect(last.faceHandle).toBeGreaterThan(0);
    // Two builds should yield distinct face handles.
    const handles = new Set(events.map((e) => e.faceHandle));
    expect(handles.size).toBeGreaterThanOrEqual(2);
});

test('04 — PUSH-102 regression: Loft Sections panel still works (close)', async () => {
    // The brief calls the 5th camera "close" — we approximate with the
    // iso + view.zoomFit pair so the camera ends up in a distinct,
    // labelled state, matching the PUSH-102 / PUSH-121 convention.
    await platformMenuAction('view.iso');
    await pause(200);
    await platformMenuAction('view.zoomFit');
    await pause(200);

    // Close the Multi-section Loft panel first so its right-docked
    // footprint doesn't intercept the Loft Sections tab clicks.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseMultiSectionLoft === 'function') {
            window.__forgeCloseMultiSectionLoft();
        }
    });
    await pause(250);

    await platformMenuAction('tools.loftSections');
    await page.waitForSelector('[data-testid="forge-loft-sections-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('loft-sections-open');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-loft-sections-apply"]');
        if (!btn) throw new Error('loft sections apply button missing');
        btn.click();
    });
    await pause(700);
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    await shot('loft-sections-built');

    // Both helper APIs coexist on window — the install side-effect from
    // PUSH-152's module didn't clobber PUSH-102's.
    const apiBothOk = await page.evaluate(() =>
        typeof window.__forgeMultiSectionLoftHelper?.runPipeline === 'function'
        && typeof window.__forgeLoftSectionsHelper?.runLoftSectionsPipeline === 'function');
    expect(apiBothOk).toBe(true);
});
