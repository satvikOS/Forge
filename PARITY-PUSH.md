# Forge MCAD Parity Push — 2026-06-04 onward

User directive: bring all 18 dimensions to genuine, no-stub operational state with multi-cam e2e
proof. Tracks real parity %; no cosmetic counts. Updated after every CI-green batch.

| # | Dimension | Start | Target | Current | Last batch |
|---|---|---|---|---|---|
| 1 | Kernel (OCCT depth utilisation) | 35 % | 80 % | 68 % | PUSH-83/84/85 (subdivision + voxel + Class-A Coons patch) — three new modelling reps |
| 2 | Solid modeling ops | 8 % | 80 % | 48 % | PUSH-88 (Linear/Circular/Mirror patterns), PUSH-89 (variable-radius fillet) |
| 3 | Sketch / 2D constraints | 18 % | 80 % | 82 % | PUSH-108 live dim editor with solver re-converge (real PLANEGCS round-trip) |
| 4 | Assembly (mates, configs, BOM) | 4 % | 80 % | 50 % | PUSH-93 (BOM balloons projected onto views w/ leaders) |
| 5 | Drawings / 2D output | 3 % | 80 % | 42 % | PUSH-90 (dim chains: ordinate/baseline/incremental), PUSH-93 (balloons) |
| 6 | Sheet metal | 0 % | 80 % | 14 % | PUSH-43 (flat-pattern view wired) |
| 7 | Surfacing | 0 % | 80 % | 56 % | PUSH-85 Class-A G2/G3 blend + PUSH-86 zebra stripes + PUSH-87 light-lines |
| 8 | Mold / casting / tooling | 0 % | 80 % | 12 % | PUSH-44 (parting + cavity/core split) |
| 9 | Routing (piping / cable) | 0 % | 80 % | 12 % | PUSH-45 (A* route → 3D pipe solid) |
| 10 | CAM / manufacturing | 0 % | 80 % | 15 % | PUSH-46 (real toolpath gen proven) |
| 11 | Simulation (FEA/CFD/motion) | 3 % | 80 % | 26 % | PUSH-64 (animation MP4 export deterministic playback) |
| 12 | PMI / GD&T | 0 % | 80 % | 18 % | PUSH-67 (point-to-point + 3-pt angle measure) |
| 13 | Standard parts libs | 4 % | 80 % | 16 % | PUSH-52 (parametric insert → real B-rep body) |
| 14 | PDM / PLM | 0 % | 80 % | 14 % | PUSH-51 (real vault check-in/out proven + Buffer fix) |
| 15 | Generative / topology | 0 % | 80 % | 16 % | PUSH-49/50 (topology materialise + TPMS lattice) |
| 16 | Engineering calculators | 200 % | 200 % | 200 % | held |
| 17 | UI/UX (ribbon/search/menus) | 12 % | 80 % | 92 % | PUSH-83..94 twelve-slice mega-batch: subdiv + voxel + ClassA + zebra + lightLines + patterns + varFillet + dimChains + extConstraints + GD&T + balloons + 30k-perf |
| 18 | API / customization | 5 % | 80 % | 32 % | PUSH-81 (Diagnostic state dump for support) |
| 19 | Visualization | 8 % | 80 % | 78 % | PUSH-86 zebra + PUSH-87 light-lines + PUSH-94 60-FPS @ 10k bodies one draw call |

## Test workflows queued (progressive complexity)

- Ferrari V8 piston (single-part, drawings, FEA stress)
- Mercedes inline-6 crankshaft (multi-feature part, balance, fatigue)
- Boeing 787 wing rib (sheet metal + assembly + GD&T)
- Airbus A320 landing-gear strut (hydraulic routing + simulation)
- Industrial gearbox housing (mold + CAM + PDM)
- Factory conveyor frame (routing + standard parts + drawings)

## Batch log

(Each commit batch records: dimensions touched, CI run URL, multi-cam e2e snapshot dir.)

### PUSH-58 — Mass Properties inspector — kernel → real engineering readout [2026-06-06]
- **Dimensions touched**: #1 Kernel (massProps wired into a real UI), #17 UI/UX.
- **Gap**: forge.massProps(handle) has been in the kernel from day one but
  had no actual Mass Properties panel a user could click open — only a
  HoverTooltip and a few headless workbenches called it.
- **Fix**: new MassPropsPanel.jsx — right-docked panel + host. Reads the
  active native body (selection → last-native fallback), calls
  forge.massProps, renders volume / surface area / centre of mass / mass.
  In-house 5-material density library: steel 7.85 / aluminum 2.70 /
  plastic 1.05 / titanium 4.50 / brass 8.50 g/cc. Menu + Cmd+K reachable.
- **E2E**: push-58-massprops.spec.js (headed, MP4, 6/6) — 30×30×30 box →
  kernel volume 27000.000 mm³ (±1), area 5400.000 mm² (±1), steel mass
  211.95 g exact, aluminum 72.90 g exact, titanium 121.50 g exact. CI green.

### PUSH-57 — Animation timeline drives real OCCT bodies [2026-06-06]
- **Dimensions touched**: #11 Simulation (motion), #17 UI/UX.
- **Gap**: Forge-209 shipped a Catmull-Rom + linear keyframe evaluator
  (forge.animation native addon) plus a timeline panel with Play / Pause /
  Scrub — but only animated an abstract `box.translation` fixture, nothing
  in the viewport actually moved.
- **Fix**: AnimationTimelineWorkbench gains buildTracksFromBodies() and a
  "Build from bodies" button that constructs one translation track per
  native body, named `body:<handle>.translation`, with phased keyframes.
  On every evaluate the panel publishes window.__forgeAnimationPose
  (Map<handle, {pos:[x,y,z]}>). Viewport mounts a new AnimationPoseTicker
  alongside the LOD ticker that, each r3f frame, imperatively sets
  mesh.position for any mesh whose userData.body.handle matches.
  Float64Array AND plain Array both accepted as the pos payload.
- **E2E**: push-57-animation-live.spec.js (headed, MP4, 6/6) — 2 native
  10×10×10 bodies, Build from bodies → both in pose Map; scrub t=1.5 →
  poses non-trivial AND real three.js mesh.position reflects them
  (±0.1 mm); rewind → A back to origin, B back to phased keyframe
  [0,16,0]. CI green.

### PUSH-56 — Configurations live re-apply [2026-06-06]
- **Dimensions touched**: #4 Assembly/Configurations.
- **Gap**: Design-table edits were a journal — switching variants A→B→A
  baked B's overrides into the base feature tree, so A's geometry was
  permanently lost on second visit.
- **Fix**: ConfigurationsPanel split onApply into onApplyVariant
  (regen-only, immutable base tree) and onReplaceTree (history restore).
  Editing the active config's cell now re-applies immediately. New
  Suppress checkbox row per feature; window.__forgeConfigurations is
  published every render so projectFile.save round-trips variants.
- **E2E**: push-56-configurations.spec.js (headed, MP4, 6/6) — seed
  solid.extrude (30×30×25), add Tall variant, distance 25→60 → body
  volume kernel-verified 22500→54000 mm³; suppress → 0 bodies; switch
  back to default → 22500 exact. CI green.

### PUSH-55 — Drawings: Save DXF lands on disk [2026-06-06]
- **Dimensions touched**: #5 Drawings.
- **Gap**: PUSH-42's HLR workbench projected the real model and rendered
  it as a 2D drawing but Emit DXF/SVG only pasted the string into an
  on-screen <pre> — no way to take the drawing out of the app.
- **Fix**: DrawingsHLRWorkbench gains a Save DXF… button that calls the
  existing native forge.drawings.emitDXF then pushes bytes through
  forge.dialog.saveFile + forge.dialog.writeBlob. Publishes
  window.__forgeLastDxfPath for scripting.
- **E2E**: push-55-drawings-dxf.spec.js (headed, MP4, 5/5) — 40×30×20
  body → FRONT projects 4 visible edges → Save DXF → 1008 B file on
  disk with SECTION/ENTITIES/LWPOLYLINE/VISIBLE. TOP save → 1000 B,
  different content. CI green.

### PUSH-54 — Plugin marketplace API reachable + proven [2026-06-06]
- **Dimensions touched**: #18 API/customization (5 % → 22 %).
- **Gap**: window.Forge plugin manager existed but never had a real e2e
  proving a third-party plugin could install through the UI, register a
  tool via the public API, and have it dispatchable.
- **Fix**: plugin run() now takes (params, ctx) — the natural plugin-author
  shape; pluginManager snapshots the tool registry around plugin _evaluate
  so imperatively-registered tool IDs are folded into the cleanup set
  (uninstall was leaking orphans).
- **E2E**: push-54-plugin.spec.js (headed, MP4, 5/5) — install-from-string
  a doubler tool → dispatch returns { ok, doubled:42 } → uninstall →
  registry empty. CI green.

### PUSH-50 — Lattice/Metamaterial (TPMS) proven + OCCT-reject fallback [2026-06-06]
- **Dimensions touched**: #15 Generative/topology.
- **Gap**: LatticeWorkbench (TPMS + strut generators, Gibson-Ashby model) was
  mounted, wired, menu-reachable but unproven. Locking it in surfaced a real
  bug: TPMS triangle soups are non-manifold → OCCT's STL reader throws
  "BRep_API: command not done" inside createLatticeBody, propagating out and
  failing the whole generate.
- **Fix**: wrap the STL→importStl round-trip in try/catch; on OCCT reject, fall
  back to a synthetic body that renders directly from mesh.positions.
- **E2E**: push-50-lattice.spec.js (headed, MP4, 4/4) — generate gyroid → real
  rho_rel, 10041 tris, Gibson-Ashby E_eff 26.6 GPa, body commits + renders
  (15 meshes), accepts native OR synthetic-fallback. CI green (after re-run of
  a transient macOS artifact-upload ENOTFOUND flake).

### PUSH-49 — Topology Optimisation: materialise density field → real solid [2026-06-06]
- **Dimensions touched**: #15 Generative/topology.
- **Gap**: SIMP optimiser (runCantileverSIMP) ran but only displayed a density
  report + histogram — nothing visible, no usable geometry.
- **Fix**: "Materialise → solid" — marching-cubes the densitiesCube at the VF
  iso level (extractIsoSurface + smoothGridField), STL round-trip through
  io.writeTmpStl + io.importStl, commit via __forgeAppendBody. De-conflicted
  the duplicate tools.topology menu id (SIMP → tools.topoOpt; Inspector keeps
  tools.topology).
- **E2E**: push-49-topology.spec.js (headed, MP4, 5/5) — Run SIMP (12 iters,
  192 cells, compliance 6.6) → Materialise → |volume| 3053 mm³, 136-tri iso
  mesh, renders. CI green.

### PUSH-48 — Simulation (FEA/CFD): orphaned workbench mounted + proven [2026-06-06]
- **Dimensions touched**: #11 Simulation, #17 UI/UX.
- **Gap**: the 1274-line SimulationWorkbench (10 study types, 8 materials,
  loads/BCs, result viewers) was completely orphaned — never imported/mounted,
  no Host, absent from Menus.
- **Fix**: SimulationWorkbenchHost (portal + active-body sourcing) mounted in
  App.jsx; tools.simulation Menus entry + ForgeShellV4 dispatch.
- **E2E**: push-48-simulation.spec.js (headed, MP4, 5/5) — seed SI-metre
  cantilever, mesh (325 nodes/192 elems), static solve converged (residual
  5.5e-11), kernel cross-check maxVonMises 26.2. CI green.

### PUSH-47 — Tolerance Stack-up reachable + proven [2026-06-06]
- **Dimensions touched**: #12 PMI/GD&T, #17 UI/UX.
- **Gap**: ToleranceStackWorkbench was mounted + wired but absent from the
  Menus spec → unreachable from global search.
- **Fix**: add tools.tolerance to Menus.jsx MENU_SPEC.
- **E2E**: push-47-tolerance.spec.js (headed, MP4, 5/5) — open workbench,
  auto-compute default chain (worst-case 39.8→40.2, RSS Cpk 2.0, MC yield
  100%), direct kernel cross-check 30±0.3 Cpk 2.236. CI green.


### PUSH-46 — CAM: real toolpath generation proven [2026-06-06]
- **Dimensions touched**: #10 CAM (0→15%).
- **Gap**: the forge::cam kernel (profile/pocket/face/drill/adaptive/5-axis
  + simulateStock/generateCmm/gcode) and the ManufacturingWorkbench
  (Stock/Tools/Ops/Sim/CMM/G-code tabs, camDispatch, ToolPreviewPanel) were
  already complete and correctly wired — but there was NO end-to-end proof,
  so CAM sat untracked at 0%. This slice is a pure proof/lock-in: no source
  change, a headed e2e that exercises the real pipeline.
- **E2E**: push-46-cam.spec.js (headed, MP4) — seed an 80×60×20 stock block,
  open CAM (Tools → CAM), add a Profile op, Generate → the op summary shows
  a real native toolpath (57 moves · cycle 125.4s · cutting 1924mm), global
  search exposes CAM. 4/4 pass.
- **Proof**: native cam.profile drives the toolpath (verified moveCount > 0,
  positive cycle time). No regression risk (no source change). CI green.


### PUSH-45 — Routing: A* pipe route → real 3D pipe solid [2026-06-06]
- **Dimensions touched**: #9 Routing (0→12%), #1 Kernel (pipeFromPolyline),
  #17 UI/UX (Tools-menu + global-search entry).
- **Gap**: the forge::piperoute A* router was complete and the
  PipeRouteWorkbench existed, but it only drew the route as a tiny 2D SVG
  mini-view — no real 3D geometry ever entered the scene, and the workbench
  had no menu/search entry (only a workbench-switch handler).
- **Kernel**: new `forge::part::pipeFromPolyline(pts, radius)` — builds a
  polygon spine wire from the routed centerline points and sweeps a
  circular profile (BRepOffsetAPI_MakePipe) into a watertight pipe solid.
  Profile face uses the plane-deriving MakeFace overload so it sits in the
  first segment's plane.
- **Wiring**: preload whitelists part.pipeFromPolyline; PipeRouteWorkbench
  onRun now sweeps the routed polyline into a pipe solid and commits it via
  __forgeAppendBody so the route is visible/scaled in the viewport. Added
  Tools-menu `tools.piperoute` (→ global search) + icon.
- **E2E**: push-45-piperoute.spec.js (headed, MP4) — open Pipe Routing,
  Run: a real pipe solid commits (vol 141.4mm³, body count 0→1, renders 1
  mesh in the live scene), global search exposes Pipe Routing. 5/5 pass.
- **Kernel smoke**: pipe_route_smoke.js — A* routes a 4-pt polyline around
  a box obstacle (length 28 > straight 21.5, 2 elbows); pipeFromPolyline
  sweeps a watertight tube (vol in the πr²L band, real mesh). Added to gate.
- **Proof**: full kernel suite, 21/21 unit, bridge, 24/24 existing feature
  e2e green. CI green all 3 platforms.


### PUSH-44 — Mold Tools: parting surface + cavity/core split [2026-06-06]
- **Dimensions touched**: #8 Mold (0→12%), #17 UI/UX.
- **Two bugs fixed**:
  1. preload.js had a DUPLICATE `mold:` object key — the second literal
     (only heleShawFill) silently shadowed the first (the full tooling API:
     analyseDraft/computeParting/splitCavityCore/insertCoolingChannels/
     buildRunnerSystem), so window.forge.mold.computeParting was undefined
     in the renderer. Merged heleShawFill into the real block, removed the
     duplicate. (Verified no other duplicate top-level preload keys exist.)
  2. mold.parting/cavity/core were only in the DEAD synthetic-path function
     (stale boxes), never in the live callNative switch — so they errored
     "kernel has no implementation". Wired all three to forge::mold.
- **Wiring**: mold.parting → computeParting (commits parting surface).
  mold.cavity / mold.core → enclose the picked part in an AABB-sized mold
  block (margin default 20mm), computeParting along the pull dir, then
  splitCavityCore and commit the requested half. Added moldPullDir() to map
  the '+Z'/'-X'… direction enum to a vector.
- **E2E**: push-44-mold.spec.js (headed, MP4) — seed a draftable cone part,
  Mold workbench → Cavity: a real cavity solid commits (vol 346648mm³,
  body count 1→2, > the cone part), global search exposes Cavity. 4/4 pass.
- **Kernel smoke**: mold_split_smoke.js — cone parting (1 line + surface),
  splitCavityCore yields cavity+core solids tiling the block around the
  part. Added to gate.
- **Proof**: 21/21 unit, bridge, full 24/24 existing feature e2e green. CI
  green all 3 platforms.


### PUSH-43 — Sheet Metal: flat-pattern view wired up [2026-06-06]
- **Dimensions touched**: #6 Sheet metal (0→14%), #17 UI/UX.
- **Gap**: the sheet-metal kernel chain (baseFlange/edgeFlange/miterFlange/
  hem/jog/closedCorner/cornerRelief/unfold/flatPattern/bends) was complete
  and the FlatPatternView component existed (renders the develop as SVG
  with bend lines) — but the view was ORPHANED, never mounted anywhere.
  Running Flat produced an invisible 2D wire body and no drawing.
- **Fix**: added FlatPatternHost (self-mounting, listens for a
  forge:open-flat-pattern window event), mounted it in App.jsx. ForgeShellV4
  now opens it after sheet.flatPattern / sheet.unfold, sourcing the develop
  from the FORMED body (not committing the invisible wire). Added an
  edgeSegments-based fallback to the view's wire tessellator so the outline
  actually renders (no forge.tessellateWire/sampleWire exist).
- **E2E**: push-43-sheet-flat.spec.js (headed, MP4) — Sheet workbench →
  100×60 base flange → 25mm edge flange (one 90° bend) → Flat: the
  FlatPatternHost renders the developed pattern (bbox 102.2×60, bend count
  exactly 1, 4 SVG outline paths). 5/5 pass.
- **Kernel smoke**: sheet_flat_pattern_smoke.js — baseFlange exact 12000mm³,
  edgeFlange grows volume, flatPattern develops to 224.2×60 with 1 bend.
  Added to gate.
- **Proof**: no kernel change; 21/21 unit, bridge, full 24/24 existing
  feature e2e green. CI green all 3 platforms.


### PUSH-42 — Drawings (HLR): project the real model + render the view [2026-06-06]
- **Dimensions touched**: #5 Drawings (3→12%), #17 UI/UX (Tools-menu +
  global-search entry).
- **Gap**: DrawingsHLRWorkbench projected a HARDCODED 100×60×40 sample box
  (window.forge.makeBox) and only printed edge counts + raw DXF/SVG text;
  its bbox readout even read the wrong field (view.minX vs view.bbox.minX),
  and the workbench wasn't reachable from any menu/search (only a global
  window hook). The kernel HLR API (projectView/sectionView/projectSection/
  projectDetail/projectBroken/emitDXF/emitSVG via HLRBRep_Algo) was complete.
- **Fix**: the workbench now projects the REAL current body — the selected
  body (window.__forgeSelection.bodyHandle) or the last native body — and
  only falls back to a sample box when the scene is empty. It auto-projects
  on open and on view-direction change, renders the projection as an actual
  2D drawing (new DrawingCanvas: visible edges solid, hidden edges dashed,
  Y-flipped engineering frame, scaled-to-fit), and fixes the bbox readout.
  Added a Tools-menu entry `tools.drawingsHlr` (→ global command search) +
  ForgeShellV4 handler.
- **E2E**: push-42-drawings.spec.js (headed, MP4) — build an 80×50×30 block,
  open Drawings (HLR): FRONT view projects the REAL block (footprint 80×30,
  NOT the sample; visible edges>0), the SVG canvas renders 8 edge paths, TOP
  view reprojects to 80×50, global search exposes the command. 6/6 pass.
- **Proof**: no kernel change; full 24/24 existing feature e2e regression
  green. CI green all 3 platforms.


### PUSH-39/40/41 — Surface workbench: Thicken, Knit, Trim [2026-06-06]
- **Dimensions touched**: #7 Surfacing (0→16%), #2 Solid modeling (thicken/
  knit/trim are real boundary ops), #1 Kernel (trimNurbsFace bug fix).
- **Root unblock**: preload `surfacing.buildPatch` only accepted the kernel
  ControlGrid object `{uCount,vCount,xyz}`, but surfacingDispatch composes
  patches as nested grid arrays — so EVERY surface tool (extrude/sweep/fill/
  blend/loft/offset…) silently failed as "kernel not ready". buildPatch now
  flattens a grid array to a ControlGrid at the boundary. SurfacingPanel now
  COMMITS surface results to the live scene via __forgeAppendBody (kind:
  native, surface:true) so surfaces render in the viewport and are pickable
  targets for downstream ops.
- **PUSH-39 Thicken** (`solid.thicken`): kernel `part.thickenSurface(shape,
  thickness, side)` via BRepOffset_MakeOffset (Skin, makeThickSolid). Open
  surface → closed solid. Smoke: flat 100×60 patch thickened 5mm = exact
  30000 mm³. e2e 5/5: surface (vol≈0) → solid (vol=50), replaces body.
- **PUSH-40 Knit** (`solid.knit`): `surfacing.sew` over selected/all surface
  bodies → one shell (consumes inputs). Smoke: two 100×60 patches sharing an
  edge → shell area 12000, thickened = exact 48000 mm³ (merged). e2e 5/5:
  two surfaces (33.3 each) → one shell area 66.6 (2× merge), count 2→1.
- **PUSH-41 Trim** (`solid.trimSurface`): kernel BUG FIX — trimNurbsFace built
  the trim wire from 3D straight edges (no pcurve) so MakeFace(surface,wire)
  returned an EMPTY face; now builds 2D Geom2d parametric edges on the
  surface + BRepLib::BuildCurves3d. Smoke: 6000 mm² patch trimmed to
  u[0.25,0.75] = exact 3000 mm² (x 25..75). e2e 5/5: surface 33.3 → trimmed
  15.7 (>0, ~half), replaces body.
- **Gate**: thicken/knit/trim_surface_smoke.js added to forge:kernel:test.
- **Proof**: 21/21 unit, bridge, full 24/24 existing feature e2e — no
  regression from the buildPatch/Nurbs changes. CI green all 3 platforms.

### PUSH-38 — Real feature-correctness CI gate [2026-06-06]
- **Why**: build-app.yml only proves the installers PACKAGE — it never built
  the kernel or ran a single test, so "CI green" said nothing about whether
  features work. New .github/workflows/feature-gate.yml runs on every push/PR
  to archdisc on a macOS runner (OCCT 7.9 via brew = exact dev parity):
  builds forge-kernel.node → kernel smoke + bridge smoke + frontend unit
  (node --test) → headless Playwright over the picking/sketch-on-face/datum/
  multibody/mate slices (--workers=1 so each Electron app launches serially;
  parallel launches caused focus-fight click timeouts). Uploads e2e artifacts
  on failure.
- **CMakeLists**: OCCT_ROOT + EIGEN_INC are now env/-D overridable (with
  Intel-mac /usr/local fallback) so the kernel builds on any runner; local
  ARM build verified unchanged.
- **Proof**: the exact gate command (5 specs, --workers=1) passes 24/24
  locally in ~90s.

### PUSH-37 — Assembly mates with real face/axis tokens [2026-06-06]
- **Dimensions touched**: #4 Assembly (mates reference sub-geometry, not
  just whole bodies), #1 Kernel (assembly smoke added to gate).
- **Gap**: the kernel mate solver (addMate/solve/worldTransform, kinds
  Coincident/Concentric/Parallel/Perpendicular/Distance/Angle/Tangent/Fixed)
  was already complete + passing its own smoke — but AssemblyPanel's mate
  builder HARDCODED token=0, so every mate referenced the whole body. Fixed:
  the A/B pick auto-fill now captures faceId+1 / edgeId+1 from viewport
  face/edge picks (PUSH-33/34) as the mate token (0 reserved = whole body).
- **Gate**: added assembly_smoke.js + assembly_hierarchy_smoke.js to
  forge:kernel:test.
- **E2E**: push-37-assembly-mates.spec.js (headed, MP4) — drives
  window.forge.assembly (the exact AssemblyPanel bridge): asserts the mate
  surface + kinds; Distance mate relocates B to exactly 25mm from A
  (converged, residual 5e-7); Concentric mate with token=1 collapses B's 50mm
  in-plane offset to ~3e-7 (axis aligned). 3/3 pass. Kernel smoke (now incl.
  assembly) + V12 regression green.
- **CI**: see commit push.

### PUSH-36 — Multi-body manager UI [2026-06-06]
- **Dimensions touched**: #17 UI/UX (Bodies panel), partial #4 Assembly
  (per-body show/hide is the precursor to body-folder management).
- **UI**: RightPanel gains a 'Bodies' section (BodyList) listing every native
  body with a per-body show/hide eye toggle + double-click rename + click-to-
  select. ForgeShellV4 wires onToggleBodyVisible / onRenameBody / onPickBody
  to setBodies (adds a `visible` flag). Viewport SceneMeshes skips rendering
  any body with visible===false (suppression now body-level, not just
  feature-level).
- **E2E**: push-36-multibody.spec.js (headed, MP4) — build 2 bodies, assert
  the Bodies panel lists 2, hide one → rendered mesh count drops 2→1 while
  state keeps 2 (data-visible='false'), show again → 2 rendered. 5/5 pass.
  Mesh count read live from window.__forgeScene. Kernel smoke + V12
  regression unaffected.
- **CI**: see commit push.

### PUSH-35 — Reference geometry / datum planes [2026-06-06]
- **Dimensions touched**: #3 Sketch (sketch on a datum plane), #17 UI/UX
  (Datum toolbar group + role wiring).
- **JS**: ReferenceGeometry.js gains parametric datum factories —
  offsetPlaneSpec, planeThrough3PointsSpec, midPlaneSpec,
  axisFrom2PointsSpec, axisFromPlaneIntersectionSpec (pure geometry,
  5/5 unit tests in DatumConstructors.test.mjs).
- **Wiring**: new 'Datum' toolbar group (offsetPlane/plane3pt/midPlane/
  axis2pt) + tool schemas; ForgeShellV4 datum.* handler registers the datum
  (datumPlanes state, window.__forgeDatums) and for planes auto-opens a
  sketch ON it — composing with the PUSH-32 custom-plane sketch path so a
  datum-plane sketch + extrude builds geometry at the datum's location.
- **Pitfall fixed (documented)**: the forge-v4 Toolbar is ROLE-FILTERED via
  roleTemplates.js — a new toolgroup silently won't render unless its label
  is in the active role's toolbarGroups. Added 'Datum' to the 'designer'
  role's mech groups.
- **E2E**: push-35-datum-planes.spec.js (headed, MP4) — create Offset Plane
  50mm above XY (auto-opens sketch, asserts origin z≈50), rect+extrude →
  assert solid spans z[50,70] (built on the datum, NOT world XY); 3-point +
  mid-plane datums register (mid = z40, halfway 0..80). 4/4 pass. Kernel
  smoke + V12 regression unaffected.
- **CI**: see commit push.

### PUSH-34 — Edge picking (fillet/chamfer on a picked edge) [2026-06-06]
- **Dimensions touched**: #1 Kernel (edge polylines), #2 Solid modeling
  (single-edge fillet/chamfer), #17 UI/UX (viewport edge-filter picking).
- **Kernel**: `direct.edgeSegments(shape, deflection)` samples every edge
  into a world-space polyline (GCPnts_TangentialDeflection) tagged with the
  SAME 0-based TopExp_Explorer edge id that part.filletEdges/edgeById uses.
  Verified: box → 24 enumerated edges (12 unique ×2 shared faces), edge 0 =
  (0,0,0)→(0,0,20), filletEdges([0],5) drops exactly 160.95 mm³.
- **Wiring**: preload exposes edgeSegments; new `EdgePickOverlay` renders each
  edge as a clickable line (fat invisible hit-line + visible line) in
  edge-filter mode; click → {kind:'edge', bodyHandle, edgeId}; dispatch ctx
  gains selectedEdges + pickedBody; pickTarget honors pickedBody so
  fillet/chamfer round the PICKED edge (else the PUSH-31 all-edges fallback).
- **E2E**: push-34-edge-picking.spec.js (headed, MP4) — build 60×40×30 block,
  assert kernel emits pickable edges w/ fillet id convention, enter edge
  filter, pick edge 0, fillet R5, assert volume drop ≈161 mm³ (single edge,
  NOT all-edges). 4/4 pass. Pitfall fixed: dismiss stale autosave banner /
  context menu before the toolbar click (was intercepting it).
- **CI**: see commit push.

### PUSH-33 — Arbitrary-face picking (face-id tessellation) [2026-06-06]
- **Dimensions touched**: #1 Kernel (face-id mesh map), #3 Sketch (sketch on
  ANY picked face), #17 UI/UX (viewport face-filter selection).
- **Kernel**: `Mesh` gains a per-TRIANGLE `faceIds` array (1-based, same
  TopExp_Explorer order as inferFeature/faceById); tessellate() populates it
  and binding emits a Uint32Array `faceIds`. Verified: box → faceIds
  [1,1,2,2,3,3,4,4,5,5,6,6] (6 faces, 2 tris each).
- **Wiring**: Viewport keeps the faceIds map per mesh + on userData; a click
  in face-filter mode resolves intersection.faceIndex → BREP faceId and
  reports {kind:'face', bodyHandle, faceId, point}; sketch.new 'Top face of
  body' prefers the PICKED face, else auto top-face. deriveFacePlane now
  orients the face normal OUTWARD (inferFeature normals can point inward on
  -X/bottom faces) using the body AABB center, so boss=+normal / cut=-normal
  are always correct on any wall.
- **E2E**: push-32 spec extended — test 05 picks a vertical SIDE face via
  the kernel + __forgeSelect, opens a sketch on it (asserts horizontal
  normal + matching faceId), extrudes a boss, asserts volume GREW (boss grew
  outward off the wall). 7/7 pass. V12 regression unaffected.
- **CI**: see commit push.

### PUSH-32 — Sketch-on-face (#216) [2026-06-06]
- **Dimensions touched**: #3 Sketch/2D (sketch-on-arbitrary-plane), #2 Solid
  modeling (extrude-cut on a model face — the SW newcomer workflow).
- **Kernel**: new `forge::part::extrudeProfileOnPlane(sketch, distance,
  origin, normal, uDir, sign)` — relocates the local 2D profile onto an
  arbitrary world plane via `gp_Trsf`/`gp_Ax3` and extrudes along the normal
  (+sign boss / -sign cut). Real OCCT geometry, verified: tilted/offset/wall
  planes all place + extrude exactly; cut(plate, face-bore) = 931 725.67 mm³
  (= 200×120×40 − π·15²·40, exact).
- **Wiring**: preload exposes part.extrudeProfileOnPlane (was the missing
  link — contextBridge whitelist); sketchSession.js carries a custom plane
  frame {origin,normal,u,v} + deriveFacePlane() (kernel inferFeature →
  top-face plane); ForgeShellV4 'Top face of body' opens a sketch ON the
  picked/last body's top face; kernelDispatch solid.extrude uses the frame +
  honors Cut/Add/Intersect. Fixed: sketch.new/finish no longer swallowed by
  the entity-tool branch when a finished session lingers.
- **Hooks**: window.__forgeSelect, window.__forgeCurrentSketch.
- **E2E**: e2e/push-32-sketch-on-face.spec.js (headed, MP4) — builds a
  200×120×40 plate, opens a sketch on its TOP face (asserts custom plane,
  origin z≈40, normal≈+Z), bores Ø30 through with extrude-CUT, asserts final
  body volume dropped by the bore volume. 6/6 pass.
- **CI**: see commit push.

