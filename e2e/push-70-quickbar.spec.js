// PUSH-70 (Slice-38 / Display State QuickBar — always-on bottom-right HUD).
//
// Up through PUSH-69 there was no always-visible display-state monitor:
// the only way to switch shaded/wireframe/transparent was through the
// View menu (three clicks deep) or the HeadsUpToolbar (top-center, twelve
// unrelated tools). PUSH-70 lights up the bottom-right corner with a
// small QuickBar showing the current display state, three quick-toggle
// buttons (Shaded · Wireframe · Transparent), an axis indicator that
// follows the active view orientation, and a live FPS counter.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Assert the QuickBar mounts and is visible at the bottom-right.
//      Sanity-check that `window.__forgeDisplayState` is published on
//      mount and equals 'shaded' (the default).
//   3. Click the Wireframe button. Assert:
//        • The QuickBar's data-display-state attribute flips to 'wireframe'.
//        • The Wireframe button becomes data-active='true' and Shaded
//          becomes data-active='false'.
//        • The chip text reads "Wireframe".
//        • `window.__forgeDisplayState === 'wireframe'`.
//        • A `forge:display-state-changed` event fired with the new state.
//        • The canonical ForgeShellV4 path also reflects the change: the
//          existing HeadsUpToolbar's view.wireframe button is now
//          data-active='true' (proves the menu-action dispatch round-trips).
//   4. Click the Transparent button — assert chip + global signal + event.
//      (transparent is the QuickBar-only display state; we still assert
//      the QuickBar updated and the global signal published.)
//   5. Click the Shaded button — assert we round-trip back to shaded.
//   6. External-mutation regression: dispatch view.wireframe via the
//      menu-action bus directly (simulating the View menu or the HUT
//      sending an event). Assert the QuickBar's local state and chip
//      track the external change — proves the QuickBar is the single
//      subscriber-publisher and external surfaces update its UI.
//   7. View orientation regression: dispatch view.front, view.top, …
//      and assert the QuickBar's axis indicator picks up each one.
//   8. FPS counter: wait > 1.2 s so the rAF loop completes its first
//      1-second window, then assert the data-fps attribute is a finite
//      integer ≥ 1.
//   9. PUSH-67 regression: open the Measure tool via `tools.measure`
//      menu action and assert its panel still mounts — the QuickBar is
//      a portal sibling, must not collide with other panel hosts.
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + assert visible)
//   - front (click wireframe → assert)
//   - top   (click transparent → assert)
//   - right (click shaded → assert)
//   - iso   (external mutation + view-orientation + FPS + measure regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-70-quickbar');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'quickbar-session.mp4');

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

// Install a window-level capture for the forge:display-state-changed bus
// so the test can assert events fired, not just final state.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push70Events = [];
        window.addEventListener('forge:display-state-changed', (e) => {
            try { window.__push70Events.push({ state: e?.detail?.state, source: e?.detail?.source }); }
            catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push70Events || []);
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
        if (/push-70|quickbar|QuickBar|forge:display-state|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay; flip the
    // seen flag so it stays dormant for the whole run, then explicitly
    // skip if it raced in.
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
        console.error('[push-70] no .webm');
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
                console.log(`[push-70] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-70] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + QuickBar is visible bottom-right + __forgeDisplayState published', async () => {
    await cameraTo('iso');
    await shot('boot');
    await page.waitForSelector('[data-testid="forge-display-quickbar"]',
                               { state: 'visible', timeout: 8000 });
    // Capture events for later assertions.
    await installEventCapture();
    // The QuickBar should publish the canonical global signal on mount.
    const global = await page.evaluate(() => window.__forgeDisplayState);
    expect(global).toBe('shaded');
    // Chip + data attribute reflect the default.
    const chip = await page.locator('[data-testid="forge-display-quickbar-state"]').textContent();
    expect((chip || '').trim()).toBe('Shaded');
    const ds = await page.locator('[data-testid="forge-display-quickbar"]')
                         .getAttribute('data-display-state');
    expect(ds).toBe('shaded');
    // The shaded button is active.
    const shadedActive = await page.locator('[data-testid="forge-display-quickbar-shaded"]')
                                   .getAttribute('data-active');
    expect(shadedActive).toBe('true');
    const wireActive = await page.locator('[data-testid="forge-display-quickbar-wireframe"]')
                                 .getAttribute('data-active');
    expect(wireActive).toBe('false');
    const transActive = await page.locator('[data-testid="forge-display-quickbar-transparent"]')
                                  .getAttribute('data-active');
    expect(transActive).toBe('false');
    // Sanity: bar lives in the bottom-right.
    const box = await page.locator('[data-testid="forge-display-quickbar"]').boundingBox();
    expect(box).not.toBeNull();
    const vp = page.viewportSize();
    expect(box.x + box.width).toBeGreaterThan((vp?.width || 1920) * 0.75);
    expect(box.y + box.height).toBeGreaterThan((vp?.height || 1000) * 0.75);
    await shot('quickbar-visible');
});

test('01 — click Wireframe → state flips, global signal + event fire, HUT mirrors', async () => {
    await cameraTo('front');
    // Pre-click: capture event count baseline.
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    await page.locator('[data-testid="forge-display-quickbar-wireframe"]').click();
    await pause(400);
    await shot('clicked-wireframe');

    // Chip + data attribute updated.
    const ds = await page.locator('[data-testid="forge-display-quickbar"]')
                         .getAttribute('data-display-state');
    expect(ds).toBe('wireframe');
    const chip = await page.locator('[data-testid="forge-display-quickbar-state"]').textContent();
    expect((chip || '').trim()).toBe('Wireframe');

    // Wireframe is active, others are not.
    expect(await page.locator('[data-testid="forge-display-quickbar-wireframe"]')
                     .getAttribute('data-active')).toBe('true');
    expect(await page.locator('[data-testid="forge-display-quickbar-shaded"]')
                     .getAttribute('data-active')).toBe('false');
    expect(await page.locator('[data-testid="forge-display-quickbar-transparent"]')
                     .getAttribute('data-active')).toBe('false');

    // Global signal updated.
    const global = await page.evaluate(() => window.__forgeDisplayState);
    expect(global).toBe('wireframe');

    // forge:display-state-changed bus carried the change.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest?.state).toBe('wireframe');

    // The canonical ForgeShellV4 path round-tripped: the existing
    // HeadsUpToolbar's view.wireframe button is now data-active='true'.
    // (This is the strongest "did the shell actually flip too?" check —
    // the HUT reads the shell's displayState prop.)
    const hutWire = page.locator('[data-hut-id="view.wireframe"]');
    if (await hutWire.count() > 0) {
        // Wait briefly for React to flush the prop change.
        await page.waitForFunction(
            () => {
                const el = document.querySelector('[data-hut-id="view.wireframe"]');
                return el && el.getAttribute('data-active') === 'true';
            }, null, { timeout: 3000 });
        const hutShaded = page.locator('[data-hut-id="view.shaded"]');
        if (await hutShaded.count() > 0) {
            const s = await hutShaded.getAttribute('data-active');
            expect(s).toBe('false');
        }
    }
});

test('02 — click Transparent → chip + global signal track even when shell is unwired', async () => {
    await cameraTo('top');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    await page.locator('[data-testid="forge-display-quickbar-transparent"]').click();
    await pause(400);
    await shot('clicked-transparent');

    const ds = await page.locator('[data-testid="forge-display-quickbar"]')
                         .getAttribute('data-display-state');
    expect(ds).toBe('transparent');
    const chip = await page.locator('[data-testid="forge-display-quickbar-state"]').textContent();
    expect((chip || '').trim()).toBe('Transparent');

    expect(await page.locator('[data-testid="forge-display-quickbar-transparent"]')
                     .getAttribute('data-active')).toBe('true');
    expect(await page.locator('[data-testid="forge-display-quickbar-wireframe"]')
                     .getAttribute('data-active')).toBe('false');

    expect(await page.evaluate(() => window.__forgeDisplayState)).toBe('transparent');

    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest?.state).toBe('transparent');
});

test('03 — click Shaded → round-trip back, global signal restored', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    await page.locator('[data-testid="forge-display-quickbar-shaded"]').click();
    await pause(400);
    await shot('clicked-shaded');

    const ds = await page.locator('[data-testid="forge-display-quickbar"]')
                         .getAttribute('data-display-state');
    expect(ds).toBe('shaded');
    expect(await page.evaluate(() => window.__forgeDisplayState)).toBe('shaded');
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
});

test('04 — external view.wireframe via bus → QuickBar tracks + view orientation + FPS + Measure regression', async () => {
    await cameraTo('iso');

    // External mutation: dispatch the menu action straight on the bus,
    // exactly as the View menu / HeadsUpToolbar / Cmd+D would. The
    // QuickBar must catch it and update its UI, proving it's a real
    // subscriber, not a write-only widget.
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;
    await platformMenuAction('view.wireframe');
    await pause(400);

    const ds = await page.locator('[data-testid="forge-display-quickbar"]')
                         .getAttribute('data-display-state');
    expect(ds).toBe('wireframe');
    const chip = await page.locator('[data-testid="forge-display-quickbar-state"]').textContent();
    expect((chip || '').trim()).toBe('Wireframe');
    expect(await page.evaluate(() => window.__forgeDisplayState)).toBe('wireframe');
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);

    // Reset back to shaded so the rest of the regression starts clean.
    await platformMenuAction('view.shaded');
    await pause(300);
    expect(await page.locator('[data-testid="forge-display-quickbar"]')
                     .getAttribute('data-display-state')).toBe('shaded');

    // Axis indicator regression. Walk through the 7 named orientations
    // the View menu wires and assert the QuickBar's axis chip tracks.
    const views = ['iso', 'front', 'top', 'right', 'back', 'bottom', 'left'];
    for (const v of views) {
        await platformMenuAction(`view.${v}`);
        await pause(150);
        const axis = await page.locator('[data-testid="forge-display-quickbar-axis"]')
                               .getAttribute('data-view');
        expect(axis).toBe(v);
        const vname = await page.locator('[data-testid="forge-display-quickbar"]')
                                .getAttribute('data-view-name');
        expect(vname).toBe(v);
    }
    // End on iso for the final shot.
    await platformMenuAction('view.iso');
    await pause(200);

    // FPS counter regression. The rAF loop fires every frame and updates
    // state once per second. Wait > 1.2 s, then assert the counter
    // reports a positive integer.
    await pause(1400);
    const fpsAttr = await page.locator('[data-testid="forge-display-quickbar-fps"]')
                              .getAttribute('data-fps');
    const fps = Number(fpsAttr);
    console.log('[push-70] fps =', fps);
    expect(Number.isFinite(fps)).toBe(true);
    expect(fps).toBeGreaterThan(0);
    // No upper bound is asserted (the rAF rate ceiling depends on the
    // host display; on a 144-Hz Mac Studio the value can briefly exceed
    // 144 when frames cluster) — but we sanity-bound to <1000 so a NaN
    // or runaway counter would still fail.
    expect(fps).toBeLessThan(1000);

    // PUSH-67 regression: opening the Measure tool via the same bus must
    // still mount its panel. The QuickBar is a sibling portal; it must
    // not collide.
    await platformMenuAction('tools.measure');
    await page.waitForSelector('[data-testid="forge-measure-panel"]',
                               { state: 'visible', timeout: 6000 });
    // QuickBar must still be visible alongside the Measure panel.
    const qbVisible = await page.locator('[data-testid="forge-display-quickbar"]').isVisible();
    expect(qbVisible).toBe(true);

    await shot('regression-iso');
});
