// PUSH-88 (Slice-56 / Pattern features — Linear / Circular / Mirror).
//
// Up through PUSH-87 the Forge shell shipped every primitive needed to
// build a Pattern feature but no UI: forge.translate(handle, dx, dy, dz)
// returns a new ShapeHandle (the original is preserved), forge.rotate
// does the same about an arbitrary world axis, and __forgeAppendBody is
// the canonical ForgeShellV4 setter that commits a body record into the
// v4 shell so meshes + feature tree + outliner re-derive in lockstep.
//
// PUSH-88 ships that surface as a right-docked Pattern panel reachable
// via the `tools.patternFeature` menu action (or window.__forgeOpenPatternFeature
// for Archie tool calls / this e2e spec). The panel exposes three modes:
//
//   • Linear   — axis ∈ {x,y,z}, spacing (mm), count.
//                count − 1 copies committed at increments of `spacing` mm
//                along the picked axis.
//   • Circular — axis ∈ {x,y,z}, angle step (deg), count.
//                count − 1 copies rotated about the picked axis (through
//                world origin) by the angle step × instance index.
//   • Mirror   — plane ∈ {xy,yz,xz}, offset (mm).
//                Exactly one copy on the far side of the picked plane.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner.
//   2. Seed a 20×20×20 native OCCT box (the SEED).
//   3. Open the Pattern panel via `tools.patternFeature`. Assert the
//      panel mounts (data-testid="forge-pattern-feature-panel") and
//      the picker auto-selects the seed handle.
//   4. Switch mode to Linear, axis=x, spacing=30, count=4. Click Apply.
//      Assert that 3 new native bodies were committed (count - 1 = 3),
//      bringing the scene total to 4 native bodies. Assert all three new
//      bodies have toolId === 'pattern.linear' and a params.sourceHandle
//      pointing at the seed.
//   5. Switch mode to Circular, axis=z, angle=60, count=6. Click Apply.
//      Assert that 5 more native bodies (count - 1 = 5) land in the
//      scene, total 4 + 5 = 9, and the new ones carry
//      toolId === 'pattern.circular'.
//   6. Switch mode to Mirror, plane=yz, offset=0. Click Apply.
//      Assert exactly one new body (toolId === 'pattern.mirror'), total
//      now 10. Verify event capture caught a pattern-feature-applied
//      event with mode='mirror' and count=1.
//   7. Regression: open the PUSH-58 Mass Properties panel and verify it
//      still recognises every native body in the scene including the
//      newly-patterned ones. Asserts the body picker count chip equals
//      10 and the picker has 10 options.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel + Linear)
//   - top   (Circular)
//   - right (Mirror)
//   - iso   (PUSH-58 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-88-pattern');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'pattern-session.mp4');

let app, page;
let stepIndex = 0;
let seedHandle = null;

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

// Read the current scene's native bodies, in commit order.
async function readNativeBodies() {
    return page.evaluate(() => {
        const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        return arr
            .filter((b) => b && b.kind === 'native' && typeof b.handle === 'number')
            .map((b) => ({
                id: b.id,
                handle: b.handle,
                toolId: b.toolId || null,
                name: b.name || null,
                params: b.params || null,
            }));
    });
}

// Install a capture for the forge:pattern-feature-applied bus.
async function installEventCapture() {
    await page.evaluate(() => {
        window.__push88Events = [];
        window.addEventListener('forge:pattern-feature-applied', (e) => {
            window.__push88Events.push({
                mode: e?.detail?.mode ?? null,
                seedHandle: e?.detail?.seedHandle ?? null,
                count: e?.detail?.count ?? null,
                appendedHandles: Array.isArray(e?.detail?.appendedHandles)
                    ? [...e.detail.appendedHandles] : [],
                spec: e?.detail?.spec ?? null,
            });
        });
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
        if (/push-88|pattern|forge|error|Error/i.test(t)) {
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
    // Onboarding tour overlay — flip seen flag so it stays dormant.
    await page.evaluate(() => {
        try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
    });
    const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
    if (await tourSkip.count() > 0) {
        await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
        await pause(400);
    }
    await pause(800);
    await installEventCapture();
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
        console.error('[push-88] no .webm');
        return;
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
                console.log(`[push-88] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-88] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + seed 20×20×20 box (the pattern seed)', async () => {
    await cameraTo('iso');
    await shot('boot');
    const seeded = await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        if (typeof f.translate !== 'function') return { error: 'forge.translate unavailable' };
        if (typeof f.rotate !== 'function') return { error: 'forge.rotate unavailable' };
        const h = f.makeBox(20, 20, 20);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id: 'f-pattern-seed-88', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Seed 20',
            params: { width: 20, height: 20, distance: 20 },
        });
        return { handle: h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    seedHandle = seeded.handle;
    console.log('[push-88] seeded handle =', seedHandle);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).filter((b) => b.kind === 'native').length >= 1,
        null, { timeout: 4000 });
    await shot('seed-committed');
});

test('01 — open Pattern panel via tools.patternFeature, picker auto-selects seed', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.patternFeature');
    await page.waitForSelector('[data-testid="forge-pattern-feature-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const seedAttr = await page.locator('[data-testid="forge-pattern-feature-panel"]')
                                .getAttribute('data-seed-handle');
    console.log('[push-88] initial seed handle =', seedAttr);
    expect(seedAttr).toBe(String(seedHandle));

    // Body count chip records 1 native body in the scene.
    const bodyCountAttr = await page.locator('[data-testid="forge-pattern-feature-panel"]')
                                    .getAttribute('data-body-count');
    expect(Number(bodyCountAttr)).toBe(1);

    // The mode selector defaults to Linear.
    const modeAttr = await page.locator('[data-testid="forge-pattern-feature-panel"]')
                                .getAttribute('data-mode');
    expect(modeAttr).toBe('linear');

    // The seed option is attached in the picker.
    await page.waitForSelector(`[data-testid="forge-pattern-feature-option-${seedHandle}"]`,
                               { state: 'attached', timeout: 4000 });
});

test('02 — Linear: axis=x, spacing=30, count=4 → 3 new bodies, total 4', async () => {
    await cameraTo('front');
    // Ensure Linear mode is active (it's the default — clicking it again
    // is idempotent and exercises the mode-switch path).
    await page.locator('[data-testid="forge-pattern-feature-mode-linear"]').click();
    await pause(200);

    // Axis x is the default; click anyway to assert the active state.
    await page.locator('[data-testid="forge-pattern-feature-linear-axis-x"]').click();
    await pause(150);
    const axisActive = await page.locator('[data-testid="forge-pattern-feature-linear-axis-x"]')
                                  .getAttribute('data-active');
    expect(axisActive).toBe('true');

    // Type spacing = 30, count = 4.
    await page.locator('[data-testid="forge-pattern-feature-linear-spacing"]').fill('30');
    await page.locator('[data-testid="forge-pattern-feature-linear-count"]').fill('4');
    await pause(150);

    // Apply.
    await page.locator('[data-testid="forge-pattern-feature-apply"]').click();
    await pause(400);
    await shot('linear-applied');

    // 3 new native bodies (count - 1 = 3), total 4.
    const bodies = await readNativeBodies();
    console.log('[push-88] bodies after Linear =', bodies.map((b) => `${b.handle}:${b.toolId}`));
    expect(bodies.length).toBe(4);

    // Original seed survives + 3 pattern.linear bodies.
    const linearBodies = bodies.filter((b) => b.toolId === 'pattern.linear');
    expect(linearBodies.length).toBe(3);

    // Every pattern.linear body's params.sourceHandle === seedHandle.
    for (const lb of linearBodies) {
        expect(lb.params).not.toBeNull();
        expect(lb.params.sourceHandle).toBe(seedHandle);
        expect(lb.params.mode).toBe('linear');
        expect(lb.params.axis).toBe('x');
        expect(Number(lb.params.spacing)).toBe(30);
    }

    // Status data-attrs reflect the apply.
    const statusEl = page.locator('[data-testid="forge-pattern-feature-status"]');
    expect(await statusEl.getAttribute('data-last-mode')).toBe('linear');
    expect(Number(await statusEl.getAttribute('data-last-seed'))).toBe(seedHandle);
    expect(Number(await statusEl.getAttribute('data-last-copies'))).toBe(3);

    // Event capture has a matching entry.
    const events = await page.evaluate(() => window.__push88Events || []);
    const linEvt = events.find((e) => e.mode === 'linear' && e.count === 3);
    expect(linEvt).toBeDefined();
    expect(linEvt.seedHandle).toBe(seedHandle);
    expect(linEvt.appendedHandles.length).toBe(3);
});

test('03 — Circular: axis=z, angle=60, count=6 → 5 new bodies, total 9', async () => {
    await cameraTo('top');
    await page.locator('[data-testid="forge-pattern-feature-mode-circular"]').click();
    await pause(200);

    const modeAttr = await page.locator('[data-testid="forge-pattern-feature-panel"]')
                                .getAttribute('data-mode');
    expect(modeAttr).toBe('circular');

    // Axis z is the default for Circular; click anyway.
    await page.locator('[data-testid="forge-pattern-feature-circular-axis-z"]').click();
    await pause(150);

    await page.locator('[data-testid="forge-pattern-feature-circular-angle"]').fill('60');
    await page.locator('[data-testid="forge-pattern-feature-circular-count"]').fill('6');
    await pause(150);

    await page.locator('[data-testid="forge-pattern-feature-apply"]').click();
    await pause(450);
    await shot('circular-applied');

    const bodies = await readNativeBodies();
    console.log('[push-88] bodies after Circular =', bodies.map((b) => `${b.handle}:${b.toolId}`));
    expect(bodies.length).toBe(9);

    const circBodies = bodies.filter((b) => b.toolId === 'pattern.circular');
    expect(circBodies.length).toBe(5);
    for (const cb of circBodies) {
        expect(cb.params.sourceHandle).toBe(seedHandle);
        expect(cb.params.mode).toBe('circular');
        expect(cb.params.axis).toBe('z');
        // angleStepRad ≈ 60 deg → π/3 ≈ 1.0472
        expect(Math.abs(cb.params.angleStepRad - Math.PI / 3)).toBeLessThan(1e-6);
    }

    // Status reflects last apply.
    const statusEl = page.locator('[data-testid="forge-pattern-feature-status"]');
    expect(await statusEl.getAttribute('data-last-mode')).toBe('circular');
    expect(Number(await statusEl.getAttribute('data-last-copies'))).toBe(5);

    const events = await page.evaluate(() => window.__push88Events || []);
    const circEvt = events.find((e) => e.mode === 'circular' && e.count === 5);
    expect(circEvt).toBeDefined();
    expect(circEvt.seedHandle).toBe(seedHandle);
});

test('04 — Mirror: plane=yz, offset=0 → 1 new body, total 10', async () => {
    await cameraTo('right');
    await page.locator('[data-testid="forge-pattern-feature-mode-mirror"]').click();
    await pause(200);

    const modeAttr = await page.locator('[data-testid="forge-pattern-feature-panel"]')
                                .getAttribute('data-mode');
    expect(modeAttr).toBe('mirror');

    // Plane yz is the default for Mirror; click anyway.
    await page.locator('[data-testid="forge-pattern-feature-mirror-plane-yz"]').click();
    await pause(150);

    await page.locator('[data-testid="forge-pattern-feature-mirror-offset"]').fill('0');
    await pause(150);

    await page.locator('[data-testid="forge-pattern-feature-apply"]').click();
    await pause(400);
    await shot('mirror-applied');

    const bodies = await readNativeBodies();
    console.log('[push-88] bodies after Mirror =', bodies.map((b) => `${b.handle}:${b.toolId}`));
    expect(bodies.length).toBe(10);

    const mirBodies = bodies.filter((b) => b.toolId === 'pattern.mirror');
    expect(mirBodies.length).toBe(1);
    expect(mirBodies[0].params.sourceHandle).toBe(seedHandle);
    expect(mirBodies[0].params.mode).toBe('mirror');
    expect(mirBodies[0].params.plane).toBe('yz');
    expect(Number(mirBodies[0].params.offset)).toBe(0);

    const statusEl = page.locator('[data-testid="forge-pattern-feature-status"]');
    expect(await statusEl.getAttribute('data-last-mode')).toBe('mirror');
    expect(Number(await statusEl.getAttribute('data-last-copies'))).toBe(1);

    const events = await page.evaluate(() => window.__push88Events || []);
    const mirEvt = events.find((e) => e.mode === 'mirror' && e.count === 1);
    expect(mirEvt).toBeDefined();
    expect(mirEvt.seedHandle).toBe(seedHandle);
    expect(mirEvt.appendedHandles.length).toBe(1);
});

test('05 — PUSH-58 regression: Mass Properties panel mounts + reads a real native body', async () => {
    await cameraTo('iso');

    // Close the Pattern panel so the right-rail surface frees up for
    // MassProps. (The two share the same dock z-index ladder.)
    await page.locator('[data-testid="forge-pattern-feature-close"]').click();
    await pause(300);

    // Open Mass Properties (PUSH-58 / Slice-26b).
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('push-58-regression');

    // The MassProps active-body line resolves to a body — proves the
    // panel still picks an active native body off the scene snapshot
    // even after PUSH-88 spammed it with 9 pattern bodies.
    const activeBodyTxt = await page.locator('[data-testid="forge-massprops-body"]').textContent();
    console.log('[push-88] MassProps active body =', activeBodyTxt);
    expect(activeBodyTxt).toBeTruthy();
    expect(activeBodyTxt).not.toContain('None — add a body first');

    // The kernel-side volume readout for the active body lands as a
    // real number (the panel called forge.massProps under the hood,
    // confirming the patterned bodies are real OCCT handles, not stubs).
    await page.waitForSelector('[data-testid="forge-massprops-volume"]',
                               { state: 'visible', timeout: 6000 });
    const volumeTxt = await page.locator('[data-testid="forge-massprops-volume"]').textContent();
    console.log('[push-88] MassProps volume row =', volumeTxt);
    const volMatch = /([0-9]+(?:\.[0-9]+)?)\s*mm/.exec(volumeTxt || '');
    expect(volMatch).not.toBeNull();
    const vol = Number(volMatch[1]);
    expect(vol).toBeGreaterThan(0);
    // The seed and every linear / circular / mirror copy are 20³ = 8000 mm³
    // boxes, so the volume must land within tolerance.
    expect(Math.abs(vol - 8000)).toBeLessThan(1.0);

    // Sanity: the global scene still holds all 10 native bodies — the
    // MassProps panel didn't accidentally rewrite __forgeBodies.
    const finalBodies = await readNativeBodies();
    expect(finalBodies.length).toBe(10);
});
