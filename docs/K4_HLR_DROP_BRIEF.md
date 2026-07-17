# K4 — Drop TKHLR (native HLR becomes the only HLR)

**North-star:** `otool -L build/Release/forge-kernel.node | grep -c opencascade` → target 0.
Currently **17**. TKHLR is a **single-consumer** toolkit (only `src/Drawings.cpp` directly
`#include`s HLR headers) with a **mature, A/B-verified native replacement already in-tree**,
so it is the cheapest metric-moving drop (17 → 16).

## Ground truth (audited 2026-07-17)

Direct OCCT-HLR includes in `src/` (grep `HLRBRep|HLRAlgo|HLRTopoBRep`):
- **`src/Drawings.cpp` only.** Nothing else links HLR.

`src/Drawings.cpp` HLR call-sites (the code that keeps TKHLR alive):
- `runHLR(shape, ax2, view, defl)` — **line ~211**. OCCT `HLRBRep_Algo::Add→Projector→Update→Hide`
  + `HLRBRep_HLRToShape` extraction. Called by `projectShape` (line ~348) and
  `projectShapeSection` (line ~756) as the **default** (native path is opt-in, gate default-OFF).
- `HLRBuckets` + inline `HLRBRep_Algo` — **line ~1018/1021**. The public C++ `projectView`
  (line ~1113) + the section **back-half** pass (line ~1196) run OCCT HLR directly.

Native replacement already shipped (`include/forge/native/brep/Hlr.hpp` + its TU):
- `hiddenLineRemoval(solid, dir, ...)` — **orthographic** analytic HLR. Splits each edge at the
  exact outline/depth crossings (closed-form linear roots), classifies by robust interior
  in-front sample. **Validated 1:1 vs OCCT HLRBRep_Algo to rel≤1e-6** on the polyhedral +
  analytic-quadric envelope (cyl/cone/sphere/torus). Handles BOTH native Solids and
  `importOcctSolid` bodies — the code comment at Drawings.cpp:411 states *"the ORTHOGRAPHIC
  importOcctSolid route matches exactly."*
- `hlrPerspective(solid, cam)` — analytic **perspective** HLR (world-space plane crossings,
  exact). Matches OCCT to rel≤1e-16 on **native** solids (`native_vs_occt_hlr_persp`).
- Wired into Drawings.cpp via `tryNativeProjectShape` (line ~299) behind the FEAT gate
  (`projectShape` line ~364, **default OFF**).

## The only real subtlety: dropping TKHLR removes the A/B oracle

The `native_vs_occt_hlr*` gates use OCCT `HLRBRep_Algo` as the reference. Removing TKHLR makes
those gate TUs **fail to compile** (no `HLRBRep_Algo`). Resolution (same shape as every prior
drop): once equivalence is verified at a pinned point, **capture the OCCT HLR output as golden
fixtures** (per-class projected polyline lengths + segment counts for the canonical scenes) and
convert the A/B gate into a **native-only golden regression** that needs no OCCT. Keep the OCCT
oracle runnable behind `#ifdef FORGE_HAVE_OCCT_HLR` (or a separate opt-in TU) for future
re-derivation of goldens, but exclude it from the default no-TKHLR build.

## Perspective-imported: already native-only, NOT a TKHLR blocker

`projectShapePerspective` on an imported OCCT body **throws** (`Drawings.cpp:421`) — it never
calls OCCT HLR. The imported-shell perspective divergence (visible/hidden fraction 0.605 vs
verified 0.759, +66% drawn length from duplicated boundary edges in the imported shell) is a
**separate** K4 follow-up about de-duplicating the imported shell before the silhouette pass. It
does not gate the TKHLR drop. Leave the throw in place.

## Drop sequence (each step verified before the next)

1. **Flip the native HLR FEAT gate default-ON** for the orthographic `projectShape` /
   `projectShapeSection`. Verify `native_vs_occt_hlr*` + the drawings smokes + `forge:coherence`
   still green with the gate ON (this is the *verified-safe-default-flip method*: run the exact
   CI gates with the env flag SET before flipping the compile default).
2. **Migrate the public C++ `projectView` + section back-half** (lines ~1005–1275) off
   `HLRBuckets`/`HLRBRep_Algo` onto `hiddenLineRemoval` (import OCCT bodies via
   `importOcctSolid` first, exactly as `tryNativeProjectShape` does). A/B the projectView output
   (per-class lengths) against the current OCCT output BEFORE removing the OCCT path.
3. **Capture goldens** for `native_vs_occt_hlr*` and convert those gates to native-only.
4. **Remove** `runHLR`, `HLRBuckets`, and the three `#include <HLR*.hxx>` from Drawings.cpp.
   Confirm `grep -rE 'HLR(BRep|Algo|TopoBRep)' src/` returns **nothing**.
5. **Drop `TKHLR`** from `OCCT_LIBS` in `forge-kernel/CMakeLists.txt`.
6. **Gate before push (mandatory):** rebuild `build/` clean; then
   `otool -L build/Release/forge-kernel.node | grep -c opencascade` == **16**;
   `bash test/native/run_native.sh` (JOBS=3) == **137/137**; `native_vs_occt_core.mjs` 34/34;
   the drawings gate; `forge:coherence` DISCRIMINATION PASS. **macOS flat-namespace hides bad
   drops** — the true gate is **Linux CI green**, never the mac link.

## Discipline
- Worktree or warm main tree, **commit locally, DO NOT push** — the human reviews the diff +
  gate results and pushes (keeps CI-green control, one workflow-kind at a time).
- If any A/B step diverges (e.g. projectView native ≠ OCCT), **do NOT drop the lib** — leave the
  gate flipped only for the paths that match exactly, record the precise blocker here, and
  report honestly. No faked pass; native HLR reports `ok==false` + reason rather than fabricate.

---

# VERIFICATION LOG + BLOCKER (2026-07-17, attempt 1 — TKHLR NOT dropped)

**Outcome: TKHLR is NOT dropped. `otool` opencascade count stays 17.** A/B measurement found a
real structural divergence on the projectView / sectionView import route (Step 2). Per the
Discipline rule above, the lib stays. All gates left GREEN; no code shipped (the exploratory
Drawings.cpp wiring was reverted after it measured the divergence — nothing faked, nothing left
half-wired).

## What was VERIFIED good (measured, machine-precision)
- **Native HLR is geometrically correct on clean native-built B-rep solids.** Both A/B oracle
  harnesses pass vs OCCT 7.9.3 `HLRBRep_Algo` to machine precision:
  - `test/native_vs_occt_hlr.cpp` — CASE A unit cube iso `(-1,-1,-1)`: native 9 vis / 3 hid seg,
    V-len 7.348469 / H-len 2.449490, **rel ≤ 3.5e-15**. CASE B 4×4×4 block − 1×1 through-hole,
    view `(-0.2,-0.2,-1)`: 16 vis / 10 hid, V-len 32.223760 / H-len 15.737807, **rel ≤ 5e-15**.
  - `test/native_vs_occt_hlr_persp.cpp` — Scene A persp unit box: 9 vis / 3 hid, visFrac 0.762308,
    **rel ≤ 1.5e-16**. Scene B two-box occlusion at 4 AND 64 samples/edge: 7 vis / 19 hid,
    visFrac 0.391010, **rel ≤ 1.8e-16** (analytic split, sample-count independent).
- **`projectShape` on a NativeSolid handle is correct** (uses the native Solid directly, no
  import). Debug-instrumented in-`.node`: `makeBox(100,60,40)` front view → native
  `hiddenLineRemoval` returns **12 segments (4 visible + 8 hidden)**, the exact OCCT polyline
  structure. (Earlier "520/1040" readings were a MISREAD of the LEGACY packed-Float32 array
  *length* — 4 edges × 65 pts × 2 coords = 520 — not the polyline count.) `drawings_smoke.js`
  (native `projectShape`) passes with the FEAT gate ON.

## THE BLOCKER — projectView / sectionView must import, and the import route diverges
`forge::drawings::projectView(const TopoDS_Shape&)` and `sectionView`'s back-half take a raw
`TopoDS_Shape` (no ShapeHandle), so the only native route is `importOcctSolid(shape) →
hiddenLineRemoval`. Measured on the `projectView` test-1 fixture (`makeBox(100,60,40)`, front):

| metric        | OCCT (default) | native via importOcctSolid |
|---------------|----------------|----------------------------|
| visible polys | 4              | 5 (extra √(100²+40²)=**107.703** diagonal) |
| hidden polys  | **4**          | **13** raw / **9** after culling 0-length |
| smoke assert  | `hidden==4‖0`  | **FAILS** (got 13)         |

Root cause (code-confirmed): `importOcctSolid` uses the **"faceted topology over exact geometry"**
model (`include/forge/OcctImport.hpp` — every analytic face is triangulated in its (u,v) domain).
A box quad face → 2 triangles sharing a **diagonal**, and that diagonal is a *topological Edge* in
the imported Solid. The native HLR (`src/native/brep/Hlr.cpp:388-410`) draws **every topological
B-rep edge**, so a box imports as **18 edges = 12 real + 6 facet diagonals**, vs OCCT's 12 real
edges on the true analytic B-rep. Net: native draws diagonals + duplicate face edges → wrong
polyline counts → the `projectView` smoke's `hidden==4‖0` assertion fails.

Two independent gaps stack on the import route:
1. **Facet feature-edge suppression is missing.** OCCT HLR draws only *sharp* model edges +
   silhouettes; native draws all facet edges. For **planar** faceting this is a coplanar-shared-edge
   (dihedral ≈ 0) suppression; for **curved** faceting (a bored cylinder's wall) it is *tangent/
   smooth* edge suppression — the drilled-box `projectShape` native draws 392 hidden facet edges
   vs OCCT's 388-fragment result and inflates the SVG 220 KB → 2.2 MB. This is proper HLR
   feature-edge detection, a **substantial native-HLR enhancement**, not a wiring fix.
2. **Straight edges are over-chorded** — native emits `samplesPerEdge`+1 = 65 collinear points per
   straight edge (OCCT uses 2). Visually identical, but bloats payload; secondary.

**Correction to this brief's premise:** the claim (line ~26 here and `Drawings.cpp:411` comment)
that *"the ORTHOGRAPHIC importOcctSolid route matches exactly"* is **inaccurate for polyline
structure** — it holds only for rotation-invariant *summed projected length on the A/B fixtures,
which are hand-built with clean Euler quad/loop topology (`tb.buildBox` / `nativeBlockWithSquareHole`,
4-coedge faces) and therefore carry NO facet diagonals*. The A/B harnesses never exercised an
`importOcctSolid` round-trip, so this divergence was latent.

## What it takes to actually drop TKHLR (concrete follow-up)
- **Primary:** give the native HLR **feature-edge detection** — suppress edges shared by two
  coplanar (dihedral≈0) or tangent/smooth faces so a faceted/imported Solid draws only real model
  edges + silhouettes, matching OCCT. Re-run both A/B harnesses (clean solids must stay 9/3, 16/10)
  AND add an `importOcctSolid`-round-trip A/B case (the missing coverage) + the `projectView` smoke.
- **Alternatively / additionally:** re-plumb `projectView`/`sectionView` (or their bindings, which
  DO hold the ShapeHandle — `binding.cpp` `ProjectView2D`/`SectionView2D`) to run native HLR on the
  **NativeSolid directly** when the handle is native, avoiding the lossy import for the common case.
  This still leaves imported/STEP (`ShapeKind::Occt`) bodies needing the feature-edge fix above.
- Then cull 0-length projected polylines and collapse collinear runs on straight edges (payload).

## Gate results at the end of this attempt (all GREEN, TKHLR intact)
- `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **17** (TKHLR still linked).
- `JOBS=3 bash test/native/run_native.sh` → **ALL 137 NATIVE GATES PASS** (incl. `brep/hlr_test`;
  no `gdt/fcf_evaluator_test` failure).
- `native_vs_occt_core.mjs` → **34/34**.
- `native_vs_occt_hlr` → **2/2**; `native_vs_occt_hlr_persp` → **PASS both scenes @ 4 and 64**.
- `drawings_smoke.cjs` / `drawings_smoke.js` / `drawings_extra_smoke.js` → **ALL PASS** (OCCT path).
- `npm run forge:coherence` → **DISCRIMINATION PASS** (clean 1.0000 vs incoherent 0.0443).

---

# VERIFICATION LOG + BLOCKER (2026-07-17, attempt 2 — FEATURE-EDGE SUPPRESSION SHIPPED, TKHLR still NOT dropped)

**Outcome: the native-HLR feature-edge suppression from attempt-1's "concrete follow-up" is
BUILT and A/B-verified — it fully closes the POLYHEDRAL import blocker (a box imports 18→12
edges → front view `5 vis / 13 hid` → `4 vis / 4 hid`, per-class projected length matching OCCT
to rel `0`). But the CURVED-import SILHOUETTE case (attempt-1 case 3) still diverges, so TKHLR is
NOT dropped. `otool` opencascade stays 17.** Verified partial committed locally; all gates GREEN.

## What shipped (the enhancement)
- `include/forge/native/brep/Hlr.hpp` — new `HlrOptions::cullSmoothEdges` (**default ON**) +
  `smoothTol`. When on, an interior MANIFOLD edge whose two DISTINCT incident faces lie on the
  SAME underlying analytic surface is treated as a NON-FEATURE edge and NOT drawn — exactly what
  OCCT HLRBRep does (it draws only sharp + outline edges).
- `src/native/brep/Hlr.cpp` — `sameUnderlyingSurface(a,b,tol)` (coplanar Plane / same
  Cylinder-axis+radius / same Sphere / same Cone / same Torus; NURBS + bare-polygon faces are
  conservatively KEPT), `edgeIncidentFaces` (the ≤2 faces via the mated coedge slots), and
  `isSuppressedFeatureEdge`. Wired into BOTH the orthographic and perspective edge-collection
  loops: a first-seen non-feature edge is skipped (never sampled, never classified); kept edges
  keep their exact incident-face set. **Silhouette edges are always kept.**
- SAFETY: the cull fires ONLY when BOTH incident faces carry an analytic `Surface` AND those
  surfaces coincide. Native solids whose faces are bare polygons (`surface==nullptr`, e.g.
  `TopologyBuilder::buildBox` / `nativeBlockWithSquareHole`) are NEVER affected — so the A/B-exact
  box + holed-block results are byte-identical (verified below).

## What is VERIFIED good (measured, machine-precision) — `test/native_vs_occt_hlr_import.cpp`
A NEW A/B gate (`test/build_hlr_import_gate.sh`, links OCCT + `OcctImport.cpp`) — the
`importOcctSolid`-round-trip coverage this brief flagged as MISSING. It imports an OCCT box +
cylinder and A/Bs native `hiddenLineRemoval(cullSmoothEdges=ON)` vs OCCT `HLRBRep_Algo`:
- **BOX front(-Y):** OCCT `4 vis / 4 hid`, native `4 vis / 4 hid`, per-class length rel **0.000e+00**.
- **BOX iso(-1,-1,-1):** OCCT `9 vis / 3 hid`, native `9 vis / 3 hid`, per-class length rel **5.2e-16**.
- **CYLINDER top(-Z)** (view ALONG the cap normal — the cap rings ARE the outline): total length
  rel **2.7e-3** (chordal 64-gon vs OCCT 24-sample — within tessellation tolerance). **9/9 asserted PASS.**

## THE REMAINING BLOCKER — the curved-solid SILHOUETTE is not reconstructed from a faceted import
- **CYLINDER front(-Y)** (view ACROSS the axis): OCCT draws the two analytic SILHOUETTE (outline)
  lines (the frustum's vertical sides). Native suppresses the wall's tessellation seams correctly
  (they are not model edges) but does NOT emit the curved solid's silhouette outline, so it
  under-draws by exactly those two lines: OCCT tot `260.0` vs native `160.0` → **missing 100.0**
  (= 2 × the 50-tall silhouette line). Measured, NON-FATAL in the gate.
- ROOT CAUSE (code-confirmed, `Hlr.cpp`): the silhouette generator marches `normal·N==0` by
  scanning **v** at each fixed **u**. For a cylinder the normal is radial — CONSTANT in v — so the
  v-scan never finds a crossing; the silhouette runs along v at the single u where the radial
  normal ⟂ N, which this march can't detect. (This latent gap was never exercised because the
  A/B HLR gates were box-only.) Even a u-scanning fix would produce PER-FACET fragments on the
  faceted import that don't stitch into the two clean full-height outline lines — the analytic
  silhouette of a curved solid needs a GLOBAL silhouette-curve tracer on the (kept) analytic
  surface, independent of the facet tessellation.
- Before-suppression, native "drew" the outline only accidentally, via the facet seams straddling
  the tangent angle (the `5 vis / 13 hid` box mess had the analogue); suppressing them — correct
  for real model edges — removes that accidental outline, exposing the true silhouette gap.

## What it takes to actually drop TKHLR now (concrete follow-up, narrowed)
- **Native-HLR global SILHOUETTE tracer** for analytic-quadric faces: trace the `normal·viewDir==0`
  locus as a continuous curve over each analytic surface's full (u,v) trim (u-scan AND v-scan, or
  a proper level-set march), emit it as `HlrEdgeKind::Silhouette` outline polylines, so a
  curved import's outline matches OCCT independent of faceting. Re-run `native_vs_occt_hlr_import`
  → the CYLINDER front(-Y) case must reach the chordal tolerance (like top(-Z)).
- THEN the drop sequence in this brief's top half is unblocked: flip the Drawings FEAT gate
  default-ON, migrate `projectView` + section back-half off `HLRBuckets`/`runHLR` onto
  `hiddenLineRemoval`, capture goldens + convert `native_vs_occt_hlr*` to native-only, remove the
  OCCT HLR `#include`s + `runHLR`/`HLRBuckets`, drop `TKHLR` from `OCCT_LIBS`.

## Gate results at the end of attempt 2 (all GREEN, TKHLR intact)
- `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **17** (TKHLR still linked).
- `JOBS=3 bash test/native/run_native.sh` → **ALL 137 NATIVE GATES PASS**.
- `FORGE_KERNEL=build/Release/forge-kernel.node node test/native_vs_occt_core.mjs` → **34/34**.
- `native_vs_occt_hlr` → **2/2** (rel≤5e-15, box + holed block UNCHANGED under cull default-ON);
  `native_vs_occt_hlr_persp` → **PASS both scenes**; `brep/hlr_test` → **29/29**.
- `test/build_hlr_import_gate.sh` (`native_vs_occt_hlr_import`) → **9/9 asserted PASS** (NEW gate).
- `drawings_smoke.cjs` / `.js` / `drawings_extra_smoke.js` → **ALL PASS** (OCCT path, FEAT gate OFF,
  unchanged: front `visible=4 hidden=388`).
- `node test/coherence_logic_score.mjs` → **DISCRIMINATION PASS** (clean 1.0000 vs incoherent 0.0435).

---

# VERIFICATION LOG + BLOCKER (2026-07-17, attempt 3 — SILHOUETTE BLOCKER RESOLVED, TKHLR still NOT dropped)

**Outcome: attempt-2's remaining silhouette blocker is RESOLVED — the grouped analytic
silhouette makes an imported curved solid's outline match OCCT (cylinder front `160 → 260`,
per-class `V=180 H=80`, rel `0`). The native HLR is now geometrically COMPLETE for the
polyhedral + analytic-quadric envelope on BOTH the built-native and faceted-import routes.
But the FULL TKHLR DROP hit TWO new, measured walls (below), so `TKHLR` is NOT dropped;
`otool` opencascade stays 17. The silhouette fix is shipped + committed (all gates GREEN).**

## What shipped (the fix — commit on branch `archdisc`)
- `src/native/brep/Hlr.cpp` — the ORTHOGRAPHIC silhouette pass now GROUPS curved sub-faces by
  shared analytic-surface **signature** (quantised kind/axis/radii/origin) + **shared-edge
  connectivity** (the SAME grouping `analyticFaceInventory` uses) and traces the silhouette over
  each GROUP's **FULL** parameter range instead of per-narrow-sub-face:
    * **Cylinder / Cone** — closed-form iso-u outline line(s): `a cos u + b sin u + c == 0`
      (`c=0` cylinder, `c=-(r2-r1)(axis·N)` cone), one straight line `S(u,vMin)→S(u,vMax)` per root
      in the trim. This is the exact locus the old per-sub-face **v-scan** could never find (a
      cylinder's radial normal is CONSTANT in v).
    * **Sphere** — the exact great circle in the plane through the centre ⟂ N, clipped to the (u,v)
      trim.
    * **Torus** — marched `normal·N==0` locus over the grouped grid (both scan directions),
      greedily stitched (no closed form; strictly better than the per-strip march that found none).
  Each curve skips its whole group's face-id set so the surface does not self-occlude its outline
  (== OCCT `OutLineVCompound`). The built-native and PERSPECTIVE paths are UNCHANGED.
- `test/native_vs_occt_hlr_import.cpp` — the CYLINDER front(-Y) case is upgraded from MEASURE-only
  to an ASSERTED total-length gate (native `260` == OCCT `260`, chordal tol). **10/10** (was 9/9).

## What is VERIFIED good (measured, machine-precision — the fix)
- `test/build_hlr_import_gate.sh` → **10/10 ASSERTED**. CYLINDER r20 h50 front(-Y): OCCT
  `vis=4 hid=2 V=180 H=80 tot=260`, NATIVE `V=180 H=80 tot=260`, **totRel 0.000e+00** — the 2
  analytic silhouette lines RESTORED. BOX front `4v/4h` rel `0`, iso `9v/3h` rel `5e-16` UNCHANGED.
- `native_vs_occt_hlr` → **2/2** (box iso + holed block, rel≤5e-15 UNCHANGED — bare-polygon faces
  are never grouped); `native_vs_occt_hlr_persp` → **PASS both scenes**; `brep/hlr_test` → **29/29**;
  `run_native.sh` → **137/137**; `native_vs_occt_core.mjs` → **34/34**; drawings smokes → **ALL PASS**
  (FEAT gate OFF, OCCT path unchanged); `forge:coherence` → **DISCRIMINATION PASS**.

## THE REMAINING BLOCKERS — why the DROP itself is deferred (two measured walls)
Wired the native HLR into `projectView`/`sectionView` (import → `hiddenLineRemoval`) behind the FEAT
flag and A/B-measured it. The silhouette is now correct, but:

1. **`projectView` / `sectionView` only receive a raw `TopoDS_Shape`** (the binding passes
   `ShapeRegistry::get(h)`, not the handle), so the ONLY native route is
   `importOcctSolid(shape) → hiddenLineRemoval`. `importOcctSolid` uses **faceted topology over
   exact geometry**: a Ø20 bore imports as ~64 lateral strips. The occluder builder `emitFaceTris`
   then **RE-tessellates every strip's narrow (u,v) window into an nu×nv = 48×8 = 768-triangle
   grid** → ~**50 000 occluder triangles** for one drilled box, and the O(edges × samples ×
   triangles) classifier makes native `projectView(drilled-box, front)` take **> 100 s** (vs OCCT
   milliseconds). Measured: the SAME drilled box via `projectShape` (which uses the clean
   **NativeSolid** directly — `forge.cut` returns native by default — with **one Surface per logical
   face**, not 64 strips) runs in **5.3 s**; `projectView` importing the faceted `TopoDS_Shape` for
   the identical shape/view runs **>100 s** (timed out at 2 min). Correctness is fine (plain box
   `4v/4h`); the **performance is a wall** for a production HLR.

2. **Even the clean NativeSolid-direct native HLR is ~5.3 s/view** for a drilled box (266 hidden
   segments × per-segment occlusion over the bore's 768-tri fan) — **~100–1000× slower than OCCT
   `HLRBRep_Algo`** (~ms). `projectShape`'s FEAT gate is default-OFF precisely so production uses
   fast OCCT HLR; **dropping TKHLR removes that fast path** and forces the slow native HLR on every
   `projectShape`/`projectView`/`sectionView` call. The drawings SMOKES pass (no time assertion),
   but a 100–1000× HLR slowdown across all drawing generation is not an acceptable production drop.

## What it takes to actually drop TKHLR now (concrete follow-up, re-narrowed)
- **Native-HLR occluder acceleration (the real gate):** build a spatial index (BVH/grid) over the
  occluder triangle soup so the point-occlusion + `segmentSplitCandidates` are `O(log n)` not
  `O(n)`, AND make `emitFaceTris` **reuse a faceted-import sub-face's OWN triangle(s)** (a narrow
  strip needs 1–2 depth triangles, not a 768-triangle re-tessellation). Target: native
  `projectView(drilled-box)` within a small constant of OCCT (< ~50 ms).
- **Re-plumb `projectView`/`sectionView` (public sig + `binding.cpp` `ProjectView2D`/`SectionView2D`)
  to pass the `ShapeHandle`**, so a `NativeSolid` input (the default for `makeBox`/`cut`/…) runs the
  native HLR on the CLEAN solid (one Surface/face) and never imports the faceted `TopoDS`. This
  removes wall #1 for the common case; imported STEP (`ShapeKind::Occt`) bodies still need the
  faceted-occluder acceleration above.
- THEN the drop is unblocked: flip the FEAT gate, migrate `projectView`/section back-half off
  `runHlrToPolylines`/`HLRBuckets`, capture goldens for `native_vs_occt_hlr*`, remove the 3
  `#include <HLR*.hxx>` + `runHLR`/`runHlrToPolylines`/`HLRBuckets`, drop `TKHLR` from `OCCT_LIBS`.
- NOTE the A/B oracle gates (`native_vs_occt_hlr*`, `build_hlr_import_gate.sh`) are STANDALONE
  manual-clang builds that link their OWN `-lTKHLR` (system brew OCCT), so they keep compiling +
  running after `TKHLR` is dropped from the `.node`'s `OCCT_LIBS` — the golden conversion is
  insurance for the eventual full-OCCT removal, not a blocker for THIS drop.

## Gate results at the end of attempt 3 (all GREEN, TKHLR intact — silhouette fix shipped)
- `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **17** (TKHLR still linked).
- `JOBS=3 bash test/native/run_native.sh` → **ALL 137 NATIVE GATES PASS** (incl. `brep/hlr_test` 29/29).
- `FORGE_KERNEL=build/Release/forge-kernel.node node test/native_vs_occt_core.mjs` → **34/34**.
- `native_vs_occt_hlr` → **2/2**; `native_vs_occt_hlr_persp` → **PASS both scenes**;
  `test/build_hlr_import_gate.sh` (`native_vs_occt_hlr_import`) → **10/10** (was 9/9 — CYLINDER
  front now ASSERTED, silhouette RESTORED).
- `drawings_smoke.cjs` / `.js` / `drawings_extra_smoke.js` → **ALL PASS** (OCCT path, FEAT gate OFF).
- `node test/coherence_logic_score.mjs` → **DISCRIMINATION PASS** (clean 1.0000 vs incoherent 0.0435).

---

# VERIFICATION LOG + BLOCKER (2026-07-17, attempt 4 — PERF WALL RESOLVED (2D-BVH), TKHLR still NOT dropped)

**Outcome: attempt-3's PERF blocker is RESOLVED. A 2D bounding-volume hierarchy over
the projected occluder triangle soup turns the per-piece occlusion tests from
O(triangles) into O(log n), making the native orthographic HLR ~40–50× faster on
BOTH the clean-NativeSolid AND the faceted-import routes, with OUTPUT BYTE-FOR-BYTE
IDENTICAL. But the FULL TKHLR DROP is deferred on NON-perf walls (below), so `TKHLR`
is NOT dropped; `otool` opencascade stays 17. The perf fix is shipped + committed
(all gates GREEN, output unchanged).**

## What shipped (the fix — pure acceleration, output-preserving)
- `src/native/brep/Hlr.cpp` — new internal `OccluderBVH`: a 2D BVH (median-index split
  on the longer centroid axis, leaf 4, depth log2(n)) built ONCE per view over the
  projected occluder ViewTri soup. The two hot tests now QUERY it instead of scanning
  every triangle:
    * `occludedPoint(...)` — `queryPoint(u,v)` returns triangles whose 2D AABB contains
      the point; per-face flags (bit0 = a solid tri occludes, bit1 = a window/hole tri
      passes through) are OR-aggregated over that candidate set → a face hides iff
      `bit0 && !bit1` (the SAME per-face predicate the old scan applied, OR'd over faces).
    * `segmentSplitCandidates(...)` — `queryBox(segment bbox)` returns triangles whose
      2D AABB overlaps the segment; `insideSegTri` then filters to the exact contributing
      set. The candidate MULTISET (hence the sort+unique cut list) is identical to the scan.
  Replaced `FaceOccluder`/`groupByFace` (deleted — the BVH reads faceId+isHole off each
  ViewTri directly). The PERSPECTIVE path (`occludedPersp`/`perspSplitCandidates`) is
  UNCHANGED (it is native-only, not on the projectShape/projectView/section drop path).
- BYTE-FOR-BYTE PROOF: every stored AABB is padded by `1e-7·extent` — far above the
  interior tests' ~`1e-9·extent` barycentric-slack footprint — so pruning can never drop
  a triangle those tests would accept at tolerance. The BVH returns a conservative
  SUPERSET; the exact tests (`pointInTri`/`insideSegTri`/`planeDepthAt`) do the final
  filtering, so the classified segments are identical (verified: the perf probe prints an
  IDENTICAL `visSeg/hidSeg/V/H/totalEdges` line for the pre-BVH scan and the BVH build).

## What is VERIFIED good (measured — before/after on the SAME probe, `test/build_hlr_perf.sh`)
Drilled box 100×60×40, r10 through-bore, front(−Y). BEFORE = HEAD `99919134` Hlr.cpp
(brute-force scan) swapped into the same probe; AFTER = the 2D-BVH. **Output byte-identical
in every case** (`visSeg=4`, `V=280 H=440`).

| bore nSeg | faces | hidden segs | BEFORE (ms) | AFTER (ms) | speedup |
|-----------|-------|-------------|-------------|------------|---------|
| 64        | 70    | 138         | 1323.56     | 34.24      | ~39×    |
| 128       | 134   | 266         | **5074.21** | **100.54** | **~50×**|
| 256       | 262   | 522         | 20143.01    | 425.16     | ~47×    |

The nSeg=128 / 134-face / **266-hidden-segment** row IS attempt-3's `projectShape`
drilled box (attempt-3 measured **~5306 ms**) → now **~100 ms**. The faceted-import
route (attempt-3's **">100 s"** wall — `importOcctSolid` → ~400 faces / ~50k occluder
triangles) is **~38 ms** now, correct output `visSeg=4 hidSeg=138 V=280 H=440`
(`test/build_hlr_import_perf.sh`). **Both attempt-3 perf walls are GONE, no pathological
blowup** — cost now scales ~linearly with tessellation.

## THE REMAINING BLOCKERS — why the DROP itself is still deferred (NON-perf walls)
Perf no longer blocks. Measured the drop's viable first step + identified two structural
walls that keep TKHLR:

1. **`projectShape` native flip is viable (measured):** `FORGE_NATIVE_FEATURES=1 node
   test/drawings_smoke.js` (projectShape → native `hiddenLineRemoval`) PASSES —
   front `visible=4 hidden=266` (native fragmentation; the smoke asserts `visible∈[4,12]`
   + bbox≈50, both satisfied), top `visible=260 hidden=8`. So flipping the FEAT gate ON for
   projectShape is clean.
2. **WALL A — envelope regression (Bible §0 honesty):** `projectShape`/`projectView`
   HONESTLY DEFER to OCCT `HLRBRep_Algo` for inputs OUTSIDE the native HLR envelope —
   which `Hlr.hpp`'s own HONEST ENVELOPE names: **freeform trimmed-NURBS faces** (drawn
   without smooth silhouette — "a follow-up"), plus **NativeMesh** handles and
   **Torus/Revolution/non-analytic imports** where `importOcctSolid` returns `ok=false`.
   Dropping `TKHLR` REMOVES that fallback, so those inputs would silently lose their
   outline/silhouette (or produce an empty view + throw) — a real correctness regression on
   non-analytic parts. Native HLR is complete for POLYHEDRAL + ANALYTIC-QUADRIC only; it is
   NOT yet a total replacement for OCCT HLR across all inputs.
3. **WALL B — `projectView`/`sectionView` migration is UNVERIFIED (esp. the section
   back-half):** both take a raw `TopoDS_Shape` (not a `ShapeHandle`), so the drop needs the
   binding re-plumb (pass the handle) + migrating `runHlrToPolylines`/`HLRBuckets` (incl. the
   `sectionView` back-half's intricate ax2→plane-local reframe, `Drawings.cpp:1196-1248`)
   onto native, A/B'd against OCCT BEFORE removing the OCCT path. `drawings_smoke.cjs`
   asserts an exact-ish plain-box `hidden===4||0` (native import gives 4 ✓) but the section
   back-half native output is not yet A/B-verified. This is bounded work, but it is a
   backend swap that changes polyline fragmentation (native SVG ~1.7 MB vs OCCT ~220 KB —
   payload, not correctness) and was not closed in this PERF-scoped session.

## What it takes to actually drop TKHLR now (concrete follow-up, re-narrowed to NON-perf)
- **Close the envelope (WALL A):** native-HLR freeform-NURBS smooth-silhouette tracer (the
  documented `Hlr.hpp` follow-up), so a freeform/import part draws its outline without OCCT.
  Until then, dropping OCCT HLR is a silent regression on non-analytic inputs — do NOT drop.
- **Migrate + A/B `projectView`/`sectionView` (WALL B):** re-plumb the bindings to pass the
  `ShapeHandle` (native for `NativeSolid`, `importOcctSolid` for `Occt`), route
  visible/hidden/silhouette + the section back-half through `hiddenLineRemoval`, and A/B the
  per-class projected lengths vs the current OCCT output on every drawings-smoke fixture
  BEFORE removing `runHLR`/`runHlrToPolylines`/`HLRBuckets`. Update the count-sensitive smoke
  prints to the native fragmentation (length-based, not OCCT-fragment-count).
- THEN: remove the 3 `#include <HLR*.hxx>` + `runHLR`/`runHlrToPolylines`/`HLRBuckets`, drop
  `TKHLR` from `OCCT_LIBS`, rebuild clean, `otool` == 16, and the true gate is **Linux CI
  green** (macOS flat-namespace hides a bad drop). The standalone A/B gates
  (`native_vs_occt_hlr*`, `build_hlr_import_gate.sh`) link their OWN `-lTKHLR` (brew OCCT), so
  they keep compiling after the `.node` drop — golden conversion stays insurance, not a blocker.

## Gate results at the end of attempt 4 (all GREEN, TKHLR intact — perf fix shipped)
- `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **17** (TKHLR still linked).
- `JOBS=3 bash test/native/run_native.sh` → **ALL 137 NATIVE GATES PASS** (incl. `brep/hlr_test`
  29/29; no new timeouts — `native_boolean_test` well within its 300 s cap; the BVH is HLR-local).
- `node test/native_vs_occt_core.mjs` → **34/34**.
- `native_vs_occt_hlr` → **2/2** (box iso + holed block, rel≤5e-15 UNCHANGED);
  `native_vs_occt_hlr_persp` → **PASS both scenes** (persp path untouched);
  `test/build_hlr_import_gate.sh` (`native_vs_occt_hlr_import`) → **10/10** (cylinder front 260,
  box front 4v/4h — silhouette + feature-edge parity UNCHANGED under the BVH).
- `drawings_smoke.cjs` / `.js` / `drawings_extra_smoke.js` → **ALL PASS** (OCCT path, FEAT gate
  OFF, front `visible=4 hidden=388` unchanged).
- `node test/coherence_logic_score.mjs` → **DISCRIMINATION PASS** (clean 1.0000 vs incoherent 0.0443).
- PERF harnesses (new, standalone, not auto-run by `run_native.sh`): `test/build_hlr_perf.sh`
  (native clean-solid) + `test/build_hlr_import_perf.sh` (OCCT faceted-import) — the before/after
  evidence above.
