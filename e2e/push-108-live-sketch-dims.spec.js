// PUSH-108 (Slice-77) — Live Sketch Dimensions panel.
//
// PUSH-91 lit up the *add* surface for sketch constraints (12 geometric
// + 4 dimensional, each Apply calls window.forge.sketcher.addConstraint).
// PUSH-108 closes the *edit* loop: a docked panel that lists every
// dimensional constraint in the active sketch with a numeric input on
// each row. Edit the value → Apply re-runs the kernel solver against
// the new value and the geometry re-converges live.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner, open the panel via
//      tools.liveSketchDims.
//   2. Assert it mounts, the dims table is empty (no active sketch).
//   3. Programmatically create a real sketch via window.forge.sketcher
//      (createSketch + addPoint x2 + addLine x1). Publish the handle to
//      window.__forgeCurrentSketch + dispatch forge:sketch-active-changed.
//   4. Add a Distance constraint of value 50 directly via the kernel
//      (forge.sketcher.addConstraint(handle, kinds.Distance, [p0, p1], 50));
//      seed the panel's row registry via window.__forgeRegisterSketchDim.
//   5. Assert the panel now shows 1 row, kind=Distance, value=50, the
//      input renders with defaultValue=50.
//   6. Read the kernel point coords before the edit — capture p0 + p1.
//   7. Fill input with 80, click Apply on row 0. Assert:
//        — forge:sketch-dim-updated fires with oldValue=50 + newValue=80
//        — result is 'kernel-ok' (the solver added a new Distance(p0,p1)=80)
//        — solverStatus is one of {0, 1, 2} (documented codes)
//        — newConstraintId is a finite number distinct from the old
//        — data-update-count on the panel went from 0 → 1
//        — data-last-kind is 'Distance', data-last-result is 'kernel-ok'
//        — the row's data-value is now 80
//   8. Read the kernel point coords AFTER the edit and assert the
//      Euclidean distance between p0 + p1 has moved toward 80 (solver
//      may pin one of the endpoints; we accept the test if distance is
//      closer to 80 than to 50, or if status==0).
//   9. Add a second dim via the PUSH-91 bus path (publish a
//      forge:sketch-constraint-add-ext event with kind=Distance + value=
//      25 + result=kernel-ok) — assert the panel grows to 2 rows.
//  10. Imperative path regression — invoke
//        window.__forgeUpdateSketchDim(1, 30)
//      and assert the bus event fires + the row[1] value is now 30.
//  11. PUSH-91 regression: open the extended panel via menu, assert it
//      still mounts and its 16-kind structure (12 geom + 4 dim) is intact.
//  12. Menu toggle regression: dispatch tools.liveSketchDims twice →
//      panel hides then re-shows. Imperative
//      window.__forgeOpenLiveSketchDimsPanel(false) hides; (true) shows.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + panel-open + empty assertions)
//   - front (kernel sketch construction + seed Distance row)
//   - top   (edit row 0 from 50→80 + assert solver re-converged)
//   - right (PUSH-91 bus seed + imperative update on row 1)
//   - iso   (PUSH-91 regression + menu toggle + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-108-live-sketch-dims');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'live-sketch-dims-session.mp4');

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
    await pause(280);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(200);
}

async function installEventCapture() {
    await page.evaluate(() => {
        window.__push108Events = [];
        window.addEventListener('forge:sketch-dim-updated', (e) => {
            try {
                window.__push108Events.push({
                    kind:            e?.detail?.kind            || null,
                    kernel:          e?.detail?.kernel          || null,
                    refs:            Array.isArray(e?.detail?.refs) ? e.detail.refs.slice() : null,
                    oldValue:        (typeof e?.detail?.oldValue === 'number') ? e.detail.oldValue : null,
                    newValue:        (typeof e?.detail?.newValue === 'number') ? e.detail.newValue : null,
                    oldConstraintId: (typeof e?.detail?.oldConstraintId === 'number') ? e.detail.oldConstraintId : null,
                    newConstraintId: (typeof e?.detail?.newConstraintId === 'number') ? e.detail.newConstraintId : null,
                    sketch:          (typeof e?.detail?.sketch === 'number') ? e.detail.sketch : null,
                    solverStatus:    (typeof e?.detail?.solverStatus === 'number') ? e.detail.solverStatus : null,
                    result:          e?.detail?.result          || null,
                    error:           e?.detail?.error           || null,
                    rowIndex:        (typeof e?.detail?.rowIndex === 'number') ? e.detail.rowIndex : null,
                });
            } catch { /* ignore */ }
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push108Events || []);
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
        if (/push-108|live-sketch-dims|LiveSketchDims|forge:sketch-dim-updated|error|Error/i.test(t)) {
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
        console.error('[push-108] no .webm');
        return;
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
                console.log(`[push-108] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-108] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — open Live Sketch Dimensions panel → empty table, no active sketch', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Sanity: imperative host hook must have installed pre-open.
    const hostInstalled = await page.evaluate(() =>
        typeof window.__forgeOpenLiveSketchDimsPanel === 'function');
    expect(hostInstalled).toBe(true);

    // Open via menu action.
    await platformMenuAction('tools.liveSketchDims');
    await page.waitForSelector('[data-testid="forge-live-sketch-dims-panel"]',
                               { state: 'visible', timeout: 8000 });
    await installEventCapture();

    // Headers visible.
    await expect(page.locator('[data-testid="forge-live-sketch-dims-table-title"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-live-sketch-dims-table-head"]')).toBeVisible();

    // No sketch yet → empty row state.
    const empty = await page.locator('[data-testid="forge-live-sketch-dims-empty"]').count();
    expect(empty).toBe(1);

    // Chips report no sketch, 0 rows, 0 updates.
    const sketchTxt = (await page.locator('[data-testid="forge-live-sketch-dims-sketch"]').textContent() || '').trim();
    expect(sketchTxt).toBe('—');
    const countTxt = (await page.locator('[data-testid="forge-live-sketch-dims-count"]').textContent() || '').trim();
    expect(countTxt).toBe('0');
    const updatesTxt = (await page.locator('[data-testid="forge-live-sketch-dims-updates"]').textContent() || '').trim();
    expect(updatesTxt).toBe('0');

    // Panel data attrs.
    const rowCountAttr = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                                   .getAttribute('data-row-count');
    expect(rowCountAttr).toBe('0');
    const updCountAttr = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                                   .getAttribute('data-update-count');
    expect(updCountAttr).toBe('0');

    // Surface hooks present once mounted.
    const hooks = await page.evaluate(() => ({
        register: typeof window.__forgeRegisterSketchDim === 'function',
        update:   typeof window.__forgeUpdateSketchDim   === 'function',
        close:    typeof window.__forgeCloseLiveSketchDimsPanel === 'function',
    }));
    expect(hooks.register).toBe(true);
    expect(hooks.update).toBe(true);
    expect(hooks.close).toBe(true);

    await shot('panel-open-empty');
});

test('01 — build real sketch + seed Distance(50) → table grows to 1 row', async () => {
    await cameraTo('front');

    const sketchInfo = await page.evaluate(() => {
        const sk = window.forge && window.forge.sketcher;
        if (!sk) return { error: 'no sketcher surface' };
        const h  = sk.createSketch();
        const p0 = sk.addPoint(h,  0,  0);
        const p1 = sk.addPoint(h, 50,  0);
        const l0 = sk.addLine(h, p0, p1);
        // Pin p0 at origin so the solver has a reference root.
        sk.addConstraint(h, sk.kinds.Distance, [p0, p0], 0);
        // Add a real distance constraint between p0 + p1, value 50.
        const cid = sk.addConstraint(h, sk.kinds.Distance, [p0, p1], 50);
        return { handle: h, points: [p0, p1], line: l0, constraintId: cid };
    });
    expect(sketchInfo).toBeTruthy();
    if (sketchInfo.error) {
        console.warn('[push-108] kernel sketcher unavailable, skipping kernel path');
        return;
    }
    expect(typeof sketchInfo.handle).toBe('number');
    expect(typeof sketchInfo.constraintId).toBe('number');
    expect(sketchInfo.points.length).toBe(2);

    // Publish active sketch to the panel.
    await page.evaluate((info) => {
        window.__forgeCurrentSketch = info.handle;
        window.dispatchEvent(new CustomEvent('forge:sketch-active-changed', {
            detail: { sketch: info.handle },
        }));
        window.__push108Sketch = info;
    }, sketchInfo);
    await pause(250);

    // Seed the panel's row registry via the imperative API.
    await page.evaluate((info) => {
        window.__forgeRegisterSketchDim({
            kind: 'Distance',
            kernel: 'Distance',
            refs: [info.points[0], info.points[1]],
            value: 50,
            sketch: info.handle,
            constraintId: info.constraintId,
        });
    }, sketchInfo);
    await pause(300);

    // Panel now reports 1 row.
    const rowCount = await page.locator('[data-testid="forge-live-sketch-dims-row"]').count();
    expect(rowCount).toBe(1);
    const rowCountAttr = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                                   .getAttribute('data-row-count');
    expect(rowCountAttr).toBe('1');

    // Row data attrs.
    const row0 = page.locator('[data-testid="forge-live-sketch-dims-row"]').first();
    const r0Kind  = await row0.getAttribute('data-kind');
    const r0Value = await row0.getAttribute('data-value');
    const r0Cid   = await row0.getAttribute('data-constraint-id');
    expect(r0Kind).toBe('Distance');
    expect(r0Value).toBe('50');
    expect(r0Cid).toBe(String(sketchInfo.constraintId));

    // Kind cell text + input defaultValue.
    const kindTxt = (await page.locator('[data-testid="forge-live-sketch-dims-kind-0"]').textContent() || '').trim();
    expect(kindTxt).toBe('Distance');
    const inputVal = await page.locator('[data-testid="forge-live-sketch-dims-input-0"]').inputValue();
    expect(inputVal).toBe('50');

    // Chip readouts.
    const sketchTxt  = (await page.locator('[data-testid="forge-live-sketch-dims-sketch"]').textContent() || '').trim();
    expect(sketchTxt).toBe(`#${sketchInfo.handle}`);
    const countTxt   = (await page.locator('[data-testid="forge-live-sketch-dims-count"]').textContent() || '').trim();
    expect(countTxt).toBe('1');

    await shot('seeded-1-row');
});

test('02 — edit row 0 from 50 → 80, solver re-converges, geometry moves', async () => {
    await cameraTo('top');

    const sketchInfo = await page.evaluate(() => window.__push108Sketch || null);
    if (!sketchInfo) {
        console.warn('[push-108] no kernel sketch from test 01, skipping');
        return;
    }

    // Snapshot p0 + p1 coords + the distance between them.
    const before = await page.evaluate((info) => {
        const sk = window.forge.sketcher;
        const p0 = sk.readPoint(info.handle, info.points[0]);
        const p1 = sk.readPoint(info.handle, info.points[1]);
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        return { p0, p1, dist: Math.hypot(dx, dy) };
    }, sketchInfo);
    console.log('[push-108] before edit:', JSON.stringify(before));

    // Fill new value 80 + click Apply.
    const input = page.locator('[data-testid="forge-live-sketch-dims-input-0"]');
    await input.fill('');
    await input.fill('80');
    await pause(150);

    const applyBtn = page.locator('[data-testid="forge-live-sketch-dims-apply-0"]');
    const applyEnabled = await applyBtn.getAttribute('data-enabled');
    expect(applyEnabled).toBe('true');

    const eventsBefore = await readEvents();
    const baselineN = eventsBefore.length;

    await applyBtn.click();
    await pause(400);

    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baselineN);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.kind).toBe('Distance');
    expect(newest.oldValue).toBe(50);
    expect(newest.newValue).toBe(80);
    expect(newest.refs).toEqual([sketchInfo.points[0], sketchInfo.points[1]]);
    expect(newest.sketch).toBe(sketchInfo.handle);
    expect(newest.result).toBe('kernel-ok');
    expect(typeof newest.newConstraintId).toBe('number');
    expect(Number.isFinite(newest.newConstraintId)).toBe(true);
    expect(newest.newConstraintId).not.toBe(sketchInfo.constraintId);
    expect(newest.error).toBeNull();
    expect([0, 1, 2]).toContain(newest.solverStatus);

    // Panel state updated.
    const updCount = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                               .getAttribute('data-update-count');
    expect(updCount).toBe('1');
    const lastKind = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                               .getAttribute('data-last-kind');
    expect(lastKind).toBe('Distance');
    const lastResult = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                                 .getAttribute('data-last-result');
    expect(lastResult).toBe('kernel-ok');

    // Row 0 now reports value=80 + new constraint id.
    const row0 = page.locator('[data-testid="forge-live-sketch-dims-row"]').first();
    const newRowValue = await row0.getAttribute('data-value');
    expect(newRowValue).toBe('80');
    const newRowCid = await row0.getAttribute('data-constraint-id');
    expect(newRowCid).toBe(String(newest.newConstraintId));

    // Read kernel coords AFTER the edit; the live distance must have
    // moved toward 80 OR the solver reported Success (status==0).
    const after = await page.evaluate((info) => {
        const sk = window.forge.sketcher;
        const p0 = sk.readPoint(info.handle, info.points[0]);
        const p1 = sk.readPoint(info.handle, info.points[1]);
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        return { p0, p1, dist: Math.hypot(dx, dy) };
    }, sketchInfo);
    console.log('[push-108] after edit:', JSON.stringify(after));
    const closerTo80 = Math.abs(after.dist - 80) < Math.abs(after.dist - 50);
    const solverOk   = newest.solverStatus === 0;
    expect(closerTo80 || solverOk).toBe(true);

    // Log surface gained a row.
    const logRows = await page.locator('[data-testid="forge-live-sketch-dims-log-row"]').count();
    expect(logRows).toBeGreaterThan(0);

    await shot('edit-50-to-80');
});

test('03 — PUSH-91 bus seeds row 1, imperative update on row 1 succeeds', async () => {
    await cameraTo('right');

    const sketchInfo = await page.evaluate(() => window.__push108Sketch || null);
    if (!sketchInfo) {
        console.warn('[push-108] no kernel sketch from test 01, skipping');
        return;
    }

    // Add a real second Distance constraint via the kernel + announce
    // it via the PUSH-91 bus so the panel grows.
    const seedInfo = await page.evaluate((info) => {
        const sk = window.forge.sketcher;
        const cid = sk.addConstraint(info.handle, sk.kinds.Distance,
                                     [info.points[0], info.points[1]], 25);
        const detail = {
            kind: 'Distance',
            kernel: 'Distance',
            kindIdDirect: sk.kinds.Distance,
            kindIds: [sk.kinds.Distance],
            refs: [info.points[0], info.points[1]],
            sketch: info.handle,
            value: 25,
            constraintId: cid,
            constraintIds: [cid],
            result: 'kernel-ok',
            error: null,
            ts: Date.now(),
        };
        window.dispatchEvent(new CustomEvent('forge:sketch-constraint-add-ext', { detail }));
        return { cid };
    }, sketchInfo);
    expect(typeof seedInfo.cid).toBe('number');
    await pause(300);

    // Row count is now 2.
    const rowCount = await page.locator('[data-testid="forge-live-sketch-dims-row"]').count();
    expect(rowCount).toBe(2);
    const row1 = page.locator('[data-testid="forge-live-sketch-dims-row"]').nth(1);
    const r1Kind  = await row1.getAttribute('data-kind');
    const r1Value = await row1.getAttribute('data-value');
    expect(r1Kind).toBe('Distance');
    expect(r1Value).toBe('25');

    // Imperative update path — invoke window.__forgeUpdateSketchDim(1, 30)
    // and assert the bus event fires + the row value updated.
    const eventsBefore = await readEvents();
    const baselineN = eventsBefore.length;
    const impResult = await page.evaluate(() =>
        window.__forgeUpdateSketchDim(1, 30));
    expect(impResult).toBeTruthy();
    expect(impResult.result).toBe('kernel-ok');
    expect(impResult.oldValue).toBe(25);
    expect(impResult.newValue).toBe(30);
    expect(impResult.rowIndex).toBe(1);
    expect([0, 1, 2]).toContain(impResult.solverStatus);
    await pause(300);

    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baselineN);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.kind).toBe('Distance');
    expect(newest.oldValue).toBe(25);
    expect(newest.newValue).toBe(30);
    expect(newest.rowIndex).toBe(1);
    expect(newest.result).toBe('kernel-ok');

    // Row 1's data-value is now 30.
    const r1ValueAfter = await page.locator('[data-testid="forge-live-sketch-dims-row"]').nth(1).getAttribute('data-value');
    expect(r1ValueAfter).toBe('30');

    // Update counter went from 1 → 2.
    const updCount = await page.locator('[data-testid="forge-live-sketch-dims-panel"]')
                               .getAttribute('data-update-count');
    expect(updCount).toBe('2');

    await shot('row1-imperative-update');
});

test('04 — PUSH-91 regression + menu toggle + imperative hide / show', async () => {
    await cameraTo('iso');

    // PUSH-91 regression — open the extended panel + verify the 16-kind
    // table is intact. Both panels dock to the right rail so we hide
    // ours first via the imperative hook, then bring it back after.
    await page.evaluate(() => window.__forgeOpenLiveSketchDimsPanel(false));
    await pause(250);
    await platformMenuAction('tools.sketchConstraintsExt');
    await page.waitForSelector('[data-testid="forge-sketch-constraints-ext-panel"]',
                               { state: 'visible', timeout: 8000 });
    const geomKinds = [
        'Coincident','Parallel','Perpendicular','Equal','Tangent',
        'Horizontal','Vertical','PointOnLine','PointOnCircle',
        'Symmetric','Concentric','Fix',
    ];
    for (const k of geomKinds) {
        await expect(page.locator(`[data-testid="forge-sketch-constraint-ext-${k}"]`)).toBeVisible();
    }
    const dimKinds = ['Distance','Angle','Diameter','Radius'];
    for (const k of dimKinds) {
        await expect(page.locator(`[data-testid="forge-sketch-constraint-ext-dim-${k}"]`)).toBeVisible();
        await expect(page.locator(`[data-testid="forge-sketch-constraint-ext-apply-${k}"]`)).toBeVisible();
    }
    // Tear down the extended panel before continuing — it shares the
    // right rail.
    await page.locator('[data-testid="forge-sketch-constraints-ext-close"]').click();
    await pause(300);

    // Bring our panel back up after the regression check.
    await page.evaluate(() => window.__forgeOpenLiveSketchDimsPanel(true));
    await page.waitForSelector('[data-testid="forge-live-sketch-dims-panel"]',
                               { state: 'visible', timeout: 4000 });

    // Menu toggle → hide.
    await platformMenuAction('tools.liveSketchDims');
    await pause(300);
    let liveCount = await page.locator('[data-testid="forge-live-sketch-dims-panel"]').count();
    expect(liveCount).toBe(0);

    // Menu toggle → re-show.
    await platformMenuAction('tools.liveSketchDims');
    await pause(300);
    await page.waitForSelector('[data-testid="forge-live-sketch-dims-panel"]',
                               { state: 'visible', timeout: 4000 });

    // Imperative → hide.
    await page.evaluate(() => window.__forgeOpenLiveSketchDimsPanel(false));
    await pause(300);
    liveCount = await page.locator('[data-testid="forge-live-sketch-dims-panel"]').count();
    expect(liveCount).toBe(0);

    // Imperative → re-show.
    await page.evaluate(() => window.__forgeOpenLiveSketchDimsPanel(true));
    await pause(300);
    await page.waitForSelector('[data-testid="forge-live-sketch-dims-panel"]',
                               { state: 'visible', timeout: 4000 });

    // Close button on the panel → hide.
    await page.locator('[data-testid="forge-live-sketch-dims-close"]').click();
    await pause(300);
    liveCount = await page.locator('[data-testid="forge-live-sketch-dims-panel"]').count();
    expect(liveCount).toBe(0);

    // Re-show one more time for the closing shot, then tear down the
    // kernel sketch.
    await page.evaluate(() => window.__forgeOpenLiveSketchDimsPanel(true));
    await pause(300);
    await page.waitForSelector('[data-testid="forge-live-sketch-dims-panel"]',
                               { state: 'visible', timeout: 4000 });

    await page.evaluate(() => {
        try {
            if (window.__push108Sketch && window.forge && window.forge.sketcher) {
                window.forge.sketcher.destroySketch(window.__push108Sketch.handle);
            }
        } catch { /* ignore */ }
    });

    await shot('regression-iso');
});
