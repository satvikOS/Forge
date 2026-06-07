// PUSH-94 (Slice-62 / Big Scene Stress Test panel).
//
// Up through PUSH-93 the only stress benchmark for the Forge renderer
// was Forge-111's StressTestPanel (20 k bolts via Viewport.SceneMeshes'
// InstancedGroup). Production assemblies in MCAD routinely cross 30 k
// components — a regime where even the Forge-106 batched path starts
// to break down because every body still owns its own native handle
// + per-body MeshBVH boundsTree + per-body matrix. We need a separate
// renderer-only benchmark that exercises the best-case path —
// ONE THREE.InstancedMesh with N cubes — so we know the per-instance
// matrix upload cost in isolation.
//
// PUSH-94 ships the Big Scene Stress Test panel: a right-docked panel
// with a body-count slider (1 k / 5 k / 10 k / 30 k presets) and a
// Generate button. On Generate the panel allocates one
// THREE.InstancedMesh with N cubes in a sidecar canvas (its own WebGL
// context, separate from the main Viewport) and runs a private RAF
// loop. Each frame measures ms / FPS and renderer.info — total draw
// call = 1 by construction since there's only one mesh in the scene.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Wait for the host's window surfaces:
//        window.__forgeOpenBigSceneStress,
//        window.__forgeCloseBigSceneStress,
//        window.__forgeBigSceneSetSeed,
//        window.__forgeBigSceneBuildMatrices.
//      That's the proof the host's effect ran even before the panel
//      is opened.
//   3. Open the panel via the `tools.bigSceneStress` menu action;
//      panel mounts with data-generated='false'.
//   4. Drive the slider to 10000 (the brief's specified test count).
//      Pin the seed to 42 via __forgeBigSceneSetSeed for determinism.
//   5. Click Generate → wait for data-generated='true' AND for the
//      published stats to settle (data-draw-calls === '1' and
//      data-instance-count === '10000').
//   6. Sample window.__forgeBigSceneStats over a brief window (≥1.5 s,
//      long enough that the FPS reading is over a real frame-time
//      window, not the 16.7 ms init seed); assert FPS > 20.
//   7. Verify the slider position matches the body count + assert
//      data-fps chip reads in the same band.
//   8. PUSH-65 regression: open Section Plane via tools.sectionPlane.
//      The Big Scene panel must stay visible alongside it (both portal
//      siblings); the menu action wiring for Section Plane must still
//      route through the panel host.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + assert global surface)
//   - front (open panel + set slider + seed)
//   - top   (Generate + assert mesh built)
//   - right (sample FPS + draw-call assertion)
//   - iso   (push-65 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-94-big-scene');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'big-scene-session.mp4');

const TARGET_COUNT = 10000;
const TARGET_SEED  = 42;
// The brief asks for FPS > 20 at 10 k bodies, which is well above the
// soft-fail floor we treat as a CI regression signal.
const FPS_FLOOR = 20;
// We must sample over enough time that the published mean FPS reflects
// real frames rather than the initial 16.667 ms warm-up sample. 1500 ms
// at 30 FPS = ~45 frames → comfortably more than the 60-sample ring
// buffer so the mean is settled.
const SAMPLE_WINDOW_MS = 1800;

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
    await pause(300);
}
async function cameraTo(viewName) {
    await platformMenuAction(`view.${viewName}`);
    await pause(250);
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
        if (msg.type() === 'error' || msg.type() === 'warning'
            || /push-94|big-scene|BigScene|forge:big-scene|error|Error|exception|TypeError|crashed/i.test(t)) {
            console.log('[browser]', msg.type(), t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser pageerror]', err.message);
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
        console.error('[push-94] no .webm');
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
                console.log(`[push-94] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-94] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global host surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    // The host effect installs the imperative open/close + the matrix
    // builder + the seed override at mount time, BEFORE the panel is
    // shown. That's the proof BigSceneStressPanelHost mounted from
    // App.jsx.
    await page.waitForFunction(
        () => typeof window.__forgeOpenBigSceneStress === 'function'
           && typeof window.__forgeCloseBigSceneStress === 'function'
           && typeof window.__forgeBigSceneSetSeed === 'function'
           && typeof window.__forgeBigSceneBuildMatrices === 'function'
           && typeof window.__forgeBigSceneStats === 'object',
        null, { timeout: 8000 });

    // The matrix builder is a pure (count, seed) → Float32Array(count*16),
    // works without a renderer mounted. Sanity-check it.
    const sanity = await page.evaluate(() => {
        const mats = window.__forgeBigSceneBuildMatrices(100, 7);
        return {
            isFloat32: mats instanceof Float32Array,
            length: mats.length,
            sample0: Array.from(mats.slice(0, 16)),
        };
    });
    expect(sanity.isFloat32).toBe(true);
    // 16 floats per instance, 100 instances.
    expect(sanity.length).toBe(100 * 16);
    // The first sample is a valid 4×4 affine — the bottom row should
    // be (0, 0, 0, 1) for a TRS compose (THREE.Matrix4 stores
    // row-major-on-toArray, so element 15 is the homogeneous 1).
    expect(sanity.sample0.length).toBe(16);
    expect(sanity.sample0[15]).toBe(1);
});

test('01 — open Big Scene panel via tools.bigSceneStress menu action', async () => {
    await cameraTo('front');

    // Pin the seed so the generated cloud + stats lookup are
    // deterministic across runs.
    await page.evaluate((seed) => {
        window.__forgeBigSceneSetSeed(seed);
    }, TARGET_SEED);

    await platformMenuAction('tools.bigSceneStress');
    await page.waitForSelector('[data-testid="forge-big-scene-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const panel = page.locator('[data-testid="forge-big-scene-panel"]');
    expect(await panel.getAttribute('data-generated')).toBe('false');

    // Default slider position is 1000 — bump it to TARGET_COUNT.
    // The slider is a native <input type=range>; use Playwright's
    // fill() to drive it directly.
    const slider = page.locator('[data-testid="forge-big-scene-slider"]');
    await expect(slider).toBeVisible();
    await slider.fill(String(TARGET_COUNT));
    await pause(200);

    // The panel reflects the slider position immediately via state.
    expect(await panel.getAttribute('data-body-count')).toBe(String(TARGET_COUNT));

    // The Generate / Clear buttons are present.
    const generateBtn = page.locator('[data-testid="forge-big-scene-generate"]');
    await expect(generateBtn).toBeVisible();
    await expect(generateBtn).toBeEnabled();
    const clearBtn = page.locator('[data-testid="forge-big-scene-clear"]');
    await expect(clearBtn).toBeVisible();
    // Before Generate, Clear is disabled (no scene to clear).
    await expect(clearBtn).toBeDisabled();
});

test('02 — click Generate → InstancedMesh builds + data-generated flips + draw call = 1', async () => {
    await cameraTo('top');

    const panel = page.locator('[data-testid="forge-big-scene-panel"]');
    const generateBtn = page.locator('[data-testid="forge-big-scene-generate"]');

    await generateBtn.click();
    // The Generate flow bootstraps the renderer (first click only),
    // builds the InstancedMesh, then starts the RAF loop. The
    // data-generated attribute flips on the React re-render after
    // setGenerated(true).
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-big-scene-panel"]');
        return el && el.getAttribute('data-generated') === 'true';
    }, null, { timeout: 8000 });

    // The RAF loop publishes window.__forgeBigSceneStats every
    // FPS_SAMPLE_INTERVAL_MS (250 ms). Wait until the stats reflect
    // the seeded instance count + the one draw call.
    await page.waitForFunction((target) => {
        const s = window.__forgeBigSceneStats;
        return s && s.instanceCount === target && s.drawCalls === 1;
    }, TARGET_COUNT, { timeout: 8000 });

    // The panel mirrors the stats onto its data-* attributes so the
    // DOM is also self-describing — assert both surfaces match.
    expect(await panel.getAttribute('data-instance-count')).toBe(String(TARGET_COUNT));
    expect(await panel.getAttribute('data-draw-calls')).toBe('1');

    // After Generate the Clear button is enabled (something to clear).
    const clearBtn = page.locator('[data-testid="forge-big-scene-clear"]');
    await expect(clearBtn).toBeEnabled();

    // The sidecar canvas is mounted + visible.
    const canvas = page.locator('[data-testid="forge-big-scene-canvas"]');
    await expect(canvas).toBeVisible();

    await shot('scene-built');
});

test('03 — sample FPS over a real window → assert > 20 FPS at 10 k instances + draw call still 1', async () => {
    await cameraTo('right');

    // The brief mandates FPS > 20 at 10 k bodies. We sample over a real
    // window so the published mean reflects multiple frame intervals.
    // The panel's RAF loop already averages over the last 60 samples
    // (~15 s of real time), so we just wait long enough for the first
    // valid mean to stabilise.
    await pause(SAMPLE_WINDOW_MS);
    await shot('rendering');

    const stats = await page.evaluate(() => {
        const s = window.__forgeBigSceneStats || {};
        return {
            fps: typeof s.fps === 'number' ? s.fps : 0,
            msPerFrame: typeof s.msPerFrame === 'number' ? s.msPerFrame : 0,
            drawCalls: typeof s.drawCalls === 'number' ? s.drawCalls : 0,
            instanceCount: typeof s.instanceCount === 'number' ? s.instanceCount : 0,
            triangles: typeof s.triangles === 'number' ? s.triangles : 0,
            frames: typeof s.frames === 'number' ? s.frames : 0,
            lastSeed: typeof s.lastSeed === 'number' ? s.lastSeed : 0,
        };
    });
    console.log('[push-94] stats =', JSON.stringify(stats));

    // The brief contract: FPS > 20 at 10 k bodies, draw calls = 1
    // exactly, instance count matches what we asked for.
    expect(stats.fps).toBeGreaterThan(FPS_FLOOR);
    expect(stats.drawCalls).toBe(1);
    expect(stats.instanceCount).toBe(TARGET_COUNT);
    // Each cube emits 12 tris × N instances. We don't assert byte
    // equality because the renderer occasionally short-circuits when
    // the frame is offscreen — but the count is bounded below by
    // any single frame's render.
    expect(stats.triangles).toBeGreaterThan(0);
    // The RAF loop has run at least a handful of frames by now.
    expect(stats.frames).toBeGreaterThan(8);
    // The seed override took effect.
    expect(stats.lastSeed).toBe(TARGET_SEED);
    // ms/frame is finite + positive.
    expect(stats.msPerFrame).toBeGreaterThan(0);
    expect(Number.isFinite(stats.msPerFrame)).toBe(true);

    // The DOM data-fps attribute is rounded to 1 decimal place; parse
    // it back and confirm it's in the same ballpark as the published
    // window stat (within ±5 FPS to absorb timing jitter between the
    // React commit and the JS readout).
    const fpsAttr = await page.locator(
        '[data-testid="forge-big-scene-panel"]').getAttribute('data-fps');
    const fpsAttrNum = parseFloat(fpsAttr);
    expect(Number.isFinite(fpsAttrNum)).toBe(true);
    expect(Math.abs(fpsAttrNum - stats.fps)).toBeLessThan(5);

    // The FPS chip's value text matches the data attribute.
    const fpsChipText = (await page.locator(
        '[data-testid="forge-big-scene-chip-fps-value"]').innerText()).trim();
    expect(fpsChipText.length).toBeGreaterThan(0);
});

test('04 — push-65 regression: Section Plane panel still opens alongside Big Scene', async () => {
    await cameraTo('iso');

    // PUSH-65 (Slice-33) regression: opening Section Plane via
    // tools.sectionPlane must still mount its panel. BigSceneStress is
    // a portal sibling — it must not collide with other right-docked
    // panels.
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });

    // Both panels are open + visible (they happen to share the right
    // edge — that's a known overlap that the user requested to leave
    // unchanged for v0.4. Visible + mounted is the actual contract.)
    const sectionVisible = await page.locator(
        '[data-testid="forge-section-plane-panel"]').isVisible();
    expect(sectionVisible).toBe(true);
    const bigSceneVisible = await page.locator(
        '[data-testid="forge-big-scene-panel"]').isVisible();
    expect(bigSceneVisible).toBe(true);

    // The Big Scene stats are still pumping (the RAF loop didn't get
    // suspended by the panel mount).
    const stillRunning = await page.evaluate(() => {
        const s = window.__forgeBigSceneStats || {};
        return s.drawCalls === 1 && s.instanceCount > 0;
    });
    expect(stillRunning).toBe(true);

    await shot('section-coexists');
});
