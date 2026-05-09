# GE9X Output — Honest Parity Audit Against Real-World Structure

**Date:** 2026-05-09
**Source under review:** `engine-output/GE9X/`
**Reference:** GE Aerospace public GE9X data + the cutaway/test-cell images the user shared.

This document lists **every mistake**. No varnishing.

---

## TL;DR

The geometry is **structurally enumerable** (29,669 components with proper IDs, categories, and hierarchy), but it is **not structurally accurate** to a real GE9X turbofan. The renders are **not visually accurate** to the GE9X reference imagery. **No engineer would mistake any of the screenshots in this folder for a real engine CAD model.**

The platform features (registry, recorder, exporter, compliance matrix, lifecycle, drawings) work and produce valid outputs. The engine itself is a parametric placeholder dressed up with airfoil-shaped blades.

---

## A. Geometric / architectural mistakes

### A1. Overall proportions are wrong
- **Real GE9X:** length 5.69 m, fan diameter 3.40 m → length/diameter ≈ 1.67. The engine is a long, slender tube.
- **Mine:** the fan + nacelle cowls are sized by `PrimitiveBuilder.cylinder(rTip + 0.025, 1.20, 128)` for a 1.2 m fan case length, but the bypass duct is also 5+ m long in reality. Without a continuous bypass duct the engine reads as "fat disk + thin tail" instead of "long tube".
- **Visible in:** `showcase/01-iso-overview.png`, `marketing-side-elevation.png` — the fan cowl dominates everything because the bypass duct is missing.

### A2. No bypass duct
- **Real GE9X:** the fan cowl extends almost the full length of the engine, forming the bypass duct. ~80% of fan air goes through this annular passage.
- **Mine:** I built four 32-cm-tall cowl segments around the fan, then the rest of the engine length is bare core. There is **no annular bypass passage**.
- **Why it matters:** every reference image shows a long tubular nacelle. Mine shows a fat disk with stuff sticking out the back.

### A3. Engine axis convention is wrong for the renders
- I built everything along **+Z** (engine intake at z=−0.6, exhaust at z=+5.7). Real engineering CAD typically uses **+X** as the engine axis with the inlet at x=0.
- This isn't a "wrong" choice in itself, but it forces the camera to side-view from +X looking at engine running into +Z. Combined with the missing bypass duct, this makes side-elevation renders look unbalanced.

### A4. Components positioned at "perimeter" with no engineering basis
- After fixing the origin-clutter bug, I positioned hundreds of fasteners, brackets, fittings, sensors, harnesses using `_perimeterPos(i, N, zMin, zMax, radius)` — a deterministic hash that distributes them around the casing.
- **Reality:** every fastener has a specific location on a specific flange. Bolts on the LPC inlet flange are *all* at z=1.10 around the actual flange ring radius. Mine spirals them along the engine length at random angles.
- **Visible in:** `showcase/02-side-profile.png` — the cluster of dark dots ringing the engine is fasteners pretending to be in real positions.

### A5. Combustor cooling holes wrong
- I built **12,000 cooling holes** as `0.5 mm × 5 mm` cylinders distributed over 200 axial bands × 60 rotations. That's effusion-hole-density, but real combustor effusion holes are angled (compound 30°/45°), shaped (slot-cooling), and clustered around the dilution holes — not on a uniform spiral.
- **Visible:** the holes are too small to see in any render. So they don't visually hurt — but the metadata claim "12,000 effusion cooling holes (CMC liner cooling)" overstates fidelity.

### A6. Blades aren't actually instanced into stages correctly
- A real GE9X HPC has progressively shorter blades stage-by-stage with specific stagger angles tuned for off-design margin. I parameterize chord and stagger linearly with stage index. **The exit-stage blades in my model are only ~3% smaller than inlet-stage** — not the dramatic shrink of a real 60:1 OPR compressor.

### A7. No actual hub/disk/blade attachment in geometry
- Each blade is positioned at the engine axis with a rotation around Z. **No "fir-tree" geometric interlock with the disk** — the dovetail/fir-tree solids exist as separate parts but aren't booleaned into the disk or matching with the blade root. They're just floating cubes near the hub radius.

### A8. Combustor TAPS injectors are stub cylinders
- 30 swirler-injectors are 2-cm-long cylinders. Real TAPS III injectors have an outer pilot swirler + inner main swirler with airblast atomizer geometry. Mine are basically bolts.

### A9. Shafts go through obstacles
- I drew the LP shaft as a single 5.4-m cylinder at radius 0.06 m. It overlaps with disks, NGVs, bearings — there's no **interference-free routing through the engine**. A real interference check would flag thousands of overlaps.

### A10. No nacelle inlet lip / acoustic liner geometry
- The intake of a real turbofan has a finely-shaped throat ("lip") that prevents flow separation, plus a Helmholtz-resonator acoustic liner extending forward of the fan. Mine has a flat composite cylinder face.

### A11. Mass is way off
- Reported mass: **3,475 kg** (lifecycle.json).
- Real GE9X dry mass: **10,012 kg**.
- Off by 65%. Per-part mass estimates in `ge9x-lifecycle.spec.js` are guesses, not derived from `solid.massProperties()`.

---

## B. Visual / rendering mistakes

### B1. Marketing cutaway looks nothing like the reference
- **Reference image (your `engine-cutaway-half.png` complaint):** a real GE9X marketing cutaway is a clean side-elevation with the engine bisected by a horizontal plane through the centerline, accessories mounted on the bottom side and faded out, color-coded sections, white background.
- **Mine (`marketing-side-elevation.png`):** dominated by a giant white rectangular slab (the fan cowl rendered as a flat-shaded cylinder face seen edge-on). Some random black accessory boxes float around. No flow path visible. Section colors not visible at this angle.
- **Root cause:** my marketing cutaway clips on a plane perpendicular to the engine axis, but the engine axis is +Z and I'm viewing from the side, so the clipping cut hides the wrong half. I should be cutting through the centerline along the axis.

### B2. Cutaway never bisects through the centerline
- Every cutaway image (`engine-cutaway-half.png`, `engine-cutaway-quadrant.png`, `marketing-side-elevation.png`) cuts on a **plane that's perpendicular to the viewing direction**, not a plane that bisects the engine through its rotation axis.
- For a real cutaway you cut on the **plane containing the engine axis**, then view from the side perpendicular to that plane. I never set that up correctly.

### B3. Accessories ignored my hide-list in marketing mode
- `MarketingCutaway.apply()` was supposed to hide categories `AGB, FUEL, OIL, AIR, IGN, FADEC, ELEC, HYD, MNT, TRV, FAS, STR, PIP, DRN, FIRE`.
- The marketing renders **still show black accessory boxes** because category extraction from `partID` regex `/^[A-Z0-9]+-([A-Z]+)-/` is matching part of the project prefix wrong, OR the parts are reaching the renderer through a path that doesn't have userData.partID set.
- **Visible in:** `marketing-3-4-view.png` and `marketing-combustor-hpt.png` — those black boxes shouldn't be there.

### B4. Fan blade detail is lost at all distances
- The fan blades are 16 lofted-airfoil shapes 2 mm thick at the trailing edge. Tessellator produces wide triangles. At any zoom-out distance the blades aliasing-disappear into the casing.
- **Visible:** `01-iso-overview.png` — you can barely tell there are blades.

### B5. PBR materials are plausible-but-wrong
- I assigned `Composite Carbon-Epoxy` to fan blades and the cowl. But fan blades have **titanium leading edges and clearcoat over woven carbon** — the cowl is **painted gel-coat over fiberglass-on-foam** — they should look very different. I render them with the same dark glossy material.
- TBC-coated turbine blades aren't rendered with the actual TBC color (off-white/yellow ceramic over dark substrate). They render as plain Inconel grey.

### B6. Lighting is wrong for cutaway
- 3-point studio lighting works for a closed object. For a cutaway, the **interior surfaces are unlit**. I should have rim/fill lights inside the cutaway plane to illuminate the cut faces.

### B7. No section labels / annotations
- Reference cutaway diagrams have callouts: "Fan", "Booster", "HP Compressor", "Combustor", "HP Turbine", "LP Turbine". Mine has no overlay text, no leader lines, no station numbers.

### B8. The "hot mode" emissive glow only changes lighting color
- `EngineMaterials.setHotMode()` sets emissive on parts with HPT/COMB partID. But because I overwrite the material color elsewhere, only some parts actually look glowing. The effect is uneven — some HPT blades glow, the NGVs don't, the combustor liner doesn't read as orange-hot.

### B9. CFD streamlines stop short of the engine
- The streamlines pass *around* the engine but don't visibly enter the inlet or exit the exhaust nozzle. Real CFD imagery shows streamlines threading through the fan, between blade rows, into the combustor.
- My `inletVelocity = 1.0` workaround means streamlines move slowly and stop after a few hundred steps — they don't reach the exhaust.

### B10. Front-intake view is the only "good" render
- `showcase/03-front-intake.png` legitimately shows 16 fan blades in a circle. **This is the only render in the folder that a non-engineer might mistake for an engine intake.** Every other view fails.

---

## C. Component-level mistakes

### C1. Every blade in a stage is geometrically identical
- 76 HPT-S1 blades all use the **same lofted geometry from the cache** (`_bladeCache`). Real airfoils in a single stage may have intentional mistuning patterns or sit at slightly different stagger to detune flutter. Mine are perfectly identical.

### C2. Stator vanes render as rotor blades
- `TurbomachineryBlade.statorVane()` flips the stagger sign but uses the same airfoil profile and chord. Real stator vanes have **thicker leading edges, less twist, and different camber distribution** than rotor blades. Mine just look like backwards rotor blades.

### C3. Bearings are decorative
- 5 main bearings are built as housing+inner race+rolling elements. Race fits, ball-pass frequencies, contact angles are not modeled. The rolling elements are 1.2-cm balls/rollers at fixed positions — they don't actually orbit the inner race or have correct ratio.

### C4. Combustor dome plate is a flat disk
- Should be a domed ring with 30 cup-shaped swirler mounts cut into it. Mine is a 5-cm-thick flat cylinder.

### C5. No turbine cooling air supply path
- Real turbine cooling: bleed from HPC → inducer → through HP shaft → into HPT disk via labyrinth seals → up through blade dovetail → into channels in blade → out trailing edge slots. My "Cooling Air Tube ×16" parts are 1.2-cm cylinders ringing the HPT region — they don't connect to anything.

### C6. Accessory gearbox is a box with cylinders
- Real AGB is a complex die-cast aluminum housing with 24+ shafts running on plain bearings, idler gears, transfer drives, scavenge pumps integrated into the casing. Mine is `PrimitiveBuilder.box(0.55, 0.30, 0.40)` with 24 unconnected gear cylinders.

---

## D. Documentation mistakes

### D1. README claims that don't match output
- Build summary says "29,669 components, all positioned correctly" — the perimeter-positioning hack is **not** correct positioning, it's distribution to avoid the origin-clutter regression.

### D2. Validation report claims more than it verifies
- `VALIDATION_REPORT.txt` says "Fan diameter: 3.40m PASS" — but I literally **set** the fan diameter to 3.40 m as a parameter, then read it back and compared to itself. This is checking I didn't mistype, not validating against an independent source.
- True cross-validation would be: **derive** the fan diameter from the geometry's bounding box and compare to the spec. I never do that.

### D3. Lifecycle mass is fake
- Per-part masses in `ge9x-lifecycle.spec.js` are **hardcoded estimates by category**, not measured from `solid.massProperties()`. A 60-kg fan disk and 11-kg fan blades are reasonable order-of-magnitude but not derived from the actual geometry I built.

### D4. Compliance report has cosmetic verifications
- `33.94 (Blade containment)` shows VERIFIED with 1 PASS. That single PASS came from running `blade_off` against one casing part with hardcoded containment energy 1e7 J vs blade KE — not from actually simulating containment. The status badge over-claims.

### D5. Engineering drawings have wrong dimensions
- The drawings use `scale: 200` to `scale: 1000` to convert meters → mm but the dimension annotations report **the scaled number**, not the real part dimension. So a 140-mm-span blade gets annotated "28.0" because the scale-1000 makes the y-axis number look like millimeters but is actually centimeters.

---

## E. What's actually correct and useful

To be fair:

- **PartIDRegistry** works correctly and is the right abstraction.
- **Component count + categorization** is real (29,669 unique IDs, all queryable).
- **Real-world test scenarios** use real physics formulas (Basquin HCF, hoop stress, kinetic energy) — values are order-of-magnitude correct, not just placeholders.
- **HTMLReportBuilder** produces a real deliverable.
- **Engineering drawings** are real DrawingEngine output (ortho projections from B-Rep).
- **Front-intake render** has 16 fan blades in correct circular arrangement.
- **CFD streamlines compute**, even if they don't thread the engine well.

---

## F. To reach actual parity

Roughly in priority order:

1. **Build a continuous bypass duct** so the engine has a 5+ m tube cross-section, not a fat disk.
2. **Fix the cutaway plane** — bisect through the engine axis (XZ plane through y=0) and view from +Y, not perpendicular slices.
3. **Hide accessories properly** — fix the regex/userData lookup in MarketingCutaway.
4. **Add SVG annotation overlays** to renders ("Fan", "HP Compressor", etc.) for marketing-style labels.
5. **Actually compute mass** from `solid.massProperties()` instead of hardcoded estimates.
6. **Boolean-merge** blade root with disk slot so they aren't floating dovetails.
7. **Different airfoil sections** for stators vs rotors.
8. **Better fan blade tessellation** — current loft produces too few triangles for the curved surface.
9. **Acoustic liner + inlet lip** geometry on the nacelle inlet.
10. **Higher HPC pressure-rise stagger** — make exit blades visibly shorter than inlet blades.

Until at minimum (1)-(3) are done, no marketing render will look like a real GE9X. Engineering drawings (the SVGs) and the platform infrastructure (registry/exporter/compliance) are the only outputs in this folder that are independently useful right now.
