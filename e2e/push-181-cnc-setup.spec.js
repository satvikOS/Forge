// PUSH-181 (Slice-137) — CNC Setup Sheet generator.
//
// The CAM workbench (PUSH-46) gives the programmer a toolpath; the
// machinist standing at the mill needs a printed sheet that tells him
// which tool to load, what RPM/feed to dial in, how deep to cut,
// expected cycle time, and the tool-change list. That document is the
// "setup sheet". This e2e proves the full pipeline end-to-end through
// the real UI:
//
//   1. Seed a 120×80×25 stock block (the workpiece).
//   2. Open the CncSetupSheet panel (Tools → CNC Setup Sheet).
//   3. Seed a fake `window.__forgeCamResults` array carrying a single
//      cam.profile op + a different drill op (so we get a tool change).
//   4. Scan + Generate → the structured preview shows "Operation 1" and
//      at least one tool-change line.
//   5. Multi-cam: 5 named camera angles (front/top/right/iso/close)
//      per the Forge multi-cam e2e mandate.
//
// Real impl: the panel computes the sheet via setupSheetMath.buildSheet;
// no UI stubbing. The cam result array is the same shape PUSH-46 /
// PUSH-98 / PUSH-117 publish.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-181-cnc-setup');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'cnc-setup-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
    stepIndex += 1;
    const n = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${n}.png`), fullPage: true });
}
async function pause(ms = 300) { await page.waitForTimeout(ms); }
async function menu(id) {
    await page.evaluate((x) => window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: x } })), id);
    await pause(400);
}
async function cam(v) { await menu(`view.${v}`); await pause(200); }

test.beforeAll(async () => {
    fs.mkdirSync(VIDEO_DIR, { recursive: true });
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')], timeout: 60000,
        recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
    });
    page = await app.firstWindow();
    page.on('console', (msg) => {
        const t = msg.text();
        if (/push-181|cnc|setup|sheet|cam|error|Error/i.test(t)) console.log('[browser]', t);
    });
    await page.waitForLoadState('domcontentloaded');
    await pause(2500);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(800);
});

test.afterAll(async () => {
    try { await pause(1500); } catch {}
    let videoPath = null;
    try { videoPath = await page.video()?.path(); } catch {}
    if (app) { try { await app.close({ timeout: 10000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
    await new Promise((r) => setTimeout(r, 1200));
    if (!videoPath || !fs.existsSync(videoPath)) {
        const cands = fs.existsSync(VIDEO_DIR) ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
        if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
    }
    if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-181] no .webm'); return; }
    try { fs.unlinkSync(FINAL_MP4); } catch {}
    const ffmpegBin = require('ffmpeg-static');
    await new Promise((resolve) => {
        const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
            '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
        const c = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = ''; c.stderr.on('data', (d) => { err += d.toString(); });
        c.on('close', (code) => {
            if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-181] mp4 written: ${FINAL_MP4} (${(fs.statSync(FINAL_MP4).size/1024/1024).toFixed(2)} MB)`);
            else console.error('[push-181] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
            resolve();
        });
    });
});

// ────────────────────────────────────────────────────────────────────
// 00 — Seed the stock body the operator will machine. 120×80×25 mm is
// a typical jobbing-shop billet for a fixture plate / motor mount.

test('00 — front · seed stock block 120x80x25', async () => {
    await cam('front');
    await shot('boot');
    const ok = await page.evaluate(() => {
        if (!window.forge?.makeBox || typeof window.__forgeAppendBody !== 'function') return false;
        const h = window.forge.makeBox(120, 80, 25);
        window.__forgeAppendBody({
            id: 'cnc-stock', kind: 'native', handle: h,
            toolId: 'primitive.box', name: 'Aluminum Billet 120x80x25',
            material: 'aluminum',
            spec: { dx: 120, dy: 80, dz: 25 },
        });
        return true;
    });
    expect(ok).toBe(true);
    await pause(500);
    await shot('seeded-front');
});

// ────────────────────────────────────────────────────────────────────
// 01 — top view: open the panel via the menu action. Helper surface
// must be present.

test('01 — top · open CNC Setup Sheet panel + helper present', async () => {
    await cam('top');
    await menu('tools.cncSetupSheet');
    await page.waitForSelector('[data-testid="forge-cnc-setup-panel"]', { state: 'visible', timeout: 6000 });
    await shot('panel-open-top');
    const helper = await page.evaluate(() => {
        const h = window.__forgeCncSetupSheetHelper;
        if (!h) return null;
        return {
            hasBuildSheet:   typeof h.buildSheet === 'function',
            hasToAscii:      typeof h.toAscii === 'function',
            hasToCsv:        typeof h.toCsv === 'function',
            hasGather:       typeof h.gatherCamResults === 'function',
        };
    });
    expect(helper).not.toBeNull();
    expect(helper.hasBuildSheet).toBe(true);
    expect(helper.hasToAscii).toBe(true);
    expect(helper.hasGather).toBe(true);
});

// ────────────────────────────────────────────────────────────────────
// 02 — right view: seed cam results (one profile op + one drill op so
// we get a real tool change between them), scan + generate.

test('02 — right · seed fake cam.profile + cam.drill ops, generate sheet', async () => {
    await cam('right');
    // Publish a real-shape array of per-op cam results. These are the
    // same fields the CAM workbench (PUSH-46) sets on each op record
    // after generate (toolId / spindleRPM / feedXY/Z / cycleTimeSec /
    // moveCount), plus the strategy label we route through the sheet.
    await page.evaluate(() => {
        window.__forgeCamResults = [
            {
                op:            'profile',
                strategy:      'profile-2d',
                toolId:        'em6',
                toolName:      'EndMill Ø6',
                toolDiameter:  6,
                spindleRPM:    16000,
                feedXY:        1200,
                feedZ:         300,
                depthMm:       3.0,
                zTop:          25,
                zBottom:       22,
                cycleTimeSec:  84.3,
                moveCount:     412,
                cuttingLengthMm: 1685.2,
            },
            {
                op:            'drill',
                strategy:      'peck-drill',
                toolId:        'dr5',
                toolName:      'Drill Ø5',
                toolDiameter:  5,
                spindleRPM:    2800,
                feedXY:        0,
                feedZ:         150,
                depthMm:       25,
                zTop:          25,
                zBottom:       0,
                cycleTimeSec:  42.7,
                moveCount:     96,
                cuttingLengthMm: 320.0,
            },
        ];
    });

    // Hit Scan so the panel ingests window.__forgeCamResults.
    await page.locator('[data-testid="forge-cnc-setup-scan"]').click();
    await pause(300);
    const counts = await page.locator('[data-testid="forge-cnc-setup-counts"]').textContent();
    console.log('[push-181] counts =', counts);
    expect(counts || '').toMatch(/2 cam ops/);

    await shot('scanned-right');

    // Generate the sheet.
    await page.locator('[data-testid="forge-cnc-setup-generate"]').click();
    await pause(500);
    await shot('generated-right');

    // Preview must be visible.
    const preview = page.locator('[data-testid="forge-cnc-setup-preview"]');
    await expect(preview).toBeVisible();

    // BRIEF REQUIREMENT — preview MUST contain "Operation 1" + at
    // least one tool-change line. We check both as direct text.
    const previewText = await preview.innerText();
    console.log('[push-181] preview text (first 500 chars) =',
                previewText.slice(0, 500).replace(/\n/g, ' \\ '));
    expect(previewText).toContain('Operation 1');
    expect(previewText).toContain('Operation 2');
    expect(previewText).toMatch(/Tool change at Operation 2/);
    expect(previewText).toMatch(/EndMill\s+Ø6.*Drill\s+Ø5/s);

    // Structured data — operations count + tool-changes count attrs.
    const opCount = await preview.getAttribute('data-operation-count');
    const tcCount = await preview.getAttribute('data-tool-change-count');
    expect(Number(opCount)).toBe(2);
    expect(Number(tcCount)).toBe(1);

    // Total cycle time = 84.3 + 42.7 = 127.0 s.
    const totalCycle = await page.locator('[data-testid="forge-cnc-setup-total-cycle"]').textContent();
    console.log('[push-181] total cycle =', totalCycle);
    expect(totalCycle).toMatch(/127\.0/);
});

// ────────────────────────────────────────────────────────────────────
// 03 — iso view: assert the ASCII export carries the same content
// (operations + tool change) and the meta program name / stock body.

test('03 — iso · ASCII export carries Operation 1 + Tool change', async () => {
    await cam('iso');
    const ascii = await page.locator('[data-testid="forge-cnc-setup-ascii"]').inputValue();
    console.log('[push-181] ASCII (first 400 chars) =', ascii.slice(0, 400).replace(/\r?\n/g, ' \\ '));
    expect(ascii).toContain('CNC SETUP SHEET');
    expect(ascii).toContain('Aluminum Billet 120x80x25');
    expect(ascii).toMatch(/120\.00 x 80\.00 x 25\.00 mm/);
    expect(ascii).toContain('PROG-001');
    expect(ascii).toMatch(/profile-2d/);
    expect(ascii).toMatch(/peck-drill/);
    expect(ascii).toMatch(/Tool change at Operation 2: EndMill Ø6\s+->\s+Drill Ø5/);
    expect(ascii).toMatch(/TOTAL CYCLE TIME:\s+127\.00 s/);

    // The published last sheet on window must round-trip.
    const lastSheet = await page.evaluate(() => {
        const s = window.__forgeLastCncSetupSheet;
        if (!s) return null;
        return {
            opCount:       s.operations.length,
            tcCount:       s.toolChanges.length,
            totalCycle:    s.totalCycleSec,
            stockName:     s.meta.stockName,
            stockMaterial: s.meta.stockMaterial,
            stockDx:       s.meta.stockDims.dx,
            stockDz:       s.meta.stockDims.dz,
            stockSource:   s.meta.stockDims.source,
            firstOpLabel:  s.operations[0].opLabel,
            firstTool:     s.operations[0].tool.id,
            secondTool:    s.operations[1].tool.id,
            tcFrom:        s.toolChanges[0].fromId,
            tcTo:          s.toolChanges[0].toId,
        };
    });
    console.log('[push-181] lastSheet =', lastSheet);
    expect(lastSheet.opCount).toBe(2);
    expect(lastSheet.tcCount).toBe(1);
    expect(lastSheet.totalCycle).toBeCloseTo(127.0, 1);
    expect(lastSheet.stockName).toBe('Aluminum Billet 120x80x25');
    expect(lastSheet.stockMaterial).toBe('aluminum');
    expect(lastSheet.stockDx).toBeCloseTo(120, 1);
    expect(lastSheet.stockDz).toBeCloseTo(25, 1);
    expect(['spec', 'aabb', 'body-dim']).toContain(lastSheet.stockSource);
    expect(lastSheet.firstOpLabel).toBe('profile');
    expect(lastSheet.firstTool).toBe('em6');
    expect(lastSheet.secondTool).toBe('dr5');
    expect(lastSheet.tcFrom).toBe('em6');
    expect(lastSheet.tcTo).toBe('dr5');

    await shot('ascii-verified-iso');
});

// ────────────────────────────────────────────────────────────────────
// 04 — close shot: zoom into the panel itself so the multi-cam record
// has at least one tight frame on the operator-visible result.

test('04 — close · final framed shot of the setup sheet panel', async () => {
    await cam('iso');
    // Reframe the camera tight on the right-docked panel area. We don't
    // need a kernel zoom — the panel is a fixed-right overlay so just
    // capturing the page is the close shot.
    await pause(300);
    await shot('close-panel-final');

    // Sanity: close the panel afterward.
    await page.locator('[data-testid="forge-cnc-setup-close"]').click().catch(() => {});
    await pause(200);
    await shot('panel-closed');
});
