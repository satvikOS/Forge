// v4-video-mp4.spec.js — Forge-112 headed verification of the ffmpeg-
// backed WebM → H.264 MP4 transcode pipeline.
//
// Flow:
//   01 launch headed Electron, confirm window.__forgeRecord exists
//   02 start recording, wait 2 s, stop → assert the offer chip surfaces
//   03 capture the saved-blob from the forge:capture-saved event so we
//      can transcode it directly (the chip in the UI also works, but we
//      drive the bridge via page.evaluate so the test is deterministic)
//   04 write the blob to /tmp/forge-record-<ts>.webm via writeBlob
//   05 call window.forge.video.transcodeWebmToMp4(srcPath)
//   06 assert the resulting .mp4 exists on disk, is >0 bytes, and has the
//      ISO/MP4 ftyp signature (bytes [4..8] = 'ftyp' = 0x66 0x74 0x79 0x70)
//
// Manual button clicks must NOT post to Archie's thread — this spec
// runs the HUD cold (no Archie input).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-video-mp4';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · MP4 transcode (Forge-112) headed', () => {
  let app, page;
  // Single canonical srcPath/mp4Path for the run so the assertions can
  // verify the files on disk after the bridge returns.
  const TS = Date.now();
  const SRC_PATH = `/tmp/forge-record-${TS}.webm`;
  const MP4_PATH = `/tmp/forge-record-${TS}.mp4`;

  test.beforeAll(async () => {
    // Wipe any stale artefacts so a previous-run file can't make a broken
    // transcode silently pass.
    try { fs.unlinkSync(SRC_PATH); } catch {}
    try { fs.unlinkSync(MP4_PATH); } catch {}

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 window.__forgeRecord + window.forge.video bridge are mounted', async () => {
    await shot(page, 'initial');
    const probe = await page.evaluate(() => ({
      hasRecord:        typeof window.__forgeRecord === 'function',
      hasForge:         !!window.forge,
      hasVideoBridge:   !!(window.forge && window.forge.video
                          && typeof window.forge.video.transcodeWebmToMp4 === 'function'),
      hasWriteBlob:     !!(window.forge && window.forge.dialog
                          && typeof window.forge.dialog.writeBlob === 'function'),
    }));
    expect(probe.hasRecord,      'window.__forgeRecord').toBe(true);
    expect(probe.hasVideoBridge, 'window.forge.video.transcodeWebmToMp4').toBe(true);
    expect(probe.hasWriteBlob,   'window.forge.dialog.writeBlob').toBe(true);
  });

  test('02 record 2 s of viewport canvas, expose blob globally', async () => {
    // Subscribe to the forge:capture-saved event from inside the page so
    // we can grab the blob as soon as the HUD finishes its stop pipeline.
    await page.evaluate(() => {
      window.__forge112_blob = null;
      window.__forge112_filename = null;
      window.addEventListener('forge:capture-saved', (e) => {
        if (e && e.detail && e.detail.blob) {
          window.__forge112_blob = e.detail.blob;
          window.__forge112_filename = e.detail.filename;
        }
      }, { once: true });
    });

    // Start recording.
    const started = await page.evaluate(() => window.__forgeRecord(true));
    expect(typeof started).toBe('boolean');
    await shot(page, 'recording-started');

    // 2 s of capture so the WebM has actual frames to muxs.
    await page.waitForTimeout(2200);

    // Stop. The HUD will trigger the .webm download (we ignore that —
    // browser download anchors are a no-op in headed Electron tests),
    // then surface the MP4 offer chip.
    await page.evaluate(() => window.__forgeRecord(false));
    // Give the MediaRecorder's onstop a beat to dispatch the saved event.
    await page.waitForTimeout(800);

    const captured = await page.evaluate(() => ({
      hasBlob: !!window.__forge112_blob,
      bytes:   window.__forge112_blob ? window.__forge112_blob.size : 0,
      type:    window.__forge112_blob ? window.__forge112_blob.type : null,
      filename: window.__forge112_filename,
    }));
    expect(captured.hasBlob,        'forge:capture-saved should emit a blob').toBe(true);
    expect(captured.bytes,          '.webm blob should be non-empty').toBeGreaterThan(1024);
    expect(captured.type || '',     '.webm MIME').toMatch(/^video\/webm/);
    await shot(page, 'after-stop');
  });

  test('03 MP4 offer chip is visible after a successful recording', async () => {
    // The HUD only shows the chip when the preload bridge is present — in
    // headed Electron with our updated preload, it must be.
    const chip = page.locator('[data-testid="forge-video-mp4-offer"]');
    await expect(chip).toBeVisible({ timeout: 3000 });
    await shot(page, 'mp4-offer-visible');
  });

  test('04 write .webm to /tmp via writeBlob bridge', async () => {
    const wrote = await page.evaluate(async (target) => {
      const blob = window.__forge112_blob;
      if (!blob) return { ok: false, error: 'no blob in scope' };
      const buf = new Uint8Array(await blob.arrayBuffer());
      return await window.forge.dialog.writeBlob(target, buf);
    }, SRC_PATH);
    expect(wrote.ok, `writeBlob: ${wrote.error || ''}`).toBe(true);
    expect(fs.existsSync(SRC_PATH), `${SRC_PATH} should exist on disk`).toBe(true);
    const bytes = fs.statSync(SRC_PATH).size;
    expect(bytes, '.webm bytes on disk').toBeGreaterThan(1024);
  });

  test('05 call window.forge.video.transcodeWebmToMp4 via page.evaluate', async () => {
    const res = await page.evaluate(async (src) => {
      return await window.forge.video.transcodeWebmToMp4(src);
    }, SRC_PATH);
    // If ffmpeg-static is missing or fails, dump the real error so the
    // operator can debug rather than guessing.
    expect(res, 'transcode result should be an object').toBeTruthy();
    expect(res.ok, `ffmpeg transcode error: ${res && res.error}`).toBe(true);
    expect(res.mp4Path, 'mp4Path returned').toBe(MP4_PATH);
    expect(typeof res.durationMs).toBe('number');
    expect(res.durationMs).toBeGreaterThan(0);
    await shot(page, 'after-transcode');
  });

  test('06 .mp4 exists on disk and has the ftyp signature', async () => {
    // The handler writes the file synchronously before resolving, but
    // give the FS a beat anyway in case macOS is caching.
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(MP4_PATH)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(MP4_PATH), `${MP4_PATH} should exist`).toBe(true);

    const buf = fs.readFileSync(MP4_PATH);
    expect(buf.length, 'mp4 file must be non-empty').toBeGreaterThan(256);

    // ISO base media file format: the first box is always 'ftyp' starting
    // at byte offset 4. Bytes [4..8] therefore spell 'ftyp' = 0x66 0x74 0x79 0x70.
    expect(buf[4]).toBe(0x66); // f
    expect(buf[5]).toBe(0x74); // t
    expect(buf[6]).toBe(0x79); // y
    expect(buf[7]).toBe(0x70); // p

    // +faststart should have moved the 'moov' atom to the front (within
    // the first ~8 KB for a 2 s clip). Search a generous head slice so the
    // assertion stays robust against ffmpeg version drift.
    const head = buf.subarray(0, Math.min(buf.length, 8192));
    let moovAt = -1;
    for (let i = 0; i < head.length - 4; i++) {
      if (head[i]     === 0x6d /* m */
       && head[i + 1] === 0x6f /* o */
       && head[i + 2] === 0x6f /* o */
       && head[i + 3] === 0x76 /* v */) {
        moovAt = i; break;
      }
    }
    expect(moovAt, 'moov atom should be near the start (faststart)')
      .toBeGreaterThanOrEqual(0);
  });
});
