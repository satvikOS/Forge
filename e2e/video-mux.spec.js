import { test, expect } from '@playwright/test';
import { framesToVideo, extractFrames, encodeAVI, encodeMP4 } from '../frontend/src/foundation/VideoMux.js';
import { encodeJPEG } from '../frontend/src/foundation/JpegEncoder.js';

// Synthetic RGBA frame: a vertical colour bar that sweeps across.
function frame(W, H, t) {
  const rgba = new Uint8Array(W * H * 4);
  const barX = Math.floor(t * (W - 16));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inBar = x >= barX && x < barX + 16;
      rgba[i] = inBar ? 240 : 30;
      rgba[i + 1] = inBar ? 80 : 30;
      rgba[i + 2] = inBar ? 40 : 40;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

test.describe('In-platform Motion-JPEG video muxers', () => {
  test.describe.configure({ timeout: 120000 });

  test('framesToVideo produces .avi and .mp4 that round-trip the frames', async ({ page }) => {
    await page.goto('about:blank');
    const W = 96, H = 64, N = 30;
    const rgbaFrames = [];
    for (let f = 0; f < N; f++) rgbaFrames.push(frame(W, H, f / (N - 1)));

    const video = framesToVideo(rgbaFrames, W, H, { fps: 24, quality: 88 });
    console.log(`\nVideo: ${video.frameCount} frames, AVI ${(video.avi.length / 1024).toFixed(1)} KB, ` +
      `MP4 ${(video.mp4.length / 1024).toFixed(1)} KB`);
    expect(video.frameCount).toBe(N);

    // AVI is a RIFF/AVI container.
    expect(video.avi.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(video.avi.subarray(8, 12).toString('ascii')).toBe('AVI ');
    // MP4 begins with an ftyp box.
    expect(video.mp4.subarray(4, 8).toString('ascii')).toBe('ftyp');
    expect(video.mp4.includes(Buffer.from('moov'))).toBe(true);
    expect(video.mp4.includes(Buffer.from('mdat'))).toBe(true);

    // Both containers carry all N frames, retrievable.
    expect(extractFrames(video.avi).length).toBe(N);
    expect(extractFrames(video.mp4).length).toBe(N);

    // A frame pulled back out still decodes as a correct image.
    const mid = extractFrames(video.mp4)[15];
    const base64 = Buffer.from(mid).toString('base64');
    const sample = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      cv.getContext('2d').drawImage(img, 0, 0);
      const d = cv.getContext('2d').getImageData(0, 0, img.width, img.height).data;
      // Scan the middle row for the brightest (the colour bar) pixel.
      let bestX = 0, bestR = -1;
      const row = (img.height >> 1) * img.width * 4;
      for (let x = 0; x < img.width; x++) {
        if (d[row + x * 4] > bestR) { bestR = d[row + x * 4]; bestX = x; }
      }
      return { w: img.width, h: img.height, barX: bestX, barR: bestR };
    }, base64);
    console.log(`Extracted frame 15: ${sample.w}×${sample.h}, bar at x=${sample.barX} (R=${sample.barR})`);
    expect(sample.w).toBe(W);
    expect(sample.h).toBe(H);
    expect(sample.barR).toBeGreaterThan(180);          // the bright bar survived
    // Frame 15 of 30 → bar ~halfway across.
    expect(sample.barX).toBeGreaterThan(W * 0.3);
    expect(sample.barX).toBeLessThan(W * 0.75);
  });

  test('Container frame counts are exact for AVI and MP4 directly', () => {
    const jpegs = [];
    for (let i = 0; i < 12; i++) jpegs.push(encodeJPEG(32, 32, frame(32, 32, i / 11), 80));
    expect(extractFrames(encodeAVI(jpegs, { fps: 24, width: 32, height: 32 })).length).toBe(12);
    expect(extractFrames(encodeMP4(jpegs, { fps: 24, width: 32, height: 32 })).length).toBe(12);
  });
});
