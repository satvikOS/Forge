# Native Kernel — OCCT-Zero Last-Mile Keystone Plan (2026-07-24)

Read-only analysis. NO code changed, NO heavy rebuild. All symbol facts read from the
EXISTING built artifact `build/Release/forge-kernel.node` (mtime 2026-07-23 21:37) via
`otool`/`nm`/`scripts/occt_drop_gate.sh`. Goal: convert the "last mile" from
fuzzy-multi-day into an exact, execution-ready plan for the next attended Linux-CI window.

---

## 0. CURRENT otool OCCT-dylib count — CONFIRMED = 10 (no rebuild)

```
otool -L build/Release/forge-kernel.node | grep -c libTK   →   10
```

The 10 still-linked toolkits (== `CMakeLists.txt` OCCT_LIBS lines 162–165):

```
TKernel  TKMath
TKG3d  TKGeomBase  TKGeomAlgo
TKBRep  TKTopAlgo  TKShHealing
TKFillet  TKOffset
```

This matches the memory ledger ("otool=10 VERIFIED, Linux-CI confirmed 07-22"). The
2026-07-22 push (Linux "Kernel + Guards" = SUCCESS) is the validated foundation:
17 → 10 is real and Linux-strict-link-confirmed.

### CRITICAL RECONCILIATION — the task's "cheapest trio" is partly STALE

The task framed TKHLR / TKMesh / TKG2d as the three cheapest *remaining* keystones.
They are **already dropped** on the current artifact — proven by `nm -u`, not by the
lying macOS `otool`:

| symbol probe (`nm -u ... | grep -c`) | count | meaning |
|---|---|---|
| `HLRBRep` | **0** | TKHLR truly gone — zero undefined HLR symbols |
| `BRepMesh` | **0** | TKMesh truly gone — zero undefined mesh symbols |
| `Geom2d`  | 9 | TKG2d unlinked; 9 symbols resolve TRANSITIVELY via TKBRep's DT_NEEDED |
| `BRepFilletAPI` | 10 | **TKFillet STILL linked — exclusive symbols remain** |

So of the task's trio, only **TKFillet is still linked**. TKHLR and TKMesh are DONE
(their native replacements — `src/Drawings.cpp` native HLR, `src/OcctNativeMesh.cpp`
native mesher — are wired and the symbols are gone). I therefore treat this deliverable
as: **(A)** full execution plan for TKFillet (the genuine cheapest remaining leaf), plus
**(B)** the "already-done" template + residual quality gaps for TKHLR & TKMesh (so the
next window confirms they stay green and closes their deferral gaps), plus **(C)** the
honest forward ranking of the *actual* remaining 10 and the single highest-leverage
keystone — which is **not** TKFillet.

### Authoritative exclusive-symbol counts of the remaining leaves (live `occt_drop_gate.sh`, nm-only)

| toolkit | exclusive symbols needed by .node | drop verdict |
|---|---:|---|
| **TKFillet** | **11** | cheapest leaf; NOT-SAFE (K6-gated for imported handles) |
| TKGeomBase | 12 | NOT-SAFE (transitively pinned behind TKG3d) |
| TKShHealing | 20 | NOT-SAFE (needs 2 net-new algos + K6) |
| TKGeomAlgo | 24 | NOT-SAFE (2 net-new algorithms) |
| TKMath | 20 | last-but-one (substrate) |
| TKOffset | 42 | widest algorithm toolkit |
| TKBRep | 59 | K6 co-keystone |
| TKG3d | 62 | deepest geometry substrate |
| TKTopAlgo | 84 | K6 co-keystone |
| TKernel | core | last |

Per `docs/OCCT_ZERO_DROP_PLAN_2026-07-21.md`, **every one of these 10 is classified
NO-GO / K6-blocked** — unlike the earlier cheap independent drops (TKPrim/TKDESTEP/
TKHLR/TKMesh/TKG2d), the remaining 10 are a COUPLED cluster: their exclusive symbols
all take a `TopoDS_Shape` / `Geom_Surface` argument that today only exists for OCCT-
backed (imported / boolean) handles, which have no native representation. This is the
central truth of the last mile (see §4).

---

## KEYSTONE 1 — TKFillet (11 exclusive symbols) — the genuine cheapest remaining leaf

### 1. Exact direct-use sites (grep `src/`, cited file:line)

Two source files hold every TKFillet call. The 11 exclusive symbols are:
`BRepFilletAPI_MakeFillet` {Add(d,Edge), Add(Array1<gp_Pnt2d>,Edge), Build, ctor(Shape,ChFi3d_FilletShape)},
`BRepFilletAPI_MakeChamfer` {Add(d,Edge), Add(d,d,Edge,Face), Build, ctor(Shape)},
`ChFi3d_Builder::~ChFi3d_Builder`, + 2 vtables.

**`src/Features.cpp`** (includes at :63 `BRepFilletAPI_MakeChamfer.hxx`, :64 `BRepFilletAPI_MakeFillet.hxx`)
- **:1220** `BRepFilletAPI_MakeFillet mk(srcCopy);` — constant-radius `filletEdges()`, run on a worker thread with a 20 s cumulative wall-budget + dense-body (>1000 edge) refusal guard. Native analytic path (FilletAnalytic) runs *above* this for eligible NativeSolids; this OCCT worker is the fallback for OCCT-backed / imported / boolean / non-straight-convex inputs.
- **:1254 / :1264** `BRepFilletAPI_MakeFillet mk(src);` + `mk.Add(uvs, e);` — `variableFilletEdge()`. **PURE OCCT: this function has NO `FORGE_NATIVE_BREP` branch at all** (confirmed by grep over its body 1246–1272). Every variable-radius fillet through the ShapeHandle API hits OCCT.
- **:1400** `BRepFilletAPI_MakeChamfer mk(src);` — `chamferEdges()` OCCT fallback. A native **ANALYTIC EXACT** chamfer path is now wired *above* it (Features.cpp:1281–1299, commit `d730f0f5`) for a single symmetric straight convex edge of the canonical box/cube on a NativeSolid; this OCCT `MakeChamfer` is the fallback for asymmetric (`distance2>0`), multi-edge, curved, or imported inputs.

**`src/VarFillet.cpp`** (includes at :14 `BRepFilletAPI_MakeFillet.hxx`)
- **:241** `BRepFilletAPI_MakeFillet mk(src);` — law-driven (`Law_Linear`/`Law_S`) variable-radius fillet. Native path exists (`filletBoxEdgeVariable`, gated by `forgeNativeFeaturesEnabled()`) but ONLY for an origin axis-aligned box edge with a single linear law; ANY other input (OCCT-backed, non-origin/non-box, multi-edge, `Law_S`/smooth, unmappable edge) HONESTLY DEFERS to this OCCT call.

### 2. Native coverage — what exists vs what must be written

**Existing native engine (mature): `src/native/brep/FilletAnalytic.cpp` (2910 lines) + `ChamferAnalytic.cpp`.**
Covers the constant-R rolling-ball blend on a convex STRAIGHT planar–planar edge:
`filletBoxEdgeAnalytic` (orthogonal 90° box edge), general-dihedral broadening (arbitrary
convex angle, K3), `filletBoxEdgeVariable` (variable linear-law box edge), and a
topology-sourced single-convex-straight-edge fillet on a NativeSolid — all EXACT
(volume = L³−(1−π/4)R²L closed form, fillet face = true `Cylinder` radius R, watertight).
The rolling-ball contact derivation is fully documented in the file header (axis =
P0 + R(−nA) + R(−nB) + t·e; re-trim faces to the two tangent lines; quarter-cylinder
patch + exact quarter-disk end caps). **No new engine is needed for straight convex
planar–planar edges — that geometry is done and A/B-certified.**

**What must be NEWLY written to actually DROP TKFillet (the coverage gaps):**
- **(a) Native variable-radius law on the ShapeHandle path** — wire `filletBoxEdgeVariable`
  (already built) into `Features.cpp::variableFilletEdge` (currently zero native branch).
  Reference algorithm: sweep the rolling-ball centre along the edge with radius law λ(t);
  the fillet surface becomes a **variable-offset canal surface** (envelope of spheres of
  radius λ(t) centred on the offset spine). For a straight edge with a monotone law this
  is a truncated-cone/blended-cylinder patch — closed-form. **Reimplement natively; never
  link `Law_Function`.**
- **(b) Curved-edge fillets** (fillet a cylinder–plane or two-curved-surface edge) —
  general canal-surface envelope; not yet native. Reference: variable-radius rolling-ball
  blend / Pottmann–Peternell canal-surface envelope, reimplemented on the native NURBS
  substrate (`src/native/brep` + `src/native/surfit`).
- **(c) Asymmetric + multi-edge chamfer** (`distance2>0`, edge chains) — extend
  `ChamferAnalytic.cpp` (single symmetric box edge today) to two-distance bevels and
  multi-edge setback corner handling.
- **(d) THE TRUE BLOCKER — imported/boolean-handle fillet (K6).** filletEdges,
  variableFilletEdge, and the chamfer fallback all run on OCCT-backed handles (imported
  STEP, boolean results). There is **no OCCT-TopoDS→native-Solid importer**, so native
  fillet cannot ingest them. Until K6 exists (see §4), these call sites CANNOT be removed,
  and TKFillet cannot be dropped regardless of how good the straight-edge native path is.

### 3. Existing native_vs_occt tests + certified scope + the gap

Repo-root A/B oracles (link OCCT 7.9.3, run the SAME case both sides — NOT part of the
pure-native gate):
- **`test/native_vs_occt_fillet.cpp`** — box L=10, R=1.5, top-front edge (native edge id 4).
  GATE(1) filleted-solid volume native vs OCCT rel ≤ 1e-6; GATE(2) new fillet face is a
  `Cylinder` of radius R on both sides. **Certified scope: single straight convex ORTHOGONAL
  box edge, constant radius.**
- **`test/native_vs_occt_fillet_prism.mjs`** — general (non-cube) axis-aligned box edge, constant R.
- **`test/native_vs_occt_fillet_var.cpp` + `native_vs_occt_varfillet_box.mjs`** — variable
  linear-law fillet; proves the general axis-aligned box var-fillet ROUTES native
  (kindOf==nativeSolid, no longer OCCT) and matches exact closed-form volume to 1e-6; cube
  kept as regression. **Certified scope: box-edge linear-law only.**
- **`test/native_vs_occt_fillet_curved.cpp` / `native_vs_occt_fillet_ext.cpp`** — curved / extended cases.
- **`test/native_vs_occt_chamfer.cpp` / `_asym.cpp` / `_chamfer_prism.mjs`** — symmetric box
  chamfer (vol + face parity 1e-9); asymmetric + prism variants.
- Pure-native unit tests (in `run_native.sh` gate): `test/native/brep/{fillet_analytic_test,
  fillet_curved_test, fillet_test, native_fillet_solid_test, chamfer_analytic_test,
  chamfer_test, arc_profile_fillet_test}.cpp`.

**Coverage GAP to close before the drop:** the certified envelope is *straight convex
planar–planar edges on NativeSolids* (constant + linear-law + symmetric chamfer). The
DROP-PROVING test that does NOT exist and would red-light the real blocker: **fillet a
20 mm edge of an IMPORTED-STEP solid natively** (no path today) and **`variableFilletEdge`
native==OCCT on a ShapeHandle** (no native branch today).

### 4. Effort estimate + BUILD_AND_VERIFY + Linux-CI gate

**Honest estimate.**
- Session-bounded *surface-shrinking* wins (do NOT drop the toolkit): (a) wire
  `filletBoxEdgeVariable` into `variableFilletEdge` ≈ **0.5–1 day** (engine exists);
  (c) asymmetric/multi-edge native chamfer ≈ **1 day**.
- **Actually dropping TKFillet ≈ multi-cycle (days→weeks), BLOCKED on K6** — the
  imported/boolean-handle native fillet importer. Not a single-window task. Recommend the
  next window spend TKFillet budget on the bounded wins only, then pivot to K6.

**BUILD_AND_VERIFY sequence (run in this order; steps 1–2 are the heavy build — do NOT run during read-only analysis):**
```
# 1. build the .node (macOS, native-brep on) — HEAVY
npm run forge:kernel
# 2. core smoke (must stay 34/34) + bridge + coherence
npm run forge:kernel:test
npm run forge:bridge:test
# 3. OCCT-linked A/B oracles (manual compile per each test's header build line), e.g.
#    test/native_vs_occt_fillet.cpp, _var, _chamfer  → all GATE PASS
# 4. pure-native gate (no OCCT, no deps) — must stay green
bash test/native/run_native.sh
# 5. drop-gate proxy — MUST print EXCLUSIVE=0 before touching CMakeLists
bash scripts/occt_drop_gate.sh TKFillet          # today: 11 EXCLUSIVE → NOT SAFE
# 6. only after step 5 == 0: remove TKFillet from CMakeLists.txt OCCT_LIBS (line 165),
#    rebuild (1), re-run (2)(4), then:
otool -L build/Release/forge-kernel.node | grep -c libTK    # expect 9
# 7. TRUE drop gate (per memory): Archie Models-OS STEP-import battery must stay 13/13
#    (a kernel-gate pass is necessary-not-sufficient; Models-OS 13/13 is the real gate).
```

**Linux-CI gate — [USER-TRIGGERED].** The ultimate confirmation is a `git push` to branch
**`archdisc`**, which triggers the **"Kernel + Guards"** workflow
(`.github/workflows/kernel-tests.yml` in the parent `archdisc-Mech` repo):
- `native` job (ubuntu-latest): `bash forge-kernel/test/native/run_native.sh` — pure-C++
  strict-link on Linux (this is what catches the flat-namespace lies macOS hides).
- `kernel` job (macos-latest): builds the .node on OCCT 7.9 + runs the smoke suite.
- `guards` job (ubuntu): brand-guard + dep-allowlist + ForgeCADScore self-tests.

Note: this workflow does NOT do a Linux strict-link of the OCCT-linked .node itself — the
`occt_drop_gate.sh` symbol-intersection (step 5) is the local proxy for that; the ubuntu
`native` job proves the native replacement is symbol-complete/Linux-clean. Flag the push
to the user; it is the attended trigger.

---

## KEYSTONE 2 — TKHLR (ALREADY DROPPED — proof-method template + residual gap)

`nm -u ... | grep -c HLRBRep = 0`. TKHLR is gone from the artifact (memory: dropped 14→13
on 2026-07-20, Linux-confirmed in the 07-22 push).

- **Former sites, now native:** `src/Drawings.cpp` — every orthographic HLR call site
  (formerly `HLRBRep_Algo` / `HLRBRep_HLRToShape` / `HLRAlgo_Projector`, Drawings.cpp:7–9,
  35–38) now runs `forge::native::brep::hiddenLineRemoval` via `emitNativeHlr()`; perspective
  HLR was already native (`projectShapePerspective → hlrPerspective`).
- **Native engine (reference algorithm implemented):** hidden-line removal by
  **silhouette extraction + visibility classification** — project each edge to the view
  plane, classify visible / hidden / silhouette, split at silhouette/edge crossings. The
  four OCCT edge classes (VCompound + Rg1LineVCompound + RgNLineVCompound → visible; hidden
  bucket) are reproduced. The native path re-projects each segment's poly3d through the SAME
  OCCT `gp_Ax2` frame so the 2D screen coordinates stay byte-identical (visibility comes
  from native HLR; coordinates from the shared frame).
- **native_vs_occt tests:** `test/native_vs_occt_hlr.cpp` (ortho, own view frame),
  `native_vs_occt_hlr_persp.cpp` (perspective, machine-precision match to OCCT),
  `native_vs_occt_hlr_import.cpp` (imported-shape HLR), unit `test/native/brep/hlr_test.cpp`.
- **Residual gap (quality, not linkage):** the "edge-on drop" — OCCT's HLRBRep omits a
  degenerate edge-on silhouette edge; the native path matches this to keep COUNTS equal
  (documented Drawings.cpp:115). No coverage gap blocks the drop (already done); the only
  next-window action is **confirm it stays green** on the Linux `native` job.
- **Effort:** 0 (done). Use as the PROOF-OF-METHOD template for the K6-gated toolkits:
  re-implement the algorithm natively behind a gate → A/B-certify → confirm symbol gone →
  revert-if-red.

---

## KEYSTONE 3 — TKMesh (ALREADY DROPPED — residual quality gap to close)

`nm -u ... | grep -c BRepMesh = 0`. TKMesh is gone (memory: dropped 16→15 on 2026-07-19,
Linux-confirmed 07-22). Chosen over TKG2d because TKG2d is a transitive-only case (9
undefined Geom2d symbols still resolve via TKBRep; nothing to "close"), whereas TKMesh has
a genuine residual QUALITY gap worth an execution note.

- **Former sites, now native:** `BRepMesh_IncrementalMesh` replaced by
  `forge::occtmesh` (`src/OcctNativeMesh.cpp`) at all display / boolean / HLR-retry /
  FeaTet / STL-export sites (`src/Tessellate.cpp`, `Booleans.cpp`, `FeaTet.cpp`,
  `IoExchange.cpp`, `GltfExport.cpp`, `LOD.cpp`). Native constrained-Delaunay faceting
  reads OCCT surfaces/pcurves but does its own triangulation — no `BRepMesh` symbol remains.
- **Native engine (reference):** curvature-adaptive constrained-Delaunay surface meshing
  with midpoint-insertion refinement + smooth-normal accumulation (the OCCT
  `Poly_Triangulation` readback reproduced natively). Curvature-adaptive density fix
  (`SolidTessellate.cpp`) cut `native_boolean_test` 310s→41s.
- **native_vs_occt tests / unit:** `test/native/brep/{interval_mesh_test, meshexchange_test}.cpp`
  + the native mesh engine tests under `test/native/mesh/`; the boolean A/B battery exercises
  the mesh bridge end-to-end.
- **Residual QUALITY gap to close:** an HONEST DEFERRAL exists — a face whose trim cannot be
  resolved (degree-8 / rational B-spline pcurve, unresolvable trim) produces an **empty mesh**
  for that face (OcctNativeMesh.cpp:603, 688; Tessellate.cpp:53–61; FeaTet.cpp:731–735). This
  is a display/mesh-completeness gap on exotic imported B-spline faces (ties to the STEP
  reader's deferred degree-8/rational edge-trim), NOT a link gap. The drop stands; closing
  this deferral is a downstream reader/mesher quality task.
- **Effort:** 0 to keep the drop; the deferral-closing (B-spline pcurve trim in the native
  mesher) is a bounded but separate task, ≈1–2 days, gated on the STEP-reader B-spline
  edge-trim work already scoped in the memory ledger.

---

## §4. HIGHEST-LEVERAGE KEYSTONE TO ATTEMPT FIRST — **K6, not TKFillet**

**Recommendation: the next attended window's highest-leverage target is the K6 substrate —
the OCCT-TopoDS → native curved-Solid importer + a native curved-surface-handle kind
(the declared seam `src/Nurbs.cpp::nativeSurfaceOf()`, returns `nullopt` for every input
today; the TKG3d substrate).** Reasons:

1. **It is the single shared blocker of 7 of the remaining 10 toolkits.** TKFillet (11),
   TKOffset (42), TKShHealing (20), TKGeomAlgo (24), TKTopAlgo (84), TKG3d (62), TKBRep (59)
   are ALL marked NO-GO in the drop plan for the same reason: their exclusive symbols take a
   `TopoDS_Shape` / `Geom_Surface` from imported/boolean handles that have no native form.
   The native engines (fillet, offset, heal, massprops, classify) are already built and
   A/B-green **on NativeSolids** — they are starved only because production inputs arrive as
   OCCT handles. One importer feeds them all. Dropping TKFillet alone is impossible without
   it, and doing TKFillet's straight-edge polish first yields no toolkit removal.

2. **It directly lifts the face-identity / realization ceiling that caps GD&T + interface
   scoring.** Today the native→OCCT bridge is one-way and SHATTERS analytic faces
   (plane/cyl/cone/sphere/torus) into faceted meshes on the round trip. That face-identity
   loss is exactly what caps the interface (mating-jig) + topology (face/edge/vertex) halves
   of the real CADGenBench metric (0.4 interface + 0.2 topology). A lossless native
   curved-surface handle that preserves analytic face identity through import→operate→export
   raises the realization ceiling AND unblocks the toolkit cluster with one build. This is
   the same dependency the OCCT-zero map calls K6/K6a.

3. **The cheap-leaf era is over.** 17→10 was achieved by dropping *independent* toolkits
   (TKPrim, TKDESTEP, TKXSBase, TKHLR, TKMesh, TKG2d, TKBool). The remaining 10 are a coupled
   K6-gated cluster; continuing to chip at leaves (TKFillet straight-edge polish) spends
   window budget without moving otool. K6 is the lever that turns the whole cluster droppable.

**If the window MUST show a bounded, in-window kernel win** (no toolkit removal), the ranked
cheap wins are: (1) wire `filletBoxEdgeVariable` into `Features.cpp::variableFilletEdge`
(engine exists; removes the one MakeFillet(array) site for box handles); (2) native
asymmetric/multi-edge chamfer. Both SHRINK the OCCT include-surface and improve native
coverage but leave TKFillet linked (imported handles still route OCCT). Treat them as
K6 warm-up, not as the drop.

### Ranked keystone plan (next-window order)

| # | keystone | exclusive syms | action this window | drops a toolkit? |
|---|---|---:|---|---|
| **1** | **K6 substrate** (OCCT→native curved-Solid importer + `nativeSurfaceOf()` handle) | — | **build the importer + native surface-handle kind; A/B on imported .step** | unblocks 7 toolkits (enables all below) |
| 2 | TKFillet | 11 | bounded warm-up: wire `filletBoxEdgeVariable` into `variableFilletEdge`; native asym chamfer | no (shrinks surface) — full drop after K6 |
| 3 | TKGeomBase | 12 | classical natives (3-pt arc, deflection sampler, analytic→NURBS); pinned behind TKG3d | after K6/TKG3d |
| 4 | TKShHealing | 20 | same-domain unifier + free-wire cap synthesis (2 net-new algos) | after K6 |
| 5 | TKGeomAlgo | 24 | least-squares B-spline fitter + N-section skinning (2 net-new) | after K6 |
| 6 | TKOffset | 42 | wire `offsetSolidShape` into `thickenSurface`; native guided sweep | after K6 |
| 7 | TKTopAlgo / TKBRep / TKG3d | 84 / 59 / 62 | co-keystones — TopoDS→native migration | K6/K6a cluster |
| 8 | TKMath → TKernel | 20 / core | substrate — drop last, purely transitively | after all above |

---

## Appendix — verification commands used (all read-only, no rebuild)

```
otool -L build/Release/forge-kernel.node | grep -c libTK              # 10
nm -u build/Release/forge-kernel.node | grep -c HLRBRep               # 0  (TKHLR gone)
nm -u build/Release/forge-kernel.node | grep -c BRepMesh              # 0  (TKMesh gone)
nm -u build/Release/forge-kernel.node | grep -c Geom2d                # 9  (transitive via TKBRep)
nm -u build/Release/forge-kernel.node | grep -c BRepFilletAPI         # 10 (TKFillet linked)
bash scripts/occt_drop_gate.sh TKFillet    # 11 exclusive → NOT SAFE (cheapest leaf)
bash scripts/occt_drop_gate.sh TKGeomBase  # 12 exclusive
bash scripts/occt_drop_gate.sh TKShHealing # 20 exclusive
bash scripts/occt_drop_gate.sh TKGeomAlgo  # 24 exclusive
bash scripts/occt_drop_gate.sh TKOffset    # 42 exclusive
```
