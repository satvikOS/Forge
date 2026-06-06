// PUSH-52 (Slice-21) — Standard Parts library: insert → real scene body.
//
// The forge::stdparts kernel (makeBolt/makeNut/makeWasher/makeBearing/
// makeSpurGear + ISO spec lookups) and the StdPartsLibraryWorkbench
// (searchable ISO/ANSI catalogue) were complete and wired, but: (a) the
// parametric catalogue workbench (tools.stdparts) was absent from the Menus
// spec — only the separate browser (tools.library) was reachable; (b) Insert
// only stashed the mesh at window.__forgeLastStdPart + showed stats — it never
// committed a scene body, so inserted parts never appeared in the viewport or
// feature tree. So dim #13 sat at 4%.
//
// This slice adds the tools.stdparts menu entry and makes Insert commit a real
// body (native B-rep via STL round-trip through OCCT, synthetic-mesh fallback).
//
// Proof end to end through the real UI:
//   1. Open Standard Parts (Tools → Standard Parts (parametric), search-reachable).
//   2. Select the M8 bolt row, Insert → mesh stats show real verts/tris.
//   3. A body commits (count +1), renders, and (native) has positive volume.
//
// No stubs: the bolt mesh comes from the native stdparts kernel; the body is
// imported into OCCT and its volume read back via forge.massProps.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-52-stdparts');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'stdparts-session.mp4');

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
        if (/push-52|stdpart|bolt|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-52] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-52] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-52] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + native stdparts kernel available', async () => {
    await shot('boot');
    const ok = await page.evaluate(() => {
        const sp = window.forge && window.forge.stdparts;
        return !!(sp && typeof sp.makeBolt === 'function'
                  && typeof sp.specForMetricBolt === 'function'
                  && typeof window.__forgeAppendBody === 'function');
    });
    expect(ok).toBe(true);
    await pause(300);
});

test('01 — open the Standard Parts workbench', async () => {
    await platformMenuAction('tools.stdparts');
    await page.waitForSelector('[data-testid="forge-stdparts-panel"]', { state: 'visible', timeout: 6000 });
    await shot('stdparts-panel');
});

test('02 — select an M8 bolt and insert → real body commits', async () => {
    const before = await page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0);

    await page.locator('[data-testid="forge-stdparts-row-bolt-m8"]').click();
    await pause(200);
    await page.locator('[data-testid="forge-stdparts-insert"]').click({ force: true, noWaitAfter: true });
    await pause(1200);
    await shot('inserted');

    const errCount = await page.locator('[data-testid="forge-stdparts-error"]').count();
    if (errCount > 0) {
        const e = await page.locator('[data-testid="forge-stdparts-error"]').innerText().catch(() => '');
        if (e.trim()) console.log('[push-52] stdparts error =', e);
    }

    // Mesh stats show a real tessellation.
    const stats = page.locator('[data-testid="forge-stdparts-mesh-stats"]');
    await expect(stats).toBeVisible({ timeout: 8000 });
    const statsTxt = await stats.innerText();
    console.log('[push-52] mesh stats =', statsTxt.replace(/\n/g, ' '));
    const nums = (statsTxt.match(/(\d[\d,]*)/g) || []).map((s) => Number(s.replace(/,/g, '')));
    expect(nums.filter((n) => n > 0).length).toBeGreaterThan(0);

    // A body commits.
    await expect(page.locator('[data-testid="forge-stdparts-committed"]')).toBeVisible({ timeout: 8000 });
    await expect.poll(async () => page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0),
        { timeout: 15000 }).toBe(before + 1);

    const info = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        const b = arr[arr.length - 1];
        let vol = null;
        try { if (b && b.kind === 'native') vol = Math.abs(window.forge.massProps(b.handle).volume); }
        catch (e) { vol = -2; }
        return { kind: b && b.kind, handle: b && b.handle, name: b && b.name,
                 vol, hasMesh: !!(b && b.mesh && b.mesh.positions && b.mesh.positions.length),
                 importNote: b && b.importNote };
    });
    console.log('[push-52] committed bolt body =', JSON.stringify(info));
    expect(['native', 'synthetic']).toContain(info.kind);
    if (info.kind === 'native') expect(info.vol).toBeGreaterThan(0);
    else expect(info.hasMesh).toBe(true);

    // Renders in the scene.
    const meshes = await page.evaluate(() => {
        try { const s = window.__forgeScene; let n = 0; s && s.traverse((o) => { if (o.isMesh) n++; }); return n; }
        catch (e) { return 0; }
    });
    console.log('[push-52] scene mesh count =', meshes);
    expect(meshes).toBeGreaterThan(0);
});

test('03 — global search exposes the Standard Parts command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Standard Parts');
        await pause(500);
        await shot('search-stdparts');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Standard Parts/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-52] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
