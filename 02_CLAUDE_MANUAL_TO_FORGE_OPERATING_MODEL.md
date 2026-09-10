# Claude Manual Analysis -> Forge Operating Model

## Source

Uploaded file: `Claude_Code_Deep_Operating_Manual_1000_Topic_Research_Edition.docx` (71 pages).

The manual describes itself as a 1,000-topic expansion of a 28-minute Claude Code talk. Its strongest ideas are operational rather than model-specific: orient before acting, plan before mutation, tool the agent, close the verification loop, engineer context, isolate concurrency, automate repeatability, enforce invariants mechanically, preserve traceability and optimize the harness rather than only the prompt.

## What should be inherited directly

### 1. Orient before mutation

For Forge development, “orientation” means the agent must establish:
- repository/worktree identity;
- exact target subsystem;
- current build status;
- dependency graph;
- tests that define current behavior;
- memory/disk pressure;
- files it intends to mutate;
- files explicitly out of scope.

No implementation agent may begin by broadly rewriting files because a request “sounds architectural.”

### 2. Plan before mutation

Every non-trivial task needs a machine-readable task plan:
- objective;
- prerequisites;
- dependency IDs;
- write set;
- read set;
- acceptance tests;
- estimated RAM/CPU/disk cost;
- rollback method;
- completion evidence.

The plan is not a prose ceremony. The scheduler uses it to decide whether the task may run concurrently.

### 3. Tool the agent

A Forge/Archie coding agent must have direct access to:
- CMake/Ninja build commands;
- compiler diagnostics;
- unit/integration tests;
- geometry-validation CLI;
- STEP round-trip checker;
- feature-graph validator;
- benchmark runner;
- sanitizer builds;
- leak/memory telemetry;
- crash logs;
- Git history/diff;
- local screenshots/render tests where UI behavior is involved.

### 4. Verification must be falsifiable

The manual repeatedly makes the correct distinction: self-consistency is not correctness.

For Forge, independent verification means:
- a geometry operation is accepted only if the kernel validator passes;
- a semantic edit is accepted only if target semantics and unaffected invariants are checked;
- a solver result is accepted only if convergence/quality/residual criteria pass;
- an export is accepted only after re-import and comparison;
- a UI operation is accepted only after state-level assertions, not only visual appearance;
- a performance change is accepted only with reproducible before/after measurements.

### 5. Concurrency needs isolation

The manual’s key concurrency rule maps directly to Claude Code: parallelism is useful only when write sets, dependencies and merge ownership are explicit.

For this project:
- one worktree per mutating subagent;
- one branch per worktree;
- no two agents own the same file at the same time;
- shared headers require a designated integration owner;
- only the integration agent merges;
- the same build directory is never shared between worktrees;
- expensive build/benchmark jobs require resource reservations.

### 6. Safety rules must be mechanical

“Do not OOM” in a prompt is not a safety control.

Translate it into:
- memory-pressure watcher;
- job admission controller;
- process memory ceilings;
- build parallelism governor;
- disk-space thresholds;
- cancellation tokens;
- worker watchdogs;
- crash-isolated processes;
- checkpointing;
- deny rules for destructive file operations;
- transactional repository cleanup.

### 7. Context must be tiered

Do **not** dump the whole 1,000-topic manual into the root `CLAUDE.md`.

Use:
- root policy: short, hard invariants only;
- subsystem `CLAUDE.md` or `AGENTS.md`: local contracts;
- task manifests: only current objective/evidence;
- skills: stable procedures;
- architecture docs: loaded on demand;
- benchmark specs: loaded only by evaluation agents.

This follows the manual’s own context-budgeting principle and prevents “instruction dilution.”

## Where the uploaded manual is weak for Forge

The manual is broad and intentionally repetitive. Many of its 1,000 atoms reuse the same pattern—definition, value, prerequisites, workflow, failure mode, diagnostic signal, mitigation, verification, scaling, advanced extension—under different topic labels.

That is useful as a taxonomy, but it is **not an executable engineering specification**. Forge needs concrete implementations:
- byte/pressure-level resource governors;
- explicit C++ module ownership;
- typed IR schemas;
- transaction semantics;
- geometry validity predicates;
- benchmark thresholds;
- solver-quality criteria;
- worktree locking;
- build limits;
- crash recovery state machines.

The correct move is therefore to **compile the philosophy into enforcement code**, not to add more prose.

## Forge-specific operating state machine

Every agentic engineering task follows:

`DISCOVER -> BASELINE -> PLAN -> RESERVE_RESOURCES -> ISOLATE -> IMPLEMENT_SMALL -> BUILD -> VERIFY_LOCAL -> VERIFY_INDEPENDENT -> BENCHMARK -> INTEGRATE -> CLEAN -> RECORD`

Failure transitions:
- requirement ambiguity -> `BLOCKED`;
- resource risk -> `QUEUED`;
- build/test failure -> `REPLAN`;
- geometry invariant failure -> `ROLLBACK`;
- memory pressure escalation -> `CHECKPOINT_AND_SHED`;
- worker hang/crash -> `RESTART_WORKER_FROM_CHECKPOINT`;
- repeated failure without new evidence -> `ESCALATE`.

## What must live in the root coding instructions

Only the hard invariants:
- no JavaScript introduced into Forge;
- C++-first native architecture;
- never mutate generated/vendor data as if it were source;
- never use one worktree from two agents;
- never delete without proving the artifact is derived/stale or explicitly owned by cleanup policy;
- no unverified geometry mutation;
- no unbounded parallel builds;
- no benchmark claim without stored evidence;
- no “done” unless acceptance tests pass;
- no UI thread blocking on inference, tessellation, meshing or solvers;
- no full-model duplication for convenience.

Everything else belongs in subsystem docs and skills.

## Manual-derived priority for ArchDisc

The uploaded manual’s most valuable lesson is that model capability is only one term in system performance. For Archie, that is decisive. The model should spend its intelligence on requirements decomposition, feature planning, repair and engineering tradeoffs. Forge should carry the burden of exact geometry, numerical calculation, state management, validation and repeatability.
