// PUSH-71 (Slice-39 / Body Colours override panel).
//
// Up through PUSH-70 a body's display colour was a hash of its kernel
// handle (Viewport.jsx → colorForBody → HSL hash). Per PUSH-59 the
// helper now consults `window.__forgeBodyColors?.get(body.handle)`
// first, falling back to the handle-hash path when the Map has no
// entry for that handle. PUSH-71 ships the UI that actually writes to
// that Map: a right-docked panel that lists every native body, lets the
// user pick a colour per body, reset to default, or derive from material.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner; clear the persisted
//      colour store so the suite starts from a clean state.
//   2. Seed 2 native OCCT boxes (10×10×10 at origin, 20×20×20 at +30 X)
//      so each box has a distinct kernel handle.
//   3. Open Body Colours via the `tools.bodyColors` menu action. The
//      panel mounts and lists both bodies. The override count chip
//      reads "0/2".
//   4. Set body 1 to #ff0000 via the per-row colour input. Assert:
//        • window.__forgeBodyColors.get(handle1) === '#ff0000'.
//        • localStorage 'forge.v4.bodyColors' reflects the override.
//        • The override count chip flips to "1/2".
//        • A forge:body-colors-changed event fired.
//   5. Reset body 1 via its Reset button. The Map entry is removed; the
//      override count returns to "0/2".
//   6. Set body 2's material to "steel" (PUSH-61 bodyMaterials API), then
//      click body 2's "Match" button. Assert the Map entry is '#888888'
//      (the spec'd steel colour). Repeat for "aluminum" → '#aaaaaa',
//      "plastic" → '#33aa66', "titanium" → '#666666', "brass" → '#cc9900'.
//   7. PUSH-59 regression: opening the Interference panel after Body
//      Colours still works — both panels are right-docked and must not
//      collide on the menu-action bus, and the Interference panel also
//      writes nothing to __forgeBodyColors so the Map must survive.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel, list bodies)
//   - top   (set body 1 to #ff0000)
//   - right (reset body 1, exercise Match material)
//   - iso   (PUSH-59 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-71-body-colors');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'body-colors-session.mp4');

let app, page;
let stepIndex = 0;
let handle1 = null;
let handle2 = null;

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

// Install a window-level capture for the forge:body-colors-changed bus
// so the test can assert events fired, not just final state.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push71Events = [];
        window.addEventListener('forge:body-colors-changed', (e) => {
            try { window.__push71Events.push({ count: Object.keys(e?.detail?.colors || {}).length }); }
            catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push71Events || []);
}
async function readMapEntry(handle) {
    return await page.evaluate((h) => {
        const m = window.__forgeBodyColors;
        return (m instanceof Map) ? (m.get(h) || null) : null;
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
        if (/push-71|body-colors|BodyColors|forge|error|Error/i.test(t)) {
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
    // Clear any persisted body colour overrides from a previous suite
    // run so this test starts from the empty-Map baseline the spec promises.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.bodyColors'); } catch {}
        // Also blow away the live window mirror so a stale Map from a
        // previous test doesn't poison the first assertion. The Host's
        // useEffect will re-publish the empty store on the next mount,
        // but the panel doesn't remount per test — clear the Map by hand.
        if (window.__forgeBodyColors instanceof Map) {
            window.__forgeBodyColors.clear();
        }
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
        console.error('[push-71] no .webm'); return;
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
                console.log(`[push-71] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-71] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed 2 native boxes (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const h1 = f.makeBox(10, 10, 10);
        const h2raw = f.makeBox(20, 20, 20);
        const h2 = f.translate(h2raw, 30, 0, 0);
        if (typeof h1 !== 'number' || typeof h2 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-71-1', kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Box 1 (10)',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: 'f-box-71-2', kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Box 2 (20 @ +30 X)',
            params: { width: 20, height: 20, distance: 20 },
        });
        return { h1, h2 };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    handle1 = seeded.h1;
    handle2 = seeded.h2;
    console.log('[push-71] seeded handles =', handle1, handle2);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open Body Colours via tools.bodyColors, lists both bodies (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.bodyColors');
    await page.waitForSelector('[data-testid="forge-body-colors-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');
    // Both body rows visible.
    await expect(page.locator(`[data-testid="forge-body-colors-input-${handle1}"]`)).toBeVisible();
    await expect(page.locator(`[data-testid="forge-body-colors-input-${handle2}"]`)).toBeVisible();
    // Override count chip says 0/2.
    const countChip = await page.locator('[data-testid="forge-body-colors-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('0/2');
    // Panel data attribute reflects 0 overrides.
    const overrideCount = await page.locator('[data-testid="forge-body-colors-panel"]')
                                     .getAttribute('data-override-count');
    expect(overrideCount).toBe('0');
    // Install the event capture before the first mutation.
    await installEventCapture();
});

test('02 — set body 1 to #ff0000 via colour input → Map + storage + bus reflect (top)', async () => {
    await cameraTo('top');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    // The HTML5 `<input type="color">` fires onChange on every commit.
    // Playwright's .fill() doesn't dispatch input events on color inputs
    // reliably across browsers; use evaluate() to set value + dispatch
    // the matching React-friendly onChange that the panel listens for.
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="forge-body-colors-input-${args.handle}"]`);
        if (!el) throw new Error('color input not found');
        // React 19 reads value via the native property setter. Bypass
        // the wrapper so the synthetic event sees the new value.
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, args.color);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { handle: handle1, color: '#ff0000' });
    await pause(400);
    await shot('body1-red');

    // The window mirror Map has the override.
    const mapEntry = await readMapEntry(handle1);
    console.log('[push-71] map entry for handle1 =', mapEntry);
    expect(mapEntry).toBe('#ff0000');

    // localStorage carries it too.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.bodyColors') || '{}');
        } catch { return null; }
    });
    console.log('[push-71] persisted store after set =', persisted);
    expect(persisted).not.toBeNull();
    expect(persisted.colors[String(handle1)]).toBe('#ff0000');

    // The override count chip flipped to 1/2.
    const countChip = await page.locator('[data-testid="forge-body-colors-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('1/2');

    // The row data-override attribute reflects the new colour.
    const rowOverride = await page.locator(`[data-testid="forge-body-colors-input-${handle1}"]`)
                                   .locator('..')
                                   .getAttribute('data-override');
    expect(rowOverride).toBe('#ff0000');

    // The body-colors-changed bus event fired with the new state.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.count).toBe(1);
});

test('03 — Reset button on body 1 removes the override (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    await page.locator(`[data-testid="forge-body-colors-reset-${handle1}"]`).click();
    await pause(400);
    await shot('body1-reset');

    // The window mirror Map no longer has the override.
    const mapEntry = await readMapEntry(handle1);
    expect(mapEntry).toBeNull();

    // localStorage no longer carries it.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.bodyColors') || '{}');
        } catch { return null; }
    });
    expect(persisted).not.toBeNull();
    expect(persisted.colors[String(handle1)]).toBeUndefined();

    // The override count chip flipped back to 0/2.
    const countChip = await page.locator('[data-testid="forge-body-colors-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('0/2');

    // The Reset button is now disabled (no override to reset).
    const disabled = await page.locator(`[data-testid="forge-body-colors-reset-${handle1}"]`)
                                .getAttribute('disabled');
    expect(disabled).not.toBeNull();

    // The bus event fired.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
});

test('04 — Match material derives spec\'d colours for steel/aluminum/plastic/titanium/brass (right)', async () => {
    // Exhaustively walk every material the brief calls out. For each,
    // poke the bodyMaterials Map directly (the canonical PUSH-61 surface
    // — the panel reads through it), click body 2's Match button, and
    // assert the window mirror Map landed on the spec'd hex.
    const spec = [
        ['steel',     '#888888'],
        ['aluminum',  '#aaaaaa'],
        ['plastic',   '#33aa66'],
        ['titanium',  '#666666'],
        ['brass',     '#cc9900'],
    ];
    for (const [material, expectedHex] of spec) {
        await page.evaluate((args) => {
            // The bodyMaterials helper exposes a programmatic setter
            // that mirrors into the legacy Map. Use it when present,
            // otherwise patch the Map directly.
            const helper = window.__forgeBodyMaterialsHelper;
            if (helper && typeof helper.setBodyMaterial === 'function') {
                helper.setBodyMaterial(args.handle, args.material);
            } else {
                if (!(window.__forgeBodyMaterials instanceof Map)) {
                    window.__forgeBodyMaterials = new Map();
                }
                window.__forgeBodyMaterials.set(args.handle, args.material);
                window.__forgeBodyMaterials.set(String(args.handle), args.material);
            }
        }, { handle: handle2, material });
        await pause(200);
        await page.locator(`[data-testid="forge-body-colors-match-${handle2}"]`).click();
        await pause(300);
        const mapEntry = await readMapEntry(handle2);
        console.log(`[push-71] match ${material} → map =`, mapEntry, 'expected =', expectedHex);
        expect(mapEntry).toBe(expectedHex);
    }
    await shot('match-material-walked');

    // The override count chip says 1/2 (only body 2 has an override now).
    const countChip = await page.locator('[data-testid="forge-body-colors-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('1/2');
});

test('05 — PUSH-59 regression: Interference panel still mounts + writes nothing to body-colors Map (iso)', async () => {
    await cameraTo('iso');
    // The Map currently has body 2's override from test 04. Snapshot it
    // before opening the Interference panel so we can prove the panel
    // does not touch __forgeBodyColors.
    const before = await page.evaluate(() => {
        const m = window.__forgeBodyColors;
        if (!(m instanceof Map)) return null;
        return Array.from(m.entries()).map(([k, v]) => [k, v]);
    });
    expect(before).not.toBeNull();
    expect(before.length).toBe(1);

    // Open the Interference panel via its menu action. PUSH-59 mounts
    // this panel and auto-scans on open. The panel is right-docked
    // alongside Body Colours; both must coexist in the DOM.
    await platformMenuAction('tools.interference');
    await page.waitForSelector('[data-testid="forge-interference-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(800);
    await shot('interference-regression');

    // The Body Colours panel should still be mounted alongside it.
    await expect(page.locator('[data-testid="forge-body-colors-panel"]'))
        .toBeAttached();

    // The Map should be untouched.
    const after = await page.evaluate(() => {
        const m = window.__forgeBodyColors;
        if (!(m instanceof Map)) return null;
        return Array.from(m.entries()).map(([k, v]) => [k, v]);
    });
    expect(after).not.toBeNull();
    expect(after.length).toBe(1);
    expect(after[0][0]).toBe(before[0][0]);
    expect(after[0][1]).toBe(before[0][1]);
});
