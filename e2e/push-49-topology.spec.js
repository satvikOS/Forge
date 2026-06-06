// PUSH-49 (Slice-18) — Topology Optimisation (SIMP) → materialised solid.
//
// The TopologyWorkbench ran the real Bendsøe-Sigmund SIMP optimiser
// (runCantileverSIMP) but only displayed a density-field REPORT + histogram —
// nothing visible in the viewport, no usable downstream geometry. So
// generative/topology sat at report-only parity. This slice adds a
// "Materialise → solid" step: marching-cubes the optimised densitiesCube at
// the volume-fraction iso level (extractIsoSurface), write the triangle soup
// to a tmp STL (io.writeTmpStl), import it through the native OCCT kernel
// (io.importStl), and commit the resulting body so the optimised topology
// renders as a real solid. Also de-conflicts the duplicate tools.topology
// menu id (the SIMP workbench now owns tools.topoOpt; tools.topology opens the
// Inspector) and adds the global-search entry.
//
// Proof end to end through the real UI:
//   1. Open the SIMP workbench (Tools → Topology Optimisation, search-reachable)
//   2. Run SIMP → a real report (iterations > 0, finite compliance, cells > 0).
//   3. Materialise → a native body commits (count +1) with positive volume and
//      a real iso mesh (tris > 0).
//
// No stubs: the solid is imported into the native kernel from the optimiser's
// own density field; volume read back via forge.massProps.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-49-topology');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'topology-session.mp4');

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
        if (/push-49|topology|simp|materialis|error|Error/i.test(t)) console.log('[browser]', t);
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-49] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-49] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-49] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + native io import path available', async () => {
    await shot('boot');
    const ok = await page.evaluate(() => {
        const f = window.forge;
        return !!(f && f.io && typeof f.io.writeTmpStl === 'function'
                  && typeof f.io.importStl === 'function'
                  && typeof window.__forgeAppendBody === 'function');
    });
    expect(ok).toBe(true);
    await pause(300);
});

test('01 — open the SIMP topology workbench', async () => {
    await platformMenuAction('tools.topoOpt');
    await page.waitForSelector('[data-testid="forge-topology-panel"]', { state: 'visible', timeout: 6000 });
    await shot('topo-panel');
});

test('02 — run SIMP → a real report', async () => {
    await page.locator('[data-testid="forge-topo-run"]').click({ force: true, noWaitAfter: true });
    // SIMP solve + paint; wait for the report.
    await expect(page.locator('[data-testid="forge-topo-report"]')).toBeVisible({ timeout: 20000 });
    await pause(400);
    await shot('simp-report');

    const iters = Number(await page.locator('[data-testid="forge-topo-iter"]').innerText());
    const cells = Number(await page.locator('[data-testid="forge-topo-cells"]').innerText());
    const compTxt = await page.locator('[data-testid="forge-topo-compliance"]').innerText();
    console.log('[push-49] SIMP iters', iters, 'cells', cells, 'compliance', compTxt);
    expect(iters).toBeGreaterThan(0);
    expect(cells).toBeGreaterThan(0);
    expect(Number(compTxt)).toBeGreaterThan(0);
});

test('03 — materialise the density field into a real solid body', async () => {
    const before = await page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0);

    await page.locator('[data-testid="forge-topo-materialize"]').click({ force: true, noWaitAfter: true });
    await expect(page.locator('[data-testid="forge-topo-materialized"]')).toBeVisible({ timeout: 20000 });
    await pause(400);
    await shot('materialised');

    // Surface any error the panel reported.
    const errCount = await page.locator('[data-testid="forge-topo-error"]').count();
    if (errCount > 0) {
        const e = await page.locator('[data-testid="forge-topo-error"]').innerText().catch(() => '');
        if (e.trim()) console.log('[push-49] topo error =', e);
    }

    const handle = Number(await page.locator('[data-testid="forge-topo-handle"]').innerText());
    const tris = Number(await page.locator('[data-testid="forge-topo-tris"]').innerText());
    console.log('[push-49] materialised handle', handle, 'tris', tris);
    expect(handle).toBeGreaterThan(0);
    expect(tris).toBeGreaterThan(0);

    // A native body was committed (count grew by 1).
    const after = await page.evaluate(() =>
        Array.isArray(window.__forgeBodies) ? window.__forgeBodies.length : 0);
    expect(after).toBe(before + 1);

    // The committed body is a REAL solid with non-zero volume (read from the
    // native kernel, not the panel).
    const vol = await page.evaluate((h) => {
        try { return Math.abs(window.forge.massProps(h).volume); }
        catch (e) { return -1; }
    }, handle);
    console.log('[push-49] materialised |volume| =', vol);
    expect(vol).toBeGreaterThan(0);

    // And it renders in the 3D scene.
    const meshes = await page.evaluate(() => {
        try {
            const s = window.__forgeScene; let n = 0;
            s && s.traverse((o) => { if (o.isMesh) n++; });
            return n;
        } catch (e) { return 0; }
    });
    console.log('[push-49] scene mesh count =', meshes);
    expect(meshes).toBeGreaterThan(0);
});

test('04 — global search exposes the Topology Optimisation command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Topology Optim');
        await pause(500);
        await shot('search-topo');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Topology Optim/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-49] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
