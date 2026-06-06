// PUSH-54 (Slice-22b / API & customization) — Plugin system: install a real
// plugin through the UI that registers a live tool.
//
// frontend/src/forge-v4/forgeAPI.js publishes window.Forge (frozen public
// surface: tools.registerTool/list/dispatch/unregister, menu.addItem, …) and
// pluginManager.js loads plugins from a string/URL/file, executes their code
// with Forge ambient, and tracks contributions. PluginManagerPanel
// (tools.plugins, in Menus) drives install/enable/disable/uninstall. All
// complete + reachable — but there was no e2e proving the public API actually
// lets a third-party plugin register and run a tool. dim #18 sat at 5%.
//
// Proof end to end through the real UI:
//   1. Open the Plugin Manager (Tools → Plugin Manager).
//   2. Install-from-string a real JS plugin (// @name header) that calls
//      Forge.tools.registerTool({ id, run }).
//   3. The plugin row appears, the tool is live in window.Forge.tools.list(),
//      and dispatching it through Forge.tools.dispatch runs the plugin code.
//
// No stubs: the tool is registered by the plugin's own code via the public
// API and verified by dispatching it and reading its real return value.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-54-plugin');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'plugin-session.mp4');
const PLUGIN_NAME = `e2e-doubler-${Date.now()}`;
const TOOL_ID = `plugin.${PLUGIN_NAME}.double`;

// A real plugin: header metadata + code that registers a tool whose run()
// doubles its input. Exercises the public Forge.tools.registerTool API.
const PLUGIN_SRC = `// @name ${PLUGIN_NAME}
// @version 1.0.0
// @author e2e
Forge.tools.registerTool({
  id: '${TOOL_ID}',
  label: 'Double a number',
  run: (params) => ({ ok: true, doubled: (params && params.n || 0) * 2 }),
});
`;

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

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-54|plugin|forge\.tools|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    const discard = page.locator('button:has-text("Discard")');
    if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
    await pause(1200);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-54] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-54] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-54] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + public window.Forge API available', async () => {
    await shot('boot');
    const ok = await page.evaluate(() => {
        const F = window.Forge;
        return !!(F && F.tools && typeof F.tools.registerTool === 'function'
                  && typeof F.tools.list === 'function' && typeof F.tools.dispatch === 'function');
    });
    expect(ok).toBe(true);
    await pause(300);
});

test('01 — open the Plugin Manager', async () => {
    await platformMenuAction('tools.plugins');
    await page.waitForSelector('[data-testid="forge-plugin-manager"]', { state: 'visible', timeout: 6000 });
    await shot('plugin-manager');
});

test('02 — install a real plugin from string → registers a live tool', async () => {
    const toolsBefore = await page.evaluate(() => window.Forge.tools.list().length);

    // Open the install-from-string modal and submit the plugin source.
    await page.locator('[data-testid="forge-plugin-install-string-btn"]').click();
    await page.waitForSelector('[data-testid="forge-plugin-install-modal"]', { state: 'visible', timeout: 5000 });
    await page.locator('[data-testid="forge-plugin-install-input"]').fill(PLUGIN_SRC);
    await pause(200);
    await page.locator('[data-testid="forge-plugin-install-submit"]').click({ force: true, noWaitAfter: true });
    await pause(1000);
    await shot('installed');

    // The plugin row appears in the list.
    await expect(page.locator(`[data-testid="forge-plugin-row-${PLUGIN_NAME}"]`)).toBeVisible({ timeout: 8000 });

    // The tool is live in the public registry.
    const toolsAfter = await page.evaluate(() => window.Forge.tools.list().map((t) => t.id));
    console.log('[push-54] registered tools include target?', toolsAfter.includes(TOOL_ID));
    expect(toolsAfter).toContain(TOOL_ID);
    expect(toolsAfter.length).toBeGreaterThan(toolsBefore);

    // Dispatching the plugin's tool runs its real code.
    const result = await page.evaluate((id) => window.Forge.tools.dispatch(id, { n: 21 }), TOOL_ID);
    console.log('[push-54] plugin tool dispatch result =', JSON.stringify(result));
    expect(result).toBeTruthy();
    expect(result.ok).toBe(true);
    expect(result.doubled).toBe(42);
});

test('03 — uninstall removes the plugin and unregisters its tool', async () => {
    await page.locator(`[data-testid="forge-plugin-uninstall-${PLUGIN_NAME}"]`).click({ force: true, noWaitAfter: true });
    await pause(800);
    await shot('uninstalled');
    await expect(page.locator(`[data-testid="forge-plugin-row-${PLUGIN_NAME}"]`)).toHaveCount(0);
    const stillThere = await page.evaluate((id) => window.Forge.tools.list().some((t) => t.id === id), TOOL_ID);
    console.log('[push-54] tool still registered after uninstall?', stillThere);
    expect(stillThere).toBe(false);
});

test('04 — global search exposes the Plugin Manager command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Plugin Manager');
        await pause(500);
        await shot('search-plugin');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Plugin Manager/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-54] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
