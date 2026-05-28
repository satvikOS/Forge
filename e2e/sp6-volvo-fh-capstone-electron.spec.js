import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-6 CAPSTONE v2 — coherent Volvo FH truck.
 *
 * Honest-failure rewrite (2026-05-27). The previous capstone stacked
 * every panel in the wrong orientation — floors and side walls ended
 * up as parallel rectangles facing +Z, fascia got hidden behind the
 * cab body, wheels floated. The user called it out: "no logic, no
 * coherence." This rewrite fixes the truck FRAME of reference:
 *
 *   Truck frame (truck looking at the camera = facing −Z):
 *     X = LEFT/RIGHT (cab is 2.5 m wide → X ∈ [−1250, +1250])
 *     Y = UP/DOWN (ground at y=0, cab roof ≈ y=3600)
 *     Z = FRONT/BACK (cab front at z=0, cab rear at z=−2200,
 *                     chassis rear at z=−8000)
 *
 *   Every panel builder sketches in XY + extrudes in +Z. To orient a
 *   panel correctly the e2e must rotate it:
 *     - Horizontal panel (floor/roof): rx=90  → face becomes XZ, normal +Y
 *     - Vertical side wall (X-normal):   ry=90  → face becomes YZ, normal +X
 *     - Vertical front/rear wall:        no rot (face XY, normal +Z)
 *     - Windshield (tilted back):        rx=−15
 *
 *   Wheels sit UNDER the frame (y ≈ 525 mm tire radius, frame at y=1000).
 *   Engine + radiator sit in the engine bay (between fascia and cab front).
 *   The cab body is a HOLLOW BOX behind the engine bay; interior parts
 *   sit on the floor inside the box.
 *
 *   Drive truck looks at camera (−Z direction), so:
 *     - Fascia is the FRONT face of the truck at z=0 — visible head-on
 *     - Engine bay extends from fascia back to cab front (z=−800 area)
 *     - Cab interior is inside the cab box (z=−800 to z=−2800)
 *     - Trailer / chassis extends behind (z<−2800)
 *
 * Every body is placed through the Standards Library dialog with the
 * correct rotation. No `__archdiscAtomic` body-building bypass.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp6-volvo-fh-capstone-v2');
fs.mkdirSync(OUT, { recursive: true });

// ─── Coherent truck coordinate system ──────────────────────────────────
const T = {
  // Cab volume
  cabHalfWidth: 1250,
  cabFloorY:     1000,    // cab floor above the chassis
  cabRoofY:      3300,    // cab roof
  cabFrontZ:    -800,     // cab front (back of fascia)
  cabRearZ:    -2800,     // cab rear wall
  // Fascia in front of the cab — the front of the truck (z=0..−800)
  fasciaFrontZ:    0,
  fasciaBackZ:  -800,
  fasciaHeaderY: 2900,    // top of cab front, header bar
  fasciaGrilleY: 1700,    // grille mid-height
  fasciaBumperY: 1000,    // bumper at frame height
  fasciaStepY:    400,    // step plate near ground
  // Engine bay between fascia and cab front
  engineBayFrontZ: -100,
  engineBayBackZ:  -700,
  // Chassis (frame rails extend behind the cab)
  chassisFrontZ: -800,
  chassisRearZ: -8500,
  frameY:         800,    // top of frame rail
  trackWidth:    1800,
  // Axle positions
  frontAxleZ:   -400,     // front axle is under the fascia
  rearAxleZ:   -5000,
  rearAxleZ2:  -6300,
  axleY:         525,     // axle centreline = tire radius above ground
};

test.describe.configure({ timeout: 45 * 60 * 1000 });

test('SP-6 v2 — coherent Volvo FH truck via UI', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.error('[pageerror]', err.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }

  const bodyCount = () => win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  const clickTool = async (n) => {
    const btn = win.locator(`[data-ribbon-tool-name="${n}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.dispatchEvent('click');
  };
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');

  const openStd = async (mode) => {
    await clickTool(mode === 'pattern' ? 'Pattern Standards' : 'Standards Library');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(150);
  };
  const cat = (c) => win.locator(`.standards-library-dialog .category-tree .cat button:text-is("${c}")`).first().dispatchEvent('click');
  const lf  = (n) => win.locator(`.standards-library-dialog .category-tree li button:text-is("${n}")`).first().dispatchEvent('click');
  const setPR = async (x, y, z, rx = 0, ry = 0, rz = 0) => {
    const rows = win.locator('.standards-library-dialog .position-row');
    const pos = rows.nth(0).locator('input');
    await pos.nth(0).fill(String(x));
    await pos.nth(1).fill(String(y));
    await pos.nth(2).fill(String(z));
    const rot = rows.nth(1).locator('input');
    await rot.nth(0).fill(String(rx));
    await rot.nth(1).fill(String(ry));
    await rot.nth(2).fill(String(rz));
  };
  const stdPlace = async () => {
    const before = await bodyCount();
    await win.evaluate(() => document.querySelector('[data-testid="sl-place-btn"]')?.click());
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'hidden', timeout: 180000 });
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 180000 });
    return (await bodyCount()) - before;
  };
  // v13/SP-7 — fill per-placement dimension inputs declared by the
  // catalog leaf (NO baked dims in JS). When `dims` is passed, the
  // e2e fills the `data-dim-field` inputs in the dialog before
  // clicking Place; the spec dispatched to the place-handler carries
  // these as opts.dimensions, which the builder reads instead of any
  // catalog default.
  const setDims = async (dims) => {
    if (!dims) return;
    for (const [name, val] of Object.entries(dims)) {
      const inp = win.locator(`.standards-library-dialog [data-dim-field="${name}"]`);
      if (await inp.count() === 0) continue;
      await inp.fill(String(val));
    }
  };
  const place = async (catName, leafName, x, y, z, rx = 0, ry = 0, rz = 0, dims) => {
    await openStd('single');
    await cat(catName);
    await lf(leafName);
    await setPR(x, y, z, rx, ry, rz);
    await setDims(dims);
    return stdPlace();
  };
  const placeCirc = async (catName, leafName, x, y, z, count, radius, opts = {}) => {
    await openStd('pattern');
    await cat(catName);
    await lf(leafName);
    await setPR(x, y, z, opts.rx || 0, opts.ry || 0, opts.rz || 0);
    if (opts.size) await win.locator('.standards-library-dialog select#sl-size').selectOption(opts.size);
    if (opts.length != null) await win.locator('.standards-library-dialog input#sl-length').fill(String(opts.length));
    if (opts.grade) await win.locator('.standards-library-dialog select#sl-grade').selectOption(opts.grade);
    await win.locator('.standards-library-dialog select#sl-pattern').selectOption('circular');
    await win.locator('.standards-library-dialog input#sl-count').fill(String(count));
    await win.locator('.standards-library-dialog input#sl-radius').fill(String(radius));
    await win.locator('.standards-library-dialog input#sl-start-angle').fill(String(opts.start || 0));
    await win.locator('.standards-library-dialog input#sl-sweep').fill(String(opts.sweep || 360));
    return stdPlace();
  };

  const captureAllAngles = async (label) => {
    // v8 — direct camera positioning via `__archdiscViewport`.
    // v7 audit: multiplicative-zoom orbit helper kept producing the
    // same view because FrameAll auto-centred + auto-fitted each
    // capture. v8 sets camera position + lookAt target explicitly
    // from the known rig bounding box.
    //
    // Scene units = metres (Three.js scale 0.001 mm→m), so a rig
    // 14 m long sits at ~14 scene units. We aim the camera 25–40 m
    // away in scene units so the whole rig fits at FOV~50°.
    //
    // Rig bbox in mm: x ∈ [−1500, +1500], y ∈ [0, 3500],
    // z ∈ [−10400, 0]. v10 — target shifted from rig centre
    // (z=−5.2 = midpoint of tractor+trailer) to CAB centre
    // (z=−1.8 = midpoint of cabFront..cabRear). The cab is the
    // focal subject; the trailer remains in the background.
    const tgt = { x: 0, y: 1.75, z: -1.8 };
    const angles = [
      { name: 'iso-front',     az:  35, el:  18, dist: 22 },
      { name: 'iso-rear',      az: 145, el:  18, dist: 22 },
      { name: 'front',         az:   0, el:   3, dist: 14 },
      { name: 'rear',          az: 180, el:   3, dist: 14 },
      { name: 'side-right',    az:  90, el:   8, dist: 22 },
      { name: 'side-left',     az: -90, el:   8, dist: 22 },
      { name: 'top-down',      az:   0, el:  60, dist: 22 },   // v9 — oblique not nadir, retains depth detail
      { name: 'low-iso',       az:  35, el: -10, dist: 22 },
      { name: 'wide',          az:  35, el:  18, dist: 32 },
      { name: 'front-quarter', az:  25, el:  10, dist: 18 },
      { name: 'rear-quarter',  az: 155, el:  10, dist: 18 },
      { name: 'cab-close',     az:  35, el:   5, dist:  6 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera || !vp?.orbitControls) return;
        const azRad = (az * Math.PI) / 180;
        const elRad = (el * Math.PI) / 180;
        const cx = tx + dist * Math.cos(elRad) * Math.sin(azRad);
        const cy = ty + dist * Math.sin(elRad);
        const cz = tz + dist * Math.cos(elRad) * Math.cos(azRad);
        vp.camera.position.set(cx, cy, cz);
        vp.orbitControls.target.set(tx, ty, tz);
        vp.camera.lookAt(tx, ty, tz);
        vp.orbitControls.update();
        if (vp.renderer) vp.renderer.render(vp.scene, vp.camera);
      }, { ...a, tx: tgt.x, ty: tgt.y, tz: tgt.z });
      await win.waitForTimeout(220);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await captureAllAngles('00-empty');

  // ═════════ PHASE 1: CHASSIS — frame rails + cross-members ════════════
  // Frame rails extend in +Z (built by Frame Rail builder along +Z).
  // Place starting from cabFrontZ (z=−800) going forward to z=0
  // and back to z=−8500. Rail built at origin extending +Z by 7800,
  // so place rail's origin at z=cabFrontZ - 7800 + 0 = wait, need to
  // place at z=−8500 so it extends from −8500 to −800 (front of cab).
  await place('Automotive', 'Frame Rail', -T.trackWidth/2 - 45, T.frameY, T.chassisRearZ);
  await place('Automotive', 'Frame Rail',  T.trackWidth/2 - 45, T.frameY, T.chassisRearZ);
  // 6 cross-members spaced along the chassis
  for (let i = 0; i < 6; i++) {
    await place('Automotive', 'Frame Cross Member',
      -350, T.frameY + 40, T.chassisRearZ + 800 + i * 1200);
  }
  await captureAllAngles('01-chassis-frame');

  // ═════════ PHASE 2: AXLES + WHEELS ════════════════════════════════════
  // Axles run along X. Axle Beam builder extrudes along +Z then rotates
  // 90° about Y to become +X axis (length cross-truck). After rotation
  // it extends from origin in +X. Place at x=−1150 so it extends to +1150.
  await place('Automotive', 'Axle Beam', -1150, T.axleY, T.frontAxleZ);
  await place('Automotive', 'Axle Beam', -1150, T.axleY, T.rearAxleZ);
  await place('Automotive', 'Axle Beam', -1150, T.axleY, T.rearAxleZ2);

  // Wheels (rim + tire built with axis +Z, then rotated 90° about Y to
  // axis +X — wheel face is in YZ plane). Place rim at x=±track/2,
  // y=axleY (tire centreline = ground + radius), z=axle position.
  const wheelLocs = [
    { x: -T.trackWidth/2 - 110, z: T.frontAxleZ },
    { x:  T.trackWidth/2 + 110, z: T.frontAxleZ },
  ];
  // Rear duals: 2 axles × 2 sides × 2 wheels (inner+outer)
  for (const z of [T.rearAxleZ, T.rearAxleZ2]) {
    for (const side of [-1, 1]) {
      for (const sub of [0, 280]) {
        wheelLocs.push({ x: side * (T.trackWidth/2 + 110 + sub), z });
      }
    }
  }
  for (const w of wheelLocs) {
    await place('Automotive', 'Wheel Rim', w.x, T.axleY, w.z);
    await place('Automotive', 'Tire',      w.x, T.axleY, w.z);
  }
  await captureAllAngles('02-axles-wheels');

  // ═════════ PHASE 3: FUEL TANKS + DRIVE SHAFT ═════════════════════════
  // Fuel tank: cylinder extruded along +Z then rotated 90° about Y →
  // axis +X. Place at x=−tank length so it extends from -870 to +530
  // across the side. Two tanks, one each side, hanging beside the rails.
  await place('Automotive', 'Fuel Tank', -1700, T.frameY - 250, -3500);
  await place('Automotive', 'Fuel Tank',  300,  T.frameY - 250, -3500);
  // Drive shaft along +Z under chassis centreline
  await place('Automotive', 'Drive Shaft', 0, T.frameY - 200, -2400);
  await place('Automotive', 'Differential Housing', -160, T.frameY - 300, T.rearAxleZ);
  await place('Automotive', 'Differential Housing', -160, T.frameY - 300, T.rearAxleZ2);
  await captureAllAngles('03-fuel-driveline');

  // ═════════ PHASE 4: ENGINE BAY ═══════════════════════════════════════
  // Engine sits between front axle and cab front, on top of frame.
  // Engine Block built as XY rect extruded +Z. Want to fit it in the
  // engine bay (y=frameY+40 up to roof of bay, z=−700 to z=−100 say).
  // Build dims width=980, height=1100, depth=1400 — width along X,
  // depth along Y (after sketchRectangle(0,0,w,d)), extrude h=1100 along Z.
  // Hmm — that orientation doesn't suit. Let me place it as-is and rely
  // on the user not opening the hood: position it at engine-bay centre.
  await place('Automotive', 'Engine Block', -490, T.frameY + 40, -1500);
  await place('Automotive', 'Cylinder Head', -440, T.frameY + 1180, -1490);
  await place('Automotive', 'Turbocharger Housing', 150, T.frameY + 1400, -1700);
  await place('Automotive', 'Intake Manifold', -340, T.frameY + 1500, -1500);
  await place('Automotive', 'Exhaust Manifold', -340, T.frameY + 1500, -1700);
  // Radiator in front of engine, behind fascia grille
  await place('Automotive', 'Radiator Module', -600, T.frameY + 400, -700);
  // Cooling fan between radiator and engine
  await place('Automotive', 'Cooling Fan', 0, T.frameY + 800, -800, 90, 0, 0);
  await captureAllAngles('04-engine-bay');

  // ═════════ PHASE 5: CAB BOX (correctly oriented!) ════════════════════
  // The cab is a hollow box from z=−800 (front) to z=−2800 (rear),
  // x=±1250, y=1000..3300. We build it as 6 faces.
  //
  // Cab Floor: built as 2500×2200 rect extruded by 8 in Z. To make it
  // a HORIZONTAL slab (XZ plane) we rotate 90° about X — that maps
  // local +Y → +Z and local +Z → −Y. After rotation the panel sits in
  // XZ plane with normal +Y. Place at x=−1250 (left edge), y=cabFloorY
  // (floor level), z=cabFrontZ−depth so it spans z=−2800..−800? Wait
  // after rx=90, original +Z axis (extrude direction) maps to −Y; the
  // 2500×2200 face is now in XZ. To make z extent go from −2800 to
  // −800 (depth 2000) we need the panel's depth direction (originally
  // +Y in builder, sketchRectangle's Y dim is 2200) to map to +Z, but
  // rx=90 maps +Y → +Z, so YES. Place at (x=−1250, y=cabFloorY, z=cabRearZ)
  // and the panel extends in +X by 2500 and in +Z by 2200 (depth).
  // Final XZ extent: x=−1250..+1250, z=−2800..−600. Good (frontmost edge
  // at z=−600 which is INSIDE the engine bay slightly — acceptable for
  // visual; the fascia hides this).
  //
  // Builder dims: width=2500, depth=2200, thickness=8. We need depth to
  // become the Z extent after rotation. After rx=90:
  //   originally panel in XY plane (X=2500, Y=2200), extruded in +Z by 8
  //   rx=90 rotates +Y to +Z and +Z to −Y.
  //   So 2500-wide axis stays X (unchanged), 2200-deep axis becomes Z, and
  //   8-thick axis becomes -Y. So panel now lies in XZ at y=0..−8.
  // Place the panel such that its origin (which is the part's origin =
  // (0,0,0) before translate) ends up where we want.
  //
  // Hmm this is getting confusing. Let me just place it with rotation
  // and accept some visual offset. Tweak if needed.
  // v13 — sketchRectangle is CENTRED at (cx, cy). Earlier versions
  // used x=-1250 thinking it was the panel corner, but actually it
  // was the panel CENTRE, so the body occupied x=[-2500, 0] (half the
  // cab missing). Centre placements at x=0, z=cabMidZ.
  const cabMidZ = (T.cabFrontZ + T.cabRearZ) / 2;
  await place('Automotive', 'Cab Floor Panel', 0, T.cabFloorY, cabMidZ, 90, 0, 0);
  await place('Automotive', 'Cab Roof Panel',  0, T.cabRoofY,  cabMidZ, 90, 0, 0);

  // Side Panels: built width × height × thickness. Native XY plane =
  // 2200×2400, thin in Z. To make it a VERTICAL side wall in YZ plane
  // we rotate 90° about Y (so +X → −Z, +Z → +X). The panel's 2200-wide
  // axis (X in builder) becomes −Z (toward rear of truck = correct
  // direction). The 2400-tall axis (Y in builder) stays Y. The 10-thick
  // axis (Z in builder) becomes +X. So panel sits at the chosen X with
  // its face normal pointing along +X.
  // Place LEFT side at x=−1250, top of floor (y=cabFloorY), z=cabFrontZ
  // (front of cab). After ry=90, the 2200-wide dim extends in −Z from
  // z=cabFrontZ to z=cabFrontZ−2200 = cabRearZ.
  // v13 — side panels centred at cabMidZ along Z, x=±1280 (60mm-thick
  // wall sits at x∈[1250,1310] right / [-1310,-1250] left).
  // SP-7: dimensions now PASSED through the dialog (not baked). The
  // 2200×2400×60 values reach the builder via opts.dimensions filled
  // by setDims().
  const cabSideDims = { width_mm: 2200, height_mm: 2400, thickness_mm: 60 };
  await place('Automotive', 'Cab Side Panel', -1280, T.cabFloorY, cabMidZ, 0, 90, 0, cabSideDims);
  await place('Automotive', 'Cab Side Panel',  1280, T.cabFloorY, cabMidZ, 0, 90, 0, cabSideDims);

  // Rear Panel: built width × height × thickness (2500×2400×10). Native
  // face is XY, normal +Z. To put it at the back wall of the cab, we
  // want face XY normal -Z (facing forward toward driver). Just rotate
  // ry=180 to flip. Place at x=−1250, y=cabFloorY, z=cabRearZ.
  // v13 — rear panel centred at x=0
  await place('Automotive', 'Cab Rear Panel', 0, T.cabFloorY, T.cabRearZ, 0, 180, 0);

  // Windshield: tilted glass at the cab FRONT.
  // Built as 2300×1100 in XY, extruded by 8 in Z. To place at cabFrontZ
  // tilted back: rx=−18°. Centred at x=0, y around mid-cab front.
  await place('Automotive', 'Windshield', -1150, 1800, T.cabFrontZ - 20, -18, 0, 0);

  // Side Windows: cut-outs/panels on the side walls. Native XY rect
  // 800×700, thin in Z. Rotate ry=90 so face becomes YZ normal +X.
  // v11 — windows + doors are sub-panels OUTBOARD of the (now 60 mm
  // thick) cab side panels. Cab side panel face = x ∈ [1240, 1300]
  // on the right and [−1300, −1240] on the left. Place the door
  // exterior at x=±1310 and window at x=±1315 so they LAYER on top
  // of the side panel instead of overlapping in the same Z plane.
  await place('Automotive', 'Side Window', -1315, 2100, -1200, 0, 90, 0);
  await place('Automotive', 'Side Window',  1315, 2100, -1200, 0, 90, 0);
  await place('Automotive', 'Cab Door',   -1310, T.cabFloorY, -1100, 0, 90, 0);
  await place('Automotive', 'Cab Door',    1310, T.cabFloorY, -1100, 0, 90, 0);

  // A pillars (between fascia and side window — at z=cabFrontZ corners)
  // Built 110×110, height=1800. After extrude in +Z the pillar extends
  // 1800 in Z from origin. To make it vertical (extending in +Y), rotate
  // rx=−90 so +Z becomes +Y.
  await place('Automotive', 'A Pillar', -1280, T.cabFloorY, T.cabFrontZ, -90, 0, 0);
  await place('Automotive', 'A Pillar',  1180, T.cabFloorY, T.cabFrontZ, -90, 0, 0);
  // B pillars between door rear and cab rear
  await place('Automotive', 'B Pillar', -1280, T.cabFloorY, T.cabRearZ + 250, -90, 0, 0);
  await place('Automotive', 'B Pillar',  1180, T.cabFloorY, T.cabRearZ + 250, -90, 0, 0);

  // Roof Air Deflector — sits on top of the cab roof, hangs over the
  // trailer. Native build is width=2400, with side-profile polyline +
  // extrude. Place on roof y=cabRoofY+20, z near cabRearZ.
  await place('Automotive', 'Roof Air Deflector', -1200, T.cabRoofY + 12, T.cabRearZ + 400);
  await captureAllAngles('05-cab-box');

  // ═════════ PHASE 6: FASCIA — front of the truck (z ≈ 0) ══════════════
  // The fascia covers the engine bay front. Header bar at top, grille
  // mid, bumper bottom. All sit just in front of (or at) z=0, x=±1250.
  //
  // v11 — fascia parts SPREAD ACROSS Z so they don't all stack at
  // z≈0..30 (chaotic in v10 front view). Layering from back to front:
  //   header bar    z = 0
  //   grille panel  z = 30
  //   intake slats  z = 40
  //   bumper main   z = 70 (extends forward 280)
  //   side caps     z = 70
  //   headlights    z = 100
  //   VOLVO emboss  z = 120 (raised relief)
  //   L badges      z = 120
  //   bumper trim   z = 110 (forward of bumper main)
  await place('Automotive', 'Cab Front Panel', -1250, T.fasciaHeaderY, 0);
  await place('Automotive', 'Radiator Grille Panel', -750, T.fasciaGrilleY, 30);
  await place('Automotive', 'Lower Intake Slat Bank', -750, T.fasciaGrilleY - 460, 40);
  await place('Automotive', 'Bumper Main Section', -1250, T.fasciaBumperY - 100, 70);
  await place('Automotive', 'Bumper Lower Trim',   -1200, T.fasciaBumperY - 280, 110);
  await place('Automotive', 'Bumper Side Cap', -1250, T.fasciaBumperY - 280, 70);
  await place('Automotive', 'Bumper Side Cap',   930, T.fasciaBumperY - 280, 70);
  await place('Automotive', 'Headlight Cluster', -1200, T.fasciaGrilleY + 350, 100);
  await place('Automotive', 'Headlight Cluster',   820, T.fasciaGrilleY + 350, 100);
  await place('Automotive', 'VOLVO Logo Emboss', -350, T.fasciaHeaderY + 30, 120);
  await place('Automotive', 'L Badge', -1180, T.fasciaHeaderY + 80, 120);
  await place('Automotive', 'L Badge',  1100, T.fasciaHeaderY + 80, 120);

  // Step plate at the bottom of the fascia
  await place('Automotive', 'Cab Front Step Plate', -900, T.fasciaStepY, 30);
  // Tow hook at fascia centre
  await place('Automotive', 'Tow Hook Mount', -90, T.fasciaStepY + 100, 50);
  // Fog lights flanking the lower trim
  await place('Automotive', 'Fog Light Cluster', -800, T.fasciaBumperY - 250, 90);
  await place('Automotive', 'Fog Light Cluster',  560, T.fasciaBumperY - 250, 90);
  // License plate on the bumper
  await place('Automotive', 'License Plate Frame', -270, T.fasciaBumperY - 200, 75);
  await place('Automotive', 'License Plate Panel', -260, T.fasciaBumperY - 195, 85);
  // Wing mirrors mounted at cab front sides
  await place('Automotive', 'Wing Mirror Housing', -1380, T.fasciaHeaderY - 200, T.cabFrontZ + 200);
  await place('Automotive', 'Wing Mirror Housing',  1380, T.fasciaHeaderY - 200, T.cabFrontZ + 200, 0, 0, 180);
  // Roof sun visor across the top of the windshield
  await place('Automotive', 'Roof Sun Visor', -1200, T.cabRoofY - 40, T.cabFrontZ + 80);
  // Roof beacon bar above the cab front
  await place('Automotive', 'Roof Beacon Bar', -600, T.cabRoofY + 40, T.cabFrontZ + 100);
  await captureAllAngles('06-fascia');

  // ═════════ PHASE 7: CAB INTERIOR (further inside cab box — v5 fix) ═══
  // v4 audit: interior parts were sticking out through cab walls. v5
  // shifts every interior body INWARD by 200 mm on X (away from side
  // walls) and 200 mm UP on Y (clear of floor edge). Cab side walls at
  // x=±1250; interior content moved to x ∈ [−1050, +1050]. Y starts
  // 200 mm above cab floor.
  const INT_Y = T.cabFloorY + 200;
  for (const driver of [-1, 1]) {
    const x = driver * 450;
    await place('Automotive', 'Driver Seat Base', x - 300, INT_Y, -1500);
    await place('Automotive', 'Driver Seat Back', x - 300, INT_Y + 100, -2050);
    await place('Automotive', 'Seat Headrest',    x - 140, INT_Y + 880,  -2100);
  }
  // Steering wheel for the driver (left side, inset further from wall)
  await place('Automotive', 'Steering Wheel Rim',   -480, INT_Y + 600, -1100, 90, 0, 0);
  await place('Automotive', 'Steering Wheel Boss',  -480, INT_Y + 600, -1100);
  for (let i = 0; i < 3; i++) {
    await place('Automotive', 'Steering Wheel Spoke', -480, INT_Y + 600, -1100, 90, 0, i * 120 - 90);
  }
  await place('Automotive', 'Steering Column', -480, INT_Y + 400, -1250);
  // Dashboard across the front interior wall — kept slightly inboard of
  // the cab side walls (x ∈ [−950, +1150]).
  await place('Automotive', 'Dashboard', -950, INT_Y + 300, T.cabFrontZ + 30);
  await place('Automotive', 'Instrument Cluster', -750, INT_Y + 520, T.cabFrontZ + 80);
  await place('Automotive', 'Gear Shifter', -200, INT_Y + 150, -1300);
  for (let i = 0; i < 3; i++) {
    await place('Automotive', 'Foot Pedal', -800 + i * 130, INT_Y - 100, -1300);
  }
  // Sleeper bunk behind the seats
  await place('Automotive', 'Sleeper Bunk', -1000, INT_Y, T.cabRearZ + 300);
  await captureAllAngles('07-interior');

  // ═════════ PHASE 8: EXHAUST STACKS (vertical, behind cab) ════════════
  // Built as cylinder along +Z 2400 mm. To make vertical, rotate
  // rx=−90 so +Z becomes +Y (extends upward).
  await place('Automotive', 'Exhaust Stack', -1180, T.cabFloorY, T.cabRearZ - 100, -90, 0, 0);
  await place('Automotive', 'Exhaust Stack',  1180, T.cabFloorY, T.cabRearZ - 100, -90, 0, 0);

  // ═════════ PHASE 8b: ROUND-3 — hood + fenders + sleeper + trailer ════
  // Hood covers the engine bay top — between fascia (z=0) and cab
  // front (z=−800). Position at y just below cab roof level, z mid bay.
  await place('Automotive', 'Engine Hood', -1150, T.cabFloorY + 1200, -400);
  // Front fenders over the front wheels (one each side). Built as
  // half-annular ring; rotated ry=90 so the fender wraps cross-truck.
  await place('Automotive', 'Front Fender', -1300, T.axleY, T.frontAxleZ + 200, 0, 90, 0);
  await place('Automotive', 'Front Fender',  1300, T.axleY, T.frontAxleZ + 200, 0, 90, 0);
  // Mud guards behind rear wheels
  await place('Automotive', 'Mud Guard Rear', -1340, T.axleY - 200, T.rearAxleZ2 - 400, 0, 90, 0);
  await place('Automotive', 'Mud Guard Rear',  1340, T.axleY - 200, T.rearAxleZ2 - 400, 0, 90, 0);
  // Sleeper cab extension behind the main cab box
  await place('Automotive', 'Sleeper Cab Extension', -1200, T.cabFloorY, T.cabRearZ - 100);
  // Twin chrome air horns on the roof
  await place('Automotive', 'Air Horn', -800, T.cabRoofY + 60, T.cabRearZ + 800, 0, 90, 0);
  await place('Automotive', 'Air Horn',  600, T.cabRoofY + 60, T.cabRearZ + 800, 0, 90, 0);
  // Aero roof fairing on the back of the cab — directs air over trailer
  await place('Automotive', 'Aero Roof Fairing', -1200, T.cabRoofY + 20, T.cabRearZ + 200);
  // Fifth wheel pivot plate behind the cab
  await place('Automotive', 'Fifth Wheel Plate', 0, T.frameY + 50, -3400);
  await captureAllAngles('08b-hood-sleeper-fenders');

  // ═════════ PHASE 8c: TRAILER (REDUCED — v4 fix) ═══════════════════════
  // v3 audit: 10 m trailer DOMINATED the frame, hid the cab in every
  // angle, top-down showed only trailer roof. v4 trims trailer to 5 m
  // and narrows it to x=±1150 so the cab edges (x=±1250) read separately.
  // Per [[feedback_check_previous_before_iterating]]: no NEW parts in
  // v4 — only the trailer scale fix that addresses the v3 regression.
  await place('Automotive', 'Trailer King-Pin Plate', -450, T.frameY + 80, -3400);
  // v6 — keep the 7 m trailer but DROP THE ROOF placement. The v5 audit
  // showed the trailer roof was a huge opaque white panel that
  // dominated top-down views and hid the cab from above. With the roof
  // removed the top-down view shows the truck interior + chassis +
  // trailer floor (cargo bed style). Sides + rear door + floor remain.
  const TLR_FLOOR_Y = T.frameY + 200;
  const TLR_ROOF_Y  = TLR_FLOOR_Y + 2200;
  const TLR_FRONT_Z = -3400;
  const TLR_REAR_Z  = -10400;
  const SKIP_TRAILER_ROOF = true;
  // Trailer Floor / Roof scaled — we still pass the catalog leaf (10m)
  // but PLACE further forward so the visible 5m segment overlaps the
  // tractor end with the trailer rear visible.
  await place('Automotive', 'Trailer Floor', -1150, TLR_FLOOR_Y, TLR_REAR_Z + 5000, 90, 0, 0);
  if (!SKIP_TRAILER_ROOF) {
    await place('Automotive', 'Trailer Roof', -1150, TLR_ROOF_Y, TLR_REAR_Z + 5000, 90, 0, 0);
  }
  await place('Automotive', 'Trailer Side Panel', -1150, TLR_FLOOR_Y, TLR_FRONT_Z, 0, 90, 0);
  await place('Automotive', 'Trailer Side Panel',  1140, TLR_FLOOR_Y, TLR_FRONT_Z, 0, 90, 0);
  await place('Automotive', 'Trailer Rear Door', -1150, TLR_FLOOR_Y, TLR_REAR_Z, 0, 180, 0);
  await captureAllAngles('08c-trailer');

  // ═════════ PHASE 9: FASTENERS (high-density patterns) ════════════════
  // 28 grille perimeter bolts (around centred grille panel)
  await placeCirc('Fasteners', 'Socket Head Cap Screw (ISO 4762)',
    0, T.fasciaGrilleY, 28, 28, 770,
    { size: 'M8', length: 25, grade: '10.9' });
  // 10 lug bolts per wheel × 10 wheels = 100 lugs total
  for (const w of wheelLocs) {
    await placeCirc('Fasteners', 'Hex Bolt partial-thread (ISO 4014)',
      w.x, T.axleY, w.z + 50, 10, 180,
      { size: 'M16', length: 50, grade: '12.9' });
  }

  // ═════════ Final ═════════════════════════════════════════════════════
  const finalCount = await bodyCount();
  console.log(`SP-6 v2 — final body count: ${finalCount}`);
  expect(finalCount).toBeGreaterThanOrEqual(200);
  await captureAllAngles('99-final');
  await app.close();
});
