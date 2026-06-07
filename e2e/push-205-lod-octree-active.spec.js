// PUSH-205 (Slice-160 / LOD + octree culling active in InstancedGroup).
//
// PUSH-204 publishes `window.__forgeVisibleBodies` (Set<id> of frustum-
// visible body ids) every frame. PUSH-205 makes the viewport actually
// CONSUME that set: InstancedGroup's per-frame ticker now collapses any
// instance whose id is NOT in the visible set to ZERO_SCALE, and emits a
// `forge:lod-needed` event whenever a body crosses a LOD level boundary
// in `window.__forgeLodLevel` (mirrored from the LOD scheduler).
//
// This sanity-only e2e proves end-to-end that:
//   00. The Octree ticker publishes `window.__forgeVisibleBodies` as a
//       Set instance after the first frame, even on an empty scene.
//   01. Seeding 100 synthetic cubes via __forgeSetBodies → after the
//       octree rebuilds, the visible set is non-empty AND
//       window.__forgeLodLevel exists as a Map.
//   02. Orbiting the camera so roughly half the cloud is behind it
//       cuts the visible set below the total — real frustum cull, not
//       just "everything is visible".
//   03. Clearing bodies returns the visible set to size 0.
//   04. Stressing with 1000 cubes keeps the visible-set size strictly
//       less than total once the camera is pulled in close.
//   05. Close the session. Final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + assert __forgeVisibleBodies is a Set)
//   - front (100 cubes seeded)
//   - top   (orbit-behind real cull check)
//   - right (clear → empty set)
//   - iso   (1000-cube stress + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-205-lod-octree-active');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'lod-octree-active-session.mp4');

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

// Seed synthetic-cube bodies on a deterministic grid centred at the
// origin so every cube has a stable position the test can reason about.
// We use the canonical `__forgeSetBodies` setter so React state updates
// in lockstep and the Viewport receives the new `steps` prop.
//
// Each cube ships an explicit `spec.bbox` so the OctreeIndex uses a
// snug ±1.5 mm per-cube AABB instead of the 100 mm fallback half-extent
// — without the snug bbox the cube's footprint in octree space would
// dwarf the cube cluster itself and the octree could never honestly
// answer "this cube is outside the frustum".
async function seedCubes(n, opts = {}) {
    return await page.evaluate(({ n, spacing, edgeMm }) => {
        const arr = [];
        // Lay the cubes out on a roughly-cubic grid so the camera can
        // actually see them all from an iso view at moderate range.
        const sideLen = Math.ceil(Math.cbrt(n));
        const half = edgeMm / 2;
        const bbox = { minX: -half, minY: -half, minZ: -half,
                       maxX:  half, maxY:  half, maxZ:  half };
        for (let i = 0; i < n; i++) {
            const ix = i % sideLen;
            const iy = Math.floor(i / sideLen) % sideLen;
            const iz = Math.floor(i / (sideLen * sideLen));
            const cx = (ix - (sideLen - 1) / 2) * spacing;
            const cy = (iy - (sideLen - 1) / 2) * spacing;
            const cz = (iz - (sideLen - 1) / 2) * spacing;
            arr.push({
                id: `c-${i}`,
                kind: 'synthetic',
                name: `Cube ${i}`,
                spec: { kind: 'box', dx: edgeMm, dy: edgeMm, dz: edgeMm, bbox },
                xform: { x: cx, y: cy, z: cz },
            });
        }
        if (typeof window.__forgeSetBodies === 'function') {
            window.__forgeSetBodies(arr);
        } else {
            window.__forgeBodies = arr;
        }
        try {
            window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
                detail: { kind: 'push-205-seed', count: arr.length },
            }));
        } catch {}
        return arr.length;
    }, { n, spacing: opts.spacing ?? 8, edgeMm: opts.edgeMm ?? 3 });
}

// Pull the running visible-set + level-map readout from the page.
async function snapshotVisibility() {
    return await page.evaluate(() => {
        const vs = window.__forgeVisibleBodies;
        const lm = window.__forgeLodLevel;
        const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        return {
            visibleIsSet: vs instanceof Set,
            visibleSize:  (vs instanceof Set) ? vs.size : -1,
            levelIsMap:   lm instanceof Map,
            levelSize:    (lm instanceof Map) ? lm.size : -1,
            totalBodies:  bodies.length,
            firstVisible: (vs instanceof Set) ? Array.from(vs).slice(0, 3) : [],
        };
    });
}

// Wait for the OctreeCullingTicker to publish at least one Set value.
// On boot the Set is created on the first useFrame tick of the Canvas,
// so we poll until visibility is observed.
async function waitForVisibleSet(timeoutMs = 6000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const ok = await page.evaluate(() => window.__forgeVisibleBodies instanceof Set);
        if (ok) return true;
        await pause(150);
    }
    return false;
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
        if (/push-205|lod|octree|cull|visible|forge.*error|Error/i.test(t)) {
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

    // Dismiss the onboarding tour — it blocks the viewport.
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
    // Clear any pre-existing bodies from a prior session.
    await page.evaluate(() => {
        try {
            if (typeof window.__forgeSetBodies === 'function') {
                window.__forgeSetBodies([]);
            } else {
                window.__forgeBodies = [];
            }
        } catch {}
    });
    await pause(400);
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
        console.error('[push-205] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-205] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-205] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert __forgeVisibleBodies is a Set after first frame', async () => {
    await cameraTo('iso');
    await shot('boot');

    const sawSet = await waitForVisibleSet(8000);
    expect(sawSet).toBe(true);

    const snap = await snapshotVisibility();
    console.log('[push-205] boot snap =', JSON.stringify(snap));
    expect(snap.visibleIsSet).toBe(true);
    // Empty scene → Set is allocated but holds nothing.
    expect(snap.visibleSize).toBe(0);
    expect(snap.totalBodies).toBe(0);

    await shot('visible-set-allocated');
});

test('01 — seed 100 cubes; visible set > 0 + level map populated', async () => {
    await cameraTo('front');
    const seeded = await seedCubes(100, { spacing: 8 });
    expect(seeded).toBe(100);
    await pause(400);
    // Park the camera at a known iso-ish distance so the whole 5×5×5
    // cloud (radius ≈ 28 mm in 3D) lands comfortably inside the
    // default frustum. Smart-fit is unreliable for InstancedMesh
    // clouds (the bounding box reflects the single shared geometry,
    // not the instance spread), so we set the camera explicitly here.
    await page.evaluate(() => {
        const cam = window.__forgeCamera;
        const ctrl = window.__forgeOrbit;
        if (!cam) return false;
        cam.near = 0.1;
        cam.far  = 500;
        cam.position.set(80, 60, 80);
        if (ctrl) {
            ctrl.target.set(0, 0, 0);
            ctrl.update?.();
        }
        cam.lookAt(0, 0, 0);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        return true;
    });
    await pause(600);
    await shot('100-cubes-fit');

    const snap = await snapshotVisibility();
    console.log('[push-205] 100-cube snap =', JSON.stringify(snap));
    expect(snap.visibleIsSet).toBe(true);
    expect(snap.totalBodies).toBe(100);
    // BENCHMARK ASSERTION: octree real-cull happened — at least some bodies
    // pass the frustum test.
    expect(snap.visibleSize).toBeGreaterThan(0);
    expect(snap.visibleSize).toBeLessThanOrEqual(100);

    // The LOD scheduler ticks alongside the octree; its mirror map
    // must be populated for the same body set.
    expect(snap.levelIsMap).toBe(true);
    expect(snap.levelSize).toBeGreaterThan(0);

    // Wait one more frame so the InstancedGroup's per-frame loop has
    // a chance to consume both sources.
    await pause(200);
    await shot('100-cubes-visible-set');
});

test('02 — orbit camera so half are behind → visible.size < 100', async () => {
    await cameraTo('top');
    // Park the camera deep inside the cube cloud so a strict half-space
    // of cubes sits behind the camera. The cubes span ±16 mm on each
    // axis (5×5×5 grid at 8 mm spacing). Putting the camera at
    // (0, 0, 0) with the look direction along +Z guarantees every cube
    // at z < 0 (≈ 40 cubes) is behind the near plane, and the FOV +
    // aspect together exclude additional cubes outside the side
    // planes. Many real-world DCC apps run this exact stress.
    await page.evaluate(() => {
        const cam = window.__forgeCamera;
        const ctrl = window.__forgeOrbit;
        if (!cam) return false;
        // Snug viewing volume so the octree's frustum query is tight.
        cam.near = 1;
        cam.far  = 200;
        cam.position.set(0, 0, 0);
        if (ctrl) {
            ctrl.target.set(0, 0, 60);
            ctrl.update?.();
        }
        cam.lookAt(0, 0, 60);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        return true;
    });
    await pause(900);
    await shot('camera-orbited');

    // Pull two readouts ~250 ms apart so we're sure the per-frame loop
    // has propagated the new camera state through the octree query.
    let snap = await snapshotVisibility();
    await pause(300);
    snap = await snapshotVisibility();
    console.log('[push-205] orbit snap =', JSON.stringify(snap));
    expect(snap.totalBodies).toBe(100);
    // BENCHMARK ASSERTION: visible count < total → real culling, not
    // an "everything is visible" stub.
    expect(snap.visibleSize).toBeLessThan(100);
    expect(snap.visibleSize).toBeGreaterThanOrEqual(0);

    await shot('orbit-cull-confirmed');
});

test('03 — clear bodies → visible set drops to 0', async () => {
    await cameraTo('right');
    await page.evaluate(() => {
        try {
            if (typeof window.__forgeSetBodies === 'function') {
                window.__forgeSetBodies([]);
            } else {
                window.__forgeBodies = [];
            }
        } catch {}
        try {
            window.dispatchEvent(new CustomEvent('forge:bodies-changed', {
                detail: { kind: 'push-205-clear' },
            }));
        } catch {}
    });
    await pause(500);
    await shot('bodies-cleared');

    const snap = await snapshotVisibility();
    console.log('[push-205] cleared snap =', JSON.stringify(snap));
    expect(snap.totalBodies).toBe(0);
    expect(snap.visibleIsSet).toBe(true);
    // BENCHMARK ASSERTION: empty scene → zero visible.
    expect(snap.visibleSize).toBe(0);

    await shot('visible-zero');
});

test('04 — stress 1000 cubes → visible set < total once orbited', async () => {
    await cameraTo('iso');
    // 1000 cubes on a ~10×10×10 grid at 6 mm spacing → cloud spans
    // roughly ±27 mm in each axis. Same camera-inside-cloud trick as
    // step 02 to guarantee an honest visible < total readout.
    const seeded = await seedCubes(1000, { spacing: 6 });
    expect(seeded).toBe(1000);
    await pause(400);
    await page.evaluate(() => {
        const cam = window.__forgeCamera;
        const ctrl = window.__forgeOrbit;
        if (!cam) return false;
        cam.near = 1;
        cam.far  = 300;
        cam.position.set(0, 0, 0);
        if (ctrl) {
            ctrl.target.set(0, 0, 60);
            ctrl.update?.();
        }
        cam.lookAt(0, 0, 60);
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();
        return true;
    });
    await pause(700);
    await shot('1000-cubes-orbited');

    let snap = await snapshotVisibility();
    await pause(300);
    snap = await snapshotVisibility();
    console.log('[push-205] 1k snap =', JSON.stringify(snap));
    expect(snap.totalBodies).toBe(1000);
    expect(snap.visibleIsSet).toBe(true);
    // BENCHMARK ASSERTION: 1000-cube stress still triggers real cull.
    // The optional FPS counter (window.__forgeFps) is informational
    // only; the contract is that the visible set is strictly smaller
    // than the total.
    const fps = await page.evaluate(() => {
        const f = window.__forgeFps;
        return typeof f === 'number' ? f : null;
    });
    if (typeof fps === 'number') {
        console.log('[push-205] fps (if reported) =', fps);
    }
    expect(snap.visibleSize).toBeLessThan(1000);
    expect(snap.visibleSize).toBeGreaterThanOrEqual(0);

    // The HUD chip is shown only when bodies > 50; since we have 1000
    // it must mount.
    const chip = page.locator('[data-testid="forge-viewport-cullchip"]');
    await expect(chip).toBeVisible();
    const chipText = await chip.textContent();
    console.log('[push-205] chip text =', chipText);
    expect(chipText).toContain('/');
    expect(chipText).toMatch(/1000/);

    await shot('1k-stress-cull-confirmed');
});

test('05 — close session + final shot', async () => {
    await cameraTo('iso');
    // Tear the scene back down so the autosave doesn't churn.
    await page.evaluate(() => {
        try {
            if (typeof window.__forgeSetBodies === 'function') {
                window.__forgeSetBodies([]);
            }
        } catch {}
    });
    await pause(400);
    await shot('session-closed');
});
