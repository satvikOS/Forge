# Archie Typed Engineering IR and Feature Graph

## Purpose

This is the most important interface in ArchDisc.

Archie must never have permission to arbitrarily mutate kernel objects. It proposes a **typed engineering program**. Forge compiles, validates and executes it.

The IR must be:
- versioned;
- deterministic;
- unit-safe;
- reference-safe;
- serializable;
- diffable;
- replayable;
- testable;
- forward-migratable.

## Core document family

### 1. IntentGraph

Captures what the user means before geometry exists.

Fields:
- objective;
- deliverable types;
- units;
- requirements;
- constraints;
- non-goals;
- inputs;
- assumptions;
- open questions;
- success criteria;
- manufacturing context;
- load/environment context;
- preferred standards;
- confidence and provenance.

### 2. EngineeringInventory

A complete inventory of what Archie believes must exist.

Example conceptual structure:

```json
{
  "project_id": "P-...",
  "intent_revision": 12,
  "systems": [
    {
      "id": "SYS-POWERTRAIN",
      "purpose": "Convert combustion torque to shaft output",
      "subsystems": ["SUB-CRANK", "SUB-CYLINDER_BANK_A", "SUB-CYLINDER_BANK_B"]
    }
  ],
  "parts": [
    {
      "id": "PART-CRANKCASE",
      "quantity": 1,
      "material": {"state": "PROPOSED", "value": "Al alloy"},
      "manufacturing_process": {"state": "PROPOSED", "value": "machined casting"},
      "features_required": ["mounting interfaces", "bearing bores", "oil galleries"]
    }
  ],
  "unresolved": [
    {
      "id": "U-17",
      "question": "Required shaft center distance?",
      "blocking": true
    }
  ]
}
```

No missing detail is silently filled with false certainty. Values are `USER`, `SOURCE`, `DERIVED`, `PROPOSED`, or `UNRESOLVED`.

### 3. SketchIR

Each sketch contains:
- plane/reference;
- entities;
- construction entities;
- geometric constraints;
- dimensional constraints;
- expressions;
- solver status;
- degrees of freedom;
- source correspondence for drawing-derived geometry.

### 4. FeatureIR

Example:

```json
{
  "id": "F-0037",
  "type": "Extrude",
  "name": "Crankcase_Main_Body",
  "inputs": {
    "profile": "SK-0012:REGION-1",
    "direction": {"type": "normal"},
    "extent": {"type": "symmetric", "distance": {"value": 86.0, "unit": "mm"}}
  },
  "dependencies": ["DATUM-XY", "SK-0012"],
  "preconditions": [
    "profile.closed == true",
    "profile.self_intersection == false"
  ],
  "postconditions": [
    "result.solid_count == 1",
    "result.valid_brep == true"
  ],
  "semantic_outputs": {
    "mounting_face_front": {"selector": "..."},
    "mounting_face_rear": {"selector": "..."}
  }
}
```

### 5. AssemblyIR

Stores:
- components and quantities;
- instances;
- parent/child relationships;
- transforms;
- joints/mates;
- limits;
- contact;
- required clearances;
- degrees of freedom;
- configurations;
- exploded states;
- motion studies.

### 6. AnalysisIR

Stores:
- analysis type;
- geometry scope;
- material models;
- mesh policy;
- element family;
- contacts;
- loads;
- BCs;
- initial conditions;
- solver controls;
- convergence requirements;
- monitors;
- result requests;
- assumptions.

Archie can generate `AnalysisIR`, but it cannot manufacture a solver result.

### 7. ManufacturingIR

Stores:
- manufacturing process;
- setup;
- stock;
- datums;
- machine envelope;
- tool/holder;
- operations;
- strategy parameters;
- tolerances;
- inspection operations;
- DFM constraints.

### 8. DocumentationIR

Stores:
- views;
- sections/details;
- dimensions;
- annotations;
- GD&T;
- BOM;
- notes;
- revision;
- report sections;
- linked result IDs.

## Semantic references

Bad:
`face_128`

Better:
`feature=F-0037 / role=front_mounting_face / geometric_signature=...`

A semantic reference contains:
- originating feature;
- role;
- geometry class;
- signature;
- adjacency context;
- expected orientation/location;
- tolerance;
- confidence.

Forge resolves the semantic reference at execution time and records whether the identity is:
- exact;
- high-confidence matched;
- ambiguous;
- missing.

Ambiguous references are not silently guessed for destructive edits.

## Plan granularity

A user request such as “make me a quad-turbo W16 engine” should not become a 5,000-operation flat list.

Plan hierarchy:
- project goal;
- system architecture;
- subsystem plans;
- part inventories;
- per-part feature plans;
- assembly constraints;
- routed systems;
- motion plan;
- validation plan;
- documentation/analysis/manufacturing plan.

This allows lazy execution and parallelization without losing global consistency.

## Feature plan lifecycle

`PROPOSED -> SCHEMA_VALID -> REFERENCES_RESOLVED -> DRY_RUN_VALID -> EXECUTED -> GEOMETRY_VALID -> SEMANTICS_VALID -> COMMITTED`

Failure:
`FAILED -> DIAGNOSED -> REPAIR_PROPOSED -> REPAIR_DRY_RUN -> REPAIRED`

Every transition stores evidence.

## Repair protocol

When a kernel operation fails, Archie receives a structured failure, for example:

```json
{
  "operation_id": "F-0092",
  "failure_class": "FILLET_RADIUS_EXCEEDS_LOCAL_GEOMETRY",
  "entities": ["EDGE-SEM-27", "EDGE-SEM-28"],
  "requested_radius_mm": 8.0,
  "estimated_safe_upper_bound_mm": 4.7,
  "kernel_diagnostics": ["..."],
  "upstream_changed_since_plan": false
}
```

Archie must:
1. classify whether the intent or implementation is wrong;
2. preserve user-required constraints;
3. propose the smallest repair;
4. state any design consequence;
5. dry-run;
6. validate;
7. commit only if the result satisfies the original success criteria.

## Existing-CAD semantic editing

### Native Forge project

Full history is available. Edit the original feature graph.

### STEP/B-Rep import

Treat imported geometry as exact shape truth but **history-poor** unless the format contains usable product structure/metadata.

Forge may create:
- recognized holes;
- pockets;
- fillets;
- bosses;
- patterns;
- datum candidates;
- machining features.

This becomes an **inferred semantic layer** over the imported body. Do not claim it is the original authoring history.

### Mesh import

A mesh is reference geometry unless reconstructed. Any conversion into B-Rep/parametric form is a reconstruction with measured error.

## Invariant system

A semantic edit can define invariants:

```json
{
  "request": "increase wall thickness to 4 mm",
  "target": "PART-HOUSING",
  "invariants": [
    "mounting_hole_centers unchanged within 0.01 mm",
    "overall external envelope unchanged",
    "connector mating face unchanged",
    "mass may increase"
  ]
}
```

The validator compares pre/post states and rejects unintended changes.

## Inventory-first generation

For complex systems, Archie should create the inventory before geometry:
- every system;
- part/subassembly;
- purpose;
- quantity;
- interfaces;
- required features;
- dependencies;
- manufacturing process;
- material assumptions;
- load cases;
- documentation obligations.

Then Forge can show the user a live “construction contract” while geometry is progressively compiled.

## Deterministic agent API

The agent interface should expose typed functions such as:
- `CreateSketch`
- `AddConstraint`
- `CreateExtrude`
- `CreateRevolve`
- `CreateHole`
- `CreatePattern`
- `CreateLoft`
- `CreateFillet`
- `CreateAssemblyInstance`
- `CreateJoint`
- `SetParameter`
- `SuppressFeature`
- `ReplaceReference`
- `RunInterferenceCheck`
- `RunDFMCheck`
- `CreateAnalysis`
- `RunAnalysis`
- `CreateCAMSetup`
- `GenerateToolpath`
- `ExportArtifact`

Each function returns structured success/failure and immutable evidence IDs.

The agent is never rewarded for “trying many random operations until one looks okay.” Recovery should be causal and minimal.
