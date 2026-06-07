// PUSH-92 (Slice-60 / GD&T Feature Control Frames panel).
//
// PUSH-78 shipped quick free-text PMI notes (Datum / Tolerance / Finish /
// Weld) where the user typed "⌖ Ø0.1 A B C" by hand. PUSH-92 ships the
// structured BUILDER that authors the same string from constituent
// dropdowns so the result is guaranteed-valid ASME Y14.5 syntax.
//
// Frame anatomy:
//   [tolerance symbol]
//   | [Ø?] tolerance value [M / L / F modifier?]
//   | primary datum [M / L / F modifier?]
//   | secondary datum [M / L / F modifier?]
//   | tertiary datum [M / L / F modifier?]
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner; clear the persisted
//      GD&T store + window mirror so the suite starts empty.
//   2. Seed 1 native OCCT box so the scene is non-empty (parity with
//      PUSH-78 e2e baseline — Mass Props regression needs a body).
//   3. Open the GD&T Frames panel via `tools.gdtFrames` menu action.
//      Assert the panel mounts; the count chip reads "0"; the
//      empty-state message is visible; all required form widgets are
//      present (symbol dropdown, value input, modifier dropdown, 3 datum
//      letter inputs + 3 datum modifier dropdowns, preview, Add button).
//   4. Build a Position 0.1 Ø MMC | A M frame:
//        - Symbol → 'position'
//        - Tolerance value → '0.1'
//        - Diameter (Ø) → checked
//        - Tolerance modifier → 'M' (MMC)
//        - Datum A letter → 'A', Datum A modifier → 'M'
//      Assert the live preview reads exactly "⌖|Ø0.1 Ⓜ|A Ⓜ"; click Add;
//      assert window.__forgeGdtFrames length === 1 and the first frame's
//      symbol === 'Position' (label form), symbolId === 'position',
//      formatted matches the preview.
//   5. Build a Flatness 0.05 frame (no diameter, no modifier, no
//      datums — proves the Form-tolerance happy path with empty datums).
//      Assert __forgeGdtFrames.length === 2 and the second frame's
//      symbol === 'Flatness'.
//   6. PUSH-78 regression: open the PMI Annotations panel and assert
//      that __forgePmi is its own untouched array — the two panels must
//      share neither storage nor mutator state.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed body)
//   - front (open panel, assert empty state + widgets)
//   - top   (build Position 0.1 Ø MMC | A M frame + assert)
//   - right (build Flatness 0.05 frame + assert)
//   - iso   (PUSH-78 regression — PMI Annotations coexistence)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-92-gdt-frames');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'gdt-frames-session.mp4');

let app, page;
let stepIndex = 0;
let bodyHandle = null;

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

// Set an input's value through the native setter so React's onChange
// fires. Playwright's .fill() doesn't always dispatch the matching
// React synthetic event on controlled inputs.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = (el.tagName === 'TEXTAREA')
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(el, args.value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

// Capture the forge:gdt-frames-changed bus so the test can assert
// events fired, not just final array state.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push92Events = [];
        window.addEventListener('forge:gdt-frames-changed', (e) => {
            try {
                window.__push92Events.push({
                    count: Array.isArray(e?.detail?.frames) ? e.detail.frames.length : -1,
                });
            } catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push92Events || []);
}
async function readFrames() {
    return await page.evaluate(() => {
        const arr = window.__forgeGdtFrames;
        return Array.isArray(arr) ? arr.slice() : null;
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
        if (/push-92|gdt-frames|GdtFrame|forge|error|Error/i.test(t)) {
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
    // Clear any persisted GD&T frames from a previous suite run + reset
    // the live window mirror so this test starts from the empty-array
    // baseline the spec promises.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.gdtFrames'); } catch {}
        if (Array.isArray(window.__forgeGdtFrames)) {
            window.__forgeGdtFrames.length = 0;
        } else {
            window.__forgeGdtFrames = [];
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
        console.error('[push-92] no .webm'); return;
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
                console.log(`[push-92] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-92] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed a native box (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') {
            return { error: 'forge.makeBox unavailable' };
        }
        const h = f.makeBox(40, 40, 40);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id: 'f-box-92', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40 (PUSH-92)',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h).toBeGreaterThan(0);
    bodyHandle = seeded.h;
    console.log('[push-92] seeded body handle =', bodyHandle);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('01 — open GD&T Frames via tools.gdtFrames → empty panel (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.gdtFrames');
    await page.waitForSelector('[data-testid="forge-gdt-frames-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open-empty');

    // Count chip reads 0.
    const countChip = await page.locator('[data-testid="forge-gdt-frames-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('0');

    // The panel data attribute confirms it.
    const frameCount = await page.locator('[data-testid="forge-gdt-frames-panel"]')
                                  .getAttribute('data-frame-count');
    expect(frameCount).toBe('0');

    // Empty state visible.
    await expect(page.locator('[data-testid="forge-gdt-frames-empty"]'))
        .toBeVisible();

    // Required widgets present.
    await expect(page.locator('[data-testid="forge-gdt-frames-symbol"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-value"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-diameter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-tol-modifier"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-a-letter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-a-modifier"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-b-letter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-b-modifier"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-c-letter"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-datum-c-modifier"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-gdt-frames-add"]')).toBeVisible();

    // The window mirror is an empty array (the host's bootstrap publish
    // sync'd the empty store on mount).
    const frames = await readFrames();
    expect(frames).not.toBeNull();
    expect(frames.length).toBe(0);

    // Install the event capture before the first mutation.
    await installEventCapture();
});

test('02 — build Position 0.1 Ø MMC | A M frame → length=1 (top)', async () => {
    await cameraTo('top');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    // Symbol → position. (The panel defaults to position; assert + select
    // explicitly so the spec is self-documenting and a future default
    // change doesn't silently break the test.)
    await page.locator('[data-testid="forge-gdt-frames-symbol"]').selectOption('position');
    await pause(100);

    // Tolerance value → 0.1 (panel defaults to '0.1'; set explicitly).
    await setReactInput('forge-gdt-frames-value', '0.1');

    // Diameter prefix → checked (default true). Assert + ensure-checked.
    const diaCheckbox = page.locator('[data-testid="forge-gdt-frames-diameter"]');
    const isChecked = await diaCheckbox.isChecked();
    if (!isChecked) await diaCheckbox.check();

    // Tolerance modifier → M (panel defaults to 'M'; set explicitly).
    await page.locator('[data-testid="forge-gdt-frames-tol-modifier"]').selectOption('M');

    // Primary datum letter → A, modifier → M.
    await setReactInput('forge-gdt-frames-datum-a-letter', 'A');
    await page.locator('[data-testid="forge-gdt-frames-datum-a-modifier"]').selectOption('M');

    // Secondary / tertiary stay blank.
    await setReactInput('forge-gdt-frames-datum-b-letter', '');
    await setReactInput('forge-gdt-frames-datum-c-letter', '');
    await pause(200);

    // Live preview reads exactly the canonical Y14.5 form.
    const preview = await page.locator('[data-testid="forge-gdt-frames-preview"]')
                               .textContent();
    console.log('[push-92] preview =', JSON.stringify(preview));
    expect((preview || '').trim()).toBe('⌖|Ø0.1 Ⓜ|A Ⓜ');

    // Add button is enabled (numeric tolerance entered).
    const addEnabled = await page.locator('[data-testid="forge-gdt-frames-add"]')
                                  .isEnabled();
    expect(addEnabled).toBe(true);

    await page.locator('[data-testid="forge-gdt-frames-add"]').click();
    await pause(400);
    await shot('after-position');

    // window.__forgeGdtFrames has 1 entry — the headline assertion.
    const frames = await readFrames();
    console.log('[push-92] frames after add =', JSON.stringify(frames));
    expect(frames).not.toBeNull();
    expect(frames.length).toBe(1);
    expect(frames[0].symbol).toBe('Position');
    expect(frames[0].symbolId).toBe('position');
    expect(frames[0].glyph).toBe('⌖');
    expect(frames[0].toleranceValue).toBe(0.1);
    expect(frames[0].diameterPrefix).toBe(true);
    expect(frames[0].toleranceModifier).toBe('M');
    expect(frames[0].datums[0].letter).toBe('A');
    expect(frames[0].datums[0].modifier).toBe('M');
    expect(frames[0].datums[1].letter).toBe('');
    expect(frames[0].datums[2].letter).toBe('');
    expect(frames[0].formatted).toBe('⌖|Ø0.1 Ⓜ|A Ⓜ');

    // localStorage carries the frame.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.gdtFrames') || '{}');
        } catch { return null; }
    });
    console.log('[push-92] persisted after add =', JSON.stringify(persisted));
    expect(persisted).not.toBeNull();
    expect(Array.isArray(persisted.frames)).toBe(true);
    expect(persisted.frames.length).toBe(1);
    expect(persisted.frames[0].symbolId).toBe('position');

    // The count chip flips to 1.
    const countChip = await page.locator('[data-testid="forge-gdt-frames-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('1');

    // The bus event fired with the new state.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    expect(eventsAfter[eventsAfter.length - 1].count).toBe(1);

    // One row is visible in the list.
    const rows = await page.locator('[data-testid="forge-gdt-frames-row"]').count();
    expect(rows).toBe(1);

    // The row's data-symbol-id matches.
    const rowSymbolId = await page.locator('[data-testid="forge-gdt-frames-row"]')
                                   .first()
                                   .getAttribute('data-symbol-id');
    expect(rowSymbolId).toBe('position');
});

test('03 — build Flatness 0.05 frame (no datums) → length=2 (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    // Symbol → flatness (Form tolerance — datums optional).
    await page.locator('[data-testid="forge-gdt-frames-symbol"]').selectOption('flatness');
    await pause(100);

    // Uncheck diameter prefix (Flatness is a surface form tol — never Ø).
    const diaCheckbox = page.locator('[data-testid="forge-gdt-frames-diameter"]');
    if (await diaCheckbox.isChecked()) await diaCheckbox.uncheck();

    // Tolerance value → 0.05.
    await setReactInput('forge-gdt-frames-value', '0.05');

    // Tolerance modifier → none.
    await page.locator('[data-testid="forge-gdt-frames-tol-modifier"]').selectOption('none');

    // Clear datum A — Flatness doesn't take datums.
    await setReactInput('forge-gdt-frames-datum-a-letter', '');
    await page.locator('[data-testid="forge-gdt-frames-datum-a-modifier"]').selectOption('none');
    await pause(200);

    // Live preview reads "▱|0.05".
    const preview = await page.locator('[data-testid="forge-gdt-frames-preview"]')
                               .textContent();
    console.log('[push-92] preview (flatness) =', JSON.stringify(preview));
    expect((preview || '').trim()).toBe('▱|0.05');

    await page.locator('[data-testid="forge-gdt-frames-add"]').click();
    await pause(400);
    await shot('after-flatness');

    // Window mirror length = 2 now.
    const frames = await readFrames();
    console.log('[push-92] frames after flatness add =', JSON.stringify(frames));
    expect(frames).not.toBeNull();
    expect(frames.length).toBe(2);

    // First frame still Position (ordering preserved).
    expect(frames[0].symbolId).toBe('position');
    expect(frames[0].symbol).toBe('Position');

    // Second frame is the flatness we just added.
    expect(frames[1].symbolId).toBe('flatness');
    expect(frames[1].symbol).toBe('Flatness');
    expect(frames[1].glyph).toBe('▱');
    expect(frames[1].toleranceValue).toBe(0.05);
    expect(frames[1].diameterPrefix).toBe(false);
    expect(frames[1].toleranceModifier).toBe('none');
    expect(frames[1].datums[0].letter).toBe('');
    expect(frames[1].formatted).toBe('▱|0.05');

    // localStorage round-trip.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.gdtFrames') || '{}');
        } catch { return null; }
    });
    console.log('[push-92] persisted after flatness =', JSON.stringify(persisted));
    expect(persisted).not.toBeNull();
    expect(persisted.frames.length).toBe(2);
    expect(persisted.frames[0].symbolId).toBe('position');
    expect(persisted.frames[1].symbolId).toBe('flatness');

    // The count chip flipped to 2.
    const countChip = await page.locator('[data-testid="forge-gdt-frames-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('2');

    // Two rows are visible in the list.
    const rows = await page.locator('[data-testid="forge-gdt-frames-row"]').count();
    expect(rows).toBe(2);

    // The bus event fired again.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    expect(eventsAfter[eventsAfter.length - 1].count).toBe(2);

    // The row's data-symbol-id attributes match the ordering.
    const rowSymbolIds = await page.locator('[data-testid="forge-gdt-frames-row"]')
                                    .evaluateAll((els) => els.map(
                                        (e) => e.getAttribute('data-symbol-id')));
    expect(rowSymbolIds).toEqual(['position', 'flatness']);
});

test('04 — PUSH-78 regression: PMI panel mounts; GD&T store untouched (iso)', async () => {
    await cameraTo('iso');
    // Snapshot window.__forgeGdtFrames before opening the PMI panel so
    // we can prove that panel does not touch our frame array.
    const before = await readFrames();
    expect(before).not.toBeNull();
    expect(before.length).toBe(2);
    const beforeJson = JSON.stringify(before);

    // Open the PMI Annotations panel via its menu action.
    await platformMenuAction('tools.pmiAnnotations');
    await page.waitForSelector('[data-testid="forge-pmi-annotations-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(600);
    await shot('pmi-regression');

    // The GD&T Frames panel should still be mounted alongside it (both
    // are right-docked portals — they MUST coexist).
    await expect(page.locator('[data-testid="forge-gdt-frames-panel"]'))
        .toBeAttached();

    // The PMI panel uses its own store + bus event — its array is
    // separate from __forgeGdtFrames.
    const pmiArr = await page.evaluate(() => {
        const arr = window.__forgePmi;
        return Array.isArray(arr) ? arr.slice() : null;
    });
    expect(pmiArr).not.toBeNull();
    // PMI store is independent; it can be empty (this test never added
    // PMI notes). The point is it exists and is a different array.

    // The window.__forgeGdtFrames array should be byte-for-byte unchanged.
    const after = await readFrames();
    expect(after).not.toBeNull();
    expect(after.length).toBe(2);
    expect(JSON.stringify(after)).toBe(beforeJson);

    // Storage keys are distinct (PUSH-78 vs PUSH-92).
    const pmiKey = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.pmiNotes'));
    const gdtKey = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.gdtFrames'));
    // PMI key may be null (no notes) or non-null (empty store baseline).
    // The GD&T key must not equal the PMI key.
    expect(gdtKey).not.toBeNull();
    if (pmiKey !== null) {
        expect(gdtKey).not.toBe(pmiKey);
    }
});
