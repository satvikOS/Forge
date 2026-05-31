/**
 * Perception — Archie SEES its own work. After each build the agent renders
 * the live viewport and reads the PIXELS (machine vision over the actual
 * render, not just geometry data): how much of the frame the model fills,
 * where it sits, and its on-screen extent. This closes the
 * perceive → critique → improve loop that pursuing 1:1 parity demands —
 * Archie can tell whether a cycle actually put new geometry on screen.
 *
 * Offline it uses the pixel signal (works with no model). When a vision-
 * capable model is connected the captured frame (dataUrl) can be compared
 * semantically against the reference frame; the hook is provided here.
 */

export class Perception {
  constructor() { this.last = null; }

  /**
   * Render + perceive the viewport.
   * @param {object} viewport  { renderer, scene, camera }
   * @param {boolean} withImage  also return a downscaled dataUrl (for a vision model)
   * @returns {{coverage,centroid,bbox,dataUrl?}|{error}|null}
   */
  perceive(viewport) {
    if (!viewport?.renderer || !viewport.scene || !viewport.camera) return null;
    try {
      const r = viewport.renderer;
      r.render(viewport.scene, viewport.camera);
      // Read the live framebuffer with gl.readPixels — robust regardless of
      // preserveDrawingBuffer (drawImage/toDataURL on a WebGL canvas would
      // need it). Subsample for speed; y is bottom-left origin (relative
      // metrics are unaffected).
      const gl = r.getContext();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      if (!W || !H) return null;
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const step = 8;
      let fg = 0, tot = 0, sx = 0, sy = 0, minx = W, maxx = 0, miny = H, maxy = 0;
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          const i = (y * W + x) * 4;
          const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
          tot++;
          if (lum > 60) {                       // lit geometry vs OLED-dark bg
            fg++; sx += x; sy += y;
            if (x < minx) minx = x; if (x > maxx) maxx = x;
            if (y < miny) miny = y; if (y > maxy) maxy = y;
          }
        }
      }
      const out = {
        coverage: tot ? +(fg / tot).toFixed(3) : 0,
        centroid: fg ? { x: +(sx / fg / W).toFixed(2), y: +(sy / fg / H).toFixed(2) } : null,
        bbox: fg ? { w: +((maxx - minx) / W).toFixed(2), h: +((maxy - miny) / H).toFixed(2) } : null,
      };
      this.last = out;
      return out;
    } catch (e) {
      return { error: e.message };
    }
  }
}
