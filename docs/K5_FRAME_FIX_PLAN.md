# K5 — Frame-consistency (un-baked TopLoc_Location) fix plan for `occtmesh`

**Scope:** ASSESS-ONLY wave (no build). This document is the bounded spec that de-risks
the NEXT kernel session's K5 display-route drop. It pinpoints the EXACT frame bug that
reds `native_vs_occt_core.mjs` when `OcctNativeMesh.cpp` is put on the display path, and
gives the minimal change + the A/B gate to run.

Author state: `forge-kernel` main tree, addon `build/Release/forge-kernel.node`
(built 2026-07-19). All numbers below are MEASURED on that build.

---

## 0. Measured baseline (grounded, this wave)

- `node test/native_vs_occt_core.mjs` → **ALL 34 GATES PASS** (OCCT display path currently
  rides `BRepMesh_IncrementalMesh`, Tessellate.cpp:68 — the K5 change is NOT applied).
- `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **16**
  (libs: TKernel TKMath TKG2d TKG3d TKGeomBase TKGeomAlgo TKBRep TKTopAlgo TKShHealing
  TKPrim TKFillet TKOffset TKHLR **TKMesh** TKDESTEP TKXSBase). K5 drops **TKMesh → 15**.
- The two live `BRepMesh` sites remain: `src/Tessellate.cpp:68` (display) and
  `src/FeaTet.cpp:724` (tet seed). Dropping TKMesh requires BOTH off BRepMesh.
- Main tree ALREADY carries the edge-cache `(TShape+Location)` key fix
  (`OcctNativeMesh.cpp:117-149`, `TopTools_IndexedMapOfShape idx; idx.Add(e)`). That fix
  cleared extrude / revolve90 / prism. The worktree
  `.claude/worktrees/wf_ed72df97-k5-mesh` still holds the OLD `TShape`-only key — ignore it.

### The one failing case (reference geometry, measured)

`cases[11]` = **`common box∩sphere`**:
`a=makeBox(3,3,3); s=translate(makeSphere(2),1.5,1.5,1.5); common(a,s)`.

Correct result (OCCT/BRepMesh reference, `f.tessellate(h,0.05,0.3)`):
- volume **24.871**, COM **(1.5, 1.5, 1.5)**, bbox **[0,0,0] → [3,3,3]**,
  B-rep **7 faces / 9 edges**, χ=2, **genus 0**.

Any correct native display tessellation MUST reproduce that bbox/genus (the gate asserts
faceting-independent χ/genus + a `2e-2` bbox tol for curved cases).

---

## 1. EXACT root cause — un-baked `TopLoc_Location` from `copy=false`

### 1a. Where the un-baked location is born
`translate`/`rotate` on the OCCT path go through `applyTrsf` (**`src/Transform.cpp:21-25`**):

```cpp
BRepBuilderAPI_Transform mover(shape, tr, /*copy*/ Standard_False);   // line 23
```

`copy=false` does NOT bake geometry — it prepends a rigid `TopLoc_Location(tr)` to the
shape. So `s = translate(makeSphere(2), 1.5,1.5,1.5)` is the ORIGIN sphere geometry with
the translation living ONLY in a location.

### 1b. Where the location becomes INCONSISTENT
`common(box, s)` (`BRepAlgoAPI_Common`) is fed a `copy=false`-located operand. The boolean
emits a NEW result whose sub-shapes reference the operand's TShapes, and it does NOT
uniformly propagate the operand's location: the retained/trimmed FACE keeps a surface frame
(`BRep_Tool::Surface(face,loc)` returns loc carrying the placement) while some bounding
EDGE 3-D curves are rebuilt/reused so `BRep_Tool::Curve(edge)` (which applies
`edge.Location()`) resolves to a DIFFERENT frame. In a `copy=true` (baked) world these
coincide; with the un-baked location they can diverge by exactly the transform vector.

**Measured signature (2026-07-17 log, planar `cut box-box`):** the native display tessellated
the tool-box faces at tool-LOCAL coords (x∈[0,2], z∈[1,5]) instead of global (x∈[1,3],
z∈[0,4]) — i.e. off by EXACTLY the `translate(1,1,-1)` vector. That is the fingerprint of a
location applied on one read path and dropped on the other.

### 1c. Where the two frames collide in `OcctNativeMesh.cpp`
`tessellateFace()` builds each face from TWO independently-framed reads:

- **Boundary vertices — EDGE frame.** `edgeSamplesFor()` calls `BRep_Tool::Curve(e, rf, rl)`
  (**line 138**), whose points already have `edge.Location()` applied → `es.p[k]` are
  "global" in the EDGE's frame. Used verbatim as the node position at **line 224**
  (`addPt(q.X(), q.Y(), es.p[k])`).
- **Interior vertices + winding normal — FACE/SURFACE frame.**
  `surf = BRep_Tool::Surface(face, out.loc)` (**line 175**), `locTr = out.loc.Transformation()`
  (**line 177**), and `Sglob(u,v) = surf->Value(u,v).Transformed(locTr)` (**line 184**),
  used for interior grid points at **line 264** and the surface normal at **line 306**.

When 1b makes `edge.Location()`-frame ≠ `out.loc`-frame, the boundary loop (`es.p`) and the
interior grid (`Sglob`) land in DIFFERENT global frames. The CDT connects them in UV, so the
welded soup gets facets bridging the two frames → **phantom / mis-placed triangles**, and the
gate's bbox/genus check reds.

`BRepMesh` never exhibits this because it tessellates each face SELF-CONSISTENTLY in that
face's own frame (surface + pcurve only; it never mixes in the 3-D edge curve), and the
Tessellate.cpp readback applies one `loc.Transformation()` per face. `OcctNativeMesh`'s
GLOBAL-shared-edge design (its watertightness mechanism) is precisely what exposes the
inconsistency.

### 1d. Why the two already-tried in-scope fixes do NOT close it
- **`(TShape+Location)` edge-cache key** (already in main): fixes co-TShape aliasing
  (prism top ring / revol copy), NOT a per-face surface/edge frame divergence. Leaves
  `common box∩sphere`.
- **`importOcctSolid → tessellateSolidForViewport`** (brief step-1): `importOcctSolid`
  (`src/OcctImport.cpp:552`) reconstructs an analytic native Solid and DEFERS on the curved
  boolean (cannot rebuild the sphere-trim into analytic faces) → falls back to `occtmesh` →
  still phantom; and `tessellateSolidForViewport` THREW on the `draft` mesh-bridge shape (a
  new regression). Not a universal display route.

**Conclusion:** the defect is the un-baked location, not the mesher's algebra. The bounded
fix is to remove the un-baked location BEFORE `occtmesh` reads the shape (bake it), so
`edge.Location()`-frame ≡ `out.loc`-frame ≡ global for every sub-shape.

---

## 2. The fix — decision-ordered, exact lines

### STEP 0 (MANDATORY first, cheap ~15-min build): CONFIRM the root hypothesis
Do NOT touch the display route yet. Prove baking kills the phantom in isolation.

1. Add a location-flattening helper to `src/OcctNativeMesh.cpp` (anon namespace, near line 59):
   ```cpp
   #include <BRepTools_Modifier.hxx>
   #include <BRepTools_TrsfModification.hxx>
   #include <gp_Trsf.hxx>
   // Bake ALL nested TopLoc_Locations into copied geometry (identity locations),
   // so BRep_Tool::Curve(edge) and BRep_Tool::Surface(face,loc) share one global frame.
   static TopoDS_Shape bakedGlobal(const TopoDS_Shape& s) {
       Handle(BRepTools_TrsfModification) m = new BRepTools_TrsfModification(gp_Trsf());
       BRepTools_Modifier mod(s);
       mod.Perform(m);
       return mod.IsDone() ? mod.ModifiedShape(s) : s;   // fall back to input if not done
   }
   ```
   (`BRepTools_TrsfModification` is in OCCT 7.9 headers; verified present. It copies every
   curve/surface through the trsf and yields identity locations — an identity trsf therefore
   flattens the placement into global geometry. VERIFY at build that it recurses to ALL
   sub-shapes; if it does not, the equivalent one-liner `BRepBuilderAPI_Transform xf(s,
   gp_Trsf(), /*copy*/ Standard_True); return xf.Shape();` is the fallback baker — but
   prefer `BRepTools_Modifier`, which is the documented full-geometry rebake.)

2. In `tessellateShapeToSoup` (**line 325**), bake at entry:
   ```cpp
   const TopoDS_Shape S = bakedGlobal(shape);   // was: use `shape` directly
   ```
   and iterate `S`'s faces at **line 351** (`TopExp_Explorer ex(S, ...)`). The soup is pure
   coordinates, so tessellating a baked COPY is safe and geometry-identical.

3. Probe (no gate change): a 6-line node script that routes ONLY `common box∩sphere` and
   `cut box-box` through `f`-exposed `tessellateShapeToSoup` (or a temporary export) and
   checks bbox == [0,0,0]→[3,3,3] and genus 0. **Pass ⇒ the frame hypothesis is CONFIRMED.**

If STEP 0 does NOT clear the phantom, STOP — the divergence is deeper than location
(re-open with a per-face frame-reconciliation design); do NOT proceed to the drop.

### STEP 1 (only if STEP 0 confirmed): put the DISPLAY path on the baked native mesh
The 2026-07-17 attempt routed display through `triangulateShapeInPlace` (attach-in-place),
which CANNOT bake to a copy (Drawings HLR + the Tessellate.cpp readback rely on the
triangulation being attached to the CALLER's faces). Avoid that coupling:

1. Add a display-contract entry to `OcctNativeMesh` (new fn, or extend the soup fn) that
   BAKES then emits the full viewport contract — positions + smooth normals + per-triangle
   1-based `faceIds` (TopExp face order) + indices — i.e. the same struct
   `tessellate()` returns. Bake with `bakedGlobal()` at its top; assign `faceId` per
   `TopExp_Explorer(TopAbs_FACE)` face (mirror Tessellate.cpp:74-121); accumulate
   area-weighted normals + renormalize (mirror Tessellate.cpp:35-44,114-127).
2. In **`src/Tessellate.cpp`**, replace the `BRepMesh_IncrementalMesh` block (**lines
   66-71 + the readback 72-128**) for the `ShapeKind::Occt` case with a call to that baked
   native-mesh entry; delete `#include <BRepMesh_IncrementalMesh.hxx>` (**line 10**) once
   FeaTet is also off BRepMesh.
3. Leave `triangulateShapeInPlace` (Drawings, `Drawings.cpp:386,1122`) and
   `tessellateShapeToSoup` (Booleans, `Booleans.cpp:301`, `BooleanTol.cpp:146`) on their
   existing paths — but they inherit the STEP-0 `bakedGlobal()` at entry (safe + strictly
   more correct). FeaTet (**`FeaTet.cpp:724`**) rides `triangulateShapeInPlace`, already
   verified PASS in the 2026-07-17 attempt (`fea_smoke.cjs`, `fea_nafems_gate.mjs`).

### ALTERNATIVE (if STEP 0's blast radius via `applyTrsf` is preferred as the true root)
The single most-targeted root change is **`src/Transform.cpp:23`** `Standard_False →
Standard_True` (bake in `applyTrsf` itself). Semantically identical shapes; makes EVERY
OCCT-path boolean frame-consistent for ALL consumers with no mesher change. NOT recommended
as the first move: blast radius = every OCCT-path placement/boolean/lineage gate, and it
can slow transform-heavy paths (geometry copy per move). Only adopt if STEP-0 baking-in-the-
mesher proves insufficient AND the full suite + boolean timing stay green with copy=true.

---

## 3. The A/B gate (exact commands + pass criteria)

Run from `forge-kernel/` after a clean rebuild with `-DFORGE_NATIVE_BREP=ON`:

1. `node test/native_vs_occt_core.mjs` → **34/34 PASS** (mandatory). `common box∩sphere`
   must now pass with the native display route: bbox err ≤ 2e-2, χ=2/genus=0, watertight.
   This is the gate that reds today; it is the keep/revert discriminator.
2. `bash test/native/run_native.sh` (JOBS=3) → **all pass**, and WATCH
   `native_boolean_test` finishes **well under 300s** (`TEST_TIMEOUT`, run_native.sh:37).
   The brief's density caveat: baking must not re-trigger the CSG dense-mesh timeout.
   If it does, cap native deflection at these callers to BRepMesh density (do NOT globally
   flip `FORGE_SURFACE_TESSELLATE`).
3. `node test/fea_smoke.cjs` → PASS (FeaTet seed off BRepMesh, watertight boundary).
4. Drawings HLR smoke green (native tessellation attach path unregressed).
5. Only after 1-4 green: drop `TKMesh` from `CMakeLists.txt:142`, remove both
   `#include <BRepMesh_IncrementalMesh.hxx>` (Tessellate.cpp:10, FeaTet.cpp), rebuild,
   `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **15**, and confirm
   `grep -rE 'BRepMesh|IMeshData|IMeshTools' src/` is EMPTY.
   macOS flat-namespace hides bad drops — the TRUE drop gate is **Linux CI green**.

**Keep-if-green / revert-if-red.** If gate 1 is not 34/34, revert byte-identical to HEAD
and record the residual case here — no partial commit unless EVERY gate is green.

---

## 4. Honest status / risks

- The root cause (§1) is characterized from code + the 2026-07-17 measured off-by-translation
  signature; the baseline (34/34, otool=16, reference geometry) is re-measured this wave.
- The baking fix (§2 STEP 0) is a STRONG but **UNVERIFIED** hypothesis — this was an
  ASSESS-ONLY wave (no build). STEP 0 exists precisely to confirm it cheaply before the drop.
- One build-time unknown: whether `BRepTools_Modifier(identity TrsfModification)` recurses to
  ALL nested locations (expected yes). The `BRepBuilderAPI_Transform(copy=true)` fallback is
  named if not. Confirm in STEP 0.
- Blast radius of §2 (bake in the mesher) is contained to `occtmesh` consumers
  (display + Booleans soup + Drawings/FeaTet attach). The ALTERNATIVE (`Transform.cpp:23`
  copy=true) is broader and is the fallback, not the first move.
