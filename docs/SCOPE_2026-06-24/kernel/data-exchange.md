# Forge Kernel Audit — Data Exchange (STEP / IGES / JT / Parasolid-XT / ACIS-SAT), OCCT-free

> Area: native, OCCT-free data-exchange interop. Grounded 2026-06-24 by reading the
> live kernel at `forge-kernel/` (not recall). Cross-checked against
> `forge-kernel/OCCT_ZERO_ROADMAP.md` §4 W3.1 (the keystone blocker).
> Discipline (Bible §0): OCCT stays the live default AND the A/B parity oracle until
> each native codec is A/B-proven; flip behind the per-capability gate; delete OCCT
> only at the very end against a frozen golden corpus. No MVP, no stub, no fake, real
> impl only, CI-green per increment, dynamic not static.

---

## 0. TL;DR

The entire production data-exchange path is **OCCT today**. The native substrate is
two pure-C++ STEP codecs — `StepAnalytic` (analytic B-rep) and `StepFaceted` (triangle
soup) — plus a shared Part-21 lexer (`StepPart21.hpp`). They are real and round-trip-
verified, but they read/write only **Forge's own emitted dialect**: a single
`MANIFOLD_SOLID_BREP`, one `CLOSED_SHELL`, faces with **one outer loop and no holes**,
surfaces limited to the **5 canonical quadrics** (plane/cylinder/cone/sphere/torus) plus
a **write-only** `B_SPLINE_SURFACE_WITH_KNOTS`, and edges limited to **LINE / CIRCLE**.

There is **no native trimmed-NURBS surface reader** — the single capability OCCT_ZERO
§5 names as "the one capability that unblocks the most." There is **no native IGES read
or write, no STL read, no BREP (.brep) read/write, no JT, no Parasolid-XT (.x_t/.x_b),
no ACIS-SAT (.sat)** — every one of those routes to OCCT (read) or throws an honest
"not available" (JT/Parasolid import, IGES export). Parasolid/ACIS interop is **0%
native and 0% even via OCCT** (OCCT has no Parasolid/ACIS reader); they are honest
"export STEP instead" stubs.

The native gate `FORGE_NATIVE_STEP` defaults **OFF**; production STEP always uses
`STEPControl_Reader`/`Writer`. So the data-exchange area is the deepest OCCT dependency
remaining and is correctly the last frontier of the OCCT-zero migration.

---

## 1. What Forge has today (cited, read from source)

### 1.1 Production I/O surface — `src/IoExchange.cpp` (+ `include/forge/IoExchange.hpp`)

All of these are the public `forge::io` entrypoints. The OCCT path is the live default;
the native path is compiled only under `-DFORGE_NATIVE_BREP` and taken only when the
runtime gate is on.

| Op | Native path (gate ON) | Default / fallback | Status |
|----|----------------------|--------------------|--------|
| `importStep` (`IoExchange.cpp:55`) | `StepAnalytic::read(text)`; **falls back to OCCT on any unsupported surface** (`:67`) | `STEPControl_Reader` AP203/214/242 (`:73`) | partial-native, OCCT-default |
| `exportStep` (`:96`) | `StepAnalytic::write` for `NativeSolid`; `StepFaceted::write` for `NativeMesh` (`:104`,`:121`) | `STEPControl_Writer` AP242DIS (`:133`) | partial-native |
| `exportStepWithPmi` (`:271`) | — | wraps `exportStep` then appends `/* PMI_FCF: … */` **ISO-10303-21 comment block** (`:290`) | **comment-only PMI, not real AP242 GD&T entities** (admitted at hpp:53-60) |
| `importBrep` (`:147`) | none | `BRepTools::Read` (OCCT binary .brep) | **OCCT-only** |
| `exportBrep` (`:156`) | none | `BRepTools::Write` | **OCCT-only** |
| `importStl` (`:164`) | none | `StlAPI_Reader` | **OCCT-only** |
| `exportStl` (`:173`) | none | `BRepMesh_IncrementalMesh` + `StlAPI_Writer` | **OCCT-only** (mesher + writer both OCCT) |
| `importIges` (`:193`) | none | `IGESControl_Reader` (OCCT TKDEIGES) | **OCCT-only** |
| `exportIges` (`:212`) | — | **honest throw**: "no IGES writer is linked" (`:218`) | **missing entirely** (OCCT TKDEIGES is read-only) |
| `importJt` (`:239`) | — | **honest throw**: requires Siemens JT Open Toolkit | **missing** |
| `importParasolid` (`:251`) | magic-byte sniff (`**`=x_t, `0x83`=x_b) then **honest throw** | — | **missing** |

OCCT footprint: **30 source files include OCCT headers** (`grep STEPControl|TopoDS|BRep_Builder`),
`IoExchange.cpp` being the data-exchange one. CMake hard-requires brew OCCT 7.9.3
(`CMakeLists.txt:47-67`, `find OCCT_ROOT` → fatal error if absent).

### 1.2 Native analytic STEP codec — `src/native/brep/StepAnalytic.cpp` (1312 LOC)

The real native asset. Header `include/forge/native/brep/StepAnalytic.hpp`.

**Write (`StepAnalytic::write`, `:338`)** — an id-allocating `Emitter` (`:66`) walks the
analytic topology graph bottom-up and emits a structurally-valid AP242
`ADVANCED_BREP_SHAPE_REPRESENTATION`:
- Surfaces (`emitSurface`, `:113`): `PLANE`, `CYLINDRICAL_SURFACE`, `CONICAL_SURFACE`
  (with the degenerate-cone→cylinder normalisation `:130-145` and the
  min-radius/half-angle orientation fix `:151-164` for strict OCCT readers),
  `SPHERICAL_SURFACE`, `TOROIDAL_SURFACE`, and `B_SPLINE_SURFACE_WITH_KNOTS`
  (`:182-230` — emits the control grid + compacted knot multiplicities; **write-only**,
  the reader rejects it — see §2).
- Edges (`edgeCurveFor`, `:371`): `LINE` or `CIRCLE`. `circleForEdge` (`:239`) decides if
  a directed edge is a latitude/meridian arc of a quadric and emits the exact
  `CIRCLE` + `AXIS2_PLACEMENT_3D` with the **short-arc CCW orientation fix** (`:268-277`)
  that prevents OCCT reading the complementary 100×-volume arc.
- Compact closed-sphere special case (`closedSphereSurface` `:300`, emitted `:418-444`):
  one `SPHERICAL_SURFACE` + one `ADVANCED_FACE` bounded by a degenerate `VERTEX_LOOP`
  (the OCCT-canonical form) instead of thousands of patches.
- Full AP242 product wrapper: `APPLICATION_CONTEXT` … `PRODUCT` … `PRODUCT_DEFINITION_SHAPE`
  … `GEOMETRIC_REPRESENTATION_CONTEXT(3)` with SI mm units + 1e-6 uncertainty + the
  `AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF` schema (`:525-617`).

**Read (`StepAnalytic::read`, `:1091`)** — uses `p21::locateSections`/`parseInstances`
to build the id→Instance table, then:
- Locates **exactly one** `MANIFOLD_SOLID_BREP` (`:1102`; rejects multiples `:1105`) →
  `CLOSED_SHELL`/`OPEN_SHELL` → face refs.
- Per `ADVANCED_FACE`: reconstructs the surface (`buildSurface`, `:702`) for the 5
  quadrics only; walks `FACE_OUTER_BOUND`/first `FACE_BOUND` → `EDGE_LOOP` →
  `ORIENTED_EDGE` → `EDGE_CURVE` → ring of vertices.
- `attachTrim` (`:793`) re-parameterises each face over its analytic surface — the hard,
  correctness-critical code: anchored theta-unwrap across the atan2 seam (`:841-852`),
  torus minor-angle unwrap (`:859`), pole handling (`:873-890`), cone axial-height
  recovery from the loop (`:896-908`), and **exact-disk / annular-sector** detection for
  plane caps bounded by circles (`:925-1003`) so caps integrate exactly.
- `refacetClosedSphere` (`:1018`) re-tessellates the compact one-face sphere back to a
  32×16 sector mesh sharing one analytic surface so the divergence integrator gets the
  exact volume.

**Round-trip proof** (`test/native/brep/step_analytic_test.cpp`): box, cylinder, cone,
sphere, tube, and a **bored plate (box − cylinder Cut, an analytic-face boolean result)**
preserve volume/COM/inertia to **1e-6** through write→read — analytic, not tessellation
tolerance.

### 1.3 Native faceted STEP codec — `src/native/brep/StepFaceted.cpp` (35 KB)

`StepFaceted::write/read` (`StepFaceted.hpp:153`): serialises a `StepMesh` (flat
positions+indices, `:112`) as a minimal faceted `MANIFOLD_SOLID_BREP` where every face is
a flat-triangle `PLANE` `ADVANCED_FACE`. Used by `exportStep` when the handle is a
`NativeMesh` (a fillet/chamfer/sweep/loft result has no analytic surface). Honestly
labelled "NOT claimed to be a fully AP242-conformant exchange that an arbitrary
third-party STEP processor will import" (hpp:33-41). Round-trips through its own reader
exactly. `test/native/brep/stepfaceted_test.cpp`.

### 1.4 Shared Part-21 lexer — `include/forge/native/brep/StepPart21.hpp` (281 LOC, header-only)

The real, reusable foundation. `splitTopLevel` (paren/quote-aware comma split),
`parseRef`, `parseList`, `locateSections` (ISO/HEADER/DATA envelope validation),
`parseInstances` (id→Instance table, **skips `/* */` comments**, `:202`), and
locale-independent `stepFmt`/`stepNum` (`%.17g` + `strtod`, bit-exact round-trip).
**Crucial limitation, admitted at `:27-31`:** complex/combined instances of the form
`#id=(TYPEA(...)TYPEB(...));` are stored with empty type and **not decoded** — a codec
"detects + rejects" them. Real STEP from NX/CATIA/SolidWorks uses these heavily
(e.g. the combined unit/context records, `(B_SPLINE_SURFACE(...)B_SPLINE_SURFACE_WITH_KNOTS(...)RATIONAL_B_SPLINE_SURFACE(...))`).

### 1.5 Data structures (the real constraint) — `include/forge/native/brep/Topology.hpp`, `Surface.hpp`

- **`Face` has `outerLoop` only — no inner loops / holes** (`Topology.hpp:138`,
  comment `:135-137` "no inner hole loops yet"). A face with a bored hole cannot be
  represented natively.
- **`Solid` owns one outer shell — no voids/inner shells** (`Topology.hpp:177`).
- `Surface` (`Surface.hpp:84`) is a tagged union of the 5 quadrics + a `Nurbs` fallback,
  carrying a **parameter-rectangle trim window** `[u0,u1]×[v0,v1]` only — explicitly
  "**No general trimmed-NURBS faces with arbitrary inner loops**" (`Surface.hpp:20-24`).
- `NurbsSurface` (`NurbsSurface.hpp`) can `evaluate`/`evaluateWithDerivatives` a clamped
  B-spline surface and uniformly tessellate it, but explicitly has **no trimming, no
  isocurve extraction, no surface-surface intersection, no knot refinement** (`:24-45`),
  and produces an **open, non-watertight** patch. It is an evaluator, not a trimmed-face
  builder.

### 1.6 Gate — `src/native/brep/NativeRoute.cpp`

`forgeNativeStepEnabled()` (`:71`) reads `FORGE_NATIVE_STEP`, **default OFF** (Wave 3).
`forgeNativeBrepEnabled()` (CORE) is the only one defaulted ON (Wave-1 flip 2026-06-23).
So **production data exchange is 100% OCCT** unless the env flag is set.

---

## 2. The gap vs. industrial 1:1 parity (OCCT data-exchange + Parasolid-XT/ACIS-SAT)

Concrete missing features/operators/data-structures, grouped. "OCCT-equivalent" = the
OCCT class that does it today and must be matched before OCCT can be deleted.

### 2.1 STEP reader — the keystone gap (W3.1)

- **No trimmed-NURBS surface reader.** `buildSurface` rejects `B_SPLINE_SURFACE_WITH_KNOTS`
  and every non-quadric (`StepAnalytic.cpp:746-750`, "unsupported analytic surface
  entity"). This is **the** blocker: any real-world / CADGenBench / customer part has at
  least one B-spline face and routes wholesale to OCCT (`IoExchange.cpp:67`).
  - Need: B-spline surface (`B_SPLINE_SURFACE_WITH_KNOTS`, `RATIONAL_B_SPLINE_SURFACE`,
    `BEZIER_SURFACE`, `SURFACE_OF_REVOLUTION`, `SURFACE_OF_LINEAR_EXTRUSION`,
    `OFFSET_SURFACE`) reconstruction → native face with **2-D trim loops**.
  - OCCT-equiv: `STEPControl_Reader` + `Geom_BSplineSurface` + `BRepBuilderAPI_MakeFace`
    with trim wires.
- **No face inner loops / holes.** Reader uses only `FACE_OUTER_BOUND`/first `FACE_BOUND`
  (`:1174-1192`); additional `FACE_BOUND`s (hole rings) are **dropped**. `Face` has no
  inner-loop slot to put them. → Any face with a hole imports wrong area/topology.
- **No general edge curves.** Only `LINE`/`CIRCLE` recognised. Missing `ELLIPSE`,
  `B_SPLINE_CURVE_WITH_KNOTS`, `RATIONAL_B_SPLINE_CURVE`, `POLYLINE`, `TRIMMED_CURVE`,
  `COMPOSITE_CURVE`, `PCURVE` / `SURFACE_CURVE` (the 2-D parameter-space curves that real
  STEP carries on every edge). → trimmed-NURBS faces are unbounded without pcurves.
- **No `AXIS2_PLACEMENT_2D` / 2-D geometry** for parameter-space trim loops.
- **Single-body only.** Rejects multiple `MANIFOLD_SOLID_BREP` (`:1105`); no
  `SHELL_BASED_SURFACE_MODEL`, `GEOMETRIC_CURVE_SET`, `MANIFOLD_SURFACE_SHAPE_REPRESENTATION`,
  open-shell sheet bodies, or `BREP_WITH_VOIDS`.
- **No assembly structure.** No `NEXT_ASSEMBLY_USAGE_OCCURRENCE`,
  `CONTEXT_DEPENDENT_SHAPE_REPRESENTATION`, `MAPPED_ITEM`, `ITEM_DEFINED_TRANSFORMATION`
  (instance trees with transforms) — every NX/CATIA assembly is this. OCCT does it via
  `XCAFDoc` / `STEPCAFControl_Reader`.
- **No complex-instance decode.** `StepPart21` cannot parse `#id=(A(...)B(...))`
  (`:27-31`) — required for the rational-B-spline combined records and unit records that
  every commercial exporter emits.
- **No PMI / GD&T read**, no colour/material (`STEP_visual`), no `presentation_layer`,
  no validation properties.

### 2.2 STEP writer gaps

- B-spline surface is **write-only**; cannot round-trip (its own reader rejects it).
- No hole/inner-loop emit; no multi-body; no assembly emit; no PMI as real AP242
  `dimensional_size`/`datum`/`placed_datum_target_feature` entities (only the
  comment-block stand-in, admitted `IoExchange.hpp:53-60`).
- No colour/material/name attributes; no `SHELL_BASED_SURFACE_MODEL` for sheet bodies.

### 2.3 IGES — fully missing

- **No native IGES reader** (import is OCCT `IGESControl_Reader` only).
- **No IGES writer at all** (`exportIges` throws; OCCT TKDEIGES is read-only). Need a
  from-scratch **IGES 5.3 Start/Global/Directory/Parameter/Terminate** writer covering
  Type 128 (rational B-spline surface), 126 (rational B-spline curve), 144 (trimmed
  surface), 142 (curve on surface), 186 (MSBO/manifold solid), 100/110/116 (arc/line/
  point), 314 (colour), 308/408 (subfigure/assembly).

### 2.4 STL / BREP — fully OCCT

- No native STL **reader** (binary + ASCII) or **writer** (the writer also needs a native
  tessellator — currently `BRepMesh_IncrementalMesh`). NativeRoute has
  `tessellateSolidForViewport`/`tessellateMeshForViewport` which are the **substrate** for
  a native STL writer but are not wired to file I/O.
- No native OCCT-`.brep` reader/writer (this is OCCT's own format; for autosave the native
  kernel should serialise its own `Solid`/`HalfEdgeMesh`, not OCCT binary).

### 2.5 Parasolid-XT — fully missing (and not even via OCCT)

- **No `.x_t` (text) reader**, **no `.x_b` (binary) reader**, **no writer**. OCCT cannot
  read Parasolid either — so this is a genuine net-new capability for parity, not just an
  OCCT-replacement. Need: the **Parasolid XT schema** (the published transmit-file grammar)
  — `SCH_*` typed nodes, the body/shell/face/loop/edge/vertex/fin graph, NURBS surface
  (`BSURF`) + curve (`BCURVE`), the binary container framing for `.x_b`. This is the
  single hardest item in the whole area (Siemens' format, partially documented).

### 2.6 ACIS-SAT — fully missing (and not even via OCCT)

- **No `.sat` (text) reader**, **no `.sab` (binary) reader**, **no writer**. ACIS .sat is
  a record-per-line entity stream (`body`/`lump`/`shell`/`face`/`loop`/`coedge`/`edge`/
  `vertex`/`point`, surface records `plane`/`cone`/`sphere`/`torus`/`spline`, curve records
  `straight`/`ellipse`/`intcurve`). The text grammar is well-documented and an order of
  magnitude easier than Parasolid binary — the right first foreign-kernel target. OCCT
  cannot read it; net-new.

### 2.7 JT — missing (acknowledged proprietary)

- JT (ISO 14306) LSG + XT B-rep + LOD tessellation segments. Honest throw today. Lowest
  priority — proprietary container, mostly a viewer/PLM format.

### 2.8 Healing / robustness (cross-cutting, gates all import)

- **No native sewing / shape-fix** for imported geometry (free edges, gaps, mis-oriented
  faces, sliver faces). OCCT_ZERO §4 W3.4: `mesh/Repair.cpp` vertex-weld is the substrate
  but it is not promoted to B-rep edge-merge / manifold detection. Real foreign STEP needs
  this; without it imported trimmed-NURBS bodies will not be watertight.
- **No native tolerant comparison / `ShapeCheck`** validator (W3.5) to certify an imported
  body before it enters the modeller.

---

## 3. Prioritized, incremental, A/B-verifiable build plan

Each step states the native subsystem, the verification (oracle = OCCT, frozen golden
corpus, or geometry invariant), and rough LOC. Per Bible §0: build native behind the
existing `FORGE_NATIVE_STEP` gate, keep OCCT as the runtime fallback + A/B oracle until
each step is proven, **add a topology signature to every A/B gate** (face/edge/vertex
counts + adjacency hash — OCCT_ZERO §6 warns mass-props parity alone is a silent-failure
trap), CI-green per increment.

### Phase A — substrate the keystone depends on (no behaviour change yet)

- **A1. Native trimmed-NURBS surface (eval + 2-D trim).** Extend `Surface`/`NurbsSurface`
  to a trimmed face: store the B-spline surface (rational, with knots) **plus a list of 2-D
  trim loops** in `(u,v)` space; `evaluateWithDerivatives` already exists, add point-in-
  trim classification + adaptive (curvature-driven) tessellation of the trimmed region.
  Verify: tessellate vs OCCT `BRepMesh` on the same `Geom_BSplineSurface`+wires — Hausdorff
  < 1e-4·bbox, area within 1e-4, watertight. **~1200 LOC.** *(This is OCCT_ZERO's keystone;
  everything below depends on it.)*
- **A2. Topology: inner loops + multi-shell.** Add `std::vector<Loop*> innerLoops` to `Face`
  and inner/void shells to `Solid` (`Topology.hpp`), with builder support and Euler-Poincaré
  re-derivation. Verify: bored-plate + hollow-sphere mass-props vs OCCT; topology signature
  match. **~400 LOC.**
- **A3. Part-21 complex-instance decode.** Extend `StepPart21::parseInstances` to split
  `#id=(A(...)B(...))` into sub-records and expose them; add `ELLIPSE`,
  `B_SPLINE_CURVE_WITH_KNOTS`, `RATIONAL_*`, `POLYLINE`, `TRIMMED_CURVE`, `PCURVE`,
  `SURFACE_CURVE`, `AXIS2_PLACEMENT_2D` token-level parsing. Verify: parse-only diff vs a
  hand-checked entity census on 20 OCCT-exported parts (every entity either decoded or
  explicitly listed unsupported — 0 silent drops). **~600 LOC.**

### Phase B — the keystone: foreign STEP read (W3.1)

- **B1. Trimmed-NURBS STEP reader.** Wire A1+A2+A3: in `StepAnalytic::buildSurface`,
  reconstruct `B_SPLINE_SURFACE`/`SURFACE_OF_REVOLUTION`/`SURFACE_OF_LINEAR_EXTRUSION`/
  `OFFSET_SURFACE`; in the face loop, read **all** `FACE_BOUND`s (outer + inner) with their
  `EDGE_CURVE` + `PCURVE` geometry into trim loops; support `SHELL_BASED_SURFACE_MODEL` and
  multi-`MANIFOLD_SOLID_BREP`. Verify: **A/B vs `STEPControl_Reader`** on a frozen corpus
  (CADGenBench + demo parts) — per body: volume/area/COM/inertia within 1e-4, **plus
  topology signature** (V/E/F counts + adjacency hash) match; bound scope to the AP203/AP214/
  AP242 surface subset actually present in the corpus (OCCT_ZERO §6 anti-scope-creep).
  **~1500 LOC.** *(THE critical-path item.)*
- **B2. Native sewing / shape-fix (W3.4).** Promote `mesh/Repair.cpp` weld to B-rep edge-
  merge + manifold/orientation detection + gap closing, so imported NURBS bodies are
  watertight. Verify: free-edge count → 0, solid-classifier closed, vs OCCT `ShapeFix_Shell`/
  `BRepBuilderAPI_Sewing` on the same input. **~900 LOC.**
- **B3. STEP writer parity.** Add inner-loop/hole emit, multi-body, and make
  `B_SPLINE_SURFACE_WITH_KNOTS` **round-trippable** (reader now accepts it). Verify:
  write→read→OCCT-read three-way on the corpus; OCCT imports Forge output with matching
  mass-props + topology signature. **~500 LOC.**

### Phase C — second exchange formats (each independently A/B-able)

- **C1. Native STL read + write.** Binary + ASCII reader; writer over a native
  tessellator (reuse `NativeRoute::tessellateSolidForViewport` substrate + add
  curvature-driven refinement). Verify: round-trip volume within mesh tol vs OCCT
  `StlAPI`. **~500 LOC.**
- **C2. ACIS-SAT reader (text `.sat` first, then `.sab`).** Record-stream parser →
  native B-rep (now that A1/A2 give trimmed-NURBS + inner loops). **No OCCT oracle**
  (OCCT can't read SAT) → verify against a **frozen golden corpus** exported from a
  licensed ACIS app (volume/area/topology signature pinned once), plus self-round-trip
  once C2-write lands. **~1400 LOC** (text); +600 for `.sab`. *(Right first foreign-kernel
  target — documented text grammar.)*
- **C3. ACIS-SAT writer.** Emit native B-rep → `.sat`. Verify: self round-trip + import
  into a licensed ACIS reader on the golden corpus. **~700 LOC.**
- **C4. IGES writer (5.3 S/G/D/P/T).** Type 128/126/144/142/186/100/110/116/314. Verify:
  OCCT `IGESControl_Reader` re-imports Forge IGES with matching mass-props + topology;
  also A/B the native IGES **reader** (C5) vs OCCT. **~1300 LOC** writer.
- **C5. Native IGES reader** (retire OCCT `IGESControl_Reader`). A/B vs OCCT on an IGES
  corpus. **~1200 LOC.**

### Phase D — foreign-kernel parity (Parasolid-XT) + finish

- **D1. Parasolid-XT `.x_t` (text) reader.** Implement the XT schema graph → native B-rep
  (BSURF/BCURVE → A1 trimmed-NURBS). **No OCCT oracle** → frozen golden corpus from a
  licensed Parasolid app; topology-signature + mass-props pinned. **~2200 LOC.**
- **D2. Parasolid-XT `.x_b` (binary) reader.** Binary container framing over the same
  schema decode. **~900 LOC.**
- **D3. Parasolid-XT writer (`.x_t`/`.x_b`).** Native B-rep → XT. Verify: self round-trip +
  import into a licensed Parasolid reader. **~1800 LOC.**
- **D4. JT reader** (optional / lowest priority — proprietary container; LSG + XT B-rep +
  LOD). Golden-corpus verify. **~1600 LOC.**
- **D5. STEP PMI/GD&T as real AP242 entities** (replace the comment-block stand-in):
  `dimensional_size`, `datum`, `placed_datum_target_feature`, geometric-tolerance entities,
  + colour/material/assembly (`NEXT_ASSEMBLY_USAGE_OCCURRENCE`). A/B vs OCCT `XCAFDoc`.
  **~1500 LOC.**
- **D6. Delete OCCT from the data-exchange path** only after every runtime call above is
  native and green under full regression + CADGenBench, against the frozen golden corpus
  (OCCT_ZERO §5 Phase D). Remove the 30-file OCCT include footprint's I/O slice; keep the
  golden corpus as the post-deletion truth source (the oracle-removal paradox, §6).

**Rough total to OCCT-zero data exchange: ~22k–24k LOC** of real C++ (keystone B-phase
~3.4k; STL/IGES ~4.8k; ACIS ~3.1k; Parasolid ~5.9k; PMI/assembly/healing/finish ~3.8k).
Of that, **Phase A+B (~5.1k LOC) is the unblocking core**; the foreign kernels are
additive and parallelizable once A1's trimmed-NURBS face exists.

---

## 4. The single biggest blocker + the critical path

**Biggest blocker: the native trimmed-NURBS surface (A1) → foreign STEP reader (B1).**
This is OCCT_ZERO §5's named keystone, and it is *also* the substrate for ACIS-SAT,
IGES, and Parasolid-XT reading (every one carries NURBS faces). Until A1 exists, the
native data-exchange surface can only handle Forge's own 5-quadric dialect; the first
B-spline face in any real part routes to OCCT (`IoExchange.cpp:67`), and **OCCT cannot be
removed** without losing the ability to read Forge's own benchmark/customer corpus.

**Critical path (strict precedence):**

```
A1 trimmed-NURBS face (eval + 2-D trim loops)        ← THE keystone
   └─► A2 inner loops/holes + multi-shell topology
        └─► A3 Part-21 complex-instance + curve/pcurve decode
             └─► B1 foreign STEP reader (A/B vs OCCT)   ← critical-path item
                  ├─► B2 native sewing/shape-fix (watertight imports)
                  ├─► B3 STEP writer parity (round-trip B-splines)
                  ├─► C2/C3 ACIS-SAT (reuses A1/A2; no OCCT oracle → golden corpus)
                  ├─► C4/C5 IGES (reuses A1; OCCT IGES reader = oracle)
                  └─► D1–D3 Parasolid-XT (reuses A1/A2; no OCCT oracle → golden corpus)
                       └─► D6 delete OCCT (after full regression + frozen golden corpus)
```

**Two structural watch-items (from OCCT_ZERO §6, confirmed in the source):**
1. **Coincidental mass-props parity is the silent-failure trap.** Every A/B gate here
   MUST add a topology signature (V/E/F + adjacency hash), not just volume/COM/inertia —
   the existing `step_analytic_test` checks mass-props only.
2. **Oracle-removal paradox for Parasolid/ACIS/SAT.** OCCT cannot read them, so there is
   **no A/B oracle** — these must be verified against a *frozen golden corpus* exported
   once from licensed apps, and that corpus must survive past D6 as the truth source.
