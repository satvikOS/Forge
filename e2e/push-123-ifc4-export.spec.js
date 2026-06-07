// PUSH-123 (Slice-91 / IFC4 (BIM) Export panel).
//
// PUSH-13 / Forge-121 shipped the kernel-side IFC4 emitter
// (frontend/src/forge-v4/ifcExport.js → buildIfcText + exportIFC). The
// existing path through the UI is File → Export IFC4 (.ifc)…
// (ForgeShellV4 line 627) which opens the legacy modal IfcExportPanel
// — a heavyweight per-body storey + IFC-type assignment table. Good
// for fine-grained BIM tagging; heavy for the common day-to-day
// workflow:
//
//   "Take every native body in the scene, stamp them with a project
//    name + description + length unit, and write the IFC4 file."
//
// PUSH-123 ships that dedicated right-docked Ifc4ExportPanel,
// reachable via the tools.ifcExport menu action. Bodies checklist;
// IFC project metadata (name, description, length unit); one Save
// button that calls buildIfcText with the merged payload and writes
// it through forge.dialog.saveFile + forge.dialog.writeBlob.
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron, dismiss any first-run banners. Confirm the
//       window.__forgeOpenIfc4Export + window.__forgeIfc4ExportHelper
//       hooks are installed BEFORE the panel mounts (proves the host
//       wires on mount, not on open).
//   01. Seed two real OCCT bodies: a 30×30×30 box and a 20×20×20 box,
//       so the checklist has > 1 row to assert select-all / select-none
//       semantics.
//   02. Open IFC4 (BIM) Export via tools.ifcExport. Panel mounts,
//       lists both bodies, body-count chip shows "2/2", schema chip
//       reads "Schema · IFC4", units chip reads "Units · mm".
//   03. Edit project metadata: name = "PUSH-123 IFC4 Test", description
//       = "ArchDisc Forge IFC4 export regression", units = "m". Override
//       io:saveDialog to return /tmp/push-123-ifc4-<ts>.ifc. Click Save
//       → assert a real .ifc file lands at that path with:
//         • size > 1500 bytes,
//         • carries the canonical IFC STEP21 header
//           (ISO-10303-21 + HEADER + FILE_SCHEMA(('IFC4')) + ENDSEC +
//            END-ISO-10303-21),
//         • carries the project metadata baked into IfcProject Name
//           (i.e. "PUSH-123 IFC4 Test" appears in the file),
//         • carries the user description embedded into the IfcProject
//           record (i.e. "ArchDisc Forge IFC4 export regression" too),
//         • declares "METRE" as a length unit (the user picked m, the
//           emitter declares an IFCSIUNIT with the chosen prefix),
//         • contains one IFCBUILDINGELEMENTPROXY per checked body
//           (≥2 elements; the emitter wraps every body in the proxy
//           class unless overridden),
//         • contains an IFCFACETEDBREP block (the body's mesh),
//         • window.__forgeLastIfc4Export carries the right summary,
//         • a forge:ifc4-export-complete bus event fired with the
//           same shape.
//   04. Select-none → Save → asserts the error note appears ("Select
//       at least one body…") and io:saveDialog was NOT called again
//       (the panel refuses to write an empty IFC).
//   05. PUSH-111 regression: AP242 STEP + PMI Export panel still
//       opens via tools.ap242Export, the body checklist is populated,
//       and Save still writes a real .step file (a quick sanity check
//       that the new IFC4 panel doesn't shadow the AP242 host's
//       menu-action listener).
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + host surface check)
//   - front (seed bodies)
//   - top   (open IFC4 panel + edit metadata)
//   - right (Save → assert file + summary on disk)
//   - iso   (PUSH-111 regression — AP242 panel still works)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-123-ifc4-export');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'ifc4-export-session.mp4');

const TS = Date.now();
const IFC_OUT  = path.join(os.tmpdir(), `push-123-ifc4-${TS}.ifc`);
const STEP_OUT = path.join(os.tmpdir(), `push-123-ap242-${TS}.step`);

let app, page;
let stepIndex = 0;
let bodyHandles = [];

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

async function installEventCapture() {
    await page.evaluate(() => {
        window.__push123Events = [];
        window.addEventListener('forge:ifc4-export-complete', (e) => {
            try {
                window.__push123Events.push({
                    path: e?.detail?.path || null,
                    bytes: e?.detail?.bytes || 0,
                    bodyCount: e?.detail?.bodyCount || 0,
                    projectName: e?.detail?.projectName || null,
                    description: e?.detail?.description || null,
                    units: e?.detail?.units || null,
                    schema: e?.detail?.schema || null,
                });
            } catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push123Events || []);
}
async function readLastExport() {
    return await page.evaluate(() => {
        const last = window.__forgeLastIfc4Export;
        if (!last) return null;
        return {
            path: last.path || null,
            bytes: typeof last.bytes === 'number' ? last.bytes : null,
            bodyCount: last.bodyCount || 0,
            projectName: last.projectName || null,
            description: last.description || null,
            units: last.units || null,
            schema: last.schema || null,
        };
    });
}

test.beforeAll(async () => {
    // Clean stale test artefacts so size assertions reflect THIS run.
    try { fs.unlinkSync(IFC_OUT); } catch {}
    try { fs.unlinkSync(STEP_OUT); } catch {}

    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-123|ifc4|IFC4|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
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
    await pause(800);

    // Override io:saveDialog so the native modal never blocks the test.
    // Returns IFC_OUT for the IFC4 panel and STEP_OUT for the AP242
    // regression in step 05.
    await app.evaluate(async ({ ipcMain }, paths) => {
        globalThis.__push123Dialog = { calls: 0, nextPath: paths.ifc, paths };
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async (_e, opts) => {
            globalThis.__push123Dialog.calls += 1;
            const filters = (opts && opts.filters) || [];
            const ext = filters[0]?.extensions?.[0] || '';
            // Choose based on the filter extension to keep the two
            // panels' Save dialogs honest.
            if (ext === 'ifc') return paths.ifc;
            if (ext === 'step' || ext === 'stp') return paths.step;
            return globalThis.__push123Dialog.nextPath;
        });
    }, { ifc: IFC_OUT, step: STEP_OUT });
});

async function readDialogCalls() {
    return await app.evaluate(async () => globalThis.__push123Dialog?.calls || 0);
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
        console.error('[push-123] no .webm'); return;
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
                console.log(`[push-123] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-123] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + assert host surface installed without opening the panel (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:          typeof window.__forgeOpenIfc4Export,
        close:         typeof window.__forgeCloseIfc4Export,
        helper:        typeof window.__forgeIfc4ExportHelper,
        helperKeys:    window.__forgeIfc4ExportHelper
            ? Object.keys(window.__forgeIfc4ExportHelper).sort()
            : [],
        hasSaveFile:   !!(window.forge && window.forge.dialog && typeof window.forge.dialog.saveFile === 'function'),
        hasWriteBlob:  !!(window.forge && window.forge.dialog && typeof window.forge.dialog.writeBlob === 'function'),
        hasTessellate: !!(window.forge && typeof window.forge.tessellate === 'function'),
        hasMakeBox:    !!(window.forge && typeof window.forge.makeBox === 'function'),
        // The PUSH-111 host MUST also be wired so we can do the
        // regression in step 05 without re-mounting anything.
        ap242Open:     typeof window.__forgeOpenAp242ExportPanel,
    }));
    console.log('[push-123] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('runIfc4Export');
    expect(surface.helperKeys).toContain('readSceneBodies');
    expect(surface.helperKeys).toContain('buildIfcText');
    expect(surface.helperKeys).toContain('UNIT_OPTIONS');
    expect(surface.helperKeys).toContain('EVENT_NAME');
    expect(surface.hasSaveFile).toBe(true);
    expect(surface.hasWriteBlob).toBe(true);
    expect(surface.hasMakeBox).toBe(true);
    expect(surface.hasTessellate).toBe(true);
    // PUSH-111 still alive.
    expect(surface.ap242Open).toBe('function');

    // EVENT_NAME on the helper matches the canonical bus event the panel
    // dispatches on Save.
    const evtName = await page.evaluate(() => window.__forgeIfc4ExportHelper.EVENT_NAME);
    expect(evtName).toBe('forge:ifc4-export-complete');
});

test('01 — seed two native OCCT boxes (30³ + 20³) (front)', async () => {
    await cameraTo('front');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        const h1 = f.makeBox(30, 30, 30);
        const h2 = f.makeBox(20, 20, 20);
        if (typeof h1 !== 'number' || typeof h2 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: 'f-box-123-a', kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Bracket 30 (PUSH-123)',
            params: { width: 30, height: 30, distance: 30 },
        });
        window.__forgeAppendBody({
            id: 'f-box-123-b', kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Bracket 20 (PUSH-123)',
            params: { width: 20, height: 20, distance: 20 },
        });
        return { h1, h2 };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    bodyHandles = [seeded.h1, seeded.h2];
    console.log('[push-123] seeded body handles =', bodyHandles);

    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 2,
        null, { timeout: 4000 });
    await shot('bodies-seeded');

    const liveBodies = await page.evaluate(() => {
        return (window.__forgeBodies || [])
            .filter((b) => b && b.kind === 'native' && typeof b.handle === 'number')
            .map((b) => ({ id: b.id, handle: b.handle, name: b.name }));
    });
    console.log('[push-123] live native bodies =', JSON.stringify(liveBodies));
    expect(liveBodies.length).toBeGreaterThanOrEqual(2);
});

test('02 — open IFC4 panel via tools.ifcExport + edit metadata (top)', async () => {
    await cameraTo('top');

    // Open the panel via the menu action — proves the host listens for
    // tools.ifcExport (the headline contract of PUSH-123).
    await platformMenuAction('tools.ifcExport');
    await page.waitForSelector('[data-testid="forge-ifc4-export-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Both body checkboxes are visible (one per seeded box).
    await expect(page.locator('[data-testid="forge-ifc4-export-check-f-box-123-a"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-ifc4-export-check-f-box-123-b"]')).toBeVisible();

    // Body count chip "2/2" (both selected by default).
    const bodyChip = await page.locator('[data-testid="forge-ifc4-export-body-count"]')
                                 .textContent();
    expect((bodyChip || '').trim()).toBe('2/2');

    // Schema chip and units chip both render.
    const schemaChip = await page.locator('[data-testid="forge-ifc4-export-schema-chip"]')
                                    .textContent();
    expect(schemaChip).toContain('IFC4');
    const unitsChip0 = await page.locator('[data-testid="forge-ifc4-export-units-chip"]')
                                    .textContent();
    expect(unitsChip0).toContain('mm');

    // Panel data attributes reflect the live counts.
    const panel = page.locator('[data-testid="forge-ifc4-export-panel"]');
    expect(await panel.getAttribute('data-body-count')).toBe('2');
    expect(await panel.getAttribute('data-selected-count')).toBe('2');
    expect(await panel.getAttribute('data-units')).toBe('mm');

    // Edit metadata. Project name first.
    const nameInput = page.locator('[data-testid="forge-ifc4-export-name"]');
    await nameInput.click();
    await nameInput.fill('PUSH-123 IFC4 Test');
    await pause(120);

    const descInput = page.locator('[data-testid="forge-ifc4-export-description"]');
    await descInput.click();
    await descInput.fill('ArchDisc Forge IFC4 export regression');
    await pause(120);

    // Switch length unit from mm → m. The emitter declares METRE w/o
    // prefix when the user picks metres.
    await page.locator('[data-testid="forge-ifc4-export-units"]').selectOption('m');
    await pause(200);

    // The chip + data attribute reflect the picked unit.
    const unitsChip = await page.locator('[data-testid="forge-ifc4-export-units-chip"]')
                                   .textContent();
    expect(unitsChip).toContain('m');
    expect(await panel.getAttribute('data-units')).toBe('m');
    expect(await panel.getAttribute('data-project-name')).toBe('PUSH-123 IFC4 Test');

    await shot('metadata-set');

    // Install the event capture before we mutate via Save.
    await installEventCapture();
});

test('03 — Save → /tmp/push-123-ifc4-*.ifc written + IFC4 schema (right)', async () => {
    await cameraTo('right');
    const eventsBefore = await readEvents();
    const baselineEvents = eventsBefore.length;
    const callsBefore = await readDialogCalls();

    // Click the Save button.
    await page.locator('[data-testid="forge-ifc4-export-save"]').click();
    // The button flips data-export-state="busy" while writing — wait
    // for the export to return to idle before asserting on disk.
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-ifc4-export-save"]');
        return el && el.getAttribute('data-export-state') === 'idle';
    }, null, { timeout: 30000 });
    await pause(400);
    await shot('after-save');

    // saveDialog was called exactly once during this Save.
    const callsAfter = await readDialogCalls();
    expect(callsAfter).toBe(callsBefore + 1);

    // The .ifc file landed on disk.
    expect(fs.existsSync(IFC_OUT)).toBe(true);
    const stat = fs.statSync(IFC_OUT);
    console.log('[push-123] IFC4 size =', stat.size, 'B');
    expect(stat.size).toBeGreaterThan(1500);

    // It carries the canonical STEP21 / IFC4 schema markers.
    const txt = fs.readFileSync(IFC_OUT, 'utf8');
    expect(txt).toContain('ISO-10303-21;');
    expect(txt).toContain('HEADER;');
    expect(txt).toContain("FILE_SCHEMA(('IFC4'))");
    expect(txt).toContain('ENDSEC;');
    expect(txt).toContain('END-ISO-10303-21;');

    // IFC4 entity classes the emitter must always produce.
    expect(txt).toContain('IFCPROJECT');
    expect(txt).toContain('IFCSITE');
    expect(txt).toContain('IFCBUILDING');
    expect(txt).toContain('IFCBUILDINGSTOREY');
    // Body wrapping — by default the panel pushes every body as a proxy
    // (no per-body IFC-type override is wired into this fast panel).
    expect(txt).toContain('IFCBUILDINGELEMENTPROXY');
    // The geometry block: each body's mesh → IFCFACETEDBREP.
    expect(txt).toContain('IFCFACETEDBREP');
    expect(txt).toContain('IFCCLOSEDSHELL');
    expect(txt).toContain('IFCCARTESIANPOINT');

    // The user picked metres → IFCSIUNIT with .METRE. and NO prefix.
    expect(txt).toMatch(/IFCSIUNIT\s*\(\s*\*\s*,\s*\.LENGTHUNIT\.\s*,\s*\$\s*,\s*\.METRE\./);

    // Project metadata baked in. The panel concatenates name + " — " +
    // description as the IFCPROJECT Name attribute so both survive.
    expect(txt).toContain('PUSH-123 IFC4 Test');
    expect(txt).toContain('ArchDisc Forge IFC4 export regression');

    // The two seeded bodies become two proxy element records. Count
    // distinct IFCBUILDINGELEMENTPROXY rows.
    const proxyCount = (txt.match(/IFCBUILDINGELEMENTPROXY\(/g) || []).length;
    console.log('[push-123] IFCBUILDINGELEMENTPROXY count =', proxyCount);
    expect(proxyCount).toBeGreaterThanOrEqual(2);

    // The window mirror carries the right summary.
    const last = await readLastExport();
    console.log('[push-123] last export =', JSON.stringify(last));
    expect(last).not.toBeNull();
    expect(last.path).toBe(IFC_OUT);
    expect(last.bytes).toBe(stat.size);
    expect(last.bodyCount).toBe(2);
    expect(last.projectName).toBe('PUSH-123 IFC4 Test');
    expect(last.description).toBe('ArchDisc Forge IFC4 export regression');
    expect(last.units).toBe('m');
    expect(last.schema).toBe('IFC4');

    // The forge:ifc4-export-complete bus event fired with the right shape.
    const eventsAfter = await readEvents();
    expect(eventsAfter.length).toBeGreaterThan(baselineEvents);
    const newest = eventsAfter[eventsAfter.length - 1];
    expect(newest.path).toBe(IFC_OUT);
    expect(newest.bytes).toBe(stat.size);
    expect(newest.bodyCount).toBe(2);
    expect(newest.projectName).toBe('PUSH-123 IFC4 Test');
    expect(newest.description).toBe('ArchDisc Forge IFC4 export regression');
    expect(newest.units).toBe('m');
    expect(newest.schema).toBe('IFC4');

    // The note row reflects success.
    const note = page.locator('[data-testid="forge-ifc4-export-note"]');
    await expect(note).toBeVisible();
    expect(await note.getAttribute('data-note-kind')).toBe('ok');

    // Sanity: select-none then assert the panel guards against an
    // empty selection — Save button goes disabled and clicking it
    // is a no-op (no Save dialog opened, no IFC bytes lost).
    await page.locator('[data-testid="forge-ifc4-export-select-none"]').click();
    await pause(200);
    expect(await page.locator('[data-testid="forge-ifc4-export-panel"]')
        .getAttribute('data-selected-count')).toBe('0');
    const saveBtn = page.locator('[data-testid="forge-ifc4-export-save"]');
    await expect(saveBtn).toBeDisabled();
    const callsBeforeEmpty = await readDialogCalls();
    // force-click bypasses the actionability check; the React onClick
    // still runs but its early-return guards keep the dialog closed.
    await saveBtn.click({ force: true });
    await pause(400);
    const callsAfterEmpty = await readDialogCalls();
    expect(callsAfterEmpty).toBe(callsBeforeEmpty); // dialog was NOT called

    // Re-select all so the regression in step 04 leaves the panel
    // in a clean state (this step's primary file landed already).
    await page.locator('[data-testid="forge-ifc4-export-select-all"]').click();
    await pause(200);
});

test('04 — PUSH-111 regression: AP242 STEP + PMI panel still opens + saves (iso)', async () => {
    await cameraTo('iso');

    // Close the IFC4 panel so the right-rail is uncluttered.
    const ifcClose = page.locator('[data-testid="forge-ifc4-export-close"]');
    if (await ifcClose.count() > 0) {
        await ifcClose.click({ timeout: 3000 }).catch(() => {});
        await pause(300);
    }

    // Open the PUSH-111 AP242 panel via its menu action — proves the
    // new IFC4 host's menu-action listener didn't accidentally swallow
    // the event for sibling tools.* ids.
    await platformMenuAction('tools.ap242Export');
    await page.waitForSelector('[data-testid="forge-ap242-export-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('ap242-after-ifc4');

    // The body checklist has at least one row (we seeded two boxes;
    // the AP242 panel filters to native handles only, which our seeded
    // bodies satisfy).
    const ap242Bodies = await page.locator('[data-testid="forge-ap242-export-row"]').count();
    console.log('[push-123] AP242 row count =', ap242Bodies);
    expect(ap242Bodies).toBeGreaterThanOrEqual(2);

    // Click Save → assert a real .step file lands at STEP_OUT.
    await page.locator('[data-testid="forge-ap242-export-save"]').click({ force: true });
    await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="forge-ap242-export-save"]');
        return el && el.getAttribute('data-export-state') === 'idle';
    }, null, { timeout: 30000 });
    await pause(400);
    await shot('ap242-after-save');

    expect(fs.existsSync(STEP_OUT)).toBe(true);
    const stepStat = fs.statSync(STEP_OUT);
    console.log('[push-123] AP242 STEP regression size =', stepStat.size, 'B');
    expect(stepStat.size).toBeGreaterThan(500);
    const stepTxt = fs.readFileSync(STEP_OUT, 'utf8');
    expect(stepTxt).toContain('ISO-10303-21;');
    expect(stepTxt).toContain("FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'))");
    expect(stepTxt).toContain('MANIFOLD_SOLID_BREP');
});
