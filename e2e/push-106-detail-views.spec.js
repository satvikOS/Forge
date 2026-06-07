// PUSH-106 (Slice-75) — Detail View Circles panel.
//
// The user's brief:
//   "a Detail View Circles panel that:
//    - Lets user define N detail regions per parent view:
//      {cx, cy, radius, scale=2, label='A'}
//    - Generates SVG snippet showing circle + leader to detail tag
//    - Computes the zoomed view (use forge.drawings.projectDetail if
//      available)
//    - Stores definitions in window.__forgeDetailViews
//
//    e2e: seed 50×40×30 body, open panel, add 2 detail circles (one at
//    top edge, one at hole feature), assert window.__forgeDetailViews
//    has 2 entries. 5 cameras."
//
// Proof end-to-end:
//   00 — boot + helper API mounted; the headless helper exposes the
//        SVG snippet builder + the runDetailViewsPipeline driver so the
//        spec can also assert the pure math without React mounting. (iso)
//   01 — seed a real OCCT 50×40×30 box body so projectDetail has
//        something to chew on. (front)
//   02 — open the Detail Views panel via tools.detailViews; the default
//        2-row table mounts (cx/cy/r/scale/label per row + Generate
//        button). Override row 1 to "top edge" coords (cx=0, cy=20, r=6),
//        row 2 to "hole feature" coords (cx=15, cy=-10, r=4, scale=4).
//        Click Generate. (top)
//   03 — Assert window.__forgeDetailViews now holds 2 entries with the
//        right labels (A, B) + scales (2, 4) + radii (6, 4). Each entry
//        carries a projection.source — kernel when the addon is wired,
//        otherwise a real error string (never silently fake). The bus
//        event forge:detail-views-generated fired with count=2. (right)
//   04 — Add a 3rd region via the + button, set its label to "C" via
//        the table input, click Generate again; confirm
//        window.__forgeDetailViews.count === 3 + the latest entry has
//        label "C". Regression for PUSH-62: open the Drawings HLR
//        workbench in projection mode and assert the front projection
//        still auto-runs (visible-edge count > 0). (iso-close)
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso     (boot + helper API + pure math)
//   - front   (body seed)
//   - top     (panel open + table + Generate)
//   - right   (window.__forgeDetailViews assertions + bus event)
//   - iso-close (3rd region + PUSH-62 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-106-detail-views');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'detail-views-session.mp4');

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

async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
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
        if (/push-106|detail-views|DetailViews|forge:detail|projectDetail|forge|error|Error/i.test(t)) {
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
        console.error('[push-106] no .webm'); return;
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
                console.log(`[push-106] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-106] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + headless math ok (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Helper API installs at module import time. App.jsx imports
    // DetailViewsPanelHost so the helper is live without any user
    // action.
    await page.waitForFunction(
        () => !!window.__forgeDetailViewsHelper
           && typeof window.__forgeDetailViewsHelper.runDetailViewsPipeline === 'function'
           && typeof window.__forgeDetailViewsHelper.svgParentSnippet === 'function'
           && typeof window.__forgeDetailViewsHelper.normaliseRegions === 'function',
        null, { timeout: 8000 });

    const helperShape = await page.evaluate(() => {
        const h = window.__forgeDetailViewsHelper;
        return {
            keys: Object.keys(h).sort(),
            event: h.EVENT_NAME,
            storage: h.STORAGE_KEY,
            defaults: h.defaultRegions().length,
            firstLabel: h.defaultRegions()[0]?.label,
            parentWidth: h.PARENT_VIEW.width,
            parentHeight: h.PARENT_VIEW.height,
        };
    });
    expect(helperShape.event).toBe('forge:detail-views-generated');
    expect(helperShape.storage).toBe('forge.v4.detailViews');
    expect(helperShape.defaults).toBe(2);
    expect(helperShape.firstLabel).toBe('A');
    expect(helperShape.parentWidth).toBe(100);
    expect(helperShape.parentHeight).toBe(60);
    expect(helperShape.keys).toEqual(expect.arrayContaining([
        'defaultRegions', 'nextDetailLetter', 'normaliseRegion',
        'normaliseRegions', 'svgParentSnippet', 'svgDetailSnippet',
        'pickBodyHandle', 'packedDetailToEdgeList', 'projectDetailReal',
        'runDetailViewsPipeline',
        'PARENT_VIEW', 'EVENT_NAME', 'STORAGE_KEY',
    ]));

    // Pure math sanity. The parent SVG snippet must contain one circle
    // per region (in the default 2-row table) + the unit rectangle.
    const svgCheck = await page.evaluate(() => {
        const h = window.__forgeDetailViewsHelper;
        const rows = h.defaultRegions();
        const svg = h.svgParentSnippet(rows);
        return {
            svg,
            len: svg.length,
            hasRect: svg.includes('<rect '),
            circles: (svg.match(/<circle /g) || []).length,
            tags: rows.map((r) => svg.includes(`>${r.label}<`)),
        };
    });
    expect(svgCheck.hasRect).toBe(true);
    // One callout circle + one tag bubble per region = 2 circles per row.
    expect(svgCheck.circles).toBe(4);
    expect(svgCheck.tags).toEqual([true, true]);

    // Auto-label collision resolution: feeding two rows with the same
    // label forces the 2nd to the next free letter.
    const dedup = await page.evaluate(() => {
        const h = window.__forgeDetailViewsHelper;
        const out = h.normaliseRegions([
            { cx: 0, cy: 0, radius: 5, scale: 2, label: 'A' },
            { cx: 10, cy: 0, radius: 4, scale: 3, label: 'A' },
            { cx: -5, cy: 5, radius: 3, scale: 2, label: '' },
        ]);
        return out.map((r) => r.label);
    });
    expect(dedup).toEqual(['A', 'B', 'C']);
});

test('01 — seed a real OCCT 50×40×30 box (front)', async () => {
    await cameraTo('front');

    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(50, 40, 30);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-detail', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 50x40x30',
            params: { width: 50, height: 40, distance: 30 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');
});

test('02 — open Detail Views panel; 2-row default + override + Generate (top)', async () => {
    await cameraTo('top');

    // Sanity: the Host mounted and installed its imperative open hook.
    await page.waitForFunction(
        () => typeof window.__forgeOpenDetailViews === 'function',
        null, { timeout: 4000 });

    await platformMenuAction('tools.detailViews');
    // Allow React to re-render after setOpen(true).
    await pause(500);
    // Fallback: drive the imperative API if the menu-action route ever
    // races a host remount before listener install.
    const panelMounted = await page.evaluate(() =>
        !!document.querySelector('[data-testid="forge-detail-views-panel"]'));
    if (!panelMounted) {
        await page.evaluate(() => window.__forgeOpenDetailViews?.());
        await pause(400);
    }
    await page.waitForSelector('[data-testid="forge-detail-views-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Default table mounts with the 2-row seed.
    const rowCount = await page.locator('[data-testid="forge-detail-views-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(2);
    const regionCount = await page.locator('[data-testid="forge-detail-views-panel"]')
                                    .getAttribute('data-region-count');
    expect(Number(regionCount)).toBe(2);

    // The panel resolves to the seeded box body.
    const targetHandle = await page.locator('[data-testid="forge-detail-views-panel"]')
                                    .getAttribute('data-body-handle');
    expect(Number(targetHandle)).toBeGreaterThan(0);

    // Override row 0 to "top edge" coords. The box is BRepPrimAPI
    // MakeBox(50,40,30) so on the FRONT view (looking down -Y) the
    // screen frame is screen-X = world-X ∈ [0,50] and screen-Y =
    // world-Z ∈ [0,30]. Top edge of the box maps to screen (25, 28).
    await setReactInput('forge-detail-views-cx-0', '25');
    await setReactInput('forge-detail-views-cy-0', '28');
    await setReactInput('forge-detail-views-r-0', '6');
    await setReactInput('forge-detail-views-scale-0', '2');
    await setReactInput('forge-detail-views-label-0', 'A');

    // Override row 1 to "hole feature" coords — a representative spot
    // on the front face that would normally house a fastener hole.
    await setReactInput('forge-detail-views-cx-1', '15');
    await setReactInput('forge-detail-views-cy-1', '12');
    await setReactInput('forge-detail-views-r-1', '4');
    await setReactInput('forge-detail-views-scale-1', '4');
    await setReactInput('forge-detail-views-label-1', 'B');
    await shot('rows-overridden');

    // Subscribe to the bus event before clicking Generate.
    await page.evaluate(() => {
        window.__push106Events = [];
        window.addEventListener('forge:detail-views-generated', (e) => {
            window.__push106Events.push({
                count: e?.detail?.count,
                bodyHandle: e?.detail?.bodyHandle,
                direction: e?.detail?.direction,
                ts: e?.detail?.ts,
            });
        });
    });

    // Click Generate. DOM-level click avoids racing with overlays.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-detail-views-generate"]');
        if (!btn) throw new Error('generate button missing');
        btn.click();
    });
    await pause(500);
    await shot('after-generate');

    // The two detail tiles render with their labels.
    const tileA = page.locator('[data-testid="forge-detail-views-detail-A"]');
    const tileB = page.locator('[data-testid="forge-detail-views-detail-B"]');
    await expect(tileA).toBeVisible();
    await expect(tileB).toBeVisible();
});

test('03 — window.__forgeDetailViews holds the 2 entries + bus event fired (right)', async () => {
    await cameraTo('right');

    // The brief's primary assertion: the global mirror is populated.
    const mirror = await page.evaluate(() => {
        const dv = window.__forgeDetailViews;
        if (!dv) return null;
        return {
            count: dv.count,
            direction: dv.direction,
            bodyHandle: dv.bodyHandle,
            entries: dv.entries.map((e) => ({
                label: e.region.label,
                cx: e.region.cx,
                cy: e.region.cy,
                radius: e.region.radius,
                scale: e.region.scale,
                source: e.projection?.source,
                edgeCount: Array.isArray(e.projection?.edges)
                    ? e.projection.edges.length : 0,
            })),
        };
    });
    expect(mirror).not.toBeNull();
    expect(mirror.count).toBe(2);
    expect(mirror.entries.length).toBe(2);
    expect(mirror.bodyHandle).toBeGreaterThan(0);
    expect(mirror.direction).toBe('front');

    // Row A — top edge.
    expect(mirror.entries[0].label).toBe('A');
    expect(mirror.entries[0].cx).toBe(25);
    expect(mirror.entries[0].cy).toBe(28);
    expect(mirror.entries[0].radius).toBe(6);
    expect(mirror.entries[0].scale).toBe(2);

    // Row B — hole feature.
    expect(mirror.entries[1].label).toBe('B');
    expect(mirror.entries[1].cx).toBe(15);
    expect(mirror.entries[1].cy).toBe(12);
    expect(mirror.entries[1].radius).toBe(4);
    expect(mirror.entries[1].scale).toBe(4);

    // Each projection source must be one of the real states — kernel
    // (addon returned), error (kernel threw / refused with a diagnostic),
    // no-handle (no body selected). Never silently fabricated.
    for (const e of mirror.entries) {
        expect(['kernel', 'error', 'no-handle']).toContain(e.source);
    }
    console.log('[push-106] entry sources =',
        mirror.entries.map((e) => `${e.label}:${e.source}/${e.edgeCount}`).join(' '));
    // With a real body handle wired, at least one entry should reach
    // the kernel surface (even if the focus circle's clip is empty,
    // source is 'kernel' and edges are an empty array — see
    // packedDetailToEdgeList).
    const kernelEntries = mirror.entries.filter((e) => e.source === 'kernel');
    expect(kernelEntries.length).toBeGreaterThan(0);

    // Bus event fired with count=2.
    const events = await page.evaluate(() => window.__push106Events || []);
    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.count).toBe(2);
    expect(last.bodyHandle).toBe(mirror.bodyHandle);
    expect(last.direction).toBe('front');
});

test('04 — add a 3rd region + PUSH-62 regression (iso-close)', async () => {
    await cameraTo('iso');
    await pause(200);

    // Add a 3rd region.
    await page.locator('[data-testid="forge-detail-views-add"]').click();
    await pause(150);
    const rowCount = await page.locator('[data-testid="forge-detail-views-table"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(3);
    // The 3rd row auto-picks 'C'.
    const c2 = await page.locator('[data-testid="forge-detail-views-label-2"]').inputValue();
    expect(c2).toBe('C');
    // Drive a non-default location so the SVG callout isn't on top of
    // the others. Stay inside the box's projected bbox [0,50]×[0,30].
    await setReactInput('forge-detail-views-cx-2', '40');
    await setReactInput('forge-detail-views-cy-2', '5');
    await setReactInput('forge-detail-views-r-2', '5');
    await setReactInput('forge-detail-views-scale-2', '3');
    await pause(150);

    // Regenerate.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-detail-views-generate"]');
        btn.click();
    });
    await pause(500);
    await shot('three-regions');

    // Verify mirror.count === 3 and last entry label "C".
    const mirror3 = await page.evaluate(() => {
        const dv = window.__forgeDetailViews;
        if (!dv) return null;
        return {
            count: dv.count,
            labels: dv.entries.map((e) => e.region.label),
            lastScale: dv.entries[dv.entries.length - 1].region.scale,
        };
    });
    expect(mirror3).not.toBeNull();
    expect(mirror3.count).toBe(3);
    expect(mirror3.labels).toEqual(['A', 'B', 'C']);
    expect(mirror3.lastScale).toBe(3);

    // Bus events keep firing on each Generate.
    const events = await page.evaluate(() => window.__push106Events || []);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[events.length - 1].count).toBe(3);

    // Close the Detail Views panel so its right-docked footprint
    // doesn't intercept the Drawings HLR panel that PUSH-62 ships.
    await page.evaluate(() => {
        if (typeof window.__forgeCloseDetailViews === 'function') {
            window.__forgeCloseDetailViews();
        }
    });
    await pause(250);

    // PUSH-62 regression — open Drawings HLR, assert front projection
    // still auto-runs in projection mode (visible-edge count > 0).
    await platformMenuAction('tools.drawingsHlr');
    await page.waitForSelector('[data-testid="forge-drawingshlr-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('drawings-hlr-regression');
    const modeToggle = page.locator('[data-testid="forge-drawingshlr-mode"]');
    await expect(modeToggle).toBeVisible();
    expect(await modeToggle.inputValue()).toBe('projection');
    const visibleCount = await page.locator('[data-testid="forge-drawingshlr-visible-count"]')
                                    .textContent();
    console.log('[push-106] PUSH-62 regression: FRONT visible edges =', visibleCount);
    expect(Number(visibleCount)).toBeGreaterThan(0);

    // Detail Views helper API survives — PUSH-106 + PUSH-62 don't trample.
    const bothOk = await page.evaluate(() =>
        typeof window.__forgeDetailViewsHelper?.runDetailViewsPipeline === 'function'
        && !!window.forge?.drawings?.projectView);
    expect(bothOk).toBe(true);
});
