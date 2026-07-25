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
  consumed by `EXTRUDE` / `REVOLVE` / `LOFT`.
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

| form      | example            | meaning                          |
|-----------|--------------------|----------------------------------|
| number    | `3.5` `-12` `139.2`| a scalar                         |
| ref       | `%7`               | a prior op's value               |
| keyword   | `ALL` `VERTICAL`   | a bare selector identifier       |
| points    | `[x y; x y; ...]`  | POLY outline ring (space+`;`)    |

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

### Sketch → solid

| op | args | native call |
|----|------|-------------|
| `EXTRUDE` | `%profile, amount [, dirx=0, diry=0, dirz=1]` | `part::extrudeProfile` |
| `REVOLVE` | `%profile, angleDeg [, ox=0, oy=0, oz=0, axx=0, axy=1, axz=0]` | `part::revolveProfile` |
| `LOFT`    | `%p0, %p1 [, %p2 ...]` | `part::loft` (ruled=false, closed=false) |

### Booleans / transforms

| op | args | native call |
|----|------|-------------|
| `FUSE`   | `%a, %b` | `fuse` |
| `CUT`    | `%a, %b` | `cut` |
| `COMMON` | `%a, %b` | `common` |
| `TRANSLATE` | `%a, dx, dy, dz` | `translate` |
| `ROTATE` | `%a, angleDeg, axx, axy, axz [, ox=0, oy=0, oz=0]` | `translate`∘`rotate`∘`translate` (arbitrary pivot) |

### Features

| op | args | behaviour |
|----|------|-----------|
| `HOLE`    | `%body, dia, cx, cy, cz [, axx=0, axy=0, axz=1, depth]` | `makeCylinder` cutter + `cut`. `depth<=0` (default) ⇒ **through** (cutter sized from the body's bbox diagonal). |
| `CBORE`   | `%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axis=+Z]` | through pilot + coaxial counterbore recess from the entry face. |
| `FILLET`  | `%body, radius [, sel=ALL]` | select edges by `sel`, `part::filletEdges` with retry-shrink. |
| `CHAMFER` | `%body, dist [, sel=ALL]` | select edges by `sel`, `part::chamferEdges`. |
| `SHELL`   | `%body, wall [, openAxx=0, openAxy=0, openAxz=-1]` | hollow inward, opening the largest face facing the open axis (`part::shell`). |
| `HEAL`    | `%body` | `heal::simplifyShape` (unify faces/edges). |

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

**Deferred / not yet covered (flagged, not faked):**
- `LOFT` is wired to `part::loft` but currently **degenerate**: all sketches live
  on the Z=0 plane, so a two-section loft has zero height (builds `valid` but
  `volume = 0`). A real vertical loft needs per-section 3D placement — route the
  sections through `part::profileWire` (3D point rings) instead of Z=0 sketches.
  This is the next slice for freeform/impeller-skin parts.
- `FILLET` on an edge already adjacent to a rounded (cylindrical) corner face —
  OCCT `filletEdges` declines it; use a sharp RECT base, or fillet before rounding.
- Organic **variable-radius** blends (`peanut_blend`), **radial-blade-array** and
  **polar/linear feature patterns** as single ops — today expressed by explicitly
  enumerating the placed instances (the v18 builders do the same via `nk.polar`);
  a `PATTERN` op mapping to `part::circularPattern` / `linearPattern` is the next
  slice.
- **Sheet-metal fold walls** as a first-class op — expressible now via
  EXTRUDE + ROTATE + FUSE (as p103/p106 do), but no dedicated `FOLD`/flange verb.
- **Freeform guided loft / sweep-with-guides** and `MIRROR` — kernel entry points
  exist (`loftWithGuides`, `sweepWithGuides`, mirror transform) but are not yet
  wired to IR ops.
