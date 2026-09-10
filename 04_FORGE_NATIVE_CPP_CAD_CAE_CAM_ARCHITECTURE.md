# Forge Native C++ CAD + CAE + CAM Architecture

## North star

Forge is a native engineering workbench in which CAD, CAE, CAM, manufacturability, documentation and Archie are not separate disconnected applications. They operate on one authoritative project graph.

The app must feel interactive like a mature CAD product even when the internal project is large. This requires aggressive separation of:
- authoritative engineering state;
- derived render state;
- heavy analysis state;
- AI state.

## Layer architecture

| Layer | Responsibility |
|---|---|
| L0 — Forge Guardian | Process supervision, memory/disk/thermal-pressure policy, job admission, checkpoints, watchdogs |
| L1 — Native Shell | Windowing, input, commands, panels, workspace switching, accessibility, project lifecycle |
| L2 — Project/Document Graph | Parts, bodies, sketches, features, assemblies, configurations, presentation states, provenance |
| L3 — Archie Intelligence | Intent parsing, planning, semantic edits, recovery, engineering explanations |
| L4 — Typed Engineering IR | Versioned contract between AI/UI/importers and execution engines |
| L5 — Geometry/Constraint Kernel | Sketch solving, B-Rep features, booleans, healing, persistent naming, recompute |
| L6 — Assembly/Kinematics | Components, instances, joints, DOF, collision, interference, motion |
| L7 — CAE | Mesh, material, loads/BCs, FEM/FEA, CFD adapters, transient result streams |
| L8 — CAM/DFM | Process selection, manufacturability rules, setups, stock, tools, toolpaths, verification |
| L9 — Visualization | Metal renderer, tessellation cache, LOD, sectioning, picking, field/result overlays |
| L10 — Interoperability/Docs | STEP/IGES/STL/OBJ/glTF/3MF as supported; drawings, BOM, reports, inspection/setup sheets |
| L11 — Evaluation/Telemetry | CAD validity, regression, benchmark evidence, performance counters |

**L0 is cross-cutting.** No layer may bypass its resource reservations for heavy work.

## Native application strategy

### Language

C++20/23 for product core and product-facing application logic.

### Window/input

To remain C++-only at the product source level without a JavaScript shell, use a thin native abstraction such as SDL3 for OS window/input lifecycle and a custom retained-mode Forge UI layer. Do not build the long-term product UI out of immediate-mode debug widgets.

### Rendering

Metal through C++ bindings (`metal-cpp`) on macOS.

Viewport architecture:
- retained scene graph;
- GPU instancing;
- indirect/batched drawing;
- hierarchical bounding volumes;
- frustum and occlusion culling;
- screen-space LOD;
- separate picking acceleration structure;
- asynchronous tessellation upload;
- clipping/section planes;
- hidden-line/wireframe/shaded/PBR modes;
- engineering overlays;
- double/triple buffering without unbounded command-buffer accumulation.

## Geometry kernel

Use Open CASCADE Technology as the initial industrial C++ B-Rep foundation, wrapped behind Forge-owned interfaces. OCCT is a C++ CAD/CAM/CAE development platform and supports surface/solid modeling, data exchange and shape healing.

Do **not** expose OCCT types across the whole application. Forge owns:
- stable IDs;
- feature semantics;
- transaction logic;
- persistent naming;
- parameter system;
- recompute DAG;
- error taxonomy;
- serialization.

This makes the kernel replaceable/augmentable and prevents the product model from becoming an OCCT object graph.

## Feature system

The feature system must support at minimum:

**Reference**
- origin, planes, axes, coordinate systems, points, projected/intersection geometry.

**Sketch**
- line, construction line, arc, circle, ellipse, spline, polygon, point, text if appropriate;
- coincident, horizontal, vertical, parallel, perpendicular, tangent, concentric, equal, symmetry, midpoint, fixed, distance, angle, radius/diameter;
- dimensional expressions, units and named parameters;
- under/fully/over-constrained diagnosis.

**Solid**
- extrude/pad, pocket/cut, revolve, groove, sweep, loft, hole, thread metadata, rib/web, shell, draft, fillet, chamfer, mirror, patterns, split, boolean, multi-body, transform.

**Surface/freeform**
- ruled/lofted/swept surfaces;
- trim/split;
- extend;
- offset;
- sew;
- fill/boundary surface;
- continuity targets G0/G1/G2 where supported;
- curve/surface analysis tools;
- later Class-A workflows with curvature combs, zebra and highlight analysis.

## Persistent feature tree and recompute graph

The UI tree is a projection of a deeper dependency DAG.

Every node stores:
- stable semantic ID;
- feature type;
- owner document/body;
- parameter block;
- upstream references;
- produced entities;
- suppressed/configuration state;
- validation state;
- provenance;
- cost metrics;
- last successful kernel result;
- recovery notes.

Recompute:
1. mark dirty node;
2. find downstream closure;
3. topologically order;
4. use cached unchanged upstream states;
5. execute in transaction;
6. validate each node;
7. update persistent-name mapping;
8. commit graph atomically.

## Topological naming

This is a major product risk. “Face 12” cannot be the durable semantic reference because feature recomputation can renumber faces.

Forge should maintain semantic references using a combination of:
- feature provenance;
- geometric signatures;
- adjacency/topology descriptors;
- orientation/location;
- role labels such as `mounting_face` or `hole_cylinder_3`;
- matching score after recompute;
- explicit ambiguity state.

If identity cannot be resolved confidently, pause dependent mutation and ask/replan rather than silently binding to a wrong face.

## Transaction engine

Every mutation is a `ForgeTransaction`.

Phases:
- `prepare`;
- `resolve_references`;
- `dry_run`;
- `execute_kernel`;
- `validate_geometry`;
- `validate_semantics`;
- `validate_dependencies`;
- `validate_resource_budget`;
- `commit`;
- `emit_events`.

Any failure rolls back to the last known-good document graph without partially mutating the user-visible model.

## Assemblies

Assembly graph supports:
- part/subassembly instances;
- rigid transforms;
- joints/mates;
- limits;
- gears/racks/cams where supported;
- contact candidates;
- interference;
- clearance;
- flexible/reference components later;
- configurations;
- exploded states;
- BOM identity separate from instance identity.

Kinematics operates on joint graph, not tessellation.

## Large-assembly architecture

For truck/aircraft-level assemblies:

**Four representations per component:**
1. metadata-only;
2. bounding/proxy;
3. lightweight tessellation;
4. exact B-Rep.

Load exact B-Rep only when required for edit, measurement, interference, local high-quality sectioning or analysis.

Additional mechanisms:
- memory-mapped caches;
- per-subassembly working sets;
- BVH hierarchy;
- instance batching;
- tessellation decimation tiers;
- background load/decode;
- asynchronous selection refinement;
- branch-level unload;
- geometry deduplication for identical instances.

## CAE architecture

Do not conflate FEA, FEM, FMEA and CFD.

- **FEM**: numerical discretization method.
- **FEA**: engineering analysis using finite elements.
- **CFD**: fluid-flow numerical simulation.
- **FMEA**: structured failure-mode/risk analysis; not a numerical field solver.

### Native finite-element core

MFEM is a strong permissive C++ candidate for a Forge-owned FEM layer, with PETSc optionally used for scalable linear/nonlinear solver infrastructure where appropriate.

Initial Forge CAE should implement:
- linear static structural;
- modal;
- steady thermal;
- coupled thermal-structural path;
- transient visualization architecture.

Then extend:
- nonlinear/contact;
- explicit/dynamics via separately evaluated engines;
- CFD through a solver adapter such as SU2 where licensing/deployment fit.

GPL/AGPL solver stacks must not be casually linked into a proprietary monolith. Treat them as separately distributed/external solver processes only after a legal architecture review.

### “Real-time” simulation

Create three fidelity tiers:

**Tier R — interactive response**
- analytic approximations;
- beam/shell reduced models;
- coarse meshes;
- reduced-order models;
- surrogate response;
- incremental local recompute.
Target: interactive update.

**Tier P — preview solve**
- moderate mesh;
- local iterative solve;
- progressive residual display;
- cancellable.
Target: seconds to minutes.

**Tier H — high fidelity**
- full FEM/CFD/transient/contact.
Target: correctness and convergence, not fake instantaneity.

The viewport streams partial/progressive results without blocking the app.

## FMEA engine

FMEA is a structured knowledge graph linked to the actual design:
- function;
- component/feature;
- failure mode;
- effect;
- cause;
- current control;
- severity;
- occurrence;
- detection;
- action;
- owner/status;
- evidence.

Archie may propose FMEA rows, but risk scoring and assumptions are explicit and reviewable.

## Manufacturability / DFM

Run process-specific analyzers.

### CNC machining
- tool access;
- internal corner radius;
- deep/narrow pocket;
- hole aspect ratio;
- minimum wall;
- setup count;
- undercuts;
- datum strategy;
- reach/collision;
- stock utilization.

### Additive
- minimum wall/feature;
- overhang/support;
- trapped volume;
- orientation;
- anisotropy warnings;
- escape holes;
- build envelope.

### Injection molding
- draft;
- wall uniformity;
- sink/rib heuristics;
- undercuts;
- parting line;
- gate/ejector candidates;
- moldability.

### Sheet metal
- thickness consistency;
- bend radius;
- K-factor/bend allowance;
- relief;
- flange interference;
- flat pattern.

Every finding includes:
- target feature ID;
- severity;
- violated rule;
- measured value;
- recommended change;
- predicted consequence;
- one-click Archie-generated repair plan;
- before/after verification.

## CAM

CAM is a separate execution graph over the same geometry:
- manufacturing setup;
- stock;
- work coordinate system;
- machine;
- holder/tool library;
- operation;
- parameters;
- rest material;
- simulation state;
- post-processor.

Start with deterministic 2.5D milling/drilling/contouring. Add 3-axis, turning, multi-axis and advanced strategies only after toolpath verification is mature.

Never emit machine code as “safe” merely because generation succeeded. Require:
- toolpath bounds;
- collision/holder check;
- stock-removal simulation;
- feed/speed range checks;
- machine/post profile;
- explicit export review.

## Documentation

Documentation is generated from authoritative model state:
- associative drawings;
- BOM;
- cut lists;
- GD&T annotations;
- material/finish;
- revision history;
- DFM report;
- FEA/CFD report;
- FMEA;
- manufacturing setup sheets;
- inspection plan;
- provenance and assumption log.

## Interoperability

Prioritize:
- STEP AP242 for high-value B-Rep/assembly exchange where supported;
- STEP AP203/AP214 compatibility as needed;
- IGES for legacy surfaces;
- STL for mesh manufacturing exchange;
- OBJ/glTF for visualization;
- 3MF for additive workflows where implementation/license is acceptable;
- Forge native project format for complete history/semantics.

Important: STL/OBJ do not preserve parametric history. STEP usually preserves precise B-Rep/assembly data, but a generic STEP import does not magically reconstruct the original vendor feature tree. Forge must label recognized/inferred history honestly.

## Export verification

Every serious export has an optional strict mode:
1. export;
2. open in a fresh importer process;
3. validate topology;
4. compare bounding box, volume, surface area and selected geometric signatures;
5. compare assembly count/transform metadata where relevant;
6. log any degradation;
7. only then mark round-trip verified.
