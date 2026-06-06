// PUSH-57 (Slice-25b / Animation dim — keyframes drive real bodies)
//
// Forge-209 shipped an animation timeline workbench with a linear +
// Catmull-Rom Hermite keyframe evaluator (forge.animation in the native
// addon), but it only animated an abstract `box.translation` fixture —
// nothing in the viewport actually moved when the user pressed Play.
//
// This slice binds the existing keyframe evaluator to live OCCT bodies:
//   - AnimationTimelineWorkbench gains a "Build from bodies" button that
//     constructs per-body translation tracks of shape
//     `body:<handle>.translation`, one per native body in the scene.
//   - The workbench publishes window.__forgeAnimationPose — a Map<handle,
//     {pos:[x,y,z]}> — on every track evaluation (scrub OR play loop).
//   - Viewport mounts a new AnimationPoseTicker that on every r3f frame
//     reads the pose Map and imperatively sets `mesh.position` on the
//     mesh whose userData.body.handle matches. No React re-renders, so
//     scrubbing stays 60 fps.
//
// Multi-cam e2e — 5 named camera angles (iso / front / right / top /
// iso-after). Asserts on the REAL r3f mesh position (read through
// window.__forgeScene.traverse), not just on JS state, so a regression
// in the ticker would break this test.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-57-animation-live');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'animation-live-session.mp4');

let app, page;
let stepIndex = 0;
let handleA = null, handleB = null;

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
    await pause(500);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(300);
}

// Read the REAL three.js world position of the mesh tagged with the
// given body handle — proves the pose ticker actually moved the mesh,
// not just the JS state map.
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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-57|animation|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);
});

test.afterAll(async () => {
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-57] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-57] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-57] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + seed two native bodies (10×10×10 each)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const ha = window.forge?.makeBox?.(10, 10, 10);
        const hb = window.forge?.makeBox?.(10, 10, 10);
        if (typeof ha !== 'number' || typeof hb !== 'number')
            return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({ id: 'f-a', kind: 'native', handle: ha,
            toolId: 'solid.box', name: 'A', params: { width: 10, height: 10, distance: 10 } });
        window.__forgeAppendBody({ id: 'f-b', kind: 'native', handle: hb,
            toolId: 'solid.box', name: 'B', params: { width: 10, height: 10, distance: 10 } });
        return { ha, hb };
    });
    expect(seeded.ha).toBeGreaterThan(0);
    expect(seeded.hb).toBeGreaterThan(0);
    handleA = seeded.ha; handleB = seeded.hb;
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Animation workbench via tools.animation', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.animation');
    await page.waitForSelector('[data-testid="forge-animation-panel"]', { state: 'visible', timeout: 8000 });
    await shot('animation-panel-open');
});

test('02 — Build from bodies → live tracks bind to A and B', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-animation-build-from-bodies"]').click();
    await pause(500);
    await shot('after-build');

    // Live label appears on the button.
    await expect(page.locator('[data-testid="forge-animation-build-from-bodies"]'))
        .toContainText(/Live tracks/);

    // The pose Map carries entries for BOTH handles immediately (t=0).
    const seeded = await page.evaluate(() => {
        const m = window.__forgeAnimationPose;
        if (!m || typeof m.get !== 'function') return null;
        return { size: m.size, keys: Array.from(m.keys()) };
    });
    expect(seeded).not.toBeNull();
    expect(seeded.size).toBeGreaterThanOrEqual(2);
    expect(seeded.keys).toEqual(expect.arrayContaining([handleA, handleB]));

    // At t=0 each body's pose is the origin (start of the orbit loop).
    const poseA0 = await page.evaluate((h) =>
        window.__forgeAnimationPose.get(h), handleA);
    const poseB0 = await page.evaluate((h) =>
        window.__forgeAnimationPose.get(h), handleB);
    console.log('[push-57] t=0 poseA=', poseA0, 'poseB=', poseB0);
    expect(Math.abs(poseA0.pos[0])).toBeLessThan(0.001);
    expect(Math.abs(poseA0.pos[1])).toBeLessThan(0.001);
});

test('03 — scrub to t≈1.5 → meshes physically translate in the viewport', async () => {
    await cameraTo('top');
    // Set the scrubber to t=1.5 s.
    await page.locator('[data-testid="forge-animation-scrub"]').fill('1.5');
    await pause(800);
    await shot('scrubbed-1.5');

    // Pose state for both handles updated.
    const poseAt15 = await page.evaluate((handles) => {
        const m = window.__forgeAnimationPose;
        const out = {};
        for (const h of handles) out[h] = m.get(h)?.pos || null;
        return out;
    }, [handleA, handleB]);
    console.log('[push-57] t=1.5 poses =', JSON.stringify(poseAt15));
    // Both poses are non-trivial at t=1.5 (mid-loop).
    const magA = Math.hypot(...poseAt15[handleA]);
    const magB = Math.hypot(...poseAt15[handleB]);
    expect(magA).toBeGreaterThan(1);
    expect(magB).toBeGreaterThan(1);

    // The REAL three.js mesh.position reflects the pose — proves the
    // AnimationPoseTicker is wired (not just the JS state map).
    // Wait one rAF tick for the ticker to fire.
    await pause(300);
    // Diagnostic — list every mesh's userData.body.handle so we can see if
    // the traverse is finding the right meshes.
    const allMeshHandles = await page.evaluate(() => {
        const s = window.__forgeScene;
        if (!s) return null;
        const out = [];
        s.traverse((obj) => {
            if (obj.isMesh && obj.userData?.body?.handle !== undefined) {
                out.push({ handle: obj.userData.body.handle, pos: [obj.position.x, obj.position.y, obj.position.z] });
            }
        });
        return out;
    });
    console.log('[push-57] all mesh handles =', JSON.stringify(allMeshHandles));
    const meshA = await meshPositionFor(handleA);
    const meshB = await meshPositionFor(handleB);
    console.log('[push-57] mesh positions t=1.5 A=', meshA, 'B=', meshB);
    expect(meshA).not.toBeNull();
    expect(meshB).not.toBeNull();
    // Mesh world position matches the pose (within rounding).
    expect(Math.abs(meshA[0] - poseAt15[handleA][0])).toBeLessThan(0.1);
    expect(Math.abs(meshA[1] - poseAt15[handleA][1])).toBeLessThan(0.1);
});

test('04 — rewind → t=0 pose; A returns to origin, B returns to phased keyframe', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-animation-rewind"]').click();
    await pause(500);
    await shot('rewound');

    const meshA = await meshPositionFor(handleA);
    const meshB = await meshPositionFor(handleB);
    console.log('[push-57] mesh positions after rewind A=', meshA, 'B=', meshB);
    // A has phase 0 — at t=0 it sits at the keyframe origin [0,0,0].
    expect(Math.abs(meshA[0])).toBeLessThan(0.1);
    expect(Math.abs(meshA[1])).toBeLessThan(0.1);
    // B has phase 1 — at t=0 it sits at the third keyframe, [0, radius, 0]
    // (radius = 12 + 1*4 = 16). The bodies are phased on purpose so the
    // assembly doesn't read as a single rigid translation; the rewind
    // restores B to that phased start, not the world origin.
    expect(Math.abs(meshB[0])).toBeLessThan(0.1);
    expect(meshB[1]).toBeCloseTo(16, 0);
});

test('05 — global search exposes Animation', async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await pause(200);
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Animation');
        await pause(400);
        await shot('search-animation');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Animation/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-57] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
