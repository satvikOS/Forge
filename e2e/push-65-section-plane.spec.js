// PUSH-65 (Slice-33 / Section Plane control PANEL for the live viewport).
//
// The kernel has shipped Three.js material clipping planes wired off
// `sectionPlane = { enabled, axis, offset }` since Forge-118, and the
// shell subscribes to `forge:section-update` to drive it. Up through
// PUSH-64 the only producer was the tiny `SectionControl` HUD pinned
// near the workbench rail — it works, but it isn't reachable from the
// Tools menu and isn't really a panel. PUSH-65 ships a real right-docked
// Section Plane *panel* with:
//   • toggle (ON / OFF)
//   • X / Y / Z axis radio
//   • body-bbox-aware offset slider (range padded ±10 % per side)
//   • live readout of axis + offset in mm
//   • reachable through `tools.sectionPlane`
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Seed a real OCCT 40×40×40 native box at the origin. The bbox is
//      [-20, -20, 0] → [+20, +20, 40] so an axis-Z offset of 20 mm puts
//      the cutting plane exactly halfway through the body.
//   3. Open Section Plane via `tools.sectionPlane`. The panel mounts and
//      shows axis Z (default) + disabled.
//   4. Toggle enabled = true, axis = Z (already), offset slider → 20.
//   5. Assert `window.__forgeSectionPlane.enabled === true`,
//      `.axis === 'Z'`, and `|.offset - 20| < 0.5` (slider step floor).
//   6. Flip to axis X to prove the radio rewires + clamp logic, then back
//      to Z so the final readout matches the test contract.
//   7. Final iso shot.
//
// Multi-cam: 5 named angles (iso / front / top / right / iso final) per
// Forge-171 multi-cam mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-65-section-plane');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'section-plane-session.mp4');

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
        if (/push-65|sectionPlane|SectionPlane|forge:section|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
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
        console.error('[push-65] no .webm');
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
                console.log(`[push-65] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-65] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed a 40×40×40 native box', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 40, 40);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-65', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x40x40',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    boxHandle = seeded.handle;
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('01 — open Section Plane via tools.sectionPlane menu', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Default state — disabled, axis Z, offset 0. The readout chip is the
    // single source of truth (it mirrors React state, not the window
    // globals — assertions on either are equivalent here).
    const initialState = await page.locator('[data-testid="forge-section-plane-state"]').textContent();
    const initialAxis  = await page.locator('[data-testid="forge-section-plane-axis-readout"]').textContent();
    console.log('[push-65] initial state =', initialState, 'axis =', initialAxis);
    expect((initialState || '').trim()).toBe('disabled');
    expect((initialAxis  || '').trim()).toBe('Z');
});

test('02 — enable + set axis Z + offset 20 mm', async () => {
    await cameraTo('top');

    // Toggle enabled. Playwright's check() respects the native checkbox
    // input semantics, so the React onChange fires identically to a user
    // click — no `evaluate(window.click)` cheating.
    await page.locator('[data-testid="forge-section-plane-enabled"]').check();
    await pause(200);

    // Axis Z is the default — assert that radio is checked then click it
    // anyway to prove the click handler fires without bugging out.
    const axisZRadio = page.locator('[data-testid="forge-section-plane-axis-Z"]');
    await expect(axisZRadio).toBeChecked();
    await axisZRadio.check();
    await pause(150);

    // Scrub the offset slider to 20 mm. The slider's [min,max] is the
    // body's Z bbox padded ±10 %, so [-4, 44]; the value 20 is safely in
    // range and corresponds to "right through the middle" of the cube.
    // We set the value programmatically through React (fill() works on
    // <input type=range>) — Playwright wires the input event correctly.
    const slider = page.locator('[data-testid="forge-section-plane-offset"]');
    await slider.fill('20');
    await pause(250);

    await shot('section-on-z-20');

    // The publish effect writes to window.__forgeSectionPlane on every
    // state change — the spec calls this out as the new explicit channel
    // for downstream readers.
    const live = await page.evaluate(() => {
        return {
            plane:  window.__forgeSectionPlane || null,
            legacy: window.__forgeSection || null,
        };
    });
    console.log('[push-65] window.__forgeSectionPlane =', live.plane);
    console.log('[push-65] window.__forgeSection      =', live.legacy);

    expect(live.plane).not.toBeNull();
    expect(live.plane.enabled).toBe(true);
    expect(live.plane.axis).toBe('Z');
    expect(typeof live.plane.offset).toBe('number');
    expect(Math.abs(live.plane.offset - 20)).toBeLessThan(0.5);

    // Legacy global is published in lockstep so the existing HUD
    // subscribers don't get desynced.
    expect(live.legacy).not.toBeNull();
    expect(live.legacy.enabled).toBe(true);
    expect(live.legacy.axis).toBe('Z');

    // Readout chip mirrors the published plane.
    const offTxt = await page.locator('[data-testid="forge-section-plane-offset-readout"]')
                            .textContent();
    const offAttr = await page.locator('[data-testid="forge-section-plane-offset-readout"]')
                              .getAttribute('data-offset-mm');
    console.log('[push-65] offset readout =', offTxt, '/ data attr =', offAttr);
    expect(Math.abs(Number(offAttr) - 20)).toBeLessThan(0.5);
});

test('03 — axis flip X clamps offset into the new axis range', async () => {
    await cameraTo('right');

    // Switch to axis X. The body's X bbox is [-20, +20] padded ±10 %
    // → [-22, +22]. The offset 20 was inside the Z range; in the X range
    // it's still inside, so the clamp is a no-op — that's intentional,
    // we're proving the clamp doesn't *over*-clamp on a valid value.
    await page.locator('[data-testid="forge-section-plane-axis-X"]').check();
    await pause(250);
    await shot('axis-x');

    const stateAfter = await page.evaluate(() => window.__forgeSectionPlane || null);
    console.log('[push-65] after axis=X →', stateAfter);
    expect(stateAfter.axis).toBe('X');
    expect(stateAfter.enabled).toBe(true);
    // The X range is [-22, +22] (40 × 1.1), so offset 20 must still pass.
    expect(stateAfter.offset).toBeGreaterThanOrEqual(-22);
    expect(stateAfter.offset).toBeLessThanOrEqual(22);
});

test('04 — flip back to axis Z, contract: enabled=true, axis=Z, offset≈20', async () => {
    await cameraTo('iso');

    await page.locator('[data-testid="forge-section-plane-axis-Z"]').check();
    await pause(200);
    // Re-scrub to 20 in case the X flip nudged the slider's read of the
    // shared `plane.offset` state (it shouldn't — the value is preserved
    // across axis flips so long as it's in-range — but pin it explicitly
    // so the final assertion is deterministic).
    await page.locator('[data-testid="forge-section-plane-offset"]').fill('20');
    await pause(250);
    await shot('final-z-20');

    // ── The PUSH-65 spec contract ──
    const final = await page.evaluate(() => window.__forgeSectionPlane || null);
    console.log('[push-65] FINAL window.__forgeSectionPlane =', final);
    expect(final).not.toBeNull();
    expect(final.enabled).toBe(true);
    expect(final.axis).toBe('Z');
    expect(Math.abs(final.offset - 20)).toBeLessThan(0.5);

    // The bus event is what the viewport actually listens to (Forge-118
    // subscribes via forge:section-update). Capture one final emission
    // round-trip to prove the pipeline is still wired live. We install
    // the listener BEFORE we trigger the next state mutation so the bus
    // detail is captured deterministically — Playwright's evaluate-then-
    // act sequencing is preserved across the two calls.
    await page.evaluate(() => {
        window.__push65BusDetail = null;
        const onUpd = (e) => { window.__push65BusDetail = e.detail || null; };
        window.__push65BusListener = onUpd;
        window.addEventListener('forge:section-update', onUpd);
    });
    // Toggling enabled off and back on round-trips through React's
    // controlled-input pipeline (Playwright's check()/uncheck() hits the
    // native click semantics, which React picks up correctly — unlike
    // raw `el.value=…` which React's synthetic event layer skips).
    await page.locator('[data-testid="forge-section-plane-enabled"]').uncheck();
    await pause(150);
    await page.locator('[data-testid="forge-section-plane-enabled"]').check();
    await pause(250);
    const busDetail = await page.evaluate(() => {
        const d = window.__push65BusDetail;
        const fn = window.__push65BusListener;
        if (fn) window.removeEventListener('forge:section-update', fn);
        return d;
    });
    console.log('[push-65] forge:section-update detail =', busDetail);
    expect(busDetail).not.toBeNull();
    expect(busDetail.enabled).toBe(true);
    expect(busDetail.axis).toBe('Z');

    // Multi-cam final.
    await shot('section-live-iso');
});
