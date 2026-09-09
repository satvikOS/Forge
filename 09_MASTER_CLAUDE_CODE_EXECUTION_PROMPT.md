# Master Claude Code Execution Prompt — ArchDisc / Archie / Forge

Use this as the high-authority implementation directive. It is intentionally strict.

---

You are implementing **ArchDisc Forge**, a local-native C++ engineering workbench, and **Archie**, its local engineering reasoning model.

Your objective is not to create a demo that looks like CAD. Your objective is to build the foundations of a production engineering system in which natural-language, drawing, imported-CAD and engineering intent compile into deterministic, editable, validated CAD/CAE/CAM state.

## PRODUCT NORTH STAR

Archie is the engineering compiler front-end.
Forge is the deterministic engineering runtime.

The canonical pipeline is:

`USER INTENT / DRAWING / IMPORT / PROJECT STATE`
`-> IntentGraph`
`-> EngineeringInventory`
`-> hierarchical Feature/Assembly/Analysis/Manufacturing plans`
`-> versioned typed Forge IR`
`-> dry-run`
`-> native C++ execution`
`-> independent validation`
`-> commit`
`-> recompute / render / CAE / CAM / documentation`
`-> evidence`

Never replace this architecture with:
- mesh-only generation;
- screen-coordinate CAD automation;
- Python scripts as the authoritative product model;
- a chat answer that is not tied to executable state;
- fake simulation;
- unverified exports.

## HARD LANGUAGE AND PRODUCT CONSTRAINTS

1. Forge product implementation is C++20/23-first.
2. Do not introduce JavaScript/TypeScript/Node/Electron/WebView application architecture.
3. Do not add Python to the shipping Forge core.
4. Python/MLX may exist only in a separate model-training/research repository/environment and must not become a runtime dependency of Forge.
5. SearXNG, when enabled, is an optional localhost sidecar reached through a typed C++ SearchBroker. It is not linked into the geometry kernel.
6. All heavy compute is local. Web search is a retrieval tool only.
7. The authoritative geometry is parametric/B-Rep when the design task is CAD.
8. A mesh is never silently treated as equivalent to editable B-Rep/history.
9. Every third-party dependency needs an SPDX/license record before merge.

## SAFETY IS A RELEASE BLOCKER

Before expanding features, implement or verify Forge Guardian.

You MUST NOT:
- launch unbounded builds;
- launch multiple full-model inference workers;
- launch simultaneous high-memory jobs without reservations;
- use one build directory from multiple worktrees;
- duplicate multi-GB model/geometry state unnecessarily;
- ignore macOS memory-pressure signals;
- continue spawning subagents when pressure is unsafe;
- perform a destructive file cleanup without a classified ownership/derivation proof.

Implement:
- supervisor process;
- worker heartbeats;
- job resource envelopes;
- admission controller;
- GREEN/YELLOW/ORANGE/RED memory-pressure state machine;
- process isolation;
- cooperative cancellation;
- checkpointing;
- transaction journal;
- crash-loop breaker;
- disk reserve;
- build concurrency governor;
- cache eviction policy;
- fault injection.

If Guardian says ORANGE or RED, new speculative work stops. Checkpoint and shed load before continuing.

## START-OF-SESSION PROCEDURE

Before editing:

1. Print repository root, branch, worktree and concise git status.
2. Read root instructions.
3. Identify the subsystem requested.
4. Read only its architecture/contract documents.
5. Establish known-good baseline.
6. List exact acceptance tests.
7. Produce a task DAG.
8. Produce write sets.
9. Detect write-set overlap.
10. Estimate resource class for each task.
11. Ask Guardian/admission policy whether parallel execution is safe.
12. Create isolated worktrees only for genuinely independent mutations.

If any of these is unknown, investigate before mutation.

## SUBAGENT RULES

The orchestrator owns the task graph and never allows uncontrolled fan-out.

Each mutating subagent requires:
- task ID;
- objective;
- dependencies;
- worktree;
- branch;
- exact write set;
- forbidden write set;
- acceptance tests;
- resource envelope;
- stop conditions.

Use one worktree per mutating subagent.

Never assign overlapping write sets concurrently.

If a subagent discovers it must edit a file outside its write set, it stops and requests plan revision.

Use logical subagents over a shared inference service; do not load another huge model per subagent.

Use read-only Scout/Validator agents aggressively because they can parallelize without merge risk.

Only the Integrator merges into the target branch.

## IMPLEMENTATION DISCIPLINE

For each task:

`INSPECT -> HYPOTHESIS -> SMALLEST COHERENT PATCH -> NARROW BUILD -> NARROW TEST -> DIFF REVIEW -> BROAD TEST -> INDEPENDENT VALIDATION -> BENCHMARK -> COMMIT`

Do not:
- rewrite unrelated code;
- perform cosmetic refactors in a feature patch;
- disable tests;
- weaken invariants to obtain green;
- hide warnings;
- call a command-exit code proof of correctness.

When a task fails three times with materially the same hypothesis, STOP. Gather new evidence or replan.

## FORGE ENGINEERING IR

Implement a versioned schema family:
- IntentGraph;
- EngineeringInventory;
- ObservationIR;
- SketchIR;
- FeatureIR;
- PartGraph;
- AssemblyIR;
- AnalysisIR;
- ManufacturingIR;
- DocumentationIR;
- RepairPlan.

Each mutation carries:
- operation ID;
- type;
- parameters with units;
- upstream semantic references;
- preconditions;
- postconditions;
- invariants;
- provenance;
- expected resource cost;
- validation policy.

Use constrained/validated structured decoding at the model boundary.

No untyped string command should be able to directly alter the kernel.

## GEOMETRY EXECUTION

Wrap the geometry kernel behind Forge-owned interfaces.

Required transaction:

`prepare -> resolve semantic refs -> dry run -> execute -> B-Rep validate -> semantic validate -> dependency validate -> persistent-name remap -> commit`

On failure:
- no partial commit;
- return structured error;
- Archie forms minimal RepairPlan;
- dry-run repair;
- revalidate.

Implement stable semantic references. Never persist raw face/edge indexes as authoritative references.

## FEATURE SYSTEM PRIORITY

Implement in dependency order:

1. units/parameters/expressions;
2. datum reference system;
3. 2D sketch entities;
4. geometric/dimensional constraint solving;
5. extrude/cut/revolve;
6. hole;
7. fillet/chamfer;
8. shell/draft;
9. sweep/loft;
10. patterns/mirror;
11. multi-body/boolean;
12. surface operations;
13. persistent naming/recompute;
14. configurations/suppression.

Do not implement an impressive loft before basic dependency/recompute semantics are trustworthy.

## EXISTING CAD EDITING

Treat editing as an independent core benchmark.

Native Forge file:
- edit actual history.

STEP/B-Rep:
- preserve imported precise shape;
- build inferred semantic feature layer;
- identify confidence;
- never pretend inferred history is original authoring history.

Mesh:
- reference/reconstruction input;
- report reconstruction error.

Every edit has explicit preserved invariants and a before/after delta report.

## ASSEMBLIES

Assembly state includes:
- component definitions;
- instances;
- hierarchy;
- transforms;
- joints/mates;
- limits;
- contact;
- interference;
- configurations;
- exploded states;
- BOM identity;
- motion studies.

Mechanism animation comes from joint constraints.
Run swept collision/interference where requested.

## LARGE ASSEMBLY

Never load every exact representation if the task does not require it.

Support:
- metadata-only;
- proxy;
- lightweight tessellation;
- exact B-Rep.

Implement:
- hierarchical BVH;
- GPU instancing;
- frustum/occlusion culling;
- screen-space LOD;
- branch unload;
- background tessellation;
- exact-on-selection;
- cache budgeting.

Record peak memory and p95/p99 selection/frame latency.

## CAE

Keep AI setup separate from numerical truth.

Build:
- AnalysisIR;
- materials;
- BC/load/contact;
- mesh policy;
- convergence policy;
- results/probes.

Start with validated local structural/thermal cases before adding everything.

Use fidelity tiers:
- interactive reduced/coarse;
- preview;
- high fidelity.

Never claim high-fidelity transient CFD is “real-time” simply because the UI animates.

Treat FMEA as a linked risk-analysis graph, not a FEM solver.

## DFM

Each DFM finding must return:
- target semantic ID;
- process;
- rule;
- measured value;
- limit/rationale;
- severity;
- exact recommendation;
- impact;
- repair-plan candidate.

Required process families eventually:
- CNC;
- additive;
- injection molding;
- sheet metal.

## CAM

CAM state is derived from authoritative geometry but separately versioned:
- stock;
- WCS/setup;
- machine;
- tools/holders;
- operation list;
- toolpaths;
- simulation;
- postprocessor.

Machine-code export is gated by collision and path verification.

## DOCUMENTATION

One project graph generates:
- drawings;
- BOM;
- GD&T;
- exploded views;
- DFM;
- CAE report;
- FMEA;
- CAM setup;
- inspection plan;
- provenance/change report.

No duplicated manual document model that drifts from CAD state.

## ARCHIE MODEL

Architect runtime so the base model is replaceable.

Initial candidate: strong permissively licensed local reasoning model such as gpt-oss-20b.

Production inference:
- C++/llama.cpp/Metal;
- one major resident model;
- dynamically budgeted context;
- structured outputs;
- adapter routing at safe boundaries.

Training:
- separate repo;
- LoRA/QLoRA with pinned environment;
- canary runs;
- checkpoint frequently;
- synthetic Forge-verified curriculum;
- never use a dataset commercially until its license/provenance has been approved.

Do not use MMCAD or Fusion 360 Gallery as unrestricted commercial training data. Their current releases include non-commercial restrictions.

## PROPRIETARY SYNTHETIC DATA LOOP

Forge should become its own data factory.

Generate:
- valid feature programs;
- variants;
- drawings;
- point clouds/renders;
- semantic descriptions;
- edit instructions;
- failures;
- repairs;
- assemblies;
- DFM conditions;
- CAE setups.

Store execution evidence.

Train Archie on **engineering episodes**, not isolated pretty models.

## SEARCH

SearXNG is a retrieval tool.

SearchBroker:
- localhost only by default;
- JSON API;
- bounded result count;
- source provenance;
- private design data redaction;
- user/network policy check;
- retrieval cannot bypass IR validation.

## ACCEPTANCE EVIDENCE

Every feature completion report must contain:
- files changed;
- commit;
- tests;
- validation evidence;
- before/after benchmark if performance-sensitive;
- peak memory;
- known limitations;
- no unexpected writes;
- cleanup completed.

For geometry:
- valid B-Rep;
- replay/recompute;
- semantic reference stability;
- export round-trip where relevant.

For UI:
- state-level tests plus visual check.

For CAE:
- convergence/reference evidence.

For CAM:
- collision/stock-removal evidence.

## CLEANUP

At the end of an integrated task:
- delete dead merged worktrees;
- delete stale per-worktree build directories;
- remove generated scratch files that are proven disposable;
- retain test evidence, crash bundles and required checkpoints;
- never delete source, user data, model weights or unclassified datasets.

Cleanup itself must be auditable.

## STOP CONDITIONS

Immediately stop mutation if:
- repository identity is unclear;
- baseline is broken for unknown reason;
- memory pressure becomes ORANGE/RED;
- disk reserve is violated;
- task needs unplanned shared-interface mutation;
- kernel invariant is broken;
- new dependency license is unknown;
- repeated attempts are not generating new evidence;
- a worker crash indicates project-state corruption risk.

Checkpoint. Report exact blocker. Replan.

## DEFINITION OF DONE

“Done” means the system can prove the requirement.

A feature is not done because:
- it compiles;
- a screenshot looks good;
- the AI says it worked;
- one hand-picked model succeeds.

It is done when:
- acceptance tests pass;
- independent validator passes;
- resource envelope passes;
- no project corruption occurs;
- regression suite passes;
- benchmark evidence is recorded;
- documentation/IR contract is updated;
- worktree is safely integrated and cleaned.

---

Begin by reading `00_README_EXECUTION_ORDER.md`, then inspect the current repository and produce an implementation DAG. Do not make code changes until you have established the known-good baseline, write-set boundaries, resource plan and first acceptance gates.
