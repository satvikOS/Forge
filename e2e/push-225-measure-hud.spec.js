// PUSH-225 (Task #21) — measure-on-selection HUD (CATIA "Measure Between"
// / NX quick-measure). Headed Electron, 5 named camera angles.
//
// Proof end-to-end:
//   1. Boot + dismiss banners.
//   2. Assert window.__forgeMeasureReadout() is installed (pure read API).
//   3. Two vertices (3-4-5) → assert forge-measure-hud-value data-metric=
//      distance + value≈5.
//   4. Two faces with normals → angle 90°.
//   5. Single edge with length → length readout.
//   6. Clear selection → empty path anchor present.
//
// Multi-cam: iso / front / top / right / iso.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-225-measure-hud');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'measure-hud-session.mp4');

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
// Publish a selection on the canonical bus (the real path the viewport
// picker uses), and seed window.__forgeBodies so names resolve.
async function setSelection(sel, bodies) {
  await page.evaluate(({ s, b }) => {
    if (b) window.__forgeBodies = b;
    window.__forgeSelection = s;
    window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: s }));
  }, { s: sel, b: bodies });
  await pause(280);
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
  if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-225] no .webm'); return; }
  try { fs.unlinkSync(FINAL_MP4); } catch {}
  const ffmpegBin = require('ffmpeg-static');
  await new Promise((resolve) => {
    const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-225] mp4 written: ${FINAL_MP4}`);
      else console.error('[push-225] ffmpeg failed:', code, err.split('\n').slice(-4).join('\n'));
      resolve();
    });
  });
});

const BODIES = [{ handle: 1, name: 'BlockA' }, { handle: 2, name: 'BlockB' }];

test('00 — pure read API installed', async () => {
  await cameraTo('iso');
  await shot('boot');
  const apiOk = await page.evaluate(() => typeof window.__forgeMeasureReadout === 'function');
  expect(apiOk).toBe(true);
});

test('01 — two vertices → distance readout', async () => {
  await cameraTo('front');
  await setSelection({ kind: 'vertex', items: [
    { kind: 'vertex', handle: 1, point: [0, 0, 0] },
    { kind: 'vertex', handle: 2, point: [3, 4, 0] },
  ] }, BODIES);
  await shot('distance');

  const val = page.locator('[data-testid="forge-measure-hud-value"]');
  await expect(val).toBeVisible();
  expect(await val.getAttribute('data-metric')).toBe('distance');
  const num = Number(await val.getAttribute('data-value'));
  expect(Math.abs(num - 5)).toBeLessThan(1e-6);

  // The pure read API agrees with the rendered HUD.
  const r = await page.evaluate(() => window.__forgeMeasureReadout());
  expect(r.metric).toBe('distance');
  expect(Math.abs(r.value - 5)).toBeLessThan(1e-6);
});

test('02 — two faces with normals → angle readout', async () => {
  await cameraTo('top');
  await setSelection({ kind: 'face', items: [
    { kind: 'face', handle: 1, normal: [1, 0, 0] },
    { kind: 'face', handle: 2, normal: [0, 1, 0] },
  ] }, BODIES);
  await shot('angle');

  const val = page.locator('[data-testid="forge-measure-hud-value"]');
  expect(await val.getAttribute('data-metric')).toBe('angle');
  const num = Number(await val.getAttribute('data-value'));
  expect(Math.abs(num - 90)).toBeLessThan(1e-3);
});

test('03 — single edge with length → length readout', async () => {
  await cameraTo('right');
  await setSelection({ kind: 'edge', items: [
    { kind: 'edge', handle: 1, length: 17.25 },
  ] }, BODIES);
  await shot('length');

  const val = page.locator('[data-testid="forge-measure-hud-value"]');
  expect(await val.getAttribute('data-metric')).toBe('length');
  const num = Number(await val.getAttribute('data-value'));
  expect(Math.abs(num - 17.25)).toBeLessThan(1e-6);
});

test('04 — clear selection → empty anchor', async () => {
  await cameraTo('iso');
  await setSelection({ kind: 'none', ids: [] }, BODIES);
  await shot('empty');
  await expect(page.locator('[data-testid="forge-measure-hud-empty"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="forge-measure-hud-value"]')).toHaveCount(0);
  await shot('final');
});
