# Forge Platform Capability Inventory

**Honest baseline for the "executes everything" platform.** Every repo claim cites
`file:line`; every external claim cites a source URL. Where something is legacy,
unwired, stubbed, or unverified it is marked explicitly. "Built & validated" is kept
separate from "targeted / present-but-unverified". Authored 2026-06-20 against the
working tree at `/Users/account_clawteam1/archdisc-Mech`.

> **Honesty rules in force (Forge Engineering Bible 0/9):** no fabrication. A correct
> "not found / not implemented" beats a fake "working". No stubs, no plausible-but-
> unmeasured numbers.

---

## 0. What "the platform" actually is

The active app shell is **`ForgeShellV4`** (`forge-v4/`). This is what mounts:

- `frontend/src/App.jsx:2` — `import { ForgeShellV4 } from './forge-v4/ForgeShellV4.jsx';`
  is the only shell rendered by the app entry.

There are **two older / alternate shells in the tree that are NOT in the active mount
path** — call these out so the inventory is honest about what runs:

- `frontend/src/forge-app/ForgeApp.jsx` — the "Forge-26" shell. Its centre viewport is
  a literal placeholder: `forge-app/ForgeApp.jsx:118` reads `"3D canvas — wired in
  Forge-27"`, and its ribbon (`forge-app/Ribbon.jsx:21-84`) is a *static catalogue* that
  logs `"[forge.ribbon] no command registered for ${id}"` (`forge-app/Ribbon.jsx:123`)
  when a button has no backing command. **This shell is not what App.jsx mounts.**
- `frontend/src/workbenches/mechanical-cad/ToolExecutionEngine.js` — 17,349 lines, a
  separate engine that maps ribbon-label strings (`'New Sketch'`, `'Line'`, `'Circle'`,
  … 409 handler keys) to **three.js + manifold-3d** geometry, NOT the native OCCT kernel.
  Verified **not imported anywhere under `forge-v4/`** (grep `ToolExecutionEngine` in
  `forge-v4/` returns nothing). It belongs to the legacy `mechanical-cad` workbench, not
  the v4 platform. Treat its capabilities as *separate* from the v4 inventory below.

**Consequence:** the "executes everything" surface that this inventory certifies is the
**forge-v4 shell → `kernelDispatch.js` / `ForgeToolBridge.js` → native OCCT kernel
(`forge-kernel.node`) → `Viewport.jsx`** path. The two legacy engines exist but are not
the platform.

---

## 1. Workbenches

### 1.1 The registry (built)

`forge-v4/WorkbenchRail.jsx:20-137` defines `WORKBENCHES` — **62 workbench entries**
(counted from the array; ids `mech` through `fan`). Each has `{ id, icon, label }` and a
route handler in `ForgeShellV4.jsx` (the `case 'workbench.<id>'` switch spans roughly
lines 1242-1835, each delegating to a `window.__forgeOpen<Name>Workbench?.()` host).

### 1.2 What the user actually sees in the rail (built)

The slim left rail does **not** render all 62. `WorkbenchRail.jsx:139-142` filters to
`CORE_WORKBENCH_IDS` from `forge-v4/toolRegistry.js:18-30` — **11 core identity
workbenches**:

| # | id | Role |
|---|------|------|
| 1 | `mech` | Part / solid modelling |
| 2 | `draft` | 2D sketcher |
| 3 | `drawing` | Drawings |
| 4 | `sheet` | Sheet metal |
| 5 | `weld` | Weldments |
| 6 | `mold` | Mold tooling |
| 7 | `sim` | Simulation (generic FEA) |
| 8 | `mfg` | Manufacturing (CAM) |
| 9 | `arch` | Arch / BIM |
| 10 | `mesh` | Polygon mesh |
| 11 | `robot` | 6-axis industrial robot |

The remaining ~51 entries are **engineering calculators** (truss, modal, thermal,
fatigue, buckling, beam, spring, HX, Mohr, bolt, wind/snow load, pressure vessel, pump,
refrig, fan, gear, bearing, V-belt, …). Per `WorkbenchRail.jsx:8-13` these are *meant to
live in the hierarchical Tools menu*, not the rail. Their menu tree is
`toolRegistry.js:37` (`CALCULATOR_TREE`).

**Honest note on the calculators:** these are analysis/calculator panels (each its own
`*Workbench.jsx`), not B-Rep modelling surfaces. They are real React panels with the cited
slice provenance, but this inventory has **not independently re-validated each
calculator's math** — that is a per-panel TODO, separate from the kernel physics which
*is* validated (§4).

### 1.3 Workbenches reachable only via host registration (built, conditional)

Many of the 62 open via `window.__forgeOpen*` hooks registered by host components mounted
in `App.jsx` (e.g. `AerospaceWorkbenchHost`, `RobotWorkbenchHost`, `CastingWorkbenchHost`).
The switch cases use optional chaining (`window.__forgeOpenAerospaceWorkbench?.()`,
`ForgeShellV4.jsx:1298`), so if a host failed to mount the menu item silently no-ops
rather than erroring. **UNVERIFIED at runtime here:** I did not boot Electron to confirm
every host registers; the wiring is present in source.

---

## 2. The tool / verb surface

There are **two distinct verb surfaces**, for two distinct drivers (manual UI vs. Archie).

### 2.1 Manual UI toolbar verbs (built) — `forge-v4/Toolbar.jsx`

`Toolbar.jsx:12-172` defines `SPEC`, the contextual toolbar per workbench. The `mech`
workbench alone exposes these tool ids, grouped:

- **Sketch:** `sketch.new/line/rect/circle/arc/polygon/spline/dim/constrain/finish`
  (`Toolbar.jsx:14-25`)
- **Solid:** `solid.extrude/revolve/sweep/loft/shell/thicken/knit/trimSurface/fillet/
  chamfer/draft/hole/thread/rib/translate` (`Toolbar.jsx:26-42`)
- **Pattern:** `pattern.linear/circular/mirror/curve` (`Toolbar.jsx:43-48`)
- **Datum:** `datum.offsetPlane/plane3pt/midPlane/axis2pt` (`Toolbar.jsx:49-54`)
- **Boolean:** `bool.union/cut/common/split` (`Toolbar.jsx:55-60`)
- **Measure:** `measure.distance/angle/area/mass/interfere` (`Toolbar.jsx:61-67`)
- **I/O:** `io.step/iges/stl/brep/pdf` (`Toolbar.jsx:68-74`)

Plus per-workbench groups: `drawing` (`view.*`, dims, annotate — `Toolbar.jsx:76-94`),
`sheet` (full CATIA-SMD layout: base/edge/miter/lofted/swept flange, bends, forming,
hems, corners, unfold/flat — `Toolbar.jsx:96-133`), `weld` (`Toolbar.jsx:134-143`),
`mold` (`Toolbar.jsx:144-152`), `sim` (`sim.static/modal/dynamic/thermal/cfd` —
`Toolbar.jsx:153-161`), `mfg` (`mfg.face/contour/pocket/drill/5axis/post` —
`Toolbar.jsx:162-171`).

These ids are dispatched by `forge-v4/kernelDispatch.js`. The `dispatchTool` switch
(cases enumerated in `kernelDispatch.js:126-477`) routes `solid.*`, `pattern.*`, `bool.*`,
`sheet.*`, `weld.*`, `mold.*` to the native kernel; a second switch around
`kernelDispatch.js:535-632` classifies the rest. **Gap (honest):** several toolbar ids
fall through to no-op / preview-only handlers (`sheet.*` cases at `kernelDispatch.js:444-453`
and `weld.*` at `:456-461` are grouped without distinct kernel calls in the first switch;
`sim.*`/`mfg.*`/`view.*`/`measure.*`/`sketch.*` at `:612-632` are classification stubs,
not full executors). So **not every toolbar button is a fully-wired kernel op** — that is
a real gap to mark, not gloss.

### 2.2 Archie-drivable verbs (built) — `frontend/src/ai/ForgeToolBridge.js`

This is the contract the Archie model fleet was trained on. The bridge registers
**104 distinct tool names** (counted from `name: '<ns>.<verb>'` entries). By namespace:

- **`part.*` (~40):** `make-box/cylinder/sphere/cone/torus`, `fuse/cut/common/intersect/
  subtract/translate/rotate`, `fillet/variable-fillet/chamfer/shell/draft-faces`,
  `extrude/revolve/sweep/loft/pipe/nurbs-surface/push-pull-face`,
  `linear-pattern/circular-pattern/pattern-feature/bolt-circle/grid-holes/holes`,
  the build123d-style **context verbs** `begin/add/subtract/intersect/finish`,
  `mass-properties/tessellate/check-validity/continuity-check`, plus weathering verbs
  `surface-wear/surface-deposit/chipped-edges` and `annotate-pmi`.
- **`asset.make-* (26):** whole standard parts in one call — `flange, bored-plate,
  l-bracket, hex-nut, hex-bolt, socket-screw, hex-standoff, ball-bearing, tslot-extrusion,
  bushing, end-cap, gusset-bracket, keyed-shaft, pipe-tee, pulley, spur-gear,
  stepped-shaft, tube, u-channel, washer`, etc. (names extracted from `ForgeToolBridge.js`).
- **`sketch.*` (6):** `create, add-point, add-line, add-circle, add-constraint, solve`.
- **`assembly.*` (7):** `add-instance, add-mate, set-fixed, solve, query-aabb,
  detect-interference`.
- **`drawing.project`**, **`manufacture.*` (4):** `cam-profile, cam-pocket, cam-drill,
  gcode`.
- **`simulate.*` (~13):** `fea-static, fea-modal, fea-dynamic, fea-thermal, fea-buckling,
  fea-fatigue, fea-nonlinear, fea-contact, cfd, dynamics-motion, multibody-dynamics,
  tolerance-stack`.
- **`gdt.*` (5):** `datum, feature-control-frame, position-relative-to-mate,
  concentric-to-mate, write-step` (PMI/GD&T annotation into AP242 STEP).
- **`heal.*` (6):** `check-validity, auto-repair, auto-fill, sew, simplify,
  harmonize-normals`.
- **`io.*` (3):** `import, export-step, export-stl`.

**Important honesty caveat — the prompt is narrower than the bridge.** The system prompt
the model actually receives (`ForgeRunner.js:48-112`, `HERMES_FORGE_SYSTEM`) lists a
*curated subset* of these ids and is explicit: "Tool ids (use these, nothing else)". So
Archie is *trained/instructed* to use a subset; the bridge can dispatch more than the
prompt advertises. The bridge↔prompt list was deliberately reconciled
(`ForgeRunner.js:42-47` documents that an earlier corpus invented non-existent ids that
died with "unknown tool id"). Today they are kept "in lockstep" by hand — **a drift risk,
not an automated guarantee.**

---

## 3. Import / export formats

### 3.1 Solid model interchange (built, kernel-backed) — `electron/preload.js`

The native kernel's I/O is exposed under `window.forge.io` (`preload.js:1273`):

| Format | Direction | Evidence | Status |
|--------|-----------|----------|--------|
| STEP (AP203/214) | import + export | `preload.js:1274-1275` | built |
| STEP + PMI (AP242) | export | `preload.js:1291-1293` `exportStepWithPmi` | built (guarded: throws if `kernel<Forge-34`) |
| BREP (OCCT native) | import + export | `preload.js:1276-1277` | built |
| STL | import + export (ASCII/binary) | `preload.js:1278-1279` | built |
| IGES | import | `preload.js:1282-1284` | built (guarded throw if absent) |
| JT | import | `preload.js:1285-1287` | built (guarded throw if absent) |
| Parasolid (x_t) | import | `preload.js:1288-1290` | **present but guarded** — `importParasolid` throws if the kernel lacks it. UNVERIFIED whether the linked OCCT build actually parses Parasolid; OCCT does not natively read Parasolid, so this is likely a **stub that throws** unless a converter is wired. Mark TODO. |

Kernel-side export verbs are real exports in the addon: `exportStep`, `exportStepWithPmi`,
`exportBrep`, `exportStl`, `importStep`, `importBrep`, `importStl`, `importIges`,
`importJt`, `importParasolid` all appear in the `forge-kernel.node` export list
(`forge-kernel/src/binding.cpp`, confirmed in the 310-symbol export enumeration).

### 3.2 Drawings / 2D / CAM (built)

- **DXF** emit — `preload.js:178` `kernel.drawings.emitDXF(views, dims)`.
- **SVG** emit — `preload.js:181` `kernel.drawings.emitSVG(view)`.
- **G-code** (CAM) — `preload.js:225-226` `kernel.cam.gcode.toGcode(toolpath, dialect, safeZ)`.
- **PDF** — surfaced as a toolbar/menu action (`io.pdf` in `Toolbar.jsx:73`; the shell
  toast at `ForgeShellV4.jsx:925` says "PDF export available from the Drawings
  workbench"). The actual PDF writer is a separate module (ASCII PDF writer per the
  no-deps rule); **not re-verified here** — TODO to confirm the PDF bytes are valid.
- **glTF publish** — workbench id `gltf-publish` (`WorkbenchRail.jsx:74`,
  `ForgeShellV4.jsx:1419-1421`). Present; output not re-verified here.

### 3.3 Archie-driven I/O (built)

`io.import / io.export-step / io.export-stl` are in the bridge (§2.2) so Archie can be
asked to export. These delegate to the same `window.forge.io.*` kernel surface.

---

## 4. Simulation surface

### 4.1 Verbs exposed (built)

UI: `sim.static/modal/dynamic/thermal/cfd` (`Toolbar.jsx:153-161`). Archie:
`simulate.fea-static/modal/dynamic/thermal/buckling/fatigue/nonlinear/contact`, `cfd`,
`dynamics-motion`, `multibody-dynamics`, `tolerance-stack` (`ForgeToolBridge.js`, §2.2).

Native kernel solver exports (from `binding.cpp` symbol list): `solveStatic`,
`solveLinearStatic`, `solveModal`, `solveDynamic`, `solveBuckling`, `solveThermal`,
`solveContact`, `solveNonlinearStatic`, `solveNonlinearPlastic`, `solveSteadyNS` (CFD),
`runMotionStudy`, `SimulateMultibodyDynamics` (`binding.cpp:5096`),
`simulateStock` (CAM material removal), `fatigueLife`.

### 4.2 What is VALIDATED vs. targeted

`FORGE_PHYSICS_VERIFICATION.md` (repo root) reports **measured** errors against
closed-form benchmarks for the built `forge-kernel.node` (binary 4.94 MB, the doc's own
header). Built & validated:

| Benchmark | Result | Status |
|-----------|--------|--------|
| Truss bar axial extension (direct stiffness) | 0.00% (exact) | **validated** |
| Frame longitudinal 1st mode | 0.0% (exact) | **validated** |
| Hex8 cantilever tip deflection | 35.2% → 12.3% → 6.0% under h-refinement | **validated as converging** (1st-order hex over-stiff in bending; monotone convergence is the real-solver signature) |
| Hex8 cantilever 1st bending freq | 24.0% (bounded, attributed §2 of that doc) | bounded/attributed |
| CFD incompressibility (∇·u→0) | ~7e-16 (machine ε) | **validated** |

Per the auto-memory ledger (`forge-physics-rigor-met-20260618`), additional gates
(static 0.33%, modal 0.2% via Wilson-Q6 de-locking, CFD channel, HHT-α multibody DAE
pendulum 0.016%) are claimed to pass. **Honest separation:** I am citing those from the
memory note, *not* re-running the harness in this task — treat the 0.016% / 0.33% / 0.2%
figures as **reported, reproducible via `node forge-kernel/test/physics_validation_harness.mjs`
but UNVERIFIED in this session.** The 5 benchmarks in the table above are quoted directly
from `FORGE_PHYSICS_VERIFICATION.md`.

### 4.3 Honest simulation gaps

- **Turbulent CFD: not built.** The CFD solver is incompressible **laminar steady**
  Navier-Stokes only (`ForgeRunner.js:109` prompt: "incompressible laminar steady
  Navier-Stokes"; memory `forge-physics-rigor-met-20260618`: "Only gap: turbulent CFD").
  No RANS / k-ε / LES. Mark as a real capability gap.
- **FEA accuracy is mesh-dependent.** Coarse-mesh hex bending under-predicts by up to
  35% (validated §4.2); users must refine. Not a defect, but a stated envelope.
- **Per-calculator panels (the ~51 calculators) are not part of the validated kernel
  physics** and are not independently re-verified here.

---

## 5. Kernel surface exposed to the UI

### 5.1 The native kernel (built)

- Binary: `forge-kernel/build/Release/forge-kernel.node` — **5,019,840 bytes**, built
  2026-06-18 (verified by `ls`). A real compiled Node-API addon, not WASM.
- **OCCT linkage:** `forge-kernel/CMakeLists.txt:36-83` finds and links **OpenCASCADE**
  (brew `/opt/homebrew/opt/opencascade`), linking TKMath, TKBRep, TKTopAlgo, TKShHealing,
  TKSTEP, etc. The CMake comment *claims* "OCCT 7.9.3" (`CMakeLists.txt:37`).
  **CORRECTION / honesty flag:** the canonical OCCT source
  (https://github.com/Open-Cascade-SAS/OCCT, fetched 2026-06-20) lists documented release
  **7.8** and latest **8.0.0_p1** — it does **NOT** list a 7.9.x release line. So the
  "7.9.3" string in our CMake comment is **UNVERIFIED against upstream and may be wrong**;
  do not cite "OCCT 7.9.3" as a public fact. What *is* true: the kernel links against
  whatever OCCT version brew installed at build time (not pinned in-repo), and the toolkit
  reorganisation the CMake handles (`CMakeLists.txt:74-83`, "OCCT 7.9 reorganises the Data
  Exchange toolkits") matches a 7.8+/8.x-era OCCT. The exact linked version is a TODO to
  confirm via `brew list --versions opencascade` on the build machine.
- **Export count:** ~310 `exports.Set(...)` / method registrations in
  `forge-kernel/src/binding.cpp` (15,555 lines; `grep -c` = 310). These cover make-prims,
  booleans, transforms, fillet/chamfer/shell/draft/rib/thread, extrude/revolve/sweep/loft,
  patterns, sketcher, assembly + mates + interference, drawings (project/section/HLR),
  CAM (pocket/drill/face-mill/5-axis/gcode), sheet metal (flange/bend/hem/unfold/flat),
  weldments, surfacing (NURBS/thicken/knit/trim/sew), healing (sew/simplify/repair/
  validity), the FEA/CFD/multibody solvers, BVH spatial queries, LOD/instanced
  tessellation, and discipline kernels (airfoil/casting/geotech/acoustics/transformer/
  transmission-line). Full symbol list extracted from `binding.cpp`.

### 5.2 The bridge to the renderer (built)

- `electron/preload.js:1580` `contextBridge.exposeInMainWorld('forge', forgeApi)` — the
  renderer sees `window.forge`. Namespaced: `window.forge.part.*`, `.sketcher.*`,
  `.assembly.*`, `.drawings.*`, `.cam.*`, `.io.*`, `.heal.*`, `.direct.*`, `.surfacing.*`,
  `.sheetMetal.*`, `.weldments.*`, `.simulate.*`, `.geotech.*`, `.casting.*`, `.airfoil.*`
  (namespace heads at `preload.js:128,162,190,266,343,348,1215,1259,1273,1310,1326,1338,
  1407,1444,1568`). Each namespace is conditionally defined (`kernel && kernel.X ? {...}`),
  so if a kernel sub-API is missing the whole namespace is absent rather than crashing.
- Single JS seam: `frontend/src/kernel/forge/index.js:18` `getForge()` resolves
  `window.forge` (throws a descriptive error outside Electron, `index.js:23-30`), and
  `isForgeReady()` (`index.js:36`) gates kernel-dependent paths. This is the one place the
  renderer touches `window.forge`; everything else imports from here.
- `frontend/src/forge-v4/kernelDispatch.js` is the v4 dispatch layer that turns toolbar
  ids into `getForge()` calls.

### 5.3 Honest kernel gaps

- **No `window.forge` outside Electron.** In dev/test (Vitest, Playwright `page.evaluate`)
  the bridge is absent; `getForge()` throws (`index.js:23`). Kernel-dependent geometry
  therefore only runs in the packaged/Electron app. This is by design but is a real
  constraint on "executes everything everywhere."
- **Parasolid import** (§3.1) is almost certainly a throwing guard, not a working reader.
- **Drift risk** between the bridge registry and the trained prompt id list (§2.2).

---

## 6. The prompt → Archie → kernel → viewport flow (built)

End-to-end, with evidence:

1. **Prompt entry.** The user types into the command bar / Archie dock in `ForgeShellV4`.
   `runArchie` builds context: it pulls a viewport caption (`VisionPerception.js`,
   imported `ForgeShellV4.jsx:24`) and prior-turn memory (`SessionMemoryClient.js`,
   `:26`), and a live selection context via `window.__forgeSelectionContext`
   (`ForgeRunner.js:328`).

2. **Runner.** `ForgeShellV4.jsx:627` calls `runForgePrompt({ prompt, maxTurns: 1,
   discipline, forge: window.forge, viewportState, priorContext, onToken, onTrace })`
   from `frontend/src/ai/ForgeRunner.js:309`. **`maxTurns: 1` is deliberate**
   (`ForgeShellV4.jsx:629-635`): the composition-trained adapter emits a complete part in
   one inference and does not emit a no-tool-call "done", so extra turns just pile on
   duplicate bodies. **Honest implication: there is no multi-turn agentic refinement loop
   in the live shell today** — it is single-shot. (`runForgePrompt` *supports* up to
   `maxTurns` turns, a gate-repair turn, and staged refinement `FORGE_STAGES`
   (`ForgeRunner.js:548-552`), but the shell caps it at 1.)

3. **Model call.** `archieComplete` (`ForgeRunner.js:213`) POSTs OpenAI-compat to
   **`http://localhost:8080/v1/chat/completions`** (`ForgeRunner.js:25,227`) with
   `adapters: 'adapters/archie/hermes_forge'` (`ForgeRunner.js:35,232`) — the local
   MLX-LM server (archdisc-Models). System prompt = `HERMES_FORGE_SYSTEM`
   (`ForgeRunner.js:48-112`). Streaming SSE is parsed token-by-token
   (`ForgeRunner.js:276-301`). **External dependency:** this requires the local mlx_lm
   server to be up; if it is down the fetch throws (`ForgeRunner.js:237-239`). Per memory
   `feedback-models-serve-restart-before-demo`, the server degrades over a long session
   and must be restarted fresh — a real operational gap, not a code bug.

4. **Parse + dispatch.** Each `<tool_call>{...}</tool_call>` is parsed
   (`ForgeRunner.js:187-205`) and dispatched via `dispatchToolCall(call, { forge, ctx })`
   (`ForgeRunner.js:420,483`) into `ForgeToolBridge.js`, which calls the matching
   `window.forge.*` native op. Speculative mid-stream dispatch fires each call as its
   closing tag lands (`ForgeRunner.js:255-269,415-424`). A **single shared per-turn
   `ctx`** (`ForgeRunner.js:414`) backs the handle-free context verbs (`part.begin/add/
   subtract/finish`) so the part accumulates into one body — this was a specifically-fixed
   bug (memory `forge-context-verb-shared-ctx`).

5. **Viewport.** `onTrace` in the shell (`ForgeShellV4.jsx:642-696`) reads each tool
   response: context verbs surface `response.current` as **one evolving body updated in
   place** (`:663-674`); make/boolean/transform ops surface `response.handle/shape`, and
   boolean/transform **consume** their source handles so the scene shows the result, not
   inputs+offcuts (`:677-696`). Bodies land in React state via `setBodies`; the shell also
   exposes `window.__forgeSetBodies` / `__forgeAppendBody` (`:296-304`).
   `forge-v4/Viewport.jsx` renders each body either by **kernel tessellation**
   (`window.forge.tessellate`, `Viewport.jsx:548-550`) or synthetic geometry, with
   instanced rendering for repeats (`:552-555`) and LOD streaming (`:557-562`).

6. **Post-build gate.** When the model stops, `_gateForge` (`ForgeRunner.js:509-527`) runs
   `forge.heal.checkValidity` on every built handle; an invalid solid can trigger one
   `AutoCorrector` repair turn (`ForgeRunner.js:451-462`). Degrades to "valid" when the
   heal surface is absent (e.g. tests).

7. **Trace.** The full trace (plan + tool calls + responses + gate) is flushed to disk
   (`ForgeRunner.js:532-540`, `ArchieTraceSink`) so nightly retrain can fold Forge
   sessions back into the dataset.

**Install seam:** `installForgeRunner` (`ForgeRunner.js:554-562`) puts `window.__forgeRun`
/ `__forgeRunStaged` / `__forgeEngine` on the window — the same `__archieRun`-style
convention Studio uses; called from `ForgeShellV4.jsx:12`.

---

## 7. Capability gaps — consolidated honest ledger

| # | Gap | Severity | Evidence |
|---|-----|----------|----------|
| 1 | Live shell runs Archie **single-shot** (`maxTurns:1`); no multi-turn agentic refinement in production path | Design limit | `ForgeShellV4.jsx:629-635` |
| 2 | **Turbulent CFD not implemented** — laminar steady only | Capability gap | `ForgeRunner.js:109`; memory `forge-physics-rigor-met` |
| 3 | **Parasolid import** likely a throwing stub (OCCT has no native Parasolid reader) | Stub/TODO | `preload.js:1288-1290` |
| 4 | Not every **toolbar id is a fully-wired kernel op** — some `sheet/weld/sim/mfg/view/measure` cases are classification/preview stubs | Partial wiring | `kernelDispatch.js:444-461, 612-632` |
| 5 | **Bridge↔prompt id list kept in sync by hand** — drift reintroduces "unknown tool id" failures | Process risk | `ForgeRunner.js:42-47` |
| 6 | Kernel only exists **inside Electron** — no `window.forge` in dev/test | Constraint | `kernel/forge/index.js:23-30` |
| 7 | Requires **local mlx_lm server @ :8080**, which **degrades over a session** and must be restarted | Operational | `ForgeRunner.js:25,237-239`; memory `feedback-models-serve-restart-before-demo` |
| 8 | Two **legacy shells/engines in tree** (`forge-app/ForgeApp.jsx` placeholder viewport; `mechanical-cad/ToolExecutionEngine.js` three.js/manifold) not on the active mount path — confusing surface area | Cleanup | `App.jsx:2`; `forge-app/ForgeApp.jsx:118`; grep (no v4 import of ToolExecutionEngine) |
| 9 | **~51 calculator panels' math not independently re-validated** in this audit (distinct from the validated kernel physics) | Unverified | `toolRegistry.js:37` |
| 10 | FEA coarse-mesh bending under-predicts (≤35%); accuracy is mesh-dependent | Stated envelope | `FORGE_PHYSICS_VERIFICATION.md §1` |
| 11 | Several non-core workbenches open via `window.__forgeOpen*` host hooks — not runtime-verified that every host mounts | Unverified | `ForgeShellV4.jsx:1296-1835` |
| 12 | **OCCT version claim "7.9.3" is unverified / likely wrong** — upstream lists 7.8 then 8.0.0, no 7.9.x release line; in-repo version not pinned | Unverified / doc error | `CMakeLists.txt:37`; github.com/Open-Cascade-SAS/OCCT (fetched 2026-06-20) |

---

## 8. Bottom line for "fully capable and more"

**Built & validated:** a real native OCCT B-Rep kernel (~310 ops, 5 MB addon; exact OCCT
version unverified — see gap #12),
exposed namespaced to the renderer through a single seam; 11 core modelling workbenches +
62 total registry entries; STEP/STEP-PMI(AP242)/BREP/STL/IGES/JT import-export +
DXF/SVG/G-code emit; an FEA/CFD/multibody physics suite with measured analytical
benchmarks (truss/frame exact, CFD incompressibility machine-ε, hex bending convergent);
and a working prompt→Archie→kernel→viewport loop driven by a local fine-tuned model with
104 dispatchable verbs, post-build validity gating, and trace capture for retraining.

**Honestly not there yet:** turbulent CFD, multi-turn agentic refinement in the live
shell, a verified Parasolid reader, full wiring of every toolbar button, automated
bridge↔prompt id sync, and independent validation of the long tail of calculator panels.
These are the concrete items the "and more" push must close — not papered over.
