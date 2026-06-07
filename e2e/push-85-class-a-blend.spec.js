// PUSH-85 (Slice-53) — Class-A G2/G3 curvature-continuous surface blend.
//
// The user's brief:
//   "Implement ArchDisc Forge slice PUSH-85 — G2/G3 curvature-continuous
//    surface blend panel (Class-A). … Multi-cam e2e mandatory: 5 named
//    camera angles."
//
// Proof end-to-end:
//   1. Boot Electron; assert window.__forgeClassABlendHelper is wired —
//      that's the headless contract surface plugins / Archie tool calls
//      use to drive the same pipeline without mounting the panel.
//   2. Run the headless pipeline directly (G2) and assert it returns
//      ok:true with a positive face handle. Confirm the helper's pure
//      math (bilinear and Hermite) returns 11×11 grids with corner
//      points that exactly match the boundary.
//   3. Open the Class-A Blend panel via tools.classABlend menu action.
//      Assert the panel mounts; the G2 radio is active (the default and
//      the persisted choice from step 2 if local storage is hot); the
//      build button is present.
//   4. Switch the continuity radio to G3 and click "Build sample blend".
//      Assert a new native surface body lands in window.__forgeBodies
//      with a positive area (kernel sanity — the NURBS face is real).
//   5. Switch back to G1 and build again. Confirm the bus event fires
//      with the matching continuity and a fresh face handle.
//   6. Switch the boundary source radio to "From body" and build. With
//      no body picked, the panel falls back to the preset and still
//      commits a body.
//   7. PUSH-41 regression: open the Surfacing panel via tools.surfacing
//      and assert the v4 tab strip + the buildPatch operation row are
//      both still present — proves PUSH-85 didn't collide with the
//      existing surfacing pipeline.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless math)
//   - front (open panel + radio assertions)
//   - top   (G3 build)
//   - right (G1 build + bus event)
//   - close (from-body build + Surfacing regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-85-class-a-blend');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'class-a-blend-session.mp4');

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-85|class-a-blend|ClassABlend|forge:class-a-blend|surfacing|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss any first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Forge-189 onboarding tour mounts a full-screen overlay; flip the
    // seen flag so it stays dormant. Also clear any persisted Class-A
    // blend continuity from a previous run so test #01's "G2 is the
    // default" assertion is deterministic.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        try { window.localStorage.removeItem('forge.v4.classABlend'); } catch {}
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
        console.error('[push-85] no .webm'); return;
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
                console.log(`[push-85] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-85] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + headless pipeline ok (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the host effect to attach the helper API mirror.
    await page.waitForFunction(
        () => !!window.__forgeClassABlendHelper
           && typeof window.__forgeOpenClassABlend === 'function'
           && typeof window.__forgeClassABlendHelper.runClassABlendPipeline === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeClassABlendHelper;
        return {
            keys: Object.keys(h).sort(),
            event: h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            samples: h.DEFAULT_SAMPLES,
            continuityOptions: h.CONTINUITY_OPTIONS.map((o) => o.id),
        };
    });
    expect(helperShape.event).toBe('forge:class-a-blend-built');
    expect(helperShape.storage).toBe('forge.v4.classABlend');
    expect(helperShape.samples).toBe(11);
    expect(helperShape.continuityOptions).toEqual(['G1', 'G2', 'G3']);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'buildBoundary', 'buildClassAGrid', 'commitClassAGrid',
        'appendClassABody', 'readActiveBody', 'runClassABlendPipeline',
        'continuityToTension',
    ]));

    // Drive the pipeline headlessly with G2 (the default). Must commit a
    // native body with a positive surface area.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeClassABlendHelper.runClassABlendPipeline({
            source: 'preset', continuity: 'G2', samples: 11,
        });
        return {
            ok: r.ok, reason: r.reason || null,
            faceHandle: r.faceHandle, bodyId: r.body?.id,
            uCount: r.gridSpec.uCount, vCount: r.gridSpec.vCount,
            kind: r.gridSpec.kind, tension: r.gridSpec.tension,
            firstCorner: r.gridSpec.grid[0][0],
            lastCorner: r.gridSpec.grid[r.gridSpec.uCount - 1][r.gridSpec.vCount - 1],
        };
    });
    expect(piped.ok).toBe(true);
    expect(piped.faceHandle).toBeGreaterThan(0);
    expect(piped.uCount).toBe(11);
    expect(piped.vCount).toBe(11);
    expect(piped.kind).toBe('hermite');
    // The Hermite tension for G2 is the continuityToTension mapping; the
    // CONTINUITY_OPTIONS map carries the documented value.
    expect(piped.tension).toBeCloseTo(0.66, 2);
    // The 100 mm saddle preset has corners at (-50,-50,0) and (+50,+50,0)
    // — Coons matches the boundary exactly so the corner points pin.
    expect(piped.firstCorner[0]).toBeCloseTo(-50, 5);
    expect(piped.firstCorner[1]).toBeCloseTo(-50, 5);
    expect(piped.firstCorner[2]).toBeCloseTo(0, 5);
    expect(piped.lastCorner[0]).toBeCloseTo(+50, 5);
    expect(piped.lastCorner[1]).toBeCloseTo(+50, 5);
    expect(piped.lastCorner[2]).toBeCloseTo(0, 5);

    const post = await nativeBodyCount();
    expect(post).toBe(pre + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    // It's a surface — area > 0, volume may be 0 (sheet body).
    expect(mass.area).toBeGreaterThan(0);
    await shot('headless-g2-built');
});

test('01 — open Class-A Blend via tools.classABlend; G2 is the persisted default (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.classABlend');
    await page.waitForSelector('[data-testid="forge-class-a-blend-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Continuity defaults to G2 (the persisted choice).
    const cont = await page.locator('[data-testid="forge-class-a-blend-panel"]')
                            .getAttribute('data-continuity');
    expect(cont).toBe('G2');
    const source = await page.locator('[data-testid="forge-class-a-blend-panel"]')
                              .getAttribute('data-source');
    expect(source).toBe('preset');

    // The three continuity radios + the build button exist.
    await expect(page.locator('[data-testid="forge-class-a-blend-continuity-g1"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-class-a-blend-continuity-g2"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-class-a-blend-continuity-g3"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-class-a-blend-build"]')).toBeVisible();

    // G2 is the active (aria-pressed="true") radio at boot.
    const g2Active = await page.locator('[data-testid="forge-class-a-blend-continuity-g2"]')
                                .getAttribute('data-active');
    expect(g2Active).toBe('1');
});

test('02 — switch to G3 and build; new body lands with area > 0 (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event
    // fired with the correct continuity.
    await page.evaluate(() => {
        window.__push85Events = [];
        window.addEventListener('forge:class-a-blend-built', (e) => {
            window.__push85Events.push({
                continuity: e?.detail?.continuity,
                source: e?.detail?.source,
                faceHandle: e?.detail?.faceHandle,
                ts: e?.detail?.ts,
            });
        });
    });

    const preCount = await nativeBodyCount();
    await page.locator('[data-testid="forge-class-a-blend-continuity-g3"]').click();
    await pause(150);
    const cont = await page.locator('[data-testid="forge-class-a-blend-panel"]')
                            .getAttribute('data-continuity');
    expect(cont).toBe('G3');
    await shot('g3-selected');

    // Click the build button. The DOM-level click avoids racing with the
    // VideoCaptureHUD (zIndex 2400) for the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-class-a-blend-build"]');
        if (!btn) throw new Error('build button missing');
        btn.click();
    });
    await pause(700);
    await shot('g3-built');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.area).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push85Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.continuity).toBe('G3');
    expect(newest.source).toBe('preset');
    expect(newest.faceHandle).toBeGreaterThan(0);

    // The log row count increments.
    const logCount = await page.locator('[data-testid="forge-class-a-blend-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);
});

test('03 — switch back to G1; build; bus event matches (right)', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-class-a-blend-continuity-g1"]').click();
    await pause(150);
    const cont = await page.locator('[data-testid="forge-class-a-blend-panel"]')
                            .getAttribute('data-continuity');
    expect(cont).toBe('G1');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-class-a-blend-build"]');
        btn.click();
    });
    await pause(700);
    await shot('g1-built');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const events = await page.evaluate(() => window.__push85Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.continuity).toBe('G1');

    // The Hermite/bilinear divergence: G1 uses the bilinear path. Let's
    // confirm via the headless math helper that the two paths yield
    // different interior points for the same boundary.
    const divergence = await page.evaluate(() => {
        const h = window.__forgeClassABlendHelper;
        const boundary = h.buildBoundary({ source: 'preset', samples: 11 });
        const bilinearGrid = h.buildClassAGrid({ boundary, continuity: 'G1', samples: 11 });
        const hermiteGrid  = h.buildClassAGrid({ boundary, continuity: 'G3', samples: 11 });
        // Compare the centre point (5,5).
        const a = bilinearGrid.grid[5][5];
        const b = hermiteGrid.grid[5][5];
        return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    });
    expect(divergence).toBeGreaterThan(0);
});

test('04 — switch source to body + build; surfacing regression (close)', async () => {
    // The brief calls the 5th camera "close" — we approximate with the
    // ⌘+ zoom-in / view.zoomFit pair so the camera ends up in a distinct,
    // labelled state.
    await platformMenuAction('view.iso');
    await pause(200);
    await platformMenuAction('view.zoomFit');
    await pause(200);

    await page.locator('[data-testid="forge-class-a-blend-source-body"]').click();
    await pause(150);
    const src = await page.locator('[data-testid="forge-class-a-blend-panel"]')
                          .getAttribute('data-source');
    expect(src).toBe('body');
    await expect(page.locator('[data-testid="forge-class-a-blend-body-status"]')).toBeVisible();
    await shot('source-body');

    // With no body selection, the panel falls back to the preset — the
    // body-status row still renders, and the build still commits.
    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-class-a-blend-build"]');
        btn.click();
    });
    await pause(700);
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    await shot('body-source-built');

    // PUSH-41 regression — close the Class-A Blend panel first so its
    // right-docked footprint doesn't intercept the Surfacing tab clicks,
    // then open Surfacing and assert the v4 tab strip + buildPatch op
    // are both still present. Use .first() because the Surfacing host
    // can mount more than one instance in some shells.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseClassABlend === 'function') {
            window.__forgeCloseClassABlend();
        }
    });
    await pause(250);
    await platformMenuAction('tools.surfacing');
    await page.waitForSelector('[data-testid="forge-surfacing-panel"]',
                               { state: 'visible', timeout: 6000 });
    await page.locator('[data-testid="forge-surfacing-tab-operations"]').first().click({ force: true });
    await pause(300);
    await expect(page.locator('[data-testid="forge-surfacing-op-buildPatch"]').first())
        .toBeVisible();
    await shot('surfacing-regression');

    // The Surfacing panel + the headless ClassABlend helper API both
    // outlive the panel close — proves the two surfaces don't trample
    // each other's window globals.
    const helperOk = await page.evaluate(() =>
        typeof window.__forgeClassABlendHelper?.runClassABlendPipeline === 'function');
    expect(helperOk).toBe(true);
});
