# Siemens NX 1h 21m Beginner Course — Synthesis for ArchDisc UI/UX

**Date:** 2026-05-23
**Source:** `docs/siemens-nx-course/1imaUh28Dnk_Free Complete tutorial on Siemens NX latest version for beginners.en-orig.vtt`
(341 KB; YouTube auto-EN captions; total runtime `01:21:12`; video ID `1imaUh28Dnk`)
**Sibling doc:** `docs/superpowers/notes/solidworks-course-synthesis.md` (the 17h 48m SolidWorks
synthesis, with its 10-tier gap list).
**Purpose:** Extract NX's terminology, UI conventions, and workflow patterns. Where NX names a
thing differently from SolidWorks, the NX vocabulary is captured because *autonomous CAD agents
need both vocabularies to be useful*. Where NX teaches a distinctively-NX pattern (selection
priority, datum CSYS, sync modeling, through-curves), it gets flagged as a new gap. Read-only
audit of code.

This course is roughly 1/13th of the SolidWorks course's runtime. Coverage is therefore
proportionally narrower — only the "core 80%" of an NX beginner walkthrough — but it touches
every major workbench (Modeling / Drafting / Surface Modeling / Assemblies) and gives clean
evidence of NX-specific UX. The video does NOT cover Sheet Metal, Sync Modeling, Mold Wizard,
Routing, NX CAM, or NX Realize Shape; those are flagged as honest gaps in §9.

---

## 1. Course outline with timestamps

The instructor walks through one continuous part with all the core modeling operations, then
switches to Drafting on that part, then a tiny Surface Modeling demo, and finishes with a
two-part Assembly (a "bench" — a top plate plus two legs). No formal chapter markers; the
boundaries below are inferred from `"let us now ..."` transitions in the captions.

### Block 0 — Interface (00:00:11 → 00:01:34)

| Time | Topic | Notes |
|---|---|---|
| `00:00:11` | NX startup screen | "New", "Open", "Recently Open Parts", "Assemble" *(misheard for "Assemblies")*, "Touch Mode" *(actual NX Touch toolbar)*, "Window", "Help" |
| `00:00:33` | **File → New** dialog | Templates listed: Multi-Axis Deposition, Inspection, Mechatronics Concept Designer, Line Designer (work areas + line designer), root **Model**, **Drawing**, Additive Manufacturing, Machining Line Planner, Manufacturing |
| `00:01:02` | Units toggle | "inches or millimeters" — picked **Model** template, mm |
| `00:01:14` | File name field | "Name this as extrude" — instructor convention is one-feature-per-file |
| `00:01:26` | OK → Modeling environment | "This is the modeling interface that you get" |

### Block 1 — Datums (00:01:30 → 00:09:13)

| Time | Topic | Notes |
|---|---|---|
| `00:01:30` | Modeling interface tour | "**Datums** where you can select **Datum Plane**, **Axis**, or **Coordinate System**, sketch, extrude, revolve, and many other base features" — establishes NX's **Datum trinity** |
| `00:01:48` | Home tab + Extrude button | NX calls the active ribbon tab "**Home**"; primary commands live there |
| `00:01:53` | Extrude → "sketch section" icon | First-class **inline sketch creation from the Extrude dialog** — NX merges sketch+extrude into one workflow when desired |
| `00:02:01` | Plane picker | "select the plane where you want to sketch" — picks **Top Plane** |
| `00:02:15` | Sketch mode entered | Sketch toolbox: profile, rectangle, circle, line ... |
| `00:02:21` | Rectangle sub-options | "two points, three points, or **Center**" — pick Center |
| `00:02:47` | Drag-out rectangle | Click-drag with live preview |
| `00:03:10` | Escape + delete & redo | Demonstrates ESC convention |
| `00:03:26` | Typed dimensions | "70 → **Tab** → 50 → angle 0 → Enter" — NX uses **Tab to advance fields** in the dimension entry box |
| `00:03:44` | **Finish** button (exit sketch) | NX calls "exit sketch" → **Finish** (top-left of sketch ribbon, equivalent of SolidWorks confirmation corner X) |
| `00:03:53` | Extrude distance + OK | "thickness as 10 mm" — extrude feature created |
| `00:04:11` | **Datums in NX** intro | "Datum Plane, Axis, Coordinate System" |
| `00:04:30` | **Datum Plane** | Select face → offset distance (0 = on-face, 15 = above). **Number-of-planes** field can create a *stack* of N parallel planes in one go (demonstrated 10 planes preview) |
| `00:05:42` | Hide planes in **Model Tree** | NX calls the feature tree the **"Model Tree"** (sometimes "Part Navigator" in modern NX; "model tree" is the term used here) |
| `00:06:26` | **Datum Axis** | Method = **Intersection** of two datum planes (other methods listed: offset, on-curve, etc.) |
| `00:07:32` | Edit Parameters via right-click | Right-click in Model Tree → "edit the parameters" |
| `00:07:40` | **Datum CSYS** (Coordinate System) | Methods listed: **Dynamic, Inferred Origin, X-O-X Axis, Y-Axis Origin**, etc. Dynamic = drag the gnomon with the mouse; **Selected Coordinate Systems** = paste at another CSYS |

### Block 2 — Sketcher (introduced incrementally; canonical pass 00:09:13 → 00:11:48)

| Time | Topic | Notes |
|---|---|---|
| `00:09:13` | Insert Sketch | "click on the sketch icon, select the plane" |
| `00:09:52` | Reference + plane | "now we have the reference and the plane" — NX sketches have an explicit **horizontal reference** axis (the plane's projected X) |
| `00:10:02` | Line tool | Click → length popup → click; mid-segment switch demoed |
| `00:10:24` | End-point snapping | "the end point is seen when it's highlighted" — yellow snap dot |
| `00:10:32` | Vertical length 7mm | Inline typed value |
| `00:10:58` | Profile chain | "select this profile, go to 4, select 2, select 2 again" — appears to demo the **Profile** tool (NX's chain-of-lines + arcs, the equivalent of SW "Polyline" — extracts as a single tool) |
| `00:11:35` | Right-click → OK | NX dimension entry: type value → right-click → click OK |
| `00:11:43` | **Finish** to exit sketch | Confirmed pattern |

The sketcher tools shown by name: **profile, rectangle (2pt / 3pt / center), circle, arc
(center/end-points), line, point**. Polygon, spline, ellipse, conic, parabola are NOT shown
in this beginner video — they exist in NX but are out of scope.

### Block 3 — Core 3D modeling commands (00:11:48 → 00:32:30)

The instructor builds up a single part with these features, in this order:

| Time | Command | NX terminology + notes |
|---|---|---|
| `00:11:48` | **Revolve** | Inputs: **Curve** (the sketch), **Specify Vector** (line in sketch *or* CSYS axis), **Angle** (180° / 360°) |
| `00:13:52` | **Hole** | NX calls this just "Hole" (in modern NX it's **Hole Package**). Types listed: **Simple, Counterbore** *("counter board" in caption mishear)*, **Tapered** *("paper" mishear)*, **Countersunk**, **Hole Series**. Demoed: Counterbore, D=6, diameter=8, depth=6mm, angle=120°. Position = picks face of the extrude |
| `00:16:08` | **Unite** | Boolean union. Inputs: **Target body**, **Tool body**. **Preview** then OK. (NX's "Unite / Subtract / Intersect" trio is the **Combine Bodies** Booleans) |
| `00:17:05` | **Extrude as Cut** | Same Extrude dialog, **flip direction** + **distance** drives cut. (NX uses the **Boolean toggle** inside Extrude — Boolean = None / Unite / Subtract / Intersect — rather than a separate "Extruded Cut" tool. The instructor shows the manual flip approach.) |
| `00:18:08` | **Subtract** | Explicit Boolean. Demo: create second body (extruded arc-and-line profile, symmetric, 35mm) → Subtract: target = first body, tool = second body |
| `00:20:25` | **Edge Blend** | NX's fillet. Inputs: **edge selection** + **radius**. Variants in dialog: **G2 Curvature** (non-tangent G2), **Conic** (rho/discriminant — center-radius edit). First demo = constant radius 5 |
| `00:21:40` | **Chamfer** | Edge + **distance**. Modes: **Symmetric**, **Asymmetric** (two distances), **Offset & Angle**. Demoed symmetric=10mm and asymmetric=20/10 |
| `00:22:39` | **Edge Blend → Add New Set** | NX's pattern for multi-blend: **Add New Set** button collects independent fillet specs in one feature (one radius per set) |
| `00:23:31` | **Draft** | Inputs: **Vector** (Z-axis), **Stationary Face** (the flat one that does not move), **Faces to Draft**, **Angle** (15° demo, then 5°). NX **Vector + Stationary Face** is the equivalent of SW's "Direction of Pull + Neutral Plane" |
| `00:24:52` | **Shell** | **Open** (delete face) vs **Closed** (offset surface, no hole). Demo: open, pick face, thickness 2mm |
| `00:26:01` | **Pattern Feature** | NX **layouts** listed: **Linear, Circular, Polygon, Spiral, Along, General, Reference**. Demo: Linear, count=4, spacing=8mm, vector=X |
| `00:27:41` | **Mirror Feature** | Inputs: feature + **Plane** (datum plane 4). **Show Result** preview button before OK |
| `00:28:38` | **Move Face** (Synchronous-modeling-style) | NX "Move" command (under Home). Pick face → specify distance, angle. Direct/synchronous edit |
| `00:30:12` | **Delete Face** | Direct removal of a face (NX synchronous modeling) — used to delete a hole |
| `00:30:42` | **Offset Face** (Offset Region) | Modes: **Single Face, Tangent Faces, Adjacent Faces, Feature Face, Region Boundary Faces, Boss/Pocket/Rib Faces, Slot Faces**. Demo: single face 5mm, then tangent faces 5mm (3 faces scale together) |

### Block 4 — Drafting (00:32:45 → 00:51:48)

NX calls Drawings → **"Drafting"** internally; the captions use "drawing" generically.

| Time | Topic | NX terminology + notes |
|---|---|---|
| `00:32:48` | File → New → **Drawing** | Sheet size **A4** (the dropdown lists mm / inches / meters). Default templates fill in title block |
| `00:33:34` | Title block fields | "Drawn By", "Checked By", "Approved By" — populated as text |
| `00:34:18` | **Base View** | Place from disk if no model open. Drop on sheet → **projection views in any angle** — the cursor drags out **perpendicular projections** (front + top + right). NX uses the **first-angle / third-angle** projection convention |
| `00:35:13` | **Detail View** | Types: **Circular, Rectangle by Corners, Rectangle by Center and Corner**. Pick **center point** → **boundary** → **place location** |
| `00:36:34` | **Section View** | Modes: **Select Existing** or **Dynamic** (define on-the-fly). Pick section axis → projection direction. Sub-feature: **Section Line → Stand Alone** lets you build a stepped/zigzag section line (the equivalent of SW "Aligned Section") |
| `00:38:23` | Annotation height | Double-click section label → change height factor |
| `00:40:20` | **Dimensioning** | NX call: **Rapid** (auto-pick) and **Linear** (two-point). Plus dropdowns for **Diameter / Radius**, tolerancing, horizontal/vertical orientation. Edit format by **double-clicking the dimension** |
| `00:43:36` | Other dimension types | **Callouts, Ordinates, Chamfer, Thickness, Arc Length, Perimeter** |
| `00:44:14` | **Note** | Home tab → Note → click position → type text → close |
| `00:45:16` | **GD&T — Feature Control Frame** | NX: **Feature Control Frame** + **Leader** (terminating object). Tolerance characteristics: **Position, Flatness, Profile of a Surface, Angle, Straightness** and more. **Composite Feature Control** supported. Datums: **Primary, Secondary, Tertiary** |
| `00:48:12` | **Datum Feature Symbol** | Home tab → Datum Feature Symbol → position → leader → close |
| `00:49:01` | **Surface Finish symbol** | Home tab → click target surface. Sub-options: **Open**, **Open Modifier**, **X** (machining mark), **Upper / Lower text**, **Waviness** |
| `00:50:09` | **Balloon** | Click → text → leader → place. *No* mention of Auto-Balloon or BOM linkage in this beginner video |
| `00:51:01` | **Tabular Note** (table) | Specify columns (5), rows (3), column width (20). Click to place. Type cell contents manually. This is the closest thing the video shows to a BOM — but it's a generic table, not linked to assembly components |

### Block 5 — Surface Modeling (00:51:48 → 01:04:30)

| Time | Topic | NX terminology + notes |
|---|---|---|
| `00:52:31` | File → New → Model → name `surface modeling exercise` | NX has no separate "Surfacing template" — surface ops are in a tab |
| `00:52:54` | Sketch arc on Front Plane | Radius 50mm |
| `00:53:53` | **Surface tab** → **Extrude (Surface)** | NX surface extrude reuses the Extrude dialog but produces a **sheet body** instead of a solid |
| `00:54:17` | Sketch arc on Top Plane | |
| `00:54:58` | Surface tab → **Swept** | NX: **Swept** (instructor calls it "swep"). Inputs: **section curve** + **guide curve**. The guide selection uses **middle-mouse-button** to confirm selection between picks — *first concrete MB2 usage shown* |
| `00:55:43` | **Through Curves** | NX's name for "Loft". Demo: 3 datums, 3 arc sketches. Inputs: select each section, **middle-mouse-button between selections**. The instructor demos the **point-flip** problem: a twisted Loft is fixed by selecting alignment points on the second curve. (NX has explicit **point/alignment controls** for Through Curves) |
| `00:57:58` | **Thicken** | Surface tab. Select sheet body(s) → thickness → OK. Multi-face selection allowed (the equivalent of SW Thicken) |
| `00:58:35` | **Offset Surface** | NX: Offset Surface (sheet → sheet at distance). Direction flip. Multi-face stack |
| `01:00:03` | **Sew** | NX: **Sew** (often misheard as "Sue"/"Shoe"). Combines two sheet bodies into one. Pick first sheet → second sheet → OK. Multi-sew tested |
| `01:00:55` | **Extend Sheet** | Pick edge → distance → OK. Follows the original surface path (curvature-continuous extension) |
| `01:02:54` | **Analysis → Measure** | Analysis tab. Pick face/edge → readouts: **area, perimeter, radius, centroid**. **Filter** to show only the values you want. Edge measure shows radius/length |

### Block 6 — Assembly (01:04:30 → 01:21:12)

The closing example: a two-part **bench** (top plate + leg, leg patterned twice).

| Time | Topic | NX terminology + notes |
|---|---|---|
| `01:05:15` | Part 1: build the **top** | Sketch rectangle 150×50, trim, second rectangle for groove, extrude 15mm |
| `01:07:55` | **Edit Object Display** | View / display tab → Edit Object Display → pick body → **Color**: blue. *NX uses per-object color, not material-driven appearance, for this kind of quick visual differentiation* |
| `01:08:36` | Save part | File → Save |
| `01:08:36` | Part 2: build the **leg** | New model → sketch on Right plane → rectangle (center, 15×20) → lines at 75mm @ 240° angle → trim corners → extrude 10mm → color red |
| `01:13:00` | **File → New → Assembly** | NX has a dedicated **Assembly** template |
| `01:13:23` | **Add Component** | Browse to part → **Position** options: **By Constraints**, **Move** (and others); click OK |
| `01:13:51` | **Fix constraint** | Assemblies tab → **Fix** → pick the body → OK. Fixed component shown in the assembly (no `(f)` prefix convention in NX) |
| `01:14:17` | Add second component (leg) | **Anchor** placement options: **Absolute Origin, Absolute Origin of Displayed Assembly, Selected Coordinate System** |
| `01:15:49` | **Touch Constraint** | NX's primary mate type. Picks two faces → they coincide. (NX **Touch Align** is one mate that contains Touch / Align / Infer modes; SW splits Coincident, Concentric, Distance) |
| `01:17:00` | Constraint conflicts | When two touch constraints fight, you delete one. Right-click in tree → Delete |
| `01:17:34` | **Parallel constraint** | Faces become parallel without touching |
| `01:18:14` | **Move Component** | Assemblies tab → Move → select component → specify orientation (Z-axis) → OK |
| `01:18:49` | Additional touch constraint | "Touch command or constraint on this assembly" |
| `01:19:06` | **Auto Align constraint** | Pick two objects → they snap aligned automatically. *Distinctive NX UX — single inferred mate rather than SW's explicit type chooser* |
| `01:19:52` | **Pattern Component** | Assemblies tab. **Count** + **distance** (150 − 10 = 140mm) + **vector** (X). Patterns a component along an axis. NX has no separate Component Pattern tab — it's one tool that takes a component as the seed |
| `01:21:02` | **Bench assembly complete** | End of video |

End of recording: `~01:21:12`.

---

## 2. NX feature inventory (by workbench, NX terminology)

NX uses **distinctively different vocabulary** from SolidWorks. The right column captures what
the SolidWorks course (or generic CAD) would call the same thing. NX terms come from this
video's captions, lightly normalized for caption mishears.

### Modeling (the "Modeling" application)

| NX term | SW / generic term | Notes from this video |
|---|---|---|
| **Datum Plane** | Reference Plane | First-class — offset from face, on 3 points, etc. Can create N planes in one shot |
| **Datum Axis** | Reference Axis | Methods incl. **Intersection** of two planes |
| **Datum CSYS** | Coordinate System | Methods: Dynamic, Inferred Origin, X-O-XY, Y-Axis Origin, Selected CSYS |
| **Sketch** | Sketch | Plane-on-face. **Finish** to exit (not "Exit Sketch") |
| **Profile** | Line + Arc chain (no SW equivalent as one tool) | Chain command |
| **Rectangle (By 2 Points / 3 Points / By Center)** | Rectangle variants | Single tool with mode selector |
| **Line / Arc / Circle / Point** | Same | Plus arc-by-center-and-endpoints |
| **Extrude** | Extruded Boss/Cut | One tool with **Boolean** = None / Unite / Subtract / Intersect. **Sketch Section** field can create an internal sketch in-dialog |
| **Revolve** | Revolved Boss/Cut | Inputs: Curve + **Specify Vector** + Angle |
| **Swept** | Swept Boss | Section + Guide |
| **Through Curves** | Lofted Boss | Distinctive name. Has explicit **alignment points** to fix twisting |
| **Hole** (Hole Package in modern NX) | Hole Wizard | Types: Simple, Counterbore, Tapered, Countersunk, Hole Series |
| **Unite / Subtract / Intersect** | Combine: Add / Subtract / Common | Booleans |
| **Edge Blend** | Fillet | One tool. Sub-types: **Constant, G2 Curvature, Conic**. **Add New Set** for multi-blend with independent radii |
| **Chamfer** | Chamfer | Symmetric, Asymmetric, Offset-and-Angle |
| **Draft** | Draft | Inputs = Vector + Stationary Face + Faces. (Equivalent of SW Neutral Plane method) |
| **Shell** | Shell | Open / Closed |
| **Pattern Feature** | Linear/Circular Pattern + family | One tool with layouts: Linear, Circular, Polygon, Spiral, Along, General, Reference |
| **Mirror Feature** | Mirror | Pattern Feature in NX 12+; here separate "Mirror" |
| **Move** (Move Face) | Move Face (Direct Edit) | Synchronous-modeling face move |
| **Delete Face** | Delete Face | Synchronous-modeling face delete |
| **Offset Face** (Offset Region) | Offset Face (Direct Edit) | Selection priority: Single / Tangent / Adjacent / Feature / Boundary / Boss-Pocket-Rib / Slot |

### Drafting (NX's drawing environment)

| NX term | SW / generic term |
|---|---|
| **Base View** | Standard 3-View (drag part to sheet) |
| **Projection View** | Projected View |
| **Detail View** (Circular / Rectangle by Corners / Rectangle by Center) | Detail View |
| **Section View — Dynamic / Select Existing** | Section View |
| **Section Line — Stand Alone** (stepped) | Aligned Section / Stepped Section |
| **Rapid (Dimension)** | Smart Dimension (auto-snap) |
| **Linear Dimension** | Smart Dimension (two-point) |
| **Callouts / Ordinates / Chamfer / Thickness / Arc Length / Perimeter** | Same |
| **Note** | Note |
| **Feature Control Frame** | GD&T Frame |
| **Datum Feature Symbol** | Datum Feature |
| **Surface Finish** symbol | Surface Finish |
| **Balloon** | Balloon (no Auto-Balloon shown) |
| **Tabular Note** | Generic table (not BOM-linked in this video) |

### Surface Modeling (Surface tab inside Modeling)

| NX term | SW / generic term |
|---|---|
| **Extrude (Surface)** | Extruded Surface |
| **Swept (Surface)** | Swept Surface |
| **Through Curves** | Lofted Surface |
| **Thicken** | Thicken |
| **Offset Surface** | Offset Surface |
| **Sew** | Knit Surface |
| **Extend Sheet** | Extend Surface |
| **Analysis → Measure** | Evaluate → Measure |

### Assembly

| NX term | SW / generic term |
|---|---|
| **Add Component** | Insert Component |
| **Pattern Component** | Component Pattern |
| **Move Component** | Move Component |
| **Fix** (constraint) | Fix (right-click → Fix) |
| **Touch** (constraint) | Coincident (face-to-face) |
| **Touch Align** (modern NX combined form) | Coincident + Concentric inferred |
| **Parallel** | Parallel |
| **Auto Align** | (no direct SW equivalent — closest is SW Smart Mates auto-suggest) |
| **Anchor** at Absolute Origin / Absolute Origin of Displayed Assembly / Selected CSYS | (no SW equivalent — SW just clicks to drop) |

### NOT covered by this video (honest scope gap)

The video does NOT touch:

- **Synchronous Modeling** as a named tab (NX's marquee differentiator vs SW; only face-move/delete/offset taught informally)
- **Sheet Metal** (NX has it; not in this video)
- **NX Realize Shape** (subdivision modeling)
- **Routing / Piping**
- **CAM** (NX has a deep CAM module; not shown)
- **Mold Wizard / Progressive Die Wizard**
- **Motion Simulation / Mechatronics Concept Designer** (the start screen lists them but they're not entered)
- **Drafting BOM tables linked to assembly** (only a generic Tabular Note shown)
- **Auto-Balloon** (only manual Balloon)
- **3D Sketch** (the video stays in single-plane sketches)
- **Spline / Polygon / Ellipse / Conic / Parabola** sketcher tools
- **Class-A surfacing tools** (Studio Spline, Bridge Curve, Match Edge)
- **Equation / Expressions** (NX **Expressions** dialog — equivalent of SW Equation Manager)
- **WAVE Geometry Linker** (NX's between-part associative copy)

---

## 3. NX UI/UX patterns

The most useful NX-specific UX cues. These are what make NX feel like NX, not SolidWorks.

### 3.1 — Application + Resource Bar (left side)

NX organizes work into **Applications** (Modeling / Drafting / Manufacturing / Assemblies / Sheet
Metal / Motion / Mechatronics / Routing / Inspection). Each is a *mode* — switching application
swaps the ribbon and many panels. This is different from SW where every workbench is reachable
from one ribbon at all times.

The **Resource Bar** is the vertical strip of icons on the left side (in modern NX, the
**Navigator dock**): Part Navigator, Assembly Navigator, Constraint Navigator, Reuse Library,
Web Browser, History, Roles. *The video does not stop on the Resource Bar but the captions show
the instructor right-clicking the Model Tree throughout — that's the Part Navigator's tree
view.*

### 3.2 — Ribbon (Home tab is the main work tab)

NX 12+ uses an **Office-style ribbon**. The instructor lives almost entirely in the **Home tab**
in Modeling: every command from Sketch through Pattern Feature is on Home. The **Surface tab**
holds the surface ops (Extrude / Swept / Through Curves / Sew / Thicken / Extend Sheet). The
**Analysis tab** holds Measure and inspection. The **View / Display tab** holds Edit Object
Display.

### 3.3 — Part Navigator / Model Tree

The instructor calls it the **"Model Tree"** (older NX) — in modern NX it's the **Part
Navigator**. It shows:

- The **datum group** (datum CSYS, datum planes, datum axes)
- The **feature history** (every operation, top-down)
- **Right-click → Hide** is the universal way to suppress a datum/feature from the view
- **Right-click → Edit Parameters** opens the feature dialog to modify its inputs
- **Right-click → Delete** removes the feature

### 3.4 — Selection bar / Selection priority

NX's **Selection Bar** (top, contextual) is a distinctive feature: it has a **selection-priority
pre-filter** that limits what you can pick before you even click. Filter modes seen in this
video implicitly (from the "Offset Face" command):

- **Single Face**
- **Tangent Faces** (auto-extend selection to all tangent-continuous neighbors)
- **Adjacent Faces**
- **Feature Face** (all faces produced by one feature)
- **Region Boundary Faces**
- **Boss / Pocket / Rib Faces**
- **Slot Faces**

This filter is a **selection-intent system** that the SW course does not have a direct analog
for. It's one of NX's strongest UX patterns.

### 3.5 — Mouse conventions (MB2 / middle-mouse semantics)

NX uses **MB2 (middle mouse button)** heavily:

- **MB2 drag** = rotate (same as SW)
- **MB2 click** = **OK / accept / advance** in dialogs (distinctive)
- **MB2 click in selection** = **finish selection of one group**, move to next field

This is captured in the captions at `00:56:55` ("select the curve middle mouse button and select
the next one") and `00:57:35`. The MB2-to-advance-fields pattern is the largest single workflow
difference vs SW (where you tab between fields).

### 3.6 — OK / Apply / Cancel dialog convention

The instructor uses **OK** at every step (mentioned ~95 times in the captions). NX dialogs
universally present:

- **OK** — confirm + close dialog
- **Apply** — confirm + keep dialog open for another instance (chained ops)
- **Cancel** — close without applying
- **Show Result** — preview button (used in Mirror feature `00:28:24`)
- **Preview** — toggle (used in Unite `00:16:37`)
- **Add New Set** — append another instance within the same feature (used in Edge Blend `00:22:53`)
- **Reset** — clear all inputs (implicit, common in NX)

The dialog body is **collapsible sections** (Type / Section / Limits / Boolean / Settings /
Preview) — the same docked left pattern that SW PropertyManager uses.

### 3.7 — Sketch UX

- **Finish** button (top-left of sketch ribbon) exits sketch — not a top-right "X"
- **Tab** to advance between dimension fields (length → width → angle) — `00:03:35`
- **Inline value entry** (type 70 → Tab → 50 → Enter) is the fastest sketch flow
- **End-point highlight** when hovering a vertex (`00:10:24` "the end point is seen when it's highlighted")
- **Right-click → OK** as an alternative confirm
- **Hover-snap** to existing geometry — implicit throughout

NX does NOT (in this video) demonstrate:
- The blue/black/red color states for under-/fully-/over-defined sketches that are SolidWorks's
  trademark. (Modern NX has them via the **Sketch Constraints** dialog but they're less
  prominent than SW.)
- Auto-relation icons next to the cursor on draw (NX has them; just not visible in this video).

### 3.8 — Dialog-internal sketching (the Extrude → Sketch Section pattern)

The instructor opens **Extrude** *first*, then clicks "**Sketch Section**" inside the Extrude
dialog to create a sketch inline (`00:01:53`). When the sketch is Finish'd, NX returns to the
Extrude dialog with the new sketch as the section. This **dialog-inside-a-dialog** pattern is
distinctively NX — SW splits sketch and feature.

### 3.9 — Edit Object Display

`01:07:55`: View → Edit Object Display → pick body → Color picker. **Per-object color override**
is a one-shot visual differentiation in NX, faster than applying a material+appearance.

### 3.10 — Quick Access Toolbar

NX has a **Quick Access Toolbar** at the very top (above the ribbon) with Save / Undo / Redo /
File-Open. Not shown explicitly in the video but referenced when the instructor saves (`01:08:36`).

---

## 4. NX worked example — the bench

The video's final-third worked example is a **wooden-bench-style assembly** (top plate + two
legs). Modest in feature count but it exercises:

- 2 separate part files (top + leg), each in its own model
- Sketch with rectangle (by-center) + trim
- Rectangle-on-rectangle to define grooves, trimmed away
- Extrude to thicken (15mm top, 10mm leg)
- Edit Object Display → blue top, red leg
- New Assembly file
- Add Component (top) + **Fix constraint**
- Add Component (leg) at **Absolute Origin** anchor
- **Touch constraints** to seat the leg in the groove
- **Pattern Component** along X with count=2, distance=140mm to make the second leg
- **Auto Align constraint** demoed as an alternative to Touch

The earlier part (Modeling block) builds a separate test model that exercises **every modeling
feature** in turn: rectangle extrude → revolve → counterbore hole → unite → extrude-cut hole →
subtract another body → edge blend (constant + G2 + conic) → chamfer (symmetric + asymmetric) →
multi-blend → draft → shell → linear pattern → mirror → move face → delete face → offset face.
This is the same "kitchen-sink" pedagogy as the SW course.

---

## 5. Comparison table — NX vs SolidWorks (vs ArchDisc)

The high-value output. **Bold** = NX terminology, *italic* = SW terminology, ArchDisc status
based on `frontend/src/components/RibbonToolbar.jsx` snapshot.

### 5.1 — Datums & references

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Reference plane | **Datum Plane** | Reference Plane | (no first-class ribbon entry — used implicitly during sketch) | **Missing as ribbon tool** |
| Reference axis | **Datum Axis** | Reference Axis | (none) | **Missing** |
| Coordinate system | **Datum CSYS** | Coordinate System | (none) | **Missing** |
| Reference point | **Datum Point** | Reference Point | (none) | **Missing** |
| Multi-plane stack (N parallel planes at once) | **Datum Plane → Number of Planes** | (no SW equivalent) | (none) | **Missing — NX-distinctive** |
| Tree of datums (grouped node) | **Datums folder** in Part Navigator | Reference Geometry folder | (none) | **Missing** |

### 5.2 — Sketcher

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Line chain | **Profile** | (no equivalent — multiple Line clicks) | (none) | **Missing — NX-distinctive** |
| Rectangle variants | **Rectangle (2pt / 3pt / By Center)** | 5 variants (Corner / Center / 3pt-Corner / 3pt-Center / Parallelogram) | Rectangle (single) | **Partial** |
| Circle | **Circle (Center / Tangent-Circle / etc.)** | Center / 3pt-Tangent | Circle | **Done** (single variant) |
| Arc | **Arc by Center and Endpoints** | 3pt / Tangent / Center | Arc | **Done** (single variant) |
| Exit sketch | **Finish** (top-left) | "Exit Sketch" X (top-right) | (verify ArchDisc behavior) | **Different UX** |
| Tab between dim fields | **Tab** | Tab | (verify) | **Missing/unverified** |

### 5.3 — Solid features

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Extrude | **Extrude** (with Boolean toggle) | Extruded Boss / Cut (two tools) | Extrude Boss + Extrude Cut | **Done** but two separate tools |
| Revolve | **Revolve** (with Boolean) | Revolved Boss / Cut | Revolve Boss + Revolve Cut | **Done** |
| Loft | **Through Curves** | Lofted Boss | Loft Boss | **Done** — *NX term to alias* |
| Sweep | **Swept** | Swept Boss | Sweep Boss | **Done** |
| Hole | **Hole** / **Hole Package** | Hole Wizard | Hole Wizard | **Done** |
| Booleans (add/cut/intersect) | **Unite / Subtract / Intersect** | Combine: Add / Subtract / Common | Boolean group | **Done** — *NX terms to alias* |
| Fillet (rounded edges) | **Edge Blend** | Fillet | Fillet | **Done** — *NX term to alias* |
| G2 fillet | **Edge Blend → G2 Curvature** | (separate Curvature Continuous fillet) | Smooth Fillet | **Partial** (different UX entry) |
| Conic fillet | **Edge Blend → Conic** | (no direct SW equivalent — Stylized Fillet) | (none) | **Missing — NX-distinctive** |
| Chamfer | **Chamfer** (Symmetric / Asymmetric / Offset-Angle) | Chamfer (3 methods) | Chamfer | **Done** |
| Multi-blend feature with independent radii | **Edge Blend → Add New Set** | (no SW equivalent — one fillet feature per radius) | (none) | **Missing — NX-distinctive** |
| Draft | **Draft** (Vector + Stationary Face) | Draft (Neutral Plane / Parting Line) | Draft | **Done** (verify Stationary-Face naming) |
| Shell | **Shell** (Open / Closed) | Shell | Shell | **Done** |
| Pattern (one tool, many layouts) | **Pattern Feature** (Linear/Circular/Polygon/Spiral/Along/General/Reference) | Linear / Circular / Curve-Driven / Sketch-Driven / Table-Driven Patterns (5 tools) | Linear Pattern / Circular Pattern | **Partial** — NX consolidates into one tool, ArchDisc has two |
| Mirror | **Mirror Feature** | Mirror | Mirror Feature | **Done** |

### 5.4 — Direct / synchronous editing

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Move a face | **Move Face** (in Synchronous Modeling tab, or "Move" in Home) | Move Face (Direct Editing toolbar) | Move Face | **Done** |
| Delete a face | **Delete Face** | Delete Face | Delete Face | **Done** |
| Offset a face | **Offset Region** (the NX term) / **Offset Face** | Offset Face | Offset Face | **Done** |
| Replace a face | **Replace Face** | Replace Face | Replace Face | **Done** |
| Push/Pull a face | **Pull Face** (synchronous) | Move Face by drag | Push/Pull Face | **Done** |
| Selection priority filter | **Single / Tangent / Adjacent / Feature / Boundary / Boss-Pocket-Rib / Slot Faces** | (no SW equivalent — selection is uniform) | (none) | **Missing — NX-distinctive, high value** |
| Sync Modeling tab as a workbench | **Synchronous Modeling** ribbon tab | (folded into Direct Editing toolbar) | Direct Edit tab | **Different naming — ArchDisc closer to SW** |

### 5.5 — Surfacing

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Surface extrude | **Extrude** in Surface tab | Extruded Surface | (none — implicit from extrude+thin?) | **Missing as named tool** |
| Surface sweep | **Swept** in Surface tab | Swept Surface | Sweep Tortuous | **Partial** (different name) |
| Surface loft | **Through Curves** | Lofted Surface | Loft Tangent | **Partial** (different name) |
| Knit / merge sheets | **Sew** | Knit Surface | Stitch Faces | **Done** |
| Thicken | **Thicken** | Thicken | Thicken | **Done** |
| Offset surface | **Offset Surface** | Offset Surface | (none as named tool — implicit?) | **Missing as named tool** |
| Extend surface | **Extend Sheet** | Extend Surface | (none) | **Missing** |
| Trim surface | **Trim Sheet** | Trim Surface | (Trimmed NURBS Patch exists) | **Partial** (different name) |
| Filled / patch | **Fill Surface / N-Sided Surface** | Filled Surface | N-Sided Patch | **Partial** (different name) |
| Section curve / 3D curve | **Section Curve / Studio Spline** | Convert / Composite Curve | (none) | **Missing** |

### 5.6 — Assembly

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Insert a component | **Add Component** | Insert Component | Insert Component | **Done** |
| Fix in place | **Fix** constraint | Right-click → Fix (or first-inserted (f)) | (verify) | **Unverified** |
| Coincident face-to-face | **Touch** constraint | Coincident mate | Coincident | **Done** — *NX term to alias* |
| Combined coincident+concentric | **Touch Align** | (separate mates) | (none combined) | **Missing — NX-distinctive** |
| Parallel | **Parallel** constraint | Parallel mate | (none) | **Missing** (per SW gap list Tier 7) |
| Auto-inferred mate | **Auto Align** | Smart Mates | (none) | **Missing — NX-distinctive** |
| Distance | **Distance** constraint | Distance mate | Distance | **Done** |
| Angle | **Angle** constraint | Angle mate | Angle | **Done** |
| Concentric | **Concentric** constraint | Concentric mate | Concentric | **Done** |
| Anchor placement at known origin | **Anchor: Absolute Origin / Selected CSYS** | (no SW equivalent — manual placement) | (none) | **Missing — NX-distinctive** |
| Pattern of a component | **Pattern Component** | Component Pattern | (none) | **Missing** |
| Move component freely | **Move Component** | Move Component | Move Component | **Done** |
| Exploded view | **Exploded View** (in Drafting workflow) | Exploded View | Exploded View | **Done** |

### 5.7 — Drafting

| Concept | NX term | SW term | ArchDisc term | Status |
|---|---|---|---|---|
| Standard 3-View | **Base View** + projection drag | Standard 3-View | Standard 3 View | **Done** |
| Stepped section | **Section Line — Stand Alone** | Aligned Section View | (none — only single-plane Section View) | **Missing — NX-distinctive** |
| Detail view (with shape choice) | **Detail View** (Circular / Rect-by-Corners / Rect-by-Center) | Detail View (Circular only, then crop for rect) | Detail View | **Partial** — only one shape variant |
| Dimension auto-pick | **Rapid Dimension** | Smart Dimension auto-snap | Smart Dimension | **Done** |
| Linear / Diameter / Radius / Chamfer / Arc Length / Perimeter / Thickness dimensions | All seven explicit | Smart Dimension covers most | Smart Dimension | **Partial** — only one dimension tool exposed |
| Feature Control Frame (GD&T) | **Feature Control Frame** | GD&T Frame | GD&T Frame | **Done** |
| Datum Feature Symbol | **Datum Feature Symbol** | Datum Feature | (verify) | **Unverified** |
| Surface Finish | **Surface Finish** | Surface Finish | Surface Finish | **Done** |
| Balloon | **Balloon** | Balloon | Balloon | **Done** |
| Generic table | **Tabular Note** | Annotation → Tables | (none) | **Missing — useful** |
| BOM (linked to assembly) | **Parts List** | BOM | (none) | **Missing** (per SW gap list Tier 8) |
| Title block | (template-fill) | Sheet Format → Title Block | (verify) | **Unverified** |

---

## 6. NEW gaps from NX (not already in the SW gap list) — Tier 11+

The SolidWorks synthesis ended at **Tier 10**. The NX course adds these *new* gap categories,
all NX-distinctive UX or features the SW course did not surface. Numbering continues from the
SW list.

### Tier 11 — NX-distinctive UX patterns (the highest-leverage adds)

100. **Selection-priority pre-filter on the Selection Bar.** A docked top-of-viewport bar with
   mode buttons: Single Face / Tangent Faces / Adjacent Faces / Feature Face / Region Boundary /
   Boss-Pocket-Rib / Slot Faces. When set, all picks below are constrained to that mode. This
   makes face-selection on a complex body dramatically faster than SW-style click-and-pick. It
   is one of NX's three biggest UX wins.

101. **MB2 (middle-mouse-button) field advancement** in dialogs. MB2 acts as "confirm this
   selection + advance to next field" — visible in the Through Curves demo where the instructor
   picks a curve, MB2, then picks the next curve. ArchDisc/SW typically uses click-Next-button
   or pick-and-then-click-next-field. MB2 is faster.

102. **Dialog-inside-a-dialog sketch creation (Extrude → Sketch Section).** Open Extrude *first*,
   then click "Sketch Section" inside the dialog to enter sketch mode; Finish returns to the
   parent dialog with the new sketch as input. ArchDisc/SW typically requires sketch-first,
   then feature-on-sketch. This NX pattern is much faster when the user knows what feature they
   want from the start.

103. **One unified Pattern Feature tool with multiple layouts** (Linear / Circular / Polygon /
   Spiral / Along / General / Reference) rather than separate Linear / Circular / Curve-Driven /
   Sketch-Driven tools. UX win: one icon, one dialog, one mental model.

104. **One unified Boolean toggle inside Extrude / Revolve / Sweep** (None / Unite / Subtract /
   Intersect) rather than separate Extrude Boss vs Extrude Cut tools. ArchDisc currently follows
   the SW two-tool split.

105. **Add New Set pattern in feature dialogs.** Edge Blend lets you collect *independent edge
   groups with different radii* inside ONE feature node (via the "Add New Set" button). This is
   a NX-distinctive consolidation — SW's analog is one Fillet feature per radius spec.

106. **Multi-plane creation in one shot** (Datum Plane → Number of Planes field). Creates N
   parallel planes at user-defined spacing. Useful for through-curves / loft scaffolding.

107. **Through Curves alignment-point control.** When Through Curves twists, NX exposes
   *per-curve alignment points* to fix the twist — no need to redo the sketches. ArchDisc/SW
   typically requires re-creating the sketches or adding guide curves.

108. **Anchor placement at known CSYS during Add Component.** Choices: Absolute Origin /
   Absolute Origin of Displayed Assembly / Selected Coordinate System. Lets you snap a freshly
   inserted part to a chosen reference without dragging.

109. **Touch Align combined mate** — one constraint that infers "coincident if planar / concentric
   if cylindrical" based on geometry. ArchDisc/SW requires picking the mate type explicitly. NX
   *also* offers explicit Coincident / Concentric, so Touch Align is an additional shortcut, not
   a replacement.

110. **Auto Align constraint.** Picks two faces or edges and infers the right mate
   automatically (Smart-Mates-like). Used as the default for fast-mode assembly.

111. **Per-object color via Edit Object Display.** One-shot color override on a body, without
   creating a material/appearance. Faster than SW's appearance dialog for differentiation.

### Tier 12 — NX features the SW gap list missed

112. **Section Line — Stand Alone (stepped section).** NX explicitly supports a zigzag /
   stepped section line in Drafting that the standard SW Section View does not (SW has Aligned
   Section but it's clunkier). ArchDisc currently has only a single-plane Section View.

113. **Conic fillet (Edge Blend → Conic).** Rho-parameterized conic-section profile for stylized
   fillets (used in automotive / consumer goods). SW has "Stylized Fillet" but the SW course
   does not teach it. ArchDisc has no analog.

114. **Tabular Note (generic table) in drawings.** NX lets you place an N×M editable table on a
   drawing sheet that is NOT tied to a BOM. Useful for revision tables, machining schedules,
   inspection sheets. ArchDisc has no table primitive in Drawing.

115. **Surface Finish — Waviness sub-spec.** The NX Surface Finish dialog has a Waviness field
   (upper-text + lower-text + waviness). SW has it via tooltips but the NX course flags it
   explicitly. ArchDisc has Surface Finish but verify Waviness coverage.

116. **Datums grouped as a single folder in the Part Navigator.** All datums (CSYS + planes +
   axes + points) live in a separate top-of-tree group. ArchDisc Design History likely shows
   them inline; grouping them separately improves tree readability.

117. **"Specify Vector" universal picker.** Most NX dialogs (Revolve, Pattern, Move, Offset,
   Mirror, Draft) use a unified **Specify Vector** widget that lets you pick: a CSYS axis, a
   sketch line, a face normal, an edge, the world Z, or a 3-point vector. This is a single
   reusable picker component, not a per-dialog selector. ArchDisc has direction inputs scattered
   across tools.

118. **"Specify Stationary Face" in Draft.** The NX Draft dialog names the non-moving face the
   **Stationary Face** explicitly — clearer than SW's "Neutral Plane" (which confusingly is
   often a face, not a plane). Worth adopting the terminology.

119. **In-dialog "Show Result" / "Preview" buttons.** Universal pattern: every feature dialog
   has a Preview toggle and many have a Show Result button. ArchDisc currently has preview on
   some tools but not as a universal convention.

120. **Workbench-as-Application separation.** NX treats Modeling / Drafting / Assemblies /
   Manufacturing as separate Applications with their own ribbons (you switch with **File →
   Start → ...**). ArchDisc has tabs in one ribbon. The NX approach is heavier-weight but the
   ribbon stays cleaner. Not necessarily worth adopting but worth being aware of when an NX
   user is confused that ArchDisc has all tabs visible at once.

121. **Resource Bar (left vertical icon strip).** NX's persistent left-side dock for
   Navigators / Reuse Library / Web / History / Roles. ArchDisc has panels but they're not
   docked in a single resource bar. Worth surveying.

### Tier 13 — NX-specific kernel + workflow features (not in this video but flagged for completeness)

122. **WAVE Geometry Linker** — NX's between-part associative copy (drop a face/edge/sketch from
   part A into part B with a live link). The SW analog is "Insert Part" + external references
   but NX's WAVE is more granular.

123. **Synchronous Modeling tab as a true workbench** with its own ribbon (Move Face / Pull
   Face / Resize Face / Make Coplanar / Make Coaxial / Make Tangent / Make Symmetric / Match
   Edge etc.). ArchDisc has Direct Edit but the *Make-Coplanar / Make-Tangent* style relational
   sync ops are missing.

124. **Expressions dialog** — NX's equivalent of SW Equation Manager. Allows variables with
   units, conditionals, external link to Excel.

125. **Reuse Library** — NX's parts library with drag-and-drop standard hardware. Equivalent of
   SW Toolbox.

### Other gap categories the NX course REINFORCES (already in SW gap list)

- Sheet Metal workbench (SW Tier 5) — not shown in this NX video but NX has it
- Weldments (SW Tier 6) — not shown but NX has it (NX Routing / Structure)
- Mold Tools (SW Tier 9) — NX has Mold Wizard, not shown
- Component Pattern (SW Tier 7) — *shown* in NX video, confirms importance

---

## 7. Direct mapping — each NX pattern → ArchDisc area

Linking every NX-distinctive pattern from §6 to an ArchDisc UI/code location. **Done** =
already in `RibbonToolbar.jsx` or backing module. **Partial** = exists but missing the NX
feature. **Missing** = no analog. Sub-project = the tracker label or directory most relevant.

| # | NX pattern | ArchDisc area | Sub-project | Status |
|---|---|---|---|---|
| 100 | Selection-priority filter bar | `frontend/src/components/ViewportOverlays.jsx` + selection layer in `kernel/topology/` | **NX-UX track** (new) | **Missing** |
| 101 | MB2 field advancement | `ToolParamDialog.jsx` event handlers; needs viewport MB2 event hookup | NX-UX track | **Missing** |
| 102 | Dialog-inside-a-dialog sketch | `ToolParamDialog.jsx` + `InteractiveSketch.js` enter-sketch hook | NX-UX track | **Missing** |
| 103 | Unified Pattern Feature tool | `RibbonToolbar.jsx` Part tab Pattern group — consolidate Linear+Circular | NX-UX track | **Partial** (two separate tools) |
| 104 | Boolean toggle inside Extrude/Revolve | `ToolParamDialog.jsx` Extrude dialog adds Boolean dropdown | NX-UX track | **Missing** |
| 105 | Add New Set in feature dialogs | `ToolParamDialog.jsx` Fillet dialog (Edge Blend equivalent) — append-set UX | NX-UX track | **Missing** |
| 106 | Multi-plane in one shot | Datum Plane tool (when added) with N-planes field | parity-program §3 Datums | **Missing** |
| 107 | Through Curves alignment-point control | `kernel/features/Loft.js` + Loft dialog UX | parity-program §6 Loft enhancements | **Missing** |
| 108 | Anchor placement at known CSYS | `kernel/assembly/AssemblyInsert.js` + Insert Component dialog | parity-program §7 Assembly | **Missing** |
| 109 | Touch Align combined mate | `kernel/assembly/Mate.js` + Mates ribbon group | parity-program §7 Assembly | **Missing** |
| 110 | Auto Align constraint | `kernel/assembly/Mate.js` heuristic + Mates ribbon | parity-program §7 Assembly | **Missing** |
| 111 | Per-object color override | View tab → Edit Object Display dialog | NX-UX track | **Unverified — may exist** |
| 112 | Stepped section line | `kernel/drawing/DrawingEngine.js` + Section View dialog | parity-program §8 Drawing | **Missing** |
| 113 | Conic fillet | `kernel/features/Fillet.js` conic profile + Edge Blend dialog | NX-UX kernel | **Missing** |
| 114 | Tabular Note | `kernel/drawing/DrawingEngine.js` + Drawing tab Annotate group | parity-program §8 Drawing | **Missing** |
| 115 | Surface Finish — Waviness | Existing Surface Finish dialog — add Waviness field | parity-program §8 Drawing | **Partial / Unverified** |
| 116 | Datums grouped in Part Navigator | `DesignHistoryPanel.jsx` / `FeatureTreePanel.jsx` rendering | NX-UX track | **Missing** |
| 117 | Specify Vector universal picker | `frontend/src/components/VectorPicker.jsx` (new shared component) | NX-UX track (high leverage) | **Missing** |
| 118 | Rename "Neutral Plane" → "Stationary Face" | Draft dialog wording (purely a string change) | NX-UX track | **Trivial / NOT THIS PASS** |
| 119 | Universal Preview / Show Result | `ToolParamDialog.jsx` add Preview toggle + Show Result button | NX-UX track | **Partial — some tools have preview** |
| 120 | Workbench-as-Application | `RibbonToolbar.jsx` mode switcher | Out of scope (deliberate architectural choice — ArchDisc tabs-in-one-ribbon is fine) | **N/A** |
| 121 | Resource Bar (left dock) | New `frontend/src/components/ResourceBar.jsx` collecting Part Browser / Design History / Reuse Library / Web Help | NX-UX track | **Partial — components exist but not docked as one strip** |
| 122 | WAVE Geometry Linker | New kernel module `kernel/assembly/WaveLink.js` | NEW Tier 13 sub-project | **Missing** |
| 123 | Sync Modeling tab as workbench | Extend Direct Edit tab into a full Sync Modeling workbench (Make Coplanar / Make Tangent / Make Coaxial / Match Edge ops) | parity-program direct-editing track | **Partial — Direct Edit exists, lacks relational sync ops** |
| 124 | Expressions dialog | New `kernel/parameters/Expressions.js` + UI | Tier 10 (already on SW list) | **Missing — same as SW Tier 10** |
| 125 | Reuse Library | New `frontend/src/components/ReuseLibrary.jsx` + standard parts data | Tier 7 (SW Toolbox equivalent) | **Missing — same as SW Tier 7** |

---

## 8. Top 3 takeaways for ArchDisc's UI/UX track

1. **Adopt NX's Selection-priority pre-filter (item 100) as a Tier-11 first deliverable.** It
   is the single largest UX gap a CAD user (NX-trained or not) notices, and it dramatically
   speeds up face selection on complex parts. Implementation cost is modest because the
   filtering happens at the React/Three.js pick layer — the kernel does not need to know about
   modes. Pair with the existing ConfirmationCorner / HeadsUpViewToolbar work in `SwUxOverlays.jsx`
   to create a coherent "fast-CAD UX" bar at the top.

2. **Consolidate ArchDisc's Extrude Boss / Extrude Cut into one tool with a Boolean toggle
   (item 104) and consolidate Linear Pattern / Circular Pattern into one Pattern Feature with a
   Layout selector (item 103).** These two consolidations remove 4 ribbon icons and bring
   ArchDisc closer to NX's mental model, which is *more discoverable than SW's*, not less.
   Cost is purely UI — kernel ops stay the same.

3. **Build a shared `VectorPicker` component (item 117) and use it everywhere a direction input
   is needed (Revolve, Pattern, Move, Offset, Mirror, Draft).** Picker accepts: a CSYS axis, a
   sketch line, a face normal, an edge, world X/Y/Z, or 3-point vector. NX's universal direction
   picker is hidden plumbing but it's the reason NX feels coherent across tools. ArchDisc
   currently has tool-specific direction inputs; a shared picker is a one-time investment that
   pays back across every operation that needs a direction.

---

## 9. Honest caveats

This synthesis was extracted from YouTube auto-generated English captions for a single 81-minute
beginner walkthrough. Known limitations:

- **Caption mishears.** NX-specific terminology that auto-captioning gets wrong:
  - "semens" / "siemens" → Siemens (caption settles on "seens" later)
  - "datm" → datum (consistent throughout)
  - "Revol" / "Revolve" → both used
  - "thicken" sometimes "Picken" / "thicken"
  - "Sew" → "Sue" / "Shoe" (high-confidence mishear; NX surface stitch tool is **Sew**)
  - "through curves" / "true C" / "true curves" — NX command is **Through Curves**
  - "counter board" → counterbore
  - "tapered" → "paper" in one place
  - "gd&t" → "gdn" / "gdnt"
  - "tabular note" → "tabular not"
  - "Synchronous Modeling" — never actually spoken in this video; the closest demos (Move Face /
    Delete Face / Offset Face) are taught as Home tab tools, not as a separate workbench. The
    actual NX Sync Modeling tab is not shown.
  - "swep" → swept

- **Scope of the video.** Only ~25% of NX's surface area. The video is a beginner walkthrough,
  not a feature reference. Specifically MISSING from this video (but in NX):
  - Sheet Metal workbench
  - NX CAM
  - Mold Wizard
  - Routing / Piping
  - Motion Simulation
  - Mechatronics Concept Designer
  - Realize Shape (subdivision modeling)
  - Expressions dialog
  - WAVE Geometry Linker
  - Studio Spline / Bridge Curve (class-A surfacing)
  - Selection Bar with filter modes — *inferred to exist* from the Offset-Face dialog's
    selection-type dropdown (Single Face / Tangent Faces / Adjacent Faces / etc.) but the
    instructor did NOT walk through the dedicated top Selection Bar
  - Resource Bar (left strip) — inferred but not explicitly demoed
  - MB2 universal selection-finish — *confirmed at 00:56:55 and 00:57:35* in Through Curves,
    not demoed elsewhere

- **Tool naming.** The mapping table uses NX 12+ terminology where the video is clearly using a
  modern NX (the Home-tab ribbon, the "Datum CSYS" wording, the conic-fillet option, etc. all
  point to NX 1872 or newer). Some legacy NX terms (e.g. "Reference Set" for components,
  "Part Family Table" for configurations) were not surfaced.

- **ArchDisc current-state column.** Status is based on a scan of
  `frontend/src/components/RibbonToolbar.jsx` plus the SW synthesis doc. Items marked
  "**Unverified**" or "**Partial**" may need deeper checking — the underlying kernel may already
  cover several "Missing" items without UI exposure (the SW synthesis flagged the same pattern
  for `KinematicsCore` mates).

- **No explicit chapter markers.** The video has no chapter markers in the captions; section
  boundaries in §1 are inferred from `"let us now ..."` transitions in the instructor's speech
  (28 such transitions in 81 minutes). Section starts are accurate to ±10 seconds.

- **Beginner-bias of the source.** A beginner course optimizes for the most-common workflow,
  not for the most-distinctive NX features. The Synchronous Modeling tab, Studio Spline, WAVE
  Linker, and CAM are arguably the *real* NX differentiators — but they're not in this video,
  so the §6 "NX-distinctive" gap list is biased toward the introductory-tier UX patterns. A
  follow-on synthesis of an *advanced* NX course would surface the heavyweight NX features.

- **No worked example with the full mate library.** The bench assembly uses Fix / Touch /
  Parallel / Auto Align / Pattern Component — only 5 of NX's ~15 constraint types. The video
  does not show Distance / Angle / Center / Concentric / Distance Range / Angle Range /
  Linear-Coupler / Tangent / Bond / Cam / Slot / Gear constraints (NX has them all). The mate
  comparison in §5.6 covers what NX has, but only the 5 demoed types are confirmed from this
  source.
