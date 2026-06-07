// PUSH-109 (Slice-78) — Full Material Properties editor.
//
// PUSH-58 / PUSH-61 shipped a density-only material picker — good enough
// for the mass readout, not nearly enough for real FEA: a static stress
// run wants E + ν, a buckling check wants σY, a thermal solve wants k /
// α / cp. PUSH-109 introduces a proper per-body editor for the full 8-
// property record + 6-entry preset library, persisted to
// `forge.v4.materialProps` + window-mirrored at
// `window.__forgeMaterialProperties[handle]`.
//
// Proof end-to-end (this spec):
//
//   00 — Boot, seed a 30³ native box, clear any previous materialProps.
//   01 — Open Material Properties via the tools.materialProperties menu
//        action, pick the "Steel A36" preset, Apply.
//        Asserts E === 200 GPa on the editor input + on the window
//        mirror, density === 7.85 g/cc, σY === 250 MPa, k === 50 W/mK,
//        and the localStorage payload writes through.
//   02 — Switch to "Aluminum 6061" preset, Apply.
//        Asserts E === 69 GPa, density === 2.70 g/cc, σY === 276 MPa,
//        k === 167 W/mK on input + mirror.
//   03 — Switch to "Titanium Ti-6Al-4V" preset + tweak σY by hand to
//        900, Apply. Asserts σY === 900 (numeric override) but E ===
//        113.8 (preset baseline preserved).
//   04 — Reload — assertions survive (localStorage round-trip).
//   05 — Regression — PUSH-58 mass-props panel still opens and still
//        shows steel as the default material for the box. PUSH-109's
//        record is a separate channel, so it must not corrupt the
//        PUSH-58 mass dropdown.
//
// Multi-cam: iso / front / right / top / iso-final = 5 named camera angles.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-109-material-properties');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'material-properties-session.mp4');

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
    await pause(300);
}

async function readField(key) {
    const v = await page.locator(`[data-testid="forge-matprops-${key}"]`).inputValue();
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

async function setFieldRaw(key, value) {
    const el = page.locator(`[data-testid="forge-matprops-${key}"]`);
    await el.fill(String(value));
    await el.dispatchEvent('input');
    await pause(200);
}

async function readWindowProps(handle) {
    return page.evaluate((h) => {
        const map = window.__forgeMaterialProperties;
        return (map && typeof map === 'object') ? (map[h] || null) : null;
    }, handle);
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
        if (/push-109|matprops|material|forge|error|Error/i.test(t)) {
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
    await pause(800);

    // Reset PUSH-109 + PUSH-61 stores so a previous run doesn't bleed
    // numeric records or material strings into this one.
    await page.evaluate(() => {
        try { window.localStorage.removeItem('forge.v4.materialProps'); } catch {}
        try { window.localStorage.removeItem('forge.v4.bodyMaterials'); } catch {}
        const mp = window.__forgeMaterialPropertiesHelper;
        if (mp && typeof mp.clearMaterialProperties === 'function') {
            mp.clearMaterialProperties();
        }
        const bm = window.__forgeBodyMaterialsHelper;
        if (bm && typeof bm.clearBodyMaterials === 'function') {
            bm.clearBodyMaterials();
        }
    });
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
        console.error('[push-109] no .webm');
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
                console.log(`[push-109] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            } else {
                console.error('[push-109] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

// ─────────────────────────────────────────────────────────────────────

test('00 — boot + seed 30³ native box', async () => {
    await cameraTo('iso');
    await shot('boot');

    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(30, 30, 30);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-matprops-box', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'MatProps Box',
            params: { width: 30, height: 30, distance: 30 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });
    await shot('body-seeded');

    // Stash handle for later steps.
    await page.evaluate((h) => { window.__push109Handle = h; }, seeded.handle);
});

test('01 — Steel A36 preset → E === 200 GPa, density === 7.85 g/cc', async () => {
    await cameraTo('front');

    // Open the panel via the menu action.
    await platformMenuAction('tools.materialProperties');
    await page.waitForSelector('[data-testid="forge-matprops-panel"]', {
        state: 'visible', timeout: 6000,
    });
    await shot('panel-open');

    // Body picker auto-selects the seeded box.
    const bodyVal = await page.locator('[data-testid="forge-matprops-body"]').inputValue();
    expect(Number(bodyVal)).toBeGreaterThan(0);

    // Pick Steel A36 preset.
    await page.locator('[data-testid="forge-matprops-preset"]')
        .selectOption('Steel A36');
    await pause(300);
    await shot('preset-steel');

    // Numeric inputs reflect the preset before Apply (so the user can see
    // what they're about to commit).
    expect(await readField('E')).toBeCloseTo(200, 3);
    expect(await readField('density')).toBeCloseTo(7.85, 3);
    expect(await readField('nu')).toBeCloseTo(0.26, 3);
    expect(await readField('sigmaY')).toBeCloseTo(250, 3);
    expect(await readField('sigmaU')).toBeCloseTo(400, 3);
    expect(await readField('k')).toBeCloseTo(50, 3);
    expect(await readField('alpha')).toBeCloseTo(12.0, 3);
    expect(await readField('cp')).toBeCloseTo(486, 3);

    // Apply commits the record.
    await page.locator('[data-testid="forge-matprops-apply"]').click();
    await pause(300);
    await shot('preset-steel-applied');

    await expect(page.locator('[data-testid="forge-matprops-status"]'))
        .toHaveText('Applied');

    // Window mirror reflects the record under the handle.
    const handle = await page.evaluate(() => window.__push109Handle);
    const rec = await readWindowProps(handle);
    console.log('[push-109] window mirror after steel apply =', rec);
    expect(rec).not.toBeNull();
    expect(rec.E).toBeCloseTo(200, 3);
    expect(rec.density).toBeCloseTo(7.85, 3);
    expect(rec.sigmaY).toBeCloseTo(250, 3);
    expect(rec.k).toBeCloseTo(50, 3);

    // localStorage payload is JSON-round-tripped.
    const ls = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.materialProps'));
    expect(ls).toBeTruthy();
    const parsed = JSON.parse(ls);
    const key = `h:${handle}`;
    expect(parsed[key]).toBeTruthy();
    expect(parsed[key].preset).toBe('Steel A36');
    expect(parsed[key].E).toBeCloseTo(200, 3);
});

test('02 — Aluminum 6061 preset → E === 69 GPa, density === 2.70 g/cc', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-matprops-preset"]')
        .selectOption('Aluminum 6061');
    await pause(300);
    await shot('preset-aluminum');

    expect(await readField('E')).toBeCloseTo(69, 3);
    expect(await readField('density')).toBeCloseTo(2.70, 3);
    expect(await readField('nu')).toBeCloseTo(0.33, 3);
    expect(await readField('sigmaY')).toBeCloseTo(276, 3);
    expect(await readField('sigmaU')).toBeCloseTo(310, 3);
    expect(await readField('k')).toBeCloseTo(167, 3);
    expect(await readField('alpha')).toBeCloseTo(23.6, 3);
    expect(await readField('cp')).toBeCloseTo(896, 3);

    await page.locator('[data-testid="forge-matprops-apply"]').click();
    await pause(300);
    await shot('preset-aluminum-applied');

    const handle = await page.evaluate(() => window.__push109Handle);
    const rec = await readWindowProps(handle);
    console.log('[push-109] window mirror after aluminum apply =', rec);
    expect(rec.E).toBeCloseTo(69, 3);
    expect(rec.density).toBeCloseTo(2.70, 3);
    expect(rec.sigmaY).toBeCloseTo(276, 3);
    expect(rec.k).toBeCloseTo(167, 3);
});

test('03 — Titanium preset + σY override → mixed numeric record', async () => {
    await cameraTo('top');

    await page.locator('[data-testid="forge-matprops-preset"]')
        .selectOption('Titanium Ti-6Al-4V');
    await pause(300);
    expect(await readField('E')).toBeCloseTo(113.8, 3);
    expect(await readField('sigmaY')).toBeCloseTo(880, 3);

    // Manual override of sigmaY → flips preset to Custom in the
    // editor, but E stays at the Ti baseline.
    await setFieldRaw('sigmaY', 900);
    expect(await readField('sigmaY')).toBeCloseTo(900, 3);
    await shot('titanium-tweaked');

    await page.locator('[data-testid="forge-matprops-apply"]').click();
    await pause(300);
    await shot('titanium-applied');

    const handle = await page.evaluate(() => window.__push109Handle);
    const rec = await readWindowProps(handle);
    console.log('[push-109] window mirror after Ti tweak apply =', rec);
    expect(rec.E).toBeCloseTo(113.8, 3);
    expect(rec.sigmaY).toBeCloseTo(900, 3); // overridden
    expect(rec.density).toBeCloseTo(4.43, 3); // baseline preserved
    expect(rec.k).toBeCloseTo(6.7, 3); // baseline preserved
});

test('04 — localStorage survives a page reload', async () => {
    const before = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.materialProps'));
    expect(before).toBeTruthy();
    const beforeParsed = JSON.parse(before);
    const handle = await page.evaluate(() => window.__push109Handle);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await pause(2500);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape').catch(() => {});
    await pause(500);

    const after = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.materialProps'));
    expect(after).toBeTruthy();
    expect(JSON.parse(after)).toEqual(beforeParsed);

    // The window mirror is also hydrated by the module-load load() call
    // — independent of any panel mount.
    const mirrored = await page.evaluate(() => {
        const map = window.__forgeMaterialPropertiesHelper?.getAllMaterialProperties();
        return map || null;
    });
    expect(mirrored).toEqual(beforeParsed);

    // Spot-check: the persisted record still says E === 113.8 (Ti) and
    // sigmaY === 900 (our override).
    const key = `h:${handle}`;
    expect(beforeParsed[key]).toBeTruthy();
    expect(beforeParsed[key].E).toBeCloseTo(113.8, 3);
    expect(beforeParsed[key].sigmaY).toBeCloseTo(900, 3);

    await shot('post-reload');
});

test('05 — regression: PUSH-58 mass props panel still opens + defaults to steel', async () => {
    await cameraTo('iso');

    // Re-seed a new body (the previous reload wiped __forgeBodies).
    const seeded = await page.evaluate(() => {
        const h = window.forge?.makeBox?.(30, 30, 30);
        if (typeof h !== 'number') return { error: 'forge.makeBox unavailable' };
        window.__forgeAppendBody({
            id: 'f-massregress-box', kind: 'native', handle: h,
            toolId: 'solid.box', name: 'Regress Box',
            params: { width: 30, height: 30, distance: 30 },
        });
        return { handle: h };
    });
    expect(seeded.handle).toBeGreaterThan(0);
    await page.waitForFunction(
        () => (window.__forgeBodies || []).some((b) => b.kind === 'native'),
        null, { timeout: 4000 });

    // Open PUSH-58 panel via the menu action — it must continue to work
    // because PUSH-109 uses a separate menu id + separate storage key.
    await platformMenuAction('tools.massprops');
    await page.waitForSelector('[data-testid="forge-massprops-panel"]', {
        state: 'visible', timeout: 6000,
    });
    await shot('massprops-open');

    const mat = await page.locator('[data-testid="forge-massprops-material"]').inputValue();
    expect(mat).toBe('steel');

    // Mass = 27000 × 7.85e-3 = 211.95 g exactly (PUSH-58 contract).
    const massTxt = await page.locator('[data-testid="forge-massprops-mass"]').textContent();
    const m = Number(/([0-9]+\.[0-9]+)\s*g\b/.exec(massTxt || '')?.[1]);
    console.log('[push-109] regression steel mass =', m);
    expect(Math.abs(m - 211.95)).toBeLessThan(0.05);
    await shot('massprops-regression-pass');
});
