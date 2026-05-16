import { test, expect } from '@playwright/test';
import { encodeJPEG } from '../frontend/src/foundation/JpegEncoder.js';

test.describe('In-platform JPEG encoder', () => {
  test.describe.configure({ timeout: 120000 });

  test('Encodes a valid JPEG that the browser decodes back correctly', async ({ page }) => {
    await page.goto('about:blank');

    // A 64×64 image with four solid quadrants: red / green / blue / white.
    const W = 64, H = 64;
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        let c;
        if (x < 32 && y < 32) c = [220, 30, 30];
        else if (x >= 32 && y < 32) c = [30, 200, 60];
        else if (x < 32 && y >= 32) c = [40, 60, 220];
        else c = [240, 240, 240];
        rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = 255;
      }
    }
    const jpg = encodeJPEG(W, H, rgba, 92);

    // Structurally a JPEG: SOI … EOI.
    expect(jpg[0]).toBe(0xff);
    expect(jpg[1]).toBe(0xd8);
    expect(jpg[jpg.length - 2]).toBe(0xff);
    expect(jpg[jpg.length - 1]).toBe(0xd9);
    expect(jpg.length).toBeGreaterThan(200);

    // Round-trip: let the browser's JPEG decoder read it back.
    const base64 = Buffer.from(jpg).toString('base64');
    const sampled = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/jpeg;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = img.width; cv.height = img.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const px = (x, y) => {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      return { w: img.width, h: img.height, tl: px(16, 16), tr: px(48, 16), bl: px(16, 48), br: px(48, 48) };
    }, base64);

    console.log(`\nJPEG round-trip: ${sampled.w}×${sampled.h}, ` +
      `quadrants TL=${sampled.tl} TR=${sampled.tr} BL=${sampled.bl} BR=${sampled.br}`);
    expect(sampled.w).toBe(64);
    expect(sampled.h).toBe(64);
    // Each decoded quadrant matches the source within JPEG lossy tolerance.
    const near = (got, want) => {
      for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k])).toBeLessThan(30);
    };
    near(sampled.tl, [220, 30, 30]);
    near(sampled.tr, [30, 200, 60]);
    near(sampled.bl, [40, 60, 220]);
    near(sampled.br, [240, 240, 240]);
  });
});
