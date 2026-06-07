// PUSH-78 (Slice-46 / PMI Annotations panel — GD&T notes on faces).
//
// PUSH-12 shipped a kitchen-sink PMI Workbench (FCF + Datum + Linear +
// Angular + Surface + Y14.41 export). PUSH-47 added a 1D tolerance
// stack-up. Neither is the small focused "drop a quick GD&T note onto
// a face" tool engineers reach for mid-modelling. PUSH-78 lights up
// PmiAnnotationsPanel.jsx — a right-docked panel with a single Add
// Note form (Kind / Face ID / Text) that appends entries to
// window.__forgePmi[], persists to localStorage, and broadcasts a
// `forge:pmi-changed` event so subscribers (Viewport overlay,
// plugins, Archie) can react.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner; clear the
//      persisted PMI store + the live window mirror so the suite
//      starts from an empty array.
//   2. Seed 1 native OCCT box so the panel has an active body.
//   3. Open the PMI Annotations panel via the `tools.pmiAnnotations`
//      menu action. The panel mounts, the count chip reads "0", the
//      empty-state message is visible.
//   4. Add 2 notes through the form:
//        • A Datum note on face 1 with text "A".
//        • A Tolerance note on face 2 with text "⌖ Ø0.1 A B C".
//      Each Add press appends to window.__forgePmi[]. After both
//      presses:
//        • window.__forgePmi.length === 2
//        • localStorage 'forge.v4.pmiNotes' carries both notes
//        • The count chip reads "2"
//        • Two rows are visible in the list
//        • A forge:pmi-changed event fired for each add
//   5. PUSH-58 regression: opening the Mass Properties panel after
//      PMI Annotations still works — both panels are right-docked
//      and must coexist; the MassProps panel writes nothing to
//      __forgePmi so the array must survive untouched.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed body)
//   - front (open panel, assert empty state)
//   - top   (add Datum A on face 1)
//   - right (add Tolerance ⌖ on face 2 + assert length=2)
//   - iso   (PUSH-58 regression — MassProps coexistence)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-78-pmi-annotations');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'pmi-annotations-session.mp4');

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

// Install a window-level capture for the forge:pmi-changed bus so the
// test can assert events fired, not just final array state.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push78Events = [];
        window.addEventListener('forge:pmi-changed', (e) => {
            try {
                window.__push78Events.push({
                    count: Array.isArray(e?.detail?.notes) ? e.detail.notes.length : -1,
                });
            } catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push78Events || []);
}
async function readPmi() {
    return await page.evaluate(() => {
        const arr = window.__forgePmi;
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
        if (/push-78|pmi-annotations|PmiAnnotations|forge|error|Error/i.test(t)) {
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
    // Clear any persisted PMI notes from a previous suite run + reset
    // the live window mirror so this test starts from the empty-array
    // baseline the spec promises.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.pmiNotes'); } catch {}
        if (Array.isArray(window.__forgePmi)) {
            window.__forgePmi.length = 0;
        } else {
            window.__forgePmi = [];
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
        console.error('[push-78] no .webm'); return;
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
                console.log(`[push-78] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-78] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
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
        const h = f.makeBox(30, 30, 30);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id: 'f-box-78', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 30 (PUSH-78)',
            params: { width: 30, height: 30, distance: 30 },
        });
        return { h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h).toBeGreaterThan(0);
    bodyHandle = seeded.h;
    console.log('[push-78] seeded body handle =', bodyHandle);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('01 — open PMI Annotations via tools.pmiAnnotations → empty panel (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.pmiAnnotations');
    await page.waitForSelector('[data-testid="forge-pmi-annotations-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open-empty');

    // Count chip reads 0.
    const countChip = await page.locator('[data-testid="forge-pmi-annotations-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('0');

    // The panel data attribute confirms it.
    const noteCount = await page.locator('[data-testid="forge-pmi-annotations-panel"]')
                                 .getAttribute('data-note-count');
    expect(noteCount).toBe('0');

    // The empty-state message is visible.
    await expect(page.locator('[data-testid="forge-pmi-annotations-empty"]'))
        .toBeVisible();

    // The active-body badge shows the seeded body's handle.
    const bodyBadge = await page.locator('[data-testid="forge-pmi-annotations-active-body"]')
                                 .textContent();
    expect(bodyBadge).toContain(`h${bodyHandle}`);

    // The form's three required inputs are present.
    await expect(page.locator('[data-testid="forge-pmi-annotations-kind"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pmi-annotations-face"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-pmi-annotations-text"]')).toBeVisible();

    // The window mirror is an empty array (the host's bootstrap publish
    // sync'd the empty store on mount).
    const pmi = await readPmi();
    expect(pmi).not.toBeNull();
    expect(pmi.length).toBe(0);

    // Install the event capture before the first mutation.
    await installEventCapture();
});

test('02 — add Datum A on face 1 → window.__forgePmi length = 1 (top)', async () => {
    await cameraTo('top');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    // Datum is the default kind in the dropdown; assert + fill the form.
    await page.locator('[data-testid="forge-pmi-annotations-kind"]').selectOption('datum');
    // Clear the auto-filled text and type the canonical Datum letter.
    await page.locator('[data-testid="forge-pmi-annotations-face"]').fill('1');
    await page.locator('[data-testid="forge-pmi-annotations-text"]').fill('A');
    await pause(150);

    // Add button is enabled now (Face ID + text both non-empty).
    const addEnabled = await page.locator('[data-testid="forge-pmi-annotations-add"]')
                                  .isEnabled();
    expect(addEnabled).toBe(true);

    await page.locator('[data-testid="forge-pmi-annotations-add"]').click();
    await pause(400);
    await shot('after-datum');

    // window.__forgePmi has 1 entry.
    const pmi = await readPmi();
    console.log('[push-78] pmi after datum add =', JSON.stringify(pmi));
    expect(pmi).not.toBeNull();
    expect(pmi.length).toBe(1);
    expect(pmi[0].kind).toBe('datum');
    expect(pmi[0].faceId).toBe('1');
    expect(pmi[0].text).toBe('A');
    expect(pmi[0].bodyHandle).toBe(bodyHandle);

    // localStorage carries the note.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.pmiNotes') || '{}');
        } catch { return null; }
    });
    console.log('[push-78] persisted after datum add =', JSON.stringify(persisted));
    expect(persisted).not.toBeNull();
    expect(Array.isArray(persisted.notes)).toBe(true);
    expect(persisted.notes.length).toBe(1);

    // The count chip flips to 1.
    const countChip = await page.locator('[data-testid="forge-pmi-annotations-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('1');

    // The bus event fired with the new state.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    expect(eventsAfter[eventsAfter.length - 1].count).toBe(1);

    // One row is visible in the list.
    const rows = await page.locator('[data-testid="forge-pmi-annotations-row"]').count();
    expect(rows).toBe(1);
});

test('03 — add Tolerance ⌖ on face 2 → window.__forgePmi length = 2 (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baseline = eventsBefore.length;

    // Switch to Tolerance kind, set Face ID 2, paste the tolerance text.
    await page.locator('[data-testid="forge-pmi-annotations-kind"]').selectOption('tolerance');
    await pause(150);
    await page.locator('[data-testid="forge-pmi-annotations-face"]').fill('2');
    // Use a recognisable tolerance text — glyph + dia + tol + 3 datums.
    await page.locator('[data-testid="forge-pmi-annotations-text"]').fill('⌖ Ø0.1 A B C');
    await pause(150);

    await page.locator('[data-testid="forge-pmi-annotations-add"]').click();
    await pause(400);
    await shot('after-tolerance');

    // ── The headline assertion the brief calls out: window.__forgePmi
    // length = 2 after adding 2 notes.
    const pmi = await readPmi();
    console.log('[push-78] pmi after tolerance add =', JSON.stringify(pmi));
    expect(pmi).not.toBeNull();
    expect(pmi.length).toBe(2);

    // The second note is the tolerance we just added.
    expect(pmi[1].kind).toBe('tolerance');
    expect(pmi[1].faceId).toBe('2');
    expect(pmi[1].text).toBe('⌖ Ø0.1 A B C');
    expect(pmi[1].bodyHandle).toBe(bodyHandle);

    // The first note is still the datum (ordering preserved).
    expect(pmi[0].kind).toBe('datum');
    expect(pmi[0].faceId).toBe('1');
    expect(pmi[0].text).toBe('A');

    // localStorage round-trip: persisted notes match the in-memory list.
    const persisted = await page.evaluate(() => {
        try {
            return JSON.parse(window.localStorage.getItem('forge.v4.pmiNotes') || '{}');
        } catch { return null; }
    });
    console.log('[push-78] persisted after tolerance add =', JSON.stringify(persisted));
    expect(persisted).not.toBeNull();
    expect(persisted.notes.length).toBe(2);
    expect(persisted.notes[0].kind).toBe('datum');
    expect(persisted.notes[1].kind).toBe('tolerance');

    // The count chip flipped to 2.
    const countChip = await page.locator('[data-testid="forge-pmi-annotations-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('2');

    // Two rows are visible in the list.
    const rows = await page.locator('[data-testid="forge-pmi-annotations-row"]').count();
    expect(rows).toBe(2);

    // The bus event fired again.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baseline);
    expect(eventsAfter[eventsAfter.length - 1].count).toBe(2);

    // The row's data-kind attributes match.
    const rowKinds = await page.locator('[data-testid="forge-pmi-annotations-row"]')
                                .evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')));
    expect(rowKinds).toEqual(['datum', 'tolerance']);
});

test('04 — PUSH-58 regression: Mass Properties panel still mounts; PMI store untouched (iso)', async () => {
    await cameraTo('iso');
    // Snapshot window.__forgePmi before opening Mass Properties so we
    // can prove the panel does not touch our note array.
    const before = await readPmi();
    expect(before).not.toBeNull();
    expect(before.length).toBe(2);
    const beforeJson = JSON.stringify(before);

    // Open the Mass Properties panel via its menu action. PUSH-58
    // mounts this panel and auto-scans the active body. Both panels
    // are right-docked — they must coexist in the DOM.
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(800);
    await shot('massprops-regression');

    // The PMI Annotations panel should still be mounted alongside it.
    await expect(page.locator('[data-testid="forge-pmi-annotations-panel"]'))
        .toBeAttached();

    // The window.__forgePmi array should be byte-for-byte unchanged.
    const after = await readPmi();
    expect(after).not.toBeNull();
    expect(after.length).toBe(2);
    expect(JSON.stringify(after)).toBe(beforeJson);

    // Mass Properties has its own readout — kernel volume = 30³ = 27000.
    const volTxt = await page.locator('[data-testid="forge-massprops-volume"]').textContent();
    const vol = Number(/(-?[0-9]+\.[0-9]+)/.exec(volTxt || '')?.[1]);
    console.log('[push-78] massprops volume readout =', volTxt, '→', vol);
    expect(Math.abs(vol - 27000)).toBeLessThan(1);
});
