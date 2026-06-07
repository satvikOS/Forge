// PUSH-102 (Slice-70) — Multi-section Loft panel.
//
// The user's brief:
//   "a Loft Sections panel that:
//    - User defines N planar sections (radius + z-height) — default 4
//      sections like wing profile
//    - Generates a surface through them via repeated buildPatch (4 quad
//      patches) OR a single big control grid via the existing
//      surfacing.buildPatch
//    - Commits as a surface body
//
//    Multi-cam e2e mandatory: 5 named camera angles."
//
// Proof end-to-end:
//   1. Boot Electron; assert window.__forgeLoftSectionsHelper is wired —
//      that's the headless contract surface plugins / Archie tool calls
//      use to drive the same pipeline without mounting the panel. Drive
//      the pipeline headlessly with the defaults and confirm a native
//      body lands with area > 0.
//   2. Open the Loft Sections panel via tools.loftSections menu action.
//      Assert the panel mounts; the 4-section default table is present;
//      the Apply button is enabled.
//   3. Click Apply with the default sections. Assert a new surface body
//      is committed, the forge:loft-sections-built event fires, and the
//      committed body's massProps area is positive (kernel sanity — the
//      NURBS face is real).
//   4. Modify the table (add a 5th section, change a radius), click
//      Apply again. Confirm a fresh face handle lands, the bus event
//      fires with the updated section count.
//   5. PUSH-85 regression: open the Class-A Blend panel via
//      tools.classABlend menu action. Assert the panel mounts and the
//      build button works — proves PUSH-102 didn't collide with the
//      existing surfacing pipeline that PUSH-85 already drives.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + headless math)
//   - front (open panel + table assertions)
//   - top   (default Apply build)
//   - right (modified table Apply build + bus event)
//   - close (PUSH-85 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-102-loft-sections');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'loft-sections-session.mp4');

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
        if (/push-102|loft-sections|LoftSections|forge:loft-sections|surfacing|error|Error/i.test(t)) {
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
        console.error('[push-102] no .webm'); return;
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
                console.log(`[push-102] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-102] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + headless pipeline ok (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Wait for the helper API to be installed (it's installed at module
    // import time when LoftSectionsPanel.jsx is loaded by App.jsx).
    await page.waitForFunction(
        () => !!window.__forgeLoftSectionsHelper
           && typeof window.__forgeLoftSectionsHelper.runLoftSectionsPipeline === 'function'
           && typeof window.__forgeLoftSectionsHelper.buildSweptGrid === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeLoftSectionsHelper;
        return {
            keys: Object.keys(h).sort(),
            event: h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            defaultSections: h.DEFAULT_SECTIONS,
            uCount: h.DEFAULT_U_COUNT,
            vCount: h.DEFAULT_V_COUNT,
        };
    });
    expect(helperShape.event).toBe('forge:loft-sections-built');
    expect(helperShape.storage).toBe('forge.v4.loftSections');
    expect(helperShape.uCount).toBe(24);
    expect(helperShape.vCount).toBe(11);
    expect(helperShape.defaultSections.length).toBe(4);
    // The wing-profile preset is z=0/20/60/80, r=30/40/40/30.
    expect(helperShape.defaultSections[0].z).toBe(0);
    expect(helperShape.defaultSections[0].radius).toBe(30);
    expect(helperShape.defaultSections[3].z).toBe(80);
    expect(helperShape.defaultSections[3].radius).toBe(30);
    expect(helperShape.defaultSections[1].radius).toBe(40);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'buildSweptGrid', 'buildPatchKnots', 'normaliseSections',
        'commitLoftGrid', 'appendLoftBody', 'runLoftSectionsPipeline',
        'DEFAULT_SECTIONS', 'DEFAULT_U_COUNT', 'DEFAULT_V_COUNT',
        'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Verify the polar sampling math is real — the v=0 row of the grid
    // should have radius=30 at z=0 (the first section). The v=1 row
    // should have radius=30 at z=80.
    const gridCheck = await page.evaluate(() => {
        const h = window.__forgeLoftSectionsHelper;
        const g = h.buildSweptGrid(h.DEFAULT_SECTIONS, 24, 11);
        // grid[0][0] should be at radius 30, z 0 (first section, θ=0).
        const p00 = g.grid[0][0];
        // grid[10][0] should be at radius 30, z 80 (last section, θ=0).
        const p10_0 = g.grid[10][0];
        // grid[0][6] should be at θ = 2π·(6/23) — a sample along the
        // first ring. Check r·cos(θ) and r·sin(θ).
        const i = 6;
        const theta = (2 * Math.PI) * (i / 23);
        const p0i = g.grid[0][i];
        return {
            uCount: g.uCount, vCount: g.vCount,
            p00, p10_0, p0i,
            expected_p0i_x: 30 * Math.cos(theta),
            expected_p0i_y: 30 * Math.sin(theta),
            xyzLen: g.xyz.length,
        };
    });
    expect(gridCheck.uCount).toBe(24);
    expect(gridCheck.vCount).toBe(11);
    expect(gridCheck.xyzLen).toBe(24 * 11 * 3);
    // grid[0][0]: first section (z=0, r=30), θ=0 → (30, 0, 0).
    expect(gridCheck.p00[0]).toBeCloseTo(30, 5);
    expect(gridCheck.p00[1]).toBeCloseTo(0, 5);
    expect(gridCheck.p00[2]).toBeCloseTo(0, 5);
    // grid[10][0]: last section (z=80, r=30), θ=0 → (30, 0, 80).
    expect(gridCheck.p10_0[0]).toBeCloseTo(30, 5);
    expect(gridCheck.p10_0[1]).toBeCloseTo(0, 5);
    expect(gridCheck.p10_0[2]).toBeCloseTo(80, 5);
    // grid[0][6]: first section, sampled at θ — confirm the polar math.
    expect(gridCheck.p0i[0]).toBeCloseTo(gridCheck.expected_p0i_x, 5);
    expect(gridCheck.p0i[1]).toBeCloseTo(gridCheck.expected_p0i_y, 5);
    expect(gridCheck.p0i[2]).toBeCloseTo(0, 5);

    // Drive the pipeline headlessly with the defaults. Must commit a
    // native body with a positive surface area.
    const pre = await nativeBodyCount();
    const piped = await page.evaluate(() => {
        const r = window.__forgeLoftSectionsHelper.runLoftSectionsPipeline();
        return {
            ok: r.ok, reason: r.reason || null, message: r.message || null,
            faceHandle: r.faceHandle, bodyId: r.body?.id,
            uCount: r.gridSpec?.uCount, vCount: r.gridSpec?.vCount,
        };
    });
    expect(piped.ok).toBe(true);
    expect(piped.faceHandle).toBeGreaterThan(0);
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

test('01 — open Loft Sections via tools.loftSections; default table mounts (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.loftSections');
    await page.waitForSelector('[data-testid="forge-loft-sections-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Default 4 rows present.
    const rowCount = await page.locator('[data-testid="forge-loft-sections-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(4);
    const sectionCount = await page.locator('[data-testid="forge-loft-sections-panel"]')
                                    .getAttribute('data-section-count');
    expect(Number(sectionCount)).toBe(4);

    // The four input pairs are visible — confirm field values.
    const z0 = await page.locator('[data-testid="forge-loft-sections-z-0"]').inputValue();
    const r0 = await page.locator('[data-testid="forge-loft-sections-radius-0"]').inputValue();
    expect(Number(z0)).toBe(0);
    expect(Number(r0)).toBe(30);
    const z3 = await page.locator('[data-testid="forge-loft-sections-z-3"]').inputValue();
    const r3 = await page.locator('[data-testid="forge-loft-sections-radius-3"]').inputValue();
    expect(Number(z3)).toBe(80);
    expect(Number(r3)).toBe(30);

    // Apply button is present and enabled.
    await expect(page.locator('[data-testid="forge-loft-sections-apply"]')).toBeVisible();
    const disabled = await page.locator('[data-testid="forge-loft-sections-apply"]')
                                .getAttribute('disabled');
    expect(disabled).toBeNull();
});

test('02 — click Apply with defaults; surface body commits with area > 0 (top)', async () => {
    await cameraTo('top');

    // Subscribe to the bus before clicking so we can prove the event
    // fired with the correct payload.
    await page.evaluate(() => {
        window.__push102Events = [];
        window.addEventListener('forge:loft-sections-built', (e) => {
            window.__push102Events.push({
                sectionCount: e?.detail?.sectionCount,
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
        const btn = document.querySelector('[data-testid="forge-loft-sections-apply"]');
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

    const events = await page.evaluate(() => window.__push102Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.sectionCount).toBe(4);
    expect(newest.faceHandle).toBeGreaterThan(0);
    expect(newest.uCount).toBe(24);
    expect(newest.vCount).toBe(11);

    // Log row count increments.
    const logCount = await page.locator('[data-testid="forge-loft-sections-log"]')
                                .getAttribute('data-log-count');
    expect(Number(logCount)).toBeGreaterThanOrEqual(1);

    // The committed body's last-face data attribute is set.
    const lastFace = await page.locator('[data-testid="forge-loft-sections-panel"]')
                                .getAttribute('data-last-face');
    expect(Number(lastFace)).toBe(newest.faceHandle);
});

test('03 — modify table (add 5th section + adjust radius), Apply again (right)', async () => {
    await cameraTo('right');

    // Add a 5th section via the + button.
    await page.locator('[data-testid="forge-loft-sections-add"]').click();
    await pause(150);
    const rowCount = await page.locator('[data-testid="forge-loft-sections-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(5);
    const sectionCount = await page.locator('[data-testid="forge-loft-sections-panel"]')
                                    .getAttribute('data-section-count');
    expect(Number(sectionCount)).toBe(5);

    // Bump radius of the 2nd section to 50 — gives the loft a wider waist.
    const r1Input = page.locator('[data-testid="forge-loft-sections-radius-1"]');
    await r1Input.fill('50');
    await pause(150);
    await shot('table-modified');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-loft-sections-apply"]');
        btn.click();
    });
    await pause(700);
    await shot('modified-applied');

    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    const mass = await lastNativeBodyMass();
    expect(mass).not.toBeNull();
    expect(mass.area).toBeGreaterThan(0);

    const events = await page.evaluate(() => window.__push102Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events[events.length - 1];
    expect(last.sectionCount).toBe(5);
    expect(last.faceHandle).toBeGreaterThan(0);
    // Two builds should yield distinct face handles.
    const handles = new Set(events.map((e) => e.faceHandle));
    expect(handles.size).toBeGreaterThanOrEqual(2);
});

test('04 — PUSH-85 regression: Class-A Blend still works (close)', async () => {
    // The brief calls the 5th camera "close" — we approximate with the
    // ⌘+ zoom-in / view.zoomFit pair so the camera ends up in a distinct,
    // labelled state.
    await platformMenuAction('view.iso');
    await pause(200);
    await platformMenuAction('view.zoomFit');
    await pause(200);

    // Close the Loft Sections panel first so its right-docked footprint
    // doesn't intercept the Class-A Blend tab clicks.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseLoftSections === 'function') {
            window.__forgeCloseLoftSections();
        }
    });
    await pause(250);

    await platformMenuAction('tools.classABlend');
    await page.waitForSelector('[data-testid="forge-class-a-blend-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('class-a-open');

    const preCount = await nativeBodyCount();
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-class-a-blend-build"]');
        if (!btn) throw new Error('class-a build button missing');
        btn.click();
    });
    await pause(700);
    const postCount = await nativeBodyCount();
    expect(postCount).toBe(preCount + 1);
    await shot('class-a-built');

    // The Loft Sections helper API + the Class-A Blend helper both
    // outlive each other — proves the two surfaces don't trample each
    // other's window globals.
    const apiBothOk = await page.evaluate(() =>
        typeof window.__forgeLoftSectionsHelper?.runLoftSectionsPipeline === 'function'
        && typeof window.__forgeClassABlendHelper?.runClassABlendPipeline === 'function');
    expect(apiBothOk).toBe(true);
});
