/**
 * ArchDisc Foundation — SVG → PDF rasteriser (browser-only).
 *
 * Turns an SVG string into a print-ready one-page PDF by drawing
 * it onto a canvas, encoding JPEG, and wrapping it via PdfImage.
 * Lives in foundation for reuse (Drawing preview's Download PDF,
 * the Vendor Package bundler) but depends on the DOM — callers in
 * a non-browser context must guard with isRasterCapable().
 */

import { buildImagePdf } from './PdfImage.js';

/** True when SVG→canvas rasterisation is possible (browser DOM). */
export function isRasterCapable() {
  return typeof document !== 'undefined' &&
         typeof Image !== 'undefined' &&
         typeof document.createElement === 'function';
}

/**
 * Rasterise an SVG string to a JPEG Uint8Array.
 * @param {string} svg
 * @param {number=} widthPx   canvas width (default 2480 ≈ A3@150dpi)
 * @returns {Promise<Uint8Array>}
 */
export async function svgToJpegBytes(svg, widthPx = 2480) {
  if (!isRasterCapable()) throw new Error('svgToJpegBytes needs a browser DOM');
  const svgUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('SVG rasterisation failed'));
    im.src = svgUrl;
  });
  const cw = widthPx;
  const ch = Math.round(cw * (img.height / img.width || 0.707));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Rasterise an SVG string into a one-page A3-landscape PDF.
 * @returns {Promise<Uint8Array>}
 */
export async function svgToPdfBytes(svg, opts = {}) {
  const jpeg = await svgToJpegBytes(svg, opts.widthPx);
  return buildImagePdf(jpeg, opts);
}
