// PUSH-93 (Slice-61 / BOM Balloon Auto-Place).
//
// PUSH-60 turned the BOM panel into a row-per-body engineering view. A
// real mechanical drawing then needs *balloons* — numbered circles tied
// to a BOM row by a leader line, placed near each body's projected
// centroid on a drawing view. PUSH-93 ships that as a new BOM Balloons
// panel with:
//
//   * pure-math layer in `bomBalloonGenerator.js` (project → bbox →
//     ring layout → leader path → SVG snippet),
//   * React panel in `BomBalloonsPanel.jsx` (view picker, balloon
//     radius input, Generate button, balloons table, inline SVG
//     preview, Copy SVG button),
//   * tools.bomBalloons menu entry + window.__forgeOpenBomBalloonsPanel
//     imperative hook + window.__forgeBomBalloonsHelper headless API.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss any first-run banner; assert the headless
//      helper API (window.__forgeBomBalloonsHelper) is wired by the
//      Host's mount effect — that's the contract surface every plugin /
//      Archie call relies on.
//   2. Seed 3 native OCCT boxes translated to distinct world-space
//      positions so each body's centroid lands somewhere different on
//      the projected drawing view.
//   3. Open the BOM Balloons panel via tools.bomBalloons menu action.
//      Assert the panel mounts; data-body-count = 3.
//   4. Click Generate. Assert 3 balloons numbered 1, 2, 3 are emitted;
//      each balloon's leader path is a finite "M cx cy L tx ty" string;
//      every balloon has source="kernel" (proves forge.massProps was
//      actually called); the SVG preview rendered finite circles, text,
//      and leader paths.
//   5. Switch the view to 'top' and re-Generate. Assert the projected
//      target Y values changed (front-view used -Z; top-view uses Y).
//   6. Click Copy SVG. Assert window.__forgeLastBomBalloons mirrors the
//      same balloons; the panel reports a saved toast.
//   7. PUSH-60 regression: open the original BOM panel via tools.bom and
//      assert it still mounts alongside the new balloons panel without
//      collision.
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.
//   - iso   (boot + helper API + seed bodies)
//   - front (open panel + Generate front view)
//   - top   (switch to top view + re-Generate)
//   - right (Copy SVG)
//   - iso   (PUSH-60 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-93-bom-balloons');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'bom-balloons-session.mp4');

let app, page;
let stepIndex = 0;
let bodyId1 = null;
let bodyId2 = null;
let bodyId3 = null;

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

// Set an input/select's value through the native setter so React's
// onChange fires. Playwright's .fill() doesn't always dispatch the
// matching React synthetic event on controlled inputs.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = (el.tagName === 'SELECT')
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(el, args.value);
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

async function readBalloonRows() {
    return await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[data-testid="forge-bom-balloons-row"]'));
        return els.map((el) => ({
            n:        Number(el.getAttribute('data-balloon-n')),
            id:       el.getAttribute('data-balloon-id'),
            cx:       Number(el.getAttribute('data-balloon-cx')),
            cy:       Number(el.getAttribute('data-balloon-cy')),
            tx:       Number(el.getAttribute('data-balloon-target-x')),
            ty:       Number(el.getAttribute('data-balloon-target-y')),
            source:   el.getAttribute('data-balloon-source'),
            leader:   el.getAttribute('data-balloon-leader'),
        }));
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
        if (/push-93|bom-balloon|BomBalloon|forge:bom-balloons|error|Error/i.test(t)) {
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
    // Forge-189 onboarding tour mounts a full-screen overlay that
    // intercepts pointer events on every panel button. Flip the seen
    // flag so it stays dormant; skip if it raced in.
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
        console.error('[push-93] no .webm'); return;
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
                console.log(`[push-93] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-93] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed 3 translated boxes (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The host effect installs the headless helper API mirror at module
    // load. That's the proof the helper surface is hot even before the
    // panel mounts.
    await page.waitForFunction(
        () => !!window.__forgeBomBalloonsHelper
           && typeof window.__forgeOpenBomBalloonsPanel === 'function'
           && typeof window.__forgeBomBalloonsHelper.generateBalloons === 'function'
           && typeof window.__forgeBomBalloonsHelper.projectPoint === 'function'
           && typeof window.__forgeBomBalloonsHelper.svgSnippetFor === 'function',
        null, { timeout: 8000 });

    // Quick smoke of the projectPoint contract — without bodies yet —
    // so a regression in the math file fails this step (no React).
    const projOK = await page.evaluate(() => {
        const h = window.__forgeBomBalloonsHelper;
        const front = h.projectPoint(10, 20, 30, 'front');
        const top   = h.projectPoint(10, 20, 30, 'top');
        const right = h.projectPoint(10, 20, 30, 'right');
        return {
            front, top, right,
            views: h.SUPPORTED_VIEWS,
            defaultRadius: h.BALLOON_DEFAULT_RADIUS,
        };
    });
    expect(projOK.front).toEqual({ u: 10, v: -30 });
    expect(projOK.top  ).toEqual({ u: 10, v:  20 });
    expect(projOK.right).toEqual({ u: 20, v: -30 });
    expect(projOK.views).toContain('front');
    expect(projOK.views).toContain('top');
    expect(projOK.views).toContain('right');
    expect(projOK.defaultRadius).toBeGreaterThan(0);

    // Seed three native boxes translated to distinct world-space
    // positions. The translates put the centroids at:
    //   box 1 @ (5,  5, 5)         — origin
    //   box 2 @ (45, 5, 5)         = X translate 40
    //   box 3 @ (5,  45, 45)       = Y translate 40 + Z translate 40
    // so projection into the 'front' view (u=X, v=-Z) gives:
    //   box 1 → (5, -5)
    //   box 2 → (45, -5)
    //   box 3 → (5, -45)
    // and the 'top' view (u=X, v=Y) gives:
    //   box 1 → (5, 5)
    //   box 2 → (45, 5)
    //   box 3 → (5, 45)
    // — all three signatures distinct on BOTH views.
    bodyId1 = 'f-balloon-93-1';
    bodyId2 = 'f-balloon-93-2';
    bodyId3 = 'f-balloon-93-3';
    const seeded = await page.evaluate((ids) => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        const h1 = f.makeBox(10, 10, 10);                           // centroid at (5,5,5)
        const h2raw = f.makeBox(10, 10, 10);
        const h3raw = f.makeBox(10, 10, 10);
        const h2 = f.translate(h2raw, 40,  0,  0);                  // centroid at (45,5,5)
        const h3 = f.translate(h3raw,  0, 40, 40);                  // centroid at (5,45,45)
        if (typeof h1 !== 'number' || typeof h2 !== 'number' || typeof h3 !== 'number') {
            return { error: 'expected number handles' };
        }
        window.__forgeAppendBody({
            id: ids.id1, kind: 'native', handle: h1,
            toolId: 'solid.box', name: 'Bracket A',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: ids.id2, kind: 'native', handle: h2,
            toolId: 'solid.box', name: 'Bracket B',
            params: { width: 10, height: 10, distance: 10 },
        });
        window.__forgeAppendBody({
            id: ids.id3, kind: 'native', handle: h3,
            toolId: 'solid.box', name: 'Bracket C',
            params: { width: 10, height: 10, distance: 10 },
        });
        return { h1, h2, h3 };
    }, { id1: bodyId1, id2: bodyId2, id3: bodyId3 });
    expect(seeded.error).toBeUndefined();
    expect(seeded.h1).toBeGreaterThan(0);
    expect(seeded.h2).toBeGreaterThan(0);
    expect(seeded.h3).toBeGreaterThan(0);
    await page.waitForFunction(
        (n) => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= n,
        3, { timeout: 4000 });
    await shot('bodies-seeded');
});

test('01 — open BOM Balloons via tools.bomBalloons; data-body-count = 3 (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.bomBalloons');
    await page.waitForSelector('[data-testid="forge-bom-balloons-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel's data-body-count attribute should reflect every native
    // body the seed step pushed in.
    const panel = page.locator('[data-testid="forge-bom-balloons-panel"]');
    const bodyCount = await panel.getAttribute('data-body-count');
    expect(Number(bodyCount)).toBeGreaterThanOrEqual(3);

    // No balloons generated yet.
    const balloonCount = await panel.getAttribute('data-balloon-count');
    expect(balloonCount).toBe('0');

    // Default view is 'front'.
    expect(await panel.getAttribute('data-view')).toBe('front');

    // Generate is enabled (bodies exist).
    const genBtn = page.locator('[data-testid="forge-bom-balloons-generate"]');
    await expect(genBtn).toBeVisible();
    expect(await genBtn.getAttribute('disabled')).toBeNull();

    // Empty-state placeholder is shown until Generate is clicked.
    await expect(page.locator('[data-testid="forge-bom-balloons-empty"]')).toBeVisible();
});

test('02 — Generate → 3 numbered balloons w/ finite leaders + SVG preview (front)', async () => {
    // Subscribe to the bus event so we prove Generate publishes a CustomEvent.
    await page.evaluate(() => {
        window.__push93Events = [];
        window.addEventListener('forge:bom-balloons-generated', (e) => {
            try {
                window.__push93Events.push({
                    view:  e?.detail?.view,
                    radius:e?.detail?.radius,
                    count: e?.detail?.count,
                });
            } catch {}
        });
    });

    // Click Generate via the DOM so the VideoCaptureHUD doesn't race for
    // the pointer (same pattern as push-82).
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-bom-balloons-generate"]');
        if (!btn) throw new Error('Generate button not found');
        btn.click();
    });
    await pause(500);
    await shot('after-generate');

    // The panel's data-balloon-count now reads 3.
    const panel = page.locator('[data-testid="forge-bom-balloons-panel"]');
    expect(await panel.getAttribute('data-balloon-count')).toBe('3');

    // The count chip surfaces "3/3".
    const chipTxt = await page.locator('[data-testid="forge-bom-balloons-count"]').textContent();
    expect((chipTxt || '').trim().startsWith('3/3')).toBe(true);

    // Read the 3 balloon rows from the data attributes.
    const balloons = await readBalloonRows();
    expect(balloons).toHaveLength(3);

    // Balloons are numbered 1, 2, 3 in row order.
    expect(balloons.map((b) => b.n)).toEqual([1, 2, 3]);

    // Every balloon has source="kernel" — proves forge.massProps was
    // actually called for each native body.
    for (const b of balloons) {
        expect(b.source).toBe('kernel');
    }

    // Every leader is a finite "M cx cy L tx ty" path with finite numbers.
    const leaderRx = /^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+L\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/;
    for (const b of balloons) {
        expect(b.leader).toMatch(leaderRx);
        expect(Number.isFinite(b.cx)).toBe(true);
        expect(Number.isFinite(b.cy)).toBe(true);
        expect(Number.isFinite(b.tx)).toBe(true);
        expect(Number.isFinite(b.ty)).toBe(true);
        // Leader endpoints exactly match (cx,cy)→(tx,ty).
        const m = leaderRx.exec(b.leader);
        expect(Math.abs(Number(m[1]) - b.cx)).toBeLessThan(1e-6);
        expect(Math.abs(Number(m[2]) - b.cy)).toBeLessThan(1e-6);
        expect(Math.abs(Number(m[3]) - b.tx)).toBeLessThan(1e-6);
        expect(Math.abs(Number(m[4]) - b.ty)).toBeLessThan(1e-6);
    }

    // The 3 balloons project unique target points — the seed positions
    // are spread across world space so the front view (u=X, v=-Z) gives
    // distinct (tx, ty) per body.
    const sigSet = new Set(balloons.map((b) => `${b.tx.toFixed(3)}:${b.ty.toFixed(3)}`));
    expect(sigSet.size).toBe(3);

    // Front view projection: centroid at (5,5,5) projects to (5,-5).
    // Bracket B at (45,5,5) projects to (45,-5). Bracket C at (5,45,45)
    // projects to (5,-45). All three signatures are distinct on the
    // front view.
    expect(Math.abs(balloons[0].tx - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[1].tx - 45)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[2].tx - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[0].ty - -5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[1].ty - -5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[2].ty - -45)).toBeLessThan(1e-3);

    // The bus event fired with view='front', count=3.
    const events = await page.evaluate(() => window.__push93Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.view).toBe('front');
    expect(newest.count).toBe(3);

    // SVG preview rendered. The host wraps the snippet in
    // forge-bom-balloons-preview-host; assert it carries an <svg> root
    // and 3 balloon circles + 3 numbered text labels + 3 leader paths.
    const previewHTML = await page.locator(
        '[data-testid="forge-bom-balloons-preview-host"]').innerHTML();
    expect(previewHTML).toMatch(/<svg /);
    // Three balloon circles, three text labels, three leader paths.
    expect((previewHTML.match(/data-balloon-circle=/g) || []).length).toBe(3);
    expect((previewHTML.match(/data-balloon-label=/g) || []).length).toBe(3);
    expect((previewHTML.match(/data-balloon-leader=/g) || []).length).toBe(3);
    // The three text labels carry "1", "2", "3".
    expect(previewHTML).toMatch(/data-balloon-label="1">1<\/text>/);
    expect(previewHTML).toMatch(/data-balloon-label="2">2<\/text>/);
    expect(previewHTML).toMatch(/data-balloon-label="3">3<\/text>/);

    // SVG snippet length surfaced via data-svg-length.
    const svgLen = await page.locator('[data-testid="forge-bom-balloons-preview"]')
                             .getAttribute('data-svg-length');
    expect(Number(svgLen)).toBeGreaterThan(200);

    // window.__forgeLastBomBalloons mirrors the latest generation.
    const mirror = await page.evaluate(() => window.__forgeLastBomBalloons || null);
    expect(mirror).not.toBeNull();
    expect(mirror.count).toBe(3);
    expect(mirror.view).toBe('front');
    expect(Array.isArray(mirror.balloons)).toBe(true);
    expect(mirror.balloons).toHaveLength(3);
});

test('03 — switch to top view + re-Generate → targetY changes (top)', async () => {
    await cameraTo('top');

    // Switch the panel's view picker to 'top'.
    await setReactInput('forge-bom-balloons-view', 'top');
    await pause(200);
    await shot('view-switched-top');

    // data-view reflects the choice immediately.
    expect(await page.locator('[data-testid="forge-bom-balloons-panel"]')
                     .getAttribute('data-view')).toBe('top');

    // Re-Generate for the top view.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-bom-balloons-generate"]');
        if (!btn) throw new Error('Generate button not found');
        btn.click();
    });
    await pause(500);
    await shot('top-generated');

    const balloons = await readBalloonRows();
    expect(balloons).toHaveLength(3);
    // Top view projection: u=X, v=Y. Centroids:
    //   Bracket A (5,5,5)   → (5, 5)
    //   Bracket B (45,5,5)  → (45, 5)
    //   Bracket C (5,45,45) → (5, 45)
    expect(Math.abs(balloons[0].tx - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[0].ty - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[1].tx - 45)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[1].ty - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[2].tx - 5)).toBeLessThan(1e-3);
    expect(Math.abs(balloons[2].ty - 45)).toBeLessThan(1e-3);

    // The mirror updated to view='top'.
    const mirror = await page.evaluate(() => window.__forgeLastBomBalloons || null);
    expect(mirror.view).toBe('top');
    expect(mirror.count).toBe(3);

    // Top-view balloons distinguish Bracket C from the front view — the
    // targetY for Bracket C went from -45 (front, v=-Z) to 45 (top, v=Y).
    const cRow = balloons[2];
    expect(cRow.ty).not.toBe(-45);
    expect(Math.abs(cRow.ty - 45)).toBeLessThan(1e-3);
});

test('04 — Copy SVG mirrors the snippet for downstream consumers (right)', async () => {
    await cameraTo('right');

    // Click Copy SVG via the DOM. Electron's clipboard surface works in
    // tests but we *also* fall back to window.__forgeLastBomBalloonsSvg
    // when clipboard.writeText rejects under a sandboxed renderer — assert
    // either contract by reading the panel's toast.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-bom-balloons-copy"]');
        if (!btn) throw new Error('Copy SVG button not found');
        btn.click();
    });
    await pause(500);
    await shot('after-copy');

    // The toast surfaces success (whether via clipboard or mirror).
    const toast = await page.locator('[data-testid="forge-bom-balloons-toast"]').textContent();
    expect((toast || '').toLowerCase()).toMatch(/copied|mirrored/);

    // The mirror channel definitely carries the SVG when the clipboard
    // bridge fell through; if clipboard worked the mirror won't be set,
    // so we read the DOM preview as the canonical source of truth.
    const previewLen = Number(await page.locator(
        '[data-testid="forge-bom-balloons-preview"]').getAttribute('data-svg-length'));
    expect(previewLen).toBeGreaterThan(200);

    // Whichever channel served the copy, the SVG itself must be a
    // well-formed <svg> document with finite numbers — pull it directly
    // off the preview host so we exercise the same DOM the user sees.
    const previewHTML = await page.locator(
        '[data-testid="forge-bom-balloons-preview-host"]').innerHTML();
    expect(previewHTML).toMatch(/^<svg /);
    // No NaN / Infinity / undefined leaked into the snippet.
    expect(previewHTML).not.toMatch(/NaN/);
    expect(previewHTML).not.toMatch(/Infinity/);
    expect(previewHTML).not.toMatch(/undefined/);
});

test('05 — PUSH-60 regression: BOM panel still mounts alongside balloons (iso)', async () => {
    await cameraTo('iso');

    // Open the original BOM panel via its menu action. PUSH-60 mounts
    // this panel as a right-docked rail; the new Balloons panel is the
    // same shape, so both must coexist on document.body without
    // colliding portals.
    await platformMenuAction('tools.bom');
    await page.waitForSelector('[data-testid="forge-bom-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(400);
    await shot('bom-regression');

    // Both panels should be attached.
    await expect(page.locator('[data-testid="forge-bom-balloons-panel"]')).toBeAttached();
    await expect(page.locator('[data-testid="forge-bom-panel"]')).toBeAttached();

    // The BOM panel still surfaces all 3 bodies.
    const rows = page.locator('[data-testid="forge-bom-row"]');
    await expect(rows).toHaveCount(3);
});
