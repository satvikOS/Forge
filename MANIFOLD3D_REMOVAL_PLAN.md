# manifold-3d (WASM) Removal Plan — Forge frontend

READ-ONLY audit, 2026-06-20. **No code was changed.** This is a plan only.

Goal: remove the `manifold-3d` WASM dependency from `frontend/package.json` (the
standing "no WASM, pure native kernel" directive), now that
`forge::native::mesh::meshBooleanNative` is a working general boolean exposed as
`forge.native.meshBoolean` in `forge-kernel.node`.

## TL;DR — honesty up front

Removing manifold-3d is **NOT trivial.** The new native `meshBoolean` covers exactly
**one** of the things manifold-3d is used for: a raw triangle-soup boolean (the
`forge-v4/meshDispatch.meshBoolean` path, which is the *only* clearly-live manifold-3d
consumer in the running app). Everything else in `frontend/src/foundation/*` is a
**second, parallel mesh-CSG B-Rep modeling kernel** built directly on manifold-3d's
`Manifold` and `CrossSection` classes — primitive constructors (`.cube/.cylinder/.sphere`),
profile `.extrude`/`.revolve`, `.project`/`.offset`, level-set/SDF meshing (`.levelSet`),
topological-ID propagation (`.reserveIDs`/`.asOriginal`/`.originalID`), and validity
(`.status`/`.genus`). The native surface today exposes **9 functions total** and provides
**none** of those except the boolean.

The good news that de-risks this: that whole `foundation/*` stack appears to be a **legacy /
parallel** modeling path. The live AI/CUA pipeline (`ForgeRunner`, `ForgeToolBridge`) and the
flagship demos route through `window.forge.*` (the native OCCT kernel), **not** through
`foundation/*`. So most of the removal is about (a) one live mesh-boolean swap, (b) bridging
`forge.native` to the renderer, and (c) deciding whether the legacy `foundation/*` stack is
retired wholesale or carried as dead-but-present code until native parity exists. The
remaining ~55 manifold call sites are not "convert each to native" work unless we keep the
`foundation/*` kernel alive.

---

## 1. Call-site inventory

### Actual `import 'manifold-3d'` statements: only 3 (the rest are comments/JSDoc)

| File | Line | What it imports |
|---|---|---|
| `frontend/src/foundation/manifoldKernel.js` | 15, 17 | `Module from 'manifold-3d'` + `manifold.wasm?url` — the **foundation singleton** (`getManifold()`) |
| `frontend/src/forge-v4/meshDispatch.js` | 31 | `ManifoldModuleFactory from 'manifold-3d'` — a **second, independent** init (`ensureManifold()`) |

> NOTE: the audit brief assumed `frontend/src/forge-v4/manifoldKernel.js` exists. It does
> not. The manifold singleton is `frontend/src/foundation/manifoldKernel.js`. `forge-v4/`
> has its own inline init inside `meshDispatch.js`.

The ~120 other grep hits for "manifold" are JSDoc/comments and modules that consume the
singleton — not imports.

### Consumers of the foundation singleton (`getManifold()`): 28 files, 56 call sites

`Bearing, CamProfile, ClassAPanel, CollisionDetection, EdgeBlend, EdgeFillet, EmbossText,
Features, FlexPipe, index, LoopSubdivision, MarchingCubes, Part, parts/HingedBracketPair,
parts/PhoneStandBracket, parts/PlanetaryGearset, parts/SealedEnclosure,
parts/ThreadedBottleCap, Profile, SpurGear, StepImport, SweepLoft, SyncModel, ThreadedRod,
TopologicalNaming` (all under `frontend/src/foundation/`) + `kernel/atomic/AtomicOps.js`.

### What manifold-3d is actually used FOR (by category × count × file refs)

| Category | What | ~Sites | Native equiv today? | Key files |
|---|---|---|---|---|
| **A. Raw mesh boolean (triangle soup)** | union / cut / intersect on `{positions,indices}` | **1 live entry** (`meshDispatch.meshBoolean`, line 724) + ~38 `.union`/20 `.difference`/5 `.intersection` inside the foundation kernel | **YES — `forge.native.meshBoolean`** | `forge-v4/meshDispatch.js:724`; `foundation/Features.js`, `EdgeFillet.js`, `PatternFeatures.js` |
| **B. Solid primitives** | `Manifold.cube/.cylinder/.sphere/.tetrahedron` | `.cylinder` ×53, `.cube` ×8, `.sphere` ×9 | **NO** (native OCCT has `forge.part.makeBox/Cyl/...` but those are OCCT handles, not manifold meshes) | `foundation/Features.js`, `EdgeFillet.js`, `FastenerLib.js`, `Bearing.js`, `parts/*` |
| **C. 2D profile → solid** | `CrossSection` → `.extrude` / `.revolve` | `.extrude` ×53, `.revolve` ×44, `CrossSection` in 21 files, `.project` ×41, `.offset` ×52 | **NO** | `foundation/Profile.js`, `Features.js`, `Bearing.js`, `CamProfile.js`, `SpurGear.js`, `kernel/atomic/SketchProfile.js` |
| **D. Implicit / SDF (level-set meshing)** | `Manifold.levelSet(field)` marching-tetrahedra | `.levelSet` ×13, in 5 files | **PARTIAL — only `forge.native.sdfSphereVolume`** (a sphere demo, not arbitrary fields) | `foundation/LatticeTPMS.js`, `SmoothImplicit.js`, `PointCloudSDF.js`, `TopoCantilever.js`, `MarchingCubes.js:507` (dynamic import) |
| **E. Voxel / hex / tet** | voxel-fill a Manifold | a few | **PARTIAL** — kernel has `pointcloud.voxelDownsample/voxelMesh` but not "voxel-fill a solid" | `foundation/VoxelHexMesh.js`, `TetMesh.js` |
| **F. Mesh ops (decimate/smooth/remesh/subdiv/fillHoles)** | mostly **pure JS already**; manifold only for `repairSelfIntersect` round-trip + `subdivideLoop` rebuild | repair: 1, subdiv rebuild: a few | partial (decimate/smooth/remesh are JS; **repair** needs a clean()/manifoldize op) | `forge-v4/meshDispatch.js` (repairSelfIntersect 702, meshToManifold 670), `foundation/LoopSubdivision.js`, `MeshRepair.js` |
| **G. Topological naming / IDs** | `reserveIDs`, `asOriginal`, `originalID`, `runOriginalID` propagation through booleans | `.reserveIDs` ×4, `.asOriginal`/`.originalID` ×3 | **NO** (native `meshBoolean` returns geometry only — no per-face ID lineage) | `foundation/TopologicalNaming.js`, `Features.js`, `BodyRegistry.js` |
| **H. Validity / mass props** | `.status`, `.genus`, `.volume`, `.surfaceArea`, `.boundingBox`, `.getMesh` | `.status` ×137, `.volume` ×113, `.boundingBox` ×47, `.surfaceArea` ×19, `.genus` ×6 | **PARTIAL** — `meshBoolean` returns `volume/area/vertexCount/faceCount` + validity guard; standalone "validate this mesh" / mass-props op not exposed | `foundation/GeometryCheck.js`, `MassProperties.js`, `CollisionDetection.js` |
| **I. Bridge / IO** | Manifold → three.js geometry; Manifold → STEP/STL | n/a | n/a (these are JS writers; kernel-free except they take manifold-shaped data) | `foundation/ManifoldThreeBridge.js`, `StepExport.js` (kernel-free), `STLExport.js` |

> `.translate`/`.scale`/`.rotate`/`.transform` counts (346/211/135/53) are dominated by
> three.js, not manifold, so they are excluded from the "must replace" set.

### opencascade.js (the second WASM dep, related to this directive)

Separate dep `opencascade.js` (`frontend/package.json:26`) — 2 imports in
`kernel/brep/kernelLoader.js:12,14`, consumed by **37 files** under `kernel/brep/*` +
`foundation/PCurveProjection.js`, `kernel/export/{IgesExport,StepExportAp242}.js`,
`kernel/topology/{bindSpine,geomAdapters}.js`. **No `.jsx` / `App.jsx` entry point imports
`kernel/brep` at all** — it is a self-contained legacy WASM B-Rep subsystem with **no live UI
wiring** (the native OCCT kernel superseded it). It is the literal-duplicate "easy first win"
the brief expected.

---

## 2. Native coverage map (`forge.native.*` — exactly 9 functions today)

From `forge-kernel/src/binding.cpp` (`nativeNs.Set(...)`, lines 15621–15893):

| Native fn | Category covered | Notes |
|---|---|---|
| `orient2d`, `orient3d`, `incircle` | predicates | exact sign −1/0/+1 |
| `convexHull2D`, `convexHull3D` | convex hull | flat-array in → Float64Array out |
| `sdfSphereVolume(radius,n)` | implicit/SDF (**sphere only**) | NOT a general level-set evaluator |
| `gdtTruePosition`, `gdtFlatness` | GD&T | scalar evaluators |
| **`meshBoolean(aPos,aIdx,bPos,bIdx,op)`** | **mesh boolean (A)** | `op ∈ union/intersection/difference`; returns `{ ok, reason, volume, area, vertexCount, faceCount, positions:Float64Array, indices:Uint32Array }`; **`ok=false` + reason** on degeneracy; internal validity guard refuses fake non-2-manifold results |

**Cleanly routable to native today:** Category **A** (raw mesh boolean) — that's it.

**Gaps with NO native equivalent (would need new native ops first):**
- **B** primitives as *meshes* — kernel has OCCT primitives but they yield OCCT handles, not manifold triangle soups; a `forge.native.primitiveMesh(...)` (or tessellate-OCCT-to-soup) op is needed for the foundation stack.
- **C** `CrossSection` extrude/revolve/project/offset — no native 2D-profile-to-solid mesh op.
- **D** general `levelSet(field)` — only `sdfSphereVolume` exists.
- **E** voxel-fill-a-solid, hex/tet meshing.
- **F** mesh `clean()`/manifoldize (used by `repairSelfIntersect`).
- **G** topological-ID lineage through booleans (no `runOriginalID` analog).
- **H** standalone mesh validate + mass-props (only available as a side-effect of `meshBoolean`).

So: native covers **1 of ~9 categories**. Full removal is only realistic if the
`foundation/*` kernel (categories B–H) is **retired**, not ported. Porting B–H to native is a
multi-op kernel project, not part of this removal.

---

## 3. Bridge prerequisite — `forge.native` is NOT reachable from the renderer

- The renderer reaches the kernel via `window.forge.*`, assembled by hand in
  `electron/preload.js` (the `forgeApi` object starts at **line 61**, exposed via
  `contextBridge.exposeInMainWorld('forge', forgeApi)` at **line 1580**).
- `forgeApi` is built key-by-key (`weldments: kernel && kernel.weldments ? {...} : null`,
  etc.). **There is no `native:` key.** `grep -n native electron/preload.js` shows only
  comments/FEA — `kernel.native` (the `exports.native` object from `binding.cpp`) is **never
  forwarded across the contextBridge.**
- Therefore `window.forge.native.meshBoolean` does **not exist in the renderer today.**
  **Exposing it is a hard prerequisite** before any frontend code can call it.

**Bridge work required (Stage 1):** add a `native:` namespace to `forgeApi` in
`electron/preload.js`, wrapping each `kernel.native.*` fn (at minimum `meshBoolean`).
Mirror the existing namespace pattern. Two contextBridge cautions, both already handled
elsewhere in this file:
1. **Typed-array marshalling.** `meshBoolean` returns `Float64Array`/`Uint32Array`. Some
   Electron versions clone typed arrays lossily across the bridge (see the base64 dance in
   `dialog.writeBlob`, preload.js:1502, and the explicit `new Float64Array(...)` rebuild in
   the surfacing path ~line 1419). Wrap so the result's typed arrays are reconstructed as
   plain `Float64Array`/`Uint32Array` (or returned via the same defensive copy the surfacing
   namespace uses) — do **not** assume they pass through untouched.
2. **Error surface.** `meshBoolean` returns `{ok:false, reason}` rather than throwing, which
   is bridge-friendly; pass it through verbatim.

There is no Vite config change needed to *add* the bridge (`vite.config.js` doesn't reference
manifold). Vite changes come only at the final removal stage (no `?url` wasm import remains).

---

## 4. Degeneracy handling (`ok=false` on ~2% measure-zero cases)

`meshBoolean` honestly returns `ok=false` + reason on measure-zero / non-manifold degeneracies
(coplanar faces, shared edges, exact tangency). The migration must decide what happens then.

**Options:**
- **(a) Keep manifold-3d as a fallback only for `ok=false`.** Defeats the goal — the dep
  stays in `package.json`, the WASM still ships, the allowlist can't hard-fail. Reject for the
  *final* state, but acceptable as a **temporary bridge** during Stage 2 so the live
  MeshWorkbench never regresses while we measure the real-world `ok=false` rate.
- **(b) Accept `ok=false` as an honest error surfaced to the user.** Aligns with the
  "no fallback, surface the real error" Forge rule (memory: feedback-forge-no-mvp-no-fallback).
  The MeshWorkbench already raises and surfaces boolean errors today
  (`meshDispatch.js:23–25`, `MeshWorkbench.jsx`), so the UX path exists. Risk: a user hits a
  ~2% case on a real model and the op simply fails where manifold-3d would have succeeded —
  a *visible capability regression* on those inputs.
- **(c) Push the native boolean to 100% first.** Cleanest end state, but it's open-ended
  kernel R&D (general-position perturbation / SoS / exact-arithmetic robustness) and blocks
  the whole removal on a hard CS problem.

**Recommendation: (b) as the destination, reached via a time-boxed (a).**
1. Stage 2 ships **(a)**: route MeshWorkbench booleans to `forge.native.meshBoolean`, fall
   back to manifold-3d **only** on `ok=false`, and **log every fallback** (count + reason +
   input signature) behind the trace sink.
2. Run the existing/representative boolean e2e (varied prompts per the "vary test prompts"
   rule) to **measure the actual `ok=false` rate** on real demo geometry. The ~2% figure is a
   general-position estimate; flagship inputs (axis-aligned boxes, coaxial cylinders) are
   *more* degeneracy-prone, so measure before trusting it.
3. If the measured rate on real inputs is low/benign, **flip to (b)**: drop the fallback,
   surface `reason` to the user, delete the dep. If it's high on the inputs that matter,
   that's the signal to invest in **(c)** (a small, targeted robustness pass — e.g. symbolic
   perturbation of shared vertices) rather than carrying WASM forever.

This keeps the migration honest (no permanent fallback) while not regressing the live demo on
day one.

---

## 5. Staged, risk-ordered removal sequence

Each stage has a validation gate; do not advance on red (memory: feedback-forge-ci-green-gate,
feedback-forge-headed-e2e — gates are **headed** Mac-Electron with ≥5 cam angles where a
viewport is involved).

### Stage 0 — Establish the baseline (no code change)
- Run the current `deps-allowlist.test.mjs` (warns, 2 sunset deps) + the boolean/lattice/
  subdivision e2e green. Record current behavior as the regression baseline.
- **Gate:** full suite currently green; baseline screenshots captured.

### Stage 1 — Bridge `forge.native` (additive, zero removal) **[PREREQUISITE]**
- Add a `native:` namespace to `forgeApi` in `electron/preload.js` forwarding
  `kernel.native.meshBoolean` (and, cheaply, the other 8 — they're free and useful) with
  typed-array marshalling per §3.
- **Gate:** new headed e2e asserts `window.forge.native.meshBoolean(...)` returns a valid
  union/cut/intersect for a known pair (and `ok=false` for a deliberately-degenerate pair).
  No existing behavior touched → low risk.

### Stage 2 — Remove the opencascade.js WASM duplicate (lowest-risk *removal*)
*Rationale: it's a literal WASM duplicate of the native OCCT kernel, has **no live `.jsx`/App
entry point**, and is independent of manifold-3d. Cleanest first deletion.*
- Confirm (re-grep) that nothing reachable from `App.jsx` / the live `ForgeRunner` /
  `ForgeToolBridge` path imports `kernel/brep/*` or `kernelLoader`. (Audit shows none today.)
- Delete (or quarantine) the `kernel/brep/*` + `kernelLoader.js` subsystem **OR**, if any
  exporter (`IgesExport`, `StepExportAp242`) is still referenced, re-point it at the native
  OCCT exporters (`forge.io.export*` already exist).
- Remove `"opencascade.js"` from `package.json` and from the allowlist; move it to a
  hard-absent assertion in `deps-allowlist.test.mjs`.
- **Gate:** build green (Vite resolves with no `opencascade.js` import); full e2e green;
  STEP/IGES export e2e still produces valid files via native.

### Stage 3 — Route the ONE live manifold boolean to native (the real win)
- In `forge-v4/meshDispatch.js`, change `meshBoolean(meshA, meshB, op)` (line 724) to call
  `window.forge.native.meshBoolean`, mapping `op`: `union→union`, `cut→difference`,
  `intersect→intersection`. Keep manifold-3d **only** as the `ok=false` fallback (degeneracy
  option (a)) **and instrument the fallback** (§4).
- Note: `meshToManifold`/`repairSelfIntersect`/`subdivideLoop` rebuild paths still need
  manifold at this stage — that's expected; they go in Stage 5.
- **Gate (HEADED, varied prompts):** MeshWorkbench union/cut/intersect on distinct demo
  meshes render correctly from ≥5 cam angles; `push-83-subdivision.spec.js` green; fallback
  counter logged. Measure `ok=false` rate here.

### Stage 4 — Decide degeneracy destination
- From Stage 3 telemetry: if `ok=false` is rare on real inputs, remove the manifold fallback
  in `meshDispatch.meshBoolean` (flip to option (b) — surface `reason` to the user).
- **Gate:** MeshWorkbench booleans green with **no** manifold import on the boolean path;
  degenerate-input e2e shows a clean user-facing error (not a crash).

### Stage 5 — Retire (or carve out) the `foundation/*` manifold kernel — **THE HARD PART**
*This is where "remove the dep entirely" actually lives, and it is NOT routing — it's a
decision about a whole legacy modeling stack (categories B–H, 28 files, ~55 sites).*
- **Decision required (recommend Option R, "Retire"):** the live AI/CUA pipeline and flagships
  use `window.forge.*` (native OCCT), not `foundation/*`. Audit which UI surfaces still mount
  foundation-backed features at runtime — the only confirmed-live one is **MeshWorkbench**
  (handled in Stages 3–4). `TopologyWorkbench`/`poissonReconstruction` use
  `MarchingCubes.extractIsoSurface` (pure JS) + `TopoCantilever` (kernel-free) and only touch
  manifold via the **dynamic** `import('./manifoldKernel.js')` in `MarchingCubes.js:507`
  (`toManifold` helper) and the `.levelSet` SDF helpers — confirm these specific entry points
  are unused at runtime or are pure-JS-reachable.
  - **Option R (recommended):** delete the `foundation/*` manifold-CSG kernel and its
    `manifoldKernel.js` singleton + the `kernel/atomic/AtomicOps.js` consumer. Verify nothing
    in the live App / `ForgeToolBridge` tool registry resolves to a foundation tool. Keep the
    **kernel-free** foundation modules that don't import manifold (`ToolParamSchemas`,
    `Sketch2D`, `SketchAutoDim`, `Polygon2D`, `StepExport`, `TopoCantilever`,
    `MarchingCubes`'s pure paths) which several live modules (`Planner`, `MechCapabilityMap`,
    `InteractiveSketch`, `TopologyWorkbench`) depend on.
  - **Option P ("Port"):** if any foundation feature is still demo-load-bearing, it needs
    **new native ops** first (primitiveMesh, profile-extrude/revolve, general levelSet, mesh
    clean) — that is a kernel work-item set, explicitly out of scope for a dependency removal,
    and should be tracked in `KERNEL_INHOUSE_ROADMAP.md`, not forced into this PR.
- Replace the remaining manifold uses in `meshDispatch.js`
  (`repairSelfIntersect`/`meshToManifold`/`subdivideLoop` rebuild) — either with a native
  `clean()`/manifoldize op (new native work) or by accepting the pure-JS results without the
  manifold round-trip (validate quality first).
- **Gate:** full headed e2e green with `foundation/manifoldKernel.js` deleted and **zero**
  remaining `import ... 'manifold-3d'` in `frontend/src` (`grep` returns 0).

### Stage 6 — Drop the dependency + flip the ratchet (final)
- Remove `"manifold-3d": "^3.4.1"` from `frontend/package.json:25`.
- In `frontend/src/__tests__/deps-allowlist.test.mjs`: remove `'manifold-3d'` from
  `ALLOWLIST` (line 22) and from `SUNSET` (line 30); move it into a **hard assertion that it
  is absent** (the file's own header comment, lines 8–9, already prescribes this).
- `grep -rn "manifold-3d" frontend/src` → must be 0 imports (comments may be scrubbed
  separately).
- **Gate:** `deps-allowlist.test.mjs` now **hard-fails** if manifold-3d ever returns;
  `npm install` + Vite build green with the dep gone; full headed e2e green.

---

## What's cleanly routable vs what needs new native ops (the honest bottom line)

| | |
|---|---|
| **Cleanly routable now** | The single live boolean path (`meshDispatch.meshBoolean`) → `forge.native.meshBoolean`, once the **preload bridge** (Stage 1) exists. |
| **Free, separable removal** | `opencascade.js` — no live UI wiring; delete the legacy `kernel/brep/*` subsystem (Stage 2). |
| **Needs a DECISION, not a port** | The `foundation/*` manifold-CSG kernel (28 files / ~55 sites). Recommended: **retire** it (it's legacy vs the native OCCT path), keeping the kernel-free foundation utilities. |
| **Needs NEW native ops first (out of scope for this removal)** | primitive→mesh, `CrossSection` extrude/revolve/project/offset, general `levelSet(field)`, voxel-fill, mesh `clean()`/manifoldize, topological-ID lineage, standalone validate/mass-props. Track in `KERNEL_INHOUSE_ROADMAP.md`. |

**Net:** removing manifold-3d is achievable, but it is a *retire-the-legacy-stack + bridge +
one boolean swap* job, **not** a per-call-site native port. Do not advertise it as trivial.
The only thing blocking the dep deletion after Stages 1–4 is the **Stage 5 decision** to
retire `foundation/*` (cheap if confirmed-legacy) vs port it (expensive native R&D).
