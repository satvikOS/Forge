// PUSH-111 (Slice-80 / STEP AP242 PMI Export panel).
//
// PUSH-12 / Forge-156 shipped the kernel-side AP242 emitter
// (ap242Export.js → buildAP242). The path through the UI was File →
// Export AP242 STEP + PMI… (ForgeShellV4 line 631) which blindly dumped
// every native body + every pmiAnnotations.js note. There was no UI to
// pick which bodies to include, no chips for the embedded PMI / GD&T /
// Materials counts, and the PUSH-78 (window.__forgePmi) + PUSH-92
// (window.__forgeGdtFrames) + PUSH-61 (window.__forgeBodyMaterials)
// sources never made it into the file.
//
// PUSH-111 ships the right-docked Ap242ExportPanel: row-per-native-body
// checkboxes; PMI + GD&T + Materials count chips reading the canonical
// window mirrors; a single Save button that calls buildAP242 with the
// merged payload and writes it through forge.dialog.saveFile +
// forge.dialog.writeBlob.
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron, dismiss any first-run banners. Confirm the
//       window.__forgeOpenAp242ExportPanel +
//       window.__forgeAp242ExportHelper hooks are installed BEFORE the
//       panel mounts (proves the host wires on mount, not on open).
//   01. Seed a 30×30×30 native OCCT box + assign a material to it via
//       the PUSH-61 window.__forgeBodyMaterialsHelper so the panel can
//       roll up a materials count.
//   02. Add a PMI note via window.__forgePmiHelper.addNote so the
//       panel's PMI chip reads "PMI · 1" and the note shows up in
//       the PMI list.
//   03. Open AP242 STEP + PMI Export via tools.ap242Export. Panel
//       mounts, lists the body, count chips show "1/1", "PMI · 1",
//       "GD&T · 0", "Materials · 1".
//   04. Override io:saveDialog to return /tmp/push-111-ap242.step.
//       Click Save → assert:
//         • A real .step file lands at /tmp/push-111-ap242.step,
//         • size > 500 bytes,
//         • carries the AP242 schema marker
//           FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING')),
//         • carries an ISO-10303-21 header + ENDSEC + END-ISO-10303-21,
//         • contains a MANIFOLD_SOLID_BREP block (the body's mesh),
//         • contains a SEMANTIC_TEXT_OBJECT block carrying the user's
//           note text (the embedded PMI),
//         • window.__forgeLastAp242Export carries the right summary,
//         • a forge:ap242-export-complete bus event fired.
//   05. PUSH-78 regression: the PMI Annotations panel still opens via
//       tools.pmiAnnotations after the AP242 export writes, the
//       seeded note is still in the array, and the count chip in that
//       panel reads "1".
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + host surface check)
//   - front (seed body + assign material)
//   - top   (add PMI note + open AP242 panel)
//   - right (Save → assert file + summary on disk)
//   - iso   (PUSH-78 regression — PMI Annotations panel still works)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-111-ap242-pmi');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'ap242-pmi-session.mp4');

const STEP_OUT   = path.join(os.tmpdir(), `push-111-ap242-${Date.now()}.step`);

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

async function installEventCapture() {
    await page.evaluate(() => {
        window.__push111Events = [];
        window.addEventListener('forge:ap242-export-complete', (e) => {
            try {
                window.__push111Events.push({
                    path: e?.detail?.path || null,
                    bytes: e?.detail?.bytes || 0,
                    bodyCount: e?.detail?.bodyCount || 0,
                    pmiNoteCount: e?.detail?.pmiNoteCount || 0,
                    gdtFrameCount: e?.detail?.gdtFrameCount || 0,
                    materialAssignmentCount: e?.detail?.materialAssignmentCount || 0,
                    annotationCount: e?.detail?.annotationCount || 0,
                });
            } catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push111Events || []);
}
async function readLastExport() {
    return await page.evaluate(() => {
        const last = window.__forgeLastAp242Export;
        if (!last) return null;
        return {
            path: last.path || null,
            bytes: typeof last.bytes === 'number' ? last.bytes : null,
            bodyCount: last.bodyCount || 0,
            pmiNoteCount: last.pmiNoteCount || 0,
            gdtFrameCount: last.gdtFrameCount || 0,
            materialAssignmentCount: last.materialAssignmentCount || 0,
            annotationCount: last.annotationCount || 0,
            tessSkippedCount: last.tessSkippedCount || 0,
        };
    });
}

test.beforeAll(async () => {
    // Clean stale test artefacts so the size assertions reflect THIS run.
    try { fs.unlinkSync(STEP_OUT); } catch {}

    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-111|ap242|AP242|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
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
        try { window.__forgeFinishTour?.(); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    // Clear any persisted PUSH-78 PMI notes from a previous suite run so
    // the count chip starts at "PMI · 0" — the headline assertion in
    // step 03 depends on this baseline.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.pmiNotes'); } catch {}
        try { window.localStorage.removeItem('forge.v4.gdtFrames'); } catch {}
        if (Array.isArray(window.__forgePmi)) window.__forgePmi.length = 0;
        else window.__forgePmi = [];
        if (Array.isArray(window.__forgeGdtFrames)) window.__forgeGdtFrames.length = 0;
        else window.__forgeGdtFrames = [];
    });
    await pause(800);

    // Override io:saveDialog so the native modal never blocks the test.
    // Returns the canonical STEP_OUT every time the panel asks for a path.
    await app.evaluate(async ({ ipcMain }, p) => {
        globalThis.__push111Dialog = { path: p, calls: 0 };
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => {
            globalThis.__push111Dialog.calls += 1;
            return globalThis.__push111Dialog.path;
        });
    }, STEP_OUT);
});

async function readDialogCalls() {
    return await app.evaluate(async () => globalThis.__push111Dialog?.calls || 0);
}

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
        console.error('[push-111] no .webm'); return;
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
                console.log(`[push-111] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-111] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + assert host surface installed without opening the panel (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenAp242ExportPanel,
        close:   typeof window.__forgeCloseAp242ExportPanel,
        helper:  typeof window.__forgeAp242ExportHelper,
        helperKeys: window.__forgeAp242ExportHelper
            ? Object.keys(window.__forgeAp242ExportHelper).sort()
            : [],
        hasIo:        !!(window.forge && window.forge.io),
        hasExportStepWithPmi: !!(window.forge && window.forge.io && typeof window.forge.io.exportStepWithPmi === 'function'),
        hasSaveFile:  !!(window.forge && window.forge.dialog && typeof window.forge.dialog.saveFile === 'function'),
        hasWriteBlob: !!(window.forge && window.forge.dialog && typeof window.forge.dialog.writeBlob === 'function'),
        hasTessellate: !!(window.forge && typeof window.forge.tessellate === 'function'),
        hasPmiHelper: typeof window.__forgePmiHelper,
        hasGdtHelper: typeof window.__forgeGdtFramesHelper,
        hasBodyMatHelper: typeof window.__forgeBodyMaterialsHelper,
    }));
    console.log('[push-111] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('runExport');
    expect(surface.helperKeys).toContain('readNativeBodies');
    expect(surface.helperKeys).toContain('readPmiNotes');
    expect(surface.helperKeys).toContain('readGdtFrames');
    expect(surface.helperKeys).toContain('readBodyMaterials');
    expect(surface.helperKeys).toContain('EVENT_NAME');
    // We use forge.dialog.{saveFile,writeBlob} and forge.tessellate.
    expect(surface.hasSaveFile).toBe(true);
    expect(surface.hasWriteBlob).toBe(true);
    expect(surface.hasTessellate).toBe(true);
    // PUSH-78 + PUSH-92 + PUSH-61 helpers — confirm those panels installed
    // their hooks before we read their canonical mirrors.
    expect(surface.hasPmiHelper).toBe('object');
    expect(surface.hasGdtHelper).toBe('object');
    expect(surface.hasBodyMatHelper).toBe('object');
});

test('01 — seed 30×30×30 native box + assign material (front)', async () => {
    await cameraTo('front');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        const h = f.makeBox(30, 30, 30);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id: 'f-box-111', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Bracket 30 (PUSH-111)',
            params: { width: 30, height: 30, distance: 30 },
        });
        // Assign a material via the PUSH-61 helper so the panel can roll
        // up a Materials chip when it mounts.
        try {
            window.__forgeBodyMaterialsHelper?.setBodyMaterial?.(h, 'aluminum-6061');
        } catch {}
        return { h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h).toBeGreaterThan(0);
    bodyHandle = seeded.h;
    console.log('[push-111] seeded body handle =', bodyHandle);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');

    // Confirm the material assignment landed.
    const mat = await page.evaluate((h) => {
        return window.__forgeBodyMaterialsHelper?.getBodyMaterial?.(h) || null;
    }, bodyHandle);
    console.log('[push-111] material for h' + bodyHandle + ' =', mat);
    expect(mat).toBe('aluminum-6061');
});

test('02 — add a PMI note via __forgePmiHelper + open AP242 Export panel (top)', async () => {
    await cameraTo('top');

    // Seed a PUSH-78 note. We use the helper rather than the form so the
    // test is robust to UI churn — the helper is the public contract.
    const added = await page.evaluate((h) => {
        return window.__forgePmiHelper?.addNote?.({
            kind: 'tolerance', faceId: '1',
            text: '⌖ Ø0.1 A B C',
            bodyHandle: h,
        }) || null;
    }, bodyHandle);
    expect(added).not.toBeNull();
    expect(added.kind).toBe('tolerance');
    expect(added.bodyHandle).toBe(bodyHandle);
    await pause(200);

    // Confirm the canonical window mirror is updated.
    const pmiLen = await page.evaluate(() => (window.__forgePmi || []).length);
    expect(pmiLen).toBe(1);

    // Now open the panel via the menu action.
    await platformMenuAction('tools.ap242Export');
    await page.waitForSelector('[data-testid="forge-ap242-export-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The body row is visible.
    await expect(page.locator(`[data-testid="forge-ap242-export-check-${bodyHandle}"]`)).toBeVisible();

    // Body count chip "1/1".
    const bodyChip = await page.locator('[data-testid="forge-ap242-export-body-count"]')
                                 .textContent();
    expect((bodyChip || '').trim()).toBe('1/1');

    // Panel data attributes reflect the live counts.
    const panel = page.locator('[data-testid="forge-ap242-export-panel"]');
    expect(await panel.getAttribute('data-body-count')).toBe('1');
    expect(await panel.getAttribute('data-selected-count')).toBe('1');
    expect(await panel.getAttribute('data-pmi-count')).toBe('1');
    expect(await panel.getAttribute('data-gdt-count')).toBe('0');
    expect(await panel.getAttribute('data-material-count')).toBe('1');

    // PMI count chip reads "PMI · 1".
    const pmiChip = await page.locator('[data-testid="forge-ap242-export-pmi-count"]')
                                .textContent();
    expect(pmiChip).toContain('1');

    // GD&T count chip reads "GD&T · 0".
    const gdtChip = await page.locator('[data-testid="forge-ap242-export-gdt-count"]')
                                .textContent();
    expect(gdtChip).toContain('0');

    // Material count chip reads "Materials · 1".
    const matChip = await page.locator('[data-testid="forge-ap242-export-material-count"]')
                                .textContent();
    expect(matChip).toContain('1');

    // The PMI list shows exactly one row carrying our text.
    const pmiRows = page.locator('[data-testid="forge-ap242-export-pmi-row"]');
    await expect(pmiRows).toHaveCount(1);
    const rowText = await pmiRows.first().textContent();
    expect(rowText).toContain('tolerance');
    expect(rowText).toContain('⌖');

    // The body row carries the material chip.
    const matBodyChip = page.locator(`[data-testid="forge-ap242-export-material-${bodyHandle}"]`);
    await expect(matBodyChip).toBeVisible();
    const matBodyText = await matBodyChip.textContent();
    expect(matBodyText).toContain('aluminum-6061');

    // Install the event capture before we mutate via Save.
    await installEventCapture();
});

test('03 — Save → /tmp/push-111-ap242.step written + AP242 schema (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baselineEvents = eventsBefore.length;
    const callsBefore = await readDialogCalls();

    // Click the Save button.
    await page.locator('[data-testid="forge-ap242-export-save"]').click();
    // The button flips data-export-state="busy" while writing — wait
    // for the export to return to idle before asserting on disk.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-ap242-export-save"]');
        return el && el.getAttribute('data-export-state') === 'idle';
    }, null, { timeout: 30000 });
    await pause(400);
    await shot('after-save');

    // saveDialog was called exactly once during this Save.
    const callsAfter = await readDialogCalls();
    expect(callsAfter).toBe(callsBefore + 1);

    // The .step file landed on disk.
    expect(fs.existsSync(STEP_OUT)).toBe(true);
    const stat = fs.statSync(STEP_OUT);
    console.log('[push-111] AP242 STEP size =', stat.size, 'B');
    expect(stat.size).toBeGreaterThan(500);

    // It carries the canonical AP242 schema markers.
    const txt = fs.readFileSync(STEP_OUT, 'utf8');
    expect(txt).toContain('ISO-10303-21;');
    expect(txt).toContain('HEADER;');
    expect(txt).toContain("FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'))");
    expect(txt).toContain('ENDSEC;');
    expect(txt).toContain('END-ISO-10303-21;');

    // The body's tessellation made it in as a MANIFOLD_SOLID_BREP (a 30³
    // OCCT box tessellates to dozens of triangles — the BREP block must
    // exist).
    expect(txt).toContain('MANIFOLD_SOLID_BREP');
    expect(txt).toContain('CARTESIAN_POINT');
    expect(txt).toContain('ADVANCED_FACE');

    // The seeded PMI note made it in as a SEMANTIC_TEXT_OBJECT — the
    // brief's headline check that PMI is actually embedded, not lost.
    expect(txt).toContain('SEMANTIC_TEXT_OBJECT');
    expect(txt).toContain('GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE');
    // The literal user-supplied note text is escaped per ISO 10303-21
    // (single quotes doubled). Our text "⌖ Ø0.1 A B C" carries no
    // single quotes so it survives verbatim through escapeStep().
    expect(txt).toContain('⌖ Ø0.1 A B C');

    // The window mirror carries the right summary.
    const last = await readLastExport();
    console.log('[push-111] last export =', JSON.stringify(last));
    expect(last).not.toBeNull();
    expect(last.path).toBe(STEP_OUT);
    expect(last.bytes).toBe(stat.size);
    expect(last.bodyCount).toBe(1);
    expect(last.pmiNoteCount).toBe(1);
    expect(last.gdtFrameCount).toBe(0);
    expect(last.materialAssignmentCount).toBe(1);
    // 1 PUSH-78 note → 1 ap242 annotation entry.
    expect(last.annotationCount).toBe(1);

    // The forge:ap242-export-complete bus event fired with the right shape.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baselineEvents);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.path).toBe(STEP_OUT);
    expect(newest.bodyCount).toBe(1);
    expect(newest.pmiNoteCount).toBe(1);
    expect(newest.materialAssignmentCount).toBe(1);

    // The note row reflects success.
    const note = page.locator('[data-testid="forge-ap242-export-note"]');
    await expect(note).toBeVisible();
    expect(await note.getAttribute('data-note-kind')).toBe('ok');
});

test('04 — PUSH-78 regression: PMI Annotations panel still mounts; PMI store untouched (iso)', async () => {
    await cameraTo('iso');
    // Snapshot the canonical PMI mirror before opening the sibling panel.
    const before = await page.evaluate(() => (window.__forgePmi || []).slice());
    expect(before.length).toBe(1);
    const beforeJson = JSON.stringify(before);

    // Close the AP242 panel so the right-rail is uncluttered.
    const closeBtn = page.locator('[data-testid="forge-ap242-export-close"]');
    if (await closeBtn.count() > 0) {
        await closeBtn.click({ timeout: 3000 }).catch(() => {});
        await pause(300);
    }

    // Open the PUSH-78 PMI Annotations panel via its menu action.
    await platformMenuAction('tools.pmiAnnotations');
    await page.waitForSelector('[data-testid="forge-pmi-annotations-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(400);
    await shot('pmi-annotations-after-ap242');

    // The PMI Annotations count chip reads "1" — the AP242 panel didn't
    // touch the canonical PUSH-78 mirror, and the PUSH-78 panel still
    // reads it correctly.
    const countChip = await page.locator('[data-testid="forge-pmi-annotations-count"]')
                                 .textContent();
    expect((countChip || '').trim()).toBe('1');

    // The note count data attribute matches.
    const noteCount = await page.locator('[data-testid="forge-pmi-annotations-panel"]')
                                 .getAttribute('data-note-count');
    expect(noteCount).toBe('1');

    // One row is visible in the existing-notes list.
    const rows = await page.locator('[data-testid="forge-pmi-annotations-row"]').count();
    expect(rows).toBe(1);

    // The window.__forgePmi array is byte-for-byte unchanged.
    const after = await page.evaluate(() => (window.__forgePmi || []).slice());
    expect(after.length).toBe(1);
    expect(JSON.stringify(after)).toBe(beforeJson);

    // The forge:ap242-export-complete event the Save in step 03 fired
    // is still in the capture array — proves the bus survives the panel
    // close + re-open cycle.
    const events = await readEvents();
    expect(events.length).toBeGreaterThan(0);
});
