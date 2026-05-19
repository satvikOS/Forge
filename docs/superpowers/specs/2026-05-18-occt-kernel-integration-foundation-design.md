# Sub-project A — OCCT Kernel Integration Foundation — Design

> **Spec.** Written 2026-05-18. This is Sub-project A of the ArchDisc kernel
> program defined in `docs/ARCHDISC_VISION_AND_ROADMAP.md` §8 Step 0. It is
> self-contained — assume the reader has only read the roadmap.

---

## 1. Purpose

ArchDisc's stated foundational blocker is the absence of an **exact B-rep /
NURBS geometry kernel**; its working engine is `manifold-3d`, a mesh-boolean
kernel that cannot produce exact NURBS surfaces, exact trimmed topology, or
exact fillets (roadmap §0, §6, §7).

Sub-project A resolves Step 0 by **integrating OpenCASCADE (OCCT)** into
ArchDisc as its exact B-rep kernel and building a substantial slice of the
ACIS/Parasolid parity capability set (roadmap §3) on top of it.

This is the first sub-project of a multi-day kernel program. Sub-projects B+
(later, separate specs) cover the parity capabilities explicitly deferred in
§9 below.

## 2. Decisions already made (carried into this spec)

These were settled during brainstorming and are **not** open for
re-litigation inside this spec:

- **Kernel:** OpenCASCADE via the prebuilt `opencascade.js` WASM package.
  It is the only mature open-source exact B-rep kernel with a working WASM
  build for an Electron/Vite renderer. LGPL; large WASM payload accepted as a
  known, deferred optimization.
- **Architecture:** one unified **ArchDisc Kernel** facade. OCCT is the exact
  B-rep engine under the hood; `manifold-3d` is kept behind the same facade
  for existing mesh features. New parity work targets OCCT. The existing
  ~388 e2e tests must not regress.
- **Integration approach:** thin facade over the prebuilt full
  `opencascade.js` (no custom slim WASM build in this sub-project).
- **Verification:** every operation is verified by a **headed Playwright e2e
  test** and confirmed green before the next operation is built. This is a
  hard, non-negotiable gate.

## 3. Scope

### 3.1 In scope (delivered, phased — see §6)

- OCCT WASM loaded into the Vite/Electron renderer.
- A unified ArchDisc Kernel facade (`kernel/brep/`) with OCCT lifecycle /
  disposal management.
- OCCT → Three.js tessellation and live viewport display.
- A "B-rep Lab" workbench panel and a `window.__archdiscKernel` hook.
- Operation set:
  - **Core:** box, cylinder, sphere, cone, torus primitives; exact boolean
    fuse / cut / common; extrude (prism); revolve; exact fillet; exact
    chamfer; native STEP import/export; measurement (volume, area, bbox,
    face/edge counts).
  - **Local + surfacing:** shelling/hollowing; thickening sheets; complex
    face offsetting; draft angles; sweeping along paths; lofting with
    tangency; variable-radius fillet.
  - **Evaluation & checking:** self-intersection detection; clash /
    interference detection.
  - **Geometry simplification:** removal of sliver faces, tiny faces, small
    edges.
  - **Hard blending (research-grade, honestly flagged):** G2 (curvature-
    continuous) blending; cliff-edge blending; corner mitering.
- A headed Playwright e2e spec covering every operation above.

### 3.2 Out of scope (deferred to later sub-projects)

- N-sided patching; non-manifold booleans; coplanar/coincident-face
  booleans; high-density lattice intersections; local face replacement;
  tolerant modeling / stitching; convergent modeling.
- A custom slim OCCT WASM build (bundle-size optimization).
- Migrating existing `manifold-3d` features onto OCCT.
- Wiring the existing sketch-constraint solver to the OCCT kernel.
- Simulation, MCQ engine, swarm orchestration, publishing (roadmap §1, §4).

## 4. Architecture

### 4.1 Module layout — `frontend/src/kernel/brep/`

| Module | Responsibility |
|---|---|
| `occtKernel.js` | Singleton WASM loader `getOCCT()`. Mirrors `foundation/manifoldKernel.js`: loads the prebuilt `opencascade.js` module once, caches the promise, resolves the `.wasm` asset via a Vite `?url` import. `_reset()` for tests. |
| `BrepShape.js` | Wrapper over an OCCT `TopoDS_Shape`: a stable string id, construction metadata (op name, params, parent ids), and `dispose()`. Plus `withScope(fn)` — a disposal arena that frees every intermediate OCCT/Embind object allocated inside `fn` on exit, except the `BrepShape`(s) `fn` returns. |
| `BrepPrimitives.js` | `makeBox / makeCylinder / makeSphere / makeCone / makeTorus`. |
| `BrepBoolean.js` | Exact `fuse / cut / common` (`BRepAlgoAPI_Fuse/Cut/Common`). |
| `BrepFeatures.js` | `extrude` (`BRepPrimAPI_MakePrism`), `revolve` (`BRepPrimAPI_MakeRevol`), `fillet` (constant-radius, edge-selectable, `BRepFilletAPI_MakeFillet`), `filletVariable` (variable-radius via the same class), `chamfer` (`BRepFilletAPI_MakeChamfer`). |
| `BrepLocalOps.js` | `shell` / `hollow` and `thicken` (`BRepOffsetAPI_MakeThickSolid`), `offsetFaces` (`BRepOffsetAPI_MakeOffsetShape`), `draft` (`BRepOffsetAPI_DraftAngle`). |
| `BrepSurfacing.js` | `sweep` (`BRepOffsetAPI_MakePipe` / `MakePipeShell`), `loft` (`BRepOffsetAPI_ThruSections`, with tangency options). |
| `BrepCheck.js` | `selfIntersects` (`BOPAlgo_CheckerSI`), `clash(a, b)` — interference volume / proximity via boolean-common + `BRepExtrema_DistShapeShape`. |
| `BrepHeal.js` | `simplify` — remove sliver faces, tiny faces, small edges (`ShapeUpgrade_*` / `ShapeFix_*`). |
| `BrepBlend.js` | Research-grade blending: `blendG2` (curvature-continuous), `blendCliffEdge`, `mitreCorner`. Honestly scoped — see §6 Phase A5. |
| `BrepTessellate.js` | `tessellate(shape, deflection)` → `{ positions, normals, indices }` via `BRepMesh_IncrementalMesh` + `TopExp_Explorer` face walk + `Poly_Triangulation`. Output is ready for a Three.js `BufferGeometry`. |
| `BrepStep.js` | `exportStep(shape)` → STEP text and `importStep(text)` → `BrepShape`, native via `STEPControl_Writer` / `STEPControl_Reader`. |
| `BrepMeasure.js` | `volume`, `area`, `boundingBox`, `faceCount`, `edgeCount` (`GProp_GProps`, `BRepGProp`, `TopExp`). Drives e2e numeric assertions. |
| `ArchDiscKernel.js` | The unified facade — the single entry point. Re-exports the B-rep ops under `kernel.brep.*` and the existing manifold path under `kernel.mesh.*`. |

### 4.2 Lifecycle & memory

OCCT objects are Embind-wrapped C++ objects; like `manifold-3d` they leak the
WASM heap unless explicitly freed (memory note: the manifold heap-exhaustion
fix). Rules:

- Every kernel op runs its OCCT work inside `withScope()`. Intermediates
  (builders, sub-shapes, transient `TopoDS_Shape`s) are tracked and freed on
  scope exit; only the returned `BrepShape`(s) survive.
- `BrepShape.dispose()` frees the underlying `TopoDS_Shape` and any cached
  triangulation.
- Every e2e spec includes a **leak guard**: repeat the op N times and assert
  the WASM heap (`HEAP8.length` / module memory) does not grow monotonically.

### 4.3 Viewport, UI & e2e hooks

- Op results are tessellated by `BrepTessellate` and rendered in the live
  Three.js viewport, so headed runs and screenshots are visually meaningful.
- A new **"B-rep Lab"** workbench panel exposes a real button per operation
  (Box, Cylinder, Sphere, Cone, Torus, Fuse, Cut, Common, Extrude, Revolve,
  Fillet, Variable Fillet, Chamfer, Shell, Thicken, Offset, Draft, Sweep,
  Loft, Self-Intersect Check, Clash Check, Simplify, G2 Blend, Cliff Blend,
  Mitre, Import STEP, Export STEP). Real buttons so headed Playwright drives
  real clicks.
- `window.__archdiscKernel` exposes the facade for spec-level calls and
  metric readback, mirroring the existing `window.__archdiscAtomic` /
  `window.__last*` hook pattern.

### 4.4 Vite / build integration

- `opencascade.js` added to `frontend/package.json` dependencies.
- The `.wasm` asset is resolved via a `?url` import (the pattern already used
  for `manifold-3d/manifold.wasm?url`); Vite copies it to the build output.
- `base: './'` is already set for Electron — the OCCT wasm URL must resolve
  correctly under that base in both `vite dev` and the Electron build.

## 5. Data flow

```
B-rep Lab button click  ──►  ArchDiscKernel.brep.<op>(params)
        │                          │
        │                    withScope:  getOCCT() ──► OCCT API ──► TopoDS_Shape
        │                          │
        │                    new BrepShape(shape, meta)
        ▼                          ▼
window.__archdiscKernel      BrepTessellate ──► {positions,normals,indices}
   (e2e readback)                   │
        │                           ▼
        └──────────────►  Three.js BufferGeometry ──► viewport
                                    │
                          BrepMeasure ──► window.__lastBrepMetrics
```

## 6. Build phases (each fully e2e-green before the next)

- **Phase A0 — Integration foundation.** Install `opencascade.js`; write
  `occtKernel.js`; "hello box" smoke test — load OCCT, make one box,
  tessellate it, render it, see it in a headed run. Then `BrepShape` +
  `withScope`, `BrepTessellate`, `BrepMeasure`, `ArchDiscKernel` facade,
  B-rep Lab panel shell, `window.__archdiscKernel` hook. *This phase
  de-risks the WASM/Embind/Vite integration before any real geometry.*
- **Phase A1 — Core ops.** Primitives, exact booleans, extrude, revolve,
  exact fillet, exact chamfer, native STEP import/export.
- **Phase A2 — Local + surfacing.** Shelling/hollowing, thickening, face
  offsetting, draft angles, sweeping, lofting, variable-radius fillet.
- **Phase A3 — Evaluation & checking.** Self-intersection detection,
  clash/interference detection.
- **Phase A4 — Geometry simplification.** Sliver/tiny-face/small-edge
  removal.
- **Phase A5 — Hard blending (research-grade).** G2, cliff-edge, corner
  mitering. Honest expectation: these are not one-class OCCT operations;
  this phase may produce partial results and/or spill into a follow-on
  sub-project. That outcome is acceptable and will be reported honestly,
  not disguised — consistent with the roadmap's honesty principle.

## 7. Error handling

- `getOCCT()` failure (WASM fetch / instantiate) surfaces a clear error in
  the B-rep Lab panel; the kernel facade rejects rather than silently
  falling back to mesh geometry.
- OCCT op failures (`IsDone() === false`, null shapes, boolean failures) are
  caught in the facade, the partial OCCT state is disposed via `withScope`,
  and a descriptive error is thrown — no silent empty-shape returns.
- STEP import of malformed text reports the OCCT reader status verbatim.
- `withScope` frees intermediates even when `fn` throws (try/finally).

## 8. Testing strategy

- One headed Playwright spec per operation family, under `e2e/`, following
  existing conventions: 1920×1000 viewport, `webServer` on port 3000, real
  button clicks (`dispatchEvent('click')` where a scroll container would
  intercept), screenshots on.
- Each spec: launch app → drive the op via its B-rep Lab button → assert
  geometry metrics via `BrepMeasure` (e.g. a 10 mm box → volume ≈ 1000 mm³,
  6 faces) → assert the viewport screenshot is non-blank → run the leak
  guard.
- `fillet` spec: assert volume decreased by the expected rounded-corner
  amount and face count increased.
- STEP spec: build a shape → `exportStep` → `importStep` → assert round-trip
  metrics match within tolerance.
- `clash` spec: two overlapping shapes report interference; two disjoint
  shapes report none.
- `selfIntersects` / `simplify` specs: assert detection and cleanup on
  purpose-built bad geometry.
- Playwright gotcha (memory): spec files must not `import` from `node:*`
  directly — use bare `import fs from 'fs'`.
- Run e2e via `./node_modules/.bin/playwright` (1.59), not `npx`.
- The existing ~388 e2e tests must still pass — coexistence, no regression.

## 9. Risks

| Risk | Mitigation |
|---|---|
| WASM bundle size (~25–35 MB) | Accepted; deferred to a later custom-slim-build sub-project. |
| `opencascade.js` Vite/Embind integration friction | Phase A0 "hello box" smoke test de-risks it before anything else is built. |
| Low-level Embind API ergonomics | The `kernel/brep/` facade fully absorbs raw OCCT; no OCCT types leak past `ArchDiscKernel`. |
| WASM heap leaks | `withScope` disposal arena + per-spec leak guard. |
| Hard blending (A5) harder than one sub-project | Honestly flagged in §6; partial delivery is an acceptable, openly-reported outcome. |
| Regression of existing 388 e2e tests | Coexistence architecture — OCCT is additive; existing manifold path untouched. |

## 10. Definition of done

- `opencascade.js` integrated; OCCT loads in both `vite dev` and the
  Electron build.
- Every operation in §3.1 has: a facade method, a B-rep Lab button, a
  `window.__archdiscKernel` entry, and a **green headed Playwright spec**.
- All specs pass headed; the leak guard passes for every op.
- The existing ~388 e2e tests still pass.
- Phase A5 outcome reported honestly (complete, partial, or deferred).
