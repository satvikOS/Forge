# The native boolean engine

`forge::native::brep::booleanSolid` — the OCCT-free Fuse / Cut / Common on
analytic-face `brep::Solid`s, and the in-house replacement for
`BRepAlgoAPI_{Fuse,Cut,Common}`.

Everything below was MEASURED in this worktree on 2026-09-12 at `ddef657b`. Where
a number appears, the command that produced it is named. Where something is not
built, it says so in the same voice as the things that are.

The tree is not empty, so say what it is. At the start of re-verification
`git status --porcelain` listed no modified tracked file and **eight** untracked new
docs under `docs/kernel/` (this one plus the seven siblings written in the same batch)
— not one. Mid-session a concurrent agent in this shared worktree modified
`forge-desktop/CMakeLists.txt` (+53/−15). `git status --porcelain -- forge-kernel` was
empty throughout, and `forge-desktop` is built by neither `run_native.sh` nor the node
addon, so every number below is a number produced by `ddef657b`'s kernel sources.

## Where it lives, and what it links

| | |
|---|---:|
| `forge-kernel/include/forge/native/brep/Boolean.hpp` | 229 lines |
| `forge-kernel/src/native/brep/Boolean.cpp` | 1918 lines |
| OCCT include lines in those two files | **0** |

`wc -l` on both; `grep -c 'hxx'` on both for the OCCT count. The include grep is
the weak form of the claim. The strong form is that the code COMPILES AND LINKS
with no OCCT present at all: `forge-kernel/test/native/run_native.sh` builds every
source under `src/native/` — measured 156 files, 156 objects — with
`-std=c++20 -O2 -I forge-kernel/include`, no OCCT include path and no `-lTK*` at
link, and each boolean gate is linked against exactly that object set. `Boolean.cpp`
is one of the 156.

Read `OCCT_REMOVAL_TRACKER.md`'s "Topology / B-Rep — 578 OCCT include lines, 31
files" row with that in mind: the boolean's own two files contribute zero of those
578. They live in a directory that is not yet OCCT-free; they are.

## The entry point

```cpp
enum class BoolOp { Fuse, Cut, Common };          // Boolean.hpp:69-73

struct BooleanOptions {                            // Boolean.hpp:139-151
    double weldTol = 1e-7;
    double fuzz    = 0.0;   // the OCCT-free analogue of SetFuzzyValue
};

BooleanResult booleanSolid(const Solid& A, const Solid& B, BoolOp op,
                           const BooleanOptions& opts = BooleanOptions{});
```

The body is thirteen lines (`Boolean.cpp:1902-1914`) and it is the whole policy
(the elided lines are two diagnostic `fprintf`s):

```cpp
BooleanResult booleanSolid(const Solid& A, const Solid& B, BoolOp op,
                           const BooleanOptions& opts) {
    BooleanResult a = booleanSolidAnalytic(A, B, op, opts);
    if (a.ok) return a;
    ...
    return booleanSolidMeshFallback(A, B, op, opts);
}
```

Analytic first; on any analytic miss, the mesh arrangement, FLAGGED. There is no
third branch and no OCCT branch.

## `BooleanResult` — ten fields, and which path fills them

| field | analytic path | mesh fallback |
|---|---|---|
| `ok` | yes — closed-2-manifold validated | yes — closed-2-manifold validated |
| `reason` | `"ok (analytic cut)"` etc. | `"ok (mesh fallback)"` |
| `solid` / `owner` | yes | yes |
| `usedMeshFallback` | **false** (`Boolean.cpp:1611`) | **true** (`Boolean.cpp:444`) |
| `modifiedFromA` / `modifiedFromB` | yes (`Boolean.cpp:1787-1798`) | **empty** |
| `deletedA` / `deletedB` | yes (`Boolean.cpp:1802-1805`) | **empty** |
| `generatedEdges` | yes (`Boolean.cpp:1807`) | **empty** |

`booleanSolidMeshFallback` (`Boolean.cpp:441-461`) sets five fields and touches
none of the lineage vectors. That is the honest gap the header states: a planar-soup
reconstruction carries no analytic provenance.

### `usedMeshFallback` is a gate observable, not a runtime signal

`grep -rn usedMeshFallback forge-kernel/src forge-kernel/include` returns **7 lines**:
the two writes in `Boolean.cpp` (444, 1611); three in `Boolean.hpp` — the field
DECLARATION at 95 plus two comment lines (42, 102), not three comments; one
copy-through in `Pattern.cpp:224`; and one report to JS in `binding.cpp:945`.

**Nothing in production branches on it.** `src/Booleans.cpp:365` takes `booleanSolid`'s
result and registers it whether the cut was analytic or a planar triangle soup. So a
live regression to facets is visible to the C++ gates and invisible to the application.
That is a deliberate design — the flag exists so the gates can fail — but it should not
be mistaken for a runtime guard.

## What the analytic path refuses

`booleanSolidAnalytic` (`Boolean.cpp:1617`) declines in eight named places
(`grep -n 'fail.reason = ' Boolean.cpp`):

| line | reason |
|---:|---|
| 1625 | `analytic: empty face set` |
| 1633 | `analytic: A has non-quadric face` |
| 1634 | `analytic: B has non-quadric face` |
| 1669 | `analytic: a crossing pair has no closed-form SSI` |
| 1670 | `analytic: SSI returned a marched curve` |
| 1707 | `analytic: imprint of an A face failed (CDT)` |
| 1714 | `analytic: imprint of a B face failed (CDT)` |
| 1746 | `analytic: empty selection` |

and the stitch adds six more, e.g. `analytic stitch: edge not shared by exactly 2
faces`. Be precise about the grep here: `grep -n 'res.reason = ' Boolean.cpp` returns
**13** lines, not six. Six are the stitch (1404, 1483, 1485, 1488, 1566, 1570); six
belong to the mesh-operand core (457, 480, 496, 501, 504, 506) and one is the analytic
SUCCESS line (1610). Only the analytic-side `fail.reason` grep is a clean count.

The admission test is `kindOK` at `Boolean.cpp:1629-1632`: **Plane, Cylinder, Cone,
Sphere only**. A single NURBS or Torus face on either operand defers the whole
operation before any SSI is attempted. `grep -n 'Nurbs\|NURBS' Boolean.cpp` returns
exactly one line — a comment. `src/native/brep/NurbsSurfaceIntersect.cpp` exists and
is linked (`CMakeLists.txt:2268`, "K1.3 — NURBS-aware SSI ... removes the NURBS-face
deferral"), but **`booleanSolid` never calls it**. The NURBS deferral is removed at
the SSI layer and still present at the boolean layer.

### `!usedMeshFallback` does not mean "every cut curve was a conic"

The analytic gate is `r.allClosedForm` (`Boolean.cpp:1670`). In
`SurfaceIntersect.cpp` that flag is set to the marcher's `exact` out-parameter for
the two MARCHED families — skew/unequal-radius cylinder∩cylinder (line 769) and
offset cylinder∩sphere (line 790) — and `allExact` goes false only when a traced
vertex misses the residual by more than `1e-7` (`SurfaceIntersect.cpp:690`).

So a converged Newton-marched polyline passes as analytic, and the reason string
`"analytic: SSI returned a marched curve"` fires only on a march that did NOT
converge. This is not a defect: the imprint is a sampled polyline in the closed-form
case too, and the result sub-faces keep their parent analytic `Surface` either way,
so the FACE geometry is exact regardless. It is the sample points on the cut CURVE
that are exact-on-the-conic in one case and converged-to-1e-7 in the other. State it
that way rather than "closed form everywhere".

Closed-form pairs, marched pairs and deferred pairs are enumerated in
`SurfaceIntersect.hpp:21-47`. The deferred set is: **cone∩cone, cone∩cylinder,
cone∩sphere, every torus pair, anything NURBS** (`SurfaceIntersect.cpp:813-815`,
"Everything else ... is DEFERRED").

## Measured behaviour

`ONLY=brep/native_boolean_test bash forge-kernel/test/native/run_native.sh`, then
the face-kind lines printed by the gate (`/tmp/forge_native_brep_native_boolean_test.out`):

| fixture | faces | planar | quadric | `usedMeshFallback` | volume |
|---|---:|---:|---:|---:|---|
| box − box CUT (two 4³, offset 2,2,2) | 21 | 21 | 0 | 0 | 56.00000000 |
| bored plate CUT (10×10×2, Ø4 through, nSeg 64) | 70 | 6 | 64 cyl | 0 | 174.86725877 (= 200 − 8π) |
| box − sphere CUT (10³, r 3, nSeg 48) | 1158 | 6 | 1152 sph | 0 | matches 1000 − 36π |
| prism − cyl CUT (6-gon R4 h4, r 1.5, nSeg 64) | 72 | 8 | 64 cyl | 0 | — |
| box − cone CUT (8×8×6, cone r3 h6, nSeg 128) | 134 | 6 | 128 cone | 0 | matches 384 − 18π |
| skew cross-bore CUT (tilted cylinder through a block) | — | — | — | **1** | matches Monte-Carlo to 1.2e-2 |

The bored plate is the shape of the whole claim. Its 70 faces are 6 planar faces —
4 sides plus a top and a bottom that each survive WHOLE, carrying an inner hole loop —
and 64 cylindrical sectors that all carry the SAME analytic `Cylinder` `Surface`.
`native_boolean_test.cpp:533` asserts the sector count is exactly `nSeg`, and
`native_sequential_holes_test.cpp:203` asserts the face count grows by exactly `nSeg`
per hole, so the wall is not a fan and the plate does not explode as holes are added.

Be exact about what that does and does not settle against `MIGRATION.md`'s
face-identity criterion. The GEOMETRY is one cylinder: the volume comes out at
174.86725877 against an analytic 200 − 8π, integrated with the cylinder's own
Jacobian rather than summed over chords. The TOPOLOGY is still `nSeg` faces — a
shared `Surface*`, not a single `Face`. "Select the bore" is therefore a
surface-identity query here, not a face pick, and nothing measured in this document
proves a downstream feature can make it.

Two corrections to the header prose in `Boolean.hpp`, both measured:

* `Boolean.hpp:35-36` says a box−cylinder through-bore yields "5 planar box faces".
  It is **6** — measured above, and asserted outright by
  `native_sequential_holes_test.cpp:175` (`"drilled plate has EXACTLY 6 planar faces"`).
  The geometric claim beside it (one analytic cylinder, nSeg sectors) is correct.
* The skew cross-bore takes the mesh fallback. `native_boolean_test.cpp:388-397`
  explains why: the plane∩cylinder ellipses are closed-form, but the OBLIQUE ellipse
  on the CYLINDER WALL is not a constant-v cut, so the curved-face band-split defers
  the cylinder-side imprint. That is an imprint-side gap, not an SSI gap, and the
  gate accepts either route as long as the volume matches independent Monte-Carlo
  truth — which it did.

### The fuzzy path, measured against OCCT

`BooleanOptions::fuzz` is threaded into the SSI coincidence tolerance
(`Boolean.cpp:1652`), the face-overlap AABB pad (`Boolean.cpp:1657`) and the stitch
corner-weld grid. Built and run today from its own header's build line:

```
fuzz=0     : ok=1 fallback=1 volume=128
fuzz=2e-05 : ok=1 fallback=0 volume=128.00016
OCCT SetFuzzyValue(2e-05): volume=128.00016   |Δ| = 2.842e-14
native_vs_occt_fuzzy_boolean RESULT: 8/8 checks passed
```

Note the control line, which is the more interesting half: two 4³ boxes separated by
a **1e-5 gap** defeated the analytic envelope entirely and went to the mesh fallback.
The analytic path's tolerance to near-coincident faces is `fuzz`-dependent, and the
default `fuzz` is 0.

## The gates that assert `!usedMeshFallback`

Counted with `grep -rn "check(.*!.*usedMeshFallback" forge-kernel/test/native/` (8)
plus the three `allAnalytic` assertions in the sequential-holes gate
(`grep -n allAnalytic .../native_sequential_holes_test.cpp` → lines 172, 189, 214):
**11 assertions in 4 files under `test/native`**, and one more outside it, for 12
in the test tree.

| gate | assertions | what it pins | measured today |
|---|---:|---|---|
| `test/native/brep/native_boolean_test.cpp` (505, 525, 549, 570, 591) | 5 | box−box, bored plate, box−sphere, prism−cyl, box−cone each stay analytic | **141/141 checks passed** |
| `test/native/brep/native_sequential_holes_test.cpp` (172, 189, 214) | 3 | 1, 6 and 10 holes drilled ONE AT A TIME all stay analytic; face count grows by exactly nSeg per hole | **19/19** |
| `test/native/csg/boolean_lineage_test.cpp` (138, 246) | 2 | the lineage cases run on the analytic path (lineage is empty otherwise, so the gate would be vacuous) | **33/33** |
| `test/native/brep/step_analytic_test.cpp` (260) | 1 | the bored plate written to analytic STEP carries `CYLINDRICAL_SURFACE` | **84/84** |
| `test/native_vs_occt_fuzzy_boolean.cpp` (101) | 1 | the fuzz must not introduce a sliver that defeats the analytic envelope | **8/8** |

Run as `ONLY=<path> bash forge-kernel/test/native/run_native.sh`; the first four are
part of `kernel.native_suite` (`add_test` at `CMakeLists.txt:3215`) and the fifth is
`kernel.ab.native_vs_occt_fuzzy_boolean` (`CMakeLists.txt:3151`, registered by the
`FORGE_AB_GATES` loop at 3180-3199 as `kernel.ab.<name>`). The suite is **142** gates —
`find forge-kernel/test/native -name '*.cpp' | wc -l` → 142 and every filtered run
prints `1 of 142 gates ran` — but the comment beside the registration
(`CMakeLists.txt:3212`) still says "the 138 tests". That comment is stale; the run
script's own count is the live number.

**One spot is under-gated, and it reads like a gate.**
`test/native/brep/pattern_test.cpp:94` *conditions* on the flag rather than asserting it:

```cpp
if (!r.usedMeshFallback)
    check(holes == expectHoles, tag + " bored-hole count matches the pattern");
```

Measured today all three pattern cases printed `fallback=0` (circular-6, linear-4,
mirror-2; 21/21 checks passed), but if `applyPattern` regressed to facets this gate
would still go green — it would simply stop checking the hole count. Any future
"patterns are analytic" claim needs a real assertion here first.

`grep -rl "booleanSolid(" forge-kernel/test/native` returns **7 files**: the four
in-suite gates above plus `brep/interference_overlap_test.cpp`,
`brep/native_tangent_boolean_gate_test.cpp` and
`brep/native_tangent_pinch_gate_test.cpp`. `pattern_test` reaches the boolean
through `applyPattern`, so it does not appear in that list.

## K2 — the OCCT fallback is REMOVED for native operands

This is the fact most likely to be remembered wrongly, so it is stated exactly.

When both operands are native (`ShapeKind::NativeSolid` or `ShapeKind::NativeMesh`)
and the native engine defers, `forge::{fuse,cut,common}` no longer fall through to
`BRepAlgoAPI`. They **throw**. From `src/Booleans.cpp:467-483`, verbatim
(`\xC2\xA7` in the source is the UTF-8 `§`):

> `forge: boolean <op>: native analytic/mesh boolean deferred on an all-native
> operand pair. This operand class is NATIVE-ONLY — the OCCT BRepAlgoAPI fallback
> was removed (K2). The operands are degenerate or hit an unimplemented native
> intersection; refusing rather than masking a native gap with OCCT (Bible §0).
> OCCT booleans remain only for OCCT-backed operands (imported trimmed-NURBS/torus
> STEP solids) and fuzzy/splitter.`

The mechanism is `throwIfNativeOnlyDeferred` (`Booleans.cpp:467-483`):
it returns early — letting the OCCT path below run — **only** when at least one
operand's `ShapeKind` is not native. Each of `fuse` (556), `cut` (570) and `common`
(584) calls `throwIfTangentPinch` then `throwIfNativeOnlyDeferred` before reaching
`runBoolean<BRepAlgoAPI_*>`.

It is the shipped default, not an opt-in: the block is inside `#ifdef FORGE_NATIVE_BREP`
(the CMake option defaults **ON**, `CMakeLists.txt:51`) and behind
`forgeNativeBrepEnabled()`, which returns true when the env var is unset
(`NativeRoute.cpp:57-67`). `FORGE_NATIVE_BREP=0` in the environment restores the
whole OCCT boolean route, refusal included.

### Where OCCT booleans are still reached — and where K2's refusal is NOT

The last sentence of the refusal message is itself partly stale, which is the reason
to measure rather than quote it as documentation:

* **OCCT-backed operand pairs.** True and intended. `runBoolean<BRepAlgoAPI_Fuse|Cut|Common>`
  at `Booleans.cpp:568/582/596` still exists for an imported trimmed-NURBS/torus STEP
  body. Note that even here the native mesh-operand engine gets first refusal: GAP A
  native-tessellates an OCCT operand and runs the ARRANGEMENT natively
  (`tessellateOcctOperandToSoup`, `Booleans.cpp:304-336`; `tryNativeBoolean`,
  `356-424`), under a 2000 ms worker-thread deadline
  (`Booleans.cpp:406-416`) after which it honestly defers.
* **`section`.** OCCT-only, no native route: `BRepAlgoAPI_Section` at `Booleans.cpp:652`,
  inside `section` (620). It is the one boolean whose result is not a solid.
* **Fuzzy — "stays OCCT-only" is NOT what the code does.** `src/BooleanTol.cpp` is
  native-FIRST: `runFuzzy` calls `tryNativeFuzzyBoolean` (line 199) and only falls
  through to `BRepAlgoAPI_*::SetFuzzyValue` (203-216) on a native miss. It has **no**
  `throwIfNativeOnlyDeferred`. So an all-native pair the fuzzy engine cannot close
  falls back to OCCT silently — K2's refusal covers `forge::{fuse,cut,common}` only.
  Both halves of that matter: the native fuzzy work is more finished than the comment
  says, and the refusal is less universal.

## The tangent-pinch pre-detector

`detectBooleanTangentPinch(A, B, op)` (`Boolean.hpp:187`, `Boolean.cpp:1823`) is a
purely geometric pre-check — no boolean, no tessellation. It scans every cylindrical
(or equal-radius conical, `|r1-r2| < 1e-9`) wall of either operand against every
planar face of the other whose plane the axis is parallel to (`|cos| < 1e-4`), and
flags `degenerate` when `| |dist(axis, plane)| - r | < eps`, with
`eps = max(1e-6, 1e-7 · maxExtent)`. It **only reports**; it moves no geometry.

`Booleans.cpp:433-450` turns a positive report into a specific fast error — the
drilled-edge `cx + r == L` case that made `BRepAlgoAPI` spin for minutes on three
CADGenBench fixtures — and it runs BEFORE `throwIfNativeOnlyDeferred`, so a pinch
gets the precise diagnostic rather than the generic K2 refusal.

The DETECTOR is gated by exactly one file. `grep -rn detectBooleanTangentPinch
forge-kernel/` returns 12 lines, of which **five are calls**: the production one at
`Booleans.cpp:439`, and four in `test/native/brep/native_tangent_boolean_gate_test.cpp`
at 121 (inside a loop over the three CADGenBench tangent fixtures), 139, 157 and 172.
**Two of those four are negative controls** — a comfortable interior hole (`check(!tp.
degenerate…)`, 146) and a 1.0 mm wall (176) — so the band is shown to discriminate, not
just to fire.

`test/native/brep/native_tangent_pinch_gate_test.cpp` does **not** call the detector at
all. It gates the BOOLEAN's behaviour on the same degeneracy: a tangent-to-edge hole
must not yield a silent watertight closed-2-manifold solid and `booleanSolid` must
return ok=false (lines 153-154), with a valid 4-hole thin plate as the positive case
and a dropped-face open shell as the negative control. Useful, adjacent, and not
evidence about `detectBooleanTangentPinch`.

## Lineage: built, gated, and consumed by nothing

`modifiedFromA/B`, `deletedA/B`, `generatedEdges` mirror OCCT's
`BRepAlgoAPI_BuilderAlgo::Modified` / `IsDeleted` / `Generated`. They are real and
they are populated (`Boolean.cpp:1573-1608` for the generated edges, 1787-1807 for
the modified/deleted maps), on the analytic path only.

`grep -rn "modifiedFromA\|generatedEdges" forge-kernel/src` returns 8 lines: seven in
`Boolean.cpp` and one comment in `InterferenceDetection.cpp:23` noting the interference
test does not need them. **There is no production consumer.** `applyPattern` returns a
`BooleanResult` (`Pattern.hpp:135`) but copies only `usedMeshFallback`
(`Pattern.cpp:224`), so a patterned result carries no lineage at all.

The capability is nonetheless proved, not aspirational: `csg/boolean_lineage_test.cpp`
checks the Modified partition, the IsDeleted accounting and the generated-edge set
against hand-derived face indices, 33/33 today.

## Production call sites

`grep -rn "booleanSolid(" forge-kernel/src` — nine calls in nine files:
`Booleans.cpp:365`, `BooleanTol.cpp:118`, `InterferenceDetection.cpp:198`,
`SheetMetal.cpp:318`, `SheetMetalExtended.cpp:162`, `Weldments.cpp:268`,
`native/brep/Pattern.cpp:219`, `native/capi/forge_capi.cpp:425`, `binding.cpp:941`.

## Do NOT read boolean parity from the JS binding

`nativeBoolean` (`binding.cpp:886-971`, exported at 6328 under `#ifdef FORGE_NATIVE_BREP`)
is a STEP-2 diagnostic, and a result from it is not evidence about the engine.

Its argument parser, `buildFromRange` (`binding.cpp:912-935`), accepts a kind string
and dimension numbers and **nothing else** — `box dx,dy,dz` / `cylinder r,h` /
`cone r1,r2,h` / `sphere r` / `prism n,R,h` / `wedge dx,dy,dz,ltx` / `pyramid dx,dy,h`.
There is no transform argument, so both operands are built at `SolidFactory`'s canonical
OCCT-matching placement (`Primitives.hpp:11-22`): a box's **min corner at the origin**,
a cylinder's **base circle on z=0, axis +Z**.

Therefore `nativeBoolean("cut", "box", 10,10,2, "|", "cylinder", 2,10)` does not drill
a centred bore. It puts the bore axis on the box's corner edge at (0,0), so the two
operands share an edge and the cylinder's axis lies IN two of the box's face planes.
Measured, by loading the built addon at `forge-kernel/build/Release/forge-kernel.node`
and calling it:

| call | `ok` | `usedMeshFallback` | `reason` | volume |
|---|---|---|---|---|
| `cut  box 10,10,2 \| cylinder 2,10` | true | false | `ok (analytic cut)` | 193.71681469281938 |
| `cut  box 4,4,4   \| box 4,4,4`      | false | true | `empty result` | 0 |
| `fuse box 4,4,4   \| sphere 2`       | false | true | `CDT failure on B face (honest)` | 0 |
| `common box 4,4,4 \| cylinder 1,4`   | true | **true** | `ok (mesh fallback)` | 3.140331156954754 |

Read the first and last rows together. The first is a QUARTER bore: 200 − 2π =
193.7168146928204, matched to 1.0e-12 — the engine did exactly the right thing on a
corner notch. The last is the same corner geometry as a `common`, and it fell to the
mesh fallback: π = 3.141592653589793 against a measured 3.140331156954754, a 4.0e-4
relative error, which is the chordal signature of planar-soup reconstruction. The
second and third rows are two coincident solids and a sphere centred on the box's
corner VERTEX.

None of those four rows tells you anything about the boolean's envelope, because
there is no way to ask this binding for a non-degenerate configuration. Every fixture
it can express has both operands sharing the origin. **A `usedMeshFallback: true`
from `nativeBoolean` is a property of the fixture, not of the engine** — the same
cylinder-through-a-prismatic-body geometry, with the cylinder PLACED, runs on the
analytic path in the C++ gates (`bored plate CUT` and `prism−cyl CUT`, both measured
above at `fallback=0`).

Placement is not a kernel gap, and nothing here should be read as one.
`transformSolid` (`NativeRoute.hpp:116-137`, commented "THE PLACEMENT-GAP FIX")
deep-clones a `Solid` under `p' = R·p + t` with every vertex and every analytic
`Surface` frame transformed, preserving trim windows and connectivity; `Pattern.hpp:176`
adds `transformSolidInPlace`. The C++ gates build their centred bores with it
(`boolean_lineage_test.cpp:109`, `step_analytic_test.cpp:255`,
`native_vs_occt_fuzzy_boolean.cpp:83`), and the live JS path is
`makeBox → translate → cut` through `src/Booleans.cpp`, never through `nativeBoolean`.

Measured reach: `grep -rn nativeBoolean` over the tree, excluding `node_modules` and
this file, returns **11 lines** — 8 in `binding.cpp`, 1 in `CMakeLists.txt`, 2 in
`docs/KERNEL_PARITY_PLAN.md`. **Zero `.js` / `.ts` / `.mjs` callers.** Nothing in the
product depends on it.

## What is NOT built

Plainly, so that none of it is quietly assumed and none of it is redone:

1. **cone∩cone, cone∩cylinder, cone∩sphere and every torus pair have no SSI.**
   `SurfaceIntersect.cpp:813-815`. They reach the mesh fallback.
2. **`booleanSolid` cannot consume a NURBS or Torus face at all** — `kindOK`
   (`Boolean.cpp:1629`) rejects the operand before any SSI runs, so the NURBS
   marcher in `NurbsSurfaceIntersect.cpp` is unreachable from the boolean.
3. **Mesh-fallback results are planar soup.** `reconstructPlanar`
   (`Boolean.cpp:385-439`) emits one planar `Face` per triangle. It is watertight and
   its mass properties are usable, and it supports no face selection, no
   fillet-after-boolean and no lineage.
4. **Nothing in production reads `usedMeshFallback`** (7 total occurrences in
   `src/` + `include/`; none is a branch).
5. **Patterned results carry no lineage** (`Pattern.cpp:224` copies one field).
6. **`section` has no native path** (`Booleans.cpp:620-652`).
7. **`forge::booleantol` has no K2 refusal** — an all-native fuzzy pair still falls
   back to OCCT silently (`BooleanTol.cpp:203-216`).
8. **The oblique-ellipse-on-a-cylinder imprint defers**, measured today on the skew
   cross-bore: the SSI is closed-form, the curved-face band-split is not
   (`native_boolean_test.cpp:388-397`).
9. **`pattern_test.cpp:94` conditions on the fallback flag instead of asserting it**
   — the one place a facet regression could pass green.

## Reproducing all of the above

```sh
# the five in-suite gates that touch the boolean (each recompiles the 156 native
# objects, ~1 min)
ONLY=brep/native_boolean_test            bash forge-kernel/test/native/run_native.sh
ONLY=brep/native_sequential_holes_test   bash forge-kernel/test/native/run_native.sh
ONLY=csg/boolean_lineage_test            bash forge-kernel/test/native/run_native.sh
ONLY=brep/step_analytic_test             bash forge-kernel/test/native/run_native.sh
ONLY=brep/pattern_test                   bash forge-kernel/test/native/run_native.sh
# per-gate stdout (face-kind and fallback lines) lands in
#   /tmp/forge_native_<class>_<test>.out

# the OCCT A/B fuzzy gate (needs OCCT; build line is in the test's own header)
# -> "native_vs_occt_fuzzy_boolean RESULT: 8/8 checks passed"

# the JS binding table, against the already-built addon
node -e 'const k=require("./forge-kernel/build/Release/forge-kernel.node");
         console.log(k.nativeBoolean("common","box",4,4,4,"|","cylinder",1,4));'
```

A filtered run prints `NOT a full gate` and means it: the suite is 142 gates.
