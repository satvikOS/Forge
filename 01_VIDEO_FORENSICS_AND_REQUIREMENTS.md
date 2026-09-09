# Video Forensics and Competitive Requirements

## Method

Ten uploaded clips were decoded frame-by-frame: **8,607 frames total**. Each frame was scored for pixel change, histogram shift, edge density, focus, and brightness. Major visual changes were used as anchors for manual visual inspection, while continuous-motion regions were inspected through representative frames. The companion file `ArchDisc_All_8607_Frame_Metrics.csv` contains the per-frame measurements.

This report is a **visual forensic analysis**. On-screen text is included when readable. The audio tracks were present, but this environment did not provide a reliable speech-recognition model, so this document does not pretend to be a verbatim audio transcript.

## Clip 1 — Video-45938.mp4 — W16 prompt-to-CAD/animation claim

**Duration:** 16.37 s, 491 frames.

On-screen claim: “fable 5.1 one shotting a quad-turbo W16 engine (this is a full CAD model + animation).”

The clip moves from an intact dense engine to closer internal views, then to disassembled/exploded groupings, and finally back toward a coherent engine representation. The important signal is not the social-media claim. The engineering requirement is that the generated artifact can expose internal mechanical structure, preserve assembly identity, support exploded states, and animate kinematic relationships.

**Forge requirements extracted:**
- Component-instance hierarchy rather than a single monolithic solid.
- Repeated cylinder-bank structures represented through patterns/instances.
- Crank/rod/piston kinematic constraints with explicit degrees of freedom.
- Configurable exploded-state transforms that do not mutate design geometry.
- Animation derived from assembly constraints, not keyframed visual fakery.
- Interference/contact checks over the swept motion envelope.
- Feature/part IDs stable while the assembly is exploded or animated.
- Motion capture output that can be used by CAE, not only rendering.

## Clip 2 — Video-36657.mp4 — ultra-detailed aircraft engine

**Duration:** 43.77 s, 1,313 frames.

On-screen text: “POV: You spent 2 weeks modeling this aircraft engine.”

This is the strongest clip for **detail-density requirements**. The model contains repeated fasteners, housings, cylinders, cooling fins, hoses/tubes, fittings, brackets, covers, flanges, patterned bolts, routed lines, and dense ancillary components. The camera spends long continuous stretches close to the model, so defects would be visible.

The lesson for Archie is that “complexity” should not mean generating every bolt independently. A high-detail engine should be planned as reusable parametric families and assembly instances.

**Forge requirements extracted:**
- Standard-part and fastener library with procedural instancing.
- Pattern features for radial, linear, mirror and table-driven repetition.
- Routed pipe/hose/wire subsystem with bend radius, fittings, clamps and endpoints.
- Thread representation with selectable semantic/lightweight/explicit geometry modes.
- LOD representations: full B-Rep, defeatured B-Rep, tessellated proxy, bounding proxy.
- Feature suppression/configuration states for performance.
- Material/finish/appearance metadata separated from geometry.
- Local detail streaming so close-up inspection does not require keeping every full-detail representation hot.
- Recompute graph capable of propagating a base dimension change into repeated instances without rebuilding unrelated systems.

## Clip 3 — Video-76466.mp4 — Blender used as CAD + jet-engine render

**Duration:** 34.20 s, 1,026 frames.

On-screen text: “When you love aviation but Blender is your CAD.”

The first section shows layered, color-coded internal structural/routing geometry and dense node/curve-like construction. The second section transitions to a highly polished jet/afterburner visualization with animated exhaust.

This clip is a warning: **visual sophistication and engineering CAD are not the same thing.** Forge should match the visual/simulation communication quality while retaining engineering semantics.

**Forge requirements extracted:**
- Explicit distinction between B-Rep/parametric truth and render mesh.
- Non-destructive tessellation cache generated from authoritative geometry.
- Routing and systems models that can coexist with mechanical B-Rep.
- Material/thermal/flow visualization layers.
- Transient-field playback and animated result visualization.
- High-quality local rendering without converting the design into a mesh-only dead end.
- Import of mesh references as references/reconstruction inputs, never silently promoted to editable parametric truth.

## Clip 4 — Video-50455(1).mp4 — SolidWorks AI engineering companion

**Duration:** 47.73 s, 1,432 frames.

The clip shows a SolidWorks assembly and a chat-based engineering assistant. The user asks how to optimize assembly performance; the assistant identifies categories such as high triangle/feature burden and suggests simplification. Later frames show component selections and an optimization/simplification operation over the assembly.

This is the most directly relevant interaction model for Archie, but Forge should go deeper: advice must resolve into typed, inspectable changes.

**Forge requirements extracted:**
- “Explain -> identify -> propose -> preview -> apply -> verify” semantic-edit loop.
- Assistant can query feature count, face count, tessellation cost, suppressed state, mates, mass properties and dependencies.
- Advice contains exact target object IDs and expected effect.
- Simplification is reversible and configuration-scoped.
- Defeaturing recognizes threads, tiny holes, logos, cosmetic grooves and low-value details.
- Before/after metrics: B-Rep faces, triangles, memory, recompute time, file size and visual error.
- No mouse-driving. AI must call typed operations such as `SuppressFeature`, `CreateSimplifiedRep`, `ReplaceWithProxy`, `RemoveCosmeticThread`.

## Clip 5 — Video-41710(1).mp4 — vehicle/suspension assembly and in-context part editing

**Duration:** 64.70 s, 1,941 frames.

The clip traverses a mechanical vehicle/frame assembly, repeatedly zooming into wheel/hub/suspension elements, then isolates and edits an individual link/control-arm-like component while retaining assembly context.

**Forge requirements extracted:**
- Edit-part-in-context without losing parent assembly references.
- Per-component local coordinate systems and robust transforms.
- Hierarchical component tree with fast isolate/show/hide.
- Reference geometry across parts with explicit ownership.
- Stable mates/joints when a part feature changes.
- Replace/revise component while preserving compatible references.
- Semantic selection: “front-left upper control arm” resolves through assembly graph, not screen position.
- Incremental collision/interference detection after local edits.

## Clip 6 — Video-43612(1).mp4 — robotic arm: model, drawing, exploded view and kinematics

**Duration:** 25.57 s, 767 frames.

The clip starts with an assembled robot arm, switches to a drawing/BOM representation, shows an exploded state, returns to multiple arm poses, and finishes with close-up gripper motion.

This is a direct product doctrine: **one source model, many authoritative engineering views.**

**Forge requirements extracted:**
- Associative 2D drawings generated from the same 3D feature/assembly graph.
- BOM balloons and quantities tied to stable component IDs.
- Exploded views as named presentation states.
- Joint limits, motion envelopes and collision validation.
- Gripper subassembly modeled with constrained mechanism semantics.
- Drawing dimensions update when geometry changes.
- Export package can include 3D CAD, drawings, BOM, motion study and engineering report from one project state.

## Clip 7 — Video-61709(1).mp4 — progressive aircraft assembly

**Duration:** 17.43 s, 523 frames.

The model progresses from fuselage to tail, wings, engines, landing gear and the full airliner.

**Forge requirements extracted:**
- Hierarchical staged build plans.
- Symmetry/mirror operations for wings, engines and gear where appropriate.
- Configurable subassembly activation.
- Progressive recompute and progressive loading.
- Top-level assembly plan that can be generated before every detail exists.
- Ability for Archie to scaffold placeholders with explicit `UNRESOLVED` status, then replace them with verified parts without breaking references.

## Clip 8 — Video-3097(1).mp4 — drawing to SolidWorks CAD

**Duration:** 11.10 s, 333 frames.

On-screen text: “Fable 5.1 turning a drawing into CAD on SolidWorks.”

The sequence visibly moves from a technical drawing to a sketch/profile, then additional cutouts/holes/features and a completed 3D part.

**Forge requirements extracted:**
- Orthographic-view parsing.
- Dimension, unit, tolerance and datum extraction.
- Cross-view correspondence between front/top/side/detail views.
- Sketch entity reconstruction with geometric constraints.
- Feature-sequence inference: base profile -> extrude/revolve -> holes/cuts -> fillets/chamfers -> secondary detail.
- Validation by re-projecting the generated model into the source drawing views and measuring discrepancy.
- Confidence map for every inferred dimension/feature; uncertain values must be surfaced, not invented silently.

## Clip 9 — Video-39146.mp4 — V8 “fully working model in under 10 minutes” claim

**Duration:** 11.00 s, 330 frames.

The image is mostly stable and shows an engine assembly inside a CAD-like environment plus the on-screen claim: “claude fable 5 has solved CAD… fully working model in under 10 minutes.”

The clip is evidence of a claim, not proof of engineering correctness. It does not independently establish dimensional accuracy, feature-history quality, manufacturability, constraint validity, topology stability, or editable semantics.

**Forge response:**
- Never optimize the benchmark for social-media appearance.
- Record wall-clock generation time, but gate success first on kernel validity.
- Verify feature history, constraints, B-Rep validity, motion, edits and exports.
- Re-open exported STEP and compare geometry.
- Apply adversarial edits to generated models to prove semantic editability.

## Clip 10 — Video-99642(1).mp4 — CATIA-scale truck assembly

**Duration:** 15.03 s, 451 frames.

The clip shows a very large, color-coded truck assembly: detailed cab/interior, rear chassis, drivetrain, wheels, engine/front systems and dense subassemblies.

This clip defines the **large-assembly performance ceiling**.

**Forge requirements extracted:**
- Multi-level assembly tree and branch loading.
- Out-of-core/lightweight representations.
- GPU instancing and batched draw submission.
- Frustum/occlusion culling and screen-space LOD.
- Load-on-selection of exact B-Rep while the rest remains lightweight.
- Background tessellation and cache warming.
- Independent geometry ownership and render-cache ownership.
- Search by part number, semantic name, subsystem, material or function.
- Massive-BOM handling without UI tree stalls.
- Selection/picking that remains stable under LOD changes.

## Cross-video conclusion

The common target is not “text to 3D.” It is:

**intent/drawing/import -> engineering plan -> persistent parametric model -> assembly semantics -> validation -> dynamic behavior -> drawings/CAE/CAM/DFM -> editable/exportable artifact.**

The videos repeatedly expose six capabilities that should become explicit benchmark families:

1. High-detail parametric generation.
2. Drawing-to-editable-CAD reconstruction.
3. Existing-CAD semantic editing.
4. Assembly hierarchy and mechanism motion.
5. Large-assembly performance.
6. Engineering copilot reasoning that resolves into exact deterministic operations.

A video is a demonstration surface. Forge’s internal evidence must be stronger than the video: transaction logs, typed plans, solver checks, B-Rep validation, recompute traces and round-trip export tests.
