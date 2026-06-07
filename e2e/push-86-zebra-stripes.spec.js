// PUSH-86 (Slice-54 / Class-A Zebra Stripes surface analysis overlay).
//
// Forge's Class-A surfacing toolkit (Alias / ICEM / Catia parity) ships
// a zebra-stripes analyzer: a custom three.js ShaderMaterial that draws
// alternating black/white reflection bands by reflecting view-direction
// off the interpolated world normal and mapping the result onto a
// user-adjustable axis. Continuity defects (G0 break, G1 kink, G2
// wobble) show up as visible breaks/kinks in the otherwise smooth band
// pattern. PUSH-86 wires the overlay into a real Forge session:
//
//   * Reachable via the Tools > Zebra Stripes menu (tools.zebraStripes).
//   * On enable, every body mesh in window.__forgeScene has its
//     material parked on userData._origMaterial and swapped for a
//     shared zebra ShaderMaterial.
//   * A floating control panel lets the user adjust stripe count + axis.
//   * On disable, the original materials are restored.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss any first-run banner.
//   2. Assert the headless helper API (window.__forgeZebraStripesHelper)
//      is mounted by the host's mount effect — this is the contract
//      surface every plugin / Archie call relies on.
//   3. Seed a real OCCT 40×40×40 native box at the origin. The
//      Viewport.jsx mesh ref tags the rendered mesh with
//      userData.body = <body>, which is what the zebra overlay relies
//      on to identify swap targets.
//   4. Open the zebra overlay via the tools.zebraStripes menu action.
//      Assert the panel mounts, the bus event fires with active=true,
//      window.__forgeZebraStripes.active === true.
//   5. Assert at least one body mesh in window.__forgeScene now has
//      material.type === 'ShaderMaterial' (or material.name ===
//      'forge.zebraStripes') AND its userData._origMaterial holds the
//      previous material.
//   6. Drag the stripe count slider to 48 and confirm the uniform
//      updated on the shared material.
//   7. Click an axis preset (Vertical) and confirm the axis uniform
//      flipped to (1,0,0).
//   8. Toggle the overlay back off via the close button; assert every
//      mesh's material is the original again, the userData key is gone,
//      and the panel is unmounted.
//   9. PUSH-65 regression: open the section plane panel via
//      tools.sectionPlane, prove it still mounts cleanly alongside the
//      zebra-overlay host (they're sibling React portals).
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate:
//   - iso   (boot + assert helper API + seed body)
//   - front (open zebra overlay, verify swap)
//   - top   (stripe count slider)
//   - right (axis preset + close)
//   - iso   (PUSH-65 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-86-zebra-stripes');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'zebra-stripes-session.mp4');

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-86|zebra|forge:zebra|ShaderMaterial|error|Error/i.test(t)) {
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
        console.error('[push-86] no .webm'); return;
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
                console.log(`[push-86] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-86] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed a 40×40×40 native box (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Helper API contract.
    await page.waitForFunction(
        () => !!window.__forgeZebraStripesHelper
           && typeof window.__forgeOpenZebraStripes === 'function'
           && typeof window.__forgeToggleZebraStripes === 'function'
           && Array.isArray(window.__forgeZebraStripesHelper.AXIS_PRESETS)
           && window.__forgeZebraStripesHelper.AXIS_PRESETS.length >= 4
           && window.__forgeZebraStripesHelper.ZEBRA_MATERIAL_NAME === 'forge.zebraStripes'
           && window.__forgeZebraStripesHelper.ZEBRA_USERDATA_KEY === '_origMaterial',
        null, { timeout: 8000 });

    // Seed a real OCCT box. Viewport.jsx mesh ref tags the rendered
    // mesh with userData.body — that's what the zebra overlay scans
    // for when picking swap targets.
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 40, 40);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-86', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x40x40',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handle: h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    boxHandle = seeded.handle;

    // Wait for the body to land in window.__forgeBodies.
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    // Wait for the mesh to appear in the live scene (Viewport.jsx
    // tagging userData.body happens on the mesh ref callback).
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

test('01 — open zebra overlay via tools.zebraStripes; ShaderMaterial swap (front)', async () => {
    await cameraTo('front');

    // Capture the bus event so we can prove activation fired.
    await page.evaluate(() => {
        window.__push86Events = [];
        window.addEventListener('forge:zebra-stripes-changed', (e) => {
            try {
                window.__push86Events.push({
                    active: e?.detail?.active,
                    stripeCount: e?.detail?.stripeCount,
                    axisPresetId: e?.detail?.axisPresetId,
                });
            } catch {}
        });
    });

    // Activate via the menu action. The Host listens for the dispatched
    // CustomEvent — same channel the real menu bar uses.
    await platformMenuAction('tools.zebraStripes');

    // Panel mounts.
    await page.waitForSelector('[data-testid="forge-zebra-stripes-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('zebra-panel-open');

    // Global state.
    await page.waitForFunction(
        () => window.__forgeZebraStripes?.active === true,
        null, { timeout: 4000 });

    // Bus event fired with active=true.
    const events = await page.evaluate(() => window.__push86Events || []);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.active === true)).toBe(true);

    // The shared ShaderMaterial must reach the body mesh. The host's
    // RAF tick runs on every frame — give it a few frames to land
    // before sampling.
    await pause(600);
    await shot('after-swap');

    const swapState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        const out = {
            totalBodyMeshes: 0,
            shaderMatMeshes: 0,
            origStashed: 0,
            sampleMaterialType: null,
            sampleMaterialName: null,
        };
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData || !o.userData.body) return;
            out.totalBodyMeshes += 1;
            if (o.material) {
                if (out.sampleMaterialType === null) {
                    out.sampleMaterialType = o.material.type || null;
                    out.sampleMaterialName = o.material.name || null;
                }
                if (o.material.type === 'ShaderMaterial'
                    || o.material.name === 'forge.zebraStripes') {
                    out.shaderMatMeshes += 1;
                }
            }
            if (o.userData._origMaterial) out.origStashed += 1;
        });
        return out;
    });
    console.log('[push-86] swapState =', swapState);
    expect(swapState.totalBodyMeshes).toBeGreaterThan(0);
    // At least one body mesh has its material swapped to the shader.
    expect(swapState.shaderMatMeshes).toBeGreaterThan(0);
    expect(swapState.origStashed).toBeGreaterThan(0);
    // The material is either a ShaderMaterial (three.js base type) or
    // carries the canonical name.
    expect(
        swapState.sampleMaterialType === 'ShaderMaterial'
        || (swapState.sampleMaterialName || '').includes('zebra')
    ).toBe(true);
});

test('02 — stripe count slider drives the shared uniform (top)', async () => {
    await cameraTo('top');

    // Default stripe count is 24 per ZEBRA_DEFAULTS — confirm the panel
    // attribute & readout match before we tweak.
    const beforeAttr = await page.locator('[data-testid="forge-zebra-stripes-panel"]')
                                  .getAttribute('data-stripe-count');
    expect(Number(beforeAttr)).toBe(24);
    const beforeReadout = await page.locator('[data-testid="forge-zebra-stripes-count-readout"]')
                                     .textContent();
    expect((beforeReadout || '').trim()).toBe('24');

    // Drag the slider to 48. This routes through React's setState which
    // updates the panel attribute + the shared uniform in the
    // mat.uniforms.stripeCount.value cell.
    await setReactRange('forge-zebra-stripes-count-slider', 48);
    await pause(300);
    await shot('stripe-count-48');

    const afterAttr = await page.locator('[data-testid="forge-zebra-stripes-panel"]')
                                 .getAttribute('data-stripe-count');
    expect(Number(afterAttr)).toBe(48);
    const afterReadout = await page.locator('[data-testid="forge-zebra-stripes-count-readout"]')
                                    .textContent();
    expect((afterReadout || '').trim()).toBe('48');

    // The shared uniform also reflects the new value. We can't reach
    // the ShaderMaterial directly from the spec — but we can sample one
    // of the swapped meshes and inspect its material.uniforms.
    const uniformCount = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return -1;
        let found = -1;
        sc.traverse((o) => {
            if (found >= 0) return;
            if (o && o.isMesh && o.material && o.material.name === 'forge.zebraStripes') {
                const u = o.material.uniforms;
                if (u && u.stripeCount && typeof u.stripeCount.value === 'number') {
                    found = u.stripeCount.value;
                }
            }
        });
        return found;
    });
    console.log('[push-86] stripeCount uniform =', uniformCount);
    expect(uniformCount).toBe(48);

    // Published global mirror.
    const live = await page.evaluate(() => window.__forgeZebraStripes || null);
    expect(live).not.toBeNull();
    expect(live.active).toBe(true);
    expect(live.stripeCount).toBe(48);
});

test('03 — axis preset Vertical flips axis uniform to (1,0,0) (right)', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-zebra-stripes-axis-vertical"]').click();
    await pause(300);
    await shot('axis-vertical');

    const panelAxis = await page.locator('[data-testid="forge-zebra-stripes-panel"]')
                                 .getAttribute('data-axis');
    expect(panelAxis).toBe('vertical');

    // Uniform update: the axis vec3 should now be (1, 0, 0).
    const axis = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return null;
        let val = null;
        sc.traverse((o) => {
            if (val) return;
            if (o && o.isMesh && o.material && o.material.name === 'forge.zebraStripes') {
                const u = o.material.uniforms;
                if (u && u.axis && u.axis.value) {
                    val = { x: u.axis.value.x, y: u.axis.value.y, z: u.axis.value.z };
                }
            }
        });
        return val;
    });
    console.log('[push-86] axis uniform =', axis);
    expect(axis).not.toBeNull();
    expect(Math.abs(axis.x - 1)).toBeLessThan(0.01);
    expect(Math.abs(axis.y)).toBeLessThan(0.01);
    expect(Math.abs(axis.z)).toBeLessThan(0.01);

    // ── Close the panel via the X button. The host restores every body
    // mesh's original material and disposes the shared ShaderMaterial.
    await page.locator('[data-testid="forge-zebra-stripes-close"]').click();
    await pause(500);
    await shot('after-close');

    await page.waitForFunction(
        () => window.__forgeZebraStripes?.active === false,
        null, { timeout: 4000 });

    // Panel is gone.
    const panelGone = await page.locator('[data-testid="forge-zebra-stripes-panel"]').count();
    expect(panelGone).toBe(0);

    // Every body mesh now has its original material back, and no
    // userData._origMaterial key remains.
    const restoreState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let totalBodies = 0;
        let stillShader = 0;
        let leftover = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData || !o.userData.body) return;
            totalBodies += 1;
            if (o.material && o.material.name === 'forge.zebraStripes') stillShader += 1;
            if (o.userData._origMaterial) leftover += 1;
        });
        return { totalBodies, stillShader, leftover };
    });
    console.log('[push-86] restoreState =', restoreState);
    expect(restoreState.totalBodies).toBeGreaterThan(0);
    expect(restoreState.stillShader).toBe(0);
    expect(restoreState.leftover).toBe(0);
});

test('04 — PUSH-65 regression: section plane panel still mounts (iso)', async () => {
    await cameraTo('iso');

    // PUSH-65 — Section Plane panel mounts cleanly. We just need to
    // prove the zebra-overlay host's mount-time mutations didn't break
    // the existing right-docked panel. We don't drive the full flow.
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('section-plane-mount');

    const stateText = await page.locator('[data-testid="forge-section-plane-state"]')
                                 .textContent();
    expect((stateText || '').trim()).toBe('disabled');

    // The zebra global is still readable — no leaks.
    const zebra = await page.evaluate(() => window.__forgeZebraStripes || null);
    expect(zebra).not.toBeNull();
    expect(zebra.active).toBe(false);

    await shot('regression-final-iso');
});
