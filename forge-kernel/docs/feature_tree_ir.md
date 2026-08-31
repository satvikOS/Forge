# Feature-Tree IR — Archie's declarative CAD emission target

This is **THE** thing Archie (the 30B VLM) is trained to emit: a compact, typed,
line-oriented **feature-tree IR**. A C++ compiler (`forge::ft`) parses it and
walks it into **native forge-kernel** calls to build a true 3D solid and export
STEP. It replaces the scrapped scope-plan-JSON / build123d path.

```
Archie (VLM)  ->  feature-tree IR text (this grammar)
              ->  forge::ft::parse()      (text  -> FeatureTree)
              ->  forge::ft::compile()    (walks it -> native kernel ops)
              ->  real watertight TopoDS solid  ->  forge::io::exportStep
```

Everything is C++ and native. No OCCT/build123d/CadQuery **runtime** dependency —
the v18 `nk.py` builders (`p101/p102/.../p147`) were read only to ground the
**semantic op vocabulary** this IR must cover (organic castings, sheet-metal
trays, bracket housings, impeller-class parts — not just primitives).

- IR + API: `include/forge/ft/FeatureTree.hpp`
- Compiler: `src/ft/FeatureTreeCompiler.cpp`
- N-API surface: `forge.ft.compile(irText[, outStepPath])` (`src/ft/binding_ft.cpp`)
- Smoke test: `test/ft/ft_smoke.mjs`

## Value model

Every op produces exactly one value, addressed by its `%id` (creation order,
like the v18 builders' `body = nk.op(body, ...)` chain). A value is either:

- **PROFILE** — a 2D sketch/face on the Z=0 plane (a kernel `SketchHandle`),
  consumed by `EXTRUDE` / `REVOLVE`.
- **WIRE** — a closed 3D section ring placed anywhere in space (a `TopoDS_Wire`
  `ShapeHandle` via `part::profileWire`), consumed by `LOFT`. This is what a
  real vertical/organic loft needs — the always-Z=0 sketcher can't put a section
  at a different height/plane. Produced by `RING` / `WIRE`.
- **SOLID** — a 3D body (a kernel `ShapeHandle`), consumed by booleans /
  transforms / features and exported.

The compiler type-checks every reference and **fails loudly** with the offending
`%id` if an op gets the wrong value kind or an undefined ref (it never silently
degrades).

## Grammar

One statement per line:

```
%<id> = OP(arg, arg, ...)     # an op; %id is its 1-based creation id
RESULT(%<id>)                 # optional; else the LAST solid produced is the result
# comment                     # '#' to end-of-line, and blank lines, are ignored
```

Args are **positional** and comma-separated. Trailing args have **defaults**
(a Z-axis cylinder at the origin is just `CYL(r, h)`). Token forms:

| form      | example                | meaning                              |
|-----------|------------------------|--------------------------------------|
| number    | `3.5` `-12` `139.2`    | a scalar                             |
| ref       | `%7`                   | a prior op's value                   |
| keyword   | `ALL` `VERTICAL` `POLAR`| a bare selector / mode identifier   |
| points    | `[x y; ...]` `[x y z; ...]`| a 2D or 3D point ring (POLY/WIRE/SWEEP) |

Angles are **degrees**. Positions/axes are world-space. The convention (from the
v18 builders): primitives are **centred in XY** and sit with their base at `cz`,
extending along `+axis`.

## Op set

### 2D profiles (produce a PROFILE)

| op | args (defaults in `[]`) | native call |
|----|--------------------------|-------------|
| `RECT`    | `w, h [, cx=0, cy=0]` | sketch: 4 lines |
| `RRECT`   | `w, h, r [, cx=0, cy=0]` | sketch: 4 lines + 4 arcs (real cylindrical corners) |
| `CIRCLE`  | `r [, cx=0, cy=0]` | sketch: `addCircle` |
| `SLOT`    | `len, wid [, cx=0, cy=0, angleDeg=0]` | sketch: 2 lines + 2 arc caps (obround) |
| `POLY`    | `[x y; x y; ...]` | sketch: N lines (organic silhouette) |
| `REGPOLY` | `r, n [, cx=0, cy=0, rotDeg=0]` | sketch: n-gon |

### 3D section rings (produce a WIRE — a loft cross-section placed in 3D)

| op | args (defaults in `[]`) | native call |
|----|--------------------------|-------------|
| `RING` | `rx, ry, z [, cx=0, cy=0, p=2, seg=48]` | `part::profileWire` — superellipse ring `\|x/rx\|^p+\|y/ry\|^p=1` sampled to `seg` pts at height `z`. `p=2` circle/ellipse; `p=4..6` rounded-rect (impeller/nozzle/duct sections). |
| `WIRE` | `[x y z; x y z; ...]` | `part::profileWire` — explicit closed 3D ring (airfoil / organic / sharp-cornered section). |

### 3D primitives (produce a SOLID)

| op | args | native call |
|----|------|-------------|
| `BOX`    | `dx, dy, dz [, cx=0, cy=0, cz=0]` | `makeBox` + `translate` (centred XY) |
| `CYL`    | `r, h [, cx=0, cy=0, cz=0, axx=0, axy=0, axz=1]` | `makeCylinder` + orient/translate |
| `CONE`   | `r1, r2, h [, cx, cy, cz, axx, axy, axz]` | `makeCone` |
| `SPHERE` | `r [, cx=0, cy=0, cz=0]` | `makeSphere` |
| `TORUS`  | `major, minor [, cx, cy, cz, axx, axy, axz]` | `makeTorus` |
| `PRISM`  | `nSides, circumR, h [, cx, cy, cz]` | `makePrism` |
| `TUBE`   | `rOuter, rInner, h [, cx, cy, cz]` | `makeTube` |

### Sketch / wire → solid

| op | args | native call |
|----|------|-------------|
| `EXTRUDE` | `%profile, amount [, dirx=0, diry=0, dirz=1]` | `part::extrudeProfile` |
| `REVOLVE` | `%profile, angleDeg [, ox=0, oy=0, oz=0, axx=0, axy=1, axz=0]` | `part::revolveProfile`. Partial angle `0<a<=360` about an **arbitrary axis line** (validated: throws on out-of-range angle / zero axis). |
| `LOFT`    | `%w0, %w1 [, %w2 ...] [, RULED] [, OPEN]` | `loftguide::loft(wires, {}, solid, ruled)` over ≥2 **WIRE** sections. Default: BSpline-smoothed lateral skin + planar end caps. `RULED` = straight rulings; `OPEN` = uncapped shell. Fails loud if a ref is a PROFILE (use `RING`/`WIRE`). |
| `SWEEP`   | `r, [x y z; ...]`  **or**  `[x y; ...], [x y z; ...]` | number arg ⇒ `part::pipeFromPolyline` (circular pipe of radius `r` along the 3D path). A 2D profile ring ⇒ `part::sweepPolyline` (arbitrary profile along the 3D path). Both are the watertight native verbs (`part::sweep` collapses when profile+path are coplanar). |

### Booleans / transforms / replication

| op | args | native call |
|----|------|-------------|
| `FUSE`   | `%a, %b` | `fuse` |
| `CUT`    | `%a, %b` | `cut` |
| `COMMON` | `%a, %b` | `common` |
| `TRANSLATE` | `%a, dx, dy, dz` | `translate` |
| `ROTATE` | `%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0]` | `translate`∘`rotate`∘`translate` (arbitrary pivot) |
| `MIRROR` | `%a, PLANE`  **or**  `%a, px,py,pz, nx,ny,nz` | `part::mirrorPattern` — reflect across the plane and **FUSE with the original** (symmetrize). `PLANE` = `XY`/`YZ`/`XZ` (through origin), else explicit point+normal. |
| `PATTERN` | `%a, LINEAR, n, dx [, dy=0, dz=0]`<br>`%a, POLAR, n, totalAngleDeg [, ox,oy,oz, axx,axy,axz=+Z]`<br>`%a, GRID, nx, ny, dx, dy` | `part::linearPattern` / `circularPattern` (GRID = two orthogonal linear passes). Counts are **total** instances (incl. original), all fused. POLAR step = `totalAngle / n` (use `360` for a full ring). |

### Features

| op | args | behaviour |
|----|------|-----------|
| `HOLE`    | `%body, dia, cx, cy, cz [, axx=0, axy=0, axz=1, depth]` | `makeCylinder` cutter + `cut`. `depth<=0` (default) ⇒ **through** (cutter sized from the body's bbox diagonal). |
| `CBORE`   | `%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axis=+Z]` | through pilot + coaxial counterbore recess from the entry face. |
| `FILLET`  | `%body, radius [, sel=ALL]` | select edges by `sel`, `part::filletEdges` with retry-shrink. |
| `CHAMFER` | `%body, dist [, sel=ALL]` | select edges by `sel`, `part::chamferEdges`. |
| `BLEND`   | `%body, rStart, rEnd [, sel=ALL] [, SMOOTH]` | variable-radius fillet: radius sweeps `rStart→rEnd` along each selected edge (`varfillet::fillet`, linear law; `SMOOTH` = C¹ S-law), retry-shrink like FILLET. |
| `SHELL`   | `%body, wall [, openAxx=0, openAxy=0, openAxz=-1]` | hollow inward, opening the largest face facing the open axis (`part::shell`). |
| `FOLD`    | `%body, hx, hy, hz, len, flangeH, thk, angleDeg [, runDeg=0]` | sheet-metal flange **macro** — `makeBox` + `rotate`-about-hinge + `fuse`. Hinge starts at `(hx,hy,hz)`, runs `len` along XY dir `runDeg`; a `len×flangeH×thk` wall folds up `angleDeg` about the hinge (90 ⇒ vertical). Place the hinge on a plate edge with `w = ẑ×û` pointing off the plate. |
| `HEAL`    | `%body` | `heal::simplifyShape` (unify faces/edges). |

**Pattern / mirror note:** `PATTERN` and `MIRROR` operate on a whole SOLID and
fuse the copies. To replicate just a *feature* (a boss, a blade), build the
feature as its own solid, `PATTERN`/`MIRROR` **it**, then `FUSE` the base — see
the impeller example (`ft_organic_smoke.mjs`).

**Edge selectors** (`sel`): `ALL`, `VERTICAL` (Z-parallel straight edges — plate
corner / boss blends), `RIM`/`HORIZONTAL` (constant-Z edges — end rims).

## Worked example — the p122 U-shaped fork / yoke bracket

Faithfully reduced from `_builders/p122.py` (rounded-rect U-plate, deep boss hub,
Ø74.8 open-U notch, two arm eye collars, three through bores):

```
%1  = RRECT(93.3, 139.2, 10, 53.35, 69.6)   # U-plate footprint, corner r10
%2  = EXTRUDE(%1, 10)
%3  = TRANSLATE(%2, 0, 0, -5)               # centre the 10 mm web on z=0
%4  = CYL(12.5, 25, 12.5, 15.3, -12.5)      # boss hub Ø25 x 25 deep
%5  = FUSE(%3, %4)
%6  = CYL(37.4, 60, 54.7, 59.5, -30)        # Ø74.8 inner U curve (tall cutter)
%7  = BOX(64.2, 120, 60, 54.7, 119.5, -30)  # prong-gap slot up to the top
%8  = FUSE(%6, %7)
%9  = CUT(%5, %8)                            # carve the open U
%10 = CYL(12.5, 6, 14.9, 126, -3)           # left arm eye collar Ø25 x 6
%11 = FUSE(%9, %10)
%12 = CYL(12.5, 6, 87.5, 126, -3)           # right arm eye collar
%13 = FUSE(%11, %12)
%14 = HOLE(%13, 15, 12.5, 15.3, 0)          # boss bore Ø15 THRU
%15 = HOLE(%14, 18, 14.9, 126, 0)           # left eye Ø18 THRU
%16 = HOLE(%15, 18, 87.5, 126, 0)           # right eye Ø18 THRU
RESULT(%16)
```

Compiled result (measured by the compiler, `forge.ft.compile`):
**valid = true** (watertight/manifold/oriented, no self-intersect),
faceCount = 35, edgeCount = 112, volume = 56 116.8 mm³, bbox 100.00 × 139.20 ×
25.00 mm — matching p122's declared envelope `(100.0, 139.2, 25.0)`. The exported
STEP is a genuine AP242 analytic B-rep (1 `MANIFOLD_SOLID_BREP`, 35
`ADVANCED_FACE`, 17 `PLANE` + 10 `CYLINDRICAL_SURFACE`).

## Worked example — an impeller (freeform blades + polar array + hub)

The organic-frontier vocabulary: a freeform blade lofted between two 3D `WIRE`
sections, arrayed 6× about the axis, then fused to a hub. (From
`test/ft/ft_organic_smoke.mjs`.)

```
%1 = WIRE([15 -2 5; 40 -1 5; 40 1 5; 15 2 5])     # blade root section @ z=5
%2 = WIRE([15 -2 35; 38 3 35; 40 5 35; 17 1 35])  # twisted tip section @ z=35
%3 = LOFT(%1, %2)                # one freeform BSpline blade skin (solid)
%4 = PATTERN(%3, POLAR, 6, 360)  # 6 blades evenly around +Z (step 360/6 = 60°)
%5 = CYL(15, 40)                 # Ø30 hub, 40 tall
%6 = FUSE(%5, %4)
RESULT(%6)
```

And a round→square transition duct — three superellipse `RING` sections at
rising `z`, skinned by `LOFT`:

```
%1 = RING(20, 20, 0)             # Ø40 circular inlet at z=0
%2 = RING(18, 14, 25, 0, 0, 3)   # mid superellipse (p=3) at z=25
%3 = RING(15, 15, 50, 0, 0, 5)   # rounded-square outlet (p=5) at z=50
%4 = LOFT(%1, %2, %3)
RESULT(%4)
```

`ft_organic_smoke.mjs` carries one hand-authored part per new op (LOFT round/
square + blade, SWEEP pipe + duct, REVOLVE 270°, PATTERN LINEAR/POLAR/GRID,
MIRROR, BLEND, FOLD) as the exact serialized IR the VLM emits — the main-thread
build compiles + measures each post-train (hard gate `ok && volume>0`).

## Coverage (honest)

**Covered end-to-end and each individually verified building a `valid=true`
solid** (`forge.ft.compile`, this build): profiles
RECT / RRECT / CIRCLE / SLOT / POLY / REGPOLY; primitives
BOX / CYL / CONE / SPHERE / TORUS / PRISM / TUBE; EXTRUDE; REVOLVE (p147-style
disc, vol 250 062); FUSE / CUT / COMMON; TRANSLATE / ROTATE; HOLE (through +
blind, any axis); CBORE; FILLET / CHAMFER (on sharp-cornered bodies); SHELL
(hollow, verified 11-face box shell); HEAL. This directly expresses the v18
vocabulary: `waist_extrude`, cylinder hubs, boss/collar fuses, U-notch cut,
bolt-circle bores (explicit HOLE lists), pockets (CUT), revolved shrouds/meridians
(REVOLVE), organic silhouettes (POLY), obround slots (SLOT). The compiler's
type-checker + loud failure are verified: an unknown op, an undefined `%ref`, or a
profile-where-solid-expected each abort with the exact op/line id and never
silently degrade.

**Organic-frontier ops added (this build) — grammar + kernel mapping above:**
- `LOFT` (**real**) — now skins ≥2 **WIRE** sections placed at real 3D heights
  (`RING`/`WIRE` → `part::profileWire` → `loftguide::loft`), producing a genuine
  BSpline freeform skin + planar caps (impeller blades, transition ducts,
  nozzles). The old Z=0-degenerate `part::loft` path is retired; feeding a
  PROFILE to `LOFT` now fails loud.
- `RING` / `WIRE` — 3D loft-section producers (superellipse ring / explicit ring).
- `SWEEP` — circular pipe (`pipeFromPolyline`) or arbitrary-profile sweep
  (`sweepPolyline`) along a 3D polyline path (tubing, cast runners, manifolds).
- `PATTERN` — `LINEAR`/`POLAR`/`GRID` as a single op (`part::linearPattern` /
  `circularPattern`), replacing hand-enumerated instances (blade arrays,
  bolt-circles, fin combs, post grids).
- `MIRROR` — reflect+fuse (symmetrize) across a principal or arbitrary plane
  (`part::mirrorPattern`).
- `REVOLVE` — confirmed general: partial angle + arbitrary axis, now range/axis
  validated.
- `BLEND` — variable-radius fillet (`varfillet::fillet`), retry-shrink like FILLET.
- `FOLD` — sheet-metal flange as a `BOX`+`ROTATE`(about hinge)+`FUSE` macro
  (built only from verified ops).

**Still deferred / caveats (flagged, not faked):**
- `LOFT`/`SWEEP`/`BLEND`/`FOLD` freeform results: the compiler reports `valid`
  (watertight/manifold) but does **not** hard-guarantee it for every input —
  watertightness is geometry-dependent (a self-crossing airfoil ring, a fold that
  overlaps the plate, a BLEND radius the kernel declines). The op fails loud on
  kernel decline; the smoke test hard-gates only `ok && volume>0` for these and
  reports `valid` honestly. Each new op is **authored + clang `-fsyntax-only`
  verified**; the main-thread single-track build runs `ft_organic_smoke.mjs` to
  confirm the runtime geometry post-train.
- `RING` circular sections are polyline (`seg`-point) approximations of a circle —
  the loft *surface* between sections is true BSpline, but each cross-section is
  faceted at `seg` segments (default 48). For an exact analytic cone/cylinder use
  `CONE`/`CYL`, not a loft.
- `PATTERN`/`MIRROR` act on a whole SOLID (then fuse); replicate a lone *feature*
  by patterning it as its own solid before fusing the base.
- `FILLET` on an edge already adjacent to a rounded (cylindrical) corner face —
  OCCT `filletEdges` declines it; use a sharp RECT base, or fillet before rounding.
- **Guided** loft / sweep-with-guides (`loftWithGuides`, `sweepWithGuides`) and
  true multi-thickness shell exist in the kernel but are not yet wired to IR ops —
  the next slice for guide-curve-driven Class-A surfaces.
