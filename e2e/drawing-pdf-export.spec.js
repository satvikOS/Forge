import { test, expect } from '@playwright/test';
import { buildImagePdf, readJpegSize } from '../frontend/src/foundation/PdfImage.js';

test.describe('Drawing PDF export', () => {
  test.describe.configure({ timeout: 180000 });

  test('buildImagePdf wraps a JPEG into a valid one-page PDF', () => {
    // A 2×2 red JPEG (minimal valid baseline JPEG, hand-built).
    // Rather than hand-roll JPEG bytes, synthesize the size-read path
    // with a tiny known JPEG header + SOF0 marker.
    const jpeg = makeFakeJpeg(640, 480);
    const dims = readJpegSize(jpeg);
    expect(dims).toEqual({ width: 640, height: 480 });

    const pdf = buildImagePdf(jpeg);
    // PDF magic + EOF
    const head = new TextDecoder().decode(pdf.slice(0, 8));
    expect(head).toBe('%PDF-1.4');
    const tail = new TextDecoder().decode(pdf.slice(-6));
    expect(tail).toBe('%%EOF\n');
    // Has the image XObject + DCTDecode filter
    const body = new TextDecoder('latin1').decode(pdf);
    expect(body).toContain('/Subtype /Image');
    expect(body).toContain('/Filter /DCTDecode');
    expect(body).toContain('/MediaBox [0 0 1190.55 841.89]');
    expect(body).toContain('startxref');
  });

  test('Standard 3 View → Download PDF yields a real PDF file', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    // Build geometry + open the drawing preview.
    await page.locator('.ribbon-tab', { hasText: 'Part' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Extrude Boss$/ }).first().click();
    await page.waitForFunction(() => !!window.__lastFoundationManifold, null, { timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.locator('.ribbon-tab', { hasText: 'Drawing' }).first().click();
    await page.waitForTimeout(500);
    await page.locator('.ribbon-tool-label', { hasText: /^Standard 3 View$/ }).first().click();

    const dlg = page.locator('.dpp-dialog');
    await expect(dlg).toBeVisible({ timeout: 15000 });

    // Click Download PDF — captures the download.
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      dlg.locator('[data-action="dpp-download-pdf"]').click(),
    ]);
    const name = dl.suggestedFilename();
    console.log(`\nPDF download: ${name}`);
    expect(name).toMatch(/archdisc-drawing-\d{4}-\d{2}-\d{2}\.pdf/);

    const fs = await import('fs');
    const bytes = fs.readFileSync(await dl.path());
    console.log(`PDF size: ${(bytes.length / 1024).toFixed(1)} KB`);
    expect(bytes.length).toBeGreaterThan(3000);
    // PDF magic
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const body = new TextDecoder('latin1').decode(bytes);
    expect(body).toContain('/Filter /DCTDecode');
    expect(body).toContain('%%EOF');
  });
});

/** Build a minimal JPEG byte array with a SOF0 marker carrying dims. */
function makeFakeJpeg(width, height) {
  // SOI + APP0(JFIF) + SOF0 + a fake SOS + EOI. Only the SOF0 dims
  // matter for readJpegSize / DCTDecode length accounting.
  const sof0 = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  return new Uint8Array([
    0xff, 0xd8,                                  // SOI
    0xff, 0xe0, 0x00, 0x10,                      // APP0
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00,
    0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...sof0,
    0xff, 0xd9,                                  // EOI
  ]);
}
