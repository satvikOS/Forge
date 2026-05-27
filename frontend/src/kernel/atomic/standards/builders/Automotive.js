/**
 * ArchDisc Kernel — Automotive (Volvo FH) reference builders.
 *
 * Atomic-CAD sequences for Volvo FH front-fascia parts. Each builder
 * runs `startSketch → sketch* → finishSketch → extrude/cut/circularPattern`
 * on a Part so the construction history is replayable. Used by the
 * SP-2 Volvo FH fascia e2e per the Video-21 parity bible.
 *
 * Coordinate convention: every part is built centred at origin in the
 * XY plane and extruded along +Z. The place-handler translates +
 * rotates into the assembly position.
 */

import {
  startSketch, sketchCircle, sketchRectangle, sketchPolyline, sketchPolygon,
  finishSketch, extrude, cut, circularPattern, linearPattern, rotate,
} from '../../AtomicOps.js';
import { VOLVO_FH } from '../data/automotive.js';

// ─── VOLVO block-letter polylines ─────────────────────────────────────────
// Each letter is a closed polyline defining its outer outline. Stroke-width
// is uniform; letter origin is the bottom-left corner. Width × height per
// letter is letterWidth × letterHeight from the catalog.
function volvoLetterV(w, h, s) {
  // V — two angled strokes meeting at the bottom centre.
  // Outline traces outer left + bottom centre + outer right + inner right + inner centre + inner left.
  const halfW = w / 2;
  return [
    [0, h], [s, h], [halfW, s], [w - s, h], [w, h],
    [halfW + s/2, 0], [halfW - s/2, 0],
  ];
}
function volvoLetterO(w, h, s) {
  // O — rectangular outline with rectangular hole. Builder cuts the
  // hole separately; this returns just the OUTER outline.
  return [
    [0, 0], [w, 0], [w, h], [0, h],
  ];
}
function volvoLetterL(w, h, s) {
  // L — vertical stroke + horizontal base.
  return [
    [0, 0], [w, 0], [w, s], [s, s], [s, h], [0, h],
  ];
}

// ─── Cab Front Panel ──────────────────────────────────────────────────────
export async function volvoCabFrontPanel(part) {
  const c = VOLVO_FH['Cab Front Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

// ─── Radiator Grille Panel (with perforated hex mesh) ─────────────────────
// Build sequence:
//   1. Sketch the outer panel rectangle + extrude
//   2. Sketch ONE hole circle near a corner + linearPattern in X (cut mode)
//      → strip of holes across the top row
//   3. The strip pattern is collapsed into one feature via cut+linearPattern,
//      then we repeat for each Y row.
//
// We can chain (sketchCircle + linearPattern(cut, count=cols, dx, dy=0))
// inside the same Part to add multiple rows of perforations as separate
// features. Each row = one feature in the tree; cols × rows total holes.
export async function volvoRadiatorGrillePanel(part) {
  const c = VOLVO_FH['Radiator Grille Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);

  // Compute hole start position so the array is centred on the panel.
  const totalW = (c.holeCols - 1) * c.holeSpacingX_mm;
  const totalH = (c.holeRows - 1) * c.holeSpacingY_mm;
  const startX = -totalW / 2;
  const startY = -totalH / 2;

  // For each row, sketch the first hole at startX + extrude an array of `cols`
  // holes across via linearPattern(cut). One linearPattern feature per row.
  for (let row = 0; row < c.holeRows; row++) {
    const y = startY + row * c.holeSpacingY_mm;
    await startSketch(part, 'top');
    sketchCircle(part, startX, y, c.holeRadius_mm);
    finishSketch(part);
    await linearPattern(part, 'cut', c.holeCols, c.thickness_mm + 2, c.holeSpacingX_mm, 0);
  }
  return part;
}

// ─── Lower Intake Slat Bank ───────────────────────────────────────────────
// Same approach but with rectangular slots instead of circular holes.
export async function volvoLowerIntakeSlatBank(part) {
  const c = VOLVO_FH['Lower Intake Slat Bank'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);

  const totalW = (c.slatCols - 1) * (c.slatWidth_mm + c.slatGapX_mm);
  const totalH = (c.slatRows - 1) * (c.slatHeight_mm + c.slatGapY_mm);
  const startX = -totalW / 2;
  const startY = -totalH / 2;

  for (let row = 0; row < c.slatRows; row++) {
    const y = startY + row * (c.slatHeight_mm + c.slatGapY_mm);
    await startSketch(part, 'top');
    sketchRectangle(part, startX, y, c.slatWidth_mm, c.slatHeight_mm);
    finishSketch(part);
    await linearPattern(part, 'cut', c.slatCols, c.thickness_mm + 2,
                         c.slatWidth_mm + c.slatGapX_mm, 0);
  }
  return part;
}

// ─── Bumper Main Section ──────────────────────────────────────────────────
export async function volvoBumperMain(part) {
  const c = VOLVO_FH['Bumper Main Section'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoBumperLowerTrim(part) {
  const c = VOLVO_FH['Bumper Lower Trim'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoBumperSideCap(part) {
  const c = VOLVO_FH['Bumper Side Cap'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// ─── Headlight Cluster ────────────────────────────────────────────────────
// Outer rectangular housing + circular lens cut from front. Two
// features — extrude main + extrude lens hub.
export async function volvoHeadlightCluster(part) {
  const c = VOLVO_FH['Headlight Cluster'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  // Projector lens hub on the front face — extruded boss.
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.lensRadius_mm);
  finishSketch(part);
  await extrude(part, 30);
  return part;
}

// ─── VOLVO Logo Emboss ────────────────────────────────────────────────────
// Block-letter VOLVO sketched as 5 individual letters, each its own
// extrude. Records 5 sketch+extrude features in the FeatureTree.
// All 5 letters land on the same Part; the bounding box covers the
// full "VOLVO" word width.
export async function volvoLogoEmboss(part) {
  const c = VOLVO_FH['VOLVO Logo Emboss'];
  const letters = ['V', 'O', 'L', 'V', 'O'];
  const totalW = letters.length * c.letterWidth_mm + (letters.length - 1) * c.letterSpacing_mm;
  const startX = -totalW / 2;

  for (let i = 0; i < letters.length; i++) {
    const lx = startX + i * (c.letterWidth_mm + c.letterSpacing_mm);
    let outer;
    if (letters[i] === 'V') outer = volvoLetterV(c.letterWidth_mm, c.letterHeight_mm, c.strokeWidth_mm);
    else if (letters[i] === 'O') outer = volvoLetterO(c.letterWidth_mm, c.letterHeight_mm, c.strokeWidth_mm);
    else if (letters[i] === 'L') outer = volvoLetterL(c.letterWidth_mm, c.letterHeight_mm, c.strokeWidth_mm);
    else continue;
    const translated = outer.map(([x, y]) => [x + lx, y]);

    await startSketch(part, i === 0 ? 'XY' : 'XY');
    sketchPolyline(part, translated);
    finishSketch(part);
    await extrude(part, c.reliefDepth_mm);
  }

  return part;
}

// ─── "L" Badge (circular disc + raised L) ─────────────────────────────────
export async function volvoLBadge(part) {
  const c = VOLVO_FH['L Badge'];
  // Outer disc
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.discRadius_mm);
  finishSketch(part);
  await extrude(part, c.discThickness_mm);
  // Raised L on top face — sketch the L outline centred at origin.
  const w = c.discRadius_mm * 1.2;
  const h = c.discRadius_mm * 1.5;
  const outline = volvoLetterL(w, h, c.strokeWidth_mm).map(([x, y]) => [x - w / 2, y - h / 2]);
  await startSketch(part, 'top');
  sketchPolyline(part, outline);
  finishSketch(part);
  await extrude(part, c.reliefDepth_mm);
  return part;
}

// ─── Cab Front Step Plate ─────────────────────────────────────────────────
export async function volvoCabFrontStepPlate(part) {
  const c = VOLVO_FH['Cab Front Step Plate'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

// ─── Headlight Surround Louver (vertical fin) ─────────────────────────────
export async function volvoHeadlightLouver(part) {
  const c = VOLVO_FH['Headlight Surround Louver'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// ─── Cab Step Tread ───────────────────────────────────────────────────────
export async function volvoCabStepTread(part) {
  const c = VOLVO_FH['Cab Step Tread'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

// ─── Tow Hook Mount ───────────────────────────────────────────────────────
export async function volvoTowHookMount(part) {
  const c = VOLVO_FH['Tow Hook Mount'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// ─── Round-2 additions ────────────────────────────────────────────────────

export async function volvoCabSidePillar(part) {
  const c = VOLVO_FH['Cab Side Pillar'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoOrangeAccent(part) {
  const c = VOLVO_FH['Orange Accent Trim'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoLicensePlateFrame(part) {
  const c = VOLVO_FH['License Plate Frame'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

export async function volvoLicensePlatePanel(part) {
  const c = VOLVO_FH['License Plate Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

export async function volvoFogLightCluster(part) {
  const c = VOLVO_FH['Fog Light Cluster'];
  // Housing rectangle + circular lens boss on the front.
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.lensRadius_mm);
  finishSketch(part);
  await extrude(part, 18);
  return part;
}

// Wing mirror — simplified atomic build that completes reliably.
// Stalk (a long horizontal cylinder along +Z, then rotated 90° about
// the Y axis so it runs along +X — the side-arm direction). The
// housing is a thicker disc bonded on the outboard end. Honest
// simplification: the bulged organic revolve from session 1 mis-
// rotated and aborted the manifold union; this 2-op atomic build is
// the floor target. Round 3 will swap to a polyline-revolve once we
// add a `rotate90AboutZ` orientation primitive.
export async function volvoWingMirror(part) {
  const c = VOLVO_FH['Wing Mirror Housing'];
  // Stalk — cylinder along +Z extending stalkLength_mm.
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.stalkRadius_mm);
  finishSketch(part);
  await extrude(part, c.stalkLength_mm);
  // Housing — fatter cylinder co-axial with the stalk.
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.bodyRadius_mm);
  finishSketch(part);
  await extrude(part, c.bodyHeight_mm);
  // Lay flat so the stalk axis becomes +X (mirror sticks out sideways
  // from the cab).
  rotate(part, 0, 90, 0);
  return part;
}

export async function volvoRoofSunVisor(part) {
  const c = VOLVO_FH['Roof Sun Visor'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

export async function volvoMudFlap(part) {
  const c = VOLVO_FH['Mud Flap'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

export async function volvoLowerSideSkirt(part) {
  const c = VOLVO_FH['Lower Side Skirt'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoDoorHandleRecess(part) {
  const c = VOLVO_FH['Door Handle Recess'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

export async function volvoRoofBeaconBar(part) {
  const c = VOLVO_FH['Roof Beacon Bar'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// ─── SP-3 cab body builders ───────────────────────────────────────────────
// Each panel = single sketchRectangle + extrude. The placement
// position + rotation (via the dialog) orients it as a side wall,
// roof, floor, windshield etc.

export async function volvoCabSidePanel(part) {
  const c = VOLVO_FH['Cab Side Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoCabRearPanel(part) {
  const c = VOLVO_FH['Cab Rear Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoCabRoofPanel(part) {
  const c = VOLVO_FH['Cab Roof Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoCabFloorPanel(part) {
  const c = VOLVO_FH['Cab Floor Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoWindshield(part) {
  const c = VOLVO_FH['Windshield'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoSideWindow(part) {
  const c = VOLVO_FH['Side Window'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoCabDoor(part) {
  const c = VOLVO_FH['Cab Door'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
// Aero deflector — trapezoidal profile (taller at back than front)
// revolved? Actually simpler: a trapezoid polyline extruded.
export async function volvoRoofAirDeflector(part) {
  const c = VOLVO_FH['Roof Air Deflector'];
  // Side profile: front edge lower (y=0..h*0.3), back edge higher (y=0..h).
  // Width = depth, polyline extruded across cab width.
  const profile = [
    [0, 0],                         // bottom-front
    [c.depth_mm, 0],                // bottom-back
    [c.depth_mm, c.height_mm],      // top-back (tall)
    [0, c.height_mm * 0.3],         // top-front (shorter — slope)
  ];
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, c.width_mm);
  return part;
}
export async function volvoAPillar(part) {
  const c = VOLVO_FH['A Pillar'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoBPillar(part) {
  const c = VOLVO_FH['B Pillar'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
// Half-pipe wheel-arch cover via revolve. Profile is a thick C-curve.
export async function volvoWheelArchCover(part) {
  const c = VOLVO_FH['Wheel Arch Cover'];
  // Half-annular profile: outer arc minus inner arc. Build as polyline
  // (12 samples) covering 180° from +X to -X.
  const samples = 12;
  const profile = [];
  // Outer arc: x=outerR*cos(t), y=outerR*sin(t) for t=0..π
  for (let i = 0; i <= samples; i++) {
    const t = (i * Math.PI) / samples;
    profile.push([c.outerRadius_mm * Math.cos(t), c.outerRadius_mm * Math.sin(t)]);
  }
  // Inner arc return: smaller radius (outer - thickness)
  const innerR = c.outerRadius_mm - c.thickness_mm;
  for (let i = samples; i >= 0; i--) {
    const t = (i * Math.PI) / samples;
    profile.push([innerR * Math.cos(t), innerR * Math.sin(t)]);
  }
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, c.width_mm);
  return part;
}
export async function volvoRoofMarkerLight(part) {
  const c = VOLVO_FH['Roof Marker Light'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoExhaustStack(part) {
  const c = VOLVO_FH['Exhaust Stack'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// ─── SP-4 chassis builders ────────────────────────────────────────────────

// Frame rail — C-section profile extruded along the truck length.
// Profile in XY plane, extruded along +Z by rail length.
export async function volvoFrameRail(part) {
  const c = VOLVO_FH['Frame Rail'];
  const fw = c.flangeWidth_mm;
  const wh = c.webHeight_mm;
  const t  = c.thickness_mm;
  // C-profile: open on the right (+X). 8-pt CCW polyline.
  const profile = [
    [0,        0],
    [fw,       0],
    [fw,       t],
    [t,        t],
    [t,        wh - t],
    [fw,       wh - t],
    [fw,       wh],
    [0,        wh],
  ];
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, c.length_mm);
  return part;
}
export async function volvoFrameCrossMember(part) {
  const c = VOLVO_FH['Frame Cross Member'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoFuelTank(part) {
  const c = VOLVO_FH['Fuel Tank'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  rotate(part, 0, 90, 0);   // lay horizontal — axis along +X
  return part;
}
export async function volvoAxleBeam(part) {
  const c = VOLVO_FH['Axle Beam'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  rotate(part, 0, 90, 0);   // horizontal axis +X (cross-truck)
  return part;
}
export async function volvoWheelRim(part) {
  const c = VOLVO_FH['Wheel Rim'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  rotate(part, 0, 90, 0);   // axis along +X
  return part;
}
// Tire — annular ring (extrude outer, cut inner).
export async function volvoTire(part) {
  const c = VOLVO_FH['Tire'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.outerRadius_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.innerRadius_mm);
  finishSketch(part);
  await cut(part, c.width_mm + 4);
  rotate(part, 0, 90, 0);   // axis along +X
  return part;
}
export async function volvoBrakeDrum(part) {
  const c = VOLVO_FH['Brake Drum'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  rotate(part, 0, 90, 0);
  return part;
}
export async function volvoDriveShaft(part) {
  const c = VOLVO_FH['Drive Shaft'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  return part;
}
export async function volvoDifferentialHousing(part) {
  const c = VOLVO_FH['Differential Housing'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  rotate(part, 0, 90, 0);
  return part;
}
export async function volvoLeafSpring(part) {
  const c = VOLVO_FH['Suspension Leaf Spring'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.length_mm, c.thickness_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  return part;
}
export async function volvoShockAbsorber(part) {
  const c = VOLVO_FH['Shock Absorber'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  return part;
}
export async function volvoAirSuspensionBellows(part) {
  const c = VOLVO_FH['Air Suspension Bellows'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.outerRadius_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoBatteryBox(part) {
  const c = VOLVO_FH['Battery Box'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoAirCompressorTank(part) {
  const c = VOLVO_FH['Air Compressor Tank'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  rotate(part, 0, 90, 0);
  return part;
}
export async function volvoEngineBlock(part) {
  const c = VOLVO_FH['Engine Block'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoCylinderHead(part) {
  const c = VOLVO_FH['Cylinder Head'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoTurbocharger(part) {
  const c = VOLVO_FH['Turbocharger Housing'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.bodyRadius_mm);
  finishSketch(part);
  await extrude(part, c.bodyHeight_mm);
  return part;
}
export async function volvoIntakeManifold(part) {
  const c = VOLVO_FH['Intake Manifold'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoExhaustManifold(part) {
  const c = VOLVO_FH['Exhaust Manifold'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoRadiatorModule(part) {
  const c = VOLVO_FH['Radiator Module'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
// Cooling fan — central hub + N blades. The blades are a circular
// pattern of thin rectangles extruded as bosses.
export async function volvoCoolingFan(part) {
  const c = VOLVO_FH['Cooling Fan'];
  // Hub
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.hubRadius_mm);
  finishSketch(part);
  await extrude(part, 40);
  // Blades — sketchRectangle offset from origin + circularPattern
  // (mode='extrude') to produce N blade bosses around the hub.
  await startSketch(part, 'top');
  sketchRectangle(part, (c.hubRadius_mm + c.bladeRadius_mm) / 2, 0,
                  c.bladeRadius_mm - c.hubRadius_mm, 60);
  finishSketch(part);
  await circularPattern(part, 'extrude', c.bladeCount, 6, 360);
  return part;
}

// ─── SP-5 cab interior builders ───────────────────────────────────────────

export async function volvoDriverSeatBase(part) {
  const c = VOLVO_FH['Driver Seat Base'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoDriverSeatBack(part) {
  const c = VOLVO_FH['Driver Seat Back'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoSeatHeadrest(part) {
  const c = VOLVO_FH['Seat Headrest'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}

// Steering wheel rim — annular ring revolved around Y so the rim
// curves in 3D. Built via sketch outer circle, extrude, then cut
// inner circle (annulus).
export async function volvoSteeringWheelRim(part) {
  const c = VOLVO_FH['Steering Wheel Rim'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.outerRadius_mm);
  finishSketch(part);
  await extrude(part, c.width_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.innerRadius_mm);
  finishSketch(part);
  await cut(part, c.width_mm + 4);
  return part;
}
export async function volvoSteeringWheelBoss(part) {
  const c = VOLVO_FH['Steering Wheel Boss'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
// One spoke — rectangle extruded; the e2e drops 3 spokes at 120°
// each via separate placements.
export async function volvoSteeringWheelSpoke(part) {
  const c = VOLVO_FH['Steering Wheel Spoke'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoSteeringColumn(part) {
  const c = VOLVO_FH['Steering Column'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  return part;
}
export async function volvoDashboard(part) {
  const c = VOLVO_FH['Dashboard'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoInstrumentCluster(part) {
  const c = VOLVO_FH['Instrument Cluster'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
// Gear shifter — slim cylinder + spherical knob (cylinder w/ rounded top).
export async function volvoGearShifter(part) {
  const c = VOLVO_FH['Gear Shifter'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.knobRadius_mm);
  finishSketch(part);
  await extrude(part, c.knobRadius_mm);
  return part;
}
export async function volvoFootPedal(part) {
  const c = VOLVO_FH['Foot Pedal'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoACVent(part) {
  const c = VOLVO_FH['AC Vent'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoDoorCard(part) {
  const c = VOLVO_FH['Door Card'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoSunVisorInterior(part) {
  const c = VOLVO_FH['Sun Visor Interior'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoCentreConsole(part) {
  const c = VOLVO_FH['Centre Console'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
// Cup holder — annular cylinder via extrude + cut.
export async function volvoCupHolder(part) {
  const c = VOLVO_FH['Cup Holder'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.outerRadius_mm);
  finishSketch(part);
  await extrude(part, c.depth_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.innerRadius_mm);
  finishSketch(part);
  await cut(part, c.depth_mm * 0.9);
  return part;
}
export async function volvoSleeperBunk(part) {
  const c = VOLVO_FH['Sleeper Bunk'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoHeadliner(part) {
  const c = VOLVO_FH['Headliner'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}

// ─── Round-3 builders ─────────────────────────────────────────────────────

export async function volvoEngineHood(part) {
  const c = VOLVO_FH['Engine Hood'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
// Front fender — quarter-pipe over the wheel. Polyline-revolve of a
// quarter circle (90° arc) returns a half-pipe; we want a quarter so
// the fender wraps over the top of the wheel, not under.
export async function volvoFrontFender(part) {
  const c = VOLVO_FH['Front Fender'];
  // Half-annular profile: outer + inner arc returning, 180° sweep
  // (covers top half over the wheel).
  const samples = 10;
  const profile = [];
  // Outer arc 0..π
  for (let i = 0; i <= samples; i++) {
    const t = (i * Math.PI) / samples;
    profile.push([c.outerRadius_mm * Math.cos(t), c.outerRadius_mm * Math.sin(t)]);
  }
  const innerR = c.outerRadius_mm - c.thickness_mm;
  for (let i = samples; i >= 0; i--) {
    const t = (i * Math.PI) / samples;
    profile.push([innerR * Math.cos(t), innerR * Math.sin(t)]);
  }
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, c.width_mm);
  return part;
}
export async function volvoSleeperCabExtension(part) {
  const c = VOLVO_FH['Sleeper Cab Extension'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.depth_mm);
  return part;
}
export async function volvoAirHorn(part) {
  const c = VOLVO_FH['Air Horn'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.radius_mm);
  finishSketch(part);
  await extrude(part, c.length_mm);
  return part;
}
// Fifth-wheel pivot plate — annular disc with a slot for the king pin.
export async function volvoFifthWheelPlate(part) {
  const c = VOLVO_FH['Fifth Wheel Plate'];
  await startSketch(part, 'XY');
  sketchCircle(part, 0, 0, c.outerRadius_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  await startSketch(part, 'top');
  sketchCircle(part, 0, 0, c.innerRadius_mm);
  finishSketch(part);
  await cut(part, c.thickness_mm + 2);
  return part;
}
export async function volvoTrailerKingPinPlate(part) {
  const c = VOLVO_FH['Trailer King-Pin Plate'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoTrailerBody(part) {
  // Full box — empty. We don't actually use this; the e2e composes
  // the trailer from 4 panels (floor / roof / 2 sides / rear door)
  // so the interior is visible if we want. Keep as a single closed
  // shell for the simple case.
  const c = VOLVO_FH['Trailer Body'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.depth_mm);
  return part;
}
export async function volvoTrailerFloor(part) {
  const c = VOLVO_FH['Trailer Floor'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoTrailerRoof(part) {
  const c = VOLVO_FH['Trailer Roof'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoTrailerSidePanel(part) {
  const c = VOLVO_FH['Trailer Side Panel'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoTrailerRearDoor(part) {
  const c = VOLVO_FH['Trailer Rear Door'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoMudGuardRear(part) {
  const c = VOLVO_FH['Mud Guard Rear'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.height_mm);
  finishSketch(part);
  await extrude(part, c.thickness_mm);
  return part;
}
export async function volvoSideStepLight(part) {
  const c = VOLVO_FH['Side Step Light'];
  await startSketch(part, 'XY');
  sketchRectangle(part, 0, 0, c.width_mm, c.depth_mm);
  finishSketch(part);
  await extrude(part, c.height_mm);
  return part;
}
export async function volvoAeroRoofFairing(part) {
  const c = VOLVO_FH['Aero Roof Fairing'];
  // Trapezoid side profile — tall at back, low at front for aero.
  const profile = [
    [0, 0],
    [c.depth_mm, 0],
    [c.depth_mm, c.height_mm],
    [0, c.height_mm * 0.4],
  ];
  await startSketch(part, 'XY');
  sketchPolyline(part, profile);
  finishSketch(part);
  await extrude(part, c.width_mm);
  return part;
}
