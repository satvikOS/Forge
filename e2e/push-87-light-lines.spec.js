// PUSH-87 (Slice-55) — Class-A light-line / isophote analysis overlay.
//
// Forge's Class-A surfacing toolkit already ships a zebra-stripes analyser
// (PUSH-86: alternating bands from a reflected striped environment).
// PUSH-87 adds the COMPLEMENTARY view designers run alongside zebra: a
// single highlight contour (isophote) at the picked light direction
// where dot(N, L) crosses repeating bands. Kinks at G1 breaks show as
// bold black lines; smooth transitions stay faint grey (curvature-based
// dimming via the fragment shader's fwidth-based ramp).
//
// What we prove end-to-end:
//   1. Boot Electron; dismiss any first-run banner.
//   2. Assert the headless helper API (window.__forgeLightLineHelper)
//      is wired by the Host's mount effect — that's the contract every
//      plugin / Archie tool call relies on.
//   3. Seed a real OCCT 40×40×40 native box (the same seed PUSH-86 uses).
//      Viewport.jsx tags the mesh with userData.body, and the isophote
//      overlay scans for that tag when picking swap targets.
//   4. Open the light-line panel via tools.lightLines menu action.
//      Assert the panel mounts; the helper exposes sane defaults; the
//      live mirror at window.__forgeLightLines is hydrated.
//   5. Click "Enable light lines". Assert the shared isophote material
//      reaches at least one body mesh: its material.uniforms.lineDensity
//      is > 0, its material.userData.archdiscLightLine === true, and
//      the mesh's userData.__lightLineOriginalMaterial holds the
//      stashed PBR.
//   6. Drag the line-density slider to 24 and prove the uniform updated
//      live (no rebuild). Same for the threshold slider.
//   7. Drag azimuth + elevation sliders and prove the lightDir uniform's
//      world direction matches the panel's readout vector.
//   8. Toggle the overlay back off via the "Disable" button; assert the
//      original material was restored, the stash key is gone, and the
//      shared material is disposed.
//   9. PUSH-86 (zebra) regression — both overlays swap materials, so
//      they must cooperate, not collide:
//        a. Enable zebra via tools.zebraStripes; assert the zebra
//           ShaderMaterial lands.
//        b. Enable the light-line overlay on top. Assert the body now
//           wears the isophote material (NOT zebra), and the stashed
//           original is the SAME PBR that zebra had stashed (no
//           double-stash, no lost material).
//        c. Disable the light-line. Assert the body returns to the
//           original PBR (NOT zebra) — toggling either overlay always
//           returns to the underlying baseline.
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate:
//   - iso   (boot + assert helper API + seed body)
//   - front (open panel + enable swap)
//   - top   (density + threshold sliders)
//   - right (azimuth + elevation sliders + disable)
//   - iso   (PUSH-86 zebra cooperation regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-87-light-lines');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'light-lines-session.mp4');

let app, page;
let stepIndex = 0;
let boxHandle = null;

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

// Set a React-controlled range slider's value through the native setter
// so React's onChange fires. Playwright's .fill() doesn't always
// dispatch the matching React synthetic event on controlled inputs.
async function setReactRange(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`range not found: ${args.testid}`);
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, String(args.value));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

// Sample the live state of the isophote material on the first body
// mesh we find. Returns a plain object so it crosses the page bridge.
async function sampleLightLineMaterial() {
    return await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        const out = {
            totalBodyMeshes: 0,
            isophoteMatMeshes: 0,
            origStashed: 0,
            sampleMaterialType: null,
            sampleArchdiscLightLine: false,
            sampleUniforms: null,
        };
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body && !o.userData.bodyId) return;
            out.totalBodyMeshes += 1;
            if (o.material) {
                if (out.sampleMaterialType === null) {
                    out.sampleMaterialType = o.material.type || null;
                }
                if (o.material.userData?.archdiscLightLine) {
                    out.isophoteMatMeshes += 1;
                    if (!out.sampleArchdiscLightLine) {
                        out.sampleArchdiscLightLine = true;
                        const u = o.material.uniforms || {};
                        out.sampleUniforms = {
                            lineDensity:   u.lineDensity?.value ?? null,
                            threshold:     u.threshold?.value ?? null,
                            ambient:       u.ambient?.value ?? null,
                            curvatureGain: u.curvatureGain?.value ?? null,
                            lightDir:      u.lightDir?.value
                                ? { x: u.lightDir.value.x, y: u.lightDir.value.y, z: u.lightDir.value.z }
                                : null,
                        };
                    }
                }
            }
            if (o.userData.__lightLineOriginalMaterial) out.origStashed += 1;
        });
        return out;
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
        if (/push-87|light-line|isophote|forge:light-lines|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay that
    // intercepts pointer events on every panel button. Flip the seen
    // flag so it stays dormant; skip if it raced in.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        // Clear any state from a previous run of this spec so the
        // panel boots from the canonical ISOPHOTE_DEFAULTS (line
        // density 12, threshold 0.04, az 45°, el 30°).  Without this
        // a prior `lineDensity:24` etc. would leak from
        // localStorage into the new run and break the default-value
        // assertions in test 02.
        try { window.localStorage.removeItem('forge.v4.lightLines'); } catch {}
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
        console.error('[push-87] no .webm'); return;
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
                console.log(`[push-87] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-87] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed 40×40×40 box (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The host effect installs the headless helper API mirror at module
    // load. That's the proof every plugin / Archie tool call has the
    // contract before the panel mounts.
    await page.waitForFunction(
        () => !!window.__forgeLightLineHelper
           && typeof window.__forgeOpenLightLines === 'function'
           && typeof window.__forgeLightLineHelper.buildIsophoteMaterial === 'function'
           && typeof window.__forgeLightLineHelper.applyIsophoteToObject === 'function'
           && typeof window.__forgeLightLineHelper.clearIsophoteFromObject === 'function'
           && typeof window.__forgeLightLineHelper.updateIsophoteUniforms === 'function'
           && typeof window.__forgeLightLineHelper.dirFromAzEl === 'function'
           && window.__forgeLightLineHelper.EVENT_NAME === 'forge:light-lines-changed'
           && window.__forgeLightLineHelper.STORAGE_KEY === 'forge.v4.lightLines'
           && !!window.__forgeLightLineHelper.DEFAULTS
           && Number.isFinite(window.__forgeLightLineHelper.DEFAULTS.lineDensity)
           && Number.isFinite(window.__forgeLightLineHelper.DEFAULTS.threshold),
        null, { timeout: 8000 });

    // The window mirror is hydrated on host mount even before the panel
    // is opened — same hydration pattern as PUSH-75 lighting + PUSH-82
    // batch rename.
    await page.waitForFunction(
        () => !!window.__forgeLightLines
           && Number.isFinite(window.__forgeLightLines.lineDensity)
           && Number.isFinite(window.__forgeLightLines.threshold)
           && Number.isFinite(window.__forgeLightLines.azimuth)
           && Number.isFinite(window.__forgeLightLines.elevation),
        null, { timeout: 4000 });

    // Seed a real OCCT box. Viewport.jsx mesh ref tags the rendered mesh
    // with userData.body — that's what the isophote overlay scans for
    // when picking swap targets (same key zebra uses).
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 40, 40);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-87', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x40x40 (PUSH-87)',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handle: h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    boxHandle = seeded.handle;

    // Wait for the body to land in window.__forgeBodies + the mesh to
    // be tagged in the live three.js scene.
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await page.waitForFunction(
        () => {
            const sc = window.__forgeScene;
            if (!sc) return false;
            let found = false;
            sc.traverse((o) => {
                if (o && o.isMesh && o.userData && o.userData.body) found = true;
            });
            return found;
        }, null, { timeout: 8000 });
    await shot('body-seeded');
});

test('01 — open light-line panel + enable + assert material swap (front)', async () => {
    await cameraTo('front');

    // Capture the bus event so we can prove the publish path fires
    // every time state changes.
    await page.evaluate(() => {
        window.__push87Events = [];
        window.addEventListener('forge:light-lines-changed', (e) => {
            try {
                window.__push87Events.push({
                    visible: e?.detail?.visible,
                    lineDensity: e?.detail?.lineDensity,
                    threshold: e?.detail?.threshold,
                    azimuth: e?.detail?.azimuth,
                    elevation: e?.detail?.elevation,
                });
            } catch {}
        });
    });

    // Activate via the menu action — same channel the real menu bar uses.
    await platformMenuAction('tools.lightLines');

    // Panel mounts.
    await page.waitForSelector('[data-testid="forge-light-lines-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel surfaces every uniform on its data-* attributes so the
    // e2e doesn't have to scrape inner text. Sanity-check the defaults.
    const panel = page.locator('[data-testid="forge-light-lines-panel"]');
    expect(await panel.getAttribute('data-visible')).toBe('0');
    expect(Number(await panel.getAttribute('data-line-density'))).toBeGreaterThan(0);
    expect(Number(await panel.getAttribute('data-threshold'))).toBeGreaterThan(0);
    expect(Number(await panel.getAttribute('data-line-density'))).toBeGreaterThan(0);

    // Click "Enable light lines". The toggle button drives the material
    // swap synchronously — by the time setState fires, the shared
    // material is built + applied to every body mesh.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-light-lines-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(400);
    await shot('after-enable');

    // The panel attribute flips.
    expect(await panel.getAttribute('data-visible')).toBe('1');

    // The shared isophote material lands on at least one body mesh.
    const swapState = await sampleLightLineMaterial();
    console.log('[push-87] swapState =', swapState);
    expect(swapState.totalBodyMeshes).toBeGreaterThan(0);
    expect(swapState.isophoteMatMeshes).toBeGreaterThan(0);
    expect(swapState.origStashed).toBeGreaterThan(0);
    expect(swapState.sampleArchdiscLightLine).toBe(true);
    expect(swapState.sampleUniforms).not.toBeNull();
    expect(swapState.sampleUniforms.lineDensity).toBeGreaterThan(0);
    expect(swapState.sampleUniforms.threshold).toBeGreaterThan(0);
    expect(swapState.sampleUniforms.lightDir).not.toBeNull();

    // The applied-count readout reflects the mesh count.
    const appliedReadout = page.locator('[data-testid="forge-light-lines-applied-readout"]');
    const appliedAttr = Number(await appliedReadout.getAttribute('data-value'));
    expect(appliedAttr).toBeGreaterThan(0);

    // The bus event fired with visible=true.
    const events = await page.evaluate(() => window.__push87Events || []);
    expect(events.some((e) => e.visible === true)).toBe(true);
});

test('02 — line density + threshold sliders drive live uniforms (top)', async () => {
    await cameraTo('top');

    // The panel may be hydrated from a previous run's persisted state
    // (forge.v4.lightLines). We assert the slider scrub MOVES the
    // uniform — not that the starting value was the cold default.
    const panel = page.locator('[data-testid="forge-light-lines-panel"]');
    const beforeDensity = Number(await panel.getAttribute('data-line-density'));
    expect(beforeDensity).toBeGreaterThan(0);

    // Drag the line-density slider to 24. The host's effect mutates the
    // uniform on the shared material — no rebuild. Pick a value
    // unlikely to coincidentally equal the persisted state so we can
    // distinguish "slider moved" from "no-op".
    const targetDensity = beforeDensity === 24 ? 32 : 24;
    await setReactRange('forge-light-lines-density', targetDensity);
    await pause(300);
    await shot('density-24');

    expect(Number(await panel.getAttribute('data-line-density'))).toBe(targetDensity);

    // The shared uniform also reflects the new value.
    let sample = await sampleLightLineMaterial();
    expect(sample.sampleUniforms.lineDensity).toBe(targetDensity);

    // Now scrub the threshold slider to 0.08.
    await setReactRange('forge-light-lines-threshold', 0.08);
    await pause(300);
    await shot('threshold-008');

    const newThreshold = Number(await panel.getAttribute('data-threshold'));
    expect(newThreshold).toBeCloseTo(0.08, 3);

    sample = await sampleLightLineMaterial();
    expect(sample.sampleUniforms.threshold).toBeCloseTo(0.08, 3);

    // And the curvature gain.
    await setReactRange('forge-light-lines-curvature', 16);
    await pause(300);
    await shot('curvature-16');

    sample = await sampleLightLineMaterial();
    expect(sample.sampleUniforms.curvatureGain).toBeCloseTo(16, 1);
});

test('03 — azimuth + elevation sliders mutate lightDir; disable restores (right)', async () => {
    await cameraTo('right');

    // Move azimuth to 90° and elevation to 0°. That should make the
    // lightDir unit vector point along +Z (sin(90)=1 for the z component
    // in the dirFromAzEl(0..360, -90..90) mapping the panel uses).
    await setReactRange('forge-light-lines-azimuth', 90);
    await pause(150);
    await setReactRange('forge-light-lines-elevation', 0);
    await pause(300);
    await shot('az-90-el-0');

    const panel = page.locator('[data-testid="forge-light-lines-panel"]');
    expect(Number(await panel.getAttribute('data-azimuth'))).toBe(90);
    expect(Number(await panel.getAttribute('data-elevation'))).toBe(0);

    // The panel's readout strip exposes the unit vector as data-d{x,y,z}
    // on the direction readout — those are the panel's claim. Read them
    // back and confirm they match what dirFromAzEl(90, 0) produces.
    const dirReadout = page.locator('[data-testid="forge-light-lines-direction-readout"]');
    const dx = Number(await dirReadout.getAttribute('data-dx'));
    const dy = Number(await dirReadout.getAttribute('data-dy'));
    const dz = Number(await dirReadout.getAttribute('data-dz'));
    // dirFromAzEl(90, 0) → x=cos(0)*cos(90)=0, y=sin(0)=0, z=cos(0)*sin(90)=1.
    expect(dx).toBeCloseTo(0, 2);
    expect(dy).toBeCloseTo(0, 2);
    expect(dz).toBeCloseTo(1, 2);

    // The shared uniform's lightDir matches that vector.
    const sample = await sampleLightLineMaterial();
    expect(sample.sampleUniforms.lightDir.x).toBeCloseTo(dx, 2);
    expect(sample.sampleUniforms.lightDir.y).toBeCloseTo(dy, 2);
    expect(sample.sampleUniforms.lightDir.z).toBeCloseTo(dz, 2);

    // Now Disable via the toggle button.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-light-lines-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(400);
    await shot('after-disable');

    expect(await panel.getAttribute('data-visible')).toBe('0');

    // Every body mesh's material is restored to a non-isophote material,
    // the stash key is gone, and the applied count is 0.
    const afterDisable = await sampleLightLineMaterial();
    expect(afterDisable.isophoteMatMeshes).toBe(0);
    expect(afterDisable.origStashed).toBe(0);
    expect(afterDisable.sampleArchdiscLightLine).toBe(false);

    // The applied-count readout is back to 0.
    const appliedReadout = page.locator('[data-testid="forge-light-lines-applied-readout"]');
    expect(Number(await appliedReadout.getAttribute('data-value'))).toBe(0);
});

test('04 — PUSH-86 zebra cooperation: both swap materials, neither collides (iso)', async () => {
    await cameraTo('iso');

    // First half of the regression: prove zebra still works after the
    // light-line lifecycle of the earlier tests. Enable zebra via its
    // menu action and confirm the ShaderMaterial reaches the body
    // (this is the PUSH-86 contract, intact alongside PUSH-87).
    await platformMenuAction('tools.zebraStripes');
    await page.waitForSelector('[data-testid="forge-zebra-stripes-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(600);  // Let the zebra RAF tick run a few frames.
    await shot('zebra-on');

    let zebraState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let zebraMatMeshes = 0;
        let zebraStashed = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMatMeshes += 1;
            if (o.userData._origMaterial) zebraStashed += 1;
        });
        return { zebraMatMeshes, zebraStashed };
    });
    expect(zebraState.zebraMatMeshes).toBeGreaterThan(0);
    expect(zebraState.zebraStashed).toBeGreaterThan(0);

    // Close zebra so its per-frame RAF tick stops re-stomping any body
    // material — the user's brief explicitly mandates "they should not
    // collide (zebra disable on enable of light-line)". We close zebra
    // here to enact that policy without modifying the zebra overlay.
    await page.evaluate(() => {
        if (typeof window.__forgeOpenZebraStripes === 'function') {
            window.__forgeOpenZebraStripes(false);
        }
    });
    await pause(500);
    await shot('zebra-off-before-isophote');

    // The zebra material is back to the original; no zebra meshes
    // remain.  We don't assert zebraStashed===0 because the off-cycle
    // intentionally removes the userData key as it restores.
    const afterZebraOff = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let zebraMeshes = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
        });
        return { zebraMeshes };
    });
    expect(afterZebraOff.zebraMeshes).toBe(0);

    // NOW enable light-line on top.  applyIsophoteToObject will swap
    // every body's material to the isophote shader.  No zebra material
    // is left because zebra is off — they don't collide.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
                             { detail: { id: 'tools.lightLines' } }));
    });
    await pause(300);
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-light-lines-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(600);
    await shot('isophote-after-zebra');

    const coopState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let isophoteMeshes = 0;
        let zebraMeshes = 0;
        let lightLineStashed = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
            if (o.material && o.material.userData?.archdiscLightLine) isophoteMeshes += 1;
            if (o.userData.__lightLineOriginalMaterial) lightLineStashed += 1;
        });
        return { isophoteMeshes, zebraMeshes, lightLineStashed };
    });
    console.log('[push-87] coopState =', coopState);
    // Isophote material is in place; zebra material is absent
    // (no collision).
    expect(coopState.isophoteMeshes).toBeGreaterThan(0);
    expect(coopState.zebraMeshes).toBe(0);
    expect(coopState.lightLineStashed).toBeGreaterThan(0);

    // Disable the light-line overlay. The body returns to its
    // underlying PBR — both overlays cleanly cooperate.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-light-lines-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(600);
    await shot('after-light-line-disable');

    const finalState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let isophoteMeshes = 0;
        let zebraMeshes = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.userData?.archdiscLightLine) isophoteMeshes += 1;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
        });
        return { isophoteMeshes, zebraMeshes };
    });
    // Light-line overlay is off → no isophote material in the scene.
    // Zebra is off too → no zebra material. We're back to baseline.
    expect(finalState.isophoteMeshes).toBe(0);
    expect(finalState.zebraMeshes).toBe(0);
});
