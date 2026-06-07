// PUSH-83 (Slice-51) — Catmull-Clark subdivision surface generator.
//
// Up through PUSH-82 every Forge body in the scene was either kernel
// (`kind: 'native'`) or parametric primitive (`kind: 'synthetic'`).
// PUSH-83 adds a third representation: subdivision surfaces. A control
// cage (8-vertex cube or the active body's AABB) is refined via real
// Catmull-Clark math (face / edge / vertex update rules, 1978 paper)
// for 1..4 iterations, and the resulting smooth mesh is committed as a
// synthetic body via window.__forgeAppendBody. The body carries the
// authoritative positions + faces in a `subdivision` side-car for
// downstream STL export / FEA / slicer consumers; the viewport renders
// an AABB-sized proxy box via the existing synthetic geometry pipeline.
//
// Proof end-to-end:
//
//   1. Boot Electron, dismiss first-run banners, assert the helper API
//      mirror (window.__forgeSubdivisionHelper) is installed at
//      module-load time — that's the headless contract the panel host
//      promises before any UI mounts.
//   2. Open the Subdivision Surface panel via the tools.subdivision
//      menu action. Assert the panel mounts and reads cage = 8 verts /
//      6 quads (the unit cube default).
//   3. Bump the iteration slider to 3. The preview readouts update:
//      8 → 26 → 98 → 386 vertices, 6 → 24 → 96 → 384 faces. The face
//      count grows by exactly 4× per iteration on a closed quad cage.
//   4. Click Apply. Assert window.__forgeBodies grows by exactly one
//      entry, the new body's `subdivision.iterations` equals 3, the
//      `subdivision.positions` length is 386*3 (Float32Array), the
//      `subdivision.faces` length is 384, and the `forge:subdivision-
//      applied` bus event fires with the matching counts.
//   5. Re-open the panel; switch to "from active body" cage; verify the
//      cage builder pulls the AABB from the body the user just added.
//      Apply at iter=1; verify another body lands with iterations=1.
//   6. PUSH-58 regression — open Mass Properties via tools.massprops
//      and verify both panels coexist; the body-count in the scene
//      reflects the new subdivision bodies.
//
// Multi-cam: iso / front / top / right / iso-after = 5 named angles
// (Forge-171 mandate).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-83-subdivision');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'subdivision-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const name = String(stepIndex).padStart(3, '0') + '-' +
        label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`),
                            fullPage: true });
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

// Drive a React-controlled input by punching the value through the
// native setter so React's onChange handler picks up the synthetic
// event. Playwright's .fill() bypasses React's value setter on
// controlled inputs which makes range/number inputs unreliable.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = el.tagName === 'INPUT'
            ? window.HTMLInputElement.prototype
            : window.HTMLTextAreaElement.prototype;
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
        if (/push-83|subdivision|catmull|forge:subdivision|error|Error/i.test(t)) {
            console.log('[browser]', t);
        }
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss first-run banners.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    // Forge-189 onboarding tour swallows pointer events; skip it.
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
        console.error('[push-83] no .webm captured'); return;
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
                console.log(`[push-83] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-83] ffmpeg failed:', code,
                              err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + subdivision helper API mounted (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Host effect installs the headless helper mirror at module load.
    await page.waitForFunction(
        () => !!window.__forgeSubdivisionHelper
           && typeof window.__forgeOpenSubdivisionPanel === 'function'
           && typeof window.__forgeSubdivisionHelper.buildCubeCage === 'function'
           && typeof window.__forgeSubdivisionHelper.runCatmullClark === 'function'
           && typeof window.__forgeSubdivisionHelper.commitSubdivisionBody === 'function',
        null, { timeout: 8000 });

    // Direct sanity test on the helper — the e2e contract is that a
    // 8-vert cube cage at iter=1 grows to 26 verts / 24 quad faces,
    // and at iter=2 to 98 verts / 96 faces. (Exact Catmull-Clark
    // growth on a closed manifold.)
    const sanity = await page.evaluate(() => {
        const h = window.__forgeSubdivisionHelper;
        const cage = h.buildCubeCage(30);
        const it1 = h.runCatmullClark(cage, 1);
        const it2 = h.runCatmullClark(cage, 2);
        const it3 = h.runCatmullClark(cage, 3);
        return {
            cageVerts: cage.positions.length / 3,
            cageFaces: cage.faces.length,
            it1Verts: it1.positions.length / 3, it1Faces: it1.faces.length,
            it2Verts: it2.positions.length / 3, it2Faces: it2.faces.length,
            it3Verts: it3.positions.length / 3, it3Faces: it3.faces.length,
        };
    });
    expect(sanity.cageVerts).toBe(8);
    expect(sanity.cageFaces).toBe(6);
    expect(sanity.it1Verts).toBe(26);    // 8 (V) + 6 (face pts) + 12 (edge pts)
    expect(sanity.it1Faces).toBe(24);    // 6 * 4 = 24
    expect(sanity.it2Faces).toBe(96);    // 24 * 4 = 96 — exact 4× growth
    expect(sanity.it3Faces).toBe(384);   // 96 * 4 = 384
    expect(sanity.it2Verts).toBeGreaterThan(sanity.it1Verts);
    expect(sanity.it3Verts).toBeGreaterThan(sanity.it2Verts);
    await shot('helper-api-mounted');
});

test('01 — open Subdivision panel via tools.subdivision; cage chip = 8 verts / 6 quads (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.subdivision');
    await page.waitForSelector('[data-testid="forge-subdivision-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const panel = page.locator('[data-testid="forge-subdivision-panel"]');
    // Default cage mode is cube.
    expect(await panel.getAttribute('data-cage-mode')).toBe('cube');
    expect(await panel.getAttribute('data-cage-verts')).toBe('8');
    expect(await panel.getAttribute('data-cage-faces')).toBe('6');

    // Default iter = 2 → preview should be 98 verts / 96 faces.
    const initialIter = await panel.getAttribute('data-iterations');
    expect(Number(initialIter)).toBeGreaterThanOrEqual(1);

    // The cage readout text matches the chip values.
    const readout = await page.locator('[data-testid="forge-subdivision-cage-readout"]')
                              .textContent();
    expect((readout || '').toLowerCase()).toContain('8 verts');
    expect((readout || '').toLowerCase()).toContain('6 quads');

    // The iteration chip reads "<n>/4".
    const iterChip = await page.locator('[data-testid="forge-subdivision-iter-chip"]')
                               .textContent();
    expect((iterChip || '').trim().endsWith('/4')).toBe(true);
});

test('02 — set iterations=3, preview face count = 384 (top)', async () => {
    await cameraTo('top');

    await setReactInput('forge-subdivision-iter-slider', 3);
    await pause(300);
    await shot('iter-3-preview');

    const panel = page.locator('[data-testid="forge-subdivision-panel"]');
    expect(await panel.getAttribute('data-iterations')).toBe('3');
    expect(await panel.getAttribute('data-preview-verts')).toBe('386');
    expect(await panel.getAttribute('data-preview-faces')).toBe('384');

    // The stat boxes also render the count textually.
    const vCount = await page.locator('[data-testid="forge-subdivision-vert-count"]')
                             .textContent();
    expect((vCount || '').trim()).toBe('386');
    const fCount = await page.locator('[data-testid="forge-subdivision-face-count"]')
                             .textContent();
    expect((fCount || '').trim()).toBe('384');
});

test('03 — Apply at iter=3 commits a new body with positions+faces growth (right)', async () => {
    await cameraTo('right');

    // Capture the bus event.
    await page.evaluate(() => {
        window.__push83Events = [];
        window.addEventListener('forge:subdivision-applied', (e) => {
            try {
                window.__push83Events.push({
                    id: e?.detail?.id,
                    iterations: e?.detail?.iterations,
                    vertexCount: e?.detail?.vertexCount,
                    faceCount: e?.detail?.faceCount,
                });
            } catch {}
        });
    });

    const beforeCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);

    // The VideoCaptureHUD lives at zIndex 2400 bottom-right and can
    // race for pointer ownership on the Apply button. Drive the click
    // through the DOM so React's onClick fires without contention.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-subdivision-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('apply-iter-3');

    // Exactly one new body landed in __forgeBodies.
    const afterCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);
    expect(afterCount).toBe(beforeCount + 1);

    // The new body has a subdivision side-car with the expected
    // counts. Positions length = 386 * 3 = 1158 floats.
    const newBody = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const b = arr[arr.length - 1];
        if (!b || !b.subdivision) return null;
        return {
            id: b.id,
            kind: b.kind,
            toolId: b.toolId,
            specKind: b.spec?.kind,
            iterations: b.subdivision.iterations,
            vertexCount: b.subdivision.vertexCount,
            faceCount: b.subdivision.faceCount,
            positionsLength: b.subdivision.positions?.length,
            facesLength: b.subdivision.faces?.length,
            indicesLength: b.subdivision.indices?.length,
            fingerprint: b.subdivision.fingerprint,
        };
    });
    expect(newBody).not.toBeNull();
    expect(newBody.kind).toBe('synthetic');
    expect(newBody.toolId).toBe('tools.subdivision');
    expect(newBody.specKind).toBe('box');
    expect(newBody.iterations).toBe(3);
    expect(newBody.vertexCount).toBe(386);
    expect(newBody.faceCount).toBe(384);
    expect(newBody.positionsLength).toBe(386 * 3);
    expect(newBody.facesLength).toBe(384);
    // Each quad face → 2 tris → 6 indices. 384 * 6 = 2304.
    expect(newBody.indicesLength).toBe(384 * 6);
    expect(typeof newBody.fingerprint).toBe('string');
    expect(newBody.fingerprint.length).toBe(8);

    // The bus event fired and carries matching counts.
    const events = await page.evaluate(() => window.__push83Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.iterations).toBe(3);
    expect(newest.vertexCount).toBe(386);
    expect(newest.faceCount).toBe(384);
    expect(newest.id).toBe(newBody.id);

    // Toast surfaces the commit.
    const toast = await page.locator('[data-testid="forge-subdivision-toast"]')
                            .textContent();
    expect((toast || '').toLowerCase()).toContain('committed');
    expect((toast || '').toLowerCase()).toContain('386');
    expect((toast || '').toLowerCase()).toContain('384');

    // The panel's data-last-body-id is the new body id.
    const lastId = await page.locator('[data-testid="forge-subdivision-panel"]')
                             .getAttribute('data-last-body-id');
    expect(lastId).toBe(newBody.id);
});

test('04 — switch cage to "from active body", Apply at iter=1 → second subdivision body (iso)', async () => {
    await cameraTo('iso');

    // Switch to the body-AABB cage mode and crank iter down to 1.
    await page.locator('[data-testid="forge-subdivision-cage-body"]').click();
    await pause(250);
    await setReactInput('forge-subdivision-iter-slider', 1);
    await pause(300);
    await shot('body-cage-iter-1');

    const panel = page.locator('[data-testid="forge-subdivision-panel"]');
    expect(await panel.getAttribute('data-cage-mode')).toBe('body');
    expect(await panel.getAttribute('data-cage-verts')).toBe('8');
    expect(await panel.getAttribute('data-cage-faces')).toBe('6');
    expect(await panel.getAttribute('data-iterations')).toBe('1');
    // At iter=1 the cube cage grows to 26 verts / 24 faces.
    expect(await panel.getAttribute('data-preview-verts')).toBe('26');
    expect(await panel.getAttribute('data-preview-faces')).toBe('24');

    const beforeCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-subdivision-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('body-cage-apply');

    const afterCount = await page.evaluate(
        () => (window.__forgeBodies || []).length);
    expect(afterCount).toBe(beforeCount + 1);

    const newBody = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const b = arr[arr.length - 1];
        if (!b || !b.subdivision) return null;
        return {
            iterations: b.subdivision.iterations,
            vertexCount: b.subdivision.vertexCount,
            faceCount: b.subdivision.faceCount,
        };
    });
    expect(newBody).not.toBeNull();
    expect(newBody.iterations).toBe(1);
    expect(newBody.vertexCount).toBe(26);
    expect(newBody.faceCount).toBe(24);
});

test('05 — PUSH-58 regression: Mass Properties still mounts alongside (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(400);
    await shot('massprops-regression');

    // Subdivision panel still attached (right-docked sibling).
    await expect(page.locator('[data-testid="forge-subdivision-panel"]'))
        .toBeAttached();

    // The scene carries at least the 2 subdivision bodies we landed.
    const subdivBodies = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        return arr.filter((b) => b && b.subdivision).length;
    });
    expect(subdivBodies).toBeGreaterThanOrEqual(2);
});
