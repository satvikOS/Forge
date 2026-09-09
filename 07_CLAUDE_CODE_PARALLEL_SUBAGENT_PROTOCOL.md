# Claude Code Parallel Subagent Protocol

## Core principle

Parallelize **independent evidence-producing work**, not shared mutation.

The uploaded Claude operating manual correctly warns that concurrency without explicit write sets, dependencies and merge ownership converts latency savings into integration debt. Forge makes that rule mechanical.

## Roles

### Orchestrator
Owns:
- task graph;
- dependency resolution;
- resource reservations;
- subagent assignment;
- status;
- final integration decision.

Does not casually edit implementation files while mutating agents are active.

### Scout
Read-only. Maps subsystem, tests, API boundaries and risks.

### Implementer
Owns one bounded write set in its own worktree.

### Validator
Read-only against the implementer branch. Runs tests/benchmarks and tries to falsify the result.

### Integrator
Sole owner of merge/rebase into target branch.

### Resource Sentinel
Can halt spawning/builds regardless of task priority when Guardian reports unsafe pressure.

## Task manifest

Every mutating subagent receives:

```yaml
task_id: FG-123
objective: "Implement transactional extrusion operation"
depends_on: [FG-101]
worktree: ".worktrees/FG-123"
branch: "agent/FG-123"
write_set:
  - src/geometry/ExtrudeOperation.cpp
  - src/geometry/ExtrudeOperation.hpp
read_set:
  - src/geometry/Transaction.*
  - tests/geometry/*
forbidden_write_set:
  - src/document/*
acceptance:
  - "unit test extrude symmetric"
  - "invalid profile rolls back"
  - "BRep validator passes"
resource:
  peak_ram_gb_estimate: 4
  build_class: incremental
  max_threads: 4
stop_conditions:
  - "memory pressure >= ORANGE"
  - "unexpected required edit outside write_set"
  - "baseline tests fail before change"
```

## Before spawning an agent

The orchestrator must:
1. inspect repository status;
2. ensure current branch/worktree is understood;
3. run or locate a known-good baseline;
4. create dependency DAG;
5. compute write-set overlap;
6. estimate build/resource cost;
7. ask Guardian for reservation;
8. create isolated worktree;
9. write task manifest into worktree;
10. start agent.

## Concurrency matrix

Allowed:
- docs + isolated kernel unit implementation;
- read-only research + isolated UI work;
- independent tests in separate worktrees if build resources allow;
- benchmark analysis + no-write architecture review.

Not allowed:
- two agents modifying same header;
- two agents modifying CMake root files;
- two agents changing same public interface;
- multiple agents rebuilding same build directory;
- simultaneous full release/LTO builds;
- multiple full LLM model instances just because there are multiple logical subagents.

## Logical subagents vs model instances

A “subagent” is a separate reasoning context, not necessarily a separately loaded 20B model.

On 36 GB:
- one shared large-model inference service;
- requests scheduled/serialized or micro-batched carefully;
- lightweight reviewer/router models may coexist only if Guardian permits;
- each context has a token budget;
- stale context is summarized externally;
- no nested subagent fan-out without explicit orchestrator approval.

This avoids the classic failure where four “parallel agents” actually mean four copies of a multi-gigabyte model.

## Mutation discipline

An implementer follows:

`inspect -> state hypothesis -> make smallest coherent patch -> compile narrow target -> run target test -> inspect diff -> expand test -> commit`

Forbidden:
- giant formatting rewrites;
- opportunistic unrelated cleanup;
- deleting files because they “look unused” without dependency proof;
- disabling a failing test to achieve green;
- changing acceptance criteria after implementation;
- silently adding a new third-party dependency;
- editing generated/vendor code as source.

## Shared-interface protocol

If task B needs an API change owned by task A:
- B stops;
- B writes an interface request;
- orchestrator updates DAG;
- A or designated interface owner makes the change;
- B rebases after A integrates.

Do not let both agents “coordinate” by racing on the same header.

## Verification

Implementer evidence is necessary but not sufficient.

Validator checks:
- clean diff;
- requirement mapping;
- compiler warnings;
- unit/integration tests;
- sanitizer where relevant;
- geometry validator;
- resource regression;
- export round-trip where relevant;
- no forbidden files changed.

For geometry-heavy features, validator should generate adversarial edge cases, not merely repeat the happy-path sample.

## Merge

Integrator:
1. confirms task dependency versions;
2. fetches implementer commit;
3. runs conflict check;
4. merges/rebases in dependency order;
5. rebuilds affected integration target;
6. runs cross-subsystem tests;
7. records evidence;
8. deletes/archives worktree only after integration is confirmed.

## Automatic stop rules

Any agent stops immediately when:
- required write escapes its manifest;
- repository state is unexpectedly dirty;
- baseline is not reproducible;
- Guardian says ORANGE/RED;
- disk reserve violated;
- tool/kernel output contradicts assumption;
- three materially identical repair attempts fail;
- destructive operation lacks rollback;
- upstream interface changed.

Stopping is not failure. Continuing under invalid assumptions is failure.

## Context control

Each subagent receives only:
- root invariants;
- its task manifest;
- relevant subsystem architecture;
- exact code/test context;
- known dependency outputs.

Do not feed every agent the entire ArchDisc corpus.

At completion, agent returns:
- what changed;
- why;
- evidence;
- known limitations;
- resource measurements;
- commit hash;
- new invariant, if any.

## Cleanup policy

After merge:
- remove dead worktree;
- remove its isolated build dir if no longer useful;
- keep benchmark evidence and crash bundles according to retention policy;
- prune derived temp artifacts;
- never delete user datasets, model weights, source assets or checkpoints through generic cleanup.

## Parallel development phases for this program

Safe initial parallel tracks after Guardian and IR foundations exist:
- Track A: sketch solver/SketchIR.
- Track B: project serialization/event journal.
- Track C: Metal viewport/LOD.
- Track D: STEP import/export round-trip harness.
- Track E: benchmark harness.
- Track F: training-data compiler in separate training repo.

Do not parallelize feature-tree semantics and persistent naming as unrelated projects. They are tightly coupled and should have one architecture owner.
