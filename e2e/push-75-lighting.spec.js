// PUSH-75 (Slice-43 / Lighting / Environment controls PANEL).
//
// Up through PUSH-74 the Forge viewport ran on hard-coded ambient /
// directional intensities + a fixed dark-grey background. There was no
// reachable UI to tweak them. PUSH-75 ships a real right-docked
// *Lighting* panel with:
//   • Ambient intensity slider     (0 → 2)
//   • Key (directional) intensity  (0 → 2)
//   • Key direction azimuth        (0 → 360°)
//   • Key direction elevation      (-90° → 90°)
//   • Background colour picker     (HTML5 #rrggbb)
//   • Reset-to-defaults button
//   • Persistence (localStorage `forge.v4.lighting`)
//   • Reachable through tools.lightingEnv menu action
//
// Viewport.jsx is NOT modified per the slice contract — the panel writes
// the full lighting state into the global `window.__forgeLighting` and
// emits `forge:lighting-changed` so a future viewport subscriber can
// pick it up. For this slice the e2e asserts that:
//
//   1. The Host hydrates `window.__forgeLighting` at mount time from
//      localStorage (or defaults).
//   2. Opening the panel via tools.lightingEnv brings up the docked panel.
//   3. Scrubbing the Ambient slider to 1.5 lands on
//      `window.__forgeLighting.ambient === 1.5` AND on the persisted
//      `forge.v4.lighting` localStorage entry AND fires the
//      `forge:lighting-changed` bus event with the same value.
//   4. Tweaking the other axes — Key, Azimuth, Elevation, Background —
//      each round-trips through the global the same way.
//   5. Reset-to-defaults snaps state back to the canonical defaults.
//   6. PUSH-65 regression: opening Section Plane via tools.sectionPlane
//      still works — the Lighting host is a portal sibling and must not
//      collide with other right-docked panels.
//
// Multi-cam: 5 named angles (iso / front / top / right / iso final)
// per the Forge-171 multi-cam mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-75-lighting');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'lighting-session.mp4');

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
    await pause(350);
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
        if (/push-75|lighting|Lighting|forge:lighting|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour intercepts pointer events on every panel
    // button. Mark it seen and dismiss any racing skip button.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    // Clear any persisted lighting from a prior suite run so the test
    // starts from the canonical defaults baseline. We DO NOT delete the
    // live window.__forgeLighting global — the Host mount-effect set it
    // when the React tree mounted, so test 00 can assert it's truthy.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.lighting'); } catch {}
    });
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
        console.error('[push-75] no .webm');
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
                console.log(`[push-75] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-75] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global hydrated to defaults (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The LightingPanelHost's mount effect publishes the defaults onto
    // window.__forgeLighting the instant the React tree mounts —
    // BEFORE the user ever opens the panel. We assert that surface is
    // live and shaped correctly.
    await page.waitForFunction(
        () => typeof window.__forgeLighting === 'object'
           && window.__forgeLighting !== null,
        null, { timeout: 8000 });
    const defaults = await page.evaluate(() => window.__forgeLighting);
    console.log('[push-75] defaults =', defaults);
    expect(defaults).toBeTruthy();
    // Numeric axes inside legal bounds. We accept whatever non-NaN value
    // is in place — if a prior suite run persisted custom values, the
    // Host hydrates from those; on a fresh install the persistence is
    // empty and the canonical defaults land here.
    expect(typeof defaults.ambient).toBe('number');
    expect(typeof defaults.key).toBe('number');
    expect(typeof defaults.azimuth).toBe('number');
    expect(typeof defaults.elevation).toBe('number');
    expect(typeof defaults.background).toBe('string');
    expect(/^#[0-9a-f]{6}$/.test(defaults.background)).toBe(true);

    // The Host opener hooks are also installed.
    const hooks = await page.evaluate(() => ({
        open: typeof window.__forgeOpenLighting,
        close: typeof window.__forgeCloseLighting,
    }));
    expect(hooks.open).toBe('function');
    expect(hooks.close).toBe('function');
});

test('01 — open Lighting panel via tools.lightingEnv menu (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.lightingEnv');
    await page.waitForSelector('[data-testid="forge-lighting-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel publishes its current state on data-* attributes — easy
    // assertion target that doesn't depend on querying the React internals.
    const panel = page.locator('[data-testid="forge-lighting-panel"]');
    const ambientAttr   = await panel.getAttribute('data-ambient');
    const keyAttr       = await panel.getAttribute('data-key');
    const azimuthAttr   = await panel.getAttribute('data-azimuth');
    const elevationAttr = await panel.getAttribute('data-elevation');
    const bgAttr        = await panel.getAttribute('data-background');
    // These mirror the global at panel-open time. We just sanity-check
    // they're parseable / well-formed; specific values come in test 02
    // after the explicit fills below.
    expect(Number.isFinite(Number(ambientAttr))).toBe(true);
    expect(Number.isFinite(Number(keyAttr))).toBe(true);
    expect(Number.isFinite(Number(azimuthAttr))).toBe(true);
    expect(Number.isFinite(Number(elevationAttr))).toBe(true);
    expect(/^#[0-9a-f]{6}$/.test(String(bgAttr))).toBe(true);

    // The 4 sliders + the colour input are all present.
    await expect(page.locator('[data-testid="forge-lighting-ambient"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-lighting-key"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-lighting-azimuth"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-lighting-elevation"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-lighting-background"]')).toBeVisible();
});

test('02 — scrub Ambient → 1.5, global + bus + localStorage all updated (top)', async () => {
    await cameraTo('top');

    // Install a bus listener BEFORE we mutate so the dispatch is captured
    // deterministically. The detail object should mirror the new state.
    await page.evaluate(() => {
        window.__push75BusDetail = null;
        const onLighting = (e) => { window.__push75BusDetail = e?.detail || null; };
        window.__push75BusListener = onLighting;
        window.addEventListener('forge:lighting-changed', onLighting);
    });

    // Scrub the Ambient slider to 1.5. fill() on <input type=range> fires
    // the input + change events through React's controlled-input
    // pipeline — same path the user takes.
    const slider = page.locator('[data-testid="forge-lighting-ambient"]');
    await slider.fill('1.5');
    await pause(300);
    await shot('ambient-1.5');

    // ── PUSH-75 spec contract ──
    const live = await page.evaluate(() => ({
        global:   window.__forgeLighting || null,
        bus:      window.__push75BusDetail || null,
        stored:   (() => {
            try {
                const raw = window.localStorage.getItem('forge.v4.lighting');
                return raw ? JSON.parse(raw) : null;
            } catch { return null; }
        })(),
    }));
    console.log('[push-75] after ambient=1.5 →', live);

    expect(live.global).not.toBeNull();
    expect(live.global.ambient).toBeCloseTo(1.5, 5);

    // Bus event fired with the new state.
    expect(live.bus).not.toBeNull();
    expect(live.bus.ambient).toBeCloseTo(1.5, 5);

    // Persisted to localStorage.
    expect(live.stored).not.toBeNull();
    expect(live.stored.ambient).toBeCloseTo(1.5, 5);

    // Readout chip mirrors the published state.
    const ambientReadout = await page.locator(
        '[data-testid="forge-lighting-ambient-readout"]').getAttribute('data-value');
    expect(Number(ambientReadout)).toBeCloseTo(1.5, 5);
});

test('03 — Key 0.25, Azimuth 200°, Elevation -45°, Background #ff8800 (right)', async () => {
    await cameraTo('right');

    // Each slider mutation fans out through the same publish path. We
    // scrub them in sequence and snapshot the global at the end so we
    // know they composed correctly into a single state object.
    await page.locator('[data-testid="forge-lighting-key"]').fill('0.25');
    await pause(200);
    await page.locator('[data-testid="forge-lighting-azimuth"]').fill('200');
    await pause(200);
    await page.locator('[data-testid="forge-lighting-elevation"]').fill('-45');
    await pause(200);

    // <input type=color> needs careful evaluate() because React's
    // controlled-input layer overrides the value setter on the element.
    // We have to use the native HTMLInputElement.prototype setter and
    // then dispatch the input event so React's synthetic event system
    // picks up the new value. This is the documented React pattern for
    // driving controlled inputs from Playwright.
    await page.locator('[data-testid="forge-lighting-background"]').evaluate((el) => {
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, '#ff8800');
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await pause(300);
    await shot('multi-axis-update');

    const state = await page.evaluate(() => window.__forgeLighting || null);
    console.log('[push-75] after multi-axis →', state);
    expect(state).not.toBeNull();
    // Ambient unchanged from the previous test.
    expect(state.ambient).toBeCloseTo(1.5, 5);
    expect(state.key).toBeCloseTo(0.25, 5);
    expect(state.azimuth).toBeCloseTo(200, 5);
    expect(state.elevation).toBeCloseTo(-45, 5);
    expect(state.background).toBe('#ff8800');

    // The colour picker's data-* attr should also mirror the value.
    const bgAttr = await page.locator(
        '[data-testid="forge-lighting-background-readout"]').getAttribute('data-value');
    expect(bgAttr).toBe('#ff8800');

    // Persistence — every axis ends up in the JSON blob.
    const stored = await page.evaluate(() => {
        try {
            const raw = window.localStorage.getItem('forge.v4.lighting');
            return raw ? JSON.parse(raw) : null;
        } catch { return null; }
    });
    expect(stored).not.toBeNull();
    expect(stored.key).toBeCloseTo(0.25, 5);
    expect(stored.azimuth).toBeCloseTo(200, 5);
    expect(stored.elevation).toBeCloseTo(-45, 5);
    expect(stored.background).toBe('#ff8800');
});

test('04 — Reset-to-defaults snaps state back + push-65 regression (iso final)', async () => {
    await cameraTo('iso');

    // Click Reset-to-defaults. State should snap back to the canonical
    // factory blob — and that blob should round-trip into the global +
    // localStorage in lockstep.
    await page.locator('[data-testid="forge-lighting-reset"]').click();
    await pause(300);
    await shot('after-reset');

    const reset = await page.evaluate(() => ({
        global: window.__forgeLighting || null,
        stored: (() => {
            try {
                const raw = window.localStorage.getItem('forge.v4.lighting');
                return raw ? JSON.parse(raw) : null;
            } catch { return null; }
        })(),
    }));
    console.log('[push-75] after reset →', reset);
    expect(reset.global).not.toBeNull();
    expect(reset.global.ambient).toBeCloseTo(0.5, 5);
    expect(reset.global.key).toBeCloseTo(1.0, 5);
    expect(reset.global.azimuth).toBeCloseTo(45, 5);
    expect(reset.global.elevation).toBeCloseTo(30, 5);
    expect(reset.global.background).toBe('#1e1e1e');
    expect(reset.stored).not.toBeNull();
    expect(reset.stored.ambient).toBeCloseTo(0.5, 5);

    // Clean up the bus listener we installed in test 02.
    await page.evaluate(() => {
        const fn = window.__push75BusListener;
        if (fn) window.removeEventListener('forge:lighting-changed', fn);
    });

    // ── PUSH-65 regression ──
    // The Lighting host is a portal sibling and must not collide with
    // any other right-docked panel — Section Plane is the same dock.
    // Open it and assert both panels are mounted side-by-side.
    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    const lightVisible = await page.locator(
        '[data-testid="forge-lighting-panel"]').isVisible();
    const sectionVisible = await page.locator(
        '[data-testid="forge-section-plane-panel"]').isVisible();
    expect(lightVisible).toBe(true);
    expect(sectionVisible).toBe(true);

    await shot('lighting-section-coexists');
});
