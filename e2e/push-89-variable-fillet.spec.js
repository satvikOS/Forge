// PUSH-89 (Slice-57 / Variable-radius fillet panel).
//
// The OCCT C++ binding `forge.part.variableFilletEdge` is already wired,
// but per the PUSH-89 brief this slice ships the *UI surface* with no
// kernel changes — Apply averages the (t, r) profile into a single
// radius and calls the existing `forge.part.filletEdges(handle, [edge], r̄)`
// constant-radius op. The full profile is published on
// `window.__forgeVariableFilletProfile` so a future kernel-binding
// slice can replay the intent through OCCT's true Law_Function path.
//
// Proof end-to-end:
//   1. Boot Electron; dismiss the first-run banner + onboarding tour.
//      Assert the headless helper API (window.__forgeVariableFilletHelper)
//      and the imperative open hook are wired by the host's mount effect.
//   2. Seed a 60×40×30 native OCCT box. The box is the canonical test
//      geometry — its 12 unique edges (TopExp_Explorer enumerates 24
//      shared faces) line up with part.filletEdges' edgeById convention.
//      Capture the pre-fillet body count.
//   3. Open the panel via the `tools.variableFillet` menu action. Assert
//      the panel mounts, the table renders the default 3-row profile
//      (t=0/r=1, t=0.5/r=3, t=1/r=1), and the body picker auto-selects
//      the seeded box.
//   4. Drive the profile to (t=0/r=1, t=0.5/r=5, t=1/r=1) — the brief's
//      worked example. Type into the t/r number inputs through the
//      native React setter (Playwright's .fill() doesn't always dispatch
//      the matching React synthetic event for controlled inputs).
//      Assert the data-avg-radius attribute updates live.
//   5. Set the edge id to 0 (the box's bottom front-left horizontal edge
//      under the OCCT enumeration). Click Apply. Assert:
//        a. The bus event fires with payload containing the (t, r) array
//           and the averaged radius.
//        b. window.__forgeVariableFilletProfile is set with the full
//           profile + edgeId + applied radius.
//        c. The seeded body's handle in window.__forgeBodies has changed
//           (filletEdges returned a new OCCT shape), and its toolId
//           flipped to 'solid.variableFillet' so the feature tree /
//           Archie can call out the variable intent.
//   6. PUSH-58 regression: open Mass Properties via tools.massprops and
//      assert the panel still mounts AND the volume readout reflects the
//      new filleted handle (the kernel has actually replaced the body).
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.
//   - iso   (boot + seed)
//   - front (open panel + assert defaults)
//   - top   (edit profile + assert r_avg)
//   - right (Apply + assert kernel replacement + bus event)
//   - iso-after (PUSH-58 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-89-variable-fillet');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'variable-fillet-session.mp4');

let app, page;
let stepIndex = 0;
let seededBoxId = null;
let seededBoxHandle = null;

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

// Set a controlled React input's value through the native setter so the
// onChange handler fires reliably. Playwright's .fill() does not always
// dispatch the matching React synthetic event for number inputs.
async function setReactInput(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`input not found: ${args.testid}`);
        const proto = (el.tagName === 'TEXTAREA')
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        nativeSetter.call(el, String(args.value));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

async function readNativeBodyMap() {
    return await page.evaluate(() => {
        const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const out = {};
        for (const b of arr) {
            if (b && typeof b.id === 'string' && b.kind === 'native') {
                out[b.id] = {
                    handle: b.handle,
                    toolId: b.toolId,
                    name: b.name,
                    paramsKeys: Object.keys(b.params || {}),
                };
            }
        }
        return out;
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
        if (/push-89|varfillet|variable-fillet|forge:variable-fillet|error|Error/i.test(t)) {
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
        console.error('[push-89] no .webm'); return;
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
                console.log(`[push-89] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-89] ffmpeg failed:', code,
                    err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed a 60×40×30 native box (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Confirm the host effect installs the headless helper API and the
    // imperative open hook before the panel is even shown. That's the
    // contract every plugin / Archie tool call relies on.
    await page.waitForFunction(
        () => !!window.__forgeVariableFilletHelper
           && typeof window.__forgeOpenVariableFilletPanel === 'function'
           && typeof window.__forgeVariableFilletHelper.applyVariableFillet === 'function',
        null, { timeout: 8000 });

    seededBoxId = 'f-box-89';
    const seeded = await page.evaluate((id) => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return { error: 'forge.makeBox unavailable' };
        const h = f.makeBox(60, 40, 30);
        if (typeof h !== 'number') return { error: 'expected number handle' };
        window.__forgeAppendBody({
            id, kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 60x40x30',
            params: { width: 60, height: 40, distance: 30 },
        });
        return { handle: h };
    }, seededBoxId);
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    seededBoxHandle = seeded.handle;
    await page.waitForFunction(
        (id) => (window.__forgeBodies || []).some((b) => b && b.id === id),
        seededBoxId, { timeout: 4000 });
    await shot('box-seeded');
});

test('01 — open panel via tools.variableFillet, defaults populated (front)', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.variableFillet');
    await page.waitForSelector('[data-testid="forge-varfillet-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel auto-picks the seeded box (the only native body in the
    // scene) and starts with the default 3-row profile.
    const pickedBodyId = await page.locator('[data-testid="forge-varfillet-panel"]')
                                   .getAttribute('data-body-id');
    expect(pickedBodyId).toBe(seededBoxId);

    const rowCount = await page.locator('[data-testid="forge-varfillet-panel"]')
                                .getAttribute('data-row-count');
    expect(Number(rowCount)).toBe(3);

    // Default radius mean = (1 + 3 + 1) / 3 ≈ 1.667 mm.
    const avgAttr = await page.locator('[data-testid="forge-varfillet-panel"]')
                              .getAttribute('data-avg-radius');
    expect(Math.abs(Number(avgAttr) - 5 / 3)).toBeLessThan(0.005);

    // The radius-curve preview SVG is rendered.
    await expect(page.locator('[data-testid="forge-varfillet-curve"]')).toBeVisible();

    // Three rows, three control-point dots.
    const rows = await page.locator('[data-testid="forge-varfillet-row"]').count();
    expect(rows).toBe(3);
    const controls = await page.locator('[data-testid^="forge-varfillet-control-"]').count();
    expect(controls).toBe(3);

    // The default t/r inputs reflect the DEFAULT_PROFILE.
    const t0 = await page.locator('[data-testid="forge-varfillet-t-0"]').inputValue();
    const t1 = await page.locator('[data-testid="forge-varfillet-t-1"]').inputValue();
    const t2 = await page.locator('[data-testid="forge-varfillet-t-2"]').inputValue();
    const r0 = await page.locator('[data-testid="forge-varfillet-r-0"]').inputValue();
    const r1 = await page.locator('[data-testid="forge-varfillet-r-1"]').inputValue();
    const r2 = await page.locator('[data-testid="forge-varfillet-r-2"]').inputValue();
    expect(Number(t0)).toBe(0);
    expect(Number(t1)).toBe(0.5);
    expect(Number(t2)).toBe(1);
    expect(Number(r0)).toBe(1);
    expect(Number(r1)).toBe(3);
    expect(Number(r2)).toBe(1);
});

test('02 — drive the (t, r) profile to (0/1, 0.5/5, 1/1); r̄ = 7/3 (top)', async () => {
    await cameraTo('top');

    // Bump the middle radius from 3 → 5 — the brief's worked example.
    await setReactInput('forge-varfillet-r-1', '5');
    await pause(250);
    await shot('profile-edited');

    // r̄ = (1 + 5 + 1) / 3 = 7/3 ≈ 2.333.
    const avgAttr = await page.locator('[data-testid="forge-varfillet-panel"]')
                              .getAttribute('data-avg-radius');
    expect(Math.abs(Number(avgAttr) - 7 / 3)).toBeLessThan(0.005);

    // The radius chip in the header reads "r̄ = 2.33 mm".
    const chipTxt = await page.locator('[data-testid="forge-varfillet-radius-chip"]').textContent();
    expect((chipTxt || '').includes('2.33')).toBe(true);

    // Add a fourth row to prove the "Add row" button works.
    await page.locator('[data-testid="forge-varfillet-add-row"]').click();
    await pause(200);
    const rowsAfterAdd = await page.locator('[data-testid="forge-varfillet-panel"]')
                                    .getAttribute('data-row-count');
    expect(Number(rowsAfterAdd)).toBe(4);

    // Remove the new row to prove "Remove" works and the apply path
    // still lands on the 3-row profile (matches the brief's example).
    await page.locator('[data-testid="forge-varfillet-remove-3"]').click();
    await pause(200);
    const rowsAfterRemove = await page.locator('[data-testid="forge-varfillet-panel"]')
                                       .getAttribute('data-row-count');
    expect(Number(rowsAfterRemove)).toBe(3);
    await shot('row-add-remove');
});

test('03 — Apply edge 0 with r̄ ≈ 2.33; bus event + global channel + body swap (right)', async () => {
    await cameraTo('right');

    // Capture both the bus event AND the global channel atomically.
    await page.evaluate(() => {
        window.__push89Events = [];
        window.addEventListener('forge:variable-fillet-applied', (e) => {
            try {
                window.__push89Events.push({
                    bodyId:        e?.detail?.bodyId,
                    handle:        e?.detail?.handle,
                    edgeId:        e?.detail?.edgeId,
                    appliedRadius: e?.detail?.appliedRadius,
                    profileLen:    (e?.detail?.profile || []).length,
                });
            } catch {}
        });
    });

    // Set the edge id to 0 (the box's edge id 0 — first one TopExp_Explorer
    // enumerates; matches part.filletEdges' edgeById convention).
    await setReactInput('forge-varfillet-edge-input', '0');
    await pause(200);
    const edgeAttr = await page.locator('[data-testid="forge-varfillet-panel"]')
                                .getAttribute('data-edge-id');
    expect(edgeAttr).toBe('0');

    // Snapshot the body map BEFORE Apply so we can prove the handle swaps.
    const before = await readNativeBodyMap();
    expect(before[seededBoxId]).toBeDefined();
    expect(before[seededBoxId].handle).toBe(seededBoxHandle);
    expect(before[seededBoxId].toolId).toBe('solid.box');

    // Apply through the panel button. Drive the DOM click so the
    // VideoCaptureHUD bottom-right doesn't race for the same pixel.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-varfillet-apply"]');
        if (!btn) throw new Error('apply button not found');
        btn.click();
    });
    await pause(500);
    await shot('apply-clicked');

    // The toast reads the new handle + r̄ + 3 profile points.
    const toast = page.locator('[data-testid="forge-varfillet-toast"]');
    await expect(toast).toBeVisible();
    const toastTxt = (await toast.textContent()) || '';
    expect(toastTxt.toLowerCase().includes('applied')).toBe(true);
    expect(toastTxt.includes('2.33')).toBe(true);
    expect(toastTxt.includes('3 pts')).toBe(true);

    // The seeded body's handle in the live scene has changed AND its
    // toolId flipped to 'solid.variableFillet'. The kernel actually
    // built a new shape; we didn't just record intent.
    const after = await readNativeBodyMap();
    expect(after[seededBoxId]).toBeDefined();
    expect(after[seededBoxId].handle).not.toBe(seededBoxHandle);
    expect(after[seededBoxId].handle).toBeGreaterThan(0);
    expect(after[seededBoxId].toolId).toBe('solid.variableFillet');

    // The profile + edge + radius were stamped into the body's params.
    expect(after[seededBoxId].paramsKeys).toContain('profile');
    expect(after[seededBoxId].paramsKeys).toContain('edgeId');
    expect(after[seededBoxId].paramsKeys).toContain('appliedRadius');
    expect(after[seededBoxId].paramsKeys).toContain('intent');

    // window.__forgeVariableFilletProfile is the canonical intent channel.
    const profile = await page.evaluate(() => window.__forgeVariableFilletProfile || null);
    expect(profile).not.toBeNull();
    expect(profile.bodyId).toBe(seededBoxId);
    expect(profile.edgeId).toBe(0);
    expect(profile.handle).toBe(after[seededBoxId].handle);
    expect(Math.abs(profile.appliedRadius - 7 / 3)).toBeLessThan(0.005);
    expect(Array.isArray(profile.profile)).toBe(true);
    expect(profile.profile.length).toBe(3);
    // Sorted by t ascending.
    expect(profile.profile[0].t).toBe(0);
    expect(profile.profile[0].r).toBe(1);
    expect(profile.profile[1].t).toBe(0.5);
    expect(profile.profile[1].r).toBe(5);
    expect(profile.profile[2].t).toBe(1);
    expect(profile.profile[2].r).toBe(1);

    // The bus event fired with the matching payload.
    const events = await page.evaluate(() => window.__push89Events || []);
    expect(events.length).toBeGreaterThan(0);
    const newest = events[events.length - 1];
    expect(newest.bodyId).toBe(seededBoxId);
    expect(newest.edgeId).toBe(0);
    expect(newest.profileLen).toBe(3);
    expect(Math.abs(newest.appliedRadius - 7 / 3)).toBeLessThan(0.005);

    // Cache the new handle for the regression step.
    seededBoxHandle = after[seededBoxId].handle;
});

test('04 — PUSH-58 regression: Mass Properties still mounts on the filleted body (iso-after)', async () => {
    await cameraTo('iso');

    // Open Mass Properties via its menu action. PUSH-58 auto-reads the
    // active native body — which is now our filleted variant. The volume
    // of a 60×40×30 box minus a single-edge variable fillet is < 72 000
    // mm³ (the original) but > 71 000 mm³ for any reasonable r̄.
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(500);
    await shot('massprops-after-varfillet');

    const volTxt = await page.locator('[data-testid="forge-massprops-volume"]').textContent();
    const vol = Number(/(-?[0-9]+\.[0-9]+)/.exec(volTxt || '')?.[1]);
    console.log('[push-89] post-fillet volume =', volTxt, '→', vol);
    // Box volume is 60*40*30 = 72 000 mm³. A single-edge fillet at
    // r̄ ≈ 2.33 mm removes a thin sliver; the result should be close to
    // (but strictly less than) 72 000.
    expect(vol).toBeLessThan(72000);
    expect(vol).toBeGreaterThan(70000);

    // The variable-fillet panel must still be attached — both panels
    // coexist on the right-docked shelf.
    await expect(page.locator('[data-testid="forge-varfillet-panel"]'))
        .toBeAttached();

    // The feature-tree mirror (window.__forgeBodies) still carries the
    // variable-fillet toolId on the active body.
    const finalToolId = await page.evaluate((id) => {
        const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const b = arr.find((x) => x && x.id === id);
        return b ? b.toolId : null;
    }, seededBoxId);
    expect(finalToolId).toBe('solid.variableFillet');
});
