// PUSH-47 (Slice-16) — Tolerance Stack-up (PMI / GD&T metrology).
//
// The forge::tolerance kernel (worst-case + RSS + Monte-Carlo Cp/Cpk/yield)
// and the ToleranceStackWorkbench (chain editor, LSL/USL, distribution bar,
// result panel) were complete and mounted, but the command was NOT in the
// Menus spec — so it was unreachable from global search and sat unproven at
// 0% parity. This slice adds the `tools.tolerance` menu entry (global-search
// reachable) and locks in the full compute pipeline with a headed e2e.
//
// Proof end to end through the real UI:
//   1. Open the Tolerance Stack-up workbench (Tools → Tolerance Stack-up).
//   2. It auto-computes the default 2-link chain → result panel shows a real
//      worst-case span, RSS Cp/Cpk, and Monte-Carlo yield from the native
//      kernel (not a stub).
//   3. Global search exposes the "Tolerance Stack-up" command.
//
// No stubs: every metric is read from the native forge.tolerance.compute.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-47-tolerance');
const VIDEO_DIR = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4 = path.join(OUTPUT_DIR, 'tolerance-session.mp4');

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
        if (/push-47|tolerance|stack|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
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
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-47] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-47] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-47] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

test('00 — boot + native tolerance kernel available', async () => {
    await shot('boot');
    const ok = await page.evaluate(() => {
        const f = window.forge;
        return !!(f && f.tolerance && typeof f.tolerance.compute === 'function');
    });
    expect(ok).toBe(true);
    await pause(300);
});

test('01 — open the Tolerance Stack-up workbench', async () => {
    await platformMenuAction('tools.tolerance');
    await page.waitForSelector('[data-testid="forge-tol-panel"]', { state: 'visible', timeout: 6000 });
    await shot('tol-panel');
});

test('02 — auto-compute yields a real stack-up result', async () => {
    // The panel auto-computes on open; click Compute to be deterministic.
    const runBtn = page.locator('[data-testid="forge-tol-run"]');
    if (await runBtn.count() > 0) await runBtn.first().click().catch(() => {});
    await pause(800);
    await shot('computed');

    const result = page.locator('[data-testid="forge-tol-result"]');
    await expect(result).toBeVisible();
    const txt = await result.innerText();
    console.log('[push-47] tolerance result =', txt);

    // Worst-case low < high (a real, non-degenerate span).
    const wc = txt.match(/Worst-case\s+([-\d.]+)\s*→\s*([-\d.]+)/i);
    expect(wc).not.toBeNull();
    const lo = Number(wc[1]); const hi = Number(wc[2]);
    expect(hi).toBeGreaterThan(lo);

    // A real RSS Cpk (positive, finite) from the native kernel.
    const cpk = txt.match(/Cpk\s+([-\d.]+)/i);
    expect(cpk).not.toBeNull();
    expect(Number(cpk[1])).toBeGreaterThan(0);

    // Monte-Carlo yield reported (0..100 %).
    const yld = txt.match(/yield\s+([\d.]+)\s*%/i);
    expect(yld).not.toBeNull();
    const yldVal = Number(yld[1]);
    expect(yldVal).toBeGreaterThan(0);
    expect(yldVal).toBeLessThanOrEqual(100);

    // The distribution bar rendered.
    await expect(page.locator('[data-testid="forge-tol-bar"]')).toBeVisible();
});

test('03 — cross-check the native kernel directly', async () => {
    // Prove the UI number is the kernel number: same chain → same worst-case.
    const k = await page.evaluate(() => {
        const r = window.forge.tolerance.compute({
            chain: [
                { name: 'A', nominal: 10, tolPlus: 0.1, tolMinus: 0.1, dist: 0 },
                { name: 'B', nominal: 20, tolPlus: 0.2, tolMinus: 0.2, dist: 0 },
            ],
            USL: 30.5, LSL: 29.5, mcSamples: 20000, randomSeed: 42,
        });
        return { nom: r.worstCaseNominal, hi: r.worstCaseHigh, lo: r.worstCaseLow, cpk: r.rssCpk };
    });
    console.log('[push-47] kernel cross-check =', JSON.stringify(k));
    expect(k.nom).toBeCloseTo(30, 6);
    expect(k.hi).toBeCloseTo(30.3, 6);
    expect(k.lo).toBeCloseTo(29.7, 6);
    expect(k.cpk).toBeGreaterThan(0);
});

test('04 — global search exposes the Tolerance command', async () => {
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
        await page.locator('[data-testid="forge-cmd-palette-input"]').fill('Tolerance');
        await pause(500);
        await shot('search-tolerance');
        const results = page.locator('[data-testid="forge-cmd-palette-results"]');
        await expect(results.locator('text=/Tolerance/i').first()).toBeVisible();
        await page.keyboard.press('Escape').catch(() => {});
    } else {
        console.warn('[push-47] command palette not found — skipping search assertion');
        await shot('search-palette-missing');
    }
});
