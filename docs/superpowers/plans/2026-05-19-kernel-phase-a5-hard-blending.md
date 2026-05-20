# Kernel Phase A5 — Hard Blending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach as much of the §3.1 "hard blending" capability set as the prebuilt `opencascade.js` genuinely allows — G2 (curvature-continuous) blending, cliff-edge blending, corner mitering — implemented behind the ArchDiscKernel facade, ribbon-wired, headed-Electron-verified, with the honest gaps documented.

**Architecture:** Extends the `frontend/src/kernel/brep/` the kernel (phases A0–A4). Phase A5 is **research-grade** — these are NOT one-class the kernel operations, and the spec honestly flags that A5 may only partially deliver. Therefore A5 is **recon-driven**: Task 1 empirically establishes a REACHABLE / NOT-REACHABLE verdict per capability; Tasks 2–4 implement, wire, and e2e-gate ONLY what Task 1 confirmed reachable. Capabilities that are not reachable with the prebuilt `opencascade.js` are documented honestly in `docs/superpowers/notes/kernel-api-A5.md` and the kernel — never faked.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-kernel-integration-foundation-design.md` (§3.1, §6 Phase A5).

---

## Important context for the implementer

- **Read first:** the spec, the A4 plan, and the verified API notes `docs/superpowers/notes/kernel-api-A0.md` … `A4.md`.
- **A0–A4 are done.** `frontend/src/kernel/brep/` has the full kernel: `occtKernel.js`, `BrepShape.js` (`BrepShape`, `withScope`, `track`), `BrepPrimitives.js`, `BrepBoolean.js`, `BrepFeatures.js` (incl. `filletAll`, `chamferAll`, `variableFillet`), `BrepLocalOps.js`, `BrepSurfacing.js`, `BrepCheck.js`, `BrepTransform.js`, `BrepHeal.js`, `BrepStep.js`, `BrepTessellate.js`, `BrepMeasure.js`, `brepToMesh.js`, `ArchDiscKernel.js`, `index.js`.
- **Op pattern:** `const oc = await getOCCT(); return withScope(() => { ...track() every transient the kernel object...; if (shape.IsNull()) throw ...; return new BrepShape(shape, meta); });`. kernel Embind objects leak the WASM heap unless `track()`d.
- **The §3.1 hard-blending capabilities A5 targets:**
  - **G2 (curvature-continuous) blending** — a blend surface matching *curvature*, not just tangency, between faces/edges.
  - **Cliff-edge blending** — a blend (large fillet) that completely consumes or runs off the adjacent faces.
  - **Corner mitering** — a clean resolution where 3+ blends meet at a single vertex.
- **Honesty principle (roadmap §10):** if a capability is not reachable with the prebuilt `opencascade.js`, say so plainly — partial delivery openly reported is the correct, expected A5 outcome.
- **Ribbon integration:** `ToolExecutionEngine.js` the kernel handlers; `addBrepShapeToScene`. **e2e:** headed Playwright, real Electron app; geometry ops verified from all camera angles + zooms via `e2e/helpers/orbitCapture.js`.
- Work on branch `archdisc`. Commit after every task. Do NOT create branches.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepBlend.js` | Create — the A5 blending ops that Task 1 confirms reachable |
| `frontend/src/kernel/brep/ArchDiscKernel.js` | Modify — expose the delivered A5 ops |
| `frontend/src/kernel/brep/index.js` | Modify — barrel exports |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — wire the delivered A5 ops into ribbon tools |
| `docs/superpowers/notes/kernel-api-A5.md` | Create (Task 1) — verified API + the honest REACHABLE/NOT-REACHABLE verdict |
| `e2e/brep-a5-recon-electron.spec.js` | Create (Task 1) — empirical recon |
| `e2e/brep-blend-electron.spec.js` | Create (Task 4) — A5 e2e gate |

---

## Task 1: A5 hard-blending reconnaissance & reachability verdict (the crux)

**Files:**
- Create: `e2e/brep-a5-recon-electron.spec.js`
- Create: `docs/superpowers/notes/kernel-api-A5.md`

This task empirically establishes, inside the real Electron app, exactly which A5 capabilities are reachable with the prebuilt `opencascade.js`. It is the most important A5 task — its verdict defines Tasks 2–4. Mirrors `e2e/brep-a4-recon-electron.spec.js`.

- [ ] **Step 1: Write the recon spec**

Create `e2e/brep-a5-recon-electron.spec.js`. Launch the Electron app, get `oc` via `window.__archdiscKernel.getOCCT()`, and inside `win.evaluate(...)` empirically investigate each capability below. try/catch each candidate API; on `UnboundTypeError` / `BindingError` / failure, record it and try alternatives; introspect with `Object.getOwnPropertyNames(oc)` and prototype walks. `.delete()` every the kernel object created. Write a structured `verified` object (each capability tagged `REACHABLE` or `NOT_REACHABLE` with evidence) to `docs/superpowers/notes/kernel-api-A5-recon.json`, `console.log` it, and `expect(...)` the spec to PASS green — the spec PASSING means "the investigation completed and recorded a verdict", NOT "every capability works". Assert only that each capability has a recorded verdict. `test.setTimeout(600000)`.

Build inputs with the verified A0–A4 APIs (`BRepPrimAPI_MakeBox_2`, `BRepFilletAPI_MakeFillet`, `TopExp_Explorer_2`, `GProp`, etc.).

1. **G2 (curvature-continuous) blending.** Investigate `BRepOffsetAPI_MakeFilling` — it builds a filling surface meeting boundary edges with a specified continuity order (`GeomAbs_C0/C1/C2`). Determine: is `BRepOffsetAPI_MakeFilling` constructible? Can you `.Add(edge, GeomAbs_Shape, ...)` boundary edges with `oc.GeomAbs_Shape.GeomAbs_C2`? Does `.Build()` + `.Shape()` produce a face? Also check `BRepFilletAPI_MakeFillet`'s `ChFi3d_FilletShape` enum — does it expose anything beyond G1 (`ChFi3d_Rational` is G1-tangent)? Record whether a genuine G2 blend surface is reachable, with the exact call sequence if so.
2. **Cliff-edge blending.** A cliff-edge blend is a fillet whose radius is large enough to fully consume the adjacent face. Empirically: take a 20mm box, fillet one edge with an increasing radius (e.g. 2, 8, 15, 19 mm) using the verified `BRepFilletAPI_MakeFillet` + `.Add_2(r, edge)` + `.Build(pr)`. Record the largest radius that still produces a valid solid (`IsDone()` true, non-null, positive volume) — i.e. how far the kernel's fillet runs off/consumes the neighbouring faces before it fails. Record whether "cliff-edge" radii (a fillet radius approaching the face size) are reachable.
3. **Corner mitering.** Fillet ALL THREE edges meeting at one corner of a 20mm box (find the 3 edges incident to a chosen vertex via `TopExp_Explorer` + vertex incidence, or simply fillet all 12 edges which forces every corner to be mitred) with `BRepFilletAPI_MakeFillet`. Confirm the kernel resolves the 3-blend corner into a valid solid (`IsDone()`, non-null, positive volume, and the corner region has the extra faces a mitre produces). Record whether corner mitering is reachable (it likely is — the kernel fillets auto-mitre).

For each capability give a clear `REACHABLE` (with the verified call sequence) or `NOT_REACHABLE` (with the error and what was tried) verdict. Do NOT fake reachability.

- [ ] **Step 2: Build and run; iterate until GREEN**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-a5-recon-electron.spec.js --project=chromium
```
GREEN here means the investigation ran and recorded a verdict for all three capabilities.

- [ ] **Step 3: Write the verified API note + verdict**

Create `docs/superpowers/notes/kernel-api-A5.md`. For each of the three capabilities: the `REACHABLE`/`NOT_REACHABLE` verdict, and for reachable ones the COMPLETE verified copy-pasteable call sequence; for not-reachable ones an honest explanation (the unbound class / the failure). Add a clear "Phase A5 deliverable scope" summary listing which ops Tasks 2–4 will build. Mark verified against `opencascade.js@2.0.0-beta.b5ff984`.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-a5-recon-electron.spec.js docs/superpowers/notes/kernel-api-A5.md docs/superpowers/notes/kernel-api-A5-recon.json
git commit -m "test(kernel): A5 hard-blending recon — reachability verdict per capability"
```

---

## Task 2: BrepBlend — implement the reachable A5 ops

**Files:**
- Create: `frontend/src/kernel/brep/BrepBlend.js`

> Implement ONLY the capabilities Task 1's `kernel-api-A5.md` marked `REACHABLE`. Each gets a function following the standard kernel op pattern, with the the kernel body taken from the verified note. For each `NOT_REACHABLE` capability, do NOT add a fake op — instead record it in the file's header comment as an honest documented gap.

- [ ] **Step 1: Create BrepBlend.js**

Create `frontend/src/kernel/brep/BrepBlend.js` with a header comment that honestly states the A5 scope and any documented gaps (from `kernel-api-A5.md`). Then implement, for EACH capability marked `REACHABLE` in `kernel-api-A5.md`, one exported async function following the established pattern (`getOCCT` → `withScope` → `track()` every transient → `IsNull()` check → `new BrepShape(shape, {op, params, parents})`):

- If **G2 blending** is reachable: `export async function blendG2(...)` — builds a curvature-continuous blend surface via the verified `BRepOffsetAPI_MakeFilling` sequence. Pick a concrete, verifiable signature (e.g. it takes a `BrepShape` and produces a blended result, or builds a demonstrative G2 blend between two faces). Use the exact signature/inputs the recon note's verified sequence supports.
- If **cliff-edge blending** is reachable: `export async function cliffEdgeBlend(brepShape, radius)` — a large-radius fillet on all edges (or a chosen edge) at a radius in the cliff range the recon established. Reuse the verified `BRepFilletAPI_MakeFillet` path; this op exists to expose the large-radius blend explicitly with validation that the radius is within the recon-confirmed cliff range.
- If **corner mitering** is reachable: `export async function mitreCorner(brepShape, radius)` — fillet all edges of a solid (forcing every corner to mitre) at `radius`, returning the mitred solid. (This overlaps `filletAll` mechanically; `mitreCorner` is the §3.1-named capability — keep it as a distinct named op, documented as "fillets every edge so all corners are mitred".)

Each function: validate inputs, throw descriptive errors, return a `BrepShape`.

- [ ] **Step 2: Verify it compiles**

```bash
cd frontend && npx vite build 2>&1 | tail -6
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/kernel/brep/BrepBlend.js
git commit -m "feat(kernel): add reachable A5 hard-blending ops"
```

---

## Task 3: Facade, barrel & ribbon wiring

**Files:**
- Modify: `frontend/src/kernel/brep/index.js`
- Modify: `frontend/src/kernel/brep/ArchDiscKernel.js`
- Modify: `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js`
- Modify (if needed): `frontend/src/components/RibbonToolbar.jsx`, `frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx`

- [ ] **Step 1: Barrel — `frontend/src/kernel/brep/index.js`**

Add an `export { ... } from './BrepBlend.js';` line listing exactly the functions `BrepBlend.js` actually exports (the reachable A5 ops from Task 2).

- [ ] **Step 2: Facade — `frontend/src/kernel/brep/ArchDiscKernel.js`**

Add the matching `import { ... } from './BrepBlend.js';` and add those same names to the `brep:` object literal.

- [ ] **Step 3: Ribbon wiring — `ToolExecutionEngine.js`**

For each delivered A5 op, wire a ribbon tool. READ `frontend/src/components/RibbonToolbar.jsx` for suitable existing tool names in the Part tab's Modify section — the Part tab already lists `Variable Radius Fillet`, `Face Fillet`, `Full Round Fillet` (good homes for blending ops). Map:
- `blendG2` (if delivered) → wire to a fillet/blend tool such as `Face Fillet` or add a `G2 Blend` tool.
- `cliffEdgeBlend` (if delivered) → wire to `Full Round Fillet` or add a `Cliff-Edge Blend` tool.
- `mitreCorner` (if delivered) → add/wire a `Corner Mitre` tool.
If a suitable tool name does not exist, add it to the Part tab's Modify section in BOTH `RibbonToolbar.jsx` and `WorkbenchMechanical.jsx` `TOOL_GROUPS`. Each handler follows the established the kernel geometry-op pattern (read e.g. the `Fillet` handler): build via `ArchDiscKernel.brep.*`, render via `addBrepShapeToScene`, dispose intermediates, return `{ status, message }`; try/catch → `{ status:'error', message }`.

- [ ] **Step 4: Verify the build**

```bash
cd frontend && npx vite build 2>&1 | tail -8
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/brep/index.js frontend/src/kernel/brep/ArchDiscKernel.js frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js frontend/src/components/RibbonToolbar.jsx frontend/src/workbenches/mechanical-cad/WorkbenchMechanical.jsx
git commit -m "feat(kernel): expose A5 blending ops on facade + wire into ribbon"
```

---

## Task 4: Headed Electron e2e — A5 gate

**Files:**
- Create: `e2e/brep-blend-electron.spec.js`

A5 ops produce geometry — verify numerically AND from all camera angles/zooms via `e2e/helpers/orbitCapture.js`. Copy the `launch()` helper + imports from `e2e/brep-features-electron.spec.js`; import `captureAllAngles` the way the other geometry specs do.

- [ ] **Step 1: Create `e2e/brep-blend-electron.spec.js`**

`test.setTimeout(600000)`. Write ONE test per delivered A5 op (the ops `BrepBlend.js` actually exports). Each test:
- builds the op's result via `window.__archdiscKernel.kernel.brep.<op>(...)`,
- asserts a real geometric property — for `cliffEdgeBlend` / `mitreCorner`: volume is positive and below the un-blended solid's volume, and `faceCount` is greater than the un-blended solid's (a blend/mitre adds faces); for `blendG2`: the result is a non-null shape with positive area/face count appropriate to a blend surface,
- renders the result via `window.__archdiscKernel.renderShape(...)` and runs `captureAllAngles(win, '<op>', { azimuths:[0,60,120,180,240,300], elevations:[-30,30], zooms:[0.6,1.0,1.8] })`, asserting `cap.blanks` is empty,
- asserts zero renderer `pageError`s.

Set the numeric bounds from the actual measured values (run, observe, set tight ±10% bounds) — do not leave them trivially loose, and do not weaken them.

- [ ] **Step 2: Build and run the A5 gate spec**

```bash
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-blend-electron.spec.js --project=chromium
```
All tests must PASS. A real failure is debugged against `kernel-api-A5.md`, not papered over.

- [ ] **Step 3: Run the full brep e2e suite (regression)**

```bash
./node_modules/.bin/playwright test e2e/brep-occt-load-electron.spec.js e2e/brep-a1-recon-electron.spec.js e2e/brep-a2-recon-electron.spec.js e2e/brep-a3-recon-electron.spec.js e2e/brep-a4-recon-electron.spec.js e2e/brep-a5-recon-electron.spec.js e2e/brep-foundation-electron.spec.js e2e/brep-ribbon-electron.spec.js e2e/brep-primitives-electron.spec.js e2e/brep-boolean-electron.spec.js e2e/brep-features-electron.spec.js e2e/brep-step-electron.spec.js e2e/brep-localops-electron.spec.js e2e/brep-surfacing-electron.spec.js e2e/brep-varfillet-electron.spec.js e2e/brep-check-electron.spec.js e2e/brep-simplify-electron.spec.js e2e/brep-blend-electron.spec.js e2e/thought-bubble-dismiss-electron.spec.js --project=chromium
```
All must pass — confirms A5 did not regress earlier phases. (If `brep-boolean-electron.spec.js` shows the known intermittent cut-test flake, re-run that spec alone and report.)

- [ ] **Step 4: Write the honest A5 outcome**

Append a "Phase A5 — honest outcome" section to `docs/superpowers/notes/kernel-api-A5.md`: which capabilities were delivered, which were `NOT_REACHABLE` and why, and what a future custom the kernel build would unlock. This honest closing report is a required A5 deliverable per roadmap §10.

- [ ] **Step 5: Commit**

```bash
git add e2e/brep-blend-electron.spec.js docs/superpowers/notes/kernel-api-A5.md
git commit -m "test(kernel): A5 gate — headed Electron e2e for hard-blending ops + honest outcome"
```

---

## Self-review notes

- **Spec coverage (§3.1 hard blending / §6 Phase A5):** G2 blending, cliff-edge blending, corner mitering are each investigated (Task 1) and — for those Task 1 confirms reachable — implemented (Task 2), wired (Task 3), and e2e-gated (Task 4). Capabilities found not reachable are honestly documented (Task 1 Step 3, Task 4 Step 4) rather than faked — consistent with the roadmap's honesty principle and the spec's explicit flag that A5 may only partially deliver.
- **Conditional structure is intentional:** A5 is research-grade; Task 1's empirical verdict genuinely cannot be predicted, so Tasks 2–4 are scoped to "what Task 1 confirmed." This is the honest way to plan a research phase — the alternative (writing fixed code for unverified the kernel blend APIs) would violate the no-placeholders / no-fabrication principles.
- **Deferred (out of this plan):** the remaining §3 capabilities (N-sided patching, non-manifold/coincident booleans, lattices, tolerant stitching, convergent modeling) — Sub-projects B–G.
- **Type consistency:** the op names exported by `BrepBlend.js` (Task 2) are the single source of truth — the barrel, facade, ribbon handlers (Task 3), and e2e (Task 4) all reference exactly those names.
