// PUSH-79 (Slice-47 / Theme switcher panel).
//
// Proof end-to-end:
//   1. Boot Electron, dismiss any first-run banner; clear theme to dark.
//   2. Assert global helpers (window.__forgeThemeHelper +
//      window.__forgeOpenThemeSwitcher) are installed on mount.
//   3. Open the Theme switcher panel via tools.themes menu action.
//      Panel mounts; 4 radios visible; Dark is initially checked.
//   4. Click Sepia → assert:
//        • document.documentElement.dataset.forgeTheme === 'sepia'
//        • localStorage 'forge.v4.theme' === '"sepia"'  (JSON-encoded)
//        • a forge:theme-changed event fired with detail.theme === 'sepia'
//        • the panel's Active chip + row's data-checked='true' flip.
//   5. Click High Contrast → same assertions for 'high-contrast'.
//   6. Click Dark → confirm we can return to baseline.
//   7. PUSH-65 regression: open Section Plane panel via tools.sectionPlane.
//
// Multi-cam: 5 named camera angles per the Forge-171 multi-cam mandate.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-79-theme-switcher');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'theme-switcher-session.mp4');

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

async function installEventCapture() {
    await page.evaluate(() => {
        window.__push79Events = [];
        window.addEventListener('forge:theme-changed', (e) => {
            try { window.__push79Events.push({ theme: e?.detail?.theme || null }); }
            catch {}
        });
    });
}
async function readEvents() {
    return await page.evaluate(() => window.__push79Events || []);
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
        if (/push-79|theme|ThemeSwitcher|forge:theme|error|Error/i.test(t)) {
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
    await page.evaluate(() => {
        try {
            window.localStorage.setItem('forge.v4.theme', JSON.stringify('dark'));
            document.documentElement.dataset.forgeTheme = 'dark';
        } catch {}
    });
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
        console.error('[push-79] no .webm');
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
                console.log(`[push-79] mp4 written: ${FINAL_MP4} (${sz} MB)`);
            } else {
                console.error('[push-79] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            }
            resolve();
        });
    });
});

test('00 — boot + global window surface installed', async () => {
    await cameraTo('iso');
    await shot('boot');
    await page.waitForFunction(
        () => typeof window.__forgeOpenThemeSwitcher === 'function'
           && typeof window.__forgeCloseThemeSwitcher === 'function'
           && typeof window.__forgeThemeHelper === 'object'
           && typeof window.__forgeThemeHelper.setForgeTheme === 'function',
        null, { timeout: 8000 });
    const themes = await page.evaluate(() =>
        (window.__forgeThemeHelper.THEMES || []).map((t) => t.id));
    expect(themes).toEqual(['dark', 'light', 'sepia', 'high-contrast']);
    await installEventCapture();
});

test('01 — open Theme switcher panel via tools.themes menu', async () => {
    await cameraTo('front');
    await platformMenuAction('tools.themes');
    await page.waitForSelector('[data-testid="forge-theme-switcher-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('panel-open');

    const rowDark = page.locator('[data-testid="forge-theme-switcher-row-dark"]');
    const rowLight = page.locator('[data-testid="forge-theme-switcher-row-light"]');
    const rowSepia = page.locator('[data-testid="forge-theme-switcher-row-sepia"]');
    const rowHC = page.locator('[data-testid="forge-theme-switcher-row-high-contrast"]');
    await expect(rowDark).toBeVisible();
    await expect(rowLight).toBeVisible();
    await expect(rowSepia).toBeVisible();
    await expect(rowHC).toBeVisible();

    expect(await rowDark.getAttribute('data-checked')).toBe('true');
    expect(await rowLight.getAttribute('data-checked')).toBe('false');
    expect(await rowSepia.getAttribute('data-checked')).toBe('false');
    expect(await rowHC.getAttribute('data-checked')).toBe('false');

    const activeChip = page.locator('[data-testid="forge-theme-switcher-active"]');
    expect(await activeChip.getAttribute('data-theme-id')).toBe('dark');
});

test('02 — click Sepia → DOM dataset + localStorage + bus event all flip', async () => {
    await cameraTo('top');

    const before = await readEvents();
    const beforeCount = before.length;

    await page.locator('[data-testid="forge-theme-switcher-radio-sepia"]').check();
    await pause(350);
    await shot('sepia-selected');

    const datasetTheme = await page.evaluate(() =>
        document.documentElement.dataset.forgeTheme);
    console.log('[push-79] dataset.forgeTheme =', datasetTheme);
    expect(datasetTheme).toBe('sepia');

    const lsRaw = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.theme'));
    console.log('[push-79] localStorage forge.v4.theme =', lsRaw);
    expect(lsRaw).toBe(JSON.stringify('sepia'));

    const after = await readEvents();
    console.log('[push-79] bus events =', after);
    expect(after.length).toBeGreaterThan(beforeCount);
    expect(after[after.length - 1].theme).toBe('sepia');

    const activeChip = page.locator('[data-testid="forge-theme-switcher-active"]');
    expect(await activeChip.getAttribute('data-theme-id')).toBe('sepia');

    const rowDark  = page.locator('[data-testid="forge-theme-switcher-row-dark"]');
    const rowSepia = page.locator('[data-testid="forge-theme-switcher-row-sepia"]');
    expect(await rowDark.getAttribute('data-checked')).toBe('false');
    expect(await rowSepia.getAttribute('data-checked')).toBe('true');
});

test('03 — click High Contrast → assert, then return to Dark', async () => {
    await cameraTo('right');

    await page.locator('[data-testid="forge-theme-switcher-radio-high-contrast"]').check();
    await pause(350);
    await shot('hc-selected');

    let datasetTheme = await page.evaluate(() =>
        document.documentElement.dataset.forgeTheme);
    let lsRaw = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.theme'));
    expect(datasetTheme).toBe('high-contrast');
    expect(lsRaw).toBe(JSON.stringify('high-contrast'));

    let events = await readEvents();
    expect(events[events.length - 1].theme).toBe('high-contrast');

    await page.locator('[data-testid="forge-theme-switcher-radio-dark"]').check();
    await pause(350);
    await shot('back-to-dark');

    datasetTheme = await page.evaluate(() =>
        document.documentElement.dataset.forgeTheme);
    lsRaw = await page.evaluate(() =>
        window.localStorage.getItem('forge.v4.theme'));
    expect(datasetTheme).toBe('dark');
    expect(lsRaw).toBe(JSON.stringify('dark'));

    events = await readEvents();
    expect(events[events.length - 1].theme).toBe('dark');
});

test('04 — push-65 regression: Section Plane panel still opens alongside', async () => {
    await cameraTo('iso');

    await page.evaluate(() => {
        const f = window.forge;
        if (!f || typeof f.makeBox !== 'function') return;
        const h = f.makeBox(20, 20, 20);
        if (typeof h === 'number') {
            window.__forgeAppendBody({
                id: 'f-box-79-regress', kind: 'native', handle: h,
                toolId: 'solid.box', name: 'Box 20x20x20',
                params: { width: 20, height: 20, distance: 20 },
            });
        }
    });
    await pause(400);

    await platformMenuAction('tools.sectionPlane');
    await page.waitForSelector('[data-testid="forge-section-plane-panel"]',
                               { state: 'visible', timeout: 6000 });
    await shot('section-plane-coexists');

    const themeStillThere = await page.locator(
        '[data-testid="forge-theme-switcher-panel"]').count();
    expect(themeStillThere).toBeGreaterThan(0);

    const datasetTheme = await page.evaluate(() =>
        document.documentElement.dataset.forgeTheme);
    expect(datasetTheme).toBe('dark');
});
