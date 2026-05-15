/**
 * ArchDisc Foundation — minimal single-image PDF writer.
 *
 * Wraps one JPEG image into a one-page PDF. JPEG embeds directly
 * via the /DCTDecode filter — no decoding, no compression library,
 * the raw JPEG bytes ARE the stream. That keeps the whole writer
 * under 100 lines with zero runtime dependencies.
 *
 * Used by the Drawing preview's "Download PDF" button: the SVG is
 * rasterised to JPEG in the browser (canvas), then handed here to
 * become a print-ready A3 sheet.
 *
 * PDF object graph:
 *   1 Catalog → 2 Pages → 3 Page → {4 Image XObject, 5 Contents}
 */

/**
 * @param {Uint8Array} jpegBytes      raw JPEG file bytes
 * @param {object=} opts
 * @param {number=} opts.pageWidthPt   default A3 landscape width
 * @param {number=} opts.pageHeightPt  default A3 landscape height
 * @returns {Uint8Array} the PDF file bytes
 */
export function buildImagePdf(jpegBytes, opts = {}) {
  // A3 landscape in PostScript points (1 mm = 2.834645 pt).
  const pageW = opts.pageWidthPt  ?? 1190.55;   // 420 mm
  const pageH = opts.pageHeightPt ?? 841.89;    // 297 mm
  const { width: imgW, height: imgH } = readJpegSize(jpegBytes);

  // Fit the image inside the page preserving aspect ratio.
  const scale = Math.min(pageW / imgW, pageH / imgH);
  const drawW = imgW * scale, drawH = imgH * scale;
  const offX = (pageW - drawW) / 2, offY = (pageH - drawH) / 2;

  const enc = new TextEncoder();
  const parts = [];          // array of Uint8Array
  const offsets = [];        // byte offset of each object (1-indexed)
  let cursor = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    cursor += bytes.length;
  };
  const startObj = (n) => { offsets[n] = cursor; };

  push('%PDF-1.4\n%\xff\xff\xff\xff\n');

  startObj(1);
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  startObj(2);
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');

  startObj(3);
  push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] ` +
       `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);

  // Image XObject — DCTDecode means the stream IS the JPEG.
  startObj(4);
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} ` +
       `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
       `/Length ${jpegBytes.length} >>\nstream\n`);
  push(jpegBytes);
  push('\nendstream\nendobj\n');

  // Content stream — place the image scaled + centred.
  const content =
    `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offX.toFixed(2)} ${offY.toFixed(2)} cm\n/Im0 Do\nQ\n`;
  startObj(5);
  push(`5 0 obj\n<< /Length ${enc.encode(content).length} >>\nstream\n`);
  push(content);
  push('endstream\nendobj\n');

  // xref table.
  const xrefStart = cursor;
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  // Concatenate.
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/**
 * Read width/height from a JPEG byte array by walking the marker
 * segments to the SOF (Start Of Frame) marker. Throws if not JPEG.
 */
export function readJpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Not a JPEG (missing SOI marker)');
  }
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    // SOF0..SOF15 except DHT(c4)/DAC(cc)/RSTn — these carry frame dims.
    if (marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width  = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    // Skip this segment using its 2-byte length.
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  throw new Error('JPEG SOF marker not found');
}
