# SolidWorks 17h 48m Course — Synthesis for ArchDisc UI/UX

**Date:** 2026-05-22
**Source:** `docs/solidworks-course/9acHdJLdDa8_FULL COURSE in  SolidWorks - Beginner to Advanced.en-orig.vtt`
(4.87 MB; YouTube auto-EN captions; SolidWorks 2014; total runtime `17:48:12`)
**Purpose:** Extract the canonical SolidWorks user model — features, UI conventions, workflow
ordering, worked examples — so ArchDisc's UI/UX-fully-equipped track (`§5` of
`docs/superpowers/plans/2026-05-21-kernel-parity-program.md`) can match what an experienced CAD
user expects on day one. **Read-only audit of code.** The "Direct mapping" section is the
steering input for the UI track.

Counting in this doc: tutorial numbers (e.g. **#71**) are the course's own numbering, which runs
from 1 to ~187 (Level 1 = 1–145, Level 2 = 146–187). Timestamps are `HH:MM:SS` from the video.

---

## 1. Curriculum outline with timestamps

The course is structured **Level 1** (Part / Sketch / Features / Surfacing / Weldments /
Assemblies / Drawings — tutorials 1–145) then **Level 2** (Sheet Metal + Mold Tools — tutorials
146–187). The transition is explicit at `07:51:48`: *"Hello and welcome to the very first
tutorial in level two in this course of solid works. The level one was the first 145 and this is
the first tutorial in level two."*

### Level 1 — Part modeling, surfacing, weldments, assemblies, drawings

| Section | Tutorials | Starts | Headline content |
|---|---|---|---|
| **0. Interface & setup** | #1 | `00:02:22` | Interface overview, file types (part / assembly / drawing), Tools→Options, Document Properties, units (mm/g/s), Add-Ins, heads-up View toolbar (zoom-to-fit, zoom-to-area, section view, view orientation, Normal-To) |
| **1. First sketch & line** | #2 | `00:07:34` | Three default planes (Front/Top/Right) + Origin; insert sketch on a plane; the Line tool; auto-relations on hover (vertical, horizontal, perpendicular, midpoint, coincident-on-origin); right-click→Select to end Line; View→Sketch Relations |
| **2. Dimensions + repetition** | #3 | `00:13:36` | Smart Dimension (D); editing dimension value; under-defined (blue) vs fully-defined (black) sketch; delete relation; **Fully Define Sketch** (auto-add dimensions, calculate) |
| **3. Exit-sketch + quick extrude** | #4 | `00:20:32` | Exit-sketch icon (top-right "X"); rename sketch in FeatureManager; double-click sketch to edit dimensions outside sketch mode; quick Extrude as a "fast 3D model" preview |
| **4. Mouse + view orientation** | #5 | `00:23:26` | Middle-mouse rotate; wheel zoom; keyboard arrows rotate; View-orientation cube; Normal-To button to look straight-on a face; edit-sketch from extruded feature's tree |
| **5. Rectangles** | #6 | `00:29:29` | 5 rectangle types: Corner, Center-Point, 3-Point Corner, 3-Point Center, Parallelogram; Center-Line (under Line); "For construction" checkbox to make any entity a reference |
| **6. Slots + Circle** | #7 | `00:35:11` | 4 slot types: Straight, Center-Point, 3-Point-Arc, Center-Point-Arc; 2 circle types: Center-Point, 3-Point-Tangent; dimensioning slots (length + radius) |
| **7. Arc + Polygon** | #8 | `00:39:57` | 3 arc types: Center-Point, Tangent, 3-Point; **Polygon** (n-sides; inscribed vs circumscribed) |
| **8. Spline + Ellipse + Parabola** | #9–#10 | `00:44:38` | Spline (handles per control-point; tangent direction); Ellipse (4 types incl. partial); Parabola |
| **9. Sketch fillet/chamfer + Trim/Extend** | #11–#12 | `00:58:46` | Sketch Fillet (radius); Sketch Chamfer (distance/angle); Display/Delete Relations; Trim Entities; Extend Entities; ESC to exit |
| **10. Text + Points + Plane in 3D Sketch** | #13–#14 | `01:03:44` | Text (along a curve); Point entity; insert reference Plane during 3D Sketch |
| **11. Convert / Offset / Mirror Entities** | #15–#17 | `01:14:15` | **Convert Entities** (project existing geometry onto active sketch plane — critical for sketch-on-face); **Offset Entities** (with options: bidirectional, cap-ends, make-construction); **Mirror Entities** (about a line / centerline / construction line) |
| **12. Linear + Circular sketch pattern** | #18–#19 | `01:25:41` | Linear Sketch Pattern (X+Y direction, spacing, count); Circular Sketch Pattern (center, count, angle, equal spacing) |
| **13. Move / Rotate / Copy / Scale / Stretch / Split Entities** | #20–#24 | `01:32:31` | Move, Rotate, Copy, Scale (uniform scale of selection), Stretch (and later in sheet-metal, Stretch with exact distance) |
| **14. Relations in detail** | #25 | `01:42:30` | All relation types; **Display/Delete Relations** dialog; over-defined sketches; relation icons in the graphics area |
| **15. Appearance / Material** | #26 | `01:56:47` | Right-click body → Appearance; Edit-Appearance (drag from library); Apply Material (changes properties for mass-props, not just color) |
| **16. FEATURES — Extruded Boss** | #27 | `01:51:11` | "Now we move from sketch to features." Selected-contours; Direction-1/Direction-2; Mid-Plane; **Draft angle / Draft outward** checkbox; quick-extrude arrow drag |
| **17. Extruded Cut** | #28 | `02:04:47` | Same dialog as boss; flip-side; through-all |
| **18. Convert/Offset for sketch-on-face workflow** | #29 | `02:08:00` | Insert a face as construction, Convert Entities to project loops, then Cut |
| **19. Revolved Boss + Revolved Cut** | #30–#31 | `02:13:00` | Need axis (Center-Line); selected-contour for asymmetric revolve; **Revolved Cut** removes material |
| **20. Swept Boss** | #32 | `02:17:05` | Profile + Path (path must be on a plane that intersects the profile perpendicular); polynomial vs constant-section |
| **21. Reference Plane** | #33 | `02:21:49` | Reference Geometry → Plane (parallel-to, perpendicular-to, at-angle, coincident-through-3-points); makes Lofted/Boundary possible |
| **22. Lofted Boss** | #34 | `02:23:56` | Multiple profile sketches on different reference planes; guide curves; reorder profiles |
| **23. Guided / Advanced Lofted Boss** | #35 (#33 in course numbering) | `02:31:37` | Loft with guide curves |
| **24. Hole Wizard** | #36 | `02:35:51` | Standard-driven holes (ISO/ANSI/DIN); hole type (counterbore/countersink/tap); positioning sketch |
| **25. Display functions** | #37 | `02:39:37` | Section view of the part; cross-section through a plane with arrow drag; view styles |
| **26. Revolved Cut** | #38 | `02:42:20` | (Reviewed in context of a vase example) |
| **27. Lofted Cut + Guided Loft Cut** | #39 | `02:51:20` | Cut through multiple profiles |
| **28. Fillet — constant size** | #40 | `02:56:07` | Item-to-fillet (edge/face/loop); single-radius |
| **29. Fillet — Variable Radius** | (continued) | `03:00:03` | Per-vertex radius; smooth transition |
| **30. Fillet — Full Round** | | `03:03:47` | Select 3 contiguous faces |
| **31. Chamfer** | | `03:07:13` | Distance-Distance, Distance-Angle, Vertex |
| **32. PATTERNS — Mirror Feature** | | `03:11` (~) | Plane of symmetry; mirror feature/face/body |
| **33. Linear Pattern (feature)** | | `01:26:06` (sketch ver) / feature ver later | Direction-1 + Direction-2, count, spacing; pattern seed |
| **34. Circular Pattern (feature)** | | `01:30:55` / feature ver later | Axis selection; equal spacing |
| **35. Curve-Driven Pattern** | | `03:21:29` | Pattern along an arbitrary curve |
| **36. Sketch-Driven Pattern** | | `03:26:41` | Pattern instances at points in a sketch |
| **37. Coordinate System (reference)** | | `03:28:18` | Insert a custom origin + axes; used as reference for later ops |
| **38. Draft — Neutral Plane** | | `03:39:16` | Neutral-Plane method (the plane that doesn't move) |
| **39. Draft — Parting Line** | | `03:41:48` | "Hinge axis"; the parting-line method on a curved boundary |
| **40. Rib** | | `03:39:16+` | Thickness + direction; reference plane; perpendicular-to-sketch toggle |
| **41. Shell** | | `03:39:16+` | Faces-to-remove + wall thickness; multi-thickness |
| **42. Wrap** | | `03:49:52` | Project a sketch onto a curved face (Emboss / Deboss / Scribe) |
| **43. Dome** | | `03:51:28` | Bulge a face by a height; reverse-direction |
| **44. Free Form (feature)** | | `03:57:34` | Add curves + control points to deform a face freely |
| **45. Split (feature)** | | `04:03:35` | Use a sketch/surface to split a body into multiple bodies; export bodies as separate parts |
| **46. Save bodies as parts** | | `04:11:42` | Body folder → save each as new part file |
| **47. SURFACING — intro** | #66 (approx) | `04:13:50` | Right-click toolbar → Surfaces; or Insert→Surface. Surfaces toolbox parallels Features toolbox |
| **48. Extruded Surface** | **DONE (Tier-4)** — `K.brep.extrudedSurface(wire, depth, {direction})` | `04:15:46` | Open-profile or closed; thin-feature off — prism the WIRE (not a face) → sheet body of lateral faces, no caps; ribbon Part→Surface "Extruded Surface" |
| **49. Revolved Surface** | **DONE (Tier-4)** — `K.brep.revolvedSurface(wire, axis, angle)` | `04:21:57` | Open profile + axis — revolve the WIRE (not a face) → sheet body of SOR faces, no caps; ribbon Part→Surface "Revolved Surface" |
| **50. Swept Surface** | | `04:29:04` | Profile + path on a surface |
| **51. Lofted Surface** | | (cross-ref) | Like lofted boss but produces a sheet body |
| **52. Boundary Surface (= Boundary Boss in features)** | | `03:36:05` / `04:41:45` | 2 directions of curves (Direction-1 + Direction-2); tangent constraints at edges |
| **53. Filled Surface** | #74 | `04:40:54` | Patch a hole bounded by a closed loop |
| **54. Planar Surface** | #76–#77 | `04:43:16` | Flat face from a closed planar boundary |
| **55. Free Form (surface)** | #81 | `04:59:04` | Surface-tool version with curves + points |
| **56. Ruled Surface** | | `05:03:37` | Extend edges with surfaces tangentially |
| **57. Knit Surface** | | `05:06:54` | Combine adjoining sheet bodies into one |
| **58. Extend Surface** | | `05:10:14` | Extend a sheet by distance or up-to a face |
| **59. Helix and Curve** | #86 | `05:11:39` | Reference point on face; Helix (pitch+revs / height+pitch / height+revs); spring/thread base curve |
| **60. Trim Surface** | | `05:15:24` / `05:19:10` | Trim a surface with another surface or sketch; **Untrim Surface** (undo a trim) |
| **61. Delete Face** | | `04:55:57` | Delete face with options: delete / delete-and-patch / delete-and-fill |
| **62. Fillet — Face Fillet** | | `05:21:40` | Two face-sets + radius (used to round between surfaces) |
| **63. Curvature / Zebra Stripe / Surface Analysis** | | `05:29:33` | Evaluate→Zebra Stripe (G1/G2 visualization); Curvature tool |
| **64. Thicken** | #95 | `05:33:34` | Final surface → solid: pick sheet body + thickness; positive/negative/mid |
| **65. WELDMENTS — intro** | #96 | `05:36:45` | Insert→Weldments OR right-click toolbar→Weldments; toolbox |
| **66. 3D Sketch** | #97 | `05:38:13` | Multi-plane sketch in 3D; Tab to switch sketch plane |
| **67. Structural Member** | | `05:45:09` / `05:46:14` | Standard (ANSI/ISO) → Profile type (channel, angle, square tube, pipe, custom) → Size → Group selection |
| **68. Trim/Extend (weldments)** | #106 | `06:03:33` | Trim members to other members; cope cuts |
| **69. End Cap** | (within weldments) | ~ | Cap an open structural-member end |
| **70. Gusset** | (within weldments) | ~ | Reinforce a corner between members |
| **71. Weld Bead** | | `06:15:42` | Specify weld size + locations; spot vs continuous; all-around toggle |
| **72. ASSEMBLIES — intro** | | `06:20:24` | File→New→Assembly; Insert Component (browse); first part is FIXED (the "(f)" prefix); insert more — these are free |
| **73. Mate types** | | `06:31:32+` | Standard mates: Coincident, Parallel, Perpendicular, Tangent, Concentric, Lock, Distance, Angle |
| **74. Advanced mates** | | `06:31:32` / `06:52:42` | Width, Symmetric, Distance/Angle-Limit, Linear-Coupler, Path mate |
| **75. Mechanical mates** | #122 | `07:00:00` / `07:02:35` | Gear (incl. belt reverse), Hinge, Cam, Rack-and-Pinion, Screw, Universal Joint |
| **76. Screw mate detail** | | `06:59:27` | Rotation→linear translation; pitch (e.g. 6 mm/rev) |
| **77. Limit mates** | | `06:59:02` | Angular mid / distance limit; allows constrained free motion |
| **78. DRAWINGS — first drawing** | | `07:05:19` | File→New→Drawing; sheet size A4/A3; ISO standard |
| **79. Standard 3-View** | | `07:08:36` | Drag part onto sheet → front/top/right + isometric; Model-View dialog |
| **80. Section View** | | `07:36:39` | Draw cut-line on a view; auto-generated section; arrow + label |
| **81. Auxiliary View** | | `07:33:58` | Pick an inclined edge → view normal to it |
| **82. Crop View** | | `07:34:40` | Close a profile + View Layout → Crop View → trim view to that area |
| **83. Broken View** | | `07:41:35` | Spline-defined break; for long parts |
| **84. Detail View** | | `07:41:10` | Circle the area + set scale (e.g. 2:1) |
| **85. Exploded View** | | `07:42:43` | (Authored in Assembly, displayed in Drawing) |
| **86. Model Items** | | `07:27:17` | Auto-import all part dimensions/annotations onto a drawing view |
| **87. BOM (Bill of Materials)** | | `07:47:55` | Annotation→Tables→BOM; rows = components; columns = item-no, part-no, qty, description |
| **88. Balloons / Auto-Balloons** | | `07:49:55` | One-click numbered callout linked to BOM row; Auto-Balloon for all |
| **89. Title Block** | | `07:51:29` | Edit sheet format → fill title block fields (material, date, title) |
| **90. Drawing Notes** | | `07:33:09` | Annotation→Note; text on the sheet |

### Level 2 — Sheet Metal (#146–#175) and Mold Tools (#176–#187)

| Section | Tutorials | Starts | Headline content |
|---|---|---|---|
| **91. Sheet Metal intro** | #146 | `07:52:15` | Sheet Metal toolbox; ribbon location; what sheet metal IS |
| **92. Base Flange / Tab + sheet properties** | #147 | `07:57:19` | Closed L sketch → Base Flange (thickness + bend-radius + K-factor); pick steel; Flatten preview |
| **93. Convert to Sheet Metal + Lofted Bend** | #148 | `08:07:45` | Convert an existing solid into sheet metal by choosing bend edges |
| **94. Edge Flange — basics** | #148 | `08:07:45` | Pick edge → flange angle + length + position; offset options |
| **95. Edge Flange — flange length options** | #149 | `08:19:47` | Blind / Up-to-Vertex / Up-to-Edge / Merge; Outer / Inner / Tangent-Bend / Material-Inside positions |
| **96. Edge Flange — flange position** | #150 | `08:29:34` | All position variants explained on the same example |
| **97. Miter Flange** | #151 | `08:40:23` | Sketch a profile on edge → swept flange along multiple edges |
| **98. Sheet Metal worked example #1** | #152 | `08:50:02` | A box/cover model integrating Base + Edge + Miter flanges |
| **99. Hem** | #153 | `09:02:28` | Closed / Open / Tear-Drop / Rolled hem on a sheet edge |
| **100. Jog** | #154 | `09:16:17` | Sketch a line on a flat face → bend on each side of the line |
| **101. Sketched Bend** | #155 | `09:23:04` | A line + a fixed face → bend by angle |
| **102. (cross-coverage of hem variants)** | #156 | `09:34:10` | After-the-hem feature, "the Job" (Jog?) |
| **103. Closed Corner** | #157 | `09:45:12` | Close the gap at a corner between two edge-flanges (overlap/butt) |
| **104. Corner Trim / Corner Relief** | #158 | `09:54:20` | Auto-relief at internal corners (rectangular / tear / obround) |
| **105. Cross Break** | #159 | `10:09:06` | A *displayed-only* fold-line for stiffening; appears on flat pattern but no geometry change |
| **106. K-Factor + Bend Allowance + Bend Deduction theory** | #160 | `10:26:44` | Theoretical: how the K-factor controls bend-line length |
| **107. Gauge Table** | #161 | `10:38:04` | Use a steel-gauge table (file in `solidworks/lang/.../sheetmetal/gauge`) to drive thickness + bend radius |
| **108. Bend Allowance / Deduction selection** | #162 | `10:44:13` | Switch between K-factor / bend-allowance / bend-deduction / bend-table |
| **109. Auto-Relief theory** | #163 | `10:59:52` | Rectangular / Tear / Obround auto-relief; ratio |
| **110. Forming Tool** | #164 | `11:11:30` | Library forming-tools (louver, embossed rib, bridge); preview |
| **111. Forming Tool detail / configurations** | #165 | `11:34:40` | Flip the tool; configurations on a forming tool |
| **112. Sheet Metal worked example #2 (vent / fin)** | #166–#167 | `11:55:54` | Vent fins, design library |
| **113. Convert to Sheet Metal — alt approach** | #169 | `12:46:22` | Pick bend edges + a fixed face |
| **114. Rib (Sheet Metal version)** | #170 | `13:00:27` | Sheet-metal ribb |
| **115. Sheet Metal in 3D Sketch / extra commands** | #171–#172 | `13:10:29` | Stretching edges with exact distance |
| **116. Sweep Flange** | #173 | `13:49:00` | The sheet-metal version of swept flange (profile + path) |
| **117. Sheet Metal worked example #3 — Power Supply** | #174 | `14:05:59` | Build a power supply enclosure: case + vents + cover; pulls together base flange / edge flange / sketched bend / hem / corner trim |
| **118. Sheet Metal final example** | #175 | `15:02:44` | Final integrated sheet-metal project |
| **119. MOLD TOOLS intro** | #176 | `15:21:34` | Insert→Molds OR right-click ribbon→Mold Tools; 4 sections: Surfacing / Analysis / Drafting+Parting / Mold-Block creation |
| **120. Surfacing review for mold tools** | #177 | `15:34:32` | Knit, planar, ruled, etc. — feeding into mold creation |
| **121. Draft Analysis** | | `15:35:18` | Pull-direction plane + angle → color-code faces (positive draft / negative draft / requires-draft) |
| **122. Undercut Analysis** | #178 | `16:07:41` | Find faces that would lock the part in the mold |
| **123. Move Face / Apply Draft (fix workflow)** | #179 | `16:15:29` | Adding draft to fix undercut issues |
| **124. Parting Line** | #180 | `16:20:41` | Curve where core/cavity will split (manually picked or auto from draft analysis) |
| **125. Parting Line — different geometry** | #181 | `16:37:32` | The parting-line command in different topology cases |
| **126. Shut-Off Surfaces** | #182–#183 | `16:43:46` / `16:53:51` | Auto-close holes in the part that would otherwise prevent core/cavity separation |
| **127. Parting Surface** | #184 | `17:02:51` | The actual surface that separates core from cavity (extrude from parting line outwards) |
| **128. Tooling Split** | #185 | `17:09:38` | Split block by parting surface → create core + cavity bodies |
| **129. Core feature** | #186 | `17:20:10` | Extract a side-action core for an undercut |
| **130. Cavity feature** | #187 | `17:37:31` | Subtract a part from a mold block to leave the cavity |

End of recording: `~17:48:12`.

---

## 2. Feature inventory (categorized, with first-introduction timestamp)

### Sketching (2D + 3D)

| Tool | First taught | Notes |
|---|---|---|
| Line | `00:09:37` | With auto-relations on hover |
| Center Line | `00:33:25` | Sub-menu of Line; dot-dash style |
| Construction Line / "For construction" toggle | `00:34:17` | Convert any entity to reference |
| Corner Rectangle | `00:29:48` | |
| Center-Point Rectangle | `00:30:35` | |
| 3-Point Corner Rectangle | `00:32:15` | Angular |
| 3-Point Center Rectangle | `00:33:00` | |
| Parallelogram | `00:33:25` | |
| Straight Slot | `00:36:13` | |
| Center-Point Slot | `00:36:46` | |
| 3-Point-Arc Slot | `00:36:52` | |
| Center-Point Arc Slot | `00:37:12` | |
| Circle (center) | `00:37:34` | |
| Circle (3-point / tangent) | `00:39:06` | |
| 3-Point Arc | `00:40:21` | |
| Tangent Arc | `00:41:02` | |
| Center-Point Arc | `00:41:26` | |
| Polygon | `00:42:21` | n-sides, inscribed/circumscribed |
| Spline | `00:44:38` | Per-control-point handles + tangent direction |
| Ellipse (4 types) | `00:52:25` | |
| Parabola | `00:52:25` | |
| Text | `01:04:36` | Along curve, font/style |
| Point | `01:04:36` | |
| Smart Dimension (D) | `00:16:16` | THE primary dimension tool |
| Sketch Fillet | `00:58:46` | Radius rounds at a 2D corner |
| Sketch Chamfer | `00:59:12` | |
| Trim Entities | `01:08:55` | Power-trim drag |
| Extend Entities | `01:08:55` | |
| Convert Entities | `01:14:15` | Project edges onto active plane |
| Offset Entities | `01:19:36` | With bidirectional / cap-ends / make-construction |
| Mirror Entities | `01:21:53` | About a line |
| Linear Sketch Pattern | `01:25:41` | |
| Circular Sketch Pattern | `01:30:55` | |
| Move Entities | `01:34:26` | |
| Copy Entities | `01:34:26` | |
| Rotate Entities | `01:36:13` | |
| Scale Entities | `01:39:30` | |
| Stretch Entities | (Sheet Metal section) `08:32:42` | |
| Split Entities | (within Mold/sketch) | |
| Fully Define Sketch | `00:19:39` | Auto-add the missing dims |
| Display/Delete Relations | `00:12:11` | |
| 3D Sketch | `05:38:13` | Tab to switch plane |

**Sketch relations taught:** Coincident, Horizontal, Vertical, Parallel, Perpendicular, Tangent,
Concentric, Equal, Fix, Midpoint, Symmetric, Collinear (most introduced organically `00:11:25`
onward).

### Features (3D solid modeling)

| Feature | First taught | Notes |
|---|---|---|
| Extruded Boss | `01:51:11` | Direction-1/2, Mid-Plane, draft, selected-contours |
| Extruded Cut | `02:04:47` | Same dialog inverted |
| Revolved Boss | `02:13:00` | Axis (center-line) required |
| Revolved Cut | `02:42:20` | |
| Swept Boss | `02:17:05` | Profile + path |
| Swept Cut | (within sweep section) | |
| Lofted Boss | `02:23:56` | Multiple profiles on different planes; guide-curves |
| Lofted Cut | `02:51:20` | |
| Boundary Boss | `03:36:05` | 2-direction curve grid; G1/G2 boundary continuity |
| Boundary Cut | (paired) | |
| Hole Wizard | `02:35:51` | Standard-driven; counterbore/countersink/tap |
| Fillet — Constant Size | `02:56:07` | |
| Fillet — Variable Radius | `03:00:03` | Per-vertex radius |
| Fillet — Face Fillet | `05:21:40` | |
| Fillet — Full Round | `03:03:47` | 3 contiguous faces |
| Chamfer | `03:07:13` | Distance-Distance / Distance-Angle / Vertex |
| Mirror Feature | `01:21:53` (sketch) / feature analog | About a plane |
| Linear Pattern | `01:26:06` (sketch) / feature analog | Bi-directional |
| Circular Pattern | `01:30:55` (sketch) / feature analog | About an axis |
| Curve-Driven Pattern | `03:21:29` | Along a curve |
| Sketch-Driven Pattern | `03:26:41` | At sketch points |
| Reference Plane | `02:21:49` | Parallel/Perpendicular/Angle/3-Pts |
| Reference Axis | (within ref-geom menu) | |
| Coordinate System | `03:28:18` | |
| Reference Point | `05:12:33` | |
| Draft — Neutral Plane | `01:54:24` / `03:39:16` | |
| Draft — Parting Line | `03:41:48` | The "hinge" method |
| Rib | `03:39:16` | Thickness + direction + reference plane |
| Shell | `03:39:16` | Faces-to-remove + wall-thickness; multi-thickness |
| Wrap | `03:49:52` | Emboss / Deboss / Scribe onto curved face |
| Dome | `03:51:28` | |
| Free Form | `03:57:34` | Curve+point face deformation |
| Split (body) | `04:03:35` | Split into multiple bodies; save bodies as parts `04:11:42` |
| Combine bodies | `05:06:54` | Add / Subtract / Common |
| Helix and Curve | `05:11:33` | Pitch/revs/height; reverse direction; start-angle |

### Surfacing

| Surface tool | First taught | Notes |
|---|---|---|
| Extruded Surface | `04:15:46` | Thin-feature off |
| Revolved Surface | `04:21:57` | |
| Swept Surface | `04:29:04` | |
| Lofted Surface | (Loft-Surface variant) | |
| Boundary Surface | `04:41:45` | |
| Filled Surface | `04:40:54` | Closed-loop patch |
| Planar Surface | `04:43:16` | Flat patch |
| Free Form (surface) | `04:59:04` | |
| Ruled Surface | `05:03:37` | Extend edges |
| Knit Surface | `05:06:54` | Combine sheets |
| Trim Surface | `05:15:24` / `05:19:10` | |
| Untrim Surface | `05:19:10` | |
| Extend Surface | `05:10:14` | |
| Delete Face | `04:55:57` | delete / delete+patch / delete+fill |
| Thicken | `05:33:34` | Sheet → solid |
| Zebra Stripe / Curvature | `05:29:33` | Evaluate group |

### Sheet Metal

| Tool | First taught | Notes |
|---|---|---|
| Base Flange / Tab | `07:54:05` / `07:57:19` / `08:00:13` | Closed sketch → base; thickness + bend radius + K-factor |
| Convert to Sheet Metal | `07:58:13` | Pick fixed face + bend edges |
| Lofted Bend | `07:58:32` | |
| Edge Flange | `08:07:45` | Edge → angle + length + position |
| Miter Flange | `08:40:23` | Sketched profile swept along multiple edges |
| Hem (Closed/Open/Tear-Drop/Rolled) | `09:02:28` | |
| Jog | `09:16:17` | |
| Sketched Bend | `09:23:04` | |
| Closed Corner | `09:45:12` | Overlap/butt at flange corner |
| Corner Trim / Corner Relief | `09:54:20` | Rectangular / Tear / Obround |
| Cross Break | `10:09:06` | Display-only stiffening line |
| Forming Tool | `11:11:30` | Library tools (louver, emboss, bridge) |
| Sweep Flange | `13:49:00` | |
| Rib (Sheet Metal) | `13:00:27` | |
| Flat Pattern | `07:58:13+` / `08:06:51` | Unfold preview |
| K-Factor / Bend Allowance / Bend Deduction | `08:00:56` / `10:26:44` / `10:36:32` | Switchable bend table |
| Gauge Table | `10:38:04` | |
| Auto-Relief (rectangular/tear/obround) | `10:59:52` | |

### Weldments

| Tool | First taught | Notes |
|---|---|---|
| 3D Sketch | `05:38:13` | Underlying skeleton — Tier 6a uses dialog start/end points; full 3D-sketch UI queued for Tier-6b |
| Structural Member | `05:45:09` | Standard → Profile → Size; group selection — **DONE (Tier 6a)** with 6 standard profile families |
| Trim/Extend | `06:03:33` | Cope cuts — **DONE (Tier 6a)** butt + mitered modes; cope cut (saddle) queued for Tier-6b |
| End Cap | (within Weldments section) | **DONE (Tier 6a)** — flat / thick cap prism + fuse |
| Gusset | (within Weldments section) | Queued Tier-6b |
| Weld Bead | `06:15:42` | Spot/continuous; all-around; size — queued Tier-6b |
| Cut List | `06:00:19` | Auto-generated BOM-like list of all members — queued Tier-6b |

### Assemblies

**Mate types (in order taught):**

- **Standard Mates** (`06:31:32` onward):
  Coincident, Parallel, Perpendicular, Tangent, Concentric, Lock, Distance, Angle.
- **Advanced Mates** (`06:31:32` / `06:52:42`):
  Width, Symmetric, Path mate, Linear-Coupler, Distance-Limit, Angle-Limit.
- **Mechanical Mates** (#122, `07:02:35`):
  Gear (with reverse-direction for belt), Hinge (`07:01:04` — combo of concentric + coincident),
  Cam, Rack-and-Pinion, Screw (`06:59:27` — e.g. 6mm/rev), Universal Joint.

**Other assembly tools:**

- Insert Component (`06:21:01`) — first part is *fixed* with `(f)` prefix
- Move Component / Rotate Component (within assembly toolbox)
- Component Pattern (Linear/Circular/Mirror)
- Exploded View (`07:42:43` — referenced from drawing context)
- Interference Detection (called out as a tool by the course)
- Toolbox standard parts (bolts, screws — referenced `00:03:52`, `04:14:28`)
- Smart Fastener (referenced as an Add-In; not deeply taught)

### Drawings

**View types (in order taught):**
- Standard 3-View (front/top/right + isometric) — drag part to sheet (`07:08:36`)
- Projected View — drag from an existing view (`01:18:03` cross-ref / drawing section)
- Section View (`07:36:39`)
- Auxiliary View (`07:33:58`)
- Crop View (`07:34:40`)
- Broken View (`07:41:35`)
- Detail View (`07:41:10` — circle + scale e.g. 2:1)
- Isometric View (`07:08:36`)
- Model View (`07:07:01`)

**Annotation:**
- Smart Dimension (drawing-side) — `07:27:17` Model Items auto-imports all part dims
- Note (`07:33:09`)
- Balloon / Auto-Balloon (`07:49:55`)
- BOM (`07:47:55` — Annotation→Tables)
- Sheet Format / Title Block edit (`07:51:29`)
- Sheet size (A3/A4/ISO, `07:15:14`)

### Mold Tools

- Draft Analysis (`15:35:18`)
- Undercut Analysis (`16:07:41`)
- Parting Line (`16:20:41`)
- Shut-Off Surfaces (`16:43:46` / `16:53:51`)
- Parting Surface (`17:02:51`)
- Tooling Split (`17:09:38`) — produces core + cavity bodies
- Core (`17:20:10`)
- Cavity (`17:37:31`)
- (Plus all surfacing ops re-used: Knit, Planar, Ruled, Extend, etc.)

---

## 3. Workflow patterns — the canonical SolidWorks user flow

### Part workflow (the bedrock pattern)

1. **File → New → Part** (`00:04:34`)
2. **Tools → Options → Document Properties → Units** — set mm/g/s (or relevant)
3. **Pick a default plane** (Front / Top / Right) — *the most important early choice*
4. **Insert Sketch** on that plane → sketch tools become active
5. **Draw entities** with the Line/Rectangle/Circle/etc. tools — leverage *auto-relations*
6. **Smart Dimension (D)** every entity until the sketch is **fully defined (black)**
7. **Exit sketch** (top-right confirmation corner / X icon)
8. **Apply a feature** — typically Extrude as the first feature
9. **Reference geometry as needed** (Plane / Axis / Coordinate System) for subsequent features
10. **More features** (Cut, Revolve, Sweep, Loft, Pattern, Mirror)
11. **Edge treatments last** — Fillet, Chamfer
12. **Shell + Draft** if it's a plastic part
13. **Rename features** in the FeatureManager (right-click → Feature Properties)
14. **Apply Appearance + Material** for visualization + mass-props

The course explicitly teaches "sketch → feature → fillet/chamfer → shell" as the canonical order
(e.g. `03:39:44`: "we will show you how to use the draft then the shell and then there will be a
need for the rib to support the draft and the shell we created").

### Assembly workflow

1. **File → New → Assembly**
2. **Insert Component** (`06:21:01`) — *the first inserted component is auto-FIXED* (`(f)`)
3. **Insert more components** — these are free-floating
4. **Apply Mates** in order: Standard → Advanced → Mechanical
5. **Pattern / Mirror Components** if there are repeated parts (bolts, etc.)
6. **Toolbox** for standard hardware (bolts/screws) — no need to model
7. **Interference Detection / Collision Detection**
8. **Configurations** for variants
9. **Exploded View** for the drawing
10. **Motion Study** for kinematic verification

### Drawing workflow

1. **File → New → Drawing**
2. **Choose sheet size + standard** (ISO A3 in the course)
3. **Edit Title Block** (or accept default sheet format)
4. **Drag part/assembly** onto sheet — auto-generates Model View / Standard 3-View
5. **Add Projected Views** by dragging from existing views
6. **Add Section / Detail / Auxiliary / Crop / Broken Views** as needed
7. **Annotation → Model Items** — auto-import all dimensions from the part
8. **Manually add** any missing dimensions, notes, GD&T
9. **Annotation → BOM** (for assemblies)
10. **Annotation → Auto-Balloon** to label parts against the BOM
11. **Save / Export to PDF**

### Sheet Metal workflow

1. New Part → sketch a closed L (or U) profile
2. **Sheet Metal → Base Flange** (sets thickness + bend radius + K-factor for the whole part)
3. Add **Edge Flanges** on each edge that needs to bend up/down
4. Apply **Miter / Hem / Jog / Sketched Bend** as needed for complex profiles
5. Address corners with **Closed Corner / Corner Trim** (relief)
6. Add **Forming Tools** for vents/louvers
7. View the **Flat Pattern** (unfold for laser-cut manufacturing)

### Mold Tools workflow

1. Open the *plastic part* you want to mold
2. **Draft Analysis** — find faces with insufficient draft
3. **Apply Draft / Move Face** to fix problem faces
4. **Undercut Analysis** — find features that would lock the part
5. **Parting Line** — define the curve where core/cavity split
6. **Shut-Off Surfaces** — auto-close any through-holes
7. **Parting Surface** — extend the parting line outwards as a surface
8. Sketch a *mold block* enclosing the part
9. **Tooling Split** — split the block by the parting surface → core + cavity
10. **Core / Cavity** features for side-actions

---

## 4. UI/UX patterns — the SolidWorks conventions

### The 4 main UI regions

1. **CommandManager (ribbon, top)** — contextual tabs that swap by mode (Sketch / Features /
   Surfaces / Sheet Metal / Weldments / Assemblies / Drawings / Evaluate). Each tab is grouped
   into **labeled tool groups** (Draw / Modify / Constrain in Sketch; Solid Primitives / Create
   / Modify / Pattern in Features).

2. **FeatureManager Design Tree (left)** — hierarchical history of every feature in the part:
   - Sensors, Annotations, Material, planes, Origin
   - Every feature node, with its underlying sketch nestable beneath
   - Right-click conventions: Edit Feature, Edit Sketch, Suppress, Roll Back, Rename, Delete
   - **Rollback bar** — drag to roll back to any point in the feature history
   - Single-click to highlight feature in the graphics area
   - The course teaches: "to the left tree you have your sketch", "right-click → rename",
     "click → edit feature"

3. **PropertyManager (left, replaces FeatureManager when a tool is active)** — the left-side
   context dialog. *Convention is universal:*
   - **Green check (✓)** = confirm the operation
   - **Red X (✗)** = cancel
   - Sections are collapsible (e.g. Direction-1, Direction-2, Selected Contours, Draft)
   - First field is always the primary geometry selection (a face, edge, sketch)
   - Pink-highlighted = current selection field expects input

4. **Heads-up View Toolbar (top of graphics area)** — view operations always available:
   - Zoom to Fit / Zoom to Area / Section View
   - View Orientation cube (Front / Back / Top / Bottom / Left / Right / Iso / Trimetric)
   - **Normal-To** — make the view perpendicular to a selected face (`00:26:38`)
   - Display Style (Wireframe / Hidden Lines Removed / Hidden Lines Visible / Shaded / Shaded
     with Edges)
   - Apply Scene / RealView graphics

### Confirmation Corner

The course explicitly teaches (`00:20:32`) the **confirmation corner** in the top-right of the
graphics area: when in sketch mode, an "X" appears there. Click it to exit sketch. When in a
PropertyManager dialog, a green-check / red-X appears there as a viewport-edge alternative to
the dialog-internal buttons.

### Sketch mode UX rules

- Auto-relations show as small yellow icons next to the cursor when hovering (vertical bar = V,
  triangle = perpendicular, etc.)
- Coordinates at bottom-left show the current point's X/Y
- Length/distance pops up as you move (course explicitly mentions this `00:09:56`)
- **Blue = under-defined**, **black = fully-defined**, **red = over-defined**
- Right-click → Select to end a chain Line; ESC to exit a tool
- "For construction" checkbox in PropertyManager turns any entity into a reference (`00:34:17`)
- **Box selection / Lasso selection** (right-click → toggle, `01:01:29`)
- **Pencil tool** for selecting connected edges (mentioned `01:00:18`)

### Mouse / Keyboard conventions

- **Middle mouse drag** = rotate
- **Middle mouse click+drag** = rotate (same)
- **Wheel** = zoom in/out
- **Arrow keys** = rotate in 15° increments
- **F** = zoom to fit
- **B** = rectangle (default shortcut)
- **L** = line
- **D** = smart dimension
- **ESC** = end current tool
- **Right-click → Select** = end Line chain
- **Tab** (in 3D sketch) = switch sketching plane
- **Ctrl-Z** = undo

### Dimension-driven design philosophy

- Smart Dimension is THE primary input — geometry follows dimensions, not the reverse
- Dimensions are **parametric** — the course mentions (`00:17:18`) that dimension values can be
  "controlled by some equation"
- Edit a dimension by *double-clicking* it (works both inside and outside sketch mode after
  recent SolidWorks versions, `00:22:25`)
- **Fully Define Sketch** (`00:19:39`): auto-add the missing dimensions to lock the sketch
- **Display/Delete Relations** (`00:12:11`): see every relation as an overlay on the sketch

### FeatureManager mate sequence (assemblies)

- The first inserted component is auto-FIXED — shown with **`(f)`** prefix in the tree
- Subsequent components show no prefix (free)
- The course uses a consistent mate-application order: Concentric → Coincident → Distance →
  Angle → (then Advanced if needed) → (then Mechanical if needed)
- Suppress mates by right-click in tree
- Edit Definition to change mate type

### Configurations + Design Tables (touched lightly)

- The course mentions Configurations briefly (`11:37:27`) in the Forming Tool context — default
  + user-defined variants
- Design Tables are mentioned as the connection to Excel for parameter sweeps (referenced in
  passing — not deeply taught in this course)
- Equations / Global Variables — referenced (`00:17:18`) but not given a dedicated tutorial

---

## 5. Worked examples (the real models the course builds)

These are the *actual models* the instructor builds — a great verification corpus for ArchDisc.

| Example | Where | Features exercised |
|---|---|---|
| **Engine piston** | `07:30:43` / `07:33:09` (drawing context) — built earlier in the course, shown in the drawing tutorial with full BOM/balloons | Revolve, Cut, Fillet, Hole Wizard; assembly into piston+rod+pin+cap |
| **Vase** | `02:48:21` / `02:51:20` (lofted cut chapter) | Multi-profile Loft, Lofted Cut |
| **Bottle** | `04:23:05` | Half-profile + revolve, fillet |
| **Mobile cover (plastic phone case)** | `15:35:18` / `15:55:08` / `16:14:11` | The marquee Mold-Tools example — built earlier, then run through Draft Analysis → Undercut Analysis → Parting Line → Shut-Off → Parting Surface → Tooling Split |
| **Pipe with elbows (steel pipes)** | `02:17:05` / `05:47:32` | Sweep Boss with circular profile; pipe size from toolbox |
| **Chair** | `15:28:31` | Custom surface + bottom-up sheet metal |
| **Bracket (L-bracket)** | implied throughout — every Edge Flange example starts as an L | Sketch L → Base Flange → Edge Flange |
| **Sheet-metal box** | `08:50:02` (tut #152) | Base Flange + 4× Edge Flange + Hem + Closed Corner |
| **Power supply enclosure** | `14:08:00` / `14:42:41` / `15:00:57` (tut #174) | Box + ventilation slots (Extrude Cut) + socket hole; multiple sheet-metal features integrated |
| **Tube chassis** | `14:44:28` | 3D Sketch + Structural Member |
| **Helix / Spring / Screw thread** | `05:14:56` / `05:15:24` | Helix + Swept Boss with circular profile along helix |
| **Welded steel table / structure** | `06:15:42` (weldment example) | Structural Members + Gussets + Weld Beads + Cut List |
| **Hinge mechanism** | `03:43:31` (parting-line draft) / `07:01:04` (hinge mate) | Used to teach both parting line draft AND the hinge mechanical mate |
| **Gear pair (with belt)** | `07:03:01` / `07:04:57` | Concentric mate + Gear mate; belt reverse direction |
| **Knob/screw assembly** | `06:59:27` | Screw mate (6mm/rev) + Limit mate |
| **Boundary surface (curved free-form)** | `04:41:45` | Boundary Surface + tangent continuity |
| **Wooden core with bent steel sheet** | `08:55:30` / `09:00:04` | Sheet metal bent over a solid wooden mandrel — sheet conformance demo |
| **Forming-tool features** | `11:11:30` / `12:13:15` | Library forming tools applied: louvers, vents, embossed ribs |
| **Connector + button (angular mate example)** | `06:55:23` | Angular mate, distance mate |
| **Wing flap** | `06:03:09` | Sheet metal flange with intersecting bend |
| **Mug / Cup (referenced but in another series)** | `13:38:57` (cup unfold) | Sheet-metal unfold; dimensions in inches → mm conversion |

---

## 6. Direct mapping — SolidWorks → ArchDisc (Done / Partial / Missing)

This section is the steering output. For each major SolidWorks UI pattern or feature, the
corresponding ArchDisc capability area is identified along with current status.

### 6.1 — UI structural mapping

| SolidWorks UI element | ArchDisc equivalent | Status | Notes |
|---|---|---|---|
| **CommandManager (ribbon)** | `frontend/src/components/RibbonToolbar.jsx` | **Done (structurally)** | Tabs already: Sketch, Part, Assembly, Simulate, Manufacture, Direct Edit, Drawing. Tool groups already organized (Draw / Modify / Constrain / Solve in Sketch; Solid Primitives / Create / Modify / Pattern / Boolean in Part). **Gap:** No "Surface" tab as a separate workspace (currently Surface tools live inside Part tab); no "Sheet Metal" tab; no "Weldments" tab; no "Evaluate" tab. |
| **FeatureManager Design Tree** | Design History Panel (`DesignHistoryPanel.jsx`) + Body Browser (`PartBrowserPanel.jsx`) + Feature Tree Panel (`FeatureTreePanel.jsx`) | **Done (Tier-1 #9)** | Components exist. Right-click context-menu shipped: Edit Feature / Edit Sketch (only on sketch-bearing rows) / Suppress / Roll Back To Here (placeholder — full feature-tree rollback depends on SP-3 design-history rebackground) / Rename (inline editor; double-click also enters rename) / Delete. `DesignHistory.rename/setSuppressed/remove/rollBackToHere` mutators on the foundation history. |
| **PropertyManager (left dialog)** | `ToolParamDialog.jsx` + `PropertyManager.jsx` (component exists) | **Partial** | 15 tool param dialogs ship per `Phase 2` MEMORY entry. **Gap:** SolidWorks PropertyManager is *always* on the left, replaces the design tree when a tool is active, has *collapsible sections* (Direction-1, Selection, Options, Draft), and uses the green-check / red-X convention. ArchDisc's current dialogs are floating-modal, not docked-left, and don't replace the tree. |
| **Heads-up View Toolbar** | `ViewportOverlays.jsx` + `ViewCube.jsx` + `NavSphere.jsx` | **Partial** | View cube + nav sphere exist. **Gap:** No top-of-viewport heads-up toolbar with Zoom-to-Fit / Zoom-to-Area / Section View / Display-Style / Apply-Scene / Normal-To buttons as a single bar. Normal-To exists as a function but not as a one-click button. |
| **Confirmation Corner (top-right viewport)** | None | **Missing** | The SolidWorks convention of a green-check / red-X at the *graphics-area corner* (in addition to in-dialog) does not exist. This is the most universally-recognized SolidWorks UX cue. |
| **Sketch auto-relations on hover** | `InteractiveSketch.js` / `SketchSolver.js` + `SwUxOverlays.jsx::AutoRelationIndicator` | **Done (Tier-1 #7)** | `InteractiveSketch._detectAutoRelation(cursorPos)` returns one of `horizontal/vertical/coincident/tangent/perpendicular/parallel` based on the active tool + 5° tolerance; published every move via `__archdiscSketchCursor.hint`. `AutoRelationIndicator` renders a colour-tinted icon next to the pointer. |
| **Sketch coordinate readout (bottom-left)** | `StatusBar.jsx` + `SwUxOverlays.jsx::SketchCursorReadout` | **Done (Tier-1 #4)** | `InteractiveSketch._publishCursor` fires from `onMouseMove` (u/v metres → x/y mm). `SketchCursorReadout` listens for `archdisc:sketch-cursor` and renders `X _ Y _ mm` pill at bottom-left next to the SketchStateBadge. Hides on sketch deactivate. |
| **Sketch color states (blue/black/red)** | `SketchSolver.signedDOF()` + `InteractiveSketch.applyDoFColouring()` + `SwUxOverlays.jsx::SketchStateBadge` | **Done (Tier-1 #3)** | The under-defined (blue) / fully-defined (black) / over-defined (red) color convention is wired through the solver. |
| **Dimension-driven editing (double-click dim to edit)** | `InteractiveSketch.editDimension(id, mm)` + `SwUxOverlays.jsx::DimensionEditorOverlay` | **Done (Tier-1 #6)** | `getDimensions()` returns dim id + value_mm + mid-world; `editDimension` mutates the distance / radius constraint in place + re-solves. `DimensionEditorOverlay` opens on `archdisc:edit-dimension`, anchors to the dim's screen-projected mid-point, commits on Enter, cancels on Esc. |
| **Equation Manager + Global Variables** | (none) | **Missing** | The course mentions equations as a parametric feature (`00:17:18`). |
| **Configurations + Design Tables** | Project Library has versions; but not per-feature configurations | **Missing** | |
| **Standard 3-View drag-and-drop in Drawing** | `DrawingPreviewPanel.jsx` + `kernel/drawing/DrawingEngine.js` | **Partial** | Drawing panel exists. SVG + PDF export shipped per MEMORY. **Gap:** drag-part-to-sheet → auto-generate 3-view layout interaction. |
| **BOM + Auto-Balloon** | Drawing/Annotation system | **Missing/Unknown** | Per MEMORY, drawings produce SVG+PDF; whether BOM-with-balloons is in there needs verification. |

### 6.2 — Sketch tool mapping

ArchDisc ribbon (`RibbonToolbar.jsx` Sketch tab) currently has: Line, Circle, Arc, Rectangle,
Polygon, Spline, Ellipse, Point, Trim, Extend, Offset, Mirror Sketch, Fillet Sketch + Dimension,
Horizontal, Vertical, Coincident, Parallel, Perpendicular, Tangent, Equal + Auto-Constrain.

| SolidWorks sketch tool | ArchDisc | Status |
|---|---|---|
| Line | Line | **Done** |
| Center Line | Center Line | **Done** (Tier-2a — dashed construction line entity) |
| Construction Line / For-Construction toggle | Toggle Construction | **Done** (Tier-2a — flips any entity's `isConstruction` flag) |
| Rectangle (5 types: corner / center / 3pt-corner / 3pt-center / parallelogram) | Rectangle + Center Rectangle | **Partial** — 2 of 5 variants exposed (Tier-2a added Center Rectangle); 3pt-corner / 3pt-center / parallelogram are follow-on |
| Slot (4 types: straight / center-point / 3pt-arc / center-arc) | None | **Missing** |
| Circle (center / 3pt-tangent) | Circle (single) | **Partial** — only one variant |
| Arc (3pt / tangent / center-point) | Arc (single) | **Partial** |
| Polygon (n-sides, inscribed/circumscribed) | Polygon | **Done** (verify the inscribed/circumscribed toggle) |
| Spline | Spline | **Done** |
| Ellipse (4 types) | Ellipse | **Partial** |
| Parabola | None | **Missing** |
| Text (along curve) | None | **Missing** |
| Point | Point | **Done** |
| Smart Dimension | Dimension | **Done** |
| Sketch Fillet | Fillet Sketch | **Done** |
| Sketch Chamfer | Sketch Chamfer | **Done** (Tier-2a) |
| Trim Entities | Trim | **Done** |
| Extend Entities | Extend | **Done** |
| Convert Entities (project edges to sketch) | Convert Entities | **Done** (Tier-2a) |
| Offset Entities | Offset | **Done** |
| Mirror Entities | Mirror Sketch | **Done** |
| Linear Sketch Pattern | (likely missing in Sketch tab; Linear Pattern in Part) | **Missing** at sketch level |
| Circular Sketch Pattern | (likely missing in Sketch tab) | **Missing** at sketch level |
| Move / Rotate / Copy / Scale / Stretch / Split Entities | Move / Rotate / Copy / Scale / Stretch (Tier-2c — `InteractiveSketch.moveEntities` / `rotateEntities` / `copyEntities` / `scaleEntities` / `stretchEntities`; ribbon Sketch→Transform group; selection-driven; solver re-solves after each transform). Split Entities still missing | **Partial** — 5 of 6 shipped; Stretch via explicit endpoint picks (not marquee-box selection idiom) |
| Fully Define Sketch | Auto-Constrain | **Done** (Auto-Constrain is the rough equivalent) |
| Display/Delete Relations | Display Relations dock | **Done** (Tier-2b — right-side dock lists every relation with named label + delete buttons) |
| 3D Sketch | (likely missing) | **Missing** |
| **Coincident, Horizontal, Vertical, Parallel, Perpendicular, Tangent, Equal, Concentric, Midpoint, Symmetric, Collinear, Fix** | Coincident, Parallel, Perpendicular, Tangent, Equal, Horizontal, Vertical + Concentric / Midpoint / Symmetric / Collinear / Fix (Tier-2b) | **Done** (Tier-2b — five named relations as user-applied constraints, with the solver Jacobian extended for Concentric and Collinear and the relation registry on InteractiveSketch) |

### 6.3 — Feature tool mapping

ArchDisc Part tab Create group has: Box, Cylinder, Sphere, Cone, Torus (primitives); Extrude
Boss, Extrude Cut, Revolve Boss, Revolve Cut, Loft Boss, Sweep Boss, Blade Row, Import STEP.
Modify group has: Fillet, Chamfer, Variable Radius Fillet, Shell, Hole Wizard, Draft, Offset
Shape, Scale, Subdivide, Volumetric Fillet, Smooth Fillet, Face Fillet, Full Round Fillet,
Corner Mitre.

| SolidWorks feature | ArchDisc | Status |
|---|---|---|
| Extruded Boss | Extrude Boss | **Done** |
| Extruded Cut | Extrude Cut | **Done** |
| Revolved Boss | Revolve Boss | **Done** |
| Revolved Cut | Revolve Cut | **Done** |
| Swept Boss | Sweep Boss | **Done** — verify supports arbitrary profile (per MEMORY "Strong for primitives + extrude/revolve; **Partial** for general profile sweep") |
| Swept Cut | (likely missing as named tool) | **Missing** — present as sweep + boolean? Needs verification |
| Lofted Boss | Loft Boss | **Done** |
| Lofted Cut | (likely missing as named tool) | **Missing/Unclear** |
| Boundary Boss | Boundary Boss (Tier 3a) | **Done (Tier 3a)** — ThruSections+SetSmoothing (G1) with optional PipeShell+auxiliary-spine guide path; honest fallback recorded on `meta.guideFallback` |
| Boundary Cut | (achieved via Boundary Boss + boolean subtract) | **Done (Tier 3a)** — Boundary Boss `role: 'cut'` flag is informational; cut semantics applied by subsequent boolean against parent body |
| Hole Wizard | Hole Wizard | **Done** (verify standards table) |
| Fillet — Constant | Fillet | **Done** |
| Fillet — Variable Radius | Variable Radius Fillet | **Done** |
| Fillet — Face Fillet | Face Fillet | **Done** |
| Fillet — Full Round | Full Round Fillet | **Done** |
| Chamfer | Chamfer | **Done** |
| Mirror Feature | Mirror Feature (Pattern group) | **Done** |
| Linear Pattern (feature) | Linear Pattern (Pattern group) | **Done** |
| Circular Pattern (feature) | Circular Pattern (Pattern group) | **Done** |
| Curve-Driven Pattern | (none) | **Missing** |
| Sketch-Driven Pattern | (none) | **Missing** |
| Table-Driven Pattern | (none) | **Missing** |
| Reference Plane | (likely accessed in sketch flow) | **Partial** — need a dedicated ribbon entry |
| Reference Axis | (none as ribbon item) | **Missing** |
| Coordinate System | (none) | **Missing** |
| Reference Point | (none) | **Missing** |
| Draft — Neutral Plane | Draft | **Partial** — verify the method options |
| Draft — Parting Line | (likely missing) | **Missing** |
| Rib | Rib (Tier 3a) | **Done (Tier 3a)** — thin block extruded from a sketched line and intersected against the parent body via BRepAlgoAPI_Common; SW canonical rib semantics |
| Shell | Shell | **Done** |
| Wrap (Emboss/Deboss/Scribe) | (none) | **Missing** |
| Dome | (none) | **Missing** |
| Free Form | (none) | **Missing** |
| Split (body) | (none — likely via boolean) | **Missing** as a named feature |
| Combine bodies | Combine / Subtract / Intersect (Boolean group) | **Done** |
| Helix and Curve | Helix (Tier 3a) | **Done (Tier 3a)** — real 3D helical curve sampled as a high-resolution polyline; kind='wire' SpineBody whose `meta.polyline` drives Sweep Boss for spring / screw thread workflows; constant or variable (linear-taper) pitch |

### 6.4 — Surfacing tool mapping

ArchDisc Part tab Surface group has: Thicken, Subdivide Surface, Catmull-Clark Subdivide, Retopo
Surface, NURBS Patch, Refine NURBS, Elevate NURBS, NURBS Curvature, Sweep Tortuous, Loft
Tangent, Stitch Faces, Convergent Solid, Surface-Surface Intersection, Trimmed NURBS Patch,
N-Sided Patch, G2 Blend, Class-A Analyze, Zebra Stripes.

| SolidWorks surface tool | ArchDisc | Status |
|---|---|---|
| Extruded Surface | `extrudedSurface` | **DONE (Tier-4)** — sheet-body prism of a wire (not a face); no caps; result kind='sheet' |
| Revolved Surface | `revolvedSurface` | **DONE (Tier-4)** — sheet-body revolve of a wire (not a face); no caps; result kind='sheet' |
| Swept Surface | Sweep Tortuous | **Partial** (different naming) |
| Lofted Surface | Loft Tangent | **Partial** |
| Boundary Surface | (none) | **Missing** |
| Filled Surface | N-Sided Patch / Trimmed NURBS Patch | **Partial** (different naming + abstraction) |
| Planar Surface | (none as named tool) | **Missing** |
| Free Form (surface) | (none) | **Missing** |
| Ruled Surface | (none) | **Missing** |
| Knit Surface | Stitch Faces | **Done** (different name) |
| Trim Surface | (kernel has BrepNurbsTrim; verify UI exposure) | **Partial** |
| Untrim Surface | (none) | **Missing** |
| Extend Surface | (none) | **Missing** |
| Delete Face | Delete Face (Direct Edit tab) | **Done** |
| Thicken | Thicken | **Done** |
| Zebra Stripes | Zebra Stripes | **Done** |
| Curvature analysis | NURBS Curvature | **Done** |
| Replace Face | Replace Face (Direct Edit tab) | **Done** |
| Move Face | Move Face (Direct Edit tab) | **Done** |
| Offset Face | Offset Face (Direct Edit tab) | **Done** |
| Push/Pull Face | Push/Pull Face (Direct Edit tab) | **Done** |

### 6.5 — Sheet Metal tool mapping

**Sheet Metal foundation shipped in Tier 5a (2026-05-24).** The dedicated
ribbon tab + the three foundational ops (Base Flange / Edge Flange /
Flat Pattern) ARE shipped; the rest of the SW sheet-metal toolset remains
queued for follow-on Tier-5 dispatches (a, b, c, ...).

| SolidWorks sheet-metal tool | ArchDisc | Status |
|---|---|---|
| Base Flange / Tab | Base Flange (Sheet Metal tab -> Create) | **Done** (Tier 5a) |
| Convert to Sheet Metal | None | **Missing** |
| Lofted Bend | None | **Missing** |
| Edge Flange | Edge Flange (Sheet Metal tab -> Bend) | **Done** (Tier 5a) |
| Miter Flange | Miter Flange (Sheet Metal tab -> Edge Features) | **Done** (Tier 5b) |
| Hem (4 variants) | Hem (Sheet Metal tab -> Edge Features) | **Done** (Tier 5b — Closed / Open / Rolled / Teardrop) |
| Jog | Jog (Sheet Metal tab -> Bend) | **Done** (Tier 5b — Z-step with 2 bend records) |
| Sketched Bend | Sketched Bend (Sheet Metal tab -> Bend) | **Done** (Tier 5b) |
| Closed Corner | None | **Missing** |
| Corner Trim / Corner Relief | None | **Missing** |
| Cross Break | None | **Missing** |
| Forming Tool | None | **Missing** |
| Sweep Flange | None | **Missing** |
| Rib (Sheet Metal) | None | **Missing** |
| Flat Pattern | Flat Pattern (Sheet Metal tab -> Manufacturing) | **Done** (Tier 5a) |
| K-Factor / Bend Allowance / Bend Deduction | K-Factor + bend-allowance formula | **Done** (K-factor; the bend-allowance + bend-deduction + gauge-table switches are follow-on Tier 5b) |
| Gauge Table | None | **Missing** |
| Auto-Relief | None | **Missing** |

The dedicated **Sheet Metal** ribbon tab (between Simulate and Drawing)
now exists with three groups: **Create** (Base Flange), **Bend** (Edge
Flange), **Manufacturing** (Flat Pattern). Sheet-metal-aware metadata
travels with every body created via these ops via
`body.metadata.sheetMetal = {thickness, kFactor, bendRadius, isFlat,
bends[]}`, and downstream ops can ASK whether a body is sheet metal via
`K.brep.isSheetMetal(body)`.

### 6.6 — Weldments mapping

**ArchDisc has a Weldments ribbon tab as of UX Tier 6a (3 foundational ops).**

| SolidWorks weldments tool | ArchDisc | Status |
|---|---|---|
| 3D Sketch | None (path supplied by start/end points in the dialog) | **Partial** — multi-segment paths via `window.__archdiscWeldmentPath` global override; full 3D-sketch UI is queued for Tier-6b |
| Structural Member (Standard → Profile → Size) | Structural Member | **DONE** (Tier 6a — `K.brep.structuralMember(path, {profile, size})`; standard ISO/ANSI profile library with ≥3 sizes per family) |
| Trim/Extend (weldment) | Trim/Extend Members | **DONE** (Tier 6a — `K.brep.trimMembers(members, {mode})`; butt + mitered modes; real boolean cut) |
| End Cap | End Cap | **DONE** (Tier 6a — `K.brep.endCap(member, end, {thickness})`; flat-cap prism + fuse) |
| Gusset | None | **Missing** — queued Tier-6b |
| Weld Bead | None | **Missing** — queued Tier-6b |
| Cut List | None | **Missing** — queued Tier-6b |
| Standard profile library (ANSI/ISO) | STANDARD_PROFILES (recttube/squaretube/roundtube/angle/channel/ibeam) | **Done — foundation** (3 ISO/ANSI sizes per family; custom profile import queued for Tier-6b) |

The dedicated **Weldments** ribbon tab (between Sheet Metal and Drawing)
now exists with three groups: **Members** (Structural Member),
**Trim** (Trim/Extend Members), **Caps** (End Cap). Weldment-aware
metadata travels with every body created via these ops via
`body.metadata.weldment = {profile, size, length, dims, trims[], caps[]}`,
and downstream ops can ASK whether a body is a weldment member via
`K.brep.isWeldment(body)`.

### 6.7 — Assemblies mapping

ArchDisc Assembly tab has: Insert Component, New Component, Move Component; Mates: Coincident,
Distance, Concentric, Angle; Exploded View, Interference, Mass Properties; Motion Study,
Assembly Animation.

| SolidWorks mate | ArchDisc | Status |
|---|---|---|
| Coincident | Coincident | **Done** |
| Parallel | Parallel Mate | **Done** (Tier-7a) |
| Perpendicular | Perpendicular Mate | **Done** (Tier-7a) |
| Tangent | Tangent Mate | **Done** (Tier-7a) |
| Concentric | Concentric | **Done** |
| Lock | Lock Mate | **Done** (Tier-7a) |
| Distance | Distance | **Done** |
| Angle | Angle | **Done** |
| Width (advanced) | Width Mate | **Done** (Tier-7b) |
| Symmetric (advanced) | (none) | **Missing** |
| Path (advanced) | Path Mate | **Done** (Tier-7b) |
| Linear-Coupler (advanced) | (none) | **Missing** |
| Distance-Limit (advanced) | Distance-Limit Mate | **Done** (Tier-7b) |
| Angle-Limit (advanced) | (none) | **Missing** |
| Gear (mechanical) | (none in UI; KinematicsCore has joint types) | **Partial** — kernel has it, no UI exposure |
| Hinge (mechanical) | (none) | **Missing** as a single combo-mate; user can fake with concentric+coincident |
| Cam (mechanical) | (none) | **Missing** |
| Rack-and-Pinion (mechanical) | (none) | **Missing** |
| Screw (mechanical) | (none in UI; KinematicsCore may have it) | **Missing** in UI |
| Universal Joint (mechanical) | (none) | **Missing** |
| **Fixed-component convention (`(f)` prefix on first inserted)** | Unknown | **Missing/Unverified** |
| Move Component | Move Component | **Done** |
| Component Pattern | (none — Linear/Circular Pattern of components specifically) | **Missing** |
| Toolbox (standard hardware library) | None | **Missing** |
| Smart Fastener | None | **Missing** |
| Configurations | None at part-level | **Missing** |

### 6.8 — Drawings mapping

ArchDisc Drawing tab has: Standard 3 View, Section View, Detail View, Isometric View; Smart
Dimension, Note, Balloon, GD&T Frame, Surface Finish; Export Assembly, Export STEP, Export PDF,
Export glTF.

| SolidWorks drawing element | ArchDisc | Status |
|---|---|---|
| Standard 3-View (drag part → 3-view auto-layout) | Standard 3 View | **Partial** — exists as tool, verify the drag-onto-sheet workflow |
| Projected View | (none — but implicit in 3-view) | **Missing** as separate tool |
| Section View | Section View | **Done** |
| Detail View | Detail View | **Done** |
| Isometric View | Isometric View | **Done** |
| Auxiliary View | Auxiliary View (Tier 8a) | **Done** — projects perpendicular to caller-supplied face normal; renders FRONT thumb + projection-arrow + AUX view on one A4 sheet |
| Crop View | Crop View (Tier 8a) | **Done** — SVG `<clipPath>` clips a FRONT projection to a rectangle, reversible |
| Broken View | Broken View (Tier 8a) | **Done** — left+right zones with a zig-zag indicator; exact `(left+right) == drawn` numerical identity |
| Model View | (likely implicit) | **Partial** |
| Smart Dimension | Smart Dimension | **Done** |
| Note | Note | **Done** |
| Balloon | Balloon | **Done** — Auto-Balloon shipped in Tier 8b |
| BOM | BOM (Tier 8b) | **Done** — real 5-column SVG table (Item / Part Number / Description / Quantity / Material); auto-merges identical part numbers |
| Title Block / Sheet Format edit | (likely missing) | **Missing** |
| Sheet Size (A3/A4/ISO) | Unknown | **Missing/Unverified** |
| GD&T Frame | GD&T Frame | **Done** |
| Surface Finish | Surface Finish | **Done** |
| Model Items (auto-import dims) | Model Items (Tier 8b) | **Done** — walks the part's feature history and emits dimensions for sketchRectangle/Circle, extrude, cut, revolve, fillet, chamfer, circularPattern, linearPattern |
| Auto-Balloon (one-click) | Auto-Balloon (Tier 8b) | **Done** — radial layout around assembly centroid with 30° slot overlap-bump |

### 6.9 — Mold Tools mapping

**ArchDisc ships a dedicated Mold Tools workbench (UX Tier 9 foundation — Mold Tools ribbon
tab between Weldments and Drawing, kernel ops in `kernel/brep/BrepMoldTools.js`).**

| SolidWorks mold tool | ArchDisc | Status |
|---|---|---|
| Draft Analysis | Draft Analysis (Tier 9) | **Done** — per-face draft classification via SP-4 `evalSurface`; faces tagged with `mold.draft` SP-2 attr + body `metadata.mold.draftAnalysis` |
| Undercut Analysis | (deeper detection) | **Missing** — queued Tier 9b |
| Parting Line | Parting Line (Tier 9) | **Done** — silhouette curve: walks every edge, classifies as parting iff its two adjacent faces have opposite draft signs (or one positive + one vertical) |
| Shut-Off Surfaces | (none) | **Missing** — queued Tier 9b |
| Parting Surface | (planar parting plane via Tooling Split) | **Partial** — planar parting plane shipped via Tooling Split (perpendicular to pull at body centroid); ruled / curved parting surface queued Tier 9b |
| Tooling Split | Tooling Split (Tier 9) | **Done** — splits body via two complementary half-space cuts (CORE = above parting plane, CAVITY = below); also records SP-5 `partition` attempt for completeness |
| Core feature | Core piece labelled `mold.half='core'` | **Done** (via Tooling Split) |
| Cavity feature | Cavity piece labelled `mold.half='cavity'` | **Done** (via Tooling Split) |

---

## 7. Headline gap list — steering input for the UI/UX-fully-equipped track

These are the gaps a SolidWorks user would notice in the first 30 minutes of using ArchDisc.
Prioritized roughly by impact on first-touch usability:

### Tier 1 — Universal SolidWorks conventions ArchDisc lacks (do these first)

1. **Confirmation Corner** (top-right of viewport) — the universal green-check / red-X cue
   — **DONE** (`SwUxOverlays.jsx::ConfirmationCorner`, e2e `ux-tier1-electron`)
2. **PropertyManager docked left** (replacing the design tree when a tool is active), with
   collapsible sections (Direction-1, Selection, Options, Draft)
   — **DONE** (`SwUxOverlays.jsx::PropertyManagerDock`; 13 tools migrated via `DOCKED_TOOLS`
   set; floating dialog stays as fallback for the rest. Sections currently INPUTS + OPTIONS
   placeholder — Direction-2 / Draft / Merge sections to come in Tier-2)
3. **Sketch under-defined (blue) / fully-defined (black) / over-defined (red) color states** —
   the single most-recognized SolidWorks sketch UX
   — **DONE** (`SketchSolver.signedDOF()` added, `InteractiveSketch.applyDoFColouring()` walks
   the sketch group and recolours line/circle/arc entities; bottom-left
   `SketchStateBadge` mirrors the state textually. Verified in e2e A1→A2→A3 frames)
4. **Sketch live coordinate readout** at bottom-left while drawing — **NOT THIS PASS**
5. **Heads-up View Toolbar** at top of viewport: Zoom-to-Fit, Zoom-to-Area, Section View, View
   Orientation, Display Style, Normal-To
   — **DONE** (`SwUxOverlays.jsx::HeadsUpViewToolbar`). Honest gap: **Zoom-to-Area** falls
   back to focus-on-selection (no marquee-drag hook exposed); **Section View** flips
   display-mode to X-Ray as the minimum visible effect because no foundation section-clip
   primitive is exposed yet — both noted in code comments
6. **Double-click-dimension-to-edit** — **NOT THIS PASS**
7. **Auto-relations icon on cursor** — **NOT THIS PASS**
8. **`(f)` fixed-component prefix** on first-inserted assembly component — **NOT THIS PASS**
9. **Right-click conventions in FeatureManager** — **NOT THIS PASS**
10. **Rollback bar** in the FeatureManager Design Tree — **NOT THIS PASS**

**Tier-1 status:** 4 / 10 done in this pass (the four highest-impact universals). Items 4 / 6
/ 7 / 8 / 9 / 10 are the remaining Tier-1 backlog.

### Tier 2 — Missing sketch tools

11. **Center Line** (as a distinct tool, not just Line) — **DONE** (Tier-2a:
    `InteractiveSketch._createCenterLine`, `TOOLS.CENTER_LINE`, ribbon "Center Line"
    in Sketch→Draw; renders dashed purple via `LineDashedMaterial`; `isConstruction:
    true` excludes it from `getSolidProfile()`)
12. **"For construction" toggle** on every sketch entity — **DONE** (Tier-2a:
    `InteractiveSketch.setEntityConstruction()` flips an entity's
    `isConstruction` flag; ribbon "Toggle Construction" in Sketch→Modify reads the
    selection (`__archdiscSelectedSketchEntities`) or the last entity)
13. **Multiple rectangle variants** (center-point, 3-point corner, 3-point center,
    parallelogram) — **PARTIAL** (Tier-2a: Center Rectangle variant shipped as
    `_createCenterRectangle` + ribbon entry. 3-point variants + Parallelogram are
    follow-on)
14. **Slot tool** (straight, center-point, 3-point-arc, center-point-arc) — 4 variants
15. **Multiple circle variants** (center vs 3-point-tangent)
16. **Multiple arc variants** (3-point, tangent, center-point)
17. **Parabola tool**
18. **Text tool** (along a curve)
19. **Sketch Chamfer** — **DONE** (Tier-2a: `_createSketchChamfer(line1Idx,
    line2Idx, distance)` trims both source lines at `distance` from their shared
    corner and inserts a new chamfer segment; selection-driven + param-dialog-driven
    via the PropertyManager dock; e2e asserts the corner is replaced)
20. **Convert Entities** (project edges to active sketch plane — CRITICAL for
    sketch-on-face) — **DONE** (Tier-2a: `InteractiveSketch.convertEntities(sources,
    {isConstruction, fixedToSource})` projects line/arc/circle/spline 3D segments to
    the active sketch plane; `InteractiveSketch.extractFaceBoundary(group, {z})`
    walks a Three.js group's mesh and emits the boundary edges at a target Z as
    world-space segments; ribbon "Convert Entities" in Sketch→Modify wires both via
    the body registry; **HONEST PARTIAL**: spline edges convert to a piecewise-line
    approximation, NOT a true NURBS sketch entity; off-plane edges project as the
    planar projection (correct semantics, mirrors SW))
21. **Linear / Circular Sketch Pattern** (at sketch level, not just at feature level)
22. **Move / Rotate / Copy / Scale / Stretch Entities** as sketch tools
23. **Display/Delete Relations** dialog
24. **3D Sketch mode**
25. **Concentric / Midpoint / Symmetric / Collinear / Fix** as named sketch relations

### Tier 3 — Missing feature tools

26. **Boundary Boss / Boundary Cut** — **DONE (Tier 3a)** — `K.brep.boundaryBoss({profiles, guides, smooth, role})`; OCCT binding via `BRepOffsetAPI_ThruSections.SetSmoothing(true)` for G1 tangency between sections; guide curves attempted via `BRepOffsetAPI_MakePipeShell.SetMode_5(auxiliary)` with honest fallback to ThruSections+SetSmoothing when the auxiliary-spine binding rejects the configuration. `meta.guideFallback` records which path was taken. Cut variant is informational — Boundary CUT semantics applied by subsequent boolean against parent body.
27. **Curve-Driven Pattern** and **Sketch-Driven Pattern**
28. **Reference Plane / Axis / Coordinate System / Point** as first-class ribbon tools
29. **Rib feature** — **DONE (Tier 3a)** — `K.brep.rib({body, line, thickness, extrudeHeight, planeNormal, direction})`; the sketched line is extruded thick into a rectangular block then BRepAlgoAPI_Common-intersected with the parent body so only the volume INSIDE the body remains (SW canonical rib semantics). Lineage from the parent body's face/edge ids propagates via the intersection's history.
30. **Wrap** (Emboss/Deboss/Scribe onto curved face)
31. **Dome**
32. **Free Form** (face-deformation by curves+points)
33. **Split body** as a named feature (separate from boolean)
34. **Helix and Curve** as a user-facing tool (kernel may already support it for turbomachinery) — **DONE (Tier 3a)** — `K.brep.helix({diameter, pitch, revolutions, direction, axisOrigin, axisDirection, segmentsPerRev})`; constant pitch via single `pitch` or variable pitch via `pitchStart`/`pitchEnd` for a linear taper. Returns a `kind='wire'` SpineBody whose `meta.polyline` drives a subsequent `sweepProfile` (spring/screw thread workflow). Closed-form arc length = `revs · sqrt(pitch² + (π·D)²)` reported on `meta.length.expected`.
35. **Draft — Parting Line method** (the "hinge axis" variant of Draft)
36. **Swept Cut / Lofted Cut** as named features (currently fall-through to sweep+boolean)

### Tier 4 — Missing surfacing tools (named variants)

37. **Extruded / Revolved Surface** as named ops (separate from solid extrude/revolve) — **DONE (Tier-4)** — `K.brep.extrudedSurface(wire, depth, {direction})` + `K.brep.revolvedSurface(wire, axis, angle)`; prism/revolve the WIRE (not a face) → sheet body of lateral / SOR faces with no caps; result kind='sheet'. Ribbon Part→Surface entries; param dialogs in DOCKED_TOOLS
38. **Boundary Surface**
39. **Filled Surface** (with the simple n-sided / planar variants explicitly named)
40. **Planar Surface**
41. **Free Form (surface)**
42. **Ruled Surface**
43. **Untrim Surface**
44. **Extend Surface**

### Tier 5 — Missing workbench: Sheet Metal (entire ribbon tab + kernel)

The single largest gap. Needs:
- Sheet Metal ribbon tab
- Sheet-metal-aware body kind (sheet body with bend regions)
- Base Flange / Edge Flange / Miter / Hem / Jog / Sketched Bend / Closed Corner / Corner Trim /
  Cross Break / Forming Tool / Sweep Flange / Rib (sheet-metal version)
- Convert to Sheet Metal / Lofted Bend
- Flat Pattern (unfold)
- K-factor / Bend Allowance / Bend Deduction / Bend Table / Gauge Table
- Forming Tools library

### Tier 6 — Weldments workbench (Tier 6a foundation shipped; remainder queued)

- ~~Weldments ribbon tab~~ — **DONE** (Tier 6a; alongside Part / Assembly / Drawing / Sheet Metal / Simulate)
- 3D Sketch (likely reused from sheet-metal) — **Partial** (path supplied via dialog start/end points or `window.__archdiscWeldmentPath` global; full 3D-sketch UI queued)
- ~~Structural Member tool with Standard (ANSI/ISO) → Profile type → Size selection chain~~ — **DONE** (Tier 6a; sweep along 3D path with standard ISO profile)
- ~~Standard profile library (ANSI/ISO/DIN angle-iron, channel, square-tube, pipe, etc.)~~ — **DONE** (Tier 6a; 6 families × 3 sizes minimum: rect/square/round tube + angle + C-channel + I-beam IPE)
- ~~Trim/Extend Members~~ — **DONE** (Tier 6a; butt + mitered modes via real boolean cut)
- ~~End Cap~~ — **DONE** (Tier 6a; flat-cap prism + fuse; thickness option)
- Gusset, Weld Bead — **Missing** (queued Tier-6b)
- Cut List (auto BOM-like list of all members + lengths) — **Missing** (queued Tier-6b)
- Cope Cut (cylindrical-tube saddle cut) — **Missing** (queued Tier-6b)
- Sub-Weldment + Custom Profile Import — **Missing** (queued Tier-6b)

### Tier 7 — Missing assembly capabilities

- ~~**Parallel, Perpendicular, Tangent, Lock** standard mates~~ — **DONE** (Tier-7a;
  ribbon Assembly→Mates entries + selection-driven param-dialog handlers; real solver
  equations in `kernel/assembly/MateSolver.js` + kernel-free residual helpers in
  `foundation/KinematicsCore.js`; DOF accounting parallel=2, perpendicular=1,
  tangent=1, lock=6)
- ~~**Width / Path / Distance-Limit** advanced mates~~ — **DONE** (Tier-7b;
  ribbon Assembly→Mates entries + selection-driven param-dialog handlers; real
  solver equations in `kernel/assembly/MateSolver.js` Tier-7b satisfiers
  + kernel-free residual helpers in `foundation/KinematicsCore.js`;
  DOF accounting width=1, path=2, distanceLimit=0-in-slack / 1-when-clamped)
- Remaining Advanced mates: Symmetric, Linear-Coupler, Angle-Limit
- All Mechanical mates exposed in UI: Gear, Hinge, Cam, Rack-and-Pinion, Screw, Universal Joint
  (kernel KinematicsCore has joint types; needs UI exposure)
- **Component Pattern** (Linear/Circular/Mirror of components, not just features)
- **Toolbox** — standard hardware library (bolts, screws, washers, nuts, bearings) with
  smart-fastener auto-insert
- **Configurations** at part and assembly level (variants)
- Fixed-component `(f)` convention + drag-to-floor / drag-from-floor

### Tier 8 — Missing drawing capabilities

- ~~**Auxiliary View** (view normal to an inclined edge)~~ — **DONE** (Tier 8a; ribbon Drawing→Auxiliary View; projection along caller-supplied face normal)
- ~~**Crop View** (close-profile + crop)~~ — **DONE** (Tier 8a; ribbon Drawing→Crop View; SVG `<clipPath>` reversible clipping)
- ~~**Broken View** (spline-defined break, for long parts)~~ — **DONE** (Tier 8a; ribbon Drawing→Broken View; zig-zag break-line, exact `(left+right) == drawn` arithmetic)
- ~~**Model Items** annotation (auto-import all part dimensions onto the drawing)~~ — **DONE** (Tier 8b; ribbon Drawing→Annotate→Model Items; walks Part.features and emits per-parameter dimension annotations with auto-placed leader lines)
- ~~**BOM** (Annotation→Tables→Bill of Materials)~~ — **DONE** (Tier 8b; ribbon Drawing→BOM→BOM; reads body-level attributes from the BodyRegistry; auto-merges identical part numbers)
- ~~**Auto-Balloon** (one-click balloons for all components linked to BOM)~~ — **DONE** (Tier 8b; ribbon Drawing→BOM→Auto-Balloon; radial placement around assembly centroid with overlap-bump)
- **Title Block / Sheet Format** edit
- **Sheet Size** dialog (A4/A3/A2/A1/Letter/etc., ISO/ANSI standards)

### Tier 9 — Mold Tools workbench

- ~~Mold Tools ribbon tab~~ — **DONE** (Tier 9; new TAB between Weldments and Drawing)
- ~~Draft Analysis (color-coded faces by pull-direction draft)~~ — **DONE** (Tier 9; per-face classification via SP-4 evalSurface; faces tagged `mold.draft` SP-2 attribute; positive=green / negative=red / vertical=yellow)
- **Undercut Analysis** — queued Tier 9b (deeper "stuck face" detection across multiple pull directions)
- ~~Parting Line~~ — **DONE** (Tier 9; silhouette curve trace via adjacent-face draft-sign comparison)
- **Shut-Off Surfaces** — queued Tier 9b (close through-holes for a manifold mold block)
- **Parting Surface** (proper ruled / swept) — queued Tier 9b (currently shipped as planar parting plane via Tooling Split)
- ~~Tooling Split~~ — **DONE** (Tier 9; splits body into core + cavity halves via two complementary half-space cuts; uses SP-5 partition path as an additional record)
- ~~Core / Cavity features~~ — **DONE** (Tier 9; pieces labelled `mold.half = 'core' | 'cavity'` via SP-2 attribute on the spine body)

### Tier 10 — Parametric infrastructure

- **Equation Manager / Global Variables** — referenced as a dimension control mechanism but
  no dedicated tool
- **Design Tables** (Excel connection for parameter sweeps)
- **Configurations** (already in Tier 7)

---

## 8. Suggested mapping onto the existing parity program (`§5` of `2026-05-21-kernel-parity-program.md`)

The parity program already commits to a UI-contract per kernel op (ribbon tool + dialog +
selection-driven + headed e2e). This synthesis adds three orthogonal UI tracks that don't fit
into per-kernel-op delivery:

- **UI-T1 — SolidWorks-conventions track.** Tier 1 items above (confirmation corner, sketch
  color states, heads-up viewer toolbar, PropertyManager docking, fixed-component prefix). These
  are universal CAD UX cues that apply across all ops. Estimated ~2 weeks of focused work.
- **UI-T2 — Sheet-metal workbench.** Tier 5. New ribbon tab + new kernel module (sheet bodies,
  bend regions, K-factor math, unfold). Substantial — its own sub-project. The parity program
  Area G ("sheet & tolerant modeling") partly covers this kernel-wise.
- **UI-T3 — Weldments workbench.** Tier 6. New ribbon tab + structural-profile library + cut-list
  generator. Smaller than sheet-metal but still its own sub-project.

The other tiers (2, 3, 4, 7, 8, 9, 10) are largely *additions to existing tabs* and fit into
the parity program's per-op UI contract, just with a much longer list of ops to ship.

---

## 9. Honest caveats

This synthesis was extracted from YouTube auto-generated English captions, with the following
quality issues that affect the timestamps and exact tool names:

- **Auto-caption mishears:**
  - "Solid Works" sometimes "solid wars", "solid wall", "solid ware"
  - "Loft" sometimes "lift", "lifted", "lift" — the actual ops are loft/lofted
  - "Weldments" sometimes "wellments", "wel band", "wilmans", "wel m" — all are weldments
  - "Mate" sometimes "m", "may", "made", "mit", "min" — every "advanced m" or "mechanical m"
    in the transcript is "mate"
  - "Mold" sometimes "mood", "more" (the very common "more tools" should be "mold tools")
  - "Hem" sometimes spelled out; the "joke" feature is **Jog**, not "joke"
  - "Sweep" sometimes "swift" / "swifting"
  - "Gusset", "End Cap", "Weld Bead", "Smart Fastener", "Cosmetic Thread", "Design Table" —
    *I did not find clean transcript hits for these as named tools*. They may be taught under
    auto-captioned mishears or genuinely skipped. Verify the Weldments tutorials (#96–#106)
    by re-listening or with manual captions if available.

- **Tutorial-number boundaries:** the transcript's tutorial-number mentions are sparse (62 of
  ~187 explicit; the rest must be inferred from `"In this tutorial we will talk about..."`
  patterns). Section starts are reasonably accurate to ±30 seconds.

- **Worked-example identification:** the course mentions some examples (e.g. "exhaust manifold")
  that did *not* surface in my keyword scan — they may be referenced verbally without the term
  appearing in the auto-caption. The list in §5 is high-confidence but probably non-exhaustive.

- **Two tutorial-number ranges feel under-sampled:** #41–#65 (between fillet and surfacing) and
  #98–#121 (between Weldments end and Sheet Metal start — covers Assemblies / Drawings). These
  sections were inferred from topic keywords, not explicit "Tutorial NN" markers. The course is
  numbered through #145 for Level 1, but my scan only caught 62 explicit numerical mentions in
  the body of the transcript.

- **ArchDisc current-state mapping:** the "Status" column is based on a quick scan of
  `RibbonToolbar.jsx` and the directory listing of `frontend/src/kernel/`. Items marked
  "**Partial**" or "**Done**" may need deeper verification — e.g. multiple rectangle variants
  may be hidden inside the single "Rectangle" tool dialog; the underlying kernel `BrepNurbsTrim`
  may already cover Untrim. The list is a roadmap, not a definitive audit.

- **SolidWorks 2014 vs newer:** the course is from 2014. Several modern SolidWorks features
  (e.g. `Asset Publisher`, `MBD` for model-based definition, modern `Surface Flatten`, the
  improved `Hole Series`, the Direct Edit / Synchronous workflow that newer SW has) are not in
  this course. ArchDisc may already exceed 2014-era SolidWorks in some areas (Direct Edit tab,
  topology subdivision) — and may genuinely lack things that newer SW has too.

- **Section transitions are smooth, not sharp:** the instructor often spends 1-3 tutorials of
  recap when introducing a new section. Timestamps marked as the start of a major section are
  the *first explicit mention* of the new topic, not the end of the previous one.
