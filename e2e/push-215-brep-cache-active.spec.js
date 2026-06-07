// PUSH-215 (Slice-154) — BREP active-load cache end-to-end.
//
// PUSH-163 shipped the offline `.forgeCache.zip` save / load round-trip
// (panel: BrepCachePanel, helper: __forgeBrepCacheHelper). PUSH-215 wires
// the *live* restore path the next-session loader actually hits: per-body
// BREP bytes kept in RAM + localStorage so reopening a session restores
// every native body straight through `forge.io.importBrep` without
// re-running its feature script.
//
// Proof end-to-end through the real Electron UI:
//   00 — Boot. Confirm window.__forgeOpenBrepCacheActive is a function
//        BEFORE the panel mounts, and that __forgeBrepCacheActiveHelper
//        exposes the four canonical entry points (saveSceneToActiveCache,
//        loadActiveCacheIntoScene, listActiveCacheEntries, clearActiveCache).
//        Wipe any stale localStorage so the test starts from zero.
//   01 — Open the active panel via the tools.brepCacheActive menu action.
//        Assert the panel mounts, the empty-state hint renders, and the
//        cached count chip reads 0.
//   02 — Seed 3 native bodies (forge.makeBox at 3 different sizes), click
//        "Save current scene to cache", and assert the listing now shows
//        3 entries with non-zero size_bytes + non-empty names.
//   03 — Wipe window.__forgeBodies, click "Load all", and assert that
//        __forgeBodies.length === 3 again and every restored body has a
//        fresh numeric kernel handle.
//   04 — Click "Clear" and assert both the listing and the persisted
//        localStorage key drop to zero.
//   05 — Close the panel + final shot.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + helper surface)
//   - front (open panel)
//   - top   (seed + save scene)
//   - right (clear bodies + load all → __forgeBodies = 3)
//   - iso   (clear + close + final shot)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-215-brep-cache-active');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'brep-cache-active-session.mp4');

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
        if (/push-215|brepCache|brep-cache|forge|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    page.on('pageerror', (err) => {
        console.log('[browser.pageerror]', err.message);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);

    // Onboarding / Discard / Set dismissal (same as PUSH-200).
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});

    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
        try { window.__forgeFinishTour?.(); } catch {}
    });
    await pause(400);
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(200);
    }

    // Wipe any stale active-cache state from previous runs so the test
    // starts from an empty cache + an empty body list.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.brepCacheActive'); } catch {}
        try { window.__forgeBrepCacheActiveHelper?.clearActiveCache(); } catch {}
        try { window.__forgeSetBodies?.([]); } catch {}
    });
    await pause(600);
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
        console.error('[push-215] no .webm');
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
                console.log(`[push-215] mp4 written: ${FINAL_MP4}`
                    + ` (${(fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-215] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// 00 — host hook + helper surface installed BEFORE the panel mounts.

test('00 — boot + __forgeOpenBrepCacheActive is a function + helper API', async () => {
    await cameraTo('iso');
    await shot('boot');

    const surface = await page.evaluate(() => ({
        open:    typeof window.__forgeOpenBrepCacheActive,
        close:   typeof window.__forgeCloseBrepCacheActive,
        helper:  typeof window.__forgeBrepCacheActiveHelper,
        helperKeys: window.__forgeBrepCacheActiveHelper
            ? Object.keys(window.__forgeBrepCacheActiveHelper).sort()
            : [],
        kernelExportBrep: typeof window.forge?.io?.exportBrep,
        kernelImportBrep: typeof window.forge?.io?.importBrep,
        version: window.__forgeBrepCacheActiveHelper?.FORGE_BREP_CACHE_ACTIVE_VERSION,
        initialListing: window.__forgeBrepCacheActiveHelper?.listActiveCacheEntries?.() ?? null,
    }));
    console.log('[push-215] host surface =', JSON.stringify(surface));

    expect(surface.open).toBe('function');
    expect(surface.close).toBe('function');
    expect(surface.helper).toBe('object');
    expect(surface.helperKeys).toContain('saveSceneToActiveCache');
    expect(surface.helperKeys).toContain('loadActiveCacheIntoScene');
    expect(surface.helperKeys).toContain('listActiveCacheEntries');
    expect(surface.helperKeys).toContain('listCachedActiveIds');
    expect(surface.helperKeys).toContain('clearActiveCache');
    expect(surface.helperKeys).toContain('saveBodyToActiveCache');
    expect(surface.helperKeys).toContain('loadBodyFromActiveCache');

    // Kernel BREP round-trip surface must exist — PUSH-215 hard
    // constraint: surface the real error if the kernel API is missing
    // rather than ship a silent no-op.
    expect(surface.kernelExportBrep).toBe('function');
    expect(surface.kernelImportBrep).toBe('function');

    expect(surface.version).toBe('1.0.0');
    // Empty cache after the beforeAll wipe.
    expect(Array.isArray(surface.initialListing)).toBe(true);
    expect(surface.initialListing.length).toBe(0);

    await shot('host-surface-ok');
});

// ─────────────────────────────────────────────────────────────────────
// 01 — open via tools.brepCacheActive menu action.

test('01 — open active panel via tools.brepCacheActive', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.brepCacheActive');
    await page.waitForSelector('[data-testid="forge-brepcache-active-panel"]',
        { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // Empty-state visible + count chip reads 0.
    await expect(page.locator('[data-testid="forge-brepcache-active-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-brepcache-active-empty"]')).toBeVisible();
    const chip = await page.locator('[data-testid="forge-brepcache-active-count"]').textContent();
    console.log('[push-215] count chip =', chip);
    expect(chip).toContain('0 cached');

    // The four canonical control buttons are mounted.
    await expect(page.locator('[data-testid="forge-brepcache-active-load-all"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-brepcache-active-save-scene"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-brepcache-active-clear"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-brepcache-active-reload"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-brepcache-active-close"]')).toBeVisible();

    // Load all / Clear should be disabled while the cache is empty.
    const loadAllDisabled = await page.locator('[data-testid="forge-brepcache-active-load-all"]')
        .getAttribute('disabled');
    expect(loadAllDisabled).not.toBeNull();
});

// ─────────────────────────────────────────────────────────────────────
// 02 — seed 3 native bodies + click "Save current scene to cache".

test('02 — seed 3 bodies + save scene → 3 cached entries', async () => {
    await cameraTo('top');

    // Seed three native boxes at distinct sizes through the real kernel.
    const seeded = await page.evaluate(() => {
        const made = [];
        const sizes = [
            { id: 'push215-box-a', name: 'Box A 40×30×20', dims: [40, 30, 20] },
            { id: 'push215-box-b', name: 'Box B 50×50×50', dims: [50, 50, 50] },
            { id: 'push215-box-c', name: 'Box C 60×20×10', dims: [60, 20, 10] },
        ];
        if (typeof window.forge?.makeBox !== 'function') {
            return { error: 'forge.makeBox unavailable on kernel surface' };
        }
        // Reset bodies + clear cache so we have a clean baseline.
        try { window.__forgeSetBodies?.([]); } catch {}
        try { window.__forgeBrepCacheActiveHelper?.clearActiveCache(); } catch {}
        for (const s of sizes) {
            const h = window.forge.makeBox(...s.dims);
            if (typeof h !== 'number') {
                return { error: `forge.makeBox returned non-number for ${s.id}` };
            }
            const body = {
                id: s.id, kind: 'native', handle: h,
                toolId: 'solid.box', name: s.name,
                params: { dx: s.dims[0], dy: s.dims[1], dz: s.dims[2] },
            };
            window.__forgeAppendBody(body);
            made.push({ id: s.id, handle: h, dims: s.dims });
        }
        return { made };
    });
    console.log('[push-215] seeded =', JSON.stringify(seeded));
    expect(seeded.error).toBeUndefined();
    expect(Array.isArray(seeded.made)).toBe(true);
    expect(seeded.made.length).toBe(3);

    // Confirm __forgeBodies surfaces all three.
    const bodyCount = await page.evaluate(() => window.__forgeBodies?.length ?? 0);
    expect(bodyCount).toBe(3);

    await shot('three-boxes-seeded');

    // Click the save-scene button. Wait for the listing to populate.
    await page.locator('[data-testid="forge-brepcache-active-save-scene"]').click();

    // Poll until the listing publishes 3 entries.
    let rows = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        rows = await page.evaluate(() => {
            const helper = window.__forgeBrepCacheActiveHelper;
            return helper ? helper.listActiveCacheEntries() : [];
        });
        if (rows.length >= 3) break;
        await pause(400);
    }
    console.log('[push-215] cached rows =', JSON.stringify(rows));
    expect(rows.length).toBe(3);

    // Every row carries a non-empty name + a positive size_bytes (BREP
    // bytes round-tripped through forge.io.exportBrep + fetch+readFileBytes).
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual(['push215-box-a', 'push215-box-b', 'push215-box-c']);
    for (const r of rows) {
        expect(typeof r.size_bytes).toBe('number');
        expect(r.size_bytes).toBeGreaterThan(0);
        expect(typeof r.name).toBe('string');
        expect(r.name.length).toBeGreaterThan(0);
    }

    // The panel's table should also render 3 row test-ids.
    await page.waitForSelector('[data-testid="forge-brepcache-active-row"]',
        { state: 'visible', timeout: 5000 });
    const rowCount = await page.locator('[data-testid="forge-brepcache-active-row"]').count();
    expect(rowCount).toBe(3);

    // Count chip should now read 3 cached.
    const chip = await page.locator('[data-testid="forge-brepcache-active-count"]').textContent();
    console.log('[push-215] post-save chip =', chip);
    expect(chip).toContain('3 cached');

    // localStorage was persisted.
    const lsLen = await page.evaluate(() => {
        const raw = window.localStorage.getItem('forge.v4.brepCacheActive');
        if (!raw) return 0;
        try {
            const obj = JSON.parse(raw);
            return Array.isArray(obj.entries) ? obj.entries.length : 0;
        } catch { return 0; }
    });
    expect(lsLen).toBe(3);

    await shot('three-cached');
});

// ─────────────────────────────────────────────────────────────────────
// 03 — clear bodies + load all → __forgeBodies = 3 again.

test('03 — clear bodies + Load all → __forgeBodies.length === 3', async () => {
    await cameraTo('right');

    // Drop window.__forgeBodies via the shell setter. (Direct mutation
    // of the array doesn't drive React state — the setter is the
    // canonical entry point.)
    await page.evaluate(() => {
        try { window.__forgeSetBodies?.([]); } catch {}
    });
    await pause(500);
    const before = await page.evaluate(() => window.__forgeBodies?.length ?? 0);
    console.log('[push-215] bodies before load =', before);
    expect(before).toBe(0);

    // Listen for the forge:bodies-changed dispatch so we know the load
    // path fired the canonical event.
    await page.evaluate(() => {
        window.__push215BodiesChanged = 0;
        window.addEventListener('forge:bodies-changed', () => {
            window.__push215BodiesChanged += 1;
        });
    });

    // Reset last-load + kick the load.
    await page.evaluate(() => { try { delete window.__forgeBrepCacheActiveLastLoad; } catch {} });
    await page.locator('[data-testid="forge-brepcache-active-load-all"]').click();

    // Poll for __forgeBodies.length === 3 + last-load record.
    let result = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        result = await page.evaluate(() => {
            const r = window.__forgeBrepCacheActiveLastLoad;
            const len = Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0;
            return { r, len, bodiesChanged: window.__push215BodiesChanged };
        });
        if (result.r && result.len >= 3) break;
        await pause(400);
    }
    console.log('[push-215] load result =', JSON.stringify(result));
    expect(result.r).not.toBeNull();
    expect(Array.isArray(result.r.restored)).toBe(true);
    expect(result.r.restored.length).toBe(3);
    expect(result.r.errors.length).toBe(0);
    expect(result.len).toBe(3);
    // The canonical viewport-refresh event fired at least once.
    expect(result.bodiesChanged).toBeGreaterThanOrEqual(1);

    // Every restored body got a fresh numeric kernel handle through
    // forge.io.importBrep.
    const bodiesNow = await page.evaluate(() => {
        return (Array.isArray(window.__forgeBodies) ? window.__forgeBodies : []).map((b) => ({
            id: b.id, kind: b.kind, handle: b.handle, name: b.name, toolId: b.toolId,
        }));
    });
    console.log('[push-215] bodies after load =', JSON.stringify(bodiesNow));
    expect(bodiesNow.length).toBe(3);
    for (const b of bodiesNow) {
        expect(b.kind).toBe('native');
        expect(typeof b.handle).toBe('number');
        expect(Number.isFinite(b.handle)).toBe(true);
        expect(b.toolId).toBe('solid.box');
        expect(['push215-box-a', 'push215-box-b', 'push215-box-c']).toContain(b.id);
    }

    // Restore report should render 3 rows in the panel.
    await page.waitForSelector('[data-testid="forge-brepcache-active-load-report"]',
        { state: 'visible', timeout: 5000 });
    const restoreRows = await page.locator('[data-testid="forge-brepcache-active-restore-row"]').count();
    expect(restoreRows).toBe(3);

    await shot('three-restored');
});

// ─────────────────────────────────────────────────────────────────────
// 04 — click "Clear" → listing empty + localStorage empty.

test('04 — Clear → cache listing empty + localStorage clears', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-brepcache-active-clear"]').click();
    await pause(400);

    const after = await page.evaluate(() => {
        const helper = window.__forgeBrepCacheActiveHelper;
        const rows = helper ? helper.listActiveCacheEntries() : [];
        let lsLen = 0;
        try {
            const raw = window.localStorage.getItem('forge.v4.brepCacheActive');
            if (raw) {
                const obj = JSON.parse(raw);
                lsLen = Array.isArray(obj.entries) ? obj.entries.length : 0;
            }
        } catch {}
        return { rows, lsLen };
    });
    console.log('[push-215] post-clear =', JSON.stringify(after));
    expect(after.rows.length).toBe(0);
    expect(after.lsLen).toBe(0);

    // Empty state hint visible again.
    await expect(page.locator('[data-testid="forge-brepcache-active-empty"]')).toBeVisible();
    // Count chip back to 0 cached.
    const chip = await page.locator('[data-testid="forge-brepcache-active-count"]').textContent();
    expect(chip).toContain('0 cached');

    await shot('cache-cleared');
});

// ─────────────────────────────────────────────────────────────────────
// 05 — close panel + final shot.

test('05 — close panel + final shot', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-brepcache-active-close"]').click().catch(() => {});
    await pause(400);
    const visible = await page.locator('[data-testid="forge-brepcache-active-panel"]').count();
    expect(visible).toBe(0);
    await shot('panel-closed');
});
