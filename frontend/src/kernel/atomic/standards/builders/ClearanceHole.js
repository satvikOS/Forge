/**
 * ArchDisc Kernel — Atomic-CAD ISO 273 clearance-hole builder.
 *
 * Cuts a clearance hole on the *top face* of an existing solid for a
 * given metric bolt size + fit class (close / medium / coarse).
 *
 * Caller is responsible for the host part having a top face (i.e. a
 * previously-extruded solid). The cut goes through the full thickness +
 * 2 mm overshoot to guarantee a through-hole regardless of stack
 * tolerance.
 *
 * Records 3 features on the host part.
 */

import { startSketch, sketchCircle, finishSketch, cut } from '../../AtomicOps.js';
import { ISO_273 } from '../data/iso.js';

export async function cutClearanceHole(part, { boltSize, fit = 'medium', cx = 0, cy = 0, throughDepth_mm }) {
  const entry = ISO_273[boltSize];
  if (!entry) throw new Error(`ISO 273: no clearance entry for ${boltSize}`);
  if (!['close', 'medium', 'coarse'].includes(fit)) throw new Error(`ISO 273: bad fit '${fit}' (use close/medium/coarse)`);
  if (!part.solid) throw new Error('cutClearanceHole: host part has no solid — extrude a base first');

  // Determine through depth — caller may pass an explicit value or we
  // infer from the part's bounding-box Z extent.
  let depth = throughDepth_mm;
  if (depth == null) {
    const bbox = part.solid.boundingBox();
    depth = (bbox.max[2] - bbox.min[2]) + 2;
  }

  const dia = entry[fit];

  await startSketch(part, 'top');
  sketchCircle(part, cx, cy, dia / 2);
  finishSketch(part);
  await cut(part, depth);

  return part;
}
