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
