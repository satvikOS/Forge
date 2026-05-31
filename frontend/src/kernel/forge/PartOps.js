/**
 * Forge Part Ops (Forge-22) — ergonomic JS wrappers around `forge.part.*`.
 *
 * Every entry returns a fresh ForgeBody — the underlying ShapeHandle is
 * a brand-new id in the registry; the input handles are NOT mutated, so
 * callers can re-use sketches / source bodies for parametric rebuild.
 *
 * Hole-wizard variants additionally tag the result's `.meta` with the
 * hole kind + spec so drawings can call out the feature (Forge-10
 * projection reads `.meta.hole` when present).
 */

import { getForge, ForgeBody } from './index.js';

function requirePart() {
  const f = getForge();
  if (!f.part) {
    throw new Error(
      '[forge.part] forge.part not present on the bridge — build forge-kernel >= Forge-22',
    );
  }
  return f.part;
}

function vec3(input, what) {
  if (input instanceof Float64Array && input.length === 3) return input;
  if (Array.isArray(input) && input.length === 3) {
    return new Float64Array([input[0], input[1], input[2]]);
  }
  throw new Error(`[forge.part] ${what} must be Float64Array[3] or Array[3]`);
}

/** Extrude a closed-profile sketch by `distance` along `direction`. */
export function extrudeProfile(sketchHandle, distance, direction = [0, 0, 1]) {
  const h = requirePart().extrudeProfile(sketchHandle, distance, vec3(direction, 'direction'));
  return new ForgeBody(h, { feature: 'extrude', distance });
}

/** Revolve a closed-profile sketch about an axis by `angleRad`. */
export function revolveProfile(sketchHandle, axisOrigin, axisDir, angleRad) {
  const h = requirePart().revolveProfile(
    sketchHandle,
    vec3(axisOrigin, 'axisOrigin'),
    vec3(axisDir, 'axisDir'),
    angleRad,
  );
  return new ForgeBody(h, { feature: 'revolve', angleRad });
}

/** Sweep a profile sketch along a path sketch. `withGuides` adds guide wires. */
export function sweep(profileSketch, pathSketch, { withGuides = false } = {}) {
  const h = requirePart().sweep(profileSketch, pathSketch, withGuides);
  return new ForgeBody(h, { feature: 'sweep', withGuides });
}

/** Loft through a list of cross-section sketches with optional guides. */
export function loft({ sections, guides = [], ruled = false, closed = false }) {
  if (!Array.isArray(sections) || sections.length < 2) {
    throw new Error('[forge.part] loft requires at least 2 section sketches');
  }
  const h = requirePart().loft(sections, guides, ruled, closed);
  return new ForgeBody(h, { feature: 'loft', sectionCount: sections.length });
}

/** Hollow out a solid by removing faces and offsetting by `thickness`. */
export function shell(body, { facesToRemove = [], thickness, multiThickness = [] }) {
  const h = requirePart().shell(body.handle ?? body, facesToRemove, thickness, multiThickness);
  return new ForgeBody(h, { feature: 'shell', thickness });
}

/** Constant-radius fillet on a list of edges. */
export function filletEdges(body, edgeIds, radius) {
  const h = requirePart().filletEdges(body.handle ?? body, edgeIds, radius);
  return new ForgeBody(h, { feature: 'fillet', radius });
}

/** Variable-radius fillet along a single edge — radii at parametric anchors. */
export function variableFilletEdge(body, edgeId, anchorRadii) {
  const h = requirePart().variableFilletEdge(body.handle ?? body, edgeId, anchorRadii);
  return new ForgeBody(h, { feature: 'fillet', variable: true });
}

/** Chamfer edges — symmetric or asymmetric (pass distance2 for asymmetric). */
export function chamferEdges(body, edgeIds, distance, distance2) {
  const h = requirePart().chamferEdges(body.handle ?? body, edgeIds, distance, distance2);
  return new ForgeBody(h, { feature: 'chamfer', distance, distance2 });
}

/** Apply draft angle to faces relative to a neutral plane. */
export function draftFaces(body, { neutralPlane, faceIds, angleRad }) {
  const h = requirePart().draftFaces(body.handle ?? body, neutralPlane, faceIds, angleRad);
  return new ForgeBody(h, { feature: 'draft', angleRad });
}

/**
 * Compose a fitting hole feature.
 *   type: 'simple' | 'counterbore' | 'countersink' | 'tapped'
 *   spec: { diameter, depth, headDiameter?, headDepth?, headAngle?, tappedPitch? }
 *
 * The result's `.meta.hole` captures the type + spec so drawings can
 * call out the feature (Forge-10 projection consumes it).
 */
export function holeWizard(body, position, axis, type, spec = {}) {
  const h = requirePart().holeWizard(
    body.handle ?? body,
    vec3(position, 'position'),
    vec3(axis, 'axis'),
    type,
    spec,
  );
  return new ForgeBody(h, { feature: 'hole', hole: { type, ...spec } });
}

/** Rib feature — extrudes a profile sketch into a rib of `thickness` × `depth`. */
export function rib(profileSketch, { depth, thickness, neutralFaceId = 0 }) {
  const h = requirePart().rib(profileSketch, depth, thickness, neutralFaceId);
  return new ForgeBody(h, { feature: 'rib', depth, thickness });
}

/** Linear pattern — `count` copies translated by (dx,dy,dz) each. */
export function linearPattern(body, { count, dx = 0, dy = 0, dz = 0 }) {
  const h = requirePart().linearPattern(body.handle ?? body, count, dx, dy, dz);
  return new ForgeBody(h, { feature: 'linearPattern', count });
}

/** Circular pattern — `count` rotated copies about (origin, dir) totalling `totalAngleRad`. */
export function circularPattern(body, { count, axisOrigin, axisDir, totalAngleRad = 2 * Math.PI }) {
  const h = requirePart().circularPattern(
    body.handle ?? body,
    count,
    vec3(axisOrigin, 'axisOrigin'),
    vec3(axisDir, 'axisDir'),
    totalAngleRad,
  );
  return new ForgeBody(h, { feature: 'circularPattern', count });
}

/** Mirror across a plane defined by {origin, normal}. */
export function mirrorPattern(body, mirrorPlane) {
  const h = requirePart().mirrorPattern(body.handle ?? body, {
    origin: vec3(mirrorPlane.origin, 'origin'),
    normal: vec3(mirrorPlane.normal, 'normal'),
  });
  return new ForgeBody(h, { feature: 'mirror' });
}

/** Distribute `count` copies along a path sketch. */
export function onCurvePattern(body, pathSketch, count) {
  const h = requirePart().onCurvePattern(body.handle ?? body, pathSketch, count);
  return new ForgeBody(h, { feature: 'onCurvePattern', count });
}

// Default-export the whole namespace too so existing FeatureTree code can
// route generic feature kinds through one dispatch object.
export default {
  extrudeProfile,
  revolveProfile,
  sweep,
  loft,
  shell,
  filletEdges,
  variableFilletEdge,
  chamferEdges,
  draftFaces,
  holeWizard,
  rib,
  linearPattern,
  circularPattern,
  mirrorPattern,
  onCurvePattern,
};
