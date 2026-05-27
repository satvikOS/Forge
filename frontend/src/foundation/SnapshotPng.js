/**
 * High-resolution viewport snapshot to PNG. Renders the active scene
 * + camera at the user's chosen DPI multiplier (default 2x the canvas
 * size), returns the PNG bytes, and (optionally) triggers a download.
 *
 * Engineers paste viewport images into review decks, vendor RFQs,
 * project trackers, and customer-facing slide decks. A 2x snapshot
 * at the canvas's native pixel ratio produces a clean image that
 * doesn't look pixellated when scaled in PowerPoint / Keynote / a
 * Slack channel.
 *
 * The function:
 *   1. Records the renderer's current size + pixel ratio.
 *   2. Resizes the renderer to canvasW * multiplier x canvasH * multiplier
 *      at pixelRatio 1 (we baked the scale into the size already).
 *   3. Calls renderer.render(scene, camera) once.
 *   4. Reads back the canvas as a `image/png` via `canvas.toDataURL`.
 *   5. Restores the renderer to its original size + pixel ratio.
 *
 * Background uses scene.background; transparent backgrounds are not
 * preserved (PNG alpha would need renderer { alpha: true } at WebGL
 * context creation -- a follow-on if requested).
 */

function getViewport() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport ?? null;
}

function dataUrlToBytes(dataUrl) {
  // dataUrl format: "data:image/png;base64,XXXX"
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const b64 = dataUrl.slice(comma + 1);
  // atob -> binary string -> Uint8Array
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Capture a high-resolution snapshot.
 *
 * @param {object} opts
 * @param {number=} opts.multiplier  size multiplier (default 2; max 4)
 * @param {string=} opts.filename    download filename
 * @param {boolean=} opts.download   default true; pass false to keep bytes only
 * @returns {{ok:boolean, width:number, height:number, bytes:number,
 *            filename:string, pngBytes:Uint8Array}}
 */
export function captureSnapshot(opts = {}) {
  const vp = getViewport();
  if (!vp?.renderer || !vp?.scene || !vp?.camera) {
    return { ok: false, reason: 'no-viewport', width: 0, height: 0, bytes: 0 };
  }
  const renderer = vp.renderer;
  const scene = vp.scene;
  const camera = vp.camera;

  const multiplier = Math.max(1, Math.min(4, Number(opts.multiplier ?? 2)));
  // Read the renderer's current physical size from the canvas DOM
  // element. clientWidth / clientHeight are the CSS-pixel size; the
  // renderer multiplies those by getPixelRatio() internally on
  // setSize(), so we feed it CSS pixels at restore time.
  const origW = renderer.domElement.clientWidth || renderer.domElement.width;
  const origH = renderer.domElement.clientHeight || renderer.domElement.height;
  const origPixelRatio = renderer.getPixelRatio();

  const W = Math.round(origW * multiplier);
  const H = Math.round(origH * multiplier);
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const pngBytes = dataUrlToBytes(dataUrl);
    // Restore.
    renderer.setPixelRatio(origPixelRatio);
    renderer.setSize(origW, origH, false);
    renderer.render(scene, camera);

    if (!pngBytes) {
      return { ok: false, reason: 'data-url-parse', width: W, height: H, bytes: 0 };
    }

    const filename = opts.filename ?? `archdisc-snapshot-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const blob = new Blob([pngBytes], { type: 'image/png' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('[Snapshot] download failed', err);
      }
    }

    return {
      ok: true,
      width: W,
      height: H,
      bytes: pngBytes.length,
      filename,
      pngBytes,
    };
  } catch (err) {
    // Restore on error.
    try {
      renderer.setPixelRatio(origPixelRatio);
      renderer.setSize(origW, origH, false);
    } catch { /* ignore */ }
    return { ok: false, reason: err?.message ?? 'capture-failed', width: 0, height: 0, bytes: 0 };
  }
}

export default { captureSnapshot };
