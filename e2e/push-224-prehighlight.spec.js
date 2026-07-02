// PUSH-224 (Task #21) — sub-entity PRE-HIGHLIGHT + QuickPick (NX/CATIA
// "preselect"). Headed Electron, 5 named camera angles.
//
// Proof end-to-end:
//   1. Boot Electron, dismiss first-run banners + onboarding tour.
//   2. Assert window.__forgePreHighlight is installed (imperative API).
//   3. Pre-highlight a FACE via the API → assert forge-prehighlight-overlay
//      is visible with data-kind=face + data-subidx mirrors.
//   4. Move the pre-highlight to an EDGE → overlay follows (data-kind=edge).
//   5. QuickPick: open a 2-candidate stack via window.__forgeOpenQuickPick
//      → assert forge-quickpick + two forge-quickpick-item-N render; click
//      one and assert the canonical selection bus fired.
//   6. Clear → overlay gone.
//
// Multi-cam (Forge-171 mandate): iso / front / top / right / iso.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-224-prehighlight');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'prehighlight-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
  stepIndex += 1;
  const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }
async function cameraTo(viewName) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
  }, `view.${viewName}`);
  await pause(220);
}

test.beforeAll(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  app = await electron.launch({
    args: [path.resolve(__dirname, '..')], timeout: 60000,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await pause(3000);
  const setBtn = page.locator('button:has-text("Set")');
  if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {} });
  const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
  if (await tourSkip.count() > 0) await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
  await pause(800);
});

test.afterAll(async () => {
  try { await pause(1500); } catch {}
  let videoPath = null;
  try { videoPath = await page.video()?.path(); } catch {}
  if (app) {
    try { await app.close({ timeout: 10000 }); }
    catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
  }
  await new Promise((r) => setTimeout(r, 1200));
  if (!videoPath || !fs.existsSync(videoPath)) {
    const cands = fs.existsSync(VIDEO_DIR)
      ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm')) : [];
    if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
  }
  if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-224] no .webm'); return; }
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
        console.log(`[push-224] mp4 written: ${FINAL_MP4}`);
      } else { console.error('[push-224] ffmpeg failed:', code, err.split('\n').slice(-4).join('\n')); }
      resolve();
    });
  });
});

test('00 — imperative pre-highlight API installed + face overlay', async () => {
  await cameraTo('iso');
  await shot('boot');

  const apiOk = await page.evaluate(() => typeof window.__forgePreHighlight === 'function');
  expect(apiOk).toBe(true);

  await page.evaluate(() => {
    window.__forgePreHighlight({ kind: 'face', handle: 1, subIdx: 2, name: 'TopPlate' });
  });
  await pause(300);
  await shot('face-prehighlight');

  const overlay = page.locator('[data-testid="forge-prehighlight-overlay"]');
  await expect(overlay).toBeVisible();
  expect(await overlay.getAttribute('data-kind')).toBe('face');
  expect(await overlay.getAttribute('data-subidx')).toBe('2');
});

test('01 — overlay follows to an EDGE pre-highlight', async () => {
  await cameraTo('front');
  await page.evaluate(() => {
    window.__forgePreHighlight({ kind: 'edge', handle: 1, edgeIdx: 5, name: 'TopPlate' });
  });
  await pause(300);
  await shot('edge-prehighlight');

  const overlay = page.locator('[data-testid="forge-prehighlight-overlay"]');
  await expect(overlay).toBeVisible();
  expect(await overlay.getAttribute('data-kind')).toBe('edge');
  expect(await overlay.getAttribute('data-subidx')).toBe('5');
});

test('02 — QuickPick disambiguation stack renders + commits a selection', async () => {
  await cameraTo('top');

  // Capture the canonical selection bus.
  await page.evaluate(() => {
    window.__push224Sel = [];
    window.addEventListener('forge:selection-changed', (e) => {
      window.__push224Sel.push(e?.detail || null);
    });
    window.__forgeOpenQuickPick(
      [
        { kind: 'face', handle: 1, subIdx: 0, name: 'A' },
        { kind: 'edge', handle: 1, subIdx: 3, name: 'A' },
      ],
      { x: 700, y: 400 },
    );
  });
  await pause(300);
  await shot('quickpick-open');

  const qp = page.locator('[data-testid="forge-quickpick"]');
  await expect(qp).toBeVisible();
  await expect(page.locator('[data-testid="forge-quickpick-item-0"]')).toBeVisible();
  await expect(page.locator('[data-testid="forge-quickpick-item-1"]')).toBeVisible();

  await page.locator('[data-testid="forge-quickpick-item-1"]').click();
  await pause(300);
  await shot('quickpick-committed');

  const fired = await page.evaluate(() => window.__push224Sel || []);
  expect(fired.length).toBeGreaterThan(0);
  expect(fired[fired.length - 1].kind).toBe('edge');
});

test('03 — clear removes the overlay', async () => {
  await cameraTo('right');
  await page.evaluate(() => window.__forgeClearPreHighlight());
  await pause(300);
  await shot('cleared');
  await expect(page.locator('[data-testid="forge-prehighlight-overlay"]')).toHaveCount(0);
  await cameraTo('iso');
  await shot('final');
});
