# Op-family census — MESH / POLYGON, DRAWING / DRAFTING, MEASUREMENT / ANALYSIS

**Pinned base:** `a457bea2` (`origin/claude/sacrosanct-execution-20260828`), 2026-08-31.
Every `file:line` below is a line in **this tree at that SHA**. A citation that
cannot be resolved there is a citation to a different tree and should be
rejected.

**Scope.** Three families. The families already assigned elsewhere — SURFACE as
an IR value kind, Class A/B/C/D surfacing, SubD/free-form, wireframe/curve/BRep/
solid op families, and UI commands for the solid primitives — are **not**
re-censused here. Where one of them is load-bearing for a family of mine
(`zebraStripes` and `gaussianAndMeanCurvature` are surfacing functions that are
also *analysis* capabilities) it is named, cited, and explicitly deferred.

---

## Method, and what is VERIFIED vs. what is READ

Three evidence levels are used, and rows say which.

* **MEASURED** — I ran it. Transcript in Appendix A. The binary used was
  `forge-kernel/build-fixcheck/forge_verify` in the **shared** checkout (built
  2026-08-29), because no `forge_verify` exists in this worktree and a fresh OCCT
  link on a Mac shared with ~8 agents is not a defensible cost. That binary is
  **newer than the pinned base** — it accepts two `VERIFY` quantities
  (`bodies`/`components`/`parts`, `interference`/`interferenceVolume`) that do
  **not** exist at `a457bea2`. Every MEASURED claim was cross-checked against the
  pinned source so the behaviour asserted is identical in both trees; where the
  binary is ahead, that is stated and the pinned behaviour is what is reported.
* **VERIFIED (source)** — I read a named function with a real body and traced it
  to (or proved the absence of) a call site. Not a grep count.
* **READ** — a header contract, used only where the header *is* the fact.

Two findings from the method itself, up front, because they change how the tables
should be read:

1. **A grep hit for a panel is not a panel.** `forge-desktop` names **50** dock
   panels including `sheet_canvas`, `view_list`, `annotation`, `title_block`,
   `gdt`, `zebra_analysis`, `interference`, `dimensions`. `ForgeFrame::drawPanel`
   (`forge-desktop/src/ForgeFrame.cpp:1406`) dispatches exactly **seven** panel
   bodies. Everything else falls to `drawGenericPanel`
   (`forge-desktop/src/ForgeFrame.cpp:2134`), which prints *"Its content is not
   implemented in this segment."* Of the eight panels in
   `WorkspaceProfile::Drawing` (`ui/src/WorkspaceProfile.cpp:97-101`), **five**
   are that placeholder.
2. **A test gate proves the code is real; it does not prove anything calls it.**
   `forge-kernel/test/native/mesh/` holds 26 gate files (25 per-module tests plus
   `mesh_gate.cpp`), all compiled and run by
   `forge-kernel/test/native/run_native.sh`, which CI invokes
   (`.github/workflows/kernel-tests.yml:99`). So the 12,720 LOC of native mesh
   machinery is real code passing real tests. It is also, for 18 of its 22 public
   entry points, code that **nothing in the product calls**.

---

## 0. The one-paragraph answer

All three families are, at the IR level, **absent**. The 40-op `OpCode` table
(`forge-kernel/include/forge/ft/FeatureTree.hpp:68-160`) contains no mesh op, no
drawing op, and exactly one measurement op — `VERIFY`. The 31 commands in the
`forge::ui` registry contain no mesh, drawing, or measure command (enumerated in
§3.1). What these families *do* have is a very large amount of real, tested,
**unreachable** kernel code: a complete HLR drafting engine (1,366 LOC,
`forge-kernel/src/Drawings.cpp`), 28 native mesh modules (12,720 LOC), and a
half-dozen analysis evaluators — plus, measured, a `VERIFY` op whose assertion
vocabulary is a strict eight-name subset of what the *same function call on the
same body in the same process* has already computed. The cheapest capability in
these three families is not writing new geometry code. It is spending the numbers
the kernel already holds in its hand.

---

# 1. MESH / POLYGON

## 1.1 Table

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| Tessellate a B-rep | **YES** `forge-kernel/include/forge/Tessellate.hpp:29` `forge::tessellate`; LOD cache `forge-kernel/include/forge/LOD.hpp` | **Indirectly only** — `VERIFY` bbox calls `forge::tessellate` (`src/ft/FeatureTreeCompiler.cpp:2096`) and `topologySignature` tessellates; no op *names* a mesh | **YES, as rendering** — the desktop viewport consumes it (`forge-desktop/src/KernelScene.cpp`); not as a command | MESH (to name the result) | a `MESH` value kind + `TESSELLATE(%solid, linTol, angTol) -> MESH` | none directly; substrate for every mesh metric |
| Import STL | **YES** `forge-kernel/src/IoExchange.cpp:266`, native ASCII+binary reader with a size-rule sniff | **YES — MEASURED.** `INPUT()` sniffs content and calls `importStl` (`src/ft/FeatureTreeCompiler.cpp:1825`). Probe: volume 1000 exact, bbox exact, genus 0, shells 1 | **NO** — `INPUT` is a forbidden op (`ui/include/forge/ui/ArchieOpVocabulary.hpp:190`) | MESH — **its absence is the bug**, §1.3 | §1.3 | neuralCAD-Edit / HistCAD (edit-from-artifact) |
| Import OBJ | **NO.** No `importObj`/`exportObj` anywhere in `forge-kernel` (VERIFIED: exhaustive grep, zero hits) | no | no | MESH | a reader; simpler than the STL reader already shipped | none directly |
| Export STL | **YES** `forge-kernel/src/IoExchange.cpp:348` (native, ASCII, exact-double round-trip) | **NO — VERIFIED.** `compileText` exports STEP and only STEP (`src/ft/FeatureTreeCompiler.cpp:2388`) | no | — | one more path argument on `compileText` | none directly |
| Export glTF/.glb | **YES** `forge-kernel/include/forge/GltfExport.hpp` (PBR, spec-conformant) | no | no | — | as above | none |
| Export faceted STEP | **YES** `forge-kernel/include/forge/native/brep/StepFaceted.hpp` — write+read, round-trip exact | partial (`exportStep` on a `NativeMesh` handle, `src/IoExchange.cpp:157`) | no | — | — | BenchCAD (artifact exchange) |
| Mesh booleans | **YES, and they are good** — `src/native/mesh/MeshBooleanNative.cpp` (1,528 LOC) + `MeshBooleanExact.cpp` (614 LOC, exact predicates + Simulation-of-Simplicity), `BooleanBVH.cpp`, `TriTriIntersect.cpp` | **NO — MEASURED.** `CUT(%stl_body, %box)` throws *"handle is native-mesh-backed"* (Appendix A, `stl_cut`) | **NO.** Bound to JS only as `forge.native.meshBoolean(aPos,aIdx,bPos,bIdx,op)` (`src/binding.cpp:17272`) — raw arrays, **not** registry handles | MESH | route `FUSE`/`CUT`/`COMMON` on a `NativeMesh` operand to `meshBooleanNative` instead of `ShapeRegistry::get()` | MUSE (assemblies), BenchCAD |
| Remesh | **YES** `src/native/mesh/Remesh.cpp` (1,128 LOC), gate `test/native/mesh/remesh_test.cpp` | no | no | MESH | expose | none directly |
| Decimate | **YES ×2** — `native/mesh/Decimate.cpp` (701 LOC, gated) **and** `forge::meshrepair::decimateEdgeCollapse` (`include/forge/MeshRepair.hpp:42`) | no | **JS only** — `forge.meshrepair.*` (`src/binding.cpp:8080`) | MESH | expose | none directly |
| Mesh repair (dedupe / degenerate / hole-fill / smooth) | **YES ×2** — `native/mesh/Repair.cpp` (643), `HoleFill.cpp` (421), `Smooth.cpp` (264); and `forge::meshrepair` (`src/MeshRepair.cpp`, 447) | no | **JS only** (`forge.meshrepair`) | MESH | expose | MUSE (a mesh that will not close scores zero) |
| Mesh self-intersection | **YES** `native/mesh/SelfIntersect.cpp` (360) | no | JS, via `src/binding_geom.cpp` | MESH | — | MUSE |
| Mesh → B-rep reconstruction | **NO — and this is the real gap.** The *ingredients* ship and are gated: `fitPlane`/`fitLine`/`fitSphere`/`fitCylinder` (`include/forge/native/geom/PrimitiveFit.hpp`, 500+ LOC impl) and NURBS surface fitting (`forge.native.surfitFit`, `src/binding.cpp:17783`). **Absent:** SEGMENTATION — nothing groups triangles into patches — and nothing sews fitted patches into a solid. `StepFaceted` is not reconstruction: every face stays a flat triangle (its own header says so) | no | no | MESH **and** SURFACE (another agent's) | §1.4 | Drawing2CAD, neuralCAD-Edit (scan/mesh → parametric) |
| Primitive fitting from points (plane / line / sphere / cylinder) | **YES** `include/forge/native/geom/PrimitiveFit.hpp`, impl `src/native/geom/PrimitiveFit.cpp:242,330,469`; gated by `test/native/geom/primitivefit_test.cpp`; header states its purpose is reverse-engineering | no | **NO — zero call sites anywhere, not even a JS binding** (VERIFIED) | POINTS or MESH | expose; it is the *fitting* half of mesh→B-rep | Drawing2CAD, neuralCAD-Edit |
| Point-cloud stats / downsample / normals / voxel mesh | **YES** `include/forge/PointCloud.hpp`, bound at `src/binding.cpp:8259` | no | JS only | POINTS (a 4th kind) | — | none directly |
| Voxelize | **YES** `native/mesh/Voxelize.cpp` (218); has real callers (`native/voxel/Lattice.cpp`, `src/binding_field.cpp`) | no | JS (field ns) | MESH | — | BenchCAD (voxel IoU is its Vision2Code metric — `include/forge/VoxelIoU.hpp:3`) |
| Slice / offset / shell / inset / subdivide / quad-dominant / parameterize / geodesic / bridge / curvature / Hausdorff / wall-thickness / topology-stats | **YES — all of them, each with a gate** (`src/native/mesh/*.cpp`, `test/native/mesh/*_test.cpp`) | no | **no — not even JS** | MESH | expose | see §3 for wall-thickness / curvature |

## 1.2 What is ALREADY BUILT and merely unreachable — loudly

**28 modules. 12,720 lines. 26 gate files, all run by CI. One JS binding.**

I censused every public entry point in `forge-kernel/include/forge/native/mesh/`
for a production (non-test, non-own-module) call site:

```
analyzeTopology        NONE      insetFaces          NONE
bridgeMeshBoundaries   NONE      offsetMesh          NONE
computeCurvature       NONE      parameterize        NONE
decimate               NONE      quadDominant        NONE
directedHausdorff      NONE      remesh              NONE
fillHoles (native)     NONE      repairMesh          NONE
geodesicDijkstra       NONE      shellMesh           NONE
hausdorffDistance      NONE      slice               NONE
subdivideLoop          NONE      taubinSmooth        NONE
analyzeWallThickness   NONE

detectFeatureEdges      -> native/brep/Fillet.cpp, native/brep/Chamfer.cpp
detectSelfIntersections -> src/binding_geom.cpp
voxelize                -> native/voxel/Lattice.cpp, src/binding_field.cpp
meshBooleanNative       -> src/binding.cpp:17272  (JS, raw arrays)
```

**Eighteen of twenty-two entry points have zero production callers.** They are
not stubs — `Remesh.cpp` is 1,128 lines and `remesh_test.cpp` gates it — they are
finished modules with no door.

A second, older suite is one step better off: `forge::meshrepair`
(`include/forge/MeshRepair.hpp`) has six functions and all six are bound as
`forge.meshrepair.*` (`src/binding.cpp:8080`). Reachable from JavaScript. Not
from the IR, not from the app, and the JS renderer that could call it is the
layer being retired — `implementation/sacrosanct/ZERO_JS_MIGRATION_MANIFEST.md:49`
lists `frontend/src/forge-v4/**` as **UNMAPPED — the largest genuine rewrite**.

`forge-desktop/mesh_probe.cpp` is not a capability. It is a 235-line headless
assertion that `tessellateLOD(High) -> Mesh -> exportStl` produces a well-formed
mesh and a byte-exact binary STL. It proves the render data-feed works. It builds
only under `-DFORGE_BUILD_DESKTOP_FOUNDATION=ON`
(`forge-kernel/CMakeLists.txt:1984`) and I found **no CI step that builds or runs
it** (`grep forge_mesh_probe .github/workflows/*.yml` → nothing).

## 1.3 The value kind this family requires — and the defect its absence already causes

**`MESH`.** The absence is not theoretical; it is producing wrong behaviour
today, which I measured.

The kernel *does* have a third shape kind: `ShapeKind::NativeMesh`
(`include/forge/ShapeRegistry.hpp:48`), and `importStl` registers one
(`src/IoExchange.cpp:339`). The IR has no name for it, so `INPUT()` hands it back
typed as **SOLID**. Everything downstream believes it is a solid. Then:

* `ShapeRegistry::get()` **throws** on a `NativeMesh` handle
  (`src/ShapeRegistry.cpp:81-83`) — there is no analytic `TopoDS_Shape` to return.
* `forge::direct::faceCount` calls `get()` unconditionally
  (`src/DirectModeling.cpp:368-373`).
* `forge::cut`/`fuse`/`common` fall through to `get()` for a non-native operand
  (`src/Booleans.cpp:481-498`).

MEASURED (Appendix A):

| tree | result |
|---|---|
| `%0=INPUT()` *(cube.stl)*; `VERIFY(%0,"volume=1000")` | `ok:true`, **PASS volume=1000 (got 1000)**, bbox exact, genus 0, shells 1, vertices 8 — but `faceCount:-1`, `edgeCount:-1`, and a **non-empty `error`** (*"validity check threw"*) alongside `ok:true` |
| `%0=INPUT()`; `VERIFY(%0,"faces=6")` | `ok:false` — `ShapeRegistry::get — handle is native-mesh-backed` |
| `%0=INPUT()`; `%1=BOX(4,4,4)`; `CUT(%0,%1)` | `ok:false` — same throw |

So: **an imported mesh can be measured for volume and cannot be cut.** The IR
accepted the mesh, typed it SOLID, and the failure surfaced two ops later inside
`ShapeRegistry` with a message about `kindOf()` that no planner can act on. That
is exactly the failure a value kind exists to prevent. Note also row 1: `ok:true`
with a non-empty `error` and `faceCount:-1` is a partial success reported as
success — the shape of defect the compiler's own s0.4 census exists to outlaw.

**This is a REPRESENT problem, not a refuse problem.** The `MESH` kind gates
nothing; it lets the compiler say *"%0 is a MESH; `CUT` on a MESH routes to
`meshBooleanNative`"* — 1,528 lines of already-tested code — instead of throwing
from three layers down.

## 1.4 What is genuinely absent, and how long

| item | honestly |
|---|---|
| `MESH` IR value kind + `INPUT` typing it correctly | **days.** The registry kind exists; the tessellator exists; mesh mass-properties exist (`src/MassProps.cpp:42`). This is plumbing a name through `Val`, the OpCode table, and `refSolid`. |
| Mesh booleans wired to `FUSE`/`CUT`/`COMMON` for MESH operands | **days**, once `MESH` exists. `meshBooleanNative` already takes exactly the `positions/indices` arrays `HalfEdgeMesh::toSoup` produces. |
| `TESSELLATE` / `DECIMATE` / `REMESH` / `MESHREPAIR` as IR ops | **days each.** Each is a call into a finished, gated module. |
| OBJ import/export | **days.** Simpler than the STL reader already shipped. |
| **Mesh → B-rep reconstruction** | **months, and it is the only genuinely hard thing in this family.** The fitters exist and are validated; the *segmentation* — deciding which triangles belong to one analytic patch, and where the patch boundaries lie — exists nowhere in the repo and is the actual research problem. It also needs the `SURFACE` kind another agent is landing, since a fitted NURBS patch has nowhere to live today. Do not schedule this as weeks. |

## 1.5 The minimal honest version

Four ops and one kind, all of which are wiring:

```
%2 = TESSELLATE(%1, linTol, angTol)        -> MESH
%3 = DECIMATE(%2, targetTriangles)         -> MESH
%4 = MESHREPAIR(%2)                        -> MESH     # dedupe + degenerate + holefill
%0 = INPUT()                               -> MESH when the sniff says STL
```

plus: `FUSE`/`CUT`/`COMMON` accept `(MESH, MESH)` and dispatch to
`meshBooleanNative`; `compileText` gains an STL output path.

That makes the family **real** — an STL enters, is repaired, is booleaned, and
leaves — using zero new geometry code. It deliberately excludes mesh→B-rep, which
is the decorative-vs-real line for a *different*, much larger claim.

---

# 2. DRAWING / DRAFTING

## 2.1 Which direction `Drawings.cpp` works — the question, answered

**`forge-kernel/src/Drawings.cpp` is 3D → 2D. It runs the OPPOSITE way from
Drawing2CAD.**

It is a hidden-line-removal projector: a `ShapeHandle` in, 2D polylines out
(`include/forge/Drawings.hpp:50-56` for the value type, `:62` for the entry point). It is substantial, real, and current — the
OCCT `TKHLR` toolkit has been **dropped** and every orthographic HLR call site now
runs the in-house analytic `forge::native::brep::hiddenLineRemoval`
(`src/Drawings.cpp:32-38`, naming the otool drop 14→13). Perspective HLR is
native-only, with no OCCT equivalent at all (`include/forge/Drawings.hpp:66-79`).

The **only** thing in the repo pointing 2D → 3D is `forge::dxf::parse`
(`include/forge/Dxf.hpp:35`), 136 LOC, which reads `LINE`/`CIRCLE`/`ARC`/
`LWPOLYLINE` and nothing else — no `DIMENSION`, no `TEXT`, no `BLOCK`, no
`INSERT`. It produces a `forge::dxf::Document` of flat entities. **There is no
path from a `Document` to a `PROFILE`**, and none to a solid. It is bound to JS
(`src/binding.cpp:8707`) and has zero C++ consumers.

So for Drawing2CAD: the drawing→CAD direction is currently carried entirely by
Archie-the-VLM reading a rendered image; the kernel contributes nothing to it.
What `Drawings.cpp` *would* contribute is the **round-trip check** — project the
candidate solid back to a drawing and compare it with the input — which is a
strong scoring signal nobody is using.

## 2.2 Table

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| Base / projected orthographic views | **YES** `forge::projectShape` (`include/forge/Drawings.hpp:62`); presets front/top/right/iso (`:43-46`) | **NO — MEASURED.** `%2 = PROJECT(%1, FRONT)` → `ft parse line 2: unknown op 'PROJECT'` | **NO** — JS only, `forge.drawings.projectShape` (`src/binding.cpp:6403`) | **DRAWING** (a 2D polyline set) | §2.5 | Drawing2CAD (as a round-trip check), ParaCAD |
| Auxiliary view (arbitrary direction) | **YES** — `projectShape` takes an arbitrary `Float64Array[3]` direction (`src/binding.cpp:1503`), not only presets | no | JS only | DRAWING | — | ParaCAD |
| Hidden-line removal | **YES, native, OCCT-free** — three edge classes: visible / hidden / outline-silhouette (`include/forge/Drawings.hpp:51-53`) | no | JS only | DRAWING | — | Drawing2CAD, ParaCAD |
| Section view + hatching | **YES** `projectShapeSection(h, dir, SectionPlane, HatchSpec)` — cut wires + 45° hatch (`include/forge/Drawings.hpp:101`); `drawings::sectionView` separates cut from behind-geometry (`:222`) | **NO** | JS only | DRAWING | — | Drawing2CAD, ParaCAD |
| Detail view (clip + scale) | **YES** `projectShapeDetail(h, dir, FocusCircle, scale)` (`include/forge/Drawings.hpp:111`) | no | JS only | DRAWING | — | ParaCAD |
| Broken view | **YES** `projectShapeBroken(h, dir, BreakRegion)` (`include/forge/Drawings.hpp:125`) | no | JS only | DRAWING | — | ParaCAD |
| Perspective view | **YES, native-only** `projectShapePerspective(h, PerspectiveCamera)` (`include/forge/Drawings.hpp:79`) | no | JS only | DRAWING | — | none directly |
| **Dimensions** | **PARTIAL / mostly NO.** `drawings::emitDXF(views, dimensions)` takes dimensions as caller-supplied `(gp_Pnt2d,gp_Pnt2d)` pairs and emits plain `LINE` entities on layer `DIMS` (`include/forge/Drawings.hpp:232`). Nothing in C++ *generates* a dimension. The only auto-dimensioner is `frontend/src/forge-v4/autoDimMath.js` — **108 lines of JavaScript** in the layer slated for deletion | no | JS only | DRAWING + a `DIMENSION` record | §2.5 | ParaCAD ("dimension understanding"), Drawing2CAD |
| Annotations / notes / balloons | **NO in C++.** Composition lives in `frontend/src/kernel/forge/Drawings.js` (1,058 LOC) and `frontend/src/foundation/Drawing2D.js` (401 LOC). The desktop `annotation` panel is `drawGenericPanel` | no | no | DRAWING | port | ParaCAD |
| GD&T / feature control frames | **YES, and it is real** — `src/native/gdt/Gdt.cpp` (945) + `FcfEvaluator.cpp` (849): true position, flatness, datum planes, cylinder-axis fitting; bound as `forge.native.gdtTruePosition` / `gdtFlatness` (`src/binding.cpp:17194,17238`) | no | JS only; the desktop `gdt` panel is `drawGenericPanel` | DRAWING/ANNOTATION | — | MUSE (interface/mating), CADGenBench interface term |
| PMI in STEP | **STUB, and says so** — `exportStepWithPmi` appends the FCF text as an ISO-10303-21 **comment block**, explicitly "a stub … until full representation_item / dimensional_size entity emission lands" (`include/forge/IoExchange.hpp:53-66`) | no | no | ANNOTATION | real AP242 PMI entities | MUSE |
| Title blocks | **NO in C++.** `frontend/src/kernel/forge/drawings/TitleBlocks.js` only. Desktop `title_block` panel is `drawGenericPanel` | no | no | DRAWING | port | none directly |
| Sheet formats (ISO A0–A4, ANSI A–E) | **NO in C++.** `frontend/src/kernel/forge/Drawings.js:36-50` only | no | no | DRAWING | port | none directly |
| First-/third-angle projection convention | **NO in C++.** Zero hits in `forge-kernel`, `ui`, `forge-desktop`. It exists **only in JS**: `frontend/src/foundation/Drawing2D.js:386` draws the ASME third-angle symbol; `frontend/src/ai/disciplinePersonas.js:206` states the layout rule | no | no | DRAWING | a layout rule | ParaCAD |
| DXF write | **YES ×2** — `drawings::emitDXF` (AutoCAD R12, `LWPOLYLINE` per polyline, layers `VISIBLE`/`HIDDEN`/`DIMS`) and `forge::dxf::write` (`include/forge/Dxf.hpp:36`) | no | JS only | DRAWING | — | none directly |
| SVG write | **YES** `drawings::emitSVG` — 0.35 mm visible, dashed hidden, Y-flipped viewBox (`include/forge/Drawings.hpp:242`) | no | JS only | DRAWING | — | none |
| **DXF read (2D → geometry)** | **PARTIAL** `forge::dxf::parse` (`include/forge/Dxf.hpp:35`), 4 entity types, 136 LOC | **no** — no `Document` → `PROFILE` bridge exists | JS only | **PROFILE — which already exists** | §2.5 | **Drawing2CAD**, ParaCAD |

## 2.3 What is ALREADY BUILT and merely unreachable — loudly

**The drafting engine is finished and its only consumer is being deleted.**

Nine functions are bound (`src/binding.cpp:6403-6412`): `projectShape`,
`projectShapePerspective`, `projectSection`, `projectDetail`, `projectBroken`,
`projectView`, `sectionView`, `emitDXF`, `emitSVG`. That is base, projected,
auxiliary, section, detail, broken and perspective views with hidden-line removal
and two output formats — 1,366 LOC of kernel plus a native HLR that replaced an
entire OCCT toolkit.

Its only composer — sheets, title blocks, dimension placement, balloons, SVG
layout — is ~4,250 lines of JavaScript across `frontend/src/kernel/forge/Drawings.js`
(1,058), `DrawingsWorkbench.jsx` (2,159), `DrawingsHLRWorkbench.jsx` (525),
`foundation/Drawing2D.js` (401) and `autoDimMath.js` (108). That directory is the
one the migration manifest marks **UNMAPPED**
(`ZERO_JS_MIGRATION_MANIFEST.md:49`).

And the C++ app meant to replace it ships a **`WorkspaceProfile::Drawing` whose
five drawing-specific panels are all the "not implemented in this segment"
placeholder** (`ui/src/WorkspaceProfile.cpp:97-101` vs
`forge-desktop/src/ForgeFrame.cpp:1406-1428`). The workspace exists. The dock
layout persists across restart. There is nothing in it.

The honest status: **the hard half is done and the easy half is being deleted.**

## 2.4 What new IR VALUE KIND this family requires

**`DRAWING`** — an ordered set of 2D polylines with a class tag (visible /
hidden / outline / cut / hatch) and a 2D bbox. That is precisely
`forge::ProjectedView` (`include/forge/Drawings.hpp:50-56`) and
`forge::drawings::View2D` (`:184-192`), which already exist as C++ types.

A second kind, **`SHEET`** (a page + placed views + a title block), is needed
before a *drawing document* is expressible, but not before a *projection* is.

Note the asymmetry that makes DXF-read the cheap half: reading a 2D drawing back
into geometry needs **`PROFILE`, which already exists**. A
`DXFPROFILE("f.dxf", layer) -> PROFILE` op requires **no new value kind at all**.

## 2.5 What is genuinely absent, and how long

| item | honestly |
|---|---|
| `DRAWING` value kind + `PROJECT` / `SECTION` / `DETAIL` / `BROKEN` ops | **days.** Every one is a direct call into `Drawings.hpp`; the types already exist. |
| `EXPORTDXF` / `EXPORTSVG` from the IR | **days**, and it needs the export-path plumbing from §1.5 either way. |
| **DXF read → `PROFILE`** (the Drawing2CAD direction) | **days for the trivial case, weeks for the real one.** Days: `LINE`/`ARC`/`CIRCLE`/`LWPOLYLINE` on one layer → an ordered closed ring → `PROFILE`. Weeks: entity chaining/ordering, gap tolerance, nested loops, and the `DIMENSION`/`TEXT`/`BLOCK` entities the parser does not read. |
| Dimension **generation** (auto-dim) | **weeks.** 108 lines of JS is not a port target, it is a rewrite; placement, witness lines and non-overlap are genuinely fiddly. |
| Sheets, title blocks, annotations, first/third-angle | **weeks.** Pure porting — low risk, high volume. |
| Multi-view drawings → 3D reconstruction (true Drawing2CAD in the kernel) | **months.** Nothing exists. This is the classical wireframe-reconstruction problem. Archie's VLM path is the current answer and is the right one for now. |

## 2.6 The minimal honest version

One kind, three ops, one export:

```
%2 = PROJECT(%1, FRONT)                        -> DRAWING
%3 = SECTION(%1, FRONT, ox,oy,oz, nx,ny,nz)    -> DRAWING
%4 = DXFPROFILE("part.dxf", "OUTER")           -> PROFILE     # the 2D -> 3D direction
     RESULT + an SVG/DXF export path
```

`PROJECT` and `SECTION` make Forge's drafting engine reachable for the first
time. `DXFPROFILE` is the one op in this family that points at Drawing2CAD, needs
**no new value kind**, and is measured in days — it should be first.

---

# 3. MEASUREMENT / ANALYSIS

## 3.1 Table

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| Volume | **YES** `forge::massProperties(h).volume` (`include/forge/MassProps.hpp:8`) | **YES** — `VERIFY "volume"` (`src/ft/FeatureTreeCompiler.cpp:1971`) | **NO** — `VERIFY` is a forbidden op (`ArchieOpVocabulary.hpp:218`); the Measure panel shows a mesh-derived volume | none | — | CADGenBench shape term |
| **Surface area** | **YES — computed in the same struct** `MassProperties::area` (`MassProps.hpp:8`) | **NO — MEASURED.** `VERIFY(%1,"area=2400")` → *unknown quantity `area`* | Measure panel: **YES** (`ui/include/forge/ui/MeasureModel.hpp:99`) | none | **one `else if`** | CADGenBench shape term |
| **Centre of mass** | **YES — same struct** `cx, cy, cz` (`MassProps.hpp:9`) | **NO — MEASURED.** `VERIFY(%1,"com.z=10")` → *unknown quantity* | Measure panel: **YES** (`MeasureModel.hpp:110`) | none | **one `else if`** | CADGenBench — COM catches the failure volume cannot (MEMORY: *"Volume cannot validate geometry"*) |
| **Inertia tensor** | **YES — same struct** `inertiaCom[9]`, about the centre of mass (`MassProps.hpp:10-19`) | **NO** | no | none | one `else if` | MUSE (functional assemblies) |
| Bounding box (extent + position) | **YES** | **YES** — `bbox.x|y|z`, `bbox.{x,y,z}{min,max}`, `+x`/`-x`/… (`FeatureTreeCompiler.cpp:2073-2107`) | Measure panel: **YES** (`MeasureModel.hpp:48-56`) | none | — | CADGenBench, BenchCAD |
| Face count / edge count | **YES** `forge::direct::faceCount/edgeCount` (`src/DirectModeling.cpp:368,378`) | **YES** — `faces`, `edges` | Measure panel: face count yes; edge count via `EdgeModel` | none | — | CADGenBench topology term |
| Vertex count, Euler characteristic | **YES** `TopoSignature::vertexCount`, `eulerChar` (`include/forge/Topology.hpp:25-29`) | **NO** — the same struct's `genus` and `shellCount` *are* exposed; these two are not | no | none | **one `else if`** | CADGenBench topology term |
| Genus / shell count | **YES** (`Topology.hpp:30-31`) | **YES** — `genus`, `shells` (`FeatureTreeCompiler.cpp:2064`) | no | none | — | **CADGenBench topology = 0.2 of the metric** |
| Hole / bore count | **YES** — axis-line keyed (canonical direction + foot), so coaxial strips collapse to one hole (`FeatureTreeCompiler.cpp:1973-2042`) | **YES** — `holes`/`bores` | no | none | — | CADGenBench interface term |
| Radial feature count (blades/lugs/spokes) | **YES** — angular clustering of off-axis face centroids (`FeatureTreeCompiler.cpp:2043-2063`) | **YES** — `blades` etc. | no | none | — | CADGenBench |
| **Per-face census** (kind / area / centroid / radius / axis / normal / concavity) | **YES, fully** — `forge::faceInventory` (`src/DirectEdit.cpp:264`, kinds `plane, cylinder, cone, sphere, torus, bspline, bezier, revolution, other` at `:289-333`); `forge_verify` emits every field (`src/tools/forge_verify.cpp:598-624`) | **`VERIFY` cannot assert on any of it — MEASURED.** `VERIFY(%1,"planes=6")` → *unknown quantity*. Yet a ~350-line face **selector** resolver sits in the same file (`FeatureTreeCompiler.cpp:1393`) and `TAG`/`PUSHFACE`/`RESIZEBORE`/`DEFEATURE` all use it | no | none | §3.4 | **This is the ground truth's own summary format** — task_101's `329 faces / 753 edges`, edit_214's `cylinder 167 / torus 125 / bspline 67 / sphere 25 / cone 4 / plane 42` |
| Distance / angle between two entities | **YES** `SelectionMeasure{hasPair, centreDistance, angleDegrees, parallel, perpendicular}` (`MeasureModel.hpp:123-126`); edge pairs via `EdgeMeasure` (`EdgeModel.hpp:130-132`) | **NO** | **YES — the one real analysis panel.** `drawMeasurePanel` (`forge-desktop/src/ForgeFrame.cpp:1981`) | a selector-scoped assertion form | §3.4 | CADGenBench interface/mating term |
| Watertightness / manifoldness | **YES, and it refuses to fake it** — `MeshMeasure` reports `boundaryEdges`/`nonManifoldEdges`/`reversedEdges` and reports volume **only** when all three are zero (`MeasureModel.hpp:103-108`) | `VERIFY` has no `watertight`; `CompileResult::valid` exists but is not assertable | Measure panel: **YES** | none | one `else if` | MUSE (an unclosed body is not manufacturable) |
| **Clearance / interference** | **YES** `forge::detectInterference(instances, tolerance)` — BVH broad phase + exact boolean, returns intersection volume per pair (`include/forge/InterferenceDetection.hpp:36`, 279 LOC impl) | **NO at the pinned base — MEASURED.** Worse: `VERIFY(%1, %2, "volume=8000")` returns **`ok:true`, `PASS volume=8000`** — the second body reference is **silently discarded** (`FeatureTreeCompiler.cpp:1947`: non-`Str` args are `continue`d). §3.3 | desktop `interference` panel is `drawGenericPanel` | a second value ref in `VERIFY` | §3.4 | **MUSE** (assembly), CADGenBench interface term |
| Voxel IoU vs a reference | **YES** `forge::voxelIoU`, four normalisation conventions, refusing an unknown one rather than guessing (`include/forge/VoxelIoU.hpp`; `forge_verify.cpp:685`) | **NO** — verifier-only, driven by a `refStep` field on the protocol line | no | a reference operand | — | **BenchCAD Vision2Code — its stated metric** (`VoxelIoU.hpp:3`) |
| **Wall-thickness analysis** | **YES** `analyzeWallThickness` — inward-ray opposite-wall gauge over an AABB tree; global min, per-vertex field, world location of the thinnest sample (`include/forge/native/mesh/WallThickness.hpp:105`, 224 LOC, randomized gate) | **NO** | **NO — zero production callers anywhere** | MESH | expose | MUSE (manufacturability) |
| **Draft analysis** | **YES** `forge::mold::analyseDraft(part, pullDir, threshold)` → one `DraftFace` per face (`include/forge/Mold.hpp:73`) | **NO** | JS only (`src/binding.cpp:6907`) | none | expose | MUSE |
| **Curvature analysis** | **YES ×2** — `forge::classa::gaussianAndMeanCurvature` + `curvatureComb` (`include/forge/ClassASurfacing.hpp:132,147`, bound at `src/binding.cpp:16108,16161`); and mesh-side `native/mesh/Curvature.cpp` (380 LOC, **zero callers**) | **NO** | JS only; desktop `continuity`/`isocline` panels are `drawGenericPanel` | SURFACE (other agent) | expose | *deferred — Class A/B/C/D is another agent's family* |
| **Zebra stripes** | **YES** `forge::classa::zebraStripes(face, stripeCount, lightDir, uS, vS)` (`ClassASurfacing.hpp:119`, bound at `src/binding.cpp:16086`) | **NO** | JS only; desktop `zebra_analysis` panel is `drawGenericPanel` | SURFACE (other agent) | expose | *deferred — surfacing family* |
| Continuity (G0–G3) | **YES** `classa::continuityCheck` (`ClassASurfacing.hpp:141`) | **NO** | JS only | SURFACE | — | *deferred* |
| Section view *as analysis* | see §2 — `projectShapeSection` | no | JS only | DRAWING | — | ParaCAD |
| Hausdorff distance to a reference | **YES** `native/mesh/HausdorffDistance.cpp` (281 LOC, gated) | **NO** | **no — zero callers** | MESH | expose | BenchCAD (a shape metric complementary to IoU) |

**The 31 registry commands, verbatim** (`implementation/sacrosanct/archie_op_vocabulary.json`, `commands[]`):
`app.command_palette`, `edit.delete`, `edit.redo`, `edit.undo`, `file.new`,
`file.open`, `file.save`, `part.boolean_intersect`, `part.boolean_subtract`,
`part.boolean_union`, `part.chamfer`, `part.counterbore`, `part.edit_feature`,
`part.extrude`, `part.fillet`, `part.hole`, `part.loft`, `part.mirror`,
`part.move`, `part.pattern_circular`, `part.pattern_grid`, `part.pattern_linear`,
`part.revolve`, `part.section_ring`, `part.shell`, `part.sketch_circle`,
`part.sketch_rect`, `part.variable_fillet`, `view.fit`, `view.wireframe`,
`workspace.next`. **No `measure.*`, no `analysis.*`, no `drawing.*`, no `mesh.*`.**

## 3.2 What is ALREADY BUILT and merely unreachable — loudly

The analysis surface is **large, real, and split three ways**, and no single
consumer sees more than a third of it:

* **`forge_verify` (the benchmark path)** sees the most: volume, faceCount,
  edgeCount, bbox, genus, shellCount, per-hole records (`r, cx, cy, span, at,
  axis, faces`), the full per-face census, and voxel IoU against a reference
  (`src/tools/forge_verify.cpp:10-13, 598-624, 677-710`). It is a stdin/stdout
  JSON tool. **No user can invoke it, and the IR cannot ask it anything.**
* **The Measure panel (the app)** sees a *different* set: area, per-face area and
  area-weighted centroid and normal, planarity, boundary/non-manifold/reversed
  edge counts, watertightness, winding, volume-or-area centroid, pairwise
  centre-distance and angle with parallel/perpendicular flags, and edge lengths
  (`ui/include/forge/ui/MeasureModel.hpp`, `EdgeModel.hpp`). It is **the only
  analysis panel in the desktop app with real content**, it is tested
  (`ui/test/measure_model_test.cpp`, `forge-desktop/test/frame_gate.cpp:524-568`),
  and **the IR cannot ask it anything either.**
* **The JS bindings** see a third set nobody else does: `forge.mold.analyseDraft`,
  `forge.classa.zebraStripes` / `curvatureComb` / `continuityCheck` /
  `gaussianAndMeanCurvature`, `forge.native.gdtTruePosition` / `gdtFlatness`,
  `forge.pointcloud.*` — in the layer being retired.
* **Nothing at all** sees `analyzeWallThickness`, `hausdorffDistance`,
  `native/mesh/computeCurvature`, `native/mesh/analyzeTopology`, or the entire
  `PrimitiveFit` module (`fitPlane`/`fitLine`/`fitSphere`/`fitCylinder` — real,
  gated by `test/native/geom/primitivefit_test.cpp`, **zero call sites, not even
  a JS binding**).

`forge::detectInterference` deserves its own line: 279 lines of working
BVH-accelerated pairwise interference detection returning intersection volumes,
with a dock panel named after it that prints *"not implemented in this segment"*.

## 3.3 What new IR VALUE KIND this family requires

**Mostly none — and that is why it is cheap.**

Every scalar in the top half of §3.1 comes off a `ShapeHandle` the IR already
holds. `VERIFY` is already a pass-through op taking a SOLID and returning it
unchanged. Adding `area`, `com.x|y|z`, `inertia.xx|…`, `vertices`, `euler`,
`watertight` requires **no new value kind, no new op, and no new geometry code** —
they are fields on structs the same call already returned.

Two things need more than a field read:

1. **Two-body assertions** (clearance, interference, IoU-vs-reference) need
   `VERIFY` to accept a **second value reference**. The syntax already parses —
   and here is the defect: MEASURED, `VERIFY(%1, %2, "volume=8000")` returns
   `ok:true` with `PASS volume=8000 (got 8000)`. `%2` is silently dropped, because
   `opVerify` skips every argument that is not a `TokKind::Str`
   (`FeatureTreeCompiler.cpp:1947`). A planner writing the natural clearance
   assertion gets a **PASS for a question it did not ask.** In a compiler whose
   s0.4 census exists specifically to make dropped *statements* impossible, a
   silently dropped *argument* is the same class of defect one level down.
2. **Per-face and per-selector assertions** need `VERIFY` to reach the face
   selector resolver — which is in the same file, 550 lines above it.

Anything needing `MESH` (wall thickness, Hausdorff) or `SURFACE` (curvature,
zebra) is blocked on the kind, not on itself.

## 3.4 What is genuinely absent, and how long

| item | honestly |
|---|---|
| `area`, `com.*`, `inertia.*`, `vertices`, `euler`, `watertight` in `VERIFY` | **hours.** Six `else if` branches over values the same function already has. |
| Face-census assertions (`planes=`, `cylinders=`, `tori=`, `bsplines=`) | **hours.** `faceInventory` already returns `f.kind`; this is a count over a vector it already builds for `holes`. |
| Selector-scoped assertions (`VERIFY(%b, "@bore.radius=12.5")`) | **days.** `resolveSelector` is in the same translation unit (`FeatureTreeCompiler.cpp:1393`) and already handles `@name`, `plane:max-area`, `face:N`, `bore:r=…`, `radial/blade/lug/spoke`, `boss/shaft/fillet/blend`. The work is the `<selector>.<quantity>` grammar plus a per-face quantity table. |
| Two-body `VERIFY` (clearance / interference / IoU) | **days.** `detectInterference` and `voxelIoU` both exist. The parser already accepts the ref; it just has to stop discarding it. |
| `MEASURE(...)` as a first-class op returning a value | **weeks**, and it needs a `SCALAR` value kind so a later op can consume the measurement. Genuinely useful — derived placement is a known bottleneck (MEMORY: *"Derived placement is the unlearnable sub-task"*) — and genuinely bigger than everything above. |
| Wall thickness / draft / curvature / zebra as IR ops | **days each after their value kind lands** (`MESH` for thickness, `SURFACE` for curvature/zebra). The evaluators are finished. |
| A real Analysis panel in `forge-desktop` (interference, zebra, draft, thickness) | **weeks.** Five placeholder panels, real evaluators behind each. |

## 3.5 The minimal honest version

**`VERIFY` grows to the numbers the same call already computed, and stops lying
about its second argument.**

```
VERIFY(%b, "area=2400", "com.z=10", "vertices=8", "euler=2", "watertight=1")
VERIFY(%b, "planes=42", "cylinders=167", "tori=125")            # the GT census format
VERIFY(%b, "@bore.radius=12.5", "plane:max-area.area=400")      # selector-scoped
VERIFY(%a, %b, "interference=0", "clearance>=0.5")              # two bodies
```

Hours of work for the first two lines, days for the second two, **zero new
geometry code and zero new value kinds**. And it is not decorative: it makes the
IR able to state the ground truth's own summary — the per-face census the owner
cites for `archie_edit_214` — as an assertion the compiler checks.

---

# 4. The specific question: what VERIFY can assert on, and what it should

## 4.1 What it can assert on today — the complete list, at the pinned base

From `opVerify` (`forge-kernel/src/ft/FeatureTreeCompiler.cpp:1944-2156`):

| spelling(s) | measured from | source |
|---|---|---|
| `volume`, `vol` | `massProperties(body).volume` | `:1971` |
| `faces`, `faceCount`, `nfaces` | `forge::direct::faceCount` | `:1967` |
| `edges`, `edgeCount` | `forge::direct::edgeCount` | `:1969` |
| `holes`, `bores` | `unifyFaces` + `faceInventory`, keyed on the axis LINE (canonical direction + foot) | `:1973-2042` |
| `radial`, `blades`, `lugs`, `spokes` | angular clustering of off-axis face centroids | `:2043-2063` |
| `genus`, `shells`, `shellCount` | `topologySignature` | `:2064-2072` |
| `bbox.x|y|z` (extent), `bbox.{x,y,z}{min,max}`, `+x`/`-x`/`+y`/`-y`/`+z`/`-z` (position) | tessellate, then min/max over vertices | `:2073-2107` |

Comparators `= <= >= < >`; tolerance `max(1e-6, 1e-3·|want|)` (`:2119`).
A failure is recorded and compilation **continues** — `VERIFY` is pass-through
and a failed assertion sets `ok=false` at the end rather than abandoning the tree
(`:2134-2151`). That design is right and should be kept intact.

**Eight quantity groups. That is the entire measurement vocabulary of the IR.**

*(The shared checkout's newer binary adds `bodies`/`components`/`parts` and
`interference`/`interferenceVolume`; neither exists at `a457bea2`. If that work
lands, the `interference` row in §3.1 becomes partially reachable — but the
silent drop of a second `%ref` documented in §3.3 is a separate defect and is
present in both trees.)*

## 4.2 What it should be able to assert on

Ordered cheapest first. Everything in tiers 1 and 2 is a value the same process
has already computed on the same body.

**Tier 1 — free (hours). Same struct, discarded.**
`massProperties` returns 14 numbers and `VERIFY` reads **one**:

* `area` — surface area
* `com.x`, `com.y`, `com.z` — centre of mass. *This catches the failure volume
  cannot: a part that matches volume to 0.1% and sits in the wrong place.*
* `inertia.xx|yy|zz|xy|xz|yz` — the inertia tensor about the COM

`topologySignature` returns 6 and `VERIFY` reads **two**:

* `vertices`, `euler`

And one boolean the compiler already holds:

* `watertight` (`CompileResult::valid`)

**Tier 2 — nearly free (hours). `faceInventory` is already called by `holes`.**

* `planes`, `cylinders`, `spheres`, `cones`, `tori`, `bsplines`, `beziers`,
  `revolutions` — the per-kind face census. **This is the exact form the ground
  truth is stated in** (`archie_edit_214`: cylinder 167, torus 125, bspline 67,
  sphere 25, cone 4, plane 42). Today a tree cannot assert the one summary its own
  ground truth uses. The kind strings already exist at `src/DirectEdit.cpp:289-333`
  — **and the histogram itself is already built**: `forge_verify` computes
  `std::map<std::string,long> hist; for (const auto& f : full) hist[f.kind]++;`
  and emits it as `census.kind_histogram`
  (`src/tools/forge_verify.cpp:584-595`), under a comment stating that the
  retained ground-truth records condition every edit on exactly this inventory.
  The same three lines in `opVerify` would make it assertable.
* `concaveFaces`, `convexFaces`

**Tier 3 — days. Reach the selector resolver 550 lines up the same file.**

* `VERIFY(%b, "<selector>.<quantity> <cmp> <value>")` where `<selector>` is any
  spelling `resolveSelector` already accepts (`@name`, `plane:max-area`, `face:N`,
  `bore:r=…`, `radial:N`, `boss`, `fillet`, …) and `<quantity>` is
  `area | radius | centroid.x|y|z | normal.x|y|z | axis.x|y|z | count`.
* This closes the loop with `TAG`: a tree can already *name* a feature and then
  cannot *assert anything about the thing it named*.

**Tier 4 — days. Stop discarding the second operand.**

* `VERIFY(%a, %b, "interference=0")` → `forge::detectInterference`
* `VERIFY(%a, %b, "clearance>=0.5")`
* `VERIFY(%a, %b, "iou>=0.9")` → `forge::voxelIoU`, the metric BenchCAD scores
* **Until this lands, `VERIFY(%a, %b, …)` must not silently pass.** If the
  two-body form is not implemented, the second ref should be *named in a
  diagnostic*, never dropped. A `PASS` for a discarded operand is worse than a
  refusal, and this is the one place in this census where I would accept a loud
  error over silent tolerance.

**Tier 5 — after `MESH` / `SURFACE` land.**

* `minWallThickness >= t` (`analyzeWallThickness` — finished, zero callers)
* `draftAngle >= d` for a pull direction (`mold::analyseDraft` — finished, JS-only)
* `maxCurvature <= k`, `continuity >= G2` *(deferred to the surfacing agent)*
* `hausdorff <= h` vs a reference

## 4.3 Why this is the highest-leverage item in the whole census

`VERIFY` is the **one** measurement concept the model already has, and the brief
records it at 533 uses in a 600-row emission set — the model reaches for it
constantly. *(That count is the owner's measurement; I did not re-derive it and
found no emission corpus in-tree to check it against.)* Every other capability in
these three families needs a new value kind, a new op, and a new UI command
before Archie can use it. `VERIFY` needs **none of those**: the op exists, the
model emits it fluently, the compiler runs it, and the benchmark path
(`forge_verify`) already honours it.

Widening its vocabulary is the only change in this document that makes Archie
measurably better **without touching the IR grammar, the value model, the op
table, or the UI registry.**

---

# 5. Cross-family conclusions

## 5.1 The cheapest capability in the project — restated for these families

The 22 forbidden ops are the well-known cheap bucket. These three families add a
**second, larger** one, and part of it is cheaper still because it needs no UI
command at all:

| bucket | size | cost to reach |
|---|---|---|
| `VERIFY` quantities already computed and discarded | ~15 scalars | **hours** |
| native mesh modules with zero production callers | 18 of 22 entry points, ~10k LOC | days each, after `MESH` |
| drafting engine bound only to a JS layer marked for deletion | 9 functions, 1,366 LOC of kernel | days each, after `DRAWING` |
| analysis evaluators bound only to JS, or to nothing | `analyseDraft`, `zebraStripes`, `curvatureComb`, `continuityCheck`, `gaussianAndMeanCurvature`, `analyzeWallThickness`, `detectInterference`, `hausdorffDistance`, `voxelIoU`, `PrimitiveFit` | days each |
| desktop panels that are `drawGenericPanel` | 4 in the Drawing workspace (`view_list`, `annotation`, `gdt`, `title_block`), plus `interference`, `zebra_analysis`, `continuity`, `isocline`. `dimensions` was on this list and now draws real content; 21 of 50 remain, pinned by `ui/test/panel_content_ratchet_test.cpp` | weeks |

## 5.2 Value kinds — the summary

| family | needs | blocked on it? |
|---|---|---|
| MESH / POLYGON | **`MESH`** | **Yes, totally.** `ShapeKind::NativeMesh` already exists in the registry; the IR just has no name for it, and that alone causes the measured `CUT`-on-STL failure. |
| DRAWING / DRAFTING | **`DRAWING`** (`ProjectedView` / `View2D` already exist as C++ types); `SHEET` later | Yes for projection. **No for DXF read** — that direction needs only `PROFILE`, which exists. |
| MEASUREMENT / ANALYSIS | **none for tiers 1–4**; `SCALAR` only if measurements must be *consumed* by later ops; `MESH`/`SURFACE` for tier 5 | **No.** This is the family that is not blocked on anything. |

## 5.3 On the binding constraint — "don't gate anything"

Every recommendation above is REPRESENT or REPAIR, not REFUSE:

* The `MESH` kind does not reject a mesh — it lets `CUT` **route** it to the
  1,528-line mesh boolean instead of throwing from inside `ShapeRegistry::get`.
  Today's behaviour *is* the gate; naming the kind removes it.
* Widening `VERIFY` strictly enlarges what a tree may say. Its unknown-quantity
  error already names the whole legal vocabulary
  (`FeatureTreeCompiler.cpp:2113`) so a repair loop can act — that pattern should
  be preserved, not narrowed.
* Adding `PROJECT` / `SECTION` / `DXFPROFILE` adds ops; it removes none.

The **one** place I recommend a loud failure over silence is §4.2 tier 4: today
`VERIFY(%a, %b, …)` silently discards `%b` and reports `PASS`. That is not
tolerance, it is a wrong answer delivered confidently — the exact failure the
kernel's own s0.4 cardinality ledger exists to make impossible one level up.

## 5.4 One correction to the brief, offered honestly

The brief records *"Forge has NO SKETCHER"*. At the app level that is right —
there is no sketching UI, and the IR's only profiles are `RECT` and `CIRCLE`. But
the **kernel** ships one: `forge::Sketcher` (`include/forge/Sketcher.hpp`,
`src/Sketcher.cpp`, 872 LOC) is a handle-based facade over the vendored
**planegcs** constraint solver — points, lines, circles, arcs, value-bearing
constraints — with a DOF analyser (`src/SketchDof.cpp`). That matters for the
DRAFTING family specifically, because a drawing dimension and a sketch
dimensional constraint are the same object seen from two directions, and the
solver for one of them already exists.

---

# Appendix A — measured probe transcript

Binary: `forge-kernel/build-fixcheck/forge_verify` in the **shared** checkout,
built 2026-08-29. Newer than the pinned base; see *Method*. Every behaviour below
was cross-checked against `a457bea2` source and is identical in both trees except
where noted.

```
$ printf '{"id":"t1","ir":"%1 = BOX(20,20,20)\n
                           %2 = VERIFY(%1, \"volume=8000\", \"faces=6\", \"area=2400\")\n
                           RESULT(%2)\n"}' | forge_verify
{"id":"t1","ok":false,
 "error":"op %2 (line 2): VERIFY: unknown quantity `area` in `area=2400` — known: volume,
   faces/faceCount, edges/edgeCount, holes/bores, genus, shells, blades, bodies/components,
   interference, bbox.x|y|z (extent), bbox.xmin|xmax|... and +x|-x|+y|-y|+z|-z (position)",
 "failedOpId":2,
 "verify":["PASS volume=8000 (got 8000)","PASS faces=6 (got 6)"]}
```

→ `area` is refused. *(The binary's list names `bodies`/`interference`; the pinned
base's list does not — `FeatureTreeCompiler.cpp:2113`.)*

```
{"id":"com","ok":false,"error":"op %2 (line 2): VERIFY: unknown quantity `com.z` ..."}
{"id":"planes","ok":false,"error":"op %2 (line 2): VERIFY: unknown quantity `planes` ..."}
{"id":"sel_assert","ok":false,
 "error":"op %3 (line 3): VERIFY: cannot parse assertion `bore:r=3.radius=3`"}
```

**The silent two-body drop:**

```
$ ... {"id":"twobody","ir":"%1 = BOX(20,20,20)\n%2 = BOX(5,5,5)\n
                            %3 = VERIFY(%1, %2, \"volume=8000\")\nRESULT(%3)\n"}
{"id":"twobody","ok":true,"error":"","failedOpId":-1,
 "verify":["PASS volume=8000 (got 8000)"],
 "valid":true,"volume":8000,"faceCount":6,"edgeCount":12,"bodies":1,
 "bbox":{"min":[-10,-10,0],"max":[10,10,20]},"genus":0,"shellCount":1,
 "vertexCount":8,"bores":[]}
```

→ `%2` accepted, discarded, `PASS` reported. Cause at the pinned base:
`FeatureTreeCompiler.cpp:1947`, `if (op.args[i].kind != TokKind::Str) continue;`.

**Unknown-op wall (these three families have no op names at all):**

```
{"id":"project","ok":false,"error":"ft parse line 2: unknown op `PROJECT`"}
{"id":"measure","ok":false,"error":"ft parse line 2: unknown op `MEASURE`"}
{"id":"tess",   "ok":false,"error":"ft parse line 2: unknown op `TESSELLATE`"}
```

**STL through `INPUT()` — works for volume, cannot be cut:**
(`cube.stl` — a 12-triangle ASCII cube, 10 mm, consistently wound, written for
this probe)

```
{"id":"stl_vol","ok":true,
 "error":"first invalid solid is produced by op %0 INPUT (line 1): validity check threw",
 "verify":["PASS volume=1000 (got 1000)"],
 "valid":false,"volume":1000,"faceCount":-1,"edgeCount":-1,"bodies":1,
 "bbox":{"min":[0,0,0],"max":[10,10,10]},"genus":0,"shellCount":1,"vertexCount":8}

{"id":"stl_faces","ok":false,
 "error":"op %1 VERIFY (line 2): ShapeRegistry::get — handle is native-mesh-backed
          (a faceted feature result has no analytic TopoDS_Shape);
          branch on kindOf() / use getNativeMesh"}

{"id":"stl_cut","ok":false,
 "error":"op %2 CUT (line 3): ShapeRegistry::get — handle is native-mesh-backed ..."}
```

→ Volume, bbox, genus, shells and vertex count are **exact**. `faceCount`/`edgeCount`
report `-1`. `VERIFY "faces="` and every boolean throw from inside `ShapeRegistry`.
And `ok:true` co-exists with a non-empty `error` — a partial success reported as
success.

Pinned-base cross-checks for the three throws: `src/ShapeRegistry.cpp:81-83`
(`get()` throws on `NativeMesh`), `src/DirectModeling.cpp:368-373` (`faceCount`
calls `get()` unconditionally), `src/Booleans.cpp:481-498` (`cut`/`fuse` fall
through to `get()`).

---

# Appendix B — reachability census, native mesh modules

Every public entry point in `forge-kernel/include/forge/native/mesh/`, against
production (non-test, non-own-module) call sites in `forge-kernel/src`, `ui`,
`forge-desktop`:

| entry point | impl LOC | gate | production callers |
|---|---|---|---|
| `meshBooleanNative` | 1,528 | `boolean_native_test.cpp` | `src/binding.cpp:17272` (JS, raw arrays) |
| `remesh` | 1,128 | `remesh_test.cpp` | **NONE** |
| `decimate` | 701 | `decimate_test.cpp` | **NONE** |
| `repairMesh` | 643 | `repair_test.cpp` | **NONE** |
| `meshBooleanExact` | 614 | via the boolean gate | *(a strategy inside `meshBooleanNative`)* |
| `bridgeMeshBoundaries` | 492 | `bridge_test.cpp` | **NONE** |
| `parameterize` | 450 | `parameterize_test.cpp` | **NONE** |
| `fillHoles` (native) | 421 | `holefill_test.cpp` | **NONE** |
| `analyzeTopology` | 399 | `topologystats_test.cpp` | **NONE** |
| `insetFaces` | 382 | `inset_test.cpp` | **NONE** |
| `computeCurvature` | 380 | `curvature_test.cpp` | **NONE** |
| `slice` | 378 | `slice_test.cpp` | **NONE** |
| `shellMesh` | 367 | `shell_test.cpp` | **NONE** |
| `detectSelfIntersections` | 360 | `selfintersect_test.cpp` | `src/binding_geom.cpp` |
| `quadDominant` | 347 | `quaddominant_test.cpp` | **NONE** |
| `subdivideLoop` | 344 | `subdivide_test.cpp` | **NONE** |
| `hausdorffDistance` / `directedHausdorff` | 281 | `hausdorffdistance_test.cpp` | **NONE** |
| `detectFeatureEdges` | 274 | `featureedges_test.cpp` | `native/brep/Fillet.cpp`, `native/brep/Chamfer.cpp` |
| `taubinSmooth` | 264 | `smooth_test.cpp` | **NONE** |
| `offsetMesh` | 241 | `offset_test.cpp` | **NONE** |
| `geodesicDijkstra` | 230 | `geodesicdijkstra_test.cpp` | **NONE** |
| `analyzeWallThickness` | 224 | `wallthickness_test.cpp` | **NONE** |
| `voxelize` | 218 | `voxelize_test.cpp` | `native/voxel/Lattice.cpp`, `src/binding_field.cpp` |

**Total 12,720 LOC across 28 `.cpp` files. 26 gate files, all run by CI
(`test/native/run_native.sh`, invoked at `.github/workflows/kernel-tests.yml:99`).
18 of 22 named entry points have no production caller. Zero are reachable from
the IR.**

---

# Appendix C — benchmark attributions used above

The seven post-CADGenBench targets are named in-repo at `sacrosanct.md:17-25`:
BenchCAD, neuralCAD-Edit, Drawing2CAD, ParaCAD, Text2CAD-Bench, HistCAD, MUSE.
The only attribution I could verify **in code** rather than from the program
ledger is BenchCAD's: `forge-kernel/include/forge/VoxelIoU.hpp:3` states plainly
that voxel IoU is "the metric BenchCAD Vision2Code scores". Every other benchmark
column entry is a judgement about which benchmark a capability bears on, not a
verified scoring rule; rows with no clear bearing say "none directly" rather than
guessing.
