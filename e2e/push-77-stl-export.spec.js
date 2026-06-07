// PUSH-77 (Slice-45 / Multi-body STL export panel).
//
// Up through PUSH-76 the only path to STL was File → Export STL… which
// dumps a single hard-wired "last native body" through forge.io.exportStl
// (ForgeShellV4 file.exportStl case at line 557). There was no way for a
// user to *see every body at once*, *select which to include*, or *pick
// between one combined .stl vs one .stl per body*.
//
// PUSH-77 ships that surface: a right-docked panel
// (StlExportPanel.jsx → StlExportPanelHost) reachable via the
// tools.stlExport menu action; row-per-native-body checkboxes; a radio
// pair "Combined" / "One per body"; a single Export button. Combined
// mode writes one multi-solid ASCII .stl that carries every selected
// body in a single file; Per-body mode writes a sibling .stl per
// selected handle.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Seed 2 native OCCT boxes (10×10×10 at origin, 20×20×20 at +30 X)
//      so each box has a distinct kernel handle and a measurable
//      ASCII-STL footprint.
//   3. Override io:saveDialog to return a deterministic /tmp path so the
//      test runs unattended.
//   4. Open STL Export via `tools.stlExport`. Panel mounts, lists both
//      bodies. Override count chip "2/2" (both default-selected).
//   5. Click Export · combined. Assert:
//        • A real file lands at /tmp/push77.stl,
//        • size > 100 bytes,
//        • contains the "solid" ASCII header,
//        • contains exactly 2 "solid …" blocks (one per body),
//        • contains the "facet normal" tri-list grammar,
//        • window.__forgeLastStlExport carries the right metadata,
//        • a forge:stl-export-complete bus event fired.
//   6. Switch the mode to "One per body" + Export — assert 2 separate
//      .stl files land on disk and the metadata reflects that.
//   7. PUSH-58 regression: the Mass Properties panel still mounts +
//      reads volume/area off the same handles after the STL panel
//      writes — proves the panel didn't corrupt the kernel state or
//      stomp the menu-action bus.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel, list bodies, defaults)
//   - top   (Export combined → /tmp/push77.stl)
//   - right (switch to per-body + Export)
//   - iso   (PUSH-58 mass properties regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-77-stl-export');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'stl-export-session.mp4');

// Deterministic save targets so the test runs unattended even though
// the Save dialog is a native modal. The IPC override below returns
// these every time the renderer calls forge.dialog.saveFile.
const STL_COMBINED   = path.join(os.tmpdir(), 'push77.stl');
const STL_PERBODY_BASE = path.join(os.tmpdir(), 'push77-perbody.stl');

let app, page;
let stepIndex = 0;
let handle1 = null;
let handle2 = null;
// Tracks which save destination the next dialog call should return.
// The test toggles this between exports so the IPC override knows which
// path to hand back without needing per-call wiring.
let dialogNextPath = STL_COMBINED;

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
    await pause(300);
}

async function installEventCapture() {
    await page.evaluate(() => {
        window.__push77Events = [];
        window.addEventListener('forge:stl-export-complete', (e) => {
            try {
                window.__push77Events.push({
                    mode: e?.detail?.mode || null,
                    bodyCount: e?.detail?.bodyCount || 0,
                    pathCount: (e?.detail?.paths || []).length,
                });
            } catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push77Events || []);
}

// Snapshot the panel's last-export metadata (the panel publishes
// window.__forgeLastStlExport after every successful run).
async function readLastExport() {
    return await page.evaluate(() => {
        const last = window.__forgeLastStlExport;
        if (!last) return null;
        return {
            mode: last.mode || null,
            bodyCount: last.bodyCount || 0,
            paths: Array.isArray(last.paths) ? [...last.paths] : [],
            bytes: typeof last.bytes === 'number' ? last.bytes : null,
        };
    });
}

test.beforeAll(async () => {
    // Clean stale test artefacts so the size assertions reflect THIS run.
    try { fs.unlinkSync(STL_COMBINED); } catch {}
    // Per-body files are derived names like push77-perbody-01-h<handle>.stl
    // — clean the directory pattern up front.
    try {
        for (const f of fs.readdirSync(os.tmpdir())) {
            if (/^push77-perbody-.*\.stl$/.test(f)) {
                try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
            }
            if (/^push77-tmp-.*\.stl$/.test(f)) {
                try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
            }
            // The combined run also writes per-body tmp blocks
            // alongside the chosen path. Clean those too — they have
            // the stem of the combined path: "push77-tmp-<n>-h<handle>.stl".
            if (/^push77-tmp-/.test(f)) {
                try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch {}
            }
        }
    } catch {}

    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-77|stl-export|StlExport|forge|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour intercepts pointer events on every panel
    // button. Mark it seen and dismiss any racing skip button.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    await pause(800);

    // Override io:saveDialog so the native modal never blocks the test.
    // The override returns whatever `dialogNextPath` the test has set,
    // so we can swap between Combined and Per-body targets between
    // exports. We also stash the latest captured path on a global so
    // the test can verify the renderer actually called saveDialog.
    await app.evaluate(async ({ ipcMain }, paths) => {
        globalThis.__push77Dialog = {
            combined: paths.combined,
            perBody: paths.perBody,
            mode: 'combined',
            calls: 0,
            lastResult: null,
        };
        ipcMain.removeHandler('io:saveDialog');
        ipcMain.handle('io:saveDialog', async () => {
            const d = globalThis.__push77Dialog;
            d.calls += 1;
            d.lastResult = d.mode === 'perBody' ? d.perBody : d.combined;
            return d.lastResult;
        });
    }, { combined: STL_COMBINED, perBody: STL_PERBODY_BASE });
});

async function setDialogMode(mode) {
    await app.evaluate(async (_ev, m) => {
        if (globalThis.__push77Dialog) globalThis.__push77Dialog.mode = m;
    }, mode);
}
async function readDialogCalls() {
    return await app.evaluate(async () => globalThis.__push77Dialog?.calls || 0);
}

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
        console.error('[push-77] no .webm'); return;
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
                console.log(`[push-77] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-77] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed 2 native boxes (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const h1 = f.makeBox(10, 10, 10);
        const h2raw = f.makeBox(20, 20, 20);
        const h2 = f.translate(h2raw, 30, 0, 0);
        if (typeof h1 !== 'number' || typeof h2 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-77-1', kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Box 1 (10)',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: 'f-box-77-2', kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Box 2 (20 @ +30 X)',
            params: { width: 20, height: 20, distance: 20 },
        });
        return { h1, h2 };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    handle1 = seeded.h1;
    handle2 = seeded.h2;
    console.log('[push-77] seeded handles =', handle1, handle2);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');

    // Bridges sanity — every assertion below assumes both surfaces
    // round-trip through preload. Surface them in the log so a CI
    // failure points at the missing bridge instead of a misleading
    // file-size assert later.
    const bridges = await page.evaluate(() => ({
        hasIo:        !!(window.forge && window.forge.io),
        hasExportStl: !!(window.forge && window.forge.io && typeof window.forge.io.exportStl === 'function'),
        hasSaveFile:  !!(window.forge && window.forge.dialog && typeof window.forge.dialog.saveFile === 'function'),
        hasWriteBlob: !!(window.forge && window.forge.dialog && typeof window.forge.dialog.writeBlob === 'function'),
    }));
    console.log('[push-77] bridges =', JSON.stringify(bridges));
    expect(bridges.hasExportStl).toBe(true);
    expect(bridges.hasSaveFile).toBe(true);
    expect(bridges.hasWriteBlob).toBe(true);
});

test('01 — open STL Export via tools.stlExport, lists both bodies (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.stlExport');
    await page.waitForSelector('[data-testid="forge-stl-export-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Both body rows visible.
    await expect(page.locator(`[data-testid="forge-stl-export-check-${handle1}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="forge-stl-export-check-${handle2}"]`)).toBeVisible();

    // Override count chip says "2/2" — both bodies default-selected.
    const countChip = await page.locator('[data-testid="forge-stl-export-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('2/2');

    // Panel data attribute reflects 2 bodies + 2 selected + combined mode.
    const panel = page.locator('[data-testid="forge-stl-export-panel"]');
    expect(await panel.getAttribute('data-body-count')).toBe('2');
    expect(await panel.getAttribute('data-selected-count')).toBe('2');
    expect(await panel.getAttribute('data-mode')).toBe('combined');

    // The Combined radio is checked by default.
    const combinedChecked = await page.locator('[data-testid="forge-stl-export-mode-combined"]')
                                       .isChecked();
    expect(combinedChecked).toBe(true);

    // Install the event capture before the first mutation.
    await installEventCapture();
});

test('02 — Export · combined → /tmp/push77.stl written + multi-solid ASCII (top)', async () => {
    await cameraTo('top');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;
    const callsBefore = await readDialogCalls();

    // Make sure the IPC override returns the combined path on the next
    // saveDialog call — even though it's the default, set it explicitly
    // so re-runs of the spec start clean.
    await setDialogMode('combined');

    // Click the primary Export button.
    await page.locator('[data-testid="forge-stl-export-go"]').click();
    // The panel sets data-busy="true" while writing — wait for the
    // export to flip back to idle before asserting the file exists.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-stl-export-go"]');
        return el && el.getAttribute('data-export-state') === 'idle';
    }, null, { timeout: 30000 });
    await pause(400);
    await shot('combined-exported');

    // saveDialog was called exactly once during this export.
    const callsAfter = await readDialogCalls();
    expect(callsAfter).toBe(callsBefore + 1);

    // The combined STL landed on disk.
    expect(fs.existsSync(STL_COMBINED)).toBe(true);
    const stat = fs.statSync(STL_COMBINED);
    console.log('[push-77] combined STL size =', stat.size);
    expect(stat.size).toBeGreaterThan(100);

    // It carries the ASCII "solid" header and the canonical facet/loop
    // grammar — two "solid …" blocks, one per body.
    const txt = fs.readFileSync(STL_COMBINED, 'utf8');
    expect(txt).toMatch(/^solid\s/);
    expect(txt).toContain('facet normal');
    expect(txt).toContain('outer loop');
    expect(txt).toContain('vertex');
    const solidStarts = (txt.match(/^solid\s/gm) || []).length;
    const solidEnds = (txt.match(/^endsolid\b/gm) || []).length;
    console.log('[push-77] combined solid blocks =', solidStarts, '/ endsolid =', solidEnds);
    expect(solidStarts).toBe(2);
    expect(solidEnds).toBe(2);

    // The window mirror carries the right summary.
    const last = await readLastExport();
    expect(last).not.toBeNull();
    expect(last.mode).toBe('combined');
    expect(last.bodyCount).toBe(2);
    expect(last.paths).toEqual([STL_COMBINED]);
    expect(last.bytes).toBe(stat.size);

    // The forge:stl-export-complete bus event fired with the right shape.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.mode).toBe('combined');
    expect(newest.bodyCount).toBe(2);
    expect(newest.pathCount).toBe(1);

    // The note row reflects success.
    const note = page.locator('[data-testid="forge-stl-export-note"]');
    await expect(note).toBeVisible();
    expect(await note.getAttribute('data-note-kind')).toBe('ok');
});

test('03 — switch to "One per body" + Export → 2 sibling files written (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;
    const callsBefore = await readDialogCalls();

    // Flip the IPC override target to the per-body base path before
    // clicking the mode radio + Export.
    await setDialogMode('perBody');

    // Switch the panel radio to per-body.
    await page.locator('[data-testid="forge-stl-export-mode-perbody"]').check();
    await pause(200);
    expect(await page.locator('[data-testid="forge-stl-export-panel"]')
                       .getAttribute('data-mode')).toBe('perBody');

    // Click Export.
    await page.locator('[data-testid="forge-stl-export-go"]').click();
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-stl-export-go"]');
        return el && el.getAttribute('data-export-state') === 'idle';
    }, null, { timeout: 30000 });
    await pause(400);
    await shot('perbody-exported');

    // saveDialog was called exactly once during this export — the per-body
    // mode still asks for a single base path, not one per body.
    const callsAfter = await readDialogCalls();
    expect(callsAfter).toBe(callsBefore + 1);

    // The window mirror carries the right summary.
    const last = await readLastExport();
    expect(last).not.toBeNull();
    expect(last.mode).toBe('perBody');
    expect(last.bodyCount).toBe(2);
    expect(last.paths.length).toBe(2);
    // Each path lives next to the chosen base path.
    for (const p of last.paths) {
        expect(p.startsWith(os.tmpdir())).toBe(true);
        expect(p.endsWith('.stl')).toBe(true);
        expect(fs.existsSync(p)).toBe(true);
        const stat = fs.statSync(p);
        console.log('[push-77] per-body STL', p, '·', stat.size, 'B');
        expect(stat.size).toBeGreaterThan(100);
        const head = fs.readFileSync(p, 'utf8').slice(0, 512);
        expect(head).toMatch(/^solid\s/);
        expect(head).toContain('facet normal');
    }
    // The two paths reference distinct handles.
    expect(last.paths[0]).not.toBe(last.paths[1]);
    expect(last.paths[0]).toContain(`h${handle1}`);
    expect(last.paths[1]).toContain(`h${handle2}`);

    // The forge:stl-export-complete bus event fired with the per-body shape.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.mode).toBe('perBody');
    expect(newest.bodyCount).toBe(2);
    expect(newest.pathCount).toBe(2);
});

test('04 — PUSH-58 regression: Mass Properties panel still reads volume/area (iso)', async () => {
    await cameraTo('iso');

    // Close the STL panel so we have a clean right-rail.
    const closeBtn = page.locator('[data-testid="forge-stl-export-close"]');
    if (await closeBtn.count() > 0) {
        await closeBtn.click({ timeout: 3000 }).catch(() => {});
        await pause(300);
    }

    // Open MassProps for body 1 (10×10×10 = 1000 mm³, area 600 mm²).
    // The panel sources the active body off window.__forgeSelection,
    // then falls back to the last native body — set the selection
    // explicitly so the readouts target handle1 not handle2.
    await page.evaluate((h) => {
        window.__forgeSelection = { bodyHandle: h };
    }, handle1);
    await pause(150);
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('massprops-after-stl');

    // Volume = 10 * 10 * 10 = 1000 mm³.
    const volTxt = await page.locator('[data-testid="forge-massprops-volume"]').textContent();
    const vol = Number(/(-?[0-9]+\.[0-9]+)/.exec(volTxt || '')?.[1]);
    console.log('[push-77] massprops volume =', volTxt, '→', vol);
    expect(Math.abs(vol - 1000)).toBeLessThan(1);

    // Surface area = 6 * 10 * 10 = 600 mm².
    const areaTxt = await page.locator('[data-testid="forge-massprops-area"]').textContent();
    const area = Number(/(-?[0-9]+\.[0-9]+)/.exec(areaTxt || '')?.[1]);
    console.log('[push-77] massprops area =', areaTxt, '→', area);
    expect(Math.abs(area - 600)).toBeLessThan(1);

    // The STL-export panel can be re-opened after MassProps without
    // colliding on the menu-action bus.
    await platformMenuAction('tools.stlExport');
    await page.waitForSelector('[data-testid="forge-stl-export-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('stl-panel-reopen');
    await expect(page.locator('[data-testid="forge-stl-export-count"]')).toBeVisible();
});
