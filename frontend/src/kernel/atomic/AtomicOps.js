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
import { morphologicalFilletManifold } from '../../foundation/MorphologicalFillet.js';
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
 * Add an arbitrary closed polyline to the open sketch. Each point is [x,y].
 * Used for structural-section profiles (I-beam, L-angle), hex-head outer
 * contours, and any non-regular custom shape. Caller is responsible for
 * coherent geometry — no self-intersections.
 * @param {Part} part
 * @param {Array<[number,number]>} points  >= 3 [x,y] points in any winding
 * @returns {Array<[number,number]>} the CCW polyline loop
 */
export function sketchPolyline(part, points) {
  if (!part.activeSketch) throw new Error('sketchPolyline: no open sketch — call startSketch first');
  if (!Array.isArray(points) || points.length < 3) throw new Error('sketchPolyline: need >= 3 points');
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) {
      throw new Error('sketchPolyline: each point must be [x, y] finite numbers');
    }
  }
  const loop = orient(points.map(p => [p[0], p[1]]), true);
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchPolyline', { count: points.length });
  return loop;
}

/**
 * Add a regular n-gon to the open sketch (centred at cx,cy, circumscribed
 * radius r). `rotation` lets the polygon spin around its centre (radians);
 * 0 puts a vertex on the +X axis. Used for hex heads, hex sockets, hex
 * nuts, n-sided structural section profiles.
 * @param {Part} part
 * @param {number} cx        centre x (mm)
 * @param {number} cy        centre y (mm)
 * @param {number} r         circumscribed radius (mm, > 0)
 * @param {number} n         number of sides (>= 3)
 * @param {number} [rotation]  rotation in radians
 * @returns {Array<[number,number]>} the CCW polygon loop
 */
export function sketchPolygon(part, cx, cy, r, n, rotation = 0) {
  if (!part.activeSketch) throw new Error('sketchPolygon: no open sketch — call startSketch first');
  if (!(r > 0)) throw new Error('sketchPolygon: r must be > 0');
  if (!(n >= 3)) throw new Error('sketchPolygon: n must be >= 3');
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rotation + (i * 2 * Math.PI) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const loop = orient(pts, true);
  part.activeSketch.loops.push(loop);
  part.addFeature('sketchPolygon', { cx, cy, r, n, rotation });
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
 * the Part's current solid.
 *
 * For an XY-plane sketch the tool starts 1 mm below z=0 and goes up. For a
 * sketch-on-face (top/bottom) sketch — `part.pendingBaseZ` non-zero — the tool
 * is positioned to cut DOWNWARD from that face: its top sits 1 mm proud of the
 * face and it removes a pocket of depth `distance` (a through-cut when
 * `distance` exceeds the material thickness).
 *
 * @param {Part} part
 * @param {number} distance  cut depth (mm, > 0; exceed the thickness for a
 *                           through-cut)
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
  // Position the tool. XY-plane cut: tool spans z = -1 .. distance-1 (cuts up
  // from below the base). Sketch-on-face cut at z = baseZ: tool spans
  // z = baseZ+1-distance .. baseZ+1 (cuts down from 1 mm proud of the face).
  const baseZ = part.pendingBaseZ ?? 0;
  const dz = baseZ ? (baseZ + 1 - distance) : -1;
  const positioned = tool.translate([0, 0, dz]);
  tool.delete();
  const result = Mod.Manifold.difference(part.solid, positioned);
  part.solid.delete();
  positioned.delete();
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

  const baseZ = part.pendingBaseZ ?? 0;
  let result;
  if (mode === 'cut') {
    // For cuts, start 1 mm below z=0 for a clean through-cut regardless of which
    // plane the sketch was on (same convention as the plain `cut` operation).
    const tool = pattern.translate([0, 0, -1]);
    pattern.delete();
    result = Mod.Manifold.difference(part.solid, tool);
    part.solid.delete();
    tool.delete();
  } else {
    // For extrude mode, honour the sketch plane (lift by baseZ).
    let placed = pattern;
    if (baseZ !== 0) {
      const lifted = placed.translate([0, 0, baseZ]);
      placed.delete();
      placed = lifted;
    }
    if (part.solid) {
      result = Mod.Manifold.union(part.solid, placed);
      part.solid.delete();
      placed.delete();
    } else {
      result = placed;
    }
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('circularPattern', { mode, count, distance, angle }, result);
  return result;
}

/**
 * Linear pattern: extrude the pending sketch profile into a seed solid, make
 * `count` copies in a straight row each offset by (dx, dy) mm from the last,
 * and union them (mode 'extrude') or subtract them (mode 'cut') into the part.
 * Use this for rows of holes (cut) or repeated bosses/ribs (extrude).
 *
 * Copies are placed at i*(dx,dy) for i = 0..count-1 — so the first copy is at
 * the sketched position; sketch the single feature where the row should start.
 *
 * @param {Part} part
 * @param {string} mode      'extrude' (additive) or 'cut' (subtractive)
 * @param {number} count     number of copies (>= 1)
 * @param {number} distance  extrude depth of each copy (mm, > 0)
 * @param {number} dx        x step between copies (mm)
 * @param {number} dy        y step between copies (mm)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function linearPattern(part, mode, count, distance, dx, dy) {
  if (!part.pendingProfile) throw new Error('linearPattern: no finished sketch profile — call finishSketch first');
  if (mode !== 'extrude' && mode !== 'cut') throw new Error("linearPattern: mode must be 'extrude' or 'cut'");
  if (!(count >= 1)) throw new Error('linearPattern: count must be >= 1');
  if (!(distance > 0)) throw new Error('linearPattern: distance must be > 0');
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('linearPattern: dx and dy must be finite numbers');
  if (mode === 'cut' && !part.solid) throw new Error('linearPattern: cut needs an existing solid');
  const Mod = await getManifold();
  const cs = Mod.CrossSection.ofPolygons(part.pendingProfile);
  const seed = Mod.Manifold.extrude(cs, distance);
  cs.delete();

  let pattern = null;
  for (let i = 0; i < count; i++) {
    const copy = seed.translate([dx * i, dy * i, 0]);
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
  } else {
    const baseZ = part.pendingBaseZ ?? 0;
    let placed = pattern;
    if (baseZ !== 0) {
      const lifted = placed.translate([0, 0, baseZ]);
      placed.delete();
      placed = lifted;
    }
    if (part.solid) {
      result = Mod.Manifold.union(part.solid, placed);
      part.solid.delete();
      placed.delete();
    } else {
      result = placed;
    }
  }
  part.solid = result;
  part.pendingProfile = null;
  part.pendingBaseZ = 0;
  part.addFeature('linearPattern', { mode, count, distance, dx, dy }, result);
  return result;
}

/**
 * Rotate: rotate the part's whole current solid by the given Euler angles
 * (degrees) around the world X, Y, Z axes in that order. Records a
 * 'rotate' feature so the construction history is replayable.
 *
 * @param {Part} part
 * @param {number} rx  X-axis rotation (degrees)
 * @param {number} ry  Y-axis rotation (degrees)
 * @param {number} rz  Z-axis rotation (degrees)
 * @returns {object} the rotated manifold-3d solid
 */
export function rotate(part, rx, ry, rz) {
  if (!part.solid) throw new Error('rotate: nothing to rotate — build a solid first');
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rz)) {
    throw new Error('rotate: rx, ry, rz must be finite numbers');
  }
  const rotated = part.solid.rotate([rx, ry, rz]);
  part.solid.delete();
  part.solid = rotated;
  part.addFeature('rotate', { rx, ry, rz }, rotated);
  return rotated;
}

/**
 * Translate: move the part's whole current solid by (dx, dy, dz) mm. Used to
 * position a finished part within an assembly.
 *
 * @param {Part} part
 * @param {number} dx  x offset (mm)
 * @param {number} dy  y offset (mm)
 * @param {number} dz  z offset (mm)
 * @returns {object} the moved manifold-3d solid
 */
export function translate(part, dx, dy, dz) {
  if (!part.solid) throw new Error('translate: nothing to translate — build a solid first');
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    throw new Error('translate: dx, dy, dz must be finite numbers');
  }
  const moved = part.solid.translate([dx, dy, dz]);
  part.solid.delete();
  part.solid = moved;
  part.addFeature('translate', { dx, dy, dz }, moved);
  return moved;
}

/**
 * Fillet: round the edges of the part's current solid by `radius` mm, using
 * ArchDisc's morphological (rolling-ball) fillet. Honest note: this fillet is
 * voxel-based — a real rounding, but staircased at fine scale and slower than
 * the other ops; it is not an exact B-rep fillet.
 *
 * @param {Part} part
 * @param {number} radius  rolling-ball radius (mm, > 0)
 * @returns {Promise<object>} the resulting manifold-3d solid
 */
export async function fillet(part, radius) {
  if (!part.solid) throw new Error('fillet: nothing to fillet — build a solid first');
  if (!(radius > 0)) throw new Error('fillet: radius must be > 0');
  const fil = morphologicalFilletManifold(part.solid, { radius });
  if (!fil) throw new Error('fillet: morphological fillet produced no result');
  // Reconstruct a manifold from the voxel surface mesh (same approach used
  // by the Volumetric Fillet tool handler in ToolExecutionEngine.js).
  const Mod = await getManifold();
  const sm = fil.surfaceMesh;
  const vp = new Float32Array(sm.vertices.length * 3);
  for (let i = 0; i < sm.vertices.length; i++) {
    vp[i * 3]     = sm.vertices[i][0];
    vp[i * 3 + 1] = sm.vertices[i][1];
    vp[i * 3 + 2] = sm.vertices[i][2];
  }
  const tv = new Uint32Array(sm.triangles.length * 3);
  for (let i = 0; i < sm.triangles.length; i++) {
    tv[i * 3]     = sm.triangles[i][0];
    tv[i * 3 + 1] = sm.triangles[i][1];
    tv[i * 3 + 2] = sm.triangles[i][2];
  }
  const filleted = Mod.Manifold.ofMesh(new Mod.Mesh({ numProp: 3, vertProperties: vp, triVerts: tv }));
  if (!filleted) throw new Error('fillet: morphological fillet produced no result');
  if (filleted !== part.solid) part.solid.delete();
  part.solid = filleted;
  part.addFeature('fillet', { radius }, filleted);
  return filleted;
}
