// PUSH-113 (Slice-82 / Drawing Templates Panel).
//
// PUSH-110 (Slice-79) shipped the Print Preview panel that paints the
// live HLR view2D onto an ISO/ANSI sheet with a five-row meta block.
// PUSH-113 lifts the catalogue side of that into reusable templates:
// predefined A0/A1/A2/A3/A4 sheets in portrait + landscape with a real
// engineering title block (Project / Drawing / Drawn by / Checked by /
// Sheet / Scale / Revision), a four-row revision history table, and a
// four-row × five-col BOM placeholder.
//
// Proof end-to-end through the real Electron UI:
//   00. Boot Electron, dismiss the first-run / onboarding overlays.
//       Confirm window.__forgeOpenDrawingTemplates +
//       window.__forgeDrawingTemplatesHelper are installed BEFORE the
//       panel mounts (proves the host wires on mount, not on open).
//       Validate the helper exports the 5 per-sheet builders + the
//       sheetMm / defaultTitleBlock helpers and that the canonical mm
//       dimensions are correct (A4 portrait = 210 × 297, A3 landscape
//       = 420 × 297).
//   01. Open Drawing Templates via tools.drawingTemplates menu action.
//       Assert the panel mounts with the canonical test-ids — picker
//       list, title-block fields, live SVG preview, save buttons.
//   02. Pick A3 (landscape via the predefined entry). Assert the info
//       chip reports A3 landscape = 420 × 297 mm + the panel's SVG
//       preview contains the canonical W3C svg + data-template-sheet
//       attribute.
//   03. Fill the title-block fields (Project / Drawing / Drawn by /
//       Checked by / Drawn date / Checked date / Scale / Revision).
//       Assert each field round-trips to the rendered SVG.
//   04. Save as custom… (name + Save). Assert the custom template
//       appears in the custom list with the right label, the active
//       template flips to the new custom one, and the saved entry is
//       persisted to localStorage (forge.v4.drawingTemplates).
//   05. Save SVG… to disk via the patched io:saveDialog. Assert the
//       SVG file is a real W3C svg with mm width/height, the right
//       paper dims, and the title-block + revision-table + BOM-table
//       <g data-layer="…"> markers.
//   06. Load into Drawings. Assert window.__forgeDrawingTemplateLoaded
//       carries the right SVG + sheetId + orientation + titleBlock
//       and the forge:drawing-template-loaded event fires.
//   07. Switch to A4 portrait. Assert dims = 210 × 297 mm and SVG
//       differs from the A3 landscape SVG.
//   08. PUSH-110 regression: Print Preview still opens, renders at
//       A4 portrait = 210 × 297 mm, and writes a real SVG on disk.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + host surface)
//   - front (open drawing templates panel)
//   - top   (pick A3 landscape + fill title block)
//   - right (save custom + save SVG)
//   - iso   (PUSH-110 regression + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-113-drawing-templates');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'drawing-templates-session.mp4');
const SVG_A3_LAND_CUSTOM = path.join(os.tmpdir(), `push-113-a3-landscape-custom-${Date.now()}.svg`);
const SVG_PUSH110_REG    = path.join(os.tmpdir(), `push-113-push110-reg-${Date.now()}.svg`);

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
    await pause(400);
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
        if (/push-113|drawing|template|preview|forge|error|Error/i.test(t)) {
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
    // Dismiss the onboarding tour overlay so it doesn't block clicks.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (e) {}
        try { window.__forgeFinishTour?.(); } catch (e) {}
        // Also wipe any prior custom templates so the e2e is reproducible.
        try { window.localStorage.removeItem('forge.v4.drawingTemplates'); } catch (e) {}
    });
    await pause(400);
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(200);
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
        console.error('[push-113] no .webm');
        return;
    }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) {
                console.log(`[push-113] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-113] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + host surface installed before opening the panel', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenDrawingTemplates,
        close:   typeof window.__forgeCloseDrawingTemplates,
        helper:  typeof window.__forgeDrawingTemplatesHelper,
        helperKeys: window.__forgeDrawingTemplatesHelper
            ? Object.keys(window.__forgeDrawingTemplatesHelper).sort()
            : [],
        sheetA4P: window.__forgeDrawingTemplatesHelper?.sheetMm?.('A4', 'portrait'),
        sheetA3L: window.__forgeDrawingTemplatesHelper?.sheetMm?.('A3', 'landscape'),
        sheetA0P: window.__forgeDrawingTemplatesHelper?.sheetMm?.('A0', 'portrait'),
        predefined: window.__forgeDrawingTemplatesHelper?.PREDEFINED_TEMPLATES?.length,
    }));
    console.log('[push-113] host surface =', JSON.stringify(surface));
    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('PREDEFINED_TEMPLATES');
    expect(surface.helperKeys).toContain('SCALE_OPTIONS');
    expect(surface.helperKeys).toContain('ISO_SHEETS');
    expect(surface.helperKeys).toContain('ORIENTATIONS');
    expect(surface.helperKeys).toContain('sheetMm');
    expect(surface.helperKeys).toContain('defaultTitleBlock');
    expect(surface.helperKeys).toContain('buildSheetTemplate');
    expect(surface.helperKeys).toContain('buildA0Template');
    expect(surface.helperKeys).toContain('buildA1Template');
    expect(surface.helperKeys).toContain('buildA2Template');
    expect(surface.helperKeys).toContain('buildA3Template');
    expect(surface.helperKeys).toContain('buildA4Template');
    expect(surface.helperKeys).toContain('loadCustomTemplates');
    expect(surface.helperKeys).toContain('saveCustomTemplate');
    expect(surface.helperKeys).toContain('deleteCustomTemplate');

    // Canonical sheet dimensions (ISO 216).
    expect(surface.sheetA4P.widthMm).toBe(210);
    expect(surface.sheetA4P.heightMm).toBe(297);
    expect(surface.sheetA3L.widthMm).toBe(420);
    expect(surface.sheetA3L.heightMm).toBe(297);
    expect(surface.sheetA0P.widthMm).toBe(841);
    expect(surface.sheetA0P.heightMm).toBe(1189);
    expect(surface.predefined).toBeGreaterThanOrEqual(7);

    // Per-sheet builders return real W3C SVGs with the right paper dims.
    const builderSurface = await page.evaluate(() => {
        const h = window.__forgeDrawingTemplatesHelper;
        return {
            a4: h.buildA4Template({ project: 'p4', drawing: 'd4' }),
            a3: h.buildA3Template({ project: 'p3', drawing: 'd3' }, { orientation: 'landscape' }),
            a0: h.buildA0Template({ project: 'p0', drawing: 'd0' }),
        };
    });
    expect(builderSurface.a4).toContain('width="210mm"');
    expect(builderSurface.a4).toContain('height="297mm"');
    expect(builderSurface.a4).toContain('data-template-sheet="A4"');
    expect(builderSurface.a4).toContain('p4');
    expect(builderSurface.a4).toContain('d4');
    expect(builderSurface.a3).toContain('width="420mm"');
    expect(builderSurface.a3).toContain('height="297mm"');
    expect(builderSurface.a3).toContain('data-template-sheet="A3"');
    expect(builderSurface.a0).toContain('width="841mm"');
    expect(builderSurface.a0).toContain('height="1189mm"');

    await shot('host-surface-ok');
});

test('01 — open Drawing Templates panel, assert canonical test-ids mount', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.drawingTemplates');
    await page.waitForSelector('[data-testid="forge-drawing-templates-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    await expect(page.locator('[data-testid="forge-drawing-templates-list"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A4-portrait"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A4-landscape"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A3-landscape"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A3-portrait"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A2-landscape"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A1-landscape"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-A0-landscape"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-project"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-drawing"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-drawnby"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-checkedby"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-drawndate"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-checkeddate"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-scale"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-revision"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-svg-container"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-save-svg"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-load-drawings"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-drawing-template-save-custom"]')).toBeVisible();
});

test('02 — pick A3 landscape, assert sheet dims = 420 × 297 mm', async () => {
    await cameraTo('top');
    await page.locator('[data-testid="forge-drawing-template-A3-landscape"]').click();
    await pause(300);
    await shot('A3-landscape-picked');
    const info = await page.locator('[data-testid="forge-drawing-templates-info"]')
        .evaluate((el) => ({
            activeId: el.getAttribute('data-active-id'),
            sheetId:  el.getAttribute('data-sheet-id'),
            orientation: el.getAttribute('data-orientation'),
            widthMm: Number(el.getAttribute('data-width-mm')),
            heightMm: Number(el.getAttribute('data-height-mm')),
        }));
    console.log('[push-113] active info =', JSON.stringify(info));
    expect(info.activeId).toBe('A3-landscape');
    expect(info.sheetId).toBe('A3');
    expect(info.orientation).toBe('landscape');
    expect(info.widthMm).toBe(420);
    expect(info.heightMm).toBe(297);
    // The live SVG preview must contain the W3C svg with A3 mm dims.
    const svgAttrs = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="forge-drawing-template-svg-container"]');
        const svg = c && c.querySelector('svg');
        return svg ? {
            width: svg.getAttribute('width'),
            height: svg.getAttribute('height'),
            viewBox: svg.getAttribute('viewBox'),
            sheet: svg.getAttribute('data-template-sheet'),
            orientation: svg.getAttribute('data-template-orientation'),
        } : null;
    });
    expect(svgAttrs).not.toBeNull();
    expect(svgAttrs.width).toBe('420mm');
    expect(svgAttrs.height).toBe('297mm');
    expect(svgAttrs.viewBox).toBe('0 0 420 297');
    expect(svgAttrs.sheet).toBe('A3');
    expect(svgAttrs.orientation).toBe('landscape');
});

test('03 — fill title block fields, round-trip into rendered SVG', async () => {
    const fields = {
        project: 'Apollo Pump Bracket',
        drawing: 'Front Mount Plate',
        drawnBy: 'sk',
        drawnDate: '2026-06-06',
        checkedBy: 'av',
        checkedDate: '2026-06-07',
        scale: '1:5',
        revision: 'B',
    };
    await page.locator('[data-testid="forge-drawing-template-project"]').fill(fields.project);
    await page.locator('[data-testid="forge-drawing-template-drawing"]').fill(fields.drawing);
    await page.locator('[data-testid="forge-drawing-template-drawnby"]').fill(fields.drawnBy);
    await page.locator('[data-testid="forge-drawing-template-drawndate"]').fill(fields.drawnDate);
    await page.locator('[data-testid="forge-drawing-template-checkedby"]').fill(fields.checkedBy);
    await page.locator('[data-testid="forge-drawing-template-checkeddate"]').fill(fields.checkedDate);
    await page.locator('[data-testid="forge-drawing-template-scale"]').selectOption(fields.scale);
    await page.locator('[data-testid="forge-drawing-template-revision"]').fill(fields.revision);
    await pause(400);
    await shot('title-block-filled');

    // The SVG container re-rendered with every keystroke; window publish
    // surface should reflect the live values.
    const live = await page.evaluate(() => window.__forgeDrawingTemplate);
    console.log('[push-113] live template = id', live.id, 'sheet', live.sheetId, 'tb fields', Object.keys(live.titleBlock).length);
    expect(live.id).toBe('A3-landscape');
    expect(live.sheetId).toBe('A3');
    expect(live.titleBlock.project).toBe(fields.project);
    expect(live.titleBlock.drawing).toBe(fields.drawing);
    expect(live.titleBlock.drawnBy).toBe(fields.drawnBy);
    expect(live.titleBlock.checkedBy).toBe(fields.checkedBy);
    expect(live.titleBlock.scale).toBe(fields.scale);
    expect(live.titleBlock.revision).toBe(fields.revision);

    // The SVG bytes must literally contain each field value.
    expect(live.svg).toContain(fields.project);
    expect(live.svg).toContain(fields.drawing);
    expect(live.svg).toContain(fields.drawnBy);
    expect(live.svg).toContain(fields.checkedBy);
    expect(live.svg).toContain(fields.drawnDate);
    expect(live.svg).toContain(fields.checkedDate);
    expect(live.svg).toContain(fields.scale);
    expect(live.svg).toContain(fields.revision);
    // Title-block + revision-table + BOM-table data-layer markers.
    expect(live.svg).toContain('data-layer="border"');
    expect(live.svg).toContain('data-layer="titleblock"');
    expect(live.svg).toContain('data-layer="revtable"');
    expect(live.svg).toContain('data-layer="bomtable"');
    expect(live.svg).toContain('data-layer="drawingarea"');
});

test('04 — Save as custom… persists template to localStorage + picker list', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-drawing-template-name"]')
        .fill('Apollo A3 Landscape');
    await page.locator('[data-testid="forge-drawing-template-save-custom"]').click();
    await pause(400);
    await shot('after-save-custom');
    // The custom-list region appears.
    const customList = page.locator('[data-testid="forge-drawing-templates-custom-list"]');
    await expect(customList).toBeVisible();
    // The new custom entry's label includes our typed name.
    const customButtons = await page.locator('[data-testid^="forge-drawing-template-custom-"]').all();
    expect(customButtons.length).toBeGreaterThanOrEqual(1);
    // localStorage carries the persisted template.
    const stored = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.drawingTemplates');
        return raw ? JSON.parse(raw) : null;
    });
    console.log('[push-113] persisted templates =', JSON.stringify(stored?.map((t) => t.id)));
    expect(Array.isArray(stored)).toBe(true);
    expect(stored.length).toBeGreaterThanOrEqual(1);
    const apollo = stored.find((t) => /apollo-a3-landscape/i.test(t.id));
    expect(apollo).toBeTruthy();
    expect(apollo.sheetId).toBe('A3');
    expect(apollo.orientation).toBe('landscape');
    expect(apollo.titleBlock.project).toBe('Apollo Pump Bracket');
    expect(apollo.titleBlock.revision).toBe('B');
    // Active template flipped to the new custom one.
    const info = await page.locator('[data-testid="forge-drawing-templates-info"]')
        .evaluate((el) => el.getAttribute('data-active-id'));
    expect(info).toMatch(/^custom-apollo-a3-landscape-/);
});

test('05 — Save SVG to disk writes a real W3C SVG', async () => {
    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, SVG_A3_LAND_CUSTOM);

    await page.locator('[data-testid="forge-drawing-template-save-svg"]').click();
    await pause(800);
    await shot('after-save-svg');

    const reportedPath = await page.evaluate(() => window.__forgeLastDrawingTemplatePath || null);
    console.log('[push-113] reported path =', reportedPath, 'expected =', SVG_A3_LAND_CUSTOM);
    expect(reportedPath).toBe(SVG_A3_LAND_CUSTOM);

    expect(fs.existsSync(SVG_A3_LAND_CUSTOM)).toBe(true);
    const body = fs.readFileSync(SVG_A3_LAND_CUSTOM, 'utf8');
    const size = Buffer.byteLength(body);
    console.log('[push-113] SVG size =', size, 'B');
    expect(size).toBeGreaterThan(800);
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(body).toContain('width="420mm"');
    expect(body).toContain('height="297mm"');
    expect(body).toContain('viewBox="0 0 420 297"');
    expect(body).toContain('data-template-sheet="A3"');
    expect(body).toContain('data-template-orientation="landscape"');
    expect(body).toContain('data-layer="border"');
    expect(body).toContain('data-layer="titleblock"');
    expect(body).toContain('data-layer="revtable"');
    expect(body).toContain('data-layer="bomtable"');
    expect(body).toContain('data-layer="drawingarea"');
    expect(body).toContain('Apollo Pump Bracket');
    expect(body).toContain('Front Mount Plate');
    expect(body).toContain('1:5');
});

test('06 — Load into Drawings publishes __forgeDrawingTemplateLoaded + fires event', async () => {
    // Subscribe to forge:drawing-template-loaded BEFORE clicking the button.
    await page.evaluate(() => {
        window.__push113EventReceived = null;
        window.addEventListener('forge:drawing-template-loaded', (e) => {
            window.__push113EventReceived = {
                hasSvg: typeof e.detail?.svg === 'string',
                sheetId: e.detail?.sheetId,
                orientation: e.detail?.orientation,
                loadedAt: e.detail?.loadedAt,
            };
        }, { once: true });
    });

    await page.locator('[data-testid="forge-drawing-template-load-drawings"]').click();
    await pause(500);
    await shot('after-load-drawings');

    const loaded = await page.evaluate(() => ({
        loadedRecord: window.__forgeDrawingTemplateLoaded ? {
            sheetId: window.__forgeDrawingTemplateLoaded.sheetId,
            orientation: window.__forgeDrawingTemplateLoaded.orientation,
            hasSvg: typeof window.__forgeDrawingTemplateLoaded.svg === 'string',
            svgPrefix: (window.__forgeDrawingTemplateLoaded.svg || '').slice(0, 80),
            loadedAt: window.__forgeDrawingTemplateLoaded.loadedAt,
        } : null,
        event: window.__push113EventReceived,
    }));
    console.log('[push-113] loaded =', JSON.stringify(loaded));
    expect(loaded.loadedRecord).not.toBeNull();
    expect(loaded.loadedRecord.sheetId).toBe('A3');
    expect(loaded.loadedRecord.orientation).toBe('landscape');
    expect(loaded.loadedRecord.hasSvg).toBe(true);
    expect(loaded.loadedRecord.svgPrefix).toContain('<?xml version="1.0"');
    expect(typeof loaded.loadedRecord.loadedAt).toBe('number');
    expect(loaded.event).not.toBeNull();
    expect(loaded.event.hasSvg).toBe(true);
    expect(loaded.event.sheetId).toBe('A3');
    expect(loaded.event.orientation).toBe('landscape');
});

test('07 — switch to A4 portrait, sheet dims = 210 × 297 mm + new SVG', async () => {
    // Capture current SVG (A3-landscape) before switching.
    const a3Svg = await page.evaluate(() => window.__forgeDrawingTemplate?.svg || '');
    await page.locator('[data-testid="forge-drawing-template-A4-portrait"]').click();
    await pause(300);
    await shot('A4-portrait-picked');
    const info = await page.locator('[data-testid="forge-drawing-templates-info"]')
        .evaluate((el) => ({
            sheetId:  el.getAttribute('data-sheet-id'),
            orientation: el.getAttribute('data-orientation'),
            widthMm: Number(el.getAttribute('data-width-mm')),
            heightMm: Number(el.getAttribute('data-height-mm')),
        }));
    expect(info.sheetId).toBe('A4');
    expect(info.orientation).toBe('portrait');
    expect(info.widthMm).toBe(210);
    expect(info.heightMm).toBe(297);
    const a4Svg = await page.evaluate(() => window.__forgeDrawingTemplate?.svg || '');
    expect(a4Svg).toContain('width="210mm"');
    expect(a4Svg).toContain('height="297mm"');
    expect(a4Svg).toContain('data-template-sheet="A4"');
    expect(a4Svg).not.toBe(a3Svg);
});

test('08 — PUSH-110 regression: Print Preview still renders A4 portrait + writes SVG', async () => {
    await cameraTo('iso');
    // Close drawing templates panel first.
    await page.locator('[data-testid="forge-drawing-templates-close"]').click().catch(() => {});
    await pause(300);
    // Open Print Preview via the same menu surface PUSH-110 uses.
    await platformMenuAction('tools.printPreview');
    await page.waitForSelector('[data-testid="forge-print-preview-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('push110-print-preview-open');
    // Default dims A4 portrait.
    const dims = await page.locator('[data-testid="forge-print-preview-dimensions"]')
        .evaluate((el) => ({
            widthMm: Number(el.getAttribute('data-width-mm')),
            heightMm: Number(el.getAttribute('data-height-mm')),
        }));
    expect(dims.widthMm).toBe(210);
    expect(dims.heightMm).toBe(297);
    // Save SVG path.
    await app.evaluate(async ({ ipcMain }, tmpPath) => {
        try { ipcMain.removeHandler('io:saveDialog'); } catch {}
        ipcMain.handle('io:saveDialog', async () => tmpPath);
    }, SVG_PUSH110_REG);
    await page.locator('[data-testid="forge-print-preview-save-svg"]').click();
    await pause(800);
    await shot('after-push110-regression-save');
    expect(fs.existsSync(SVG_PUSH110_REG)).toBe(true);
    const body = fs.readFileSync(SVG_PUSH110_REG, 'utf8');
    console.log('[push-113] PUSH-110 regression SVG size =', body.length, 'B');
    expect(body.length).toBeGreaterThan(400);
    expect(body).toContain('<?xml version="1.0"');
    expect(body).toContain('width="210mm"');
    expect(body).toContain('height="297mm"');
    expect(body).toContain('viewBox="0 0 210 297"');
    expect(body).toContain('data-layer="titleblock"');
});
