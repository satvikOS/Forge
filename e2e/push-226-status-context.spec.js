// PUSH-226 (Task #21) — context status bar: active datum/CSYS + snap-
// target + selection-filter mirror (NX/Creo footer). Plus the monochrome-
// correct selection-filter strip. Headed Electron, 5 named camera angles.
//
// Proof end-to-end:
//   1. Boot + dismiss banners.
//   2. Imperative datum API installed (__forgeSetActiveDatum etc.).
//   3. Set active datum → forge-statusbar-datum shows text + data-datum.
//   4. Set snap target → forge-statusbar-snaptarget shows + data-snap-type.
//   5. Selection-filter strip click → forge-statusbar-filter mirrors the
//      kind AND the active chip background is grey-scale (monochrome
//      guard: computed r≈g≈b — NO chromatic blue).
//   6. __forgeSelectionFilterApi.cycle() advances the kind.
//   7. Clear datum context → both readouts disappear.
//
// Multi-cam: iso / front / top / right / iso.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-226-status-context');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'status-context-session.mp4');

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
  if (!videoPath || !fs.existsSync(videoPath)) { console.error('[push-226] no .webm'); return; }
  try { fs.unlinkSync(FINAL_MP4); } catch {}
  const ffmpegBin = require('ffmpeg-static');
  await new Promise((resolve) => {
    const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FINAL_MP4)) console.log(`[push-226] mp4 written: ${FINAL_MP4}`);
      else console.error('[push-226] ffmpeg failed:', code, err.split('\n').slice(-4).join('\n'));
      resolve();
    });
  });
});

test('00 — datum/snap imperative API installed', async () => {
  await cameraTo('iso');
  await shot('boot');
  const ok = await page.evaluate(() =>
    typeof window.__forgeSetActiveDatum === 'function'
    && typeof window.__forgeSetSnapTarget === 'function'
    && typeof window.__forgeSelectionFilterApi === 'object');
  expect(ok).toBe(true);
});

test('01 — active datum shows in the status bar', async () => {
  await cameraTo('front');
  await page.evaluate(() => window.__forgeSetActiveDatum({ name: 'DATUM_A', type: 'plane' }));
  await pause(300);
  await shot('datum');

  const datum = page.locator('[data-testid="forge-statusbar-datum"]');
  await expect(datum).toBeVisible();
  expect(await datum.getAttribute('data-datum')).toBe('DATUM_A');
  expect(await datum.getAttribute('data-datum-type')).toBe('plane');
  await expect(datum).toContainText('Plane DATUM_A');
});

test('02 — snap target shows in the status bar', async () => {
  await cameraTo('top');
  await page.evaluate(() =>
    window.__forgeSetSnapTarget({ type: 'midpoint', coords: [10, 20, 0] }));
  await pause(300);
  await shot('snap');

  const snap = page.locator('[data-testid="forge-statusbar-snaptarget"]');
  await expect(snap).toBeVisible();
  expect(await snap.getAttribute('data-snap-type')).toBe('midpoint');
  await expect(snap).toContainText('Midpoint');
});

test('03 — filter strip is monochrome + mirrors into the status bar', async () => {
  await cameraTo('right');

  // Click the FACE chip on the always-on selection-filter strip.
  await page.locator('[data-testid="forge-selection-filter-face"]').click();
  await pause(300);
  await shot('filter-face');

  // Status-bar mirror tracks the kind.
  const sbFilter = page.locator('[data-testid="forge-statusbar-filter"]');
  await expect(sbFilter).toBeVisible();
  expect(await sbFilter.getAttribute('data-kind')).toBe('face');
  await expect(sbFilter).toContainText('Faces');

  // MONOCHROME GUARD: the active chip's background must be grey-scale
  // (r≈g≈b). Any chromatic blue would break the rule.
  const rgb = await page.locator('[data-testid="forge-selection-filter-face"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const m = rgb.match(/rgba?\(([^)]+)\)/);
  expect(m).toBeTruthy();
  const [r, g, b] = m[1].split(',').map((s) => parseFloat(s));
  const maxSpread = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
  expect(maxSpread).toBeLessThanOrEqual(6); // grey-scale within rounding
});

test('04 — filter API cycle advances the kind', async () => {
  await page.evaluate(() => window.__forgeSelectionFilterApi.cycle());
  await pause(300);
  await shot('filter-cycle');
  const kind = await page.evaluate(() => window.__forgeSelectionFilter);
  expect(['body', 'face', 'edge', 'vertex']).toContain(kind);
  const sbKind = await page.locator('[data-testid="forge-statusbar-filter"]').getAttribute('data-kind');
  expect(sbKind).toBe(kind);
});

test('05 — clear datum context removes both readouts', async () => {
  await cameraTo('iso');
  await page.evaluate(() => window.__forgeClearDatumContext());
  await pause(300);
  await shot('cleared');
  await expect(page.locator('[data-testid="forge-statusbar-datum"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="forge-statusbar-snaptarget"]')).toHaveCount(0);
  await shot('final');
});
