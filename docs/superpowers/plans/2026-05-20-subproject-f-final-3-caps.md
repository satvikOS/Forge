# Sub-project F — Final §3 Capabilities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach the §3 capabilities still uncovered after Sub-projects A0–A5 + B + C + D + E:
1. **N-Sided Patching** (§3.3) — filling a gap bounded by an arbitrary non-four-sided loop of curves.
2. **Sweeping Along Tortuous Paths** (§3.3) — non-self-intersecting sweep of a profile along tight 3-D curves (richer than the simple `MakePipe` used in A2).
3. **Lofting with Tangency Constraints** (§3.3) — smooth surfaces through multi-profile guides with tangent boundary conditions (richer than the basic `ThruSections` used in A2).
4. **Tolerant Modeling / Stitching** (§3.5) — sewing imported surfaces with gaps larger than standard tolerances.
5. **Convergent Modeling** (§3.5) — classic B-rep operations on facet/mesh data.

**Architecture:** Recon-first per item to establish REACHABLE / NOT_REACHABLE in this prebuilt `opencascade.js`. Implement reachable items behind the ArchDiscKernel facade and wire into ribbon tools. Each is e2e-verified by a real-world artifact recipe via real ribbon clicks + dialogs, with all-angle/zoom capture. Honest gaps documented for not-reachable items.

**Tech Stack:** `opencascade.js@2.0.0-beta.b5ff984` (pinned), Vite 7, React 19, Electron 42, Playwright 1.59 (headed, `_electron`).

**Reference spec:** `docs/superpowers/specs/2026-05-18-occt-kernel-integration-foundation-design.md` §3.3 + §3.5.

---

## Important context for the implementer

- **A0–A5 + B + C + D + E shipped.** Kernel modules under `frontend/src/kernel/brep/`. All directives in force from memory: `feedback_sophisticated_integrations`, `feedback_complex_e2e_models`, `feedback_e2e_user_workflows`, `feedback_e2e_all_angles`, `feedback_fully_sophisticated`, `feedback_no_floating_panels`.
- **Honest finding to inherit (from A5):** `BRepOffsetAPI_MakeFilling.Build()` throws a raw C++ exception for ALL inputs in this build — N-Sided Patching (item 1) likely lands as NOT_REACHABLE. The recon confirms.
- **Op pattern unchanged.** Ribbon-handler pattern: `_pickBodies(arity) → requestToolParams → ArchDiscKernel.brep.<op>(...) → addBrepShapeToScene → return {status, message}`. e2e drives via real ribbon clicks + dialogs.
- Work on branch `archdisc`. Commit after every task.

---

## File structure

| File | Responsibility |
|---|---|
| `frontend/src/kernel/brep/BrepFinal.js` | Create — ops Task 1 confirms reachable |
| `frontend/src/kernel/brep/ArchDiscKernel.js`, `index.js` | Modify — facade + barrel |
| `frontend/src/foundation/ToolParamSchemas.js` | Modify — add schemas |
| `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` | Modify — ribbon handlers |
| `frontend/src/components/RibbonToolbar.jsx` + `WorkbenchMechanical.jsx` | Modify — ribbon tool entries |
| `docs/superpowers/notes/occt-api-F.md` | Create (Task 1) — verdict + verified API |
| `e2e/brep-f-recon-electron.spec.js` | Create (Task 1) — recon |
| `e2e/brep-final-electron.spec.js` | Create (Task 3) — e2e gate |

---

## Task 1: Recon — reachability verdict per capability

Investigate the OCCT APIs for the 5 items. For each: try the calls inside the real Electron app, record `REACHABLE` (with verified call sequence + a small geometric assertion) or `NOT_REACHABLE` (with the error and what was tried). `expect(...)` each item has a recorded verdict — spec PASSES when investigation complete.

Items to verify:

1. **N-Sided Patching** — `BRepOffsetAPI_MakeFilling`. The A5 recon found `MakeFilling.Build()` throws for all boundary geometries. Re-verify briefly (in case anything changed) on a 4-edge planar wire boundary + a true 5-edge non-quad boundary. Record verdict — likely NOT_REACHABLE confirming A5 finding.

2. **Tortuous-path Sweep** — `BRepOffsetAPI_MakePipeShell`. Investigate the constructor (likely `_1(spine)`). Add a profile via `.Add(profile)` and set options (binormal, profile orientation). `.Build()` + `.IsDone()` + `.Shape()`. Build a tortuous path as a 3-edge polyline (e.g. `(0,0,0)→(20,0,0)→(20,20,0)→(20,20,30)` with two right-angle bends — tight enough to challenge the sweep) and a circular profile (radius 4) at the start. Sweep, verify positive volume + IsDone. Record.

3. **Lofting with Tangency** — `BRepOffsetAPI_ThruSections` (already used in A2 for basic loft). Investigate adding TANGENT constraints — the API supports `.AddWire(wire)` + a `.AddTangency` or similar via the `_2` constructor (`ThruSections(isSolid, isRuled, presPar)`); or via `.SetSmoothing(true)`. Build 3 square wires at different z (z=0, z=20, z=40 — a tapered tower) and run ThruSections with `isSolid=true, isRuled=false, pres=1e-6`. Test the `SetSmoothing(true)` method if it exists. Confirm `.IsDone()` + non-null `.Shape()` + volume > 0. Record the verified tangency-related calls (whichever exists) — and document if smoothing is limited to G1 (tangent) vs richer continuity.

4. **Tolerant Stitching** — `BRepBuilderAPI_Sewing`. Construct: `new oc.BRepBuilderAPI_Sewing_1(tolerance=0.1, optionsBitsOrShape=true...)` — find the exact arity. `.Add(face)` per face; `.Perform()`; `.SewedShape()` returns the result. Test: build 2 planar faces (via `BRepBuilderAPI_MakeFace_15` from rectangular wires) that share a common edge but with a small gap (positioned at +/- 0.05 mm), call Sewing with tolerance 0.1; assert the result is a single shell (`TopAbs_SHELL`) containing both faces stitched. Record.

5. **Convergent Modeling** — direct B-rep ops on mesh/facet data. The cleanest OCCT path: `BRepBuilderAPI_MakePolygon` builds a wire from `gp_Pnt` sequences; for a true facet→B-rep conversion the canonical path is to build a `Poly_Triangulation` and ATTACH it to a face via `BRep_Tool` static methods — but this typically isn't a building op, it's a property of an existing face. The more achievable interpretation: use `BRepBuilderAPI_MakeFace_15` from triangle wires + Sewing to build a "mesh-derived" B-rep solid. Test: create 8 triangle face wires from cube-mesh data (the 12 triangles of a cube mesh, but as wire+face per triangle), sew them with Sewing, then convert to solid via `BRepBuilderAPI_MakeSolid(shell)`. Verify a non-null solid with positive volume. Record. If this proves too contrived to write a "real" op, document the available primitives (MakePolygon, MakeFace_15, Sewing, MakeSolid) and ship convergent modeling as a documentation-only honest gap.

For each item record verdict + verified sequence (if REACHABLE) or honest explanation (if NOT_REACHABLE).

- [ ] **Step 1: Write recon spec**

Create `e2e/brep-f-recon-electron.spec.js` modeled on `e2e/brep-b-recon-electron.spec.js`. Use `getOCCT()` directly inside `win.evaluate` to introspect + probe. `.delete()` every OCCT object. Write `verified` JSON to `docs/superpowers/notes/occt-api-F-recon.json`. `expect(...)` each item has a verdict. `test.setTimeout(600000)`.

- [ ] **Step 2: Build + run, iterate until GREEN**

```
cd frontend && npx vite build && cd .. && ./node_modules/.bin/playwright test e2e/brep-f-recon-electron.spec.js --project=chromium
```

- [ ] **Step 3: Write `docs/superpowers/notes/occt-api-F.md`**

For each item: verdict + verified COMPLETE copy-pasteable sequence (REACHABLE) or honest explanation (NOT_REACHABLE). Add a "Sub-project F deliverable scope" section listing the ops Tasks 2-3 will build.

- [ ] **Step 4: Commit**

```bash
git add e2e/brep-f-recon-electron.spec.js docs/superpowers/notes/occt-api-F.md docs/superpowers/notes/occt-api-F-recon.json
git commit -m "test(kernel): F recon — final §3 capability reachability verdict per item"
```

---

## Task 2: Implement reachable ops in `BrepFinal.js`

For each REACHABLE item, add a kernel op. Likely scope (recon will confirm):

- **`pipeShellSweep(profileBuildOpts, pathBuildOpts)`** — tortuous-path sweep via `BRepOffsetAPI_MakePipeShell`. Internal builder uses dialog-supplied params: spine path (polyline 3-segment with bend angles), profile (circle radius). Returns `BrepShape`.

- **`loftTangent(opts)`** — tangent-constrained loft via `BRepOffsetAPI_ThruSections` with `SetSmoothing(true)` (or whichever the recon found works). Internal builder builds 3 section wires from dialog params (3 square sides + heights). Returns `BrepShape`.

- **`stitchFaces(facesOrShape, tolerance)`** — `BRepBuilderAPI_Sewing`. Either takes an existing `BrepShape` containing loose faces or an internal demo built from a few rectangles with gaps. Returns the sewn shell `BrepShape`.

- **`convergentSolid(opts)`** — if convergent modeling proved achievable, build a facet-derived solid via the Sewing+MakeSolid pipeline. Otherwise honestly skip.

Each op follows the standard kernel pattern. Build + commit.

## Task 3: Facade + barrel + ribbon + schemas

Add the reachable ops to the facade + barrel. Schemas in `ToolParamSchemas.js`:
- **`Sweep Tortuous`** — profileRadius (default 4), pathLength (default 20 — per segment), pathSegments (default 3).
- **`Loft Tangent`** — 3 section sides (s0, s1, s2 — defaults 40, 20, 30) and 3 z-heights (z0=0, z1=20, z2=40).
- **`Stitch Faces`** — tolerance (default 0.1, mm).
- **`Convergent Solid`** — gridSize (default 20, mm), gridN (default 4 segments).

Ribbon tools added to Part tab Surface group: `Sweep Tortuous`, `Loft Tangent`, `Stitch Faces`, `Convergent Solid` (only the reachable ones).

Handlers in `ToolExecutionEngine.js` follow the standard pattern (no hardcoded fallback geometry; surfacing arity-0 ops use dialog only; selection-based ops use `_pickBodies(1)`).

Build + commit.

## Task 4: e2e gate `e2e/brep-final-electron.spec.js`

Real-world artifacts via real ribbon clicks. Per shipped op:
- **`Sweep Tortuous`** — "S-bend pipe section": click ribbon tool → fillDialog → assert volume positive + faces > 3 + bounding box spans the path.
- **`Loft Tangent`** — "tapered tower with smooth sides": click ribbon → fillDialog → assert volume positive + smooth face continuity (no sharp seams between sections).
- **`Stitch Faces`** — "stitched panel assembly": click ribbon → fillDialog → assert result is a SHELL containing both panel faces.
- **`Convergent Solid`** (if shipped) — "facet-derived box": click ribbon → fillDialog → assert positive volume close to expected.

Each test: `captureAllAngles` with default sweep, assert blanks empty, pageErrors empty.

Run the full brep+UX suite. Append "Sub-project F — honest outcome" section to `occt-api-F.md` with measured values + dropped ops (e.g. N-Sided Patching = MakeFilling.Build unreachable, per A5).

Commit per shipped op + final docs commit.

---

## Self-review notes

- Recon-first locks scope honestly. NOT_REACHABLE items are skipped openly (no faking).
- Every shipped op gets a real-world artifact e2e via ribbon clicks + dialogs + all-angle capture — consistent with all directives.
- Aligns with [[feedback_sophisticated_integrations]], [[feedback_complex_e2e_models]], [[feedback_e2e_user_workflows]], [[feedback_e2e_all_angles]], [[feedback_fully_sophisticated]], [[feedback_no_floating_panels]].
- After F: the §3 capability set is meaningfully closed in this prebuilt `opencascade.js`; further capabilities (auto-trimming B-rep, class-A modelling) genuinely need a custom OCCT build and are documented as such in the roadmap.
