// PUSH-67 (Slice-35 / Measure tool — point-to-point distance, dx/dy/dz,
// and 3-point angle, driven by window.__forgeSelection events).
//
// The kernel has always shipped per-body / per-face / per-edge point
// readouts (massProps.centerOfMass, inferFeature.centroid, edgeSegments
// polylines), but the only "measure" surface in the menubar was the
// `tools.measure` action, which under the hood just showed a single
// mass-props toast. There was no way to pick two arbitrary points in
// the scene and read the straight-line distance between them — the
// bread-and-butter of inspection.
//
// PUSH-67 lights that up. A small floating panel opens on
// `tools.measure`, exposes two slot buttons (Point A / Point B), and a
// 3-point angle mode toggle. When a slot is armed, the next
// `forge:selection-changed` event resolves to a world-space point
// (face centroid / edge midpoint / body COM) and fills the slot. The
// panel shows the distance |B-A|, dx / dy / dz, and (in angle mode)
// the 3-point angle at the vertex.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Seed two real OCCT 40×40×40 boxes — box B is translated +100 mm
//      along +X. So the body COMs are at (20, 20, 20) and (120, 20, 20)
//      respectively, distance = 100 mm exactly, dx = 100, dy = 0, dz = 0.
//   3. Open Measure via the `tools.measure` menu action. The panel
//      mounts on screen.
//   4. Arm Slot A (click Set Point A), set selection to body A, fire
//      `forge:selection-changed` → slot A populates with body A COM.
//   5. Arm Slot B, set selection to body B → slot B populates.
//   6. Assert distance ≈ 100 mm (within 0.5 mm OCCT tol), dx ≈ 100,
//      dy ≈ 0, dz ≈ 0.
//   7. Toggle 3-point angle mode. Arm V → body A (COM (20,20,20)),
//      arm Arm 1 → body B (COM (120,20,20)), arm Arm 2 → an edge of
//      body A whose midpoint is NOT on the x-axis through A's COM
//      (this is an OCCT edge of the box; we pick the resulting
//      midpoint after the kernel reports the polyline). Assert the
//      angle is a finite positive number in (0°, 180°).
//   8. Regression on PUSH-63: the entity-properties panel also reads
//      __forgeSelection — opening Measure must not break it. Open
//      tools.entityProps and assert its panel mounts after Measure
//      runs.
//
// Multi-cam: 5 named angles per Forge-171 multi-cam mandate.
//   - iso  (boot + seed)
//   - front (open panel)
//   - top  (Point A captured)
//   - right (Point B captured + distance asserted)
//   - iso  (angle mode + entity-props regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-67-measure');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'measure-session.mp4');

let app, page;
let stepIndex = 0;
let handleA = null;
let handleB = null;

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

// Replace window.__forgeSelection wholesale and fire the bus event the
// MeasureToolPanel listens for. Mirrors what aisSelection.js + the
// CommandPalette do internally and what push-63 already exercises.
async function setSelection(sel) {
    await page.evaluate((s) => {
        window.__forgeSelection = s;
        window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: s }));
    }, sel);
    await pause(300);
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
        if (/push-67|measure|Measure|forge|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen
    // <div data-testid="forge-tour-overlay"> that intercepts pointer
    // events on every panel button. Flip the seen flag so it stays
    // dormant for the whole run, then explicitly skip if it raced in.
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
        console.error('[push-67] no .webm');
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
                console.log(`[push-67] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-67] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed 2 boxes 100 mm apart on X', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        if (typeof f.massProps !== 'function') return { error: 'forge.massProps unavailable' };
        // Box A — 40×40×40, placed at origin. COM is at (20, 20, 20).
        const a = f.makeBox(40, 40, 40);
        // Box B — same size, translated +100 along X. COM is at (120, 20, 20).
        const b0 = f.makeBox(40, 40, 40);
        const b  = f.translate(b0, 100, 0, 0);
        if (typeof a !== 'number' || typeof b !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-67-a', kind: 'native', handle: a,
            toolId: 'solid.box', name: 'Box A 40',
            params: { width: 40, height: 40, distance: 40 },
        });
        window.__forgeAppendBody({
            id: 'f-box-67-b', kind: 'native', handle: b,
            toolId: 'solid.box', name: 'Box B 40 @ +100 X',
            params: { width: 40, height: 40, distance: 40 },
        });
        // Sanity-check the kernel COMs match the expected (20,20,20) and
        // (120,20,20). Reported back to the test so we can xref later.
        const mpa = f.massProps(a);
        const mpb = f.massProps(b);
        return {
            handleA: a, handleB: b,
            comA: mpa?.centerOfMass, comB: mpb?.centerOfMass,
        };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handleA).toBeGreaterThan(0);
    expect(seeded.handleB).toBeGreaterThan(0);
    handleA = seeded.handleA;
    handleB = seeded.handleB;
    console.log('[push-67] seeded COM A =', seeded.comA, 'COM B =', seeded.comB);
    // The kernel returns the OCCT centre of mass. We assert it
    // matches the geometric centre of the box within OCCT tolerance.
    expect(Math.abs(seeded.comA[0] - 20)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comA[1] - 20)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comA[2] - 20)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comB[0] - 120)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comB[1] - 20)).toBeLessThan(0.1);
    expect(Math.abs(seeded.comB[2] - 20)).toBeLessThan(0.1);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Measure via tools.measure menu action', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.measure');
    await page.waitForSelector('[data-testid="forge-measure-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');
    // Distance row should read em-dash until both points are set.
    const dTxt = await page.locator('[data-testid="forge-measure-distance"]')
                           .textContent();
    expect(dTxt?.trim()).toBe('—');
});

test('02 — arm Point A, fire body-A selection → slot A populates', async () => {
    await cameraTo('top');
    // Press the "Set Point A" button — that arms slot A.
    await page.locator('[data-testid="forge-measure-set-a"]').click();
    await pause(200);
    // The button's data-armed attribute should flip to 'true'.
    const armed = await page.locator('[data-testid="forge-measure-set-a"]')
                            .getAttribute('data-armed');
    expect(armed).toBe('true');
    // Fire a body selection on handleA. The next
    // forge:selection-changed event makes the panel resolve the
    // body's COM and slot it into A.
    await setSelection({ kind: 'body', bodyHandle: handleA, ids: [handleA] });
    // Wait for the readout to appear.
    await page.waitForSelector('[data-testid="forge-measure-a-readout"]',
                               { state: 'visible', timeout: 4000 });
    await shot('point-a-captured');
    // The data-armed attribute should now be back to 'false' (auto-disarm
    // after capture so the user can't double-fill the same slot).
    const armedAfter = await page.locator('[data-testid="forge-measure-set-a"]')
                                 .getAttribute('data-armed');
    expect(armedAfter).toBe('false');
    // The readout should contain a vector — exact text contains "(20.000,
    // 20.000, 20.000)" because that's the OCCT COM of the 40 mm box.
    const readout = await page.locator('[data-testid="forge-measure-a-readout"]')
                              .textContent();
    console.log('[push-67] A readout =', readout);
    expect(readout || '').toMatch(/\(.*\)/);
    expect(readout || '').toMatch(/20\.00/);
});

test('03 — arm Point B, fire body-B selection → distance ≈ 100 mm, dx ≈ 100', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-measure-set-b"]').click();
    await pause(200);
    await setSelection({ kind: 'body', bodyHandle: handleB, ids: [handleB] });
    await page.waitForSelector('[data-testid="forge-measure-b-readout"]',
                               { state: 'visible', timeout: 4000 });
    await shot('point-b-captured');

    // Distance read.
    const dAttr = await page.locator('[data-testid="forge-measure-distance"]')
                            .getAttribute('data-distance-mm');
    const d = Number(dAttr);
    console.log('[push-67] distance =', d);
    expect(Number.isFinite(d)).toBe(true);
    expect(Math.abs(d - 100)).toBeLessThan(0.5);

    // dx / dy / dz.
    const dxAttr = await page.locator('[data-testid="forge-measure-dx"]')
                             .getAttribute('data-dx-mm');
    const dyAttr = await page.locator('[data-testid="forge-measure-dy"]')
                             .getAttribute('data-dy-mm');
    const dzAttr = await page.locator('[data-testid="forge-measure-dz"]')
                             .getAttribute('data-dz-mm');
    const dx = Number(dxAttr), dy = Number(dyAttr), dz = Number(dzAttr);
    console.log('[push-67] dx,dy,dz =', dx, dy, dz);
    expect(Math.abs(dx - 100)).toBeLessThan(0.5);
    expect(Math.abs(dy - 0)).toBeLessThan(0.5);
    expect(Math.abs(dz - 0)).toBeLessThan(0.5);

    // Distance text should include "100." mm.
    const dText = await page.locator('[data-testid="forge-measure-distance"]')
                            .textContent();
    expect(dText || '').toMatch(/100\.|99\.9/);
});

test('04 — face-mode capture: arm A again, pick a face on body A → centroid lands', async () => {
    // Reset Point A, arm it, then send a FACE selection. The panel
    // should resolve through forge.direct.inferFeature(handle, 1).centroid
    // and slot the result.
    await page.locator('[data-testid="forge-measure-clear-a"]').click();
    await pause(150);
    await page.locator('[data-testid="forge-measure-set-a"]').click();
    await pause(150);
    await setSelection({
        kind: 'face', bodyHandle: handleA, faceId: 1, ids: [handleA],
    });
    await page.waitForSelector('[data-testid="forge-measure-a-readout"]',
                               { state: 'visible', timeout: 4000 });
    const readoutA = await page.locator('[data-testid="forge-measure-a-readout"]')
                               .textContent();
    console.log('[push-67] A face-mode readout =', readoutA);
    // Face centroid of any face of a box at the origin will be inside
    // [-0, +40] in each axis, so the parens contain three finite numbers.
    expect(readoutA || '').toMatch(/\(.*\)/);
    expect(readoutA || '').toMatch(/Face 1/);

    // Distance is now face-A.centroid → body-B.COM, both finite.
    const dAttr = await page.locator('[data-testid="forge-measure-distance"]')
                            .getAttribute('data-distance-mm');
    const d = Number(dAttr);
    console.log('[push-67] face-mode distance =', d);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeGreaterThan(0);
    await shot('face-mode-A');
});

test('05 — angle mode: V/Arm1/Arm2 captures + finite angle + PUSH-63 regression', async () => {
    await cameraTo('iso');
    // Reset and toggle angle mode on.
    await page.locator('[data-testid="forge-measure-reset"]').click();
    await pause(150);
    await page.locator('[data-testid="forge-measure-angle-toggle"]').check();
    await pause(200);
    // Vertex = body A COM (20, 20, 20).
    await page.locator('[data-testid="forge-measure-set-v"]').click();
    await pause(150);
    await setSelection({ kind: 'body', bodyHandle: handleA, ids: [handleA] });
    await page.waitForSelector('[data-testid="forge-measure-v-readout"]',
                               { state: 'visible', timeout: 4000 });
    // Arm 1 = body B COM (120, 20, 20).
    await page.locator('[data-testid="forge-measure-set-arm1"]').click();
    await pause(150);
    await setSelection({ kind: 'body', bodyHandle: handleB, ids: [handleB] });
    await page.waitForSelector('[data-testid="forge-measure-arm1-readout"]',
                               { state: 'visible', timeout: 4000 });
    // Arm 2 = a face of body A whose centroid is NOT collinear with
    // the V→Arm1 vector (Arm1 is body B COM at (120,20,20); V is body
    // A COM at (20,20,20); the V→Arm1 direction is +X). Box face 1 is
    // the -X face with centroid (0,20,20) — that direction is -X and
    // would give 180°. So we probe each box face from the kernel and
    // pick the first one whose centroid is NOT on the x-axis through V.
    const goodFaceId = await page.evaluate((handle) => {
        const fn = window?.forge?.direct?.inferFeature;
        if (typeof fn !== 'function') return null;
        // OCCT face IDs on a primitive box run 1..6. Scan until one is
        // off the x-axis (i.e. has nontrivial dy or dz from V=(20,20,20)).
        for (let id = 1; id <= 12; ++id) {
            try {
                const r = fn(handle, id);
                if (!r || !Array.isArray(r.centroid)) continue;
                const [cx, cy, cz] = r.centroid;
                const dy = cy - 20, dz = cz - 20;
                if (Math.abs(dy) > 0.5 || Math.abs(dz) > 0.5) {
                    return { id, cx, cy, cz };
                }
            } catch { /* skip */ }
        }
        return null;
    }, handleA);
    console.log('[push-67] non-collinear face on body A =', goodFaceId);
    expect(goodFaceId).not.toBeNull();
    await page.locator('[data-testid="forge-measure-set-arm2"]').click();
    await pause(150);
    await setSelection({
        kind: 'face', bodyHandle: handleA, faceId: goodFaceId.id, ids: [handleA],
    });
    await page.waitForSelector('[data-testid="forge-measure-arm2-readout"]',
                               { state: 'visible', timeout: 4000 });
    await shot('angle-mode-filled');

    // Read the angle out.
    const degAttr = await page.locator('[data-testid="forge-measure-angle"]')
                              .getAttribute('data-angle-deg');
    const radAttr = await page.locator('[data-testid="forge-measure-angle"]')
                              .getAttribute('data-angle-rad');
    const deg = Number(degAttr), rad = Number(radAttr);
    console.log('[push-67] 3-pt angle = ', deg, 'deg /', rad, 'rad');
    expect(Number.isFinite(deg)).toBe(true);
    expect(Number.isFinite(rad)).toBe(true);
    // The angle must be a real measure: > 0 and < 180 (it's not
    // collinear unless the box face 1 happens to sit exactly on the
    // x-axis through (20,20,20), which it doesn't for a 40 mm cube).
    expect(deg).toBeGreaterThan(0);
    expect(deg).toBeLessThan(180);
    // The angle text should match the data attribute.
    const angText = await page.locator('[data-testid="forge-measure-angle"]')
                              .textContent();
    expect(angText || '').toMatch(/[0-9]+\.[0-9]+°/);

    // ── PUSH-63 regression: opening tools.entityProps after Measure
    // should still mount the entity panel and the mode chip should
    // still flip on selection events (the two panels both listen to
    // forge:selection-changed but neither mutates the global, so they
    // must coexist).
    await platformMenuAction('tools.entityProps');
    await page.waitForSelector('[data-testid="forge-entityprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await setSelection({ kind: 'body', bodyHandle: handleA, ids: [handleA] });
    await page.waitForFunction(
        () => {
            const el = document.querySelector('[data-testid="forge-entityprops-mode"]');
            return el && el.textContent && el.textContent.trim() === 'Body';
        },
        null, { timeout: 4000 });
    await shot('entityprops-regression');
    const volAttr = await page.locator('[data-testid="forge-entityprops-body-volume"]')
                              .getAttribute('data-volume-mm3');
    const vol = Number(volAttr);
    console.log('[push-67] entity-props vol after measure =', vol);
    // 40³ = 64 000 mm³ → the OCCT GProp volume for a 40 mm cube.
    expect(Math.abs(vol - 64000)).toBeLessThan(1);
});
