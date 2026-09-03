# REFERENCE VIDEO BAR

What six reference CAD videos actually demand, measured against what Forge's
command surface actually holds today.

The videos are **not** in this repo and must not be added to it. They were read
from `~/Downloads/` on the machine that produced this document. Every claim
below about Forge cites a file, a generated artifact, or a grep that anyone can
re-run from this tree.

---

## 0. Provenance and method

Six files, confirmed present, probed with `ffprobe`:

| file | duration | resolution | fps | audio |
|---|---|---|---|---|
| `Video-3097.mp4`  | 11.20 s | 720×1280 | 30 | aac |
| `Video-41710.mp4` | 64.83 s | 720×720  | 30 | aac |
| `Video-43612.mp4` | 25.73 s | 720×1280 | 30 | aac |
| `Video-50455.mp4` | 47.88 s | 720×1280 | 30 | aac |
| `Video-61709.mp4` | 17.55 s | 720×1280 | 30 | aac |
| `Video-99642.mp4` | 15.14 s | 720×1280 | 30 | aac |

```
ffprobe -v error -show_entries format=duration -show_entries \
  stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames \
  -of default=noprint_wrappers=1 ~/Downloads/Video-<id>.mp4
```

Frames were extracted at 1 fps (`ffmpeg -vf fps=1`, 182 frames total) into a
scratch directory and **read as images**, not inferred from filenames. Roughly
40 of the 182 were read in full; the rest were skipped once a video's content
was unambiguous. Where UI chrome was too small to read, the strip was cropped
and upscaled 3× with lanczos before reading (this is how the CATIA V5 View
toolbar in `Video-99642` was identified).

**What this method cannot see.** 1 fps misses a click that opens and closes a
dialog inside one second, and it misses the exact ordering inside a fast
feature-tree build. Where a claim below depends on something I could not read at
1 fps, it says so.

### Forge's measured surface (the baseline every verdict is against)

```
$ grep -v '^#' implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv | grep -c .
80
$ grep -v '^#' implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv | cut -f2 | sort | uniq -c | sort -rn
  58 Part
  12 View
   4 File
   3 Edit
   3 Application
$ python3 -c "import json;print(json.load(open('implementation/sacrosanct/archie_op_vocabulary.json'))['counts'])"
{'kernel_ops': 56, 'ui_validator_ops': 56, 'registry_commands': 80,
 'commands_emitting_ir': 57, 'user_invocable_ops': 53, 'forbidden_ops': 3, ...}
```

**Correction to the brief this work was given.** The brief said "87 commands"
and "2 forbidden ops". Both generated artifacts at `origin/archdisc` (75d612c8)
say **80 registry commands, 53 user-invocable ops, 3 forbidden ops**
(`ARC`, `HELIX`, `SLOT` — each compiled into the kernel, none emitted by any
registered command). Numbers below use the measured 80/53/3.

The 53 ops a user can reach, in full:

```
BLEND BOX CAP CBORE CHAMFER CIRCLE COMMON CON CONE CUT CYL DEFEATURE EXTRUDE
FACES FILLET FOLD FUSE HEAL HOLE INPUT LOFT MIRROR PATTERN POLY PRISM PUSHFACE
RECT REGPOLY RESIZEBORE REVOLVE RING ROTATE RRECT SARC SCIRC SECTION SEW SHELL
SKETCH SKIN SLINE SOLVE SPHERE SPT SURFCHECK SWEEP TAG THICKEN TORUS TRANSLATE
TUBE VERIFY WIRE
```

The kernel's whole feature-tree op enum is 56 entries plus `Unknown`
(`forge-kernel/include/forge/ft/FeatureTree.hpp`). So 53 of 56 is not "the UI
exposes a slice of a big kernel" — **the IR itself is 56 ops wide, and that is
the ceiling for both a Forge user and for Archie.**

---

## 1. Per-video: what each one demands

### `Video-3097` — Fable 5.1 turning a drawing into CAD on SolidWorks
*Neural Node (@neural_node). SolidWorks, `MBD Dimensions` ribbon tab active.
Title-block reads "Hugging Face / Mecado".*

The reference video most directly on Archie's thesis. Read at 1 fps the
sequence is:

1. **Input**: a complete 2D engineering drawing sheet — front view with full
   dimension chains, two section/detail views, a side view, a shaded isometric,
   revision block, title block, "THIS PART IS NOT INTENDED FOR MANUFACTURING".
2. A fresh `Part1` with only `History / Sensors / Annotations / Material
   <not specified> / Front Plane / Top Plane / Right Plane / Origin`.
3. `(-) Sketch1` on the Front Plane (under-defined — the leading `(-)`).
4. Extrude → `Solid Bodies(1)`.
5. The tree then grows, feature by feature, to 20+ entries with **semantic,
   convention-following names**, legible in the frames:
   `body_base`, `boss_ear_lr`, `cut_pad_pocket_c`, `cut_bore`, `cut_foot`,
   `hw_bolt_15`, `boss_lug`, `hw_lug_cbore`, `pl_cbore_a`, `hw_cbore_a_d56`,
   `pl_flank_l`, `hw_web_u_d26`, `hw_web_u_d155`, `hw_web_cbore_15p5`,
   `hw_web_t_d155`, …
   The prefixes are a scheme: `body_`/`boss_` additive, `cut_` subtractive,
   `hw_` hole-wizard-class features, `pl_` reference planes; the suffixes carry
   the driving diameter (`d56`, `d155`, `15p5`).
6. Intermediate frames show sketches placed on **newly created reference
   planes**, not just the three origin planes.
7. Output: a shaded solid — oval bore, ~30 bolt holes, counterbores, ribbed
   webs, a mounting foot, a boss with a threaded-looking cylindrical feature.

**Demands**: read a multi-view dimensioned drawing sheet → emit a 20+ feature
history whose features are *named for what they are*, on planes it created
itself, with holes/counterbores placed from the drawing's dimension chains.

### `Video-61709` — A380 surface model in SolidWorks
*SolidWorks 2024 SP1.0 Premium, part `A380 mega`, status bar cycling
`Editing Part` / `rebuild…` / `Generating graphics`.*

A capability showcase, not a tutorial: the camera flies around a complete
airliner built as one part. Feature tree (partly occluded by the vertical crop)
is dominated by `Surface1 … Surface8`, `…-Surface1/2/3/5/6`, `Blade1 … Blade14`.
The Surfaces ribbon is fully visible and readable:

> Swept Boss/Base · Lofted Boss/Base · **Boundary Boss/Base** · Extruded Cut ·
> Hole Wizard · Revolved Cut · Swept Cut · Lofted Cut · **Boundary Cut** ·
> Fillet · Linear Pattern · **Rib** · **Draft** · Intersect · Shell · Wrap ·
> Mirror · Reference Geometry · **Curves** · Instant3D

Tabs present: Markup, Evaluate, MBD Dimensions, SOLIDWORKS Add-Ins, Simulation,
MBD, SOLIDWORKS CAM, Analysis Preparation, SOLIDWORKS Visualize, Flow Simulation.

**Demands**: free-form surfacing (lofted/swept/**boundary** surfaces driven by
guide curves), a curve toolset to drive them, patterned blade geometry, and a
renderer that holds a part of this face count with reflections and a ground
plane.

### `Video-43612` — 6-axis robot arm assembly + drawing, SolidWorks
*SolidWorks 2024, Educational Product watermark on the sheet.*

Two halves.

**Assembly.** Ribbon reads: Insert Components · Smart Fasteners · Move
Component · Show Hidden Components · Assembly Features · Reference Geometry ·
New Motion Study · **Bill of Materials** · **Exploded View** · Instant3D ·
Update SpeedPak Subassemblies · Take Snapshot · Large Assembly Settings.
Actions read from frames:
- an **exploded view** animation — components separate along their assembly axes
  and re-collapse;
- **dragging a link and watching the whole kinematic chain follow** — the arm
  changes pose between frames while the status bar reads `Under Defined`;
- a gripper whose two spur gears **stay meshed** while the fingers open/close,
  and whose status reads `Fully Defined` (a gear mate);
- live measurement readouts in the status bar: `Arc Length: 47.07mm`,
  `Radius: 298.07mm  Center: 302.07mm,60mm,0mm`.

**Drawing.** A dimensioned sheet with a zoned border (8…1), two views plus an
isometric, **balloons 1–11**, a **BOM table** with columns ITEM NO. / PART
NUMBER / DESCRIPTION listing `base, waist, servomotor, Arm, Arm2, Servo_model,
Arm3, gripper_base, Gripper_gear, Connecting_Link, gripper_link`, a title block
(`Final_Asse…`, SCALE 1:5), a tolerance block ("UNLESS OTHERWISE SPECIFIED:
DIMENSIONS ARE IN MILLIMETERS…"), and dimensions `⌀98.00`, `⌀119.25`, `⌀121.x`,
`190.71`, `243.91`, `218.90`, `60.00`, `9.00`.

**Demands**: components with mates, a solved kinematic chain draggable in the
viewport, gear mates, exploded views, and a 2D drawing generator with balloons
and a BOM bound to the assembly.

### `Video-50455` — SOLIDWORKS "LEO" AI assistant (official Dassault Systèmes)
*Ends on a full-screen card: `DISCOVER MORE : solidworks.com/ai`,
`©2026 Dassault Systèmes`, plus a demonstration-only disclaimer. Panel titled
`Virtual Companions (Beta)`. Presenter in a 3DS SOLIDWORKS polo.*

**This is the closest competitor to Archie, and the most important video here.**
An agent docked *inside* SolidWorks, working on an excavator assembly
(`D_SW-02716.SLDASM`) and a hydraulic motor (`SW-02242`). Read from frames:

- LEO produces a **ranked diagnostic report** titled "Optimize Assembly
  Performance", whose items are grounded in *the live document's own telemetry*:
  > "4. High Rebuild Time for Fasteners — The component **M16 x 40 (SWPT
  > THRDS)-3** has the highest rebuild time of **0.579 seconds**, which is
  > disproportionately high for a fastener."
  > "5. High Graphics Complexity in Sub-Assemblies — The sub-assembly
  > **SW-02251** has a high triangle count of **60,648**…"
  Each item is structured **Action:** / **Result:**.
- LEO **asks a clarifying question before acting**: "should this be a
  **top-level SpeedPak** (a derived configuration under the active assembly) or
  a **sub-assembly SpeedPak** (a full, reusable configuration inside a
  sub-assembly file)?"
- The user answers in fragments — `mated`, then
  `do this for all selected sub-assemblies` — and LEO **executes**:
  > "generating Speedpak for selected subassemblies"
  > "The mated SpeedPak configuration has been successfully created for
  > "D_SW-02988", "D_SW-02831", "D_SW-02847", "D_SW-02853", "D_SW-02970",
  > "D_SW-03103", "D_SW-02838". It is now available in the Configuration
  > Manager."
- LEO **renames its own conversation topic** ("Updated the topic of the
  conversation to: Optimize Assembly Performance").
- The next typed instruction, mid-keystroke, is
  `remove all threads from threaded comp…` — a bulk geometric edit stated in
  English.
- The panel carries a persistent honesty line: "LEO may display inaccurate
  information. Please check the answers."
- Status bar shows a `Performance Assistant:` readout and a `MMGS` / `Custom`
  unit selector.

**Demands**: an in-app agent that (a) reads the document's *performance* metadata
as well as its geometry, (b) writes a ranked, evidence-cited report, (c) holds a
multi-turn conversation and asks before acting, (d) executes a real modelling
operation across a named set of components, and (e) reports exactly what it
changed.

### `Video-99642` — Volvo FH truck DMU in CATIA V5
*Phone camera pointed at a RedmiBook screen; Chinese-locale taskbar. Product
identified from the bottom View toolbar (cropped and upscaled 3×) and CATIA's
signature blue radial-gradient background: fly/walk mode pair, Multi-View,
Camera, Apply Scene, Measure Between, Measure Item, Measure Inertia (yellow
cylinder), Quick Update, Shading-with-Edges, Enhanced Scene Rendering, Depth
Effect, Hide/Show, Apply Material.*

Pure large-assembly navigation of a **complete tractor unit**: cab exterior with
a modelled `VOLVO` grille badge and mesh grille, mirrors, doors, rear cab wall;
full interior — steering wheel, dashboard with individual switch banks, seats,
pedals, floor mat, wiper linkage; chassis frame with individual rivets, air
tanks, fifth wheel; powertrain — inline-6 with individual injector lines,
turbo, exhaust, radiator pack, hoses and wiring; wheels with tread and hubs.
Every part carries its own colour. Rendering is shading-with-edges. A rotation
indicator ellipse appears while orbiting; a section/clipping curve is visible in
several frames (too small at 1 fps to confirm which tool).

**Demands**: hold and navigate an assembly of this size at interactive rates,
per-instance appearance, shading-with-edges, and section/clipping through it.

### `Video-41710` — race-car chassis in Autodesk Fusion
*Autodesk Fusion, DESIGN workspace, SOLID tab. Windows taskbar clock
`10:18 PM 5/28/2026`.*

Two documents open as tabs (`100534`, `100589`). The `100534` BROWSER reads:
`Document Settings · Named Views · Origin · Analysis · Relationships ·
Sketches · Construction`, then instances `100508:1`, `LMSC-Body-09022024:1`,
`100254:1`, `100328:1`, `100328:2`, `Blockv8_4_6:1`, `100584:1`, `100585:1`,
`100586:1`, `100589:1`, `100625:1` — every one carrying a **chain-link icon**
(an external/linked reference to another document). `100589` is one of those
links, opened in its own tab, and contains `PWB-12T-RACE:1`, `100587:1`,
`PWB-12T-RACE:2`, `100307:1` — an A-arm/wishbone sub-assembly.

Ribbon tabs: SOLID · SURFACE · MESH · SHEET METAL · PLASTIC · MANAGE ·
UTILITIES, with CREATE / MODIFY / ASSEMBLE / CONFIGURE / CONSTRUCT / INSPECT /
INSERT / SELECT / POSITION groups. A **parametric timeline** runs along the
bottom with ~60 feature icons; a `TEXT COMMANDS` drawer and a `COMMENTS` pane
are docked.

The model: a tubular/box-section space frame with engine block (bores and head
face visible), coil-overs, A-arms, vented brake rotors, hubs with studs, axle
shafts. At 1 fps this video is navigation and browser inspection; **I did not
observe a feature being created or edited** — the document title does gain a
dirty marker (`100534*`) partway through, so *something* changed, but I could
not read what.

**Demands**: multi-document assemblies with **linked external components** and
instance numbering, a component browser separate from the feature timeline, an
ordered editable timeline, and workspace tabs that switch the whole command set.

---

## 2. Consolidated capability table

One row per capability the videos demand. "Evidence" is how the verdict was
checked, not an opinion.

| # | Capability | Demanded by | Forge | Evidence |
|---|---|---|---|---|
| 1 | Read a **STEP/neutral file** into the app | 99642, 41710, 43612, 50455 (every one starts from data Forge cannot ingest) | **no** | 0 of 80 rows in `APP_SURFACE_MANIFEST.tsv` match `step\|iges\|stl\|import\|export`. `file.open`/`file.save` call `loadPartFile`/`savePartFile`, i.e. `.fpart` only (`forge-desktop/src/ForgeFrame.cpp:543`, `PartFile.hpp`). The kernel *does* have `forge::io::importStep/exportStep` (`forge-kernel/include/forge/IoExchange.hpp:24,38`) and a passing `forge-desktop/step_probe.cpp`; **nothing in `ui/` or `forge-desktop/src/` calls either** (`grep -rnE 'importStep\|exportStep\|\.stp\|ISO-10303' ui/src forge-desktop/src` → one comment line, zero call sites). |
| 2 | Bind an imported solid as the start of an edit | 3097, 50455 | **partial** | `part.input_solid` is registered and emits `INPUT` (`APP_SURFACE_MANIFEST.tsv`; `ui/src/PartCommands.cpp:1820`). It takes **no parameter** — `INPUT()` is the whole signature — so the app can *state* "start from the input solid" and cannot *say which file*. Per row 1 there is no path by which a file could be bound. |
| 3 | **Native file dialog** | all six (implicitly) | **no** | No `NFD`/`tinyfd`/`GetOpenFileName`/`NSOpenPanel` anywhere outside an ImGui doc comment. `file.open` declares `path` required with `hasDefault=false`, so `ForgeFrame::invoke` returns `needsParameters()` and opens an ImGui text-field prompt the user types a path into (`forge-desktop/src/ForgeFrame.cpp:664–700`). |
| 4 | **Components / instances / assembly** | 43612, 99642, 41710, 50455 | **no** | 0 rows in the manifest match `assem\|component\|mate`. There is **no component op in the 56-entry kernel IR enum**, so no command can create or address one. *Correcting my own first reading:* `EntityKind` (`ui/include/forge/ui/Types.hpp:21`) **does** contain a `Component` value — the full list is `None, Vertex, Edge, Face, Body, Sketch, SketchCurve, Wire, Surface, OpenSketch, SketchRef, Feature, Component, Datum, Any`. But no command's selection signature names it: `grep -rn 'EntityKind::Component' ui/ forge-desktop/` returns 4 hits, all of them exhaustive round-trip kind lists (`Types.cpp:26`, `DocumentModel.cpp:83`, `OpConstraintBridge.cpp:59`, `ActivityLog.cpp:177`), and the string `component` appears **0 times** in `archie_op_vocabulary.json`. It is a spelling with no referent. |
| 5 | **Mates** and a solved kinematic chain | 43612 (drag-the-arm, `Under Defined`) | **no** | 0 manifest rows match `mate`. The `mates` panel id exists in the Assembly workspace (`ui/src/WorkspaceProfile.cpp:85`) but falls through to `drawGenericPanel`, which renders the literal text *"its content is not implemented in this segment"* (`forge-desktop/src/ForgeFrame.cpp:3049`). |
| 6 | **Gear mate / mechanism coupling** | 43612 (meshed gripper gears) | **no** | Subsumed by row 5; no mate of any kind exists. |
| 7 | **Exploded view** | 43612 | **no** | 0 manifest rows match `explod`. No op in the kernel enum. |
| 8 | **Bill of materials** | 43612 | **no** | 0 manifest rows match `bom`. `bom` is a declared Assembly-workspace panel id → `drawGenericPanel`. |
| 9 | **2D drawing sheet** with views | 43612, 3097 (input side) | **no** | 0 manifest rows match `drawing`. The Drawing workspace exists (`WorkspaceProfile.cpp:98`) but its `sheet_canvas` panel is routed to **the 3D viewport** — `isViewportPanel()` returns true for `sheet_canvas` (`forge-desktop/src/ForgeFrame.cpp:89–91`). Its `sheet_tree` panel draws the *part* feature tree (`ForgeFrame.cpp:1904`). The Drawing ribbon category is empty: the manifest has categories `Part(58) View(12) File(4) Edit(3) Application(3)` and no `Drawing`. |
| 10 | Dimensions, balloons, GD&T, title block | 43612 | **no** | 0 manifest rows match `dimension\|annot`. `annotation`, `gdt`, `title_block`, `view_list` are all declared panel ids that reach `drawGenericPanel`. |
| 11 | **Reading a dimensioned drawing as input** | 3097 (the whole premise) | **no** | `ArchieCopilot.hpp` has no image, pixel, raster or drawing input of any kind (`grep -in 'image\|png\|jpeg\|drawing\|vision\|pixels'` → 0 hits). `PlanRequest` carries `intent` text and the live tool list; there is no second channel. |
| 12 | **In-app conversational agent** | 50455 (LEO), 3097 (Fable) | **partial** | The architecture is real and is the strongest thing Forge has here: `ArchieCopilot` takes intent → `Plan` → the user presses Apply → `ForgeShell::run(id, params)` → registry dispatch, with **no second path to the kernel** (`ui/include/forge/ui/ArchieCopilot.hpp`). `deliver()` refuses a plan naming an unregistered command, an op the command does not emit, an undeclared parameter, or a missing required one; `OpConstraintBridge::checkValue()` additionally validates every *value* (the selector-injection hole). The `archie_copilot`/`archie_chat` panels are implemented (`ForgeFrame.cpp:1921`). |
| 13 | An agent that is actually a **model** | 50455, 3097 | **no** | `forge::ui` opens no socket by construction; the shipped planner is `LocalPlanner`, a keyword matcher. Its verb table is **31 words → 21 distinct command ids** (`ui/src/ArchieCopilot.cpp:229–272`): extrude, pad, revolve, loft, skin, thicken, cap, sew, surfcheck, faces, fillet, round, chamfer, bevel, variable, blend, shell, hollow, hole, drill, bore, counterbore, cbore, mirror, pattern, array, grid, circular, polar, undo, redo. **No sketch command, no primitive, no boolean, no move/rotate is reachable from it** — 21 of 80 registry commands. |
| 14 | Agent **asks a clarifying question** before acting | 50455 | **no** | `PlanResponse` is a plan or a refusal; there is no question turn in the type. The panel's only interaction is Apply / Reject (`ForgeFrame.cpp:3040–3047`). |
| 15 | Agent writes a **ranked diagnostic report** citing document telemetry | 50455 | **no** | Nothing in `ui/` computes per-feature rebuild time, per-component triangle counts, or open time. The Archie workspace's `verify_report` panel id → `drawGenericPanel`. |
| 16 | Agent acts across **a named set of components** | 50455 | **no** | Requires row 4. A `Plan` targets a single document's SSA values via `PlanSelect` (`Keep/None/LatestProfile/LatestSolid/LatestWire`). |
| 17 | **Feature history with persistent semantic names** | 3097 (`hw_web_cbore_15p5` etc.) | **partial** | `part.tag_feature` emits `TAG(name, selector)` and binds a name to a face by signature so it survives index-permuting edits (`ui/src/PartCommands.cpp` TAG section); `FeatureRecord` carries a `label` and the authoring command id, and `drawTimelinePanel` prints `%%id label command statement` per row (`ForgeFrame.cpp:2637`). What is missing versus the video is that **nothing names features automatically** — the video's tree is 20+ *meaningfully* named features, and Forge's labels come from the command that ran. |
| 18 | **Ordered timeline / rollback** | 41710 (Fusion timeline), 3097 | **partial** | The `timeline` panel is implemented and lists every statement with its build state, and the document is an ordered SSA record list. It is **read-only**: `drawTimelinePanel` renders text, no drag, no roll-back bar, no reorder. `part.edit_feature` exists and can change one numeric value of one feature. |
| 19 | **Sketch with constraints and a solver** | 3097, 43612 | **yes** | `part.sketch_new` (SKETCH), entities `SLINE/SARC/SCIRC/SPT`, `part.sketch_constrain` + `part.sketch_constrain_single` (CON), `part.sketch_solve` (SOLVE), plus closed-form profiles `RECT/RRECT/CIRCLE/POLY/REGPOLY` — all in the manifest. |
| 20 | **Spline / free-form sketch curve** | 61709 (Curves), 41710 | **no** | The 56-op kernel enum has `SLine SArc SCirc SPt` and no spline entity. B-spline machinery exists in the kernel for *import and surfacing* (`OcctImport.hpp`, `Airfoil.hpp`) but is not an IR op, so no command can emit it. |
| 21 | Extrude / revolve / sweep / loft | 61709, 3097, 41710 | **yes** | `part.extrude` (EXTRUDE), `part.revolve` (REVOLVE), `part.sweep_pipe` + `part.sweep_profile` (SWEEP), `part.loft` (LOFT), `part.skin` (SKIN). |
| 22 | **Boundary / guide-curve** surfaces | 61709 (Boundary Boss/Base + Boundary Cut are the ribbon's headline) | **no** | No `Boundary` op in the kernel enum. `part.loft` takes only `ruled` and `open` flags — no guide curves. `forge-kernel/include/forge/LoftGuide.hpp` **exists** and offers guide-curve lofting, and **no IR op reaches it**, so it is invisible to both a Forge user and to Archie. |
| 23 | **Draft** | 61709 (ribbon), and every moulded/cast part in 99642 | **no** | No `Draft` op in the kernel enum. `forge::draftFaces(...)` exists as a kernel API (`forge-kernel/include/forge/Features.hpp:192`) and, like LoftGuide, is unreachable through the IR. **This is a registry/IR gap, not a kernel gap.** |
| 24 | **Rib**, **Wrap**, **Intersect** | 61709 (ribbon) | **no** | No `Rib`, `Wrap` or `Intersect` op in the kernel enum. (`part.boolean_intersect` emits `COMMON`, which is a boolean of two solids, not SolidWorks' Intersect tool.) |
| 25 | **Threads** | 50455 ("remove all threads from threaded comp…"), 43612 fasteners | **no** | No `Thread` op in the kernel enum; the only `thread` hits in kernel headers are OS threading and bolt *analysis* (`BoltedConnection.hpp`). |
| 26 | Hole / counterbore as first-class features | 3097 (`hw_*` features), 43612 | **yes** | `part.hole` (HOLE) with diameter/x/y/z/depth and `part.counterbore` (CBORE) with diameter/cbore_diameter/cbore_depth. No countersink, no tapped/threaded hole, no hole *wizard* standards table. |
| 27 | Fillet / variable fillet / chamfer / shell | 61709, 3097 | **yes** | `part.fillet` (FILLET), `part.variable_fillet` (BLEND), `part.chamfer` (CHAMFER), `part.shell` (SHELL). |
| 28 | Linear / circular / grid patterns | 3097 (bolt circles), 61709 (blades) | **yes** | `part.pattern_linear`, `part.pattern_circular`, `part.pattern_grid` — all emit PATTERN. |
| 29 | **Sheet metal** | 41710 (SHEET METAL tab) | **partial** | `part.fold_flange` emits `FOLD` with hinge/length/flange_height/thickness/angle. That is one bend. No flat pattern, no unfold, no relief, no gauge table. |
| 30 | **Configurations / SpeedPak / suppression** | 50455 (the operation LEO performs) | **no** | 0 manifest rows match `config`. `FeatureState` has a `Suppressed` value (`ForgeFrame.cpp:93`) but no command sets it. |
| 31 | **Measure** (distance, angle, arc length, radius, mass props) | 43612 (status-bar readouts), 99642 (CATIA measure toolbar) | **partial** | The `measure` panel is implemented and reports bbox size/min/max/diagonal, surface area, triangle and face counts, recovered edge count, and — only when watertight — volume and centroid, refusing to print a volume for an open mesh (`ForgeFrame.cpp:2691–2735`). `MeasureModel.hpp` also computes face-pair `centreDistance` and `angleDegrees`. **There is no measure *command***: 0 manifest rows match `measure`, so it is a passive panel, not a tool a user invokes on a picked pair, and there is no arc-length or radius readout. |
| 32 | **Section / clipping view** | 99642 | **no** | The three `section` manifest rows are `part.section_curve` (SECTION), `part.section_ring` (RING) and `part.section_wire` (WIRE) — feature-tree ops that *produce profile/wire geometry*, not a viewport clip plane. No display-clipping command exists. |
| 33 | **Per-part appearance / materials** | 99642 (every part its own colour), 61709, 50455 | **partial** | `ui/include/forge/ui/Material.hpp` declares `Appearance`, `Material` and `MassProperties`. There is **no command**: 0 manifest rows match `material` or `render`, and the `appearance` panel id (Part workspace) and `materials` panel id (Simulation workspace) both reach `drawGenericPanel`. |
| 34 | Display modes beyond wireframe (shaded-with-edges, hidden line) | 99642, 43612, 61709 | **partial** | `view.wireframe` is the only display-mode command in the manifest — a boolean toggle (`ui/src/ForgeShell.cpp:338`). The 11 other `View` commands are camera orientations (front/back/left/right/top/bottom/iso/fit/selection) and panel focus. |
| 35 | Orbit / pan / zoom at large-assembly scale | 99642, 41710, 61709 | **partial** | Navigation is implemented with four selectable input profiles (`ForgeNative`, `NXLike`, `CATIALike`, `BlenderLike` — `Keymap.hpp:24`) and orbit/pan/zoom verbs (`ForgeFrame::drawViewportPanel`, `navVerbFor`). Whether it *holds* a truck-sized assembly is untestable while rows 1 and 4 stand — there is no way to get such an assembly into the app. **Not measured.** |
| 36 | Direct manipulation of geometry in the viewport (Instant3D) | 61709, 43612, 41710 | **partial** | `ui/src/Manipulator.cpp` implements a manipulator with translate/rotate snapping, and `part.push_face` (PUSHFACE) and `part.move`/`part.rotate` exist as commands. This is push-a-face direct editing; it is not Instant3D's drag-any-dimension-handle. |
| 37 | **Workspace tabs that switch the command set** | 41710 (SOLID/SURFACE/MESH/SHEET METAL/PLASTIC), 61709, 50455 | **partial** | Eight workspaces exist — part, sketch, assembly, surface, manufacturing, drawing, simulation, archie (`ui/src/WorkspaceProfile.cpp:16–23`) — each with its own ribbon category. **Seven of the eight workspaces add nothing to their ribbon**: every workspace always gets `Application`+`Edit`+`File`+`View` (3+3+4+12 = 22 commands), and only the Part workspace's extra category is non-empty. The manifest's only categories are Part(58), View(12), File(4), Edit(3), Application(3), so the categories `Sketch`, `Assembly`, `Surface`, `Manufacturing`, `Drawing`, `Simulation`, `Model` and `Archie` — pushed by `WorkspaceProfile.cpp:134–142` — name **zero commands each**. |
| 38 | Docked panels that show something | all six | **partial** | Across the 8 workspaces there are **50 distinct panel ids**, of which **27 fall through to `drawGenericPanel`** and render the sentence "its content is not implemented in this segment" (computed from `WorkspaceProfile.cpp:74–116` against the `drawPanel` dispatch at `ForgeFrame.cpp:1901`). Per workspace: part 1/8, archie 1/8, sketch 4/8, assembly 4/8, surface 4/8, manufacturing 4/8, drawing 5/8 (plus `sheet_canvas` showing the 3D viewport), simulation 5/8. Seven distinct tree panel ids (`feature_tree, model_browser, sketch_tree, assembly_tree, operation_tree, study_tree, sheet_tree`) all draw **the same single-part feature tree**. |
| 39 | Undo / redo over every edit | all | **yes** | `edit.undo` / `edit.redo` drive one real stack (`partUndo_`), and every Part command declares `undo=transaction` in the manifest. |
| 40 | Build-state feedback on a failing feature | 3097 (rebuild), 61709 (`rebuild…`) | **yes** | `IrBuildReport` carries `failedOpId`/`failedLine`; the timeline marks the offending statement `ERR` and the rest `OK` (`ForgeFrame.cpp:2646–2656`). `part.verify` (VERIFY) and `part.surfcheck` (SURFCHECK) let a program assert its own result. |

**Tally: 8 yes · 15 partial · 17 no.**

---

## 3. Ranked gaps — what most blocks a user doing what the videos show

Ranked by *how many of the six videos become impossible* and by *how much else
is blocked behind the gap*, not by implementation cost.

**1. No file interchange — the app cannot be given a solid (table row 1).**
Four of six videos begin with geometry that came from somewhere else, and the
fifth (3097) begins with a drawing. Forge reads only `.fpart`, its own format,
so *there is no way to put an existing part in front of it at all*. This also
strands row 2: `INPUT()` is registered, the benchmark corpora that matter
(CADGenBench's 32 editing fixtures, neuralCAD-Edit, the v18 edit-plan corpus)
all start with that bind, and the app has no way to say which file it binds.
The kernel already has `importStep`/`exportStep` and a green `step_probe`, so
this is a **command-surface gap, not a kernel gap** — and it is the cheapest of
the top five. Fixing it needs the three generated artifacts regenerated.

**2. No components, instances or mates — no assembly concept exists (rows 4–8, 16).**
Three videos (43612, 99642, 41710) are *entirely* assembly work, and the fourth
(50455) is an agent operating on sub-assemblies by name. `EntityKind` has no
occurrence kind and the kernel IR has no component op, so this is not a missing
panel — it is a missing tier of the data model. Everything in rows 5–8 and 16
is downstream of it. This is the single largest body of work on the list and it
gates the most video-minutes.

**3. The agent is a keyword matcher, not a model (rows 12–16).**
Video 50455 is the competitive bar and Video 3097 is the thesis, and the gap
between them and `LocalPlanner` is categorical, not incremental: 31 English
words onto 21 of 80 commands, no clarifying-question turn, no report, no image
input. **The architecture is right** — the single-registry constraint, the
four-way plan validation, the value-level `OpConstraintBridge` check — and the
network seam is deliberately unfilled. So the gap is one specific thing: **fill
`submit`/`deliver` with a real planner**, and the rest of the CoPilot already
refuses everything a bad model could say. Rank 3 rather than 1 because a model
that can only emit 53 ops into a part with no imported input is still capped by
gaps 1 and 2.

**4. No drawing output — no sheet, no dimensions, no balloons, no BOM (rows 9, 10).**
Video 43612's second half and Video 3097's *input* are both engineering
drawings. Forge's Drawing workspace exists as chrome with an empty ribbon and a
`sheet_canvas` that shows the 3D viewport. Ranked below the agent because a
drawing is an *output* of a model that must exist first — but note it is
double-weighted: 3097 also demands drawing *reading*, which is row 11 and
belongs to gap 3.

**5. No draft, no boundary surfaces, no spline, no rib, no thread (rows 20, 22–25).**
Video 61709's entire ribbon is these tools, and 99642's truck is full of drafted
mouldings. The sharp finding here: **`forge::draftFaces` and `LoftGuide` are
already implemented in the kernel and no IR op reaches either.** So part of this
gap is a few op enum entries plus commands, and part of it (spline, boundary,
rib, thread) is genuinely absent. Splitting the already-built half out of this
row is the highest-value next measurement.

**6. 27 of 50 dock panels are placeholders, and 7 of 8 workspaces add no commands (rows 37, 38).**
This is what a viewer of any of the six videos would notice within seconds of
using Forge. It is ranked sixth because most of those panels are placeholders
*for* gaps 1–5 — `mates`, `bom`, `annotation`, `gdt`, `title_block` cannot be
implemented before the tiers beneath them exist. But three of them are not
blocked by anything: `appearance` (row 33), `constraints`/`relations` (the
sketch solver already exists, row 19), and `verify_report` (VERIFY/SURFCHECK
already exist, row 40).

**7. Measure is a passive panel, not a tool (row 31).**
Video 43612's status bar reads `Arc Length: 47.07mm` and
`Radius: 298.07mm  Center: 302.07mm,60mm,0mm` — measurements *on a picked
entity*. Forge computes whole-model mass properties honestly (it refuses to
print a volume for an open mesh) but has no measure command and no per-pick
readout. Small, self-contained, blocked by nothing.

**8. No section/clipping view, no per-part appearance, one display mode (rows 32–34).**
Presentation-tier, cheap, and blocked by nothing except that with no assembly
there is little to clip or colour differently.

### What this ranking says to the next pass
Gaps 1, 7 and the unblocked third of 6 are **small and blocked by nothing**.
Gap 5 is **half already built in the kernel and stranded behind the IR**. Gap 3
is **one seam away from being real**. Gaps 2 and 4 are the genuinely large ones.
Anything that claims to close gap 2 without adding an occurrence tier to
`EntityKind` and an instance op to the 56-op enum is not closing it.

---

## 4. What was NOT done

- **Nothing was built or changed.** This document is a measurement only; no
  source file in this repo was modified.
- **No video file was copied into the repo**, and none should be.
- **Audio was not transcribed.** All six carry an aac track; every claim above
  comes from pixels and from this repo.
- **Frames were sampled at 1 fps.** A dialog opened and closed inside one second
  is invisible to this method. In `Video-41710` specifically I could not
  establish what edit produced the dirty marker on `100534*`.
- **Forge was not built or run.** Every Forge verdict is read from source and
  from the two committed generated artifacts at `origin/archdisc` 75d612c8. In
  particular the three generators were **not** re-run, because nothing here
  touches the command surface.
- **Row 35 (large-assembly navigation performance) is unmeasured**, and is
  marked so in the table rather than guessed at.
- **The identification of `Video-99642` as CATIA V5** rests on the View toolbar
  icon set, the blue radial-gradient background and the shading-with-edges
  style. No title bar or splash screen was visible in any sampled frame. It is
  the strongest available reading, not a certainty — and it does not change any
  Forge verdict, because the demands in that row (large assembly, per-part
  appearance, sectioning) are the same for CATIA or NX.
- **One reading of my own was wrong and is corrected in place, not silently.**
  My first pass at table row 4 asserted that `EntityKind` has no component kind.
  It does. The verdict does not change — nothing selects, produces or consumes
  one, and the vocabulary file never mentions it — but the *evidence* changes,
  and the row now says so explicitly. Anyone re-running this measurement should
  check the enum, not the sentence I first wrote about it.

### The part of this that cuts against the ranking

Two things argue the ranking above is too harsh on Forge, and one argues it is
too kind.

*Too harsh, first:* rows 19, 21, 26, 27, 28, 39 and 40 are genuine `yes` — a
constrained sketch solver, the four sweep/loft/extrude/revolve generators,
holes and counterbores, three pattern families, a real single undo stack, and
per-statement build-failure reporting. That is a working parametric modeller,
and the reference videos are the *high-water mark of four mature products*, not
a fair like-for-like. Second: the CoPilot's refusal machinery (row 12) is
something none of the six videos demonstrates and LEO explicitly does not have
— LEO ships a "may display inaccurate information" disclaimer where Forge ships
a validator that structurally cannot emit an op no command declares.

*Too kind:* the 8/15/17 tally counts a capability as `partial` whenever any part
of it exists, and several of those partials are thin. Row 29 (sheet metal) is
one bend command standing in for a whole workspace tab. Row 33 (appearance) is
a header file with no command behind it. Row 31 (measure) has no command at
all. A stricter reading would move at least those three to `no` and make the
tally 8 yes / 12 partial / 20 no.
