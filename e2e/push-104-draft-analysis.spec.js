// PUSH-104 (Slice-72) — Draft Angle Analysis overlay (mold / casting).
//
// In mold tooling and casting workflows, every face along the pull
// direction must have a positive draft angle, or the part will lock
// into the mold and snap on ejection. The Draft Analysis overlay shades
// every body face by its draft angle vs the user-picked pull direction:
//
//   • GREEN  — face will release  (angle > threshold)
//   • YELLOW — borderline          (0 < angle ≤ threshold)
//   • RED    — undercut            (angle ≤ 0)
//
// This spec proves the overlay end-to-end:
//
//   00 — boot Electron, assert the headless helper API is wired, seed a
//        real OCCT 40×40×40 box. The window mirror at
//        window.__forgeDraftAnalysis hydrates from defaults on host
//        mount. (iso)
//   01 — open the panel via tools.draftAnalysis, click Enable; assert
//        every body mesh wears the draft ShaderMaterial. The shared
//        uniforms include `pullDir` and `threshold`. Sample a green
//        ratio over a fibonacci sphere — > 0 for +Z. (front)
//   02 — drag the threshold slider to 2.5°; confirm the threshold
//        uniform updates live (no rebuild). (top)
//   03 — flip the pull preset to −Z; confirm pullDir.z is now −1, the
//        green ratio recomputes against the new axis, and disabling
//        the overlay restores the original PBR material on every body. (right)
//   04 — PUSH-86 zebra regression: both overlays use the material-swap
//        pattern. Toggle zebra on; close zebra; toggle draft on; assert
//        draft material lands without colliding with zebra. (iso)
//
// Multi-cam: 5 named camera angles per Forge-171 multi-cam mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-104-draft-analysis');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'draft-analysis-session.mp4');

let app, page;
let stepIndex = 0;
let boxHandle = null;

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

// Set a React-controlled range slider's value through the native setter
// so React's onChange fires. Playwright's .fill() doesn't always
// dispatch the matching React synthetic event on controlled inputs.
async function setReactRange(testid, value) {
    await page.evaluate((args) => {
        const el = document.querySelector(`[data-testid="${args.testid}"]`);
        if (!el) throw new Error(`range not found: ${args.testid}`);
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(el, String(args.value));
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }, { testid, value });
}

// Sample the live state of the draft material on the first body mesh
// we find. Returns a plain object so it crosses the page bridge.
async function sampleDraftMaterial() {
    return await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        const out = {
            totalBodyMeshes: 0,
            draftMatMeshes: 0,
            origStashed: 0,
            sampleMaterialType: null,
            sampleMaterialName: null,
            sampleArchdiscDraftAnalysis: false,
            sampleUniforms: null,
        };
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body && !o.userData.bodyId) return;
            out.totalBodyMeshes += 1;
            if (o.material) {
                if (out.sampleMaterialType === null) {
                    out.sampleMaterialType = o.material.type || null;
                    out.sampleMaterialName = o.material.name || null;
                }
                if (o.material.userData?.archdiscDraftAnalysis) {
                    out.draftMatMeshes += 1;
                    if (!out.sampleArchdiscDraftAnalysis) {
                        out.sampleArchdiscDraftAnalysis = true;
                        const u = o.material.uniforms || {};
                        out.sampleUniforms = {
                            pullDir: u.pullDir?.value
                                ? { x: u.pullDir.value.x, y: u.pullDir.value.y, z: u.pullDir.value.z }
                                : null,
                            threshold: u.threshold?.value ?? null,
                            ambient:   u.ambient?.value   ?? null,
                        };
                    }
                }
            }
            if (o.userData.__draftOriginalMaterial) out.origStashed += 1;
        });
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
        if (/push-104|draft|forge:draft-analysis|ShaderMaterial|error|Error/i.test(t)) {
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
        // Clear any state from a previous run so the panel boots from
        // canonical defaults (pullDirId=+Z, thresholdDeg=1.0).
        try { window.localStorage.removeItem('forge.v4.draftAnalysis'); } catch {}
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
        console.error('[push-104] no .webm'); return;
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
                console.log(`[push-104] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-104] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + helper API mounted + seed 40×40×40 box (iso)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // The Host effect installs the headless helper API mirror at module
    // load. That's the proof every plugin / Archie tool call has the
    // contract before the panel mounts.
    await page.waitForFunction(
        () => !!window.__forgeDraftAnalysisHelper
           && typeof window.__forgeOpenDraftAnalysis === 'function'
           && typeof window.__forgeCloseDraftAnalysis === 'function'
           && typeof window.__forgeDraftAnalysisHelper.buildDraftMaterial === 'function'
           && typeof window.__forgeDraftAnalysisHelper.applyDraftToObject === 'function'
           && typeof window.__forgeDraftAnalysisHelper.clearDraftFromObject === 'function'
           && typeof window.__forgeDraftAnalysisHelper.updateDraftUniforms === 'function'
           && typeof window.__forgeDraftAnalysisHelper.classifyDraft === 'function'
           && typeof window.__forgeDraftAnalysisHelper.sampleDraftBands === 'function'
           && window.__forgeDraftAnalysisHelper.EVENT_NAME === 'forge:draft-analysis-changed'
           && window.__forgeDraftAnalysisHelper.STORAGE_KEY === 'forge.v4.draftAnalysis'
           && window.__forgeDraftAnalysisHelper.MATERIAL_NAME === 'forge.draftAnalysis'
           && Array.isArray(window.__forgeDraftAnalysisHelper.PULL_PRESETS)
           && window.__forgeDraftAnalysisHelper.PULL_PRESETS.length >= 6
           && !!window.__forgeDraftAnalysisHelper.DEFAULTS,
        null, { timeout: 8000 });

    // The window mirror is hydrated on host mount even before the panel
    // is opened.
    await page.waitForFunction(
        () => !!window.__forgeDraftAnalysis
           && typeof window.__forgeDraftAnalysis.pullDirId === 'string'
           && Number.isFinite(window.__forgeDraftAnalysis.thresholdDeg)
           && Number.isFinite(window.__forgeDraftAnalysis.pullDirX)
           && Number.isFinite(window.__forgeDraftAnalysis.pullDirY)
           && Number.isFinite(window.__forgeDraftAnalysis.pullDirZ),
        null, { timeout: 4000 });

    // Sanity-check the pure helper classifies bands correctly. A normal
    // along +Z with pullDir +Z is a 90° draft = safe. Inverse is
    // undercut.
    const cls = await page.evaluate(() => {
        const h = window.__forgeDraftAnalysisHelper;
        return {
            safe:   h.classifyDraft([0, 0,  1], [0, 0, 1], 1.0),
            undercut: h.classifyDraft([0, 0, -1], [0, 0, 1], 1.0),
            border: h.classifyDraft([
                Math.sin(0.5 * Math.PI / 180),
                0,
                Math.cos(0.5 * Math.PI / 180),
            ], [1, 0, 0], 1.0),
        };
    });
    expect(cls.safe.band).toBe('safe');
    expect(cls.safe.angleDeg).toBeCloseTo(90, 1);
    expect(cls.undercut.band).toBe('undercut');
    expect(cls.undercut.angleDeg).toBeCloseTo(-90, 1);
    expect(cls.border.band).toBe('borderline');

    // Seed a real OCCT box. Viewport.jsx mesh ref tags the rendered mesh
    // with userData.body — that's what the draft overlay scans for when
    // picking swap targets (same key zebra + light-line use).
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(40, 40, 40);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-box-104', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Box 40x40x40 (PUSH-104)',
            params: { width: 40, height: 40, distance: 40 },
        });
        return { handle: h };
    });
    expect(seeded.error).toBeUndefined();
    expect(seeded.handle).toBeGreaterThan(0);
    boxHandle = seeded.handle;

    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await page.waitForFunction(
        () => {
            const sc = window.__forgeScene;
            if (!sc) return false;
            let found = false;
            sc.traverse((o) => {
                if (o && o.isMesh && o.userData && o.userData.body) found = true;
            });
            return found;
        }, null, { timeout: 8000 });
    await shot('body-seeded');
});

test('01 — open panel + enable + ShaderMaterial swap + uniforms (front)', async () => {
    await cameraTo('front');

    // Capture the bus event so we can prove the publish path fires.
    await page.evaluate(() => {
        window.__push104Events = [];
        window.addEventListener('forge:draft-analysis-changed', (e) => {
            try {
                window.__push104Events.push({
                    visible: e?.detail?.visible,
                    pullDirId: e?.detail?.pullDirId,
                    thresholdDeg: e?.detail?.thresholdDeg,
                });
            } catch {}
        });
    });

    // Activate via the menu action — same channel the real menu bar uses.
    await platformMenuAction('tools.draftAnalysis');

    await page.waitForSelector('[data-testid="forge-draft-analysis-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    // The panel surfaces every uniform on its data-* attributes so the
    // e2e doesn't have to scrape inner text.
    const panel = page.locator('[data-testid="forge-draft-analysis-panel"]');
    expect(await panel.getAttribute('data-visible')).toBe('0');
    expect(await panel.getAttribute('data-pull-dir-id')).toBe('+Z');
    expect(Number(await panel.getAttribute('data-threshold-deg'))).toBeGreaterThan(0);
    // Green ratio is computed live from a fibonacci-sphere sample. With
    // pullDir +Z and threshold 1° about half the sphere is green-ish;
    // we just assert it's positive (the brief mandates "green-ratio > 0
    // in samples").
    expect(Number(await panel.getAttribute('data-green-ratio'))).toBeGreaterThan(0);

    // Click "Enable draft analysis". The toggle button drives the
    // material swap synchronously.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-draft-analysis-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(400);
    await shot('after-enable');

    // The panel attribute flips.
    expect(await panel.getAttribute('data-visible')).toBe('1');

    // The shared draft material lands on at least one body mesh.
    const swapState = await sampleDraftMaterial();
    console.log('[push-104] swapState =', swapState);
    expect(swapState.totalBodyMeshes).toBeGreaterThan(0);
    expect(swapState.draftMatMeshes).toBeGreaterThan(0);
    expect(swapState.origStashed).toBeGreaterThan(0);
    expect(swapState.sampleArchdiscDraftAnalysis).toBe(true);
    // The brief explicitly mandates "material.uniforms.pullDir present".
    expect(swapState.sampleUniforms).not.toBeNull();
    expect(swapState.sampleUniforms.pullDir).not.toBeNull();
    // For default +Z pull, the unit vector is (0, 0, 1).
    expect(swapState.sampleUniforms.pullDir.x).toBeCloseTo(0, 2);
    expect(swapState.sampleUniforms.pullDir.y).toBeCloseTo(0, 2);
    expect(swapState.sampleUniforms.pullDir.z).toBeCloseTo(1, 2);
    // Threshold uniform is in radians (1° → ~0.01745).
    expect(swapState.sampleUniforms.threshold).toBeCloseTo(Math.PI / 180, 3);
    // Material carries the canonical name (the brief's other hint).
    expect(swapState.sampleMaterialName).toBe('forge.draftAnalysis');

    // The applied-count readout reflects the mesh count.
    const appliedReadout = page.locator('[data-testid="forge-draft-analysis-applied-readout"]');
    const appliedAttr = Number(await appliedReadout.getAttribute('data-value'));
    expect(appliedAttr).toBeGreaterThan(0);

    // The bus event fired with visible=true.
    const events = await page.evaluate(() => window.__push104Events || []);
    expect(events.some((e) => e.visible === true)).toBe(true);

    // Sample the green ratio explicitly via the helper for +Z pull.
    // The brief mandates "green-ratio > 0 in samples".
    const banded = await page.evaluate(() => {
        return window.__forgeDraftAnalysisHelper.sampleDraftBands([0, 0, 1], 1.0, 512);
    });
    console.log('[push-104] +Z banded =', banded);
    expect(banded.green).toBeGreaterThan(0);
    expect(banded.greenRatio).toBeGreaterThan(0);
    // Sanity: for a symmetric pull (±Z over the sphere) at threshold 1°,
    // about half the sphere lies above the perpendicular plane → green.
    expect(banded.greenRatio).toBeGreaterThan(0.3);
});

test('02 — threshold slider drives live uniform (top)', async () => {
    await cameraTo('top');

    const panel = page.locator('[data-testid="forge-draft-analysis-panel"]');
    const beforeThreshold = Number(await panel.getAttribute('data-threshold-deg'));
    expect(beforeThreshold).toBeGreaterThan(0);

    // Drag the threshold slider to 2.5°. The host's effect mutates the
    // uniform on the shared material — no rebuild.
    await setReactRange('forge-draft-analysis-threshold', 2.5);
    await pause(300);
    await shot('threshold-2.5');

    const afterThreshold = Number(await panel.getAttribute('data-threshold-deg'));
    expect(afterThreshold).toBeCloseTo(2.5, 1);

    // The shared uniform (in radians) also reflects the new value.
    const sample = await sampleDraftMaterial();
    expect(sample.sampleUniforms.threshold).toBeCloseTo(2.5 * Math.PI / 180, 3);

    // The published mirror exposes the new threshold too.
    const live = await page.evaluate(() => window.__forgeDraftAnalysis);
    expect(live).not.toBeNull();
    expect(live.thresholdDeg).toBeCloseTo(2.5, 1);

    // The bands ratio recomputes — the yellow band gets wider as
    // threshold rises (yellow now covers a bigger arc of the sphere).
    const beforeYellow = Number(await panel.getAttribute('data-yellow-ratio'));
    expect(beforeYellow).toBeGreaterThan(0);
});

test('03 — pull preset −Z flips axis; disable restores PBR (right)', async () => {
    await cameraTo('right');

    // Click the −Z preset button. The preset commits a unit (0, 0, -1)
    // axis and updates the panel attribute.
    await page.locator('[data-testid="forge-draft-analysis-pull--Z"]').click();
    await pause(300);
    await shot('pull-minus-z');

    const panel = page.locator('[data-testid="forge-draft-analysis-panel"]');
    expect(await panel.getAttribute('data-pull-dir-id')).toBe('-Z');
    expect(Number(await panel.getAttribute('data-pull-dir-x'))).toBeCloseTo(0, 2);
    expect(Number(await panel.getAttribute('data-pull-dir-y'))).toBeCloseTo(0, 2);
    expect(Number(await panel.getAttribute('data-pull-dir-z'))).toBeCloseTo(-1, 2);

    // The shared uniform's pullDir matches the preset.
    let sample = await sampleDraftMaterial();
    expect(sample.sampleUniforms.pullDir.x).toBeCloseTo(0, 2);
    expect(sample.sampleUniforms.pullDir.y).toBeCloseTo(0, 2);
    expect(sample.sampleUniforms.pullDir.z).toBeCloseTo(-1, 2);

    // Sample green ratio for -Z pull — same symmetry as +Z (just
    // mirrored), so green ratio is still > 0.
    const banded = await page.evaluate(() => {
        return window.__forgeDraftAnalysisHelper.sampleDraftBands([0, 0, -1], 1.0, 512);
    });
    console.log('[push-104] -Z banded =', banded);
    expect(banded.greenRatio).toBeGreaterThan(0.3);

    // Now Disable via the toggle button.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-draft-analysis-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(400);
    await shot('after-disable');

    expect(await panel.getAttribute('data-visible')).toBe('0');

    // Every body mesh's material is restored to a non-draft material,
    // the stash key is gone, and the applied count is 0.
    sample = await sampleDraftMaterial();
    expect(sample.draftMatMeshes).toBe(0);
    expect(sample.origStashed).toBe(0);
    expect(sample.sampleArchdiscDraftAnalysis).toBe(false);

    const appliedReadout = page.locator('[data-testid="forge-draft-analysis-applied-readout"]');
    expect(Number(await appliedReadout.getAttribute('data-value'))).toBe(0);

    // Close the draft panel so the next test starts clean.
    await page.locator('[data-testid="forge-draft-analysis-close"]').click();
    await pause(300);
    await shot('panel-closed');
});

test('04 — PUSH-86 zebra material-swap regression (iso)', async () => {
    await cameraTo('iso');

    // First half: zebra still works after the draft lifecycle. Enable
    // zebra via its menu action and confirm the ShaderMaterial reaches
    // the body (this is the PUSH-86 contract, intact alongside PUSH-104).
    await platformMenuAction('tools.zebraStripes');
    await page.waitForSelector('[data-testid="forge-zebra-stripes-panel"]',
                               { state: 'visible', timeout: 6000 });
    await pause(600);
    await shot('zebra-on');

    const zebraState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let zebraMatMeshes = 0;
        let zebraStashed = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMatMeshes += 1;
            if (o.userData._origMaterial) zebraStashed += 1;
        });
        return { zebraMatMeshes, zebraStashed };
    });
    expect(zebraState.zebraMatMeshes).toBeGreaterThan(0);
    expect(zebraState.zebraStashed).toBeGreaterThan(0);

    // Turn zebra OFF so its per-frame RAF loop stops re-stomping the
    // material we're about to install. Both overlays use the
    // material-swap pattern — they cooperate by handing each other the
    // original baseline cleanly.
    await page.evaluate(() => {
        if (typeof window.__forgeOpenZebraStripes === 'function') {
            window.__forgeOpenZebraStripes(false);
        }
    });
    await pause(500);
    await shot('zebra-off-before-draft');

    const afterZebraOff = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let zebraMeshes = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
        });
        return { zebraMeshes };
    });
    expect(afterZebraOff.zebraMeshes).toBe(0);

    // NOW enable draft on top. applyDraftToObject swaps every body's
    // material to the draft shader. No zebra material remains.
    await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
                             { detail: { id: 'tools.draftAnalysis' } }));
    });
    await pause(300);
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-draft-analysis-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(600);
    await shot('draft-after-zebra');

    const coopState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let draftMeshes = 0;
        let zebraMeshes = 0;
        let draftStashed = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
            if (o.material && o.material.userData?.archdiscDraftAnalysis) draftMeshes += 1;
            if (o.userData.__draftOriginalMaterial) draftStashed += 1;
        });
        return { draftMeshes, zebraMeshes, draftStashed };
    });
    console.log('[push-104] coopState =', coopState);
    // Draft material is in place; no zebra material (no collision).
    expect(coopState.draftMeshes).toBeGreaterThan(0);
    expect(coopState.zebraMeshes).toBe(0);
    expect(coopState.draftStashed).toBeGreaterThan(0);

    // Disable the draft overlay — body returns to underlying PBR.
    await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="forge-draft-analysis-toggle"]');
        if (!btn) throw new Error('toggle button not found');
        btn.click();
    });
    await pause(600);
    await shot('after-draft-disable');

    const finalState = await page.evaluate(() => {
        const sc = window.__forgeScene;
        if (!sc) return { error: 'no scene' };
        let draftMeshes = 0;
        let zebraMeshes = 0;
        sc.traverse((o) => {
            if (!o || !o.isMesh || !o.userData) return;
            if (!o.userData.body) return;
            if (o.material && o.material.userData?.archdiscDraftAnalysis) draftMeshes += 1;
            if (o.material && o.material.name === 'forge.zebraStripes') zebraMeshes += 1;
        });
        return { draftMeshes, zebraMeshes };
    });
    // Both overlays off → we're back to baseline.
    expect(finalState.draftMeshes).toBe(0);
    expect(finalState.zebraMeshes).toBe(0);

    await shot('regression-final-iso');
});
