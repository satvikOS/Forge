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
 * Open a new sketch. `plane` selects where the sketch sits:
 *  - 'XY'     — the base XY plane at z = 0 (default).
 *  - 'top'    — the top face of the current solid (its max-Z) — for a boss.
 *  - 'bottom' — the bottom face of the current solid (its min-Z).
 * Only one sketch may be open at a time.
 *
 * @param {Part} part
 * @param {string} [plane]  'XY' | 'top' | 'bottom'
 * @returns {Promise<object>} the open sketch
 */
export async function startSketch(part, plane = 'XY') {
  if (part.activeSketch) throw new Error('startSketch: a sketch is already open — finishSketch first');
  let baseZ = 0;
  if (plane === 'top' || plane === 'bottom') {
    if (!part.solid) {
      throw new Error(`startSketch: plane '${plane}' needs an existing solid — extrude a base first`);
    }
    const bbox = part.solid.boundingBox();
    baseZ = plane === 'top' ? bbox.max[2] : bbox.min[2];
  } else if (plane !== 'XY') {
    throw new Error(`startSketch: unknown plane '${plane}' (use 'XY', 'top', or 'bottom')`);
  }
  part.activeSketch = { plane, baseZ, loops: [] };
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
 * Close the open sketch. Its loops + base Z become the pending profile for
 * the next feature operation.
 * @param {Part} part
 * @returns {Array<Array<[number,number]>>} the closed profile loops
 */
export function finishSketch(part) {
  if (!part.activeSketch) throw new Error('finishSketch: no open sketch');
  if (part.activeSketch.loops.length === 0) throw new Error('finishSketch: sketch has no geometry');
  part.pendingProfile = part.activeSketch.loops;
  part.pendingBaseZ = part.activeSketch.baseZ ?? 0;
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
  let block = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  const baseZ = part.pendingBaseZ ?? 0;
  if (baseZ !== 0) {
    const lifted = block.translate([0, 0, baseZ]);
    block.delete();
    block = lifted;
  }

  let result = block;
  if (part.solid) {
    result = Mod.Manifold.union(part.solid, block);
    part.solid.delete();
    block.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
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
  if (part.pendingBaseZ) throw new Error('cut: sketch-on-face is not supported for cut yet — sketch on the XY plane for cuts');
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
  part.pendingBaseZ = 0;
  part.addFeature('cut', { distance }, result);
  return result;
}

/**
 * Revolve: revolve the pending sketch profile around the axis to form a
 * solid of revolution, and union it into the Part's current solid. The
 * profile must lie in the positive-X half-plane (x >= 0) — the revolve
 * axis is the Y axis. Records a 'revolve' feature.
 *
 * @param {Part} part
 * @param {number} [segments]  circular segment count (>= 3)
 * @param {number} [degrees]   revolve sweep angle in degrees (default 360)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function revolve(part, segments = 64, degrees = 360) {
  if (!part.pendingProfile) throw new Error('revolve: no finished sketch profile — call finishSketch first');
  if (!(segments >= 3)) throw new Error('revolve: segments must be >= 3');
  if (!(degrees > 0)) throw new Error('revolve: degrees must be > 0');
  if (part.pendingBaseZ) throw new Error('revolve: sketch-on-face is not supported for revolve yet — sketch on the XY plane');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const body = Mod.Manifold.revolve(cs, segments, degrees);
  cs.delete();

  let result = body;
  if (part.solid) {
    result = Mod.Manifold.union(part.solid, body);
    part.solid.delete();
    body.delete();
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('revolve', { segments, degrees }, result);
  return result;
}

/**
 * Circular pattern: extrude the pending sketch profile into a seed solid,
 * make `count` copies evenly spaced around the Z axis over `angle` degrees,
 * and union them (mode 'extrude') or subtract them (mode 'cut') into the
 * part. Use this for gear teeth (extrude) and bolt-circle holes (cut).
 *
 * The seed is patterned about the ORIGIN — so sketch the feature offset from
 * the origin (e.g. a hole at (radius, 0)) to get a ring of features.
 *
 * @param {Part} part
 * @param {string} mode      'extrude' (additive) or 'cut' (subtractive)
 * @param {number} count     number of copies (>= 1)
 * @param {number} distance  extrude depth of each copy (mm, > 0)
 * @param {number} [angle]   total spread in degrees (default 360)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function circularPattern(part, mode, count, distance, angle = 360) {
  if (!part.pendingProfile) throw new Error('circularPattern: no finished sketch profile — call finishSketch first');
  if (part.pendingBaseZ) throw new Error('circularPattern: sketch on the XY plane for patterns');
  if (mode !== 'extrude' && mode !== 'cut') throw new Error("circularPattern: mode must be 'extrude' or 'cut'");
  if (!(count >= 1)) throw new Error('circularPattern: count must be >= 1');
  if (!(distance > 0)) throw new Error('circularPattern: distance must be > 0');
  if (mode === 'cut' && !part.solid) throw new Error('circularPattern: cut needs an existing solid');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const seed = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  let pattern = null;
  for (let i = 0; i < count; i++) {
    const copy = seed.rotate([0, 0, (angle * i) / count]);
    if (pattern === null) {
      pattern = copy;
    } else {
      const merged = Mod.Manifold.union(pattern, copy);
      pattern.delete();
      copy.delete();
      pattern = merged;
    }
  }
  seed.delete();

  let result;
  if (mode === 'cut') {
    const tool = pattern.translate([0, 0, -1]);
    pattern.delete();
    result = Mod.Manifold.difference(part.solid, tool);
    part.solid.delete();
    tool.delete();
  } else if (part.solid) {
    result = Mod.Manifold.union(part.solid, pattern);
    part.solid.delete();
    pattern.delete();
  } else {
    result = pattern;
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('circularPattern', { mode, count, distance, angle }, result);
  return result;
}
