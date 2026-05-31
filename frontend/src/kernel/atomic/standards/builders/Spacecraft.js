/**
 * ArchDisc Kernel — Spacecraft reference builders.
 *
 * Atomic-CAD sequences for Falcon 9 / Merlin 1D parts: bell nozzle,
 * combustion chamber, thrust dome, engine-mount frustum, heat-shield
 * panel, thrust takeout pad. Each builder runs `startSketch →
 * sketch{Circle,Polyline,Rectangle} → finishSketch → extrude/revolve →
 * rotate` so the resulting Part carries a replayable feature history
 * the user can inspect in the FeatureTreePanel.
 *
 * No fixture imports. No `Math.random`. No sealed Manifold returns.
 */

import {
  startSketch, sketchCircle, sketchRectangle, sketchPolyline,
  finishSketch, extrude, revolve, rotate,
} from '../../AtomicOps.js';
import { FALCON9_SPEC } from '../data/spacecraft.js';

// ─── Merlin 1D Bell Nozzle ────────────────────────────────────────────────
// 7-sample bell profile in the X-Y plane (X ≥ 0). Revolve about the Y
// axis → bell with axis = +Y. Rotate −90° about X → axis = +Z, throat
// at z=h, exit at z=0 (so the bell hangs downward in flight orientation).
//
// Records 4 features per placement: sketchPolyline → finishSketch →
// revolve → rotate.
export async function merlinBell(part) {
  const spec = FALCON9_SPEC['Merlin 1D Bell Nozzle'];
  const tR = spec.throatRadius_mm;
  const len = spec.bellLength_mm;

  // Profile points are (x_radius_normalised_to_throat, y_axial_fraction).
  // We multiply through to get (radius, axial) in mm; profile goes from
  // throat (axial=0, narrow radius) to exit (axial=len, wide radius).
  // Add axis-closure points so the polyline is a closed loop.
  const profile = [
    [0, 0],                                       // axis @ throat
    ...spec.profileSamples.map(([fAxial, fRadial]) => [
      fRadial * tR,
      fAxial * len,
    ]),
    [0, len],                                     // axis @ exit
  ];

  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await revolve(part, 64, 360);
  // After revolve the bell axis is +Y. Rotate −90° about X so +Y → −Z,
  // putting the throat at z=0 (top of bell) and the exit at z=−bellLen
  // (bottom of bell) — flight orientation, engines hanging downward
  // from the dome. The place-handler translates the throat to the
  // chamber-base Z; the exit naturally falls below.
  rotate(part, -90, 0, 0);
  return part;
}

// ─── Merlin 1D Combustion Chamber ─────────────────────────────────────────
// Cylindrical pressure vessel: sketchCircle → extrude.
export async function merlinChamber(part) {
  const spec = FALCON9_SPEC['Merlin 1D Combustion Chamber'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.radius_mm);
  finishSketch(part);
  await extrude(part, spec.height_mm);
  return part;
}

// ─── Falcon 9 Thrust Dome ─────────────────────────────────────────────────
export async function falcon9Dome(part) {
  const spec = FALCON9_SPEC['Falcon 9 Thrust Dome (Al-Li 2195)'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.radius_mm);
  finishSketch(part);
  await extrude(part, spec.thickness_mm);
  return part;
}

// ─── Falcon 9 Engine Mount Frustum ────────────────────────────────────────
// Trapezoidal profile revolved → truncated cone with smaller top + larger
// base. Used as the flange between dome and combustion chamber.
export async function falcon9EngineMount(part) {
  const spec = FALCON9_SPEC['Falcon 9 Engine Mount Frustum'];
  const profile = [
    [0, 0],
    [spec.baseRadius_mm, 0],
    [spec.topRadius_mm, spec.height_mm],
    [0, spec.height_mm],
  ];
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await revolve(part, 64, 360);
  rotate(part, -90, 0, 0);   // Y axis → −Z: base at z=0, top at z=−height
  return part;
}

// ─── Falcon 9 Heat-Shield Panel ───────────────────────────────────────────
// Annular sector — fan-shape covering arcDeg around the dome between
// innerRadius and outerRadius, extruded by `thickness_mm`. Built as a
// polyline approximation (8 arc samples for inner + outer arcs).
export async function falcon9HeatShieldPanel(part) {
  const spec = FALCON9_SPEC['Falcon 9 Heat Shield Panel'];
  const innerR = spec.innerRadius_mm;
  const outerR = spec.outerRadius_mm;
  const arc = (spec.arcDeg * Math.PI) / 180;
  const half = arc / 2;
  const samples = 12;
  const profile = [];
  // Outer arc (high-to-low Y for CCW)
  for (let i = 0; i <= samples; i++) {
    const t = -half + (arc * i) / samples;
    profile.push([outerR * Math.cos(t), outerR * Math.sin(t)]);
  }
  // Inner arc (return)
  for (let i = samples; i >= 0; i--) {
    const t = -half + (arc * i) / samples;
    profile.push([innerR * Math.cos(t), innerR * Math.sin(t)]);
  }
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, spec.thickness_mm);
  return part;
}

// ─── Falcon 9 Thrust Takeout Pad ──────────────────────────────────────────
export async function falcon9ThrustPad(part) {
  const spec = FALCON9_SPEC['Falcon 9 Thrust Takeout Pad'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, spec.width_mm, spec.depth_mm);
  finishSketch(part);
  await extrude(part, spec.height_mm);
  return part;
}

// ─── Merlin 1D Turbopump (cylinder proxy) ─────────────────────────────────
export async function merlinTurbopump(part) {
  const spec = FALCON9_SPEC['Merlin 1D Turbopump'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.bodyRadius_mm);
  finishSketch(part);
  await extrude(part, spec.bodyHeight_mm);
  return part;
}

// ─── Merlin Plumbing Spoke (horizontal feed-line proxy) ───────────────────
// Cylinder built along +Z (length on the Z axis), then rotated 90° about
// Y so the long axis becomes +X — i.e. the pipe runs horizontally from
// the origin outward by `pipeLength_mm`. The place-handler's circular
// pattern + orient-radial flag then spins each spoke to point at its
// engine azimuth.
export async function merlinPlumbingSpoke(part) {
  const spec = FALCON9_SPEC['Merlin Plumbing Spoke'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, spec.pipeRadius_mm);
  finishSketch(part);
  await extrude(part, spec.pipeLength_mm);
  rotate(part, 0, 90, 0);
  return part;
}
