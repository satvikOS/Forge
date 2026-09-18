# Archie 30B Training and Ground-Truth Program

**Date:** 2026-09-17  
**Status:** Proposed replacement for 14B-era assumptions where they conflict with the current Archie target

## 1. Mission

Archie is a local 30B-class engineering reasoning model that must understand natural user intent, convert it into deterministic Forge engineering state, and iteratively repair its own outputs against geometry and engineering truth.

The target is not a model that merely knows CAD vocabulary.

The target is a model that reliably performs:

`user language -> requirements -> design decomposition -> typed Forge IR -> execution -> validation -> repair`

The training program is therefore organized around semantic grounding and executable engineering outcomes rather than raw token volume alone.

---

## 2. Canonical training contract

Every high-value training record should contain as many of these fields as applicable:

- original natural-language request
- conversational context
- drawings/images/technical references
- current project state
- extracted requirements
- assumptions
- engineering constraints
- design decomposition
- typed Forge IR
- expected feature graph
- expected dimensions and units
- expected topology
- expected B-Rep or reference geometry
- Forge execution result
- independent validator output
- error vector
- diagnosis
- corrected IR
- final verified result

The model must learn both success and recovery.

---

## 3. Data mixture

### 3.1 Natural-language engineering intent

This is mandatory and must not be overwhelmed by templated synthetic engineering questions.

Include:

- vague prompts
- incomplete prompts
- everyday language
- expert CAD language
- manufacturing language
- workshop language
- colloquial descriptions
- follow-up changes
- pronouns and references to previous operations
- contradictory requirements
- requests containing no formal CAD vocabulary
- requests containing exact standards terminology

Examples of the behavior distribution:

- "make this bracket less chunky but keep the holes where they are"
- "give me enough room for a socket around the bolt"
- "turn this into something I can machine in one setup"
- "same thing but mirror the mounting side"
- "I need a plate that won't bend under this load"

The model should map these into explicit engineering state rather than echoing the language.

### 3.2 Parametric CAD sequences

Use real and high-quality programmatic CAD corpora containing:

- construction history
- sketch constraints
- feature order
- dimensions
- B-Rep / topology
- edits
- assemblies where available

Deduplicate aggressively by geometry and operation sequence.

### 3.3 Sketch and constraint reasoning

Train exact mapping between language and:

- points
- lines
- arcs
- circles
- splines
- dimensions
- coincident constraints
- parallel/perpendicular
- tangency
- concentricity
- symmetry
- equality
- fixed geometry
- under/over-constrained states
- solver conflict diagnosis

### 3.4 Editing and surgical modification

Generation alone is insufficient.

Train:

- select semantic feature
- change one parameter
- preserve unrelated geometry
- modify sketch constraints
- suppress/restore features
- move holes
- change fillet/chamfer
- re-order features when required
- repair broken references
- preserve assembly intent

### 3.5 Engineering verification

Train against:

- dimensional constraints
- tolerance checks
- material constraints
- manufacturability
- clearance
- interference
- structural/thermal/fluid constraints where verified
- drawing/GD&T semantics

### 3.6 Failure and repair corpus

This is a first-class corpus, not an afterthought.

Generate and retain examples of:

- invalid B-Rep
- wrong dimensions
- wrong feature order
- wrong selected face/edge
- missing constraint
- over-constrained sketch
- topology mismatch
- valid but semantically wrong shape
- unnecessary extra features
- manufacturability violations
- invalid simulation setup
- hallucinated references

For each failure retain:

`failed IR -> exact validator evidence -> diagnosis -> corrected IR -> verified outcome`

---

## 4. Evaluation before training

Every training campaign begins by freezing a held-out evaluation set.

The set must contain:

- simple primitives
- multi-feature parts
- heavily constrained sketches
- edits
- assemblies
- drawings
- ambiguous natural-language prompts
- colloquial prompts
- professional engineering prompts
- adversarial references
- topology-sensitive features
- manufacturability-sensitive designs

No generated training sample may leak from the held-out set.

---

## 5. Forge as the reward environment

The model is judged by execution, not prose quality.

For each candidate generation, Forge should produce a reward vector including:

- `ir_schema_valid`
- `tool_reference_valid`
- `transaction_success`
- `rebuild_success`
- `brep_valid`
- `dimension_score`
- `constraint_score`
- `volume_score`
- `area_score`
- `bbox_score`
- `centroid_score`
- `topology_score`
- `surface_type_score`
- `feature_sequence_score`
- `semantic_reference_score`
- `edit_preservation_score`
- `manufacturability_score`
- `render_similarity_score`
- `repair_steps`

Use independent closed-form or benchmark truth where possible. OCCT may be used as a reference engine where appropriate but is not automatically ground truth.

---

## 6. Training stages

### Stage A — General instruction and intent retention

Goal: preserve strong natural-language comprehension.

Do not destroy general conversational competence through over-specialization.

### Stage B — Engineering grounding

Train mapping from language to structured engineering requirements.

### Stage C — Forge IR supervision

Train exact typed executable representations.

### Stage D — Geometry-truth supervision

Train on execution results and ground-truth comparisons.

### Stage E — Preference / correction training

Prefer plans that are:

- correct
- minimal
- editable
- stable
- semantically referenced
- manufacturable
- deterministic

Reject plausible-looking but geometrically wrong outputs.

### Stage F — Environment-grounded reinforcement / iterative optimization

Use Forge itself as an execution environment.

Reward correct geometry and correct edits.

Penalize:

- invalid shape
- hallucinated tool/reference
- unnecessary feature complexity
- silent semantic drift
- wrong topology
- wrong dimensions
- unnecessary retries

---

## 7. Adapter policy

Specialist adapters may be trained independently for experimentation, including:

- intent interpretation
- sketch reasoning
- feature planning
- assemblies
- drawing/GD&T
- manufacturing
- CAE reasoning
- visual verification
- repair

Do not ship an uncontrolled adapter zoo.

A specialist adapter survives only if it improves held-out metrics.

Where practical, consolidate successful specialization into the main Archie checkpoint or a deliberately small routed set, then benchmark the consolidated model again.

Storage cost is not a justification for preserving weak or duplicate adapters.

---

## 8. Vocabulary policy

Do not assume weak domain behavior means the tokenizer needs replacement.

First measure engineering-term token fragmentation across the real corpus.

A tokenizer change is justified only if measured fragmentation materially harms context efficiency or learning.

The priority is semantic grounding:

`word/phrase -> engineering meaning -> Forge operation -> geometry effect`

not merely storing a new token for the word.

---

## 9. Model-facing API policy

The Archie API should be semantic and hierarchical rather than an ever-growing flat list.

Example:

```json
{
  "op": "geometry.create_feature",
  "feature_type": "extrude",
  "inputs": {
    "profile": "sketch_14",
    "distance": {"value": 40.0, "unit": "mm"},
    "direction": "normal"
  }
}
```

Use schema-constrained generation for executable structures where possible.

The UI, Archie, macros, and automation should ultimately route to the same native command semantics.

---

## 10. Benchmark policy

Do not optimize only an aggregate score.

Track separately:

- generation validity
- editing validity
- interface correctness
- shape similarity
- topology
- exact dimensions
- constraint satisfaction
- semantic prompt understanding
- first-pass tool correctness
- repair success

A checkpoint is not accepted if it improves the mean by sacrificing a protected axis below its minimum.

---

## 11. Training experiment discipline

Every experiment records:

- base checkpoint
- tokenizer
- dataset hashes
- dataset mixture
- held-out set hash
- training hyperparameters
- adapter configuration
- quantization
- sequence lengths
- machine configuration
- wall time
- peak memory
- final metrics
- regression metrics
- artifact hashes

Do not merge a model artifact without reproducibility metadata.

---

## 12. Storage discipline

Training data must use a streaming lifecycle:

`download -> verify -> process -> deduplicate -> persist required normalized artifact -> delete redundant raw/cache material`

Delete only after proving the data is either reproducible or safely retained in the canonical data store.

Generated temporary weights, failed adapters, redundant caches, unpacked datasets, and abandoned checkpoints must be retired when no longer required for reproducibility.

---

## 13. Dual-Mac utilization

When two Mac Studios are temporarily available, prioritize them for:

- parallel corpus preprocessing
- synthetic failure generation
- Forge replay scoring
- evaluation
- adapter experiments
- distributed training only where measured to be efficient

Do not waste the second machine primarily on duplicate interactive coding sessions if it can continuously generate validated training/evaluation data.

---

## 14. Acceptance rule

Archie progress means:

> A previously failing natural engineering request now compiles into correct, editable, verifiable Forge state on a held-out task.

Anything else is supporting work, not the final metric.
