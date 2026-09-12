# Tessellation and the native → OCCT bridge

Companion to `MIGRATION.md` (which sets the removal order) and
`OCCT_REMOVAL_TRACKER.md` (which is generated). This file is the part of the
tessellation rung that needs judgement: what
`forge/native/brep/SolidTessellate.hpp` actually does, what
`src/NativeOcctBridge.cpp` actually hands OCCT, which gate proves each of
those, and — stated as plainly as the rest — where both are measurably wrong
today.

**Every number below was produced by a command, and the commands are listed in
"Reproducing every number" at the end.** Measured 2026-09-12 in the
`topohonesty` worktree at `ddef657b` ("kernel(math): Point3 had three
declarations, and it is NOT Vec3").

Runtime numbers come from `forge-kernel/build/Release/forge-kernel.node`
(built 12:14 today, i.e. **after** the 11:40 mtime of every source this file
describes), driven through the public N-API surface with
`forge.setNativeBrep(true)`.

Both `.mjs` bridge gates were green at that SHA:

```
node forge-kernel/test/native_bridge_curved_smoke.mjs   -> 12 passed, 0 failed
node forge-kernel/test/native_bridge_faceted_smoke.mjs  -> 24 passed, 0 failed
ONLY=brep/tessellate_closure_test bash forge-kernel/test/native/run_native.sh
                                                        -> PASS (1 of 142 gates)
```

## Where the code is

| | lines | OCCT include lines |
|---|---:|---:|
| `forge-kernel/include/forge/native/brep/SolidTessellate.hpp` | 52 | **0** |
| `forge-kernel/src/native/brep/SolidTessellate.cpp` | 397 | **0** |
| `forge-kernel/include/forge/NativeOcctBridge.hpp` | 46 | 1 |
| `forge-kernel/src/NativeOcctBridge.cpp` | 1585 | **36** |
| `forge-kernel/src/native/brep/NativeRoute.cpp` (viewport tessellator) | 540 | **0** |

OCCT counts are `tools/kernel/occt_dependency_graph.py`'s own `occt_includes()`,
so they are the same numbers the generated tracker prints — 36 for
`NativeOcctBridge.cpp` matches its "Heaviest production kernel files" row
exactly.

The tessellator's whole include list is `SolidTessellate.hpp`, `Surface.hpp`,
`ConstrainedDelaunay2D.hpp` and seven stdlib headers. The header's closing
line — *"Pure C++20, ZERO external deps (stdlib + forge native headers). No
OCCT/WASM"* — is **true as written**. That is why the tracker marks the
Tessellation rung `[x]`.

The bridge is the opposite by design: it is the legacy adapter, it is expected
to name OCCT types, and `OCCT_REMOVAL_TRACKER.md` lists it separately from the
Kernel API proper for that reason.

## There are TWO tessellators, and they are not the same code

This is the first thing a reader needs and neither header says it.

| | entry point | file | used by |
|---|---|---|---|
| analytic | `brep::tessellateSolid` / `tessellateSolidToMesh` | `SolidTessellate.cpp:108` / `:386` | booleans, FEA tet meshing, STL export, the native→OCCT bridge, CAD-score gates |
| viewport | `brep::tessellateSolidForViewport` | `NativeRoute.cpp:250-392` | `forge::tessellate` (`Tessellate.cpp:38`) — the display mesh |

`tessellateSolid`/`tessellateSolidToMesh` are called from **12 production
`.cpp` files** besides their own implementation, and from 16 test `.cpp` files.
The viewport one is reached whenever anything asks for a display mesh of a
native handle.

`NativeRoute.cpp:314` claims *"Mirrors `brep::tessellateSolid`'s holed path
(the two tessellators must agree)"*. **They do not agree.** Measured: the
viewport function contains zero calls to `Surface::evaluate` and no occurrence
of `chordSegs`, `surfaceTessEnabled` or the full-period branch. It has exactly
two paths — the constrained-Delaunay holed path and a fan — against the
analytic tessellator's four. The consequences are measured under
"Where the tessellator is wrong" below.

One further divergence worth naming: `NativeRoute.cpp:364` still re-winds each
fan triangle individually against the face normal
(`bool flip = (f->surface && vdot(triN, refN) < 0.0)`). That is the exact rule
`SolidTessellate.cpp:337-374` removed in commit `6b5098da`
("a fan must keep the loop's winding — re-winding one triangle opens the
surface"), whose comment records the corpus cost: mmcad_b STEP import
110/215 → 134/215. **I did not measure that rule failing in the viewport
mesher today** — all five boolean bodies I drove through it came back closed
(0 unmatched directed edges) — so this is a divergence and an unguarded
repeat of a known-bad rule, not an observed failure.

## `tessellateSolid` has four paths, not one

In loop order inside the per-face body of `tessellateSolid`:

| # | path | lines | gate |
|---|---|---|---|
| 1 | surface-sampled (u,v) grid, **flag-gated OFF** by `FORGE_SURFACE_TESSELLATE=1` | `:154-211` | none |
| 2 | constrained-Delaunay annulus for a boolean-emitted holed face (`f->boolHoled`) | `:222-268` | indirectly, via the bridge's face census |
| 3 | full-period curved face (outer loop wraps a whole 2π turn) — surface-sampled at the loop's own rim resolution | `:283-335` | none |
| 4 | fan over the outer loop, **in the loop's own winding** | `:375-381` | `tessellate_closure_test.cpp` |

`chordSegs` (`:91-105`) sizes the non-angular direction of paths 1 and 3 by
**chord error (sagitta)**, returning 1 segment for a ruled generator and
`ceil(sqrt(sag/tol))` otherwise, capped at 512.

### The header's scope note is an under-claim, and it matters

`SolidTessellate.hpp:9-19` carries a `HONESTY` block. Two of its sentences are
wrong in the direction this repository has just been bitten by.

> *"What is REAL here: each Face is fan-triangulated over its outer-loop
> vertices"* — `SolidTessellate.hpp:10`

Only path 4 is a fan. Three other paths are tried before it, and one of them
(path 3) is not flag-gated — it runs in the shipped default build on any
full-period curved face.

> *"TARGETED (not here): adaptive curvature-driven refinement, in-face grid
> subdivision with matched boundary sampling (the curved faces are already the
> refinement unit), trimmed-NURBS faces with inner loops."* —
> `SolidTessellate.hpp:17-19`

Of those four items, **three are in the same file**:

- *adaptive curvature-driven refinement* — `chordSegs`, `SolidTessellate.cpp:91`,
  called at `:184` and `:308`. It is sagitta-driven, which is precisely
  "curvature-driven".
- *in-face grid subdivision* — paths 1 and 3, `:185-209` and `:309-333`.
- *with matched boundary sampling* — path 3 derives `nu` from
  `lp->coedgeCount` for exactly this reason (`:305-307`: the cap rim and the
  wall must sample the shared edge identically), and path 1's own comment at
  `:159-168` explains the conforming rule it uses.
- *faces with inner loops* — built for boolean-emitted holed faces (path 2).
  Measured live: a through-bore body reaches the bridge with the bore intact
  (`{plane:6, cylinder:1}`), which a hole-filling fan could not produce.

Only **trimmed-NURBS** faces are genuinely absent from this file. This is the
same defect just fixed in `forge/native/brep/Topology.hpp` (commit `2ee57510`):
a scope note is read as a to-do list, so an under-claim schedules finished work
for re-implementation. Nothing gates this block — `topology_honesty_gate.py`
probes `Topology.hpp`, not this header — so it can drift again.

## Measured: what the analytic tessellator produces

`forge.nativeTessellate(kind, …)` → `tessellateSolid` + `tessellateSolidToMesh`
+ `HalfEdgeMesh::validate()`. Every row watertight.

| body | triangles | vertices | watertight |
|---|---:|---:|---|
| box(10,10,10) | 12 | 8 | true |
| prism(n=6,R=10,h=20) | 20 | 12 | true |
| cylinder(r=10,h=20) | 508 | 256 | true |
| cone(r=10,h=20) | 254 | 129 | true |
| frustum(10,5,20) | 508 | 256 | true |
| tube(10,5,20) | 1024 | 512 | true |
| sphere(r=10) | 16128 | 8066 | true |
| torus(R=20,r=5) | 16384 | 8192 | true |

Setting `FORGE_SURFACE_TESSELLATE=1` changes **none** of these eight numbers.
That is expected and worth stating, because the flag's name suggests otherwise:
a primitive's lateral is already built as N angular strips, each with a u-span
of 2π/N, so path 1's `nu = lround(uSpan · 32/π)` comes out 1 and emits one
2-triangle quad per strip, exactly as the fan does. The flag only bites on a
face whose u-span is large — i.e. a merged full-period face.

The *meshes* are not quite identical, though, and the difference is worth
recording because it is the kind of thing a count cannot see. Comparing the
`positions`/`indices` arrays flag-off against flag-on: **six of the eight are
byte-identical in both arrays** (box, prism, cylinder, cone, frustum, torus).
The **sphere**'s `positions` array is a permutation — same 8066 positions, same
oriented-triangle multiset, different emission order. The **tube** differs in
both arrays: same 512 positions and the same soup volume to six decimals, but
**256 of its 1024 triangles are different** — 128 quads split on the opposite
diagonal. So the eight numbers survive the flag; two of the eight meshes do
not.

Volumes of the exported triangle soup against closed form (native STL export
uses `tessellateSolid` at `IoExchange.cpp:367`):

| body | soup volume | analytic | rel |
|---|---:|---:|---:|
| box(10,10,10) | 1000.0000 | 1000.0000 | −0.0000% |
| cylinder(10,20) | 6280.6623 | 6283.1853 | −0.0402% |
| sphere(10) | 4184.5864 | 4188.7902 | −0.1004% |
| torus(20,5) | 9849.8010 | 9869.6044 | −0.2007% |

Those deficits are the inscribed-polygon error and are correct. The
`9849.80` figure is the same one `native_bridge_curved_smoke.mjs:20` quotes as
the pre-fix faceted torus.

Every soup volume in this file is reported as a **magnitude**. The signed
divergence sum is negative for the sphere and only the sphere (−4184.5864
unmerged, −3782.5185 merged, −4184.5864 through the viewport): its tessellation
is globally inverted. That is benign and the code says so —
`SolidTessellate.cpp:371-374`, *"A globally INVERTED solid (every loop wound the
other way) is still fine: it stays closed, and NativeOcctBridge's own
`if (vp.Mass() < 0) Reverse()` puts the sign right."* Re-running the repro
script will print the minus sign; take `|v|` before comparing to the tables.

## Where the tessellator is wrong (measured)

A face whose outer loop wraps a full 2π turn is produced in this tree by
`unifySameDomainCurved` (`UnifyFaces.cpp:958`), reached from `forge::unifyFaces`
(`DirectEdit.cpp:232`) — which the desktop app calls on **every import**
(`forge-desktop/src/FileExchangeHost.cpp:420`) and the feature-tree compiler
calls at `FeatureTreeCompiler.cpp:2977`.

### 1. The analytic tessellator under-samples a merged sphere or torus

Default build, `tessellateSolid` via STL export, soup volume against closed form:

| body | triangles | soup volume | analytic | rel | closed? |
|---|---:|---:|---:|---:|---|
| cylinder(10,20) unmerged | 508 | 6280.6623 | 6283.1853 | −0.040% | yes |
| cylinder(10,20) **merged** | 508 | 6280.6623 | 6283.1853 | −0.040% | yes |
| sphere(10) unmerged | 16128 | 4184.5864 | 4188.7902 | −0.100% | yes |
| sphere(10) **merged** | 504 | 3782.5185 | 4188.7902 | **−9.699%** | yes |
| torus(20,5) unmerged | 16384 | 9849.8010 | 9869.6044 | −0.201% | yes |
| torus(20,5) **merged** | 1910 | 7468.2333 | 9869.6044 | **−24.331%** | yes |

The merged cylinder is fine; the merged sphere and torus are not. The cause is
visible in the code: path 1 sizes an **angular** v-direction by angle span
(`angV`, true for `Sphere` and `Torus`, `:170`; applied `:183`), while path 3 — the one that
actually runs by default — has no `angV` branch at all and always calls
`chordSegs(S, uMid, vv0, vv1, 0.5)` (`:308`). A model-unit chord tolerance of
0.5 on a whole hemisphere yields a handful of v-bands.

Note the shape of the failure: **every one of these meshes is closed.** The
soup is a valid 2-manifold and 24% of the volume is missing. This is the
`MIGRATION.md` lesson restated — a check on invariants alone certifies a
representation that is wrong.

Turning the flag on fixes accuracy and **breaks watertightness**:

| body, `FORGE_SURFACE_TESSELLATE=1` | triangles | soup volume | rel | unmatched directed edges |
|---|---:|---:|---:|---:|
| cylinder(10,20) **merged** | 380 | 6275.6188 | −0.120% | **386** |
| sphere(10) **merged** | 3968 | 4171.9958 | −0.401% | 0 |
| torus(20,5) **merged** | 8192 | 9837.9364 | −0.321% | 0 |

The merged cylinder cracks because path 1 samples the wall at
`nu = lround(2π·32/π) = 64` while the caps still fan over their 128 rim
vertices; the two meshes stop sharing the seam. Arithmetic on the measured
counts agrees: 508 − 380 = 128 missing wall triangles. The flag's own comment
at `:55-58` asserts *"a periodic face's u=u0 and u=u1 columns evaluate to the
same points … so the seam welds automatically"* — the seam does weld; the
**rim** does not.

So neither setting is correct for all three bodies, and the flag is off by
default (`:59-70`, reverted because default-ON crashed
`gdt/fcf_evaluator_test`).

### 2. The viewport tessellator emits an open, empty-volume mesh for them

`forge.tessellate` → `tessellateSolidForViewport`. Same bodies:

| body | triangles | unmatched directed edges | soup volume | native volume | rel |
|---|---:|---:|---:|---:|---:|
| cylinder(10,20) unmerged | 508 | 0 | 6280.6622 | 6283.1853 | −0.040% |
| cylinder(10,20) **merged** | 506 | **66** | 761.8269 | 6283.1853 | **−87.9%** |
| sphere(10) unmerged | 16128 | 0 | 4184.5864 | 4188.7902 | −0.100% |
| sphere(10) **merged** | 126 | **65** | 0.0000 | 4188.7901 | **−100%** |
| torus(20,5) unmerged | 16384 | 0 | 9849.8009 | 9869.6044 | −0.201% |
| torus(20,5) **merged** | 376 | **192** | 0.0000 | 9869.6044 | **−100%** |

This is the missing path 3, exactly as `SolidTessellate.cpp:270-274` predicts:
*"the corner FAN is geometrically invalid (a cylinder cannot be fanned from one
vertex)"*. The viewport mesher fans it anyway.

Five ordinary boolean bodies (box, through-bore, corner notch, through pocket,
blind pocket) all come back from the viewport mesher closed with 0 unmatched
directed edges and volume matching the native integrator to ≤0.006%, so this
failure is specific to full-period curved faces, not general.

## The bridge: dispatch order

`occtFromNativeSolid` (`NativeOcctBridge.cpp:1464-1561`, returning at `:1560`) tries seven things in
a fixed order, each declining to the next:

| order | function | line | keeps analytic faces? |
|---|---|---:|---|
| 0 | `bridgeForceFaceted()` — `FORGE_BRIDGE_FACETED=1` test hook | `:1459` | no (forces the fallback) |
| 1 | all-planar-simple → `buildSewnPlanarSolid` | `:84`, dispatched `:1486` | yes |
| 2 | `occtAnalyticFromNativeSolid` | `:592` | yes |
| 3 | `occtConeFromNativeSolid` | `:721` | yes |
| 4 | `occtSphereFromNativeSolid` | `:787` | yes |
| 5 | `occtTorusFromNativeSolid` | `:841` | yes |
| 6 | `occtMergedAnalyticFromNativeSolid` | `:1244` | yes |
| 7 | `occtFacetedFromNativeSolid` | `:325` | **no** |

Every analytic reconstructor cross-checks its rebuilt OCCT volume against
`native::brep::massProperties(solid).volume` at **1e-6 relative** and returns a
null shape on mismatch (`:706`, `:772`, `:828`, `:888`, `:1428`). The faceted
fallback cross-checks at **1e-3 relative** and *throws* rather than declines
(`:310`) — there is nothing left to fall back to. Both are honest: the bridge
never returns a silently-wrong shape.

The faceted path is where the tessellator meets OCCT:
`tessellateSolid(solid, pos, idx, weldTol = 1e-9)` at `:328`, then
`buildOcctSolidFromPolyhedron` (`:167`) which builds each triangle on a
`Geom_Plane`, explicitly stamps a co-parameterised `Geom2d_Line` pcurve per
edge per face (`bb.UpdateEdge`, `:270`), runs `BRepLib::SameParameter` (`:291`),
and only then integrates.

**The entry point is `ShapeRegistry::get`, not a call anyone writes.**
`ShapeRegistry.cpp:76` materialises and caches the OCCT shape of a NativeSolid
handle on first request. Any OCCT-only query — `forge.faceInventory` is the one
used below (`DirectEdit.cpp:271`) — triggers it.

### The header's STEP round-trip sentence is stale

`NativeOcctBridge.hpp:9`, `:30` and `:37` all describe the conversion as
*"reusing the VALIDATED analytic STEP round-trip (StepAnalytic::write → OCCT
STEPControl_Reader)"*. `ShapeRegistry.cpp:69` repeats it. The implementation
says the opposite at `:1441-1444`: *"NO analytic-STEP round-trip and NO
STEPControl_Reader — the previous StepAnalytic::write → temp.step → OCCT reader
path hung and spiked ~4.5 GB on box-minus-cyl."* `grep -c
'StepAnalytic\|STEPControl' src/NativeOcctBridge.cpp` returns **1**, and that
one line is the comment saying it is gone. The bridge builds directly through
`BRepBuilderAPI`. Fixing those four sentences is not this document's job, but a
reader should not be sent looking for a STEP writer that is not on the path.

## Measured: what the bridge produces

Face census of the native solid (`forge.nativeFaceInventory`, no bridge) beside
the census of what the bridge hands OCCT (`forge.faceInventory`, bridged):

| body | native | bridged |
|---|---|---|
| through-bore (box 40×40×20 − Ø16 cylinder, centred) | `{plane:6, cylinder:1}` | `{plane:6, cylinder:1}` |
| edge half-bore | `{plane:7, cylinder:1}` | `{plane:7, cylinder:1}` |
| blind pocket (cylinder) | `{plane:7, cylinder:1}` | `{plane:7, cylinder:1}` |
| through pocket (box − box) | `{plane:10}` | `{plane:28}` |
| corner notch (box − corner cylinder) | `{plane:178}` | `{plane:208}` |

Three readings, all measured:

1. **Where the native boolean keeps an analytic surface, the bridge keeps it
   too, exactly.** Face identity survives — the acceptance criterion
   `MIGRATION.md` singles out as first-class.
2. **This corner notch is lost upstream of the bridge.** For the body I drove
   (box 40x40x20 minus a Ø16 cylinder on the corner axis), the *native* result
   already has 178 planar faces and **no cylinder surface at all**, so nothing
   downstream can rescue the wall's analytic identity.
   `occtMergedAnalyticFromNativeSolid` — written for a corner notch, and
   describing one at `:893-900` as "106 strips … its ONE quarter-cylinder wall
   split into 32 angular strips", i.e. a body that still *has* a cylinder
   surface — is never even reached here: an all-planar solid satisfies
   `planarSimple` and dispatch stops at step 1. `FORGE_BRIDGE_MERGE_DIAG=1`
   prints nothing, confirming no `MERGE_BAIL` fired. Whether the 32-strip
   variant its header describes still occurs on some other corner notch is
   **not something I measured**; what is measured is that this one does not
   reach the reconstructor.
3. **The planar rebuild is not face-count-preserving.** 10 native planar faces
   become 28 OCCT faces on the through pocket. No analytic *kind* is lost (all
   planes in, all planes out), but the comment at `:1445-1450` — *"rebuilt 1:1
   from the native topology"* — holds for the primitive counts it lists
   (box 6F, prism 8F, wedge 6F, pyramid 5F) and not for a boolean result.

Forcing the fallback with `FORGE_BRIDGE_FACETED=1` flips every analytic census
to all-planes (cylinder 508, cone 254, frustum 508, sphere 504, torus 1910,
box 12) with no throw. That flip is itself the proof that `forge.faceInventory`
really does drive `occtFromNativeSolid`: the env var touches nothing else.

## What the two `.mjs` gates actually prove

Both run in CI: `package.json:18` chains them into `forge:kernel:test`, which
`.github/workflows/kernel-tests.yml:763` runs in the `kernel` job
(macos-latest, 75-minute cap) against a `FORGE_NATIVE_BREP=ON` build
(`forge-kernel/CMakeLists.txt:51`, default ON).

**`native_bridge_curved_smoke.mjs` (12 passing checks).** Proves that a native
sphere and torus reach OCCT as *one* analytic face each —
`{sphere:1}` / `{torus:1}`, never the 16128/16384 plane facets the faceted
fallback emits. That assertion runs through `forge.faceInventory`, so it really
does exercise the bridge. Measured today: sphere 1 face, torus 1 face.

**`native_bridge_faceted_smoke.mjs` (24 passing checks).** Section (A) checks the
analytic path is untouched; section (B) forces `FORGE_BRIDGE_FACETED=1` and
checks the faceted rebuild does not throw and the inventory is all planes.
Measured today: 24 passed, 0 failed.

**What neither gate measures, despite saying it does.** Both assert on
`forge.massProps(bridged).volume`, and the faceted gate's own header calls that
*"the OCCT-integrated volume"*. It is not. `binding.cpp:689-691` short-circuits
a `NativeSolid` handle to the native divergence-theorem integrator and never
touches OCCT. And **every** body in both gates comes back from
`forge.unifyFaces` as a `NativeSolid` — measured for all **five** gate bodies
(cylinder, cone, frustum in the faceted gate; sphere, torus in the curved one —
neither gate builds a box), in both default and forced-faceted modes. So the
`rel ≤ 1e-6` and `rel ∈ [−0.2%, +0.01%]` assertions are comparing the native
analytic volume to closed form, and they read exactly `0.0000%` rather than the
inscribed-polygon deficit the gate's comment predicts.

That is not to say section (B) is empty. The volume self-check inside
`buildOcctSolidFromPolyhedron` *does* run on the `faceInventory` call and
*does* throw on the −99% mold-cone malformation (`:310`), and "did not throw"
is a real assertion against a real instrument. The gap is narrower than it
looks and worth stating precisely: **the gates prove the bridge refuses a
mis-integrating faceted solid; they do not measure the bridged solid's OCCT
volume.**

**`tessellate_closure_test.cpp`** (run by `test/native/run_native.sh`, which
globs `test/native/brep/*.cpp` — it is registered by glob, not by name, and CI
runs the script at `kernel-tests.yml:99`). It asserts the far stronger
directed-edge closure property, carries two controls that prove it can fail,
and passes. Its three bodies are a U-prism, an L-prism and a box-prism — **all
planar**. No cylinder, sphere, torus or cone appears in it
(`grep -c 'buildCylinder\|buildSphere\|buildTorus\|buildCone'` → 0), which is
why the merged-sphere/torus errors above are invisible to it: they are closure-
clean and geometry-wrong.

## `toOcctBackedHandle`: a throw with no callers

`NativeOcctBridge.hpp:42` declares it; `NativeOcctBridge.cpp:1563` defines it;
`:1582` provides the identity stub for a pure-OCCT build. Those are the **only
four occurrences of the name anywhere in the tree** — no `.cpp`, `.hpp`, `.mjs`,
`.js`, `.ts` or workflow calls it. It is dead code today.

Its documented gap is nevertheless real and is covered elsewhere. A
`ShapeKind::NativeMesh` handle — a faceted feature result — has no analytic
`TopoDS_Shape`, and the bridge does not cover it. `toOcctBackedHandle` throws
for it (`:1569-1573`, "bridging is a later wave"), and so does the live path,
`ShapeRegistry::get` (`ShapeRegistry.cpp:81-83`). **8 production call sites**
mint such handles: `IoExchange.cpp`, `SheetMetal.cpp`, `Transform.cpp`,
`Nurbs.cpp` (one each) and `Features.cpp` (four).

## What is NOT built

Stated as plainly as the rest, and only where a command showed absence.

- **Trimmed-NURBS faces in the tessellator.** Paths 1 and 3 gate on
  `SurfaceKind`; only the `boolHoled` planar-embedded CDT path (`:222`) handles
  inner loops, and it projects into a plane basis. This is the one item of
  `SolidTessellate.hpp`'s "TARGETED (not here)" list that is genuinely absent.
- **An angular v-direction in path 3.** Path 1 has `angV`; path 3 does not.
  That absence is the measured −9.7%/−24.3% on merged spheres and tori.
- **The full-period path in the viewport tessellator.** Absent entirely;
  measured −87.9%/−100%/−100% and open meshes.
- **A gate on either of those.** `tessellate_closure_test.cpp` is all-planar,
  and neither `.mjs` bridge gate calls `forge.tessellate` or checks a mesh.
  One gate *does* drive a merged curved body through `tessellateSolid`, and it
  is worth being exact about what that buys: `native_bridge_faceted_smoke.mjs`
  section (B) forces `FORGE_BRIDGE_FACETED=1` on its merged cylinder / cone /
  frustum, so `occtFacetedFromNativeSolid` tessellates them — measured, the
  forced-faceted plane counts (508 / 254 / 508) are *exactly* the
  `tessellateSolid` triangle counts of the same handles, and the gate's own
  comment at `:148-151` names the merged cylinder's "full-2π lateral". But its
  three assertions there are *did not throw*, *inventory is all planes*, and a
  volume that (per the section above) is the native integrator's — none of which
  can see a mesh's geometry. **No gate drives a merged sphere or torus through
  either tessellator**, and none checks a tessellated mesh against closed form,
  which is why the −9.7% / −24.3% above is invisible to CI.
- **A gate on `SolidTessellate.hpp`'s scope note.** `topology_honesty_gate.py`
  probes `Topology.hpp` only; nothing checks this header against the code, so
  the under-claim documented above can recur.
- **NativeMesh bridging.** No path converts a `ShapeKind::NativeMesh` handle to
  OCCT. Both entry points throw, which is honest, and the throw in
  `toOcctBackedHandle` is unreachable because nothing calls it.
- **Adaptive refinement driven by a caller's tolerance.** `tessellateSolid`
  takes only `weldTol`; the chord tolerance is the hard-coded `0.5` at `:172`
  and `:308`, and `exportStl`'s `linearTol`/`angularTol` arguments are
  explicitly discarded (`IoExchange.cpp:362`).

## Reproducing every number

Run from the worktree root with the addon built
(`npm run forge:kernel` → `forge-kernel/build/Release/forge-kernel.node`).

```bash
# ── line and OCCT-include counts ────────────────────────────────────────────
wc -l forge-kernel/include/forge/native/brep/SolidTessellate.hpp \
      forge-kernel/src/native/brep/SolidTessellate.cpp \
      forge-kernel/include/forge/NativeOcctBridge.hpp \
      forge-kernel/src/NativeOcctBridge.cpp \
      forge-kernel/src/native/brep/NativeRoute.cpp

python3 -c "
import sys; sys.path.insert(0,'tools/kernel')
import occt_dependency_graph as g
for p in ['forge-kernel/src/NativeOcctBridge.cpp',
          'forge-kernel/include/forge/NativeOcctBridge.hpp',
          'forge-kernel/src/native/brep/SolidTessellate.cpp',
          'forge-kernel/include/forge/native/brep/SolidTessellate.hpp',
          'forge-kernel/src/native/brep/NativeRoute.cpp']:
    print(g.occt_includes(p)[0], p)"

# ── caller counts ──────────────────────────────────────────────────────────
grep -rlE 'tessellateSolid(ToMesh)?\(' --include='*.cpp' forge-kernel/src \
  | grep -v 'SolidTessellate.cpp' | wc -l                                          # 12
grep -rlE 'tessellateSolid(ToMesh)?\(' --include='*.cpp' forge-kernel/test | wc -l  # 16
grep -rn 'toOcctBackedHandle' . | grep -v node_modules | grep -v '\.git/' \
  | grep -v '^docs/'                                                               # 4 lines
grep -rn 'addNativeMesh' --include='*.cpp' forge-kernel/src                         # 8 producers + 2 in ShapeRegistry

# ── the two tessellators differ ────────────────────────────────────────────
grep -n 'surfaceTessEnabled\|chordSegs\|S.evaluate' \
     forge-kernel/src/native/brep/NativeRoute.cpp        # no output
grep -c 'StepAnalytic\|STEPControl' forge-kernel/src/NativeOcctBridge.cpp   # 1 (the comment)

# ── the gates ──────────────────────────────────────────────────────────────
node forge-kernel/test/native_bridge_curved_smoke.mjs
node forge-kernel/test/native_bridge_faceted_smoke.mjs
ONLY=brep/tessellate_closure_test JOBS=8 bash forge-kernel/test/native/run_native.sh
grep -c 'buildCylinder\|buildSphere\|buildTorus\|buildCone' \
     forge-kernel/test/native/brep/tessellate_closure_test.cpp   # 0
```

The runtime tables come from four short scripts against the built addon. Each
loads the addon with `createRequire`, calls `forge.setNativeBrep(true)`, and:

- **primitive mesh table** — `forge.nativeTessellate(kind, …)` for the eight
  bodies, reporting `indices.length/3`, `positions.length/3` and `watertight`;
  run once with `FORGE_SURFACE_TESSELLATE` unset and once with it `=1` (the
  flag is read through a function-local `static`, so it must be a fresh
  process). The byte-identity result dumps both runs' `positions`/`indices` to
  JSON and diffs them; the tube's 128 flipped quads are found by pairing the
  differing triangles on their shared edge (the two differing sets share 128
  four-vertex quads and have identical total area, 628.255450187).
- **soup-volume tables** — `forge.io.exportStl(handle, path, 0.1, 0.5, true)`
  (which routes a NativeSolid to `tessellateSolid`), then sum
  `det[A,B,C]/6` over the `vertex` triples parsed out of the ASCII STL, and
  count directed edges after welding vertices on a 1e-7 grid.
- **viewport tables** — `forge.tessellate(handle)` and the same soup analysis
  on `positions`/`indices`.
- **bridge census** — `forge.nativeFaceInventory(h)` beside
  `forge.faceInventory(h)`, histogrammed by `kind`; re-run under
  `FORGE_BRIDGE_FACETED=1` and `FORGE_BRIDGE_MERGE_DIAG=1`.

Bodies used for the bridge census, with `makeBox` cornered at the origin and
`makeCylinder` on +Z from the origin (measured: `massProps(makeBox(40,40,20))`
has centre of mass `[20,20,10]`):

```js
forge.cut(forge.makeBox(40,40,20), forge.translate(forge.makeCylinder(8,60), 20, 20, -20)) // through-bore
forge.cut(forge.makeBox(40,40,20), forge.makeCylinder(8,60))                               // corner notch
forge.cut(forge.makeBox(40,40,20), forge.translate(forge.makeCylinder(8,60), 40, 20, -20)) // edge half-bore
forge.cut(forge.makeBox(40,40,20), forge.translate(forge.makeCylinder(8,10), 20, 20, 10))  // blind pocket
forge.cut(forge.makeBox(40,40,20), forge.translate(forge.makeBox(10,10,40), 15, 15, -10))  // through pocket
```
