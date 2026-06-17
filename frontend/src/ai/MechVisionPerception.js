// frontend/src/ai/MechVisionPerception.js
//
// Mech/Forge-side vision perception. Same two-model pipeline as Studio but
// tuned for CAD viewports: feature trees, GD&T annotations, mass props,
// section views. Captions are biased toward engineering-language output.

const DEFAULT_VISION_URL = 'http://localhost:8081/caption';

const MECH_PROMPT = (
  'Describe this CAD viewport in structured JSON form. Include keys: '
  + '"features" (list of {type, depth_mm, axis}), '
  + '"mass_kg_approx", "bbox_mm_xyz", "annotations" (GD&T or PMI text), '
  + '"section_visible" (true/false), "view_orientation". Output ONLY JSON.'
);

export async function captureAndCaption({ canvas, url = DEFAULT_VISION_URL,
                                          prompt = MECH_PROMPT, signal } = {}) {
  if (!canvas || typeof canvas.toBlob !== 'function') {
    throw new Error('captureAndCaption: HTMLCanvasElement required');
  }
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob returned null')),
                   'image/png');
  });
  const buf = await blob.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  const res = await fetch(url, {
    method: 'POST',
    body: JSON.stringify({ image_base64: b64, prompt }),
    headers: { 'Content-Type': 'application/json' },
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`vision server ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.caption || '';
}
