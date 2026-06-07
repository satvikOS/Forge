// PUSH-80 (Slice-48 / Direct Edit numeric translate panel).
//
// Up through PUSH-79 the only way to programmatically move a kernel-
// backed body without rebuilding the OCCT shape was the PUSH-57 pose
// channel (window.__forgeAnimationPose Map<handle, {pos:[x,y,z]}>),
// which only the Animation timeline workbench wrote to. There was no
// numeric "type dx = 50, click Apply, mesh moves 50 mm" surface.
//
// PUSH-80 ships that surface as a right-docked Direct Edit panel:
//   • Picker dropdown lists every native body; auto-selects the active
//     body (selection → last-native fallback).
//   • Three numeric inputs — dx, dy, dz (mm).
//   • Apply writes a single entry to window.__forgeAnimationPose for
//     the picked body using the same channel the timeline writes to;
//     the PUSH-57 Viewport.AnimationPoseTicker reads that Map every
//     frame and imperatively sets mesh.position. No React re-render,
//     no Viewport.jsx change.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Seed two native OCCT boxes (40×40×40 at the origin, the second
//      one extruded with translate +200 along Y so the two have
//      distinct kernel handles AND distinct base mesh positions).
//   3. Open the Direct Edit Translate panel via the
//      `tools.directEditTranslate` menu action. Assert the panel
//      mounts (data-testid="forge-direct-edit-translate-panel") and
//      the picker auto-selects the last-native body (handleB).
//   4. Switch the picker to handleA, set dx = 50, dy = 0, dz = 0, click
//      Apply. Assert:
//        • window.__forgeAnimationPose.get(handleA) === { pos: [50, 0, 0] }
//        • The forge-direct-edit-translate-status data attributes
//          reflect the applied vector.
//        • A forge:direct-edit-translate-applied bus event fired.
//        • After waiting a few rAF ticks, the real three.js mesh tagged
//          with userData.body.handle === handleA reports
//          mesh.position.x ≈ 50 (within 0.1 mm rounding). The
//          AnimationPoseTicker is doing the work.
//   5. Switch the picker to handleB, type a non-trivial 3D vector
//      (dx = -30, dy = 100, dz = 25). Apply. Repeat the assertions —
//      both the Map entry and the actual mesh position match.
//   6. Reset handleA via the Reset button. Assert the Map entry for
//      handleA is gone, the bus event fired with {cleared:true}, and
//      handleB's entry survived.
//   7. PUSH-57 regression: open the Animation workbench, click the
//      "Build from bodies" button. Assert the live tracks rebuild the
//      Map for both bodies (size ≥ 2) and Animation re-takes ownership
//      of the channel. This proves PUSH-80 and PUSH-57 are sharing the
//      same Map without one breaking the other.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel)
//   - top   (apply translate to handleA)
//   - right (apply translate to handleB)
//   - iso   (reset handleA + PUSH-57 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-80-direct-edit-translate');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'direct-edit-translate-session.mp4');

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

// Read the REAL three.js world position of the mesh tagged with the
// given kernel handle. Mirrors PUSH-57's meshPositionFor helper. The
// AnimationPoseTicker walks the scene each rAF and writes
// mesh.position imperatively for any handle present in the pose Map.
async function meshPositionFor(handle) {
    return page.evaluate((h) => {
        const scene = window.__forgeScene;
        if (!scene) return null;
        let found = null;
        scene.traverse((obj) => {
            if (found) return;
            if (obj?.userData?.body?.handle === h && obj.isMesh) {
                found = [obj.position.x, obj.position.y, obj.position.z];
            }
        });
        return found;
    }, handle);
}

// Install a window-level capture for the forge:direct-edit-translate-applied
// bus so the test can assert events fired, not just final state.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push80Events = [];
        window.addEventListener('forge:direct-edit-translate-applied', (e) => {
            window.__push80Events.push({
                handle: e?.detail?.handle ?? null,
                dx: e?.detail?.dx ?? null,
                dy: e?.detail?.dy ?? null,
                dz: e?.detail?.dz ?? null,
                cleared: e?.detail?.cleared ?? false,
            });
        });
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
        if (/push-80|direct-edit|translate|forge|error|Error/i.test(t)) {
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
    // Onboarding tour overlay — flip seen flag so it stays dormant.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    await pause(800);
    await installEventCapture();
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
        console.error('[push-80] no .webm');
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
                console.log(`[push-80] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-80] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed two boxes (A at origin, B translated +200 Y)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        // Box A — 40 mm cube at origin. Handle is opaque but unique.
        const a = f.makeBox(40, 40, 40);
        // Box B — same size, base shape translated +200 along Y so the
        // initial mesh position is offset from A. The translate kernel
        // call rebuilds the OCCT shape under a fresh handle and we
        // append the resulting body — handleB will be distinct from
        // handleA.
        const b0 = f.makeBox(40, 40, 40);
        const b  = f.translate(b0, 0, 200, 0);
        if (typeof a !== 'number' || typeof b !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-80-a', kind: 'native', handle: a,
            toolId: 'solid.box', name: 'Box A 40',
            params: { width: 40, height: 40, distance: 40 },
        });
        window.__forgeAppendBody({
            id: 'f-box-80-b', kind: 'native', handle: b,
            toolId: 'solid.box', name: 'Box B 40 @ +200 Y',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handleA: a, handleB: b };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handleA).toBeGreaterThan(0);
    expect(seeded.handleB).toBeGreaterThan(0);
    expect(seeded.handleA).not.toBe(seeded.handleB);
    handleA = seeded.handleA;
    handleB = seeded.handleB;
    console.log('[push-80] seeded handles A=', handleA, 'B=', handleB);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Direct Edit Translate via tools.directEditTranslate', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.directEditTranslate');
    await page.waitForSelector('[data-testid="forge-direct-edit-translate-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The active-body fallback is the last native body — handleB.
    const activeAttr = await page.locator('[data-testid="forge-direct-edit-translate-panel"]')
                                  .getAttribute('data-active-handle');
    console.log('[push-80] initial picker handle =', activeAttr);
    expect(activeAttr).toBe(String(handleB));

    // Body count chip records the 2 native bodies in the scene.
    const bodyCountAttr = await page.locator('[data-testid="forge-direct-edit-translate-panel"]')
                                    .getAttribute('data-body-count');
    expect(Number(bodyCountAttr)).toBe(2);

    // Picker dropdown options include both handles. `<option>` elements
    // inside a `<select>` are hidden by default in Chromium even when
    // attached to the DOM, so wait for attachment rather than visibility.
    await page.waitForSelector(`[data-testid="forge-direct-edit-translate-option-${handleA}"]`,
                               { state: 'attached', timeout: 4000 });
    await page.waitForSelector(`[data-testid="forge-direct-edit-translate-option-${handleB}"]`,
                               { state: 'attached', timeout: 4000 });
});

test('02 — pick body A, type dx=50, Apply → mesh moves 50 mm on +X', async () => {
    await cameraTo('top');
    // Switch the picker to handle A.
    await page.locator('[data-testid="forge-direct-edit-translate-picker"]')
              .selectOption(String(handleA));
    await pause(200);
    const activeAttr = await page.locator('[data-testid="forge-direct-edit-translate-panel"]')
                                  .getAttribute('data-active-handle');
    expect(activeAttr).toBe(String(handleA));

    // Type dx = 50 (leave dy / dz at 0).
    await page.locator('[data-testid="forge-direct-edit-translate-dx"]').fill('50');
    await page.locator('[data-testid="forge-direct-edit-translate-dy"]').fill('0');
    await page.locator('[data-testid="forge-direct-edit-translate-dz"]').fill('0');
    await pause(150);

    // Sanity-check the Apply button echoes the parsed values on its
    // data attributes (proves the React state is in sync with the
    // input fields).
    const dxBtn = await page.locator('[data-testid="forge-direct-edit-translate-apply"]')
                            .getAttribute('data-dx');
    expect(Number(dxBtn)).toBe(50);

    // Apply.
    await page.locator('[data-testid="forge-direct-edit-translate-apply"]').click();
    await pause(250);
    await shot('apply-A-dx50');

    // The pose Map carries an entry for handleA at (50, 0, 0).
    const poseEntry = await page.evaluate((h) => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        const e = m.get(h);
        if (!e || !e.pos) return null;
        return [Number(e.pos[0]), Number(e.pos[1]), Number(e.pos[2])];
    }, handleA);
    console.log('[push-80] pose entry for A =', poseEntry);
    expect(poseEntry).not.toBeNull();
    expect(poseEntry[0]).toBe(50);
    expect(poseEntry[1]).toBe(0);
    expect(poseEntry[2]).toBe(0);

    // Status data attributes record the last applied move.
    const statusEl = page.locator('[data-testid="forge-direct-edit-translate-status"]');
    expect(await statusEl.getAttribute('data-last-handle')).toBe(String(handleA));
    expect(Number(await statusEl.getAttribute('data-last-dx'))).toBe(50);
    expect(Number(await statusEl.getAttribute('data-last-dy'))).toBe(0);
    expect(Number(await statusEl.getAttribute('data-last-dz'))).toBe(0);

    // Event capture has at least one matching entry.
    const events = await page.evaluate(() => window.__push80Events || []);
    console.log('[push-80] events after Apply A =', JSON.stringify(events));
    const matchA = events.find((e) => e.handle === handleA && e.dx === 50 && e.dy === 0 && e.dz === 0 && !e.cleared);
    expect(matchA).toBeDefined();

    // Wait a few rAF ticks for the AnimationPoseTicker to apply the
    // pose to the actual three.js mesh.
    await pause(600);
    const meshA = await meshPositionFor(handleA);
    console.log('[push-80] mesh position A after Apply =', meshA);
    expect(meshA).not.toBeNull();
    expect(Math.abs(meshA[0] - 50)).toBeLessThan(0.1);
    expect(Math.abs(meshA[1] - 0)).toBeLessThan(0.1);
    expect(Math.abs(meshA[2] - 0)).toBeLessThan(0.1);
});

test('03 — pick body B, type (-30, 100, 25), Apply → 3D mesh move', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-direct-edit-translate-picker"]')
              .selectOption(String(handleB));
    await pause(200);
    const activeAttr = await page.locator('[data-testid="forge-direct-edit-translate-panel"]')
                                  .getAttribute('data-active-handle');
    expect(activeAttr).toBe(String(handleB));

    await page.locator('[data-testid="forge-direct-edit-translate-dx"]').fill('-30');
    await page.locator('[data-testid="forge-direct-edit-translate-dy"]').fill('100');
    await page.locator('[data-testid="forge-direct-edit-translate-dz"]').fill('25');
    await pause(150);
    await page.locator('[data-testid="forge-direct-edit-translate-apply"]').click();
    await pause(250);
    await shot('apply-B-3d');

    const poseEntry = await page.evaluate((h) => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        const e = m.get(h);
        if (!e || !e.pos) return null;
        return [Number(e.pos[0]), Number(e.pos[1]), Number(e.pos[2])];
    }, handleB);
    console.log('[push-80] pose entry for B =', poseEntry);
    expect(poseEntry).not.toBeNull();
    expect(poseEntry[0]).toBe(-30);
    expect(poseEntry[1]).toBe(100);
    expect(poseEntry[2]).toBe(25);

    // The handleA entry survived (the Apply only touched handleB).
    const poseEntryA = await page.evaluate((h) => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        const e = m.get(h);
        return e ? [Number(e.pos[0]), Number(e.pos[1]), Number(e.pos[2])] : null;
    }, handleA);
    console.log('[push-80] pose entry for A (after B apply) =', poseEntryA);
    expect(poseEntryA).not.toBeNull();
    expect(poseEntryA[0]).toBe(50);

    // Mesh B reflects the 3D translate after a couple of rAF ticks.
    await pause(600);
    const meshB = await meshPositionFor(handleB);
    console.log('[push-80] mesh position B after Apply =', meshB);
    expect(meshB).not.toBeNull();
    expect(Math.abs(meshB[0] - (-30))).toBeLessThan(0.1);
    expect(Math.abs(meshB[1] - 100)).toBeLessThan(0.1);
    expect(Math.abs(meshB[2] - 25)).toBeLessThan(0.1);
});

test('04 — Reset on handle A clears its pose; B survives; PUSH-57 regression', async () => {
    await cameraTo('iso');
    // Switch back to handle A so Reset acts on it.
    await page.locator('[data-testid="forge-direct-edit-translate-picker"]')
              .selectOption(String(handleA));
    await pause(200);
    await page.locator('[data-testid="forge-direct-edit-translate-reset"]').click();
    await pause(300);
    await shot('reset-A');

    // Map no longer has handleA.
    const hasA = await page.evaluate((h) => {
        const m = window.__forgeAnimationPose;
        return m instanceof Map ? m.has(h) : false;
    }, handleA);
    expect(hasA).toBe(false);

    // Map still has handleB at the 3D pose from step 03.
    const poseB = await page.evaluate((h) => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        const e = m.get(h);
        return e ? [Number(e.pos[0]), Number(e.pos[1]), Number(e.pos[2])] : null;
    }, handleB);
    expect(poseB).not.toBeNull();
    expect(poseB[0]).toBe(-30);
    expect(poseB[1]).toBe(100);

    // A cleared event landed on the bus capture.
    const events = await page.evaluate(() => window.__push80Events || []);
    const cleared = events.find((e) => e.handle === handleA && e.cleared === true);
    expect(cleared).toBeDefined();

    // ── PUSH-57 regression: PUSH-80 and PUSH-57 share the
    // window.__forgeAnimationPose Map. Open the Animation workbench,
    // click "Build from bodies"; the workbench rebuilds the Map (live
    // tracks for every native body) and Animation re-takes ownership.
    // Asserting the Map contains BOTH handles afterwards proves the
    // two surfaces are talking to the same channel.
    await platformMenuAction('tools.animation');
    await page.waitForSelector('[data-testid="forge-animation-panel"]',
                               { state: 'visible', timeout: 8000 });
    await page.locator('[data-testid="forge-animation-build-from-bodies"]').click();
    await pause(500);

    const liveMap = await page.evaluate(() => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        return { size: m.size, keys: Array.from(m.keys()) };
    });
    console.log('[push-80] post-Animation Map =', liveMap);
    expect(liveMap).not.toBeNull();
    expect(liveMap.size).toBeGreaterThanOrEqual(2);
    expect(liveMap.keys).toEqual(expect.arrayContaining([handleA, handleB]));
    await shot('push-57-regression');
});
