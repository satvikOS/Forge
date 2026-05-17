/**
 * ArchDisc Kernel — Atomic CAD Operations.
 *
 * The canonical, parametric operation set the AI (and a human) sequences to
 * sculpt a part feature by feature. Plan 2 surface: start a sketch, draw
 * rectangle / circle entities, finish the sketch into a closed profile, and
 * extrude it into a manifold-3d solid. Every operation records a feature on
 * the Part — the construction history.
 *
 * Constraints, cut, revolve, sketch-on-face and patterns are later plans.
 */

import { getManifold } from '../../foundation/manifoldKernel.js';
import { circlePolyline } from './ParametricCurve.js';
import { orient } from './SketchProfile.js';
import { Part } from './Part.js';

/**
 * Create a new, empty Part.
 * @param {string} [name]
 * @returns {Part}
 */
export function createPart(name = 'Part') {
  return new Part(name);
}

/**
 * Open a new sketch on a datum plane. Only one sketch may be open at a time.
 * @param {Part} part
 * @param {string} [plane]  datum plane id ('XY' for Plan 2)
 * @returns {object} the open sketch
 */
export function startSketch(part, plane = 'XY') {
  if (part.activeSketch) throw new Error('startSketch: a sketch is already open — finishSketch first');
  part.activeSketch = { plane, loops: [] };
  part.addFeature('startSketch', { plane });
  return part.activeSketch;
}

/**
 * Add an axis-aligned rectangle (centred at cx,cy) to the open sketch.
 * @param {Part} part
 * @param {number} cx  centre x (mm)
 * @param {number} cy  centre y (mm)
 * @param {number} w   width (mm, > 0)
 * @param {number} h   height (mm, > 0)
 * @returns {Array<[number,number]>} the CCW rectangle loop
 */
export function sketchRectangle(part, cx, cy, w, h) {
  if (!part.activeSketch) throw new Error('sketchRectangle: no open sketch — call startSketch first');
  if (!(w > 0) || !(h > 0)) throw new Error('sketchRectangle: w and h must be > 0');
  const hw = w / 2, hh = h / 2;
  const loop = orient(
    [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]],
    true,
  );
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchRectangle', { cx, cy, w, h });
  return loop;
}

/**
 * Add a circle to the open sketch.
 * @param {Part} part
 * @param {number} cx        centre x (mm)
 * @param {number} cy        centre y (mm)
 * @param {number} r         radius (mm, > 0)
 * @param {number} [segments]  polyline segment count (>= 3)
 * @returns {Array<[number,number]>} the CCW circle loop
 */
export function sketchCircle(part, cx, cy, r, segments = 64) {
  if (!part.activeSketch) throw new Error('sketchCircle: no open sketch — call startSketch first');
  const loop = orient(circlePolyline(r, segments, cx, cy), true);
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchCircle', { cx, cy, r });
  return loop;
}

/**
 * Close the open sketch. Its loops become the pending profile for the next
 * feature operation (e.g. extrude).
 * @param {Part} part
 * @returns {Array<Array<[number,number]>>} the closed profile loops
 */
export function finishSketch(part) {
  if (!part.activeSketch) throw new Error('finishSketch: no open sketch');
  if (part.activeSketch.loops.length === 0) throw new Error('finishSketch: sketch has no geometry');
  part.pendingProfile = part.activeSketch.loops;
  const loopCount = part.pendingProfile.length;
  part.activeSketch = null;
  part.addFeature('finishSketch', { loops: loopCount });
  return part.pendingProfile;
}

/**
 * Extrude the pending sketch profile by `distance` mm and union it into the
 * Part's current solid. Records an 'extrude' feature.
 * @param {Part} part
 * @param {number} distance  extrude depth (mm, > 0)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function extrude(part, distance) {
  if (!part.pendingProfile) throw new Error('extrude: no finished sketch profile — call finishSketch first');
  if (!(distance > 0)) throw new Error('extrude: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const block = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  let result = block;
  if (part.solid) {
    result = Mod.Manifold.union(part.solid, block);
    part.solid.delete();
    block.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.addFeature('extrude', { distance }, result);
  return result;
}

/**
 * Cut: extrude the pending sketch profile into a tool and subtract it from
 * the Part's current solid. The tool starts 1 mm below z = 0, so pass a
 * `distance` GREATER than the material thickness for a clean through-cut
 * (coincident faces in a boolean are fragile). Records a 'cut' feature.
 *
 * @param {Part} part
 * @param {number} distance  cut depth (mm, > 0; exceed the material thickness
 *                           for a through-cut)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function cut(part, distance) {
  if (!part.pendingProfile) throw new Error('cut: no finished sketch profile — call finishSketch first');
  if (!part.solid) throw new Error('cut: no solid to cut — extrude a base first');
  if (!(distance > 0)) throw new Error('cut: distance must be > 0');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const tool = Mod.Manifold.extrude(cs, distance);
  cs.delete();
  const loweredTool = tool.translate([0, 0, -1]);   // start below z=0 for a clean through-cut
  tool.delete();
  const result = Mod.Manifold.difference(part.solid, loweredTool);
  part.solid.delete();
  loweredTool.delete();
  part.solid = result;
  part.pendingProfile = null;
  part.addFeature('cut', { distance }, result);
  return result;
}
