# K-TKShHealing drop brief — ATTEMPTED → NOT dropped (honest blocker, all gates green)

**Metric:** `otool -L build/Release/forge-kernel.node | grep -c opencascade` = **17 (unchanged)**.
TKShHealing (ShapeFix / ShapeAnalysis / ShapeBuild / ShapeConstruct / ShapeExtend /
ShapeUpgrade / ShapeProcess / BRepBuilderAPI_Sewing) is **still linked** and cannot be
dropped this session. This is the honest outcome: nothing faked, nothing degraded.

**What shipped (verified partial, all gates green):** removed **3 genuinely-dead
`#include`s** of TKShHealing headers (`Features.cpp` ×2, `Nurbs.cpp` ×1) — a small,
safe reduction of the toolkit's `#include` surface that de-risks the eventual drop by
shrinking the audit set. No behaviour change; no live call was touched.

Date: 2026-07-17. Branch `archdisc`. Roadmap Tier-B (was estimated "~10 direct uses"; the
real live surface is **~28 call sites across 8 files**, confirming the roadmap's own
"#uses estimates are OPTIMISTIC" warning — same pattern as TKPrim 8→33).

---

## Why the drop is blocked (the one-paragraph version)

The in-house native healer is genuinely strong **but it operates on native
`TopologyBuilder`/`Face*` topology as VERTEX-POSITION RINGS** — a geometry-light,
*faceted polygon* representation (`healBRep` in `src/native/brep/Heal.cpp`, `sewFaces`
in `src/native/brep/Sew.cpp`). Every OCCT healing site, by contrast, takes and returns
an OCCT `TopoDS_Shape` carrying **exact curved geometry** (NURBS surfaces, cylinders,
class-A G2 patches). Routing those through the native healer would either (a) require a
full `TopoDS`↔native round-trip that preserves exact surfaces — which does not exist
(that is the K6/K7 core-substrate work) — or (b) collapse curved faces to polygons,
silently destroying geometry. On top of that, **three OCCT fixups have NO native
equivalent at all** (`ShapeUpgrade_UnifySameDomain`, free-wire cap synthesis, the narrow
outward-orientation entry). So TKShHealing is load-bearing.

---

## Full site inventory (audited `src/`)

Legend — **HARD**: no native equivalent exists; **GATED**: has a native path but it is
default-OFF *and* the OCCT branch is the required deferral fallback for non-analytic
input; **UNGATED**: OCCT only, general curved solids/NURBS; **DEAD**: unused include.

| # | Site (file:sym) | OCCT fixup | Native cover? | Verdict |
|---|---|---|---|---|
| 1 | `Healing.cpp::simplifyShape` | `ShapeUpgrade_UnifySameDomain` (merge co-planar faces / co-linear edges, B-spline concatenation) | **NONE** — no native ShapeUpgrade in `brep/` (documented in-source, Healing.cpp:68-71) | **HARD BLOCKER** |
| 2 | `Healing.cpp::autoFillMissingFaces` | `ShapeAnalysis_FreeBounds` + `BRepOffsetAPI_MakeFilling` + `ShapeFix_Solid` — FABRICATES a new Coons/energy-min cap across a free wire | **NONE** — native gap-fill only SNAPS endpoints already within tol; it never synthesizes a cap surface (different op; Healing.cpp:73-79). `SurfaceFill/GregoryFill` exist but are NOT wired to a free-wire-cap pipeline | **HARD BLOCKER** |
| 3 | `Healing.cpp::harmonizeNormals` | `ShapeFix_Shape` + `ShapeAnalysis_Shell` + `ShapeFix_Solid` (outward orientation) | native `healBRep` pass (6) does orientation, but this entry returns a bare handle (no report) and is left on OCCT (Healing.cpp:80-84) | **HARD BLOCKER** (narrow, OCCT-only) |
| 4 | `Healing.cpp::sewShape` | `BRepBuilderAPI_Sewing` (+ MakeSolid) | GATED → `tryNativeSewShape`→`sewFaces`; DEFERS to OCCT for OCCT-backed non-analytic (Torus/Revolution/NURBS/non-manifold) imports | **GATED — OCCT fallback required** |
| 5 | `Healing.cpp::autoRepairSelfIntersection` | `ShapeFix_Shape` (DONE1..6 status) | GATED → `tryNativeHeal`→`healBRep`; DEFERS for non-analytic imports | **GATED — OCCT fallback required** |
| 6 | `ShapeFix.cpp::repair` | `ShapeFix_Shape` (SetPrecision/Min/MaxTolerance, DONE1..8/FAIL1..8) | GATED → `tryNativeRepair`→`healBRep`; DEFERS for NURBS/Torus/mesh. **In-source capability gap:** minTol/maxTol tolerance band + DONE/FAIL bit semantics have no native equivalent (ShapeFix.cpp:257-265) | **GATED — OCCT fallback required** |
| 7 | `Sewing.cpp::sew` | `BRepBuilderAPI_Sewing` (NbFree/Multiple/Contiguous/**Degenerated**Edges) | GATED → `tryNativeSew`→`sewFaces`; DEFERS for NURBS/Torus/mesh. `NbDegeneratedShapes` count has no native equivalent (Sewing.cpp:164-169) | **GATED — OCCT fallback required** |
| 8 | `ClassASurfacing.cpp::stitchG2` | `BRepBuilderAPI_Sewing` over class-A G2 NURBS faces + per-edge continuity report | GATED → `tryNativeStitchG2`; DEFERS for ANY OCCT-backed input or a continuity request. G2 patches are NURBS → faceted native sew loses geometry | **GATED — OCCT fallback required** |
| 9 | `Nurbs.cpp::sewNurbsFaces` | `BRepBuilderAPI_Sewing` over NURBS faces (`fetch(h)` = OCCT faces) | **NONE** — faceted native sew would destroy NURBS geometry; no gate | **UNGATED BLOCKER** |
| 10 | `DirectEdit.cpp::unifyFaces` | `ShapeUpgrade_UnifySameDomain` | **NONE** (same gap as #1) | **HARD BLOCKER** |
| 11 | `DirectEdit.cpp::heal()` → `defeature`/`deleteFaceAndHeal` (:205,:268) | `ShapeFix_Shape` (wound-heal after `BRepAlgoAPI_Defeaturing`) on general solids | **NONE** for curved solids; no gate | **UNGATED BLOCKER** |
| 12 | `DirectModeling.cpp::pushPullFace/moveFace/rotateFace` (:435,:482,:530) | `ShapeFix_Shape` light-heal after OCCT booleans on general curved solids | **NONE** for curved solids; no gate | **UNGATED BLOCKER** |
| 13 | `DirectModeling.cpp::replaceFace` (:624,:628) | `BRepBuilderAPI_Sewing` + `ShapeFix_Shape` on a swapped-in (possibly NURBS) face shell | **NONE** for curved faces; no gate | **UNGATED BLOCKER** |
| — | `Features.cpp:71,90` | `#include <BRepBuilderAPI_Sewing.hxx>`, `#include <ShapeFix_Shape.hxx>` | **DEAD** — no symbol used in the TU | **REMOVED this session** |
| — | `Nurbs.cpp:49` | `#include <ShapeFix_Wire.hxx>` | **DEAD** — no symbol used in the TU | **REMOVED this session** |
| — | `binding.cpp:16346` | comment only (`// PUSH-18 — ShapeFix_Shape repair`) | n/a | not a code site |

`Healing.cpp::checkValidity` reads as a TKShHealing site (its comment names
`ShapeAnalysis_Shell`) but the CODE uses `BRepCheck_Analyzer` (TKTopAlgo) + `BRepGProp`
only — it does **not** call TKShHealing.

---

## The precise blockers (what native genuinely cannot cover)

1. **`ShapeUpgrade_UnifySameDomain`** (sites #1 `simplifyShape`, #10 `unifyFaces`).
   Merges co-planar adjacent faces / co-linear edges and concatenates B-splines into one
   face. There is **no native equivalent** anywhere in `src/native/brep/` — the native
   suite has weld/gap-fill/sliver/orientation/non-manifold passes but no same-domain
   face-unification pass. This is the single hardest blocker and is documented in-source.

2. **Free-wire cap synthesis** (site #2 `autoFillMissingFaces`). OCCT's
   `BRepOffsetAPI_MakeFilling` fabricates a *new* energy-minimising surface spanning a
   free wire, gated by `ShapeAnalysis_FreeBounds` and finalised by `ShapeFix_Solid`. The
   native healer's gap-fill only **snaps** free-edge endpoints already within tolerance;
   it never invents a patch. Wiring native gap-fill here would silently degrade wide-gap
   capping to a no-op.

3. **Curved-geometry heal/sew** (sites #4–#9, #11–#13). The native healer/sewer is a
   *faceted polygon* engine keyed on vertex-position rings. The gated entries already
   **honestly defer to OCCT** whenever `importOcctSolid` cannot ingest the shape
   (Torus / Revolution / trimmed-NURBS / non-manifold). Removing the OCCT branch would
   drop healing/sewing for exactly those curved cases — the same
   faceted-topology-over-exact-geometry limitation the K4 (HLR) and K5 (TKMesh) briefs
   already measured. The ungated sites (#9, #11, #12, #13) operate directly on general
   curved OCCT solids/NURBS faces and have no native route at all.

4. **Report-fidelity gaps even inside the gated native paths** (documented in-source):
   `ShapeFix_Shape` min/max tolerance band + DONE1..8/FAIL1..8 bit semantics
   (ShapeFix.cpp), and `BRepBuilderAPI_Sewing::NbDegeneratedShapes` (Sewing.cpp) have no
   1:1 native expression. These are surfaced, never faked.

**Net:** ≥7 sites have no native path at all; the remaining gated sites keep OCCT as the
required deferral fallback. TKShHealing stays.

---

## What it would actually take to drop TKShHealing (future work)

1. A native **same-domain face/edge unifier** (`ShapeUpgrade_UnifySameDomain` peer):
   merge co-planar adjacent analytic faces, concatenate co-linear edges, join B-splines.
2. Wire the existing native patch synthesizers (`SurfaceFill.cpp` / `GregoryFill.cpp`)
   into a **free-wire cap pipeline** so `autoFillMissingFaces` has a native route.
3. A native heal/sew that preserves **exact curved geometry** (depends on the K6/K7
   `Geom_`→native surface substrate, and on `importOcctSolid` covering NURBS/Torus so the
   gated entries stop deferring).
4. Migrate the ungated general-solid sites (`DirectEdit::heal`, `DirectModeling`
   push/pull/move/rotate/replace, `Nurbs::sewNurbsFaces`, `ClassASurfacing::stitchG2`)
   onto that curved-preserving native heal/sew, and make it the default (not gated).
5. **Oracle removal:** the three C++ A/B gates `test/native_vs_occt_{heal,heal_ext,sew}.cpp`
   use `ShapeFix_*`/`BRepBuilderAPI_Sewing` as their OCCT reference. When TKShHealing
   drops they must be converted to native-only golden regressions with the current OCCT
   reference captured as fixtures, keeping the OCCT oracle behind an opt-in `#ifdef` TU
   excluded from the default build. (No change made this session — the gates still link
   TKShHealing and pass, see below.)

---

## VERIFICATION LOG (2026-07-17, macOS arm64, `.node` rebuilt 11:52)

Change under test: removed 3 dead TKShHealing includes (Features.cpp ×2, Nurbs.cpp ×1).
Incremental build `cmake --build build --config Release -j3` → clean (only a benign OCCT
header `sprintf` deprecation warning). `.node` mtime newer than sources; confirmed.

| Gate | Result |
|---|---|
| `otool -L …forge-kernel.node \| grep -c opencascade` | **17** (unchanged — TKShHealing still linked, as intended) |
| `JOBS=3 bash test/native/run_native.sh` | **ALL 137 / 137 NATIVE GATES PASS** |
| ↳ `brep/heal_test` | 68 / 68 |
| ↳ `brep/sew_test` | 34 / 34 |
| `node test/native_vs_occt_core.mjs` | **34 / 34 GATES PASS** |
| `node test/healing_smoke.js` | ALL PASS (sew + autoRepair + harmonize + validity) |
| `node test/smoke-meshrepair.js` | OK (dedupe/degenerate/fillHoles/smooth/decimate) |
| `node test/heal_verbs_chunk4_test.mjs` | 7 / 7 ALL PASS |
| C++ A/B `native_vs_occt_heal` | VERDICT PASS (0 gate failures) |
| C++ A/B `native_vs_occt_heal_ext` | 12 / 12 A/B checks passed |
| C++ A/B `native_vs_occt_sew` | 24 / 24 checks passed |
| `npm run forge:coherence` | **DISCRIMINATION: PASS** (clean 1.0000 vs incoherent 0.0443) |

The C++ A/B gates still link TKShHealing as the OCCT oracle and pass — proof the dead-
include removal is orthogonal and the OCCT healing path is intact. (Note: the build
command in each gate's header comment is stale — the true minimal link set is
`{Heal,Sew,Topology,Surface,Curve,Nurbs,NurbsSurface}.cpp` + `{ExactReal,
ExactPredicates3D}.cpp` + `mesh/HalfEdgeMesh.cpp`; TrimmedFace/NurbsAlgebra are NOT
needed and their transitive deps no longer resolve from the documented list.)

Linux CI: the change is include-only (no CMake/link change, otool unchanged) so the
Linux link order is unaffected — safe to push.
