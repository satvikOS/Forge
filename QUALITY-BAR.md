# Forge Quality Bar

User-set visual/quality target ("the level of perfection required in the
viewport"), defined via reference imagery: GE GEnx / GE9X turbofan engines
(photoreal cutaway renders) and a professional mechanical part drawing
(bearing housing, multi-view + sections).

Every slice that touches the viewport, rendering, surfacing, assemblies, or
drawings is held to this bar. No stubs, no placeholders.

## 1. Viewport render quality (GEnx/GE9X bar)

- **PBR materials, photoreal**: polished + brushed metal (fan spinner,
  blades), carbon-fiber weave (fan case/containment), painted cast surfaces
  (green LPT case), anodized accents (orange seals/clamps), raw cast alloy
  (HP compressor drum, accessory gearbox). Metalness/roughness maps, not flat
  colors.
- **Class-A freeform surfaces**: the swept, twisted composite fan blades and
  the organic spinner are real NURBS continuity (G2+) work — not prismatic
  extrudes. Surfacing workbench must produce this class of geometry.
- **Studio lighting**: HDRI environment, soft contact shadows, real
  reflections, neutral gradient backdrop. KeyShot-grade.
- **Live section / cutaway**: section plane reveals internal stages with
  CAPPED cut faces (the cyan-capped reveal of compressor + turbine), not
  hollow shells.
- **Assembly density**: true 100,000+ component assemblies — thousands of
  stator vanes, full tubing/harness routing, fasteners — instanced and
  BVH-culled so it stays interactive.
- **Proper scaling**: model always framed and fully visible in the viewport
  (smart-fit), correctly scaled for the body extents.

## 2. Drawing quality (pro engineering-drawing bar)

- Orthographic + section views (SECTION A-A, F-F) with correct crosshatch on
  cut material.
- Detail views with scale callouts (DETAIL B, SCALE 2:1.5).
- Dimensioning with tolerance classes (e.g. Ø12.955 +.000/−.005), basic and
  reference dims.
- GD&T: datum references (A), feature control frames (⌀ ⊥ ⌖ with datum +
  tolerance), per ASME Y14.5.
- Hole callouts (16X Ø.394▼.610), counterbore/countersink/depth symbols.
- Thread specs (3/8 NPTF, 1/2 NPTF).
- Surface-finish symbols (63 / 32 / 125 µin Ra) placed on faces.
- Title block parametric fill; balloons + BOM synced to the feature tree.

## How slices verify against this bar

- Headed Playwright e2e captures multi-angle screenshots/MP4 of the actual
  rendered viewport; visual regressions are reviewed, not assumed.
- "Looks like the real part" is an acceptance criterion, not a nice-to-have.
