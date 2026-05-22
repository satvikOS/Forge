# Kernel-Parity Program — ArchDisc → Parasolid + ACIS Capability Parity

**Date:** 2026-05-21
**Status:** Program plan (sequenced, multi-sub-project). READ-ONLY scoping — no code changed.
**Reference:** `docs/ARCHDISC_VISION_AND_ROADMAP.md` line 312 — the *Comprehensive Exhaustive
Reference of Parasolid and ACIS Kernels* (~135 KB single line: both kernels' topology models,
their complete `api_*` / `PK_*` function surfaces, macro / history / rollback / attribute systems).
**Prior art this builds on:** `docs/superpowers/notes/parity-audit.md` (§3 list at 20/20),
`docs/parasolid-parity-plan.md` (the original honest gap statement), the A0–A5 / B / E / F / G
sub-project notes.

---

## 0. Purpose and method

ArchDisc already closed roadmap §3 — a 20-item *capability* list — by running it as a campaign:
each item got an empirical kernel recon (`brep-*-recon` specs), a facade method, a ribbon tool,
and a headed-Electron e2e. That campaign took §3 from 10/20 to 20/20.

The §3 list is **a curated slice**. The line-312 reference is the *whole instrument* — every
topological structure, every operational verb, the persistence/history/attribute machinery, the
data-exchange surface. This document decomposes that reference into capability **areas**, audits
ArchDisc against each, states the genuine gap and the realistic approach, and sequences the work
as a sustained campaign using the same proven method.

This is a **program plan**, not a sub-project plan. Each numbered sub-project in §5 will get its
own detailed `writing-plans` document when it starts, with a recon spec as step 1.

---

## 1. Reference structure — capability areas derived from line 312

The reference is continuous prose; its internal structure (extracted by offset slicing) is:

| Reference section (char offset) | Content |
|---|---|
| Intro / B-Rep + Euler-Poincaré (0) | The mathematical contract: `V − E + F = 2(S − G)` preserved through every op |
| Topological & Hierarchical Paradigms (2831) | ACIS `BODY/LUMP/SHELL/SUBSHELL/FACE/LOOP/COEDGE/EDGE/VERTEX`; Parasolid `PART/REGION/SHELL/FACE/LOOP/FIN/EDGE/VERTEX` + tokens/tags/standard-forms |
| ACIS Architectural Framework + Macro/Rollback (7463, 8005, 8567) | Memory macros, the bulletin-board **history / rollback** system, transaction macros |
| ACIS Global `api_*` Listing (11867) | The full `api_*` direct interface — blends, skinning, lofting, booleans, healing, tolerant edges |
| ACIS Class-Level Interface (29685) | `ENTITY`-derived class methods, **`ATTRIB`** attribute system |
| Parasolid Architectural Framework + PK Interface (34013) | Session/partition control, the ANSI-C `PK_*` interface model |
| Parasolid Topology Query & Graph Traversal (40713) | `PK_*_ask_*` adjacency/traversal — the evaluation & interrogation surface |
| Parasolid Advanced Transformation / Mathematics / Manipulation (56153) | Matrix transforms, **direct/synchronous** edits, attributes, BCURVE/BSURF construction, offsets, Euler operators |

From that, the **capability areas** for the parity program — the real list, deduplicated across
both kernels — are:

| # | Capability area | What it covers in the reference |
|---|---|---|
| **A** | **Topological data model & invariants** | The full B-Rep hierarchy as first-class persistent entities; manifold + non-manifold; Euler-Poincaré maintained; persistent IDs; the wire/region/lump distinction |
| **B** | **Primitive & sketch-feature construction** | Block/cylinder/cone/sphere/torus; extrude/revolve/sweep/loft; wire bodies; sheet bodies |
| **C** | **Boolean & partition operations** | Unite/subtract/intersect on NURBS B-Rep; non-manifold + multi-arg; coincident-face/fuzzy; imprint; partition by tool; slicing |
| **D** | **Blending & filleting suite** | Constant-radius, variable-radius (law curve), cliff-edge, corner mitre, face-face blends, hold-line blends, G1/G2/G3 continuity, setback corners |
| **E** | **Local / direct / synchronous operations** | Offset shape, shell/hollow, thicken, draft, face-replace, move-face / push-pull / infer-feature, delete-face + heal, taper |
| **F** | **Advanced surfacing** | NURBS curve+surface construction (BCURVE/BSURF), N-sided patch, swept/lofted/variational surfaces, surface intersection (SSI), trimmed faces, Class-A continuity & isophote analysis |
| **G** | **Sheet & tolerant modeling** | Sheet bodies, lamina, tolerant edges/vertices (tedge/tvertex), modeling on non-watertight input |
| **H** | **Healing, repair & simplification** | Auto-stitch, fill missing faces, repair self-intersection, normal harmonisation, small-feature removal, same-domain merge, geometry simplification |
| **I** | **Faceting & tessellation** | Controlled-deflection meshing, faceter options, render mesh + analysis mesh, hidden-line / silhouette |
| **J** | **Geometric & topological query / evaluation** | Adjacency traversal, point classification (in/on/out), ray-fire, curve/surface evaluation & derivatives, mass properties (analytic), curvature, bounding/clash/distance |
| **K** | **Attribute system** | User + system attributes attached to any entity; survive booleans; named-feature persistence |
| **L** | **History, rollback & transaction** | Bulletin-board delta log, roll forward/back, named marks, parametric feature replay |
| **M** | **Import / export & data exchange** | STEP AP203/214/242 (topology + PMI + colour), IGES, native x_t/x_b / SAT, faceted exchange |

Areas A–M are the parity backbone. The §3 20/20 list maps onto D (items 1-4), E (5-8), F (9-11),
C (12-14, 15), G/H (16-18), J (19-20) — i.e. §3 was a *sampling* across D, E, F, C, H, J and
left A, B, I, K, L, M and the depth of C/F essentially untouched.

---

## 2. Current-state audit — per area

Legend for "How solid": **Strong** = real algorithm, e2e-verified, multi-angle;
**Partial** = works for the common path, known documented gaps; **Thin** = exists but shallow;
**Absent** = not present as a kernel-grade capability.

| Area | ArchDisc today | Backed by | How solid |
|---|---|---|---|
| **A — Topo data model** | Two parallel models: OCCT `TopoDS_*` under the facade, and ArchDisc-native `kernel/topology/` (`TopoFace/Edge/Loop/Shell/Solid/Vertex` + `AnalyticNurbsFace`). Persistent `originalID` survives booleans. | OCCT facade + native JS | **Partial** — native model exists but is used ad-hoc (G2 blend, face-replace) not as the unified spine; no explicit LUMP/REGION/wire-body taxonomy; non-manifold only via BOP |
| **B — Primitives & sketch-features** | `makeBox/Cylinder/Sphere/Cone/Torus`, `extrudeRect/revolveRect`, `sweep/loft`, `pipeShellSweep`, `loftTangent`. | OCCT facade | **Strong** for primitives + extrude/revolve; **Partial** for general profile sweep (rect/circle profiles, not arbitrary trimmed wires) |
| **C — Booleans & partition** | `fuse/cut/common`, `fuseNonManifold`, `fuseCoincident` (fuzzy), `fuseLattice`. | OCCT facade (`BRepAlgoAPI_*`) | **Strong** for unite/subtract/intersect + non-manifold + fuzzy; **Absent**: imprint, partition-by-tool, planar slice/section as kernel ops |
| **D — Blending suite** | `filletAll`, `chamferAll`, `variableFillet`, `cliffEdgeBlend`, `mitreCorner`, `blendG2`/`g2BlendBetweenEdges` (native NURBS analytic face). | OCCT facade + native JS (G2) | **Strong** for constant/variable/cliff/mitre/G2; **Absent**: hold-line blends, true face-face blend between selected face pairs, setback corners, G3 |
| **E — Local/direct ops** | `offsetShape`, `shell`, `thicken`, `draft`, `replaceFace` (native curved-surface swap). | OCCT facade + native JS (face-replace) | **Strong** offset/shell/thicken/draft; **Partial** face-replace (native analytic face, not `TopoDS_Face`); **Absent**: move-face / push-pull / infer-feature, delete-face-and-heal |
| **F — Advanced surfacing** | `buildNurbsPatch`, `refineNurbs`, `elevateNurbsDegree`, `nurbsCurvature`, `nSidedPatch` (native variational), `intersectSurfaces` (SSI), `trimmedNurbsFace`, `classAAnalyze`, `projectPointsOntoBrep`. | OCCT facade + native JS (N-sided, pcurve projection) | **Partial** — strong building blocks, but no auto-trimming NURBS B-rep workflow (blends are constructive, caller supplies faces); Class-A is analysis-only |
| **G — Sheet & tolerant** | `stitchFaces` (tolerant sew), `convergentSolid`. Open-surface bodies accepted by `thicken`. | OCCT facade | **Partial** — tolerant stitching works; no first-class sheet-body / lamina / tedge-tvertex taxonomy or tolerant-modeling guarantees |
| **H — Healing & simplification** | `simplify` (small-face removal + same-domain merge), `selfIntersect` (native Möller detector), `checkSelfIntersection`. | OCCT facade + native JS | **Partial** — detection + simplification present; **Absent**: auto-fill missing faces, auto-repair (not just detect) self-intersection, normal harmonisation |
| **I — Faceting & tessellation** | `tessellate` / `brepToMesh` at a fixed deflection; `lod/` module. | OCCT facade | **Thin** — single render mesh; no faceter option surface (angular + chordal tol, analysis vs render mesh), no silhouette/hidden-line |
| **J — Query & evaluation** | `measure` (volume/area/face+edge count/bbox), `checkClash`, `BrepMeasure`, `nurbsCurvature`. | OCCT facade | **Partial** — mass metrics + clash + distance present; **Absent**: point classification (in/on/out), ray-fire, exposed curve/surface evaluation+derivatives API, moments of inertia / centroid, full adjacency-traversal API |
| **K — Attribute system** | `originalID` on solids only. | ad-hoc | **Thin** — no general attribute objects, no per-face/edge user data, no attribute survival contract through ops |
| **L — History / rollback** | Design History UI (Phase 2) at the app level; **no kernel-level** bulletin-board / rollback. | app only | **Absent** at kernel level — feature replay is app-orchestrated, not a kernel transaction log |
| **M — Import / export** | `exportStep` / `importStep`; `B_SPLINE_SURFACE_WITH_KNOTS` export for native NURBS faces; glTF/STL via app. | OCCT facade + native StepExport | **Partial** — STEP topology in/out works; **Absent**: AP242 PMI/colour/tolerance, IGES, faceted-exchange round-trips, attribute carriage |

**Net:** ArchDisc has a strong *operational* core (B, C, D, E mostly Strong) but the *kernel
infrastructure* areas — A (unified topology spine), I (faceter), K (attributes), L (history),
and the depth of F/J — are where genuine Parasolid/ACIS parity is missing.

---

## 3. Gap + approach per area

For each area: the genuine gap vs. Parasolid/ACIS, the approach, and an effort tier.

**Approach legend:**
- **Facade-expose** — OCCT already implements it; the work is a recon spec + facade method +
  ribbon tool + e2e. Low-to-medium effort. This is how most of §3 closed.
- **Native-JS** — OCCT lacks it, or the `opencascade.js@2.0.0-beta` binding gap blocks it
  (e.g. `ShapeConstruct_ProjectCurveOnSurface` unbound); implement as a genuine pure-JS
  algorithm on `kernel/topology/` + `foundation/`. Medium-to-high effort.
- **Hard** — needs real new kernel engineering (a subsystem, not an op). Multi-month.

**Effort tiers:** T1 ≈ 1 sub-project (the §3-item size); T2 ≈ 2–3 sub-projects; T3 ≈ a
multi-sub-project subsystem.

| Area | Genuine gap vs Parasolid/ACIS | Approach | Tier |
|---|---|---|---|
| **A — Topo data model** | No single unified topology spine; LUMP/REGION/wire-body taxonomy absent; non-manifold not first-class | **Native-JS** — promote `kernel/topology/` to *the* model: explicit `Body→Lump→Shell→Face→Loop→Coedge/Fin→Edge→Vertex`, wire + sheet + solid body kinds, OCCT as a *geometry engine* behind it. This is the spine everything else hangs on. | T3 |
| **B — Primitives & sketch-features** | General profile sweep limited to rect/circle profiles | **Facade-expose** — arbitrary trimmed-wire profiles into `BRepOffsetAPI_MakePipe*` / `MakePrism` | T1 |
| **C — Booleans & partition** | Imprint, partition-by-tool, planar slice/section missing as kernel ops | **Facade-expose** — `BRepFeat`, `BOPAlgo_Splitter`, section curves all in OCCT | T1 |
| **D — Blending suite** | Hold-line blends, selected-pair face-face blend, setback corners, G3 | Mixed — face-face blend + setback **Facade-expose** (`ChFi3d`); hold-line + G3 **Native-JS** (extend `BrepBlendG2`) | T2 |
| **E — Local/direct ops** | Move-face / push-pull / infer-feature, delete-face-and-heal | **Facade-expose** `BRepFeat` for delete-face + local edits; **Native-JS** the infer-feature direction-detection layer; push-pull is the headline direct-modeling sub-project | T2 |
| **F — Advanced surfacing** | No auto-trimming NURBS B-rep workflow; Class-A is analysis-only | **Native-JS / Hard** — the auto-trimming kernel is the hardest single piece (the `parasolid-parity-plan.md` "NURBS-aware booleans" item); SSI tracing exists, trimmed-loop assembly does not | T3 |
| **G — Sheet & tolerant** | No first-class sheet/lamina/tedge-tvertex taxonomy | **Native-JS** — once area A's model exists, sheet bodies + tolerant edges are body-kind + per-entity tolerance fields on the spine | T2 |
| **H — Healing & repair** | Auto-fill missing faces, auto-repair (not just detect), normal harmonisation | **Facade-expose** — `ShapeFix` / `ShapeHealing` covers most; gap-fill of missing faces leans on the area-F N-sided patch | T1 |
| **I — Faceting & tessellation** | No faceter option surface; no silhouette/hidden-line | **Facade-expose** — `BRepMesh_IncrementalMesh` already exposes angular+chordal tol; `HLRBRep_Algo` for hidden-line | T1 |
| **J — Query & evaluation** | Point classification, ray-fire, curve/surface eval+derivatives, moments of inertia, adjacency API | **Facade-expose** — `BRepClass3d_SolidClassifier`, `IntCurvesFace_ShapeIntersector`, `GeomAdaptor`, `BRepGProp` (centroid + inertia) all in OCCT; bundle as the kernel query API | T2 |
| **K — Attribute system** | No general attribute objects; no survival contract | **Native-JS** — attribute objects keyed to the area-A persistent IDs; survival hooks in each op wrapper | T2 |
| **L — History / rollback** | No kernel-level transaction log / rollback | **Native-JS / Hard** — a bulletin-board delta log over the area-A model: every op records a forward+inverse delta; named marks; replay. Real new engineering. | T3 |
| **M — Import / export** | AP242 PMI/colour/tolerance, IGES, faceted exchange, attribute carriage | **Facade-expose** — OCCT `STEPCAFControl` / `IGESControl` / `XCAFDoc` cover PMI+colour; attribute carriage depends on area K | T2 |

**Honest hardest three:** A (unified topology spine), F (auto-trimming NURBS B-rep), L (kernel
history/rollback). These are subsystems, not ops — they are what separates a kernel from a
collection of operations.

---

## 4. Sequenced sub-project roadmap

Ordered so each sub-project produces working, e2e-verified capability, and dependencies are
respected. The same campaign method as §3: **recon spec → facade method → ribbon tool →
headed-Electron e2e with multi-angle / in-motion capture**.

Each sub-project below is a *headline*; it gets a full `writing-plans` document when it starts.

### Phase K1 — Kernel infrastructure spine (the foundation everything else needs)

1. **SP-1 · Unified topology spine (Area A).** `T3`. Promote `kernel/topology/` to the single
   model: `Body{kind: solid|sheet|wire} → Lump → Shell → Face → Loop → Coedge → Edge → Vertex`,
   with OCCT as the geometry engine behind it. Every existing facade op re-expressed to produce
   spine entities. *Depends on: nothing. Blocks: G, K, L and the depth of everything else.*
2. **SP-2 · Persistent attribute system (Area K).** `T2`. Attribute objects keyed to spine
   entity IDs; survival hooks wired into every op wrapper; e2e proves an attribute on a face
   survives a boolean + a fillet. *Depends on: SP-1.*
3. **SP-3 · Kernel history & rollback (Area L).** `T3`. Bulletin-board delta log over the spine;
   forward/inverse delta per op; named marks; roll forward/back; replay. e2e: build → mark →
   3 ops → roll back to mark → roll forward, verifying topology hash at each step.
   *Depends on: SP-1, SP-2.*

### Phase K2 — Operational depth (broad capability, mostly facade-expose, runs partly parallel to K1)

4. **SP-4 · Query & evaluation API (Area J).** `T2`. Point classification, ray-fire, curve/
   surface evaluation + derivatives, centroid + moments of inertia, adjacency traversal.
   *Depends on: SP-1 (entities to traverse). Mostly facade-expose — can start early.*
5. **SP-5 · Boolean & partition completion (Area C).** `T1`. Imprint, partition-by-tool,
   planar slice/section. *Depends on: SP-1.*
6. **SP-6 · Sketch-feature generalisation (Area B).** `T1`. Arbitrary trimmed-wire profile
   sweep/extrude/revolve. *Depends on: SP-1.*
7. **SP-7 · Faceter option surface (Area I).** `T1`. Angular+chordal tol control, analysis
   vs render mesh, hidden-line / silhouette. *Depends on: nothing hard — can run parallel.*
8. **SP-8 · Healing & repair completion (Area H).** `T1`. Auto-fill missing faces, auto-repair
   self-intersection, normal harmonisation. *Depends on: SP-1; gap-fill uses SP-12.*

### Phase K3 — Surfacing & direct modeling (the hard differentiators)

9. **SP-9 · Direct / synchronous modeling (Area E).** `T2`. Move-face / push-pull / infer-
   feature, delete-face-and-heal. *Depends on: SP-1, SP-4 (needs evaluation to infer feature
   intent).*
10. **SP-10 · Blending suite completion (Area D).** `T2`. Hold-line blends, selected-pair
    face-face blend, setback corners, G3. *Depends on: SP-1.*
11. **SP-11 · Sheet & tolerant modeling (Area G).** `T2`. First-class sheet/lamina bodies,
    tolerant edges/vertices, tolerant-modeling guarantees. *Depends on: SP-1.*
12. **SP-12 · Auto-trimming NURBS B-rep (Area F).** `T3`. The hardest piece: SSI-traced
    intersection curves assembled into trimmed loops → a self-consistent NURBS B-rep.
    *Depends on: SP-1; consumes existing `intersectSurfaces` + `trimmedNurbsFace` + pcurve
    projection.*

### Phase K4 — Data exchange & hardening

13. **SP-13 · Data exchange completion (Area M).** `T2`. AP242 PMI/colour/tolerance, IGES,
    faceted exchange, attribute carriage. *Depends on: SP-1, SP-2.*
14. **SP-14 · Robustness hardening pass.** `T3` (ongoing). Adversarial-input corpus, fuzzing
    of boolean/blend chains, degeneracy handling. See §6 — this is continuous, not a finish line.

**Critical path:** SP-1 → (SP-2 → SP-3) and SP-1 → SP-12 are the long poles. SP-4, SP-5, SP-6,
SP-7 can be worked in parallel by separate campaign passes once SP-1 lands. SP-7 has no hard
dependency and can start immediately as a quick win.

---

## 5. UI/UX-fully-equipped track

Parity is not just kernel functions — the user wants the platform UI/UX **fully equipped
alongside** the kernel. Every kernel op must be a real viewport interaction, not an API the
AI alone can reach. The standard (from `feedback_sophisticated_integrations.md` and
`feedback_no_floating_panels.md`):

**Per-op UI contract** — every new kernel op ships with all four:
1. **Ribbon tool** in the correct workbench tab (Part / Assembly / Surface / Drawing / Simulate),
   integrated into the ribbon like existing tools — **no floating debug panels**.
2. **Parameter dialog** — every parameter the kernel op exposes is a dialog field with sane
   defaults and validation (the §3 tools already did this for 15 ops).
3. **Selection-driven input** — the op consumes the user's viewport selection (faces / edges /
   bodies via the gizmo pick-set), never hardcoded demo inputs.
4. **In-motion e2e** — a headed-Electron spec that clicks the ribbon tool, fills the dialog,
   drives the selection by real picks, records slow-mo video + key-frame stills, and screenshots
   from multiple angles + zooms (`feedback_e2e_all_angles.md`, `feedback_e2e_in_motion.md`).

**Track-specific UI work that is more than a per-op dialog:**
- **History panel ↔ kernel rollback (SP-3).** The existing app-level Design History must be
  re-backed by the SP-3 kernel transaction log: timeline scrub = roll forward/back; edit a
  feature = re-anchor and replay. This is the headline UI integration of the program.
- **Attribute inspector (SP-2).** A selection-driven panel showing the attributes on the
  picked face/edge/body; user-editable user-attributes.
- **Direct-modeling drag (SP-9).** Push-pull must be a *drag* on a face in the viewport with
  live preview, not a dialog with a number — this is the marquee direct-modeling UX.
- **Class-A analysis overlays (Area F).** Curvature combs, zebra stripes, draft analysis,
  isophotes rendered as viewport overlays (some already exist via `SurfaceCurvature.js`;
  wire the rest into a Surface-tab analysis ribbon group).
- **Faceter controls (SP-7).** A tessellation-quality control surface (render vs analysis
  mesh, deflection sliders) in the view settings.
- **Query readouts (SP-4).** Point-classification, ray-fire, mass-properties as a measurement
  ribbon group with viewport readout, matching the existing `Interference` tool pattern.

Each sub-project's `writing-plans` doc must include its UI contract items as explicit,
e2e-verified deliverables — UI is in-scope per sub-project, not deferred to an "integration
phase."

---

## 6. Honest scale assessment

This section is deliberately blunt; the program will be executed as a sustained campaign and
inflated expectations help no one.

**Full Parasolid + ACIS parity is a multi-year effort.** Parasolid is ~2 million lines of C++,
refined by Siemens for 35 years; ACIS is comparable. They are licensed by NX, SolidWorks,
Onshape, CATIA and dozens more. The line-312 reference enumerates *thousands* of `api_*` /
`PK_*` functions. No realistic plan delivers all of that in months.

**What this plan honestly delivers:** *functional capability, area by area.* Each of the 14
sub-projects produces a working, e2e-verified slice. When all 14 are done, ArchDisc will have
functional coverage across all 13 capability areas A–M — a real kernel with a unified topology
spine, attributes, history/rollback, the full operational suite, surfacing, and data exchange.
That is a genuine, honest milestone: *functional parity on capability breadth.*

**What functional capability is NOT:** robustness hardened across millions of real-world parts.
Parasolid's true moat is not its function list — it is 35 years of every degenerate case
(coincident tangent faces, zero-length edges, near-singular NURBS, sliver geometry,
self-intersecting imports) having been hit by real users and fixed. That hardening is **time +
real-world usage**, and it is *distinct from functional capability*. SP-14 (the hardening pass)
is explicitly framed as **ongoing, not a finish line** — an adversarial corpus, fuzzing of long
op chains, and degeneracy handling that grows as ArchDisc gets real use. We will not claim
"Parasolid-robust"; we will claim "functionally complete across areas A–M, with hardening as a
continuous discipline."

**Honest residual gaps that persist even after all 14 sub-projects:**
- The `opencascade.js@2.0.0-beta` binding has unbound symbols (documented in the recon notes);
  some ops are native-JS *because* of binding gaps, not because the algorithm is novel. A
  custom OCCT WASM build (Docker-gated, per `project_parity_closure.md`) would convert several
  native-JS pieces back to facade-expose and is a parallel option, not a blocker.
- Native-JS analytic faces (G2 blend, N-sided patch, face-replace) are ArchDisc-native, not
  OCCT `TopoDS_Face` objects — they interoperate via STEP export and the spine, but a fully
  unified single representation is itself part of SP-1's long-term goal.
- "Class-A modeling workflow" (the iterative surface-quality craft loop) is broader than the
  Class-A *analysis* this plan delivers; a true Class-A authoring workflow is a product effort
  beyond kernel parity.

**Bottom line:** this plan is a credible, sequenced route to *functional* Parasolid/ACIS
capability parity across all 13 areas, executed as a campaign of 14 e2e-verified sub-projects,
honest that robustness hardening is a separate, continuous, multi-year discipline.

---

## Appendix — mapping §3 (20/20) onto the new area model

| §3 group | §3 items | Area | Status carried forward |
|---|---|---|---|
| §3.1 Blending | 1–4 | D | Done; D extends with hold-line / face-face / setback / G3 (SP-10) |
| §3.2 Local Operations | 5–8 | E | Done; E extends with direct/synchronous (SP-9) |
| §3.3 Advanced Surfacing | 9–11 | F | Done; F extends with auto-trimming B-rep (SP-12) |
| §3.4 Boolean & Topology | 12–15 | C | Done; C extends with imprint/partition/slice (SP-5) |
| §3.5 Healing & Conversion | 16–18 | G, H | Done; extends with sheet/tolerant (SP-11) + auto-repair (SP-8) |
| §3.6 Evaluation & Checking | 19–20 | J | Done; J extends with classification/ray-fire/inertia (SP-4) |

§3 left **A, B, I, K, L, M untouched** — those are exactly Phase K1 (SP-1/2/3), SP-6, SP-7,
SP-13. That is the honest measure of the distance still to cover.
