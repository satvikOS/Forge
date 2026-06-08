// frontend/src/ai/VisionPerception.js
//
// Forge mirror of Studio's VisionPerception module — same contract, same
// vision server (Qwen2.5-VL on :8081). The Forge Archie loop captures the
// live viewport canvas, POSTs the PNG to the caption server, and prepends
// the structured JSON caption to the next Archie chat call as a
// <viewport_state> block.
//
// Why a separate file: Studio and Forge are independent repos; both want
// the same VL contract without coupling either to the other's bundler.
// Both modules stay byte-identical (modulo this header) so a future
// extraction into @archdisc/vision will be a no-op.
//
// Usage in Forge's Archie loop (ArchieClient.send / useArchieDriver.send):
//   import { captureAndCaption } from '../../ai/VisionPerception.js';
//   const canvas = window.__archdiscViewport?.renderer?.domElement;
//   const caption = canvas ? await captureAndCaption({ canvas }) : '';
//   const enriched = caption
//     ? `<viewport_state>${caption}</viewport_state>\n\n${prompt}`
//     : prompt;
//   await runForgePrompt({ prompt: enriched, ... });

const DEFAULT_VISION_URL = 'http://localhost:8081/caption';

/**
 * Capture the current frame of an HTMLCanvasElement and POST it to the
 * vision caption server. Returns the structured caption string (JSON-like
 * text) for the renderer to attach to the next Archie chat call.
 *
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas — the live viewport canvas
 * @param {string} [opts.url] — vision server endpoint (default :8081/caption)
 * @param {string} [opts.prompt] — override the default caption prompt
 * @param {AbortSignal} [opts.signal] — caller cancellation
 * @returns {Promise<string>} the structured viewport caption
 */
export async function captureAndCaption({ canvas, url = DEFAULT_VISION_URL,
                                          prompt, signal } = {}) {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    throw new Error('captureAndCaption: HTMLCanvasElement required');
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
                   'image/png');
  });

  let body, headers;
  if (prompt) {
    const buf = await blob.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    body = JSON.stringify({ image_base64: b64, prompt });
    headers = { 'Content-Type': 'application/json' };
  } else {
    body = blob;
    headers = { 'Content-Type': 'image/png' };
  }

  const res = await fetch(url, { method: 'POST', body, headers, signal });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`vision server ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.caption || '';
}

/**
 * Convenience: capture from the Forge viewport (window.__archdiscViewport)
 * with a bounded timeout so a slow VL response cannot stall the chat
 * dispatch. Honours `window.__forgeArchieVisionOff` as an opt-out pin so
 * legacy specs that assert on raw prompt content keep passing.
 */
export async function captureForgeViewportCaption({ timeoutMs = 4000 } = {}) {
  if (typeof window === 'undefined' || window.__forgeArchieVisionOff) return '';
  // Forge v4 publishes the live WebGLRenderer at window.__forgeRenderer
  // (frontend/src/forge-v4/Viewport.jsx RendererPublisher). Legacy paths
  // (v3 + the archie-portal mount) still use window.__archdiscViewport.
  // Try v4 first, fall back to legacy.
  const v4Canvas = window.__forgeRenderer && window.__forgeRenderer.domElement;
  const legacyVp = window.__archdiscViewport;
  const legacyCanvas = legacyVp && legacyVp.renderer && legacyVp.renderer.domElement;
  const canvas = v4Canvas || legacyCanvas;
  if (!canvas || typeof canvas.toBlob !== 'function') return '';
  // Force a synchronous render before toBlob — Three.js default
  // preserveDrawingBuffer=false reads a blank framebuffer otherwise.
  try {
    if (window.__forgeRenderer && window.__forgeScene && window.__forgeCamera) {
      window.__forgeRenderer.render(window.__forgeScene, window.__forgeCamera);
    } else if (legacyVp && legacyVp.renderer && legacyVp.scene && legacyVp.camera) {
      legacyVp.renderer.render(legacyVp.scene, legacyVp.camera);
    }
  } catch (_) { /* render hint best-effort */ }
  const ac = new AbortController();
  const tmo = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await captureAndCaption({ canvas, signal: ac.signal });
  } catch (_) {
    return '';
  } finally {
    clearTimeout(tmo);
  }
}
