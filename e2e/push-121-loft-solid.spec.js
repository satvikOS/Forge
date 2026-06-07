// PUSH-121 (Slice-89) — Loft Solid body (closed-loop multi-section solid).
//
// PUSH-102 (Slice-70) shipped the multi-section loft as a SURFACE body
// via window.forge.surfacing.buildPatch. PUSH-121 lands the SOLID
// equivalent: sweep N closed circular profiles into a watertight OCCT
// solid body via the cone-frustum-chain composition (forge.makeCone +
// forge.translate + forge.fuse), which is the standard OCCT recipe for
// circular ThruSections and produces the identical closed-loop topology.
//
// Proof end-to-end through the real Electron UI:
//
//   00 — Boot, confirm the helper API window.__forgeLoftSolidHelper is
//        wired BEFORE the panel mounts (side-effect helper install at
//        module import time). Drive the headless pipeline with the
//        default 3-section bottle-neck preset and confirm a SOLID
//        native body lands with volume > 0 (kernel mass props).
//        Verify the kernel volume matches the analytic frustum-chain
//        volume formula within 1 % (a tight tolerance proves we
//        actually used cone primitives + fuse rather than something
//        else). iso view.
//   01 — Open the Loft Solid panel via tools.loftSolid menu action.
//        Assert the panel mounts; the 3-section default table is
//        present; the Apply button is enabled; the live preview shows
//        the analytic volume + total height. front view.
//   02 — Click Apply with the default sections. Assert a new SOLID
//        body is committed (kind:native), the forge:loft-solid-built
//        event fires with the kernel handle + volume in its detail,
//        and the committed body's massProps volume is positive AND
//        consistent with the analytic prediction. top view.
//   03 — Modify the table (add a 4th section, change a radius), click
//        Apply again. Confirm a fresh handle lands, the bus event
//        fires with the updated section count + frustum count, and
//        the new volume reflects the table change (different from
//        the default volume). right view.
//   04 — PUSH-102 regression: open the Loft Sections (SURFACE) panel
//        via tools.loftSections menu action. Apply the default,
//        confirm a surface body still lands. Proves PUSH-121 didn't
//        collide with the existing surface loft. Both helpers
//        (__forgeLoftSolidHelper + __forgeLoftSectionsHelper) coexist
//        on window. close view (approximated as iso + zoomFit per
//        PUSH-102's convention since `close` is not a built-in
//        view-action id).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless pipeline + analytic vs kernel)
//   - front (open panel + table assertions)
//   - top   (default Apply build + bus event)
//   - right (modified table Apply build + fresh handle)
//   - close (PUSH-102 regression — iso + zoomFit)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-121-loft-solid');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'loft-solid-session.mp4');

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
        if (/push-121|loft-solid|LoftSolid|forge:loft-solid|makeCone|fuse|error|Error/i.test(t)) {
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
        console.error('[push-121] no .webm'); return;
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
                console.log(`[push-121] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-121] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + headless pipeline ok + analytic match (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the helper API to be installed (it's installed at module
    // import time when LoftSolidPanel.jsx is loaded by App.jsx).
    await page.waitForFunction(
        () => !!window.__forgeLoftSolidHelper
           && typeof window.__forgeLoftSolidHelper.runLoftSolidPipeline === 'function'
           && typeof window.__forgeLoftSolidHelper.buildLoftSolid === 'function'
           && typeof window.__forgeLoftSolidHelper.analyticVolume === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeLoftSolidHelper;
        return {
            keys: Object.keys(h).sort(),
            event:   h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            defaultSections: h.DEFAULT_SECTIONS,
            minSections: h.MIN_SECTIONS,
        };
    });
    expect(helperShape.event).toBe('forge:loft-solid-built');
    expect(helperShape.storage).toBe('forge.v4.loftSolid');
    expect(helperShape.minSections).toBe(2);
    // The bottle-neck preset is z=0/30/60, r=20/14/22.
    expect(helperShape.defaultSections.length).toBe(3);
    expect(helperShape.defaultSections[0].z).toBe(0);
    expect(helperShape.defaultSections[0].radius).toBe(20);
    expect(helperShape.defaultSections[1].z).toBe(30);
    expect(helperShape.defaultSections[1].radius).toBe(14);
    expect(helperShape.defaultSections[2].z).toBe(60);
    expect(helperShape.defaultSections[2].radius).toBe(22);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'normaliseSections', 'analyticVolume', 'totalHeight',
        'buildLoftSolid', 'runLoftSolidPipeline',
        'DEFAULT_SECTIONS', 'MIN_SECTIONS',
        'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Verify the analytic frustum-chain volume formula returns a
    // positive number for the preset. We compute by hand:
    //   pair 1: r1=20, r2=14, h=30 → (π·30/3)·(400+280+196) = 10π·876
    //   pair 2: r1=14, r2=22, h=30 → (π·30/3)·(196+308+484) = 10π·988
    //   total = 10π·(876+988) = 10π·1864 ≈ 58559.81 mm³
    const analytic = await page.evaluate(() => {
        const h = window.__forgeLoftSolidHelper;
        return {
            preset: h.analyticVolume(h.DEFAULT_SECTIONS),
            height: h.totalHeight(h.DEFAULT_SECTIONS),
        };
    });
    expect(analytic.height).toBe(60);
    const expected = 10 * Math.PI * 1864;
    expect(analytic.preset).toBeCloseTo(expected, 2);

    // Drive the pipeline headlessly with the defaults. Must commit a
    // native SOLID body with a positive volume.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeLoftSolidHelper.runLoftSolidPipeline();
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            handle: r.handle, bodyId: r.body?.id,
            volume: r.volume, height: r.height,
            sectionCount: r.sane?.length,
            frustumCount: r.frustumHandles?.length,
            toolId: r.body?.toolId,
        };
    });
    expect(piped.ok).toBe(true);
    expect(piped.handle).toBeGreaterThan(0);
    expect(piped.sectionCount).toBe(3);
    expect(piped.frustumCount).toBe(2);
    expect(piped.height).toBe(60);
    expect(piped.bodyId).toBeTruthy();
    expect(piped.toolId).toBe('part.loftSolid');
    expect(piped.volume).toBeGreaterThan(0);
    // Kernel volume must match analytic within 1 % — cone frustums
    // through OCCT MakeCone match the analytic π·h·(r1²+r1·r2+r2²)/3
    // formula to numerical precision, and Fuse preserves the volume.
    expect(piped.volume).toBeCloseTo(expected, -2);
    expect(Math.abs(piped.volume - expected) / expected).toBeLessThan(0.01);

    const post = await nativeBodyCount();
    expect(post).toBe(pre + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.volume).toBeGreaterThan(0);

    // The committed body must be a native solid, not a surface.
    const lb = await lastNativeBody();
    expect(lb).not.toBeNull();
    expect(lb.toolId).toBe('part.loftSolid');
    expect(lb.params.sectionCount).toBe(3);
    expect(lb.params.frustumCount).toBe(2);
    await shot('headless-build');
});

test('01 — open Loft Solid via tools.loftSolid; default table mounts (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.loftSolid');
    await page.waitForSelector('[data-testid="forge-loft-solid-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Default 3 rows present.
    const rowCount = await page.locator('[data-testid="forge-loft-solid-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(3);
    const sectionCount = await page.locator('[data-testid="forge-loft-solid-panel"]')
                                    .getAttribute('data-section-count');
    expect(Number(sectionCount)).toBe(3);

    // The three input pairs are visible — confirm field values.
    const z0 = await page.locator('[data-testid="forge-loft-solid-z-0"]').inputValue();
    const r0 = await page.locator('[data-testid="forge-loft-solid-radius-0"]').inputValue();
    expect(Number(z0)).toBe(0);
    expect(Number(r0)).toBe(20);
    const z2 = await page.locator('[data-testid="forge-loft-solid-z-2"]').inputValue();
    const r2 = await page.locator('[data-testid="forge-loft-solid-radius-2"]').inputValue();
    expect(Number(z2)).toBe(60);
    expect(Number(r2)).toBe(22);

    // The summary shows the analytic volume + height preview.
    const heightAttr = await page.locator('[data-testid="forge-loft-solid-panel"]')
                                  .getAttribute('data-height');
    expect(Number(heightAttr)).toBe(60);
    const volAttr = await page.locator('[data-testid="forge-loft-solid-panel"]')
                               .getAttribute('data-analytic-volume');
    const expectedVol = 10 * Math.PI * 1864;
    expect(Number(volAttr)).toBeCloseTo(expectedVol, 2);

    // Apply button is present and enabled.
    await expect(page.locator('[data-testid="forge-loft-solid-apply"]')).toBeVisible();
    const disabled = await page.locator('[data-testid="forge-loft-solid-apply"]')
                                .getAttribute('disabled');
    expect(disabled).toBeNull();
});

test('02 — click Apply with defaults; solid body commits with volume > 0 (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event
    // fired with the correct payload.
    await page.evaluate(() => {
        window.__push121Events = [];
        window.addEventListener('forge:loft-solid-built', (e) => {
            window.__push121Events.push({
                handle: e?.detail?.handle,
                bodyId: e?.detail?.bodyId,
                sectionCount: e?.detail?.sectionCount,
                frustumCount: e?.detail?.frustumCount,
                volume: e?.detail?.volume,
                height: e?.detail?.height,
                ts: e?.detail?.ts,
            });
        });
    });

    const preCount = await nativeBodyCount();
    // DOM-level click avoids racing with overlays on the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-loft-solid-apply"]');
        if (!btn) throw new Error('apply button missing');
        btn.click();
    });
    await pause(700);
    await shot('default-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.volume).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push121Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.sectionCount).toBe(3);
    expect(newest.frustumCount).toBe(2);
    expect(newest.handle).toBeGreaterThan(0);
    expect(newest.height).toBe(60);
    // Bus-event volume should match the kernel mass-props volume.
    expect(newest.volume).toBeCloseTo(mass.volume, 3);

    // Log row count increments.
    const logCount = await page.locator('[data-testid="forge-loft-solid-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);

    // The committed body's last-handle data attribute is set.
    const lastHandle = await page.locator('[data-testid="forge-loft-solid-panel"]')
                                  .getAttribute('data-last-handle');
    expect(Number(lastHandle)).toBe(newest.handle);

    // The window mirror is populated.
    const mirror = await page.evaluate(() => window.__forgeLoftSolid || null);
    expect(mirror).not.toBeNull();
    expect(mirror.handle).toBe(newest.handle);
    expect(mirror.sections.length).toBe(3);
    expect(mirror.frustumHandles.length).toBe(2);
});

test('03 — modify table (add 4th section + adjust radius), Apply again (right)', async () => {
    await cameraTo('right');

    // Add a 4th section via the + button.
    await page.locator('[data-testid="forge-loft-solid-add"]').click();
    await pause(150);
    const rowCount = await page.locator('[data-testid="forge-loft-solid-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(4);
    const sectionCount = await page.locator('[data-testid="forge-loft-solid-panel"]')
                                    .getAttribute('data-section-count');
    expect(Number(sectionCount)).toBe(4);

    // Bump radius of the 2nd section (the original "neck" at z=30) up
    // to 30 — gives the loft a wider mid-section so the volume change
    // is unambiguous.
    const r1Input = page.locator('[data-testid="forge-loft-solid-radius-1"]');
    await r1Input.fill('30');
    await pause(150);
    await shot('table-modified');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-loft-solid-apply"]');
        btn.click();
    });
    await pause(700);
    await shot('modified-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.volume).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push121Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.sectionCount).toBe(4);
    expect(last.frustumCount).toBe(3);
    expect(last.handle).toBeGreaterThan(0);
    // Two builds should yield distinct handles.
    const handles = new Set(events.map((e) => e.handle));
    expect(handles.size).toBeGreaterThanOrEqual(2);

    // The new volume must differ from the default-preset volume by
    // more than 5 % (otherwise the table change had no effect, which
    // would be a regression).
    const defaultVol = events[0].volume;
    const modVol = last.volume;
    expect(Math.abs(modVol - defaultVol) / defaultVol).toBeGreaterThan(0.05);
});

test('04 — PUSH-102 regression: Loft Sections (SURFACE) still works (close)', async () => {
    // The brief calls the 5th camera "close" — we approximate with the
    // view.iso + view.zoomFit pair so the camera ends up in a distinct,
    // labelled state (same convention PUSH-102 uses).
    await platformMenuAction('view.iso');
    await pause(200);
    await platformMenuAction('view.zoomFit');
    await pause(200);

    // Close the Loft Solid panel first so its right-docked footprint
    // doesn't intercept the Loft Sections tab clicks.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseLoftSolid === 'function') {
            window.__forgeCloseLoftSolid();
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
        if (!btn) throw new Error('loft-sections apply button missing');
        btn.click();
    });
    await pause(700);
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    await shot('loft-sections-applied');

    // The Loft Solid helper API + the Loft Sections helper both
    // outlive each other — proves the two surfaces don't trample
    // each other's window globals.
    const apiBothOk = await page.evaluate(() =>
        typeof window.__forgeLoftSolidHelper?.runLoftSolidPipeline === 'function'
        && typeof window.__forgeLoftSectionsHelper?.runLoftSectionsPipeline === 'function');
    expect(apiBothOk).toBe(true);
});
