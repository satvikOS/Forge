# Archie Model, Data and Training Specification

## Objective

Build a local engineering-reasoning model that is exceptionally strong at turning intent into **valid typed engineering programs**, not at hallucinating CAD syntax or producing attractive meshes.

The target is a domain-specialized engineering agent whose system-level CAD performance can approach or exceed general frontier models on Forge tasks because it has:
- a constrained engineering language;
- deterministic execution;
- exact verifier feedback;
- proprietary failure/recovery traces;
- strong retrieval;
- multimodal drawing/CAD encoders;
- domain adapters;
- a persistent engineering memory;
- an evaluation harness that rejects plausible-but-wrong output.

## Recommended model topology for an M4 Max with 36 GB unified memory

### Primary reasoning model

A strong candidate is **gpt-oss-20b** because it is an open-weight reasoning model, commercially permissive under Apache 2.0 subject to its usage policy, supports structured/agentic workflows, and is designed to run in constrained local memory. Treat it as a candidate, not a sacred dependency: Archie must have a model-provider abstraction so a better permissively licensed model can replace it.

### Runtime

Production inference: `llama.cpp` embedded behind a C++ service boundary, using Metal on Apple Silicon and GGUF/appropriate quantization.

Do not embed the Python training stack inside Forge.

### Training stack

For Apple-Silicon adapter experiments, MLX/MLX-LM supports LoRA and quantized-model LoRA. Keep it in a **separate training repository/environment**. Before any long run, execute a short canary because current MLX/MoE combinations can have model/version-specific failure modes.

### Specialist design

Do not load five 20B models at once. Use one major resident planner plus lightweight specialists or adapters:

- `archie-core`: intent, decomposition, planning, recovery.
- `archie-sketch`: sketch constraints and dimensions.
- `archie-brep`: feature sequencing and topology-sensitive operations.
- `archie-assembly`: hierarchy, joints, DOF, interference.
- `archie-drawing`: drawings, GD&T, BOM, orthographic correspondence.
- `archie-dfm-cam`: manufacturing constraints/process planning.
- `archie-cae`: analysis setup, BC/load/material/mesh reasoning.
- `archie-repair`: failure interpretation and minimal replanning.

Adapters can be hot-swapped only at safe job boundaries. If adapter switching becomes a latency problem, distill/fuse proven behavior into release checkpoints after evaluation.

## Multimodality

A text-only reasoning model is not enough for drawing-to-CAD.

Use a separate local vision/geometry front end that converts:
- engineering drawings;
- screenshots;
- renders;
- point clouds;
- tessellated meshes;
- imported B-Rep topology

into a normalized `ObservationIR`.

The core reasoning model should consume **structured observations**, not raw millions of mesh tokens.

Examples:
- drawing parser -> lines/arcs/circles, dimensions, view graph, OCR values, datums, tolerances;
- B-Rep encoder -> face/edge/coedge graph + surface/curve types + UV samples;
- point-cloud encoder -> geometric descriptors + candidate primitives/features;
- assembly encoder -> component graph + joints/contact/collision relationships.

## Training representation

Do not train the model primarily to emit Python CAD code. That reproduces another tool’s API and couples reasoning to a scripting language.

Train it to emit Forge’s typed IR:
- `IntentGraph`;
- `SketchIR`;
- `FeatureIR`;
- `PartGraph`;
- `AssemblyIR`;
- `AnalysisIR`;
- `ManufacturingIR`;
- `DocumentationIR`;
- `RepairPlan`.

A compiler may translate research datasets that contain CadQuery/build123d/Python programs into Forge IR, but the canonical target remains Forge IR.

## Curriculum

### Stage A — schema fluency

Teach strict, valid structured output:
- units;
- references;
- constraints;
- feature IDs;
- dependency edges;
- preconditions;
- postconditions;
- confidence;
- unresolved assumptions;
- validation requests.

Success metric: near-perfect schema validity before complex geometry is introduced.

### Stage B — single-feature primitives

Synthetic, exact tasks:
- datum planes/axes/CSYS;
- lines/arcs/circles/splines;
- constraints;
- extrude;
- cut;
- revolve;
- holes;
- chamfer;
- fillet;
- shell;
- draft.

Every sample is generated and revalidated by Forge.

### Stage C — compound parametric parts

Add:
- multi-sketch dependency;
- patterns;
- mirrors;
- sweeps;
- lofts;
- ribs;
- thin features;
- surface operations;
- split/trim;
- boolean bodies;
- configurations;
- design tables.

### Stage D — semantic editing

The model sees an existing model graph plus an instruction such as:
- “make the wall 20% thicker without changing mounting-hole centers”;
- “replace M6 holes with M8 and preserve the bolt pattern”;
- “remove cosmetic threads for performance”;
- “move this bracket while preserving hose clearance.”

Reward is based on satisfying the requested delta **and preserving explicit invariants**.

### Stage E — failure and recovery

Generate adversarial failures:
- invalid fillet radius;
- self-intersecting loft;
- overconstrained sketch;
- missing reference;
- topological-name change;
- impossible mate set;
- zero-thickness boolean;
- bad STEP import;
- non-manifold result;
- solver divergence.

Train Archie to inspect kernel errors, form a minimal repair hypothesis and change the smallest possible part of the plan.

### Stage F — assemblies

Train:
- bottom-up and top-down assembly planning;
- mates/joints;
- repeated components;
- symmetry;
- configurations;
- mechanism motion;
- interference and tolerance constraints;
- exploded views;
- BOM semantics.

### Stage G — drawings and documentation

Train bidirectionally:
- 3D -> drawing/BOM/GD&T;
- drawing -> feature graph;
- change request -> synchronized drawing/model update.

### Stage H — CAE and CAM planning

Train on engineering setup, not fabricated solver answers:
- material assignment;
- mesh strategy;
- BCs;
- loads;
- contacts;
- timestep/solver controls;
- convergence criteria;
- manufacturing process choice;
- stock/tool/setup planning;
- tool access and collision;
- inspection features.

The numerical solver remains authoritative.

## Dataset landscape and license policy

### MM-CAD:A / MMCAD

Useful for multimodal representation learning: tens of thousands of engineering models aligned across meshes, point clouds, renders/sketches and captions.

**Critical:** the released aggregation is CC BY-NC 4.0 and source geometries have their own upstream licenses. This is a research/evaluation source unless ArchDisc obtains commercial rights or constructs a legally clean subset. Do not silently train a commercial shipping model on the full release.

### Fusion 360 Gallery

Excellent for human parametric sequences, feature segmentation and assembly graphs/joints. Its published dataset license restricts use to non-commercial research. Use for research/benchmarking unless separate rights are obtained.

### SketchGraphs

Extremely valuable for geometric-constraint reasoning due to its scale. Do not assume the repo license automatically grants commercial rights to the underlying design corpus. Record provenance and terms per dataset.

### DeepCAD / Text2CAD / CAD-Coder / CAD-Recode

Architecturally useful because they expose sequential CAD programs and/or text alignment. Treat each dataset’s license and source provenance independently. Convert representations to Forge IR only after license approval.

### ABC / B-Rep corpora

Valuable for curves, surfaces, topology and B-Rep complexity. Use BRepNet/UV-Net/AutoBrep/BrepGen research ideas to inform encoders/tokenization. Code license and dataset license are separate questions.

### CADGenBench and CADBench

Use as external diagnostics:
- CADGenBench directly evaluates generation and editing via STEP/BREP outputs.
- CADBench adds multimodal CAD-program reconstruction and reports strong degradation as geometric complexity rises.

Do not train on private/held-out benchmark truth.

## The proprietary data moat

The safest and strongest long-term training corpus is **Forge-generated and Forge-verified**.

Generate millions of owned examples by sampling:
- feature programs;
- dimensions and constraints;
- topology classes;
- assembly graphs;
- materials/process constraints;
- drawing views;
- edits;
- intentional failures;
- recovery paths.

For every generated project, store:
1. canonical IR;
2. exact B-Rep;
3. tessellation;
4. drawing views;
5. optional point cloud;
6. natural-language descriptions at novice/intermediate/expert levels;
7. alternate valid plans;
8. failure variants;
9. repair traces;
10. validation evidence;
11. manufacturability labels;
12. performance/recompute metrics.

The valuable training unit is not “a STEP file.” It is a **verified engineering episode**.

## Reward design

Use execution-grounded rewards rather than aesthetic preference alone.

Candidate reward vector:
- schema validity;
- plan completeness;
- kernel execution success;
- B-Rep validity;
- constraint solvability;
- dimensional accuracy;
- topology stability under recompute;
- requested edit success;
- invariant preservation;
- assembly DOF correctness;
- collision-free required motion;
- export round-trip fidelity;
- DFM compliance;
- solver setup validity;
- solver convergence where applicable;
- operation compactness;
- latency/resource cost.

A sample can be rejected even if it renders beautifully.

## Retrieval and SearXNG

Use SearXNG as an **optional localhost search sidecar**, never as part of the geometry kernel. SearXNG is Python/AGPL software and exposes an HTTP search API. The clean architecture is:

`Archie -> SearchBroker (C++) -> localhost HTTP -> SearXNG -> web engines`

Rules:
- disabled by default for strictly offline sessions;
- bind to loopback only;
- sanitize queries and results;
- store source URL/title/timestamp in provenance;
- retrieve standards/vendor/public technical docs only when the user permits web access;
- never let retrieved text become a geometry command without passing through the same typed IR and validation process;
- comply with SearXNG’s AGPL obligations if distributed.

For local project/document search, use a separate local index. Do not send private CAD names or proprietary dimensions to web search unless explicitly allowed.

## Training safety on 36 GB

- Training is not allowed to compete with a live high-memory Forge solve.
- Start every experiment with 20–100 step canary.
- Fixed/bucketed sequence shapes where possible.
- Gradient checkpointing when supported.
- Batch size starts at 1.
- Monitor active/peak Metal memory and macOS memory pressure.
- Save adapters/checkpoints frequently and atomically.
- Abort on yellow/orange memory-pressure states before swap thrashing.
- Never launch two full-model fine-tunes concurrently.
- Keep long training in a dedicated worker process supervised by Forge Guardian or a training supervisor.
- Pin exact MLX/MLX-LM/model versions per experiment.
- Promote an adapter only after full regression evaluation.

## Model release rule

A newer/bigger model is not automatically better. A checkpoint becomes `archie-release` only if it improves the weighted engineering benchmark without regressing:
- deterministic tool calling;
- schema validity;
- edit preservation;
- recovery;
- latency/memory envelope;
- safety;
- licensing.
