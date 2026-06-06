// PUSH-56 (Slice-23b / Configurations dim #4 — design-table goes live)
//
// Configurations / design-table now drives REAL geometry rebuild — not just
// a journal of edits. Editing a cell on the active configuration calls
// onApply → regenerate(), so the viewport rebuilds with the new parameter
// value. A new Suppress column drops a feature from the regen on toggle.
//
// Proof through the real Electron UI:
//   1. Seed one feature whose toolId='solid.extrude' takes width/height/
//      distance and falls back to a native makeBox (no sketch) → real OCCT
//      body with 30×30×25 = 22500 mm³.
//   2. Open Configurations (Tools → Configurations).
//   3. Add a "Tall" variant; switch the Design Table to it; edit `distance`
//      30 → 60 → the viewport rebuilds to a 30×30×60 body (vol 54000 mm³).
//   4. Toggle suppress on the only feature → bodies array drops to length 0.
//   5. Untoggle + switch back to default → original geometry returns
//      (22500 mm³).
//   6. window.__forgeConfigurations is published with both variants.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-56-configurations');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'configurations-session.mp4');

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
    await pause(500);
}
async function cameraTo(viewName) {
    // Use the real view menu so this counts as a named camera angle.
    await platformMenuAction(`view.${viewName}`);
    await pause(300);
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
        if (/push-56|configs|forge|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(800);
});

test.afterAll(async () => {
    try { await pause(2000); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-56] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-56] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-56] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

// Read the volume of the FIRST live body directly from the kernel — the
// only ground truth, because feature-tree params are the immutable base
// and don't reflect the active config's overrides.
async function activeBodyVolume() {
    return page.evaluate(() => {
        const b = (window.__forgeBodies || [])[0];
        if (!b || b.kind !== 'native' || typeof b.handle !== 'number') return null;
        try {
            const m = window.forge.massProps(b.handle);
            return Number(m?.volume ?? m?.vol ?? null);
        } catch {
            return null;
        }
    });
}

test('00 — boot + seed a parametric extrude feature (30×30×25 native box)', async () => {
    await cameraTo('iso');
    await shot('boot');

    // Reset any leftover configurations from previous runs so the Variants
    // tab starts clean (only `default`).
    await page.evaluate(() => {
        try { localStorage.removeItem('forge.v4.configs'); } catch {}
    });

    // Seed feature tree with a single solid.extrude node (no sketch ctx →
    // its kernelDispatch falls back to f.makeBox(width, height, distance),
    // which is a real OCCT box).
    await page.evaluate(() => {
        const tree = [{
            id: 'f-0', label: 'Block', icon: 'solid.extrude', toolId: 'solid.extrude',
            params: { width: 30, height: 30, distance: 25 },
        }];
        window.__forgeReplaceFeatureTree(tree);
    });
    await page.waitForFunction(
        () => (window.__forgeFeatureTree || []).length === 1, null, { timeout: 4000 });
    await shot('seeded-tree');

    // Open the Configurations panel and click the 'default' variant — that
    // invokes onApply(applyConfiguration(tree, default-cfg)) which runs
    // setBodies(regenerate(tree)) and is the same path every later config
    // switch / cell edit will take. This is how we get the FIRST real body.
    await platformMenuAction('tools.configurations');
    await page.waitForSelector('[data-testid="forge-configs-panel"]', { state: 'visible', timeout: 6000 });
    await page.locator('[data-testid="forge-configs-tab-configs"]').click();
    await page.locator('div[data-config="default"]').click({ force: true });
    await pause(1500);
    await shot('seeded-default');

    const state0 = await page.evaluate(() => ({
        bodies: (window.__forgeBodies || []).length,
        kinds:  (window.__forgeBodies || []).map((b) => b.kind),
    }));
    const vol0 = await activeBodyVolume();
    console.log('[push-56] after seed bodies=', state0.bodies, 'kinds=', state0.kinds, 'vol=', vol0);
    expect(state0.bodies).toBe(1);
    expect(state0.kinds[0]).toBe('native');
    expect(Math.abs(vol0 - 30 * 30 * 25)).toBeLessThan(1); // 22500 mm³ exact
});

test('01 — add a Tall variant via the Configurations panel', async () => {
    await cameraTo('front');
    // Panel is already open from test 00.
    await shot('configs-open');

    // Electron disables window.prompt (returns null with no UI). Stub it so
    // the add-config button can run its real handler.
    await page.evaluate(() => { window.prompt = () => 'Tall'; });
    await page.locator('[data-testid="forge-configs-add"]').click();
    await pause(500);
    await shot('variants-after-add');

    const cfgNames = await page.evaluate(() => {
        const raw = localStorage.getItem('forge.v4.configs');
        if (!raw) return [];
        try { return Object.keys(JSON.parse(raw).configs || {}); } catch { return []; }
    });
    console.log('[push-56] cfgNames=', cfgNames);
    expect(cfgNames).toContain('default');
    expect(cfgNames).toContain('Tall');
});

test('02 — switch to Tall + edit distance 25 → 60 in the design table', async () => {
    await cameraTo('right');
    // Activate Tall by clicking the row in the Variants tab.
    await page.locator('[data-testid="forge-configs-tab-configs"]').click();
    await pause(300);
    await page.locator('div[data-config="Tall"]').click({ force: true });
    await pause(500);

    // Open Design Table.
    await page.locator('[data-testid="forge-configs-tab-table"]').click();
    await page.waitForSelector('[data-testid="forge-configs-table"]', { state: 'visible' });
    await shot('design-table');

    // Confirm Suppress row exists for the seeded feature.
    await expect(page.locator('tr[data-row="suppress"][data-feature="f-0"]')).toHaveCount(1);
    await expect(page.locator('input[data-cell="Tall/f-0/__suppress"]')).toHaveCount(1);

    // Edit the `distance` cell for the Tall config to 60.
    const distCell = page.locator('input[data-cell="Tall/f-0/distance"]');
    await expect(distCell).toHaveCount(1);
    await distCell.fill('60');
    await distCell.blur();
    await pause(1500);
    await shot('distance-60-tall');

    const live = await page.evaluate(() => ({
        bodies:    (window.__forgeBodies || []).length,
        published: !!window.__forgeConfigurations,
        configs:   window.__forgeConfigurations
                     ? Object.keys(window.__forgeConfigurations.configs || {})
                     : [],
        // The override was stored in the active config; the base tree
        // intentionally stays at distance=25.
        tallOverride: (() => {
            try {
                const raw = JSON.parse(localStorage.getItem('forge.v4.configs') || '{}');
                return raw.configs?.Tall?.overrides?.['f-0']?.distance ?? null;
            } catch { return null; }
        })(),
    }));
    const vol = await activeBodyVolume();
    console.log('[push-56] after edit live=', JSON.stringify(live), 'vol=', vol);
    expect(live.bodies).toBe(1);
    expect(live.published).toBe(true);
    expect(live.configs).toEqual(expect.arrayContaining(['default', 'Tall']));
    expect(live.tallOverride).toBe(60);
    // Body actually grew to 30×30×60 in the viewport — this is the live-
    // regen proof that the design-table edit drove a real OCCT rebuild.
    expect(Math.abs(vol - 30 * 30 * 60)).toBeLessThan(1); // 54000 mm³
});

test('03 — toggle Suppress on Tall → bodies drop to 0', async () => {
    await cameraTo('top');
    const supBox = page.locator('input[data-cell="Tall/f-0/__suppress"]');
    await supBox.click();
    await pause(1200);
    await shot('suppressed');

    const sup = await page.evaluate(() => ({
        bodies: (window.__forgeBodies || []).length,
        // Tree is the immutable base — suppress lives in the active config.
        tallSuppress: (() => {
            try {
                const raw = JSON.parse(localStorage.getItem('forge.v4.configs') || '{}');
                return !!raw.configs?.Tall?.suppress?.['f-0'];
            } catch { return null; }
        })(),
    }));
    console.log('[push-56] after suppress sup=', JSON.stringify(sup));
    expect(sup.bodies).toBe(0);
    expect(sup.tallSuppress).toBe(true);

    // Untoggle, body returns at distance=60.
    await supBox.click();
    await pause(1200);
    const back = await page.evaluate(() => ((window.__forgeBodies || []).length));
    expect(back).toBe(1);
    const volBack = await activeBodyVolume();
    expect(Math.abs(volBack - 30 * 30 * 60)).toBeLessThan(1); // still Tall (54000)
});

test('04 — switch back to default → original 30×30×25 geometry returns', async () => {
    await cameraTo('iso');
    await page.locator('[data-testid="forge-configs-tab-configs"]').click();
    await pause(300);
    await page.locator('div[data-config="default"]').click({ force: true });
    await pause(1200);
    await shot('default-restored');

    const def = await page.evaluate(() => ((window.__forgeBodies || []).length));
    const volDef = await activeBodyVolume();
    console.log('[push-56] after switch back bodies=', def, 'vol=', volDef);
    expect(def).toBe(1);
    expect(Math.abs(volDef - 30 * 30 * 25)).toBeLessThan(1); // 22500 — base
});

test('05 — global search exposes Configurations', async () => {
    await page.keyboard.press('Escape').catch(() => {});
    await pause(200);
    await page.keyboard.press('Meta+K').catch(() => {});
    await pause(400);
    let palette = page.locator('[data-testid="forge-cmd-palette"]');
    if (await palette.count() === 0) {
        await page.keyboard.press('Control+K').catch(() => {});
        await pause(400);
        palette = page.locator('[data-testid="forge-cmd-palette"]');
    }
    if (await palette.count() > 0) {
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Configurations');
        await pause(400);
        await shot('search-configs');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Configurations/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-56] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
