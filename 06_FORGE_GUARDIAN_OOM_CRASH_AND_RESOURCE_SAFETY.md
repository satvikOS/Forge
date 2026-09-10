# Forge Guardian — OOM, Crash, Hang and Resource Safety

## Objective

The M4 Max has unified memory. The renderer, LLM, geometry kernel, CAE solver, OS and display compositor can compete for the same physical memory. A design that merely says “36 GB is enough” will eventually fail under a large model, long context, dense assembly, tessellation and solver workload.

Forge Guardian is therefore a **first-class subsystem**, not an afterthought.

It cannot guarantee that hardware/software will never crash. It can make failure **predictable, contained, recoverable and rare**, and prevent known overload patterns before they become system-wide failures.

## Process architecture

Do not run every heavy subsystem in one process.

Recommended local process layout:

- `ForgeUI` — shell, commands, lightweight project state.
- `ForgeKernelWorker` — B-Rep and feature recompute.
- `ArchieInferenceWorker` — llama.cpp/Metal model inference.
- `ForgeMeshWorker` — tessellation/volume meshing.
- `ForgeSolverWorker[n]` — CAE solves.
- `ForgeCAMWorker` — toolpath/simulation.
- `SearXNG` — optional localhost sidecar.
- `ForgeSupervisor` — watchdog/resource governor.

A worker crash must not take the project UI down.

## Admission control

Every heavy job declares a resource envelope before it starts:

```text
JobEnvelope
  expected_resident_bytes
  expected_peak_bytes
  gpu_bytes_estimate
  temp_disk_bytes
  cpu_threads_max
  io_intensity
  can_pause
  can_checkpoint
  priority
  deadline
  mutually_exclusive_tags
```

Forge Guardian grants a reservation or queues the job.

No subsystem may spawn unbounded worker threads or allocate a “best effort” multi-gigabyte buffer outside this contract.

## Memory-pressure state machine

Use **macOS memory pressure as the primary truth**, with process RSS/footprint, allocation telemetry and swap/compression trends as secondary evidence.

### GREEN
- normal pressure;
- allocation forecast inside budget;
- disk healthy;
- no watchdog lag.

Action: normal concurrency.

### YELLOW
Trigger examples:
- memory pressure warning;
- predicted peak close to configured app envelope;
- accelerating compression/swap;
- GPU/Metal allocation growth;
- free disk approaching reserve.

Actions:
- stop spawning speculative jobs;
- reduce new LLM context budget;
- stop background high-resolution tessellation;
- trim inactive render caches;
- evict unused adapters/VLM;
- lower build parallelism;
- checkpoint active long jobs.

### ORANGE
Trigger examples:
- sustained pressure;
- allocation reservation cannot be honored;
- UI latency rising due to memory contention;
- solver/mesher exceeds envelope;
- disk pressure threatens checkpoints.

Actions:
- cancel speculative subagents;
- suspend low-priority solvers;
- unload optional vision model;
- collapse assembly representations to lightweight levels;
- flush derived caches;
- stop new compilation;
- force checkpoint;
- ask the inference worker to compact context at a safe boundary.

### RED
Trigger examples:
- critical OS memory pressure;
- severe swap thrash;
- worker heartbeat failure under high pressure;
- allocation failure.

Actions:
- do not allocate emergency “recovery” buffers;
- atomically save project journal;
- cancel all nonessential workers;
- terminate the highest-cost recoverable worker if necessary;
- keep UI/supervisor alive;
- restart worker only after pressure returns below threshold;
- restore from last checkpoint.

## Initial budget policy for 36 GB

Do not hard-code “use 35 GB.” Start conservatively and tune from telemetry.

A sensible engineering rule is to keep a substantial system reserve and let Forge Guardian derive the app budget dynamically. The exact byte limits belong in a profile file, not in source constants.

Example profile concepts:
- reserve a large OS/compositor safety margin;
- only one full-size planner model resident;
- VLM is on-demand;
- high-fidelity CFD and full-size LLM inference are mutually exclusive if their combined reservation is unsafe;
- large-assembly exact-BRep loading competes with solver reservations;
- never run two full-model fine-tunes concurrently;
- cap compiler parallelism by both CPU and available memory.

## Predictive allocation

Before jobs start, estimate memory from:
- model weight file size/quantization;
- KV-cache dimensions/context;
- number of active sequences;
- B-Rep entity count;
- tessellation triangle estimate;
- solver DOF count;
- sparse matrix nonzero estimate;
- mesh element estimate;
- result timestep count;
- build target/debug symbol estimate.

After each run, compare estimate with actual peak and update the estimator.

## Metal/GPU safety

Unified memory means a giant GPU allocation is still a giant system allocation.

Rules:
- bounded command-buffer size;
- bounded in-flight frame resources;
- chunk large uploads;
- use staging/streaming rather than duplicate full models;
- release temporary compute buffers immediately after fences;
- do not hold both high-resolution and multiple redundant LOD copies unless budgeted;
- inference and renderer share a GPU-time scheduler;
- solver visualization cannot monopolize the render queue;
- every long GPU compute task is cancellable or chunked at natural boundaries.

## UI responsiveness

Never run on the UI thread:
- LLM inference;
- B-Rep boolean/recompute;
- STEP import of large models;
- tessellation;
- volume meshing;
- FEA/CFD;
- CAM path generation;
- export round-trip verification;
- Git/build jobs.

UI receives immutable progress snapshots and can cancel/pause where supported.

## Checkpointing and journaling

### Project mutations

Use write-ahead transaction journal:
1. serialize intent/IR delta;
2. fsync journal;
3. execute worker mutation;
4. validate;
5. atomically commit project state;
6. mark journal record committed.

On restart, uncommitted operations are rolled back or replayed only after validation.

### Long jobs

Checkpoint:
- solver iteration/time step;
- training adapter state;
- benchmark progress;
- synthetic dataset shard;
- long import/reconstruction phase where possible.

Never create one giant “final file at the end” job for hours of work.

## Worker watchdog

Each worker emits heartbeat:
- state;
- current job;
- last progress timestamp;
- RSS/footprint;
- allocated GPU bytes if observable;
- queue depth;
- current safe-cancel point.

If heartbeat stops:
1. ping;
2. request stack/diagnostic dump if safe;
3. cooperative cancel;
4. graceful terminate;
5. hard kill only last;
6. record crash bundle;
7. restart clean worker;
8. replay from checkpoint.

## Crash-loop breaker

If the same job crashes a worker repeatedly:
- do not automatically retry forever;
- quarantine input/job signature;
- attach crash artifacts;
- downgrade fidelity/resource level if a safe strategy exists;
- otherwise mark `BLOCKED_NEEDS_DIAGNOSIS`.

## Build-system safety

Claude Code can destabilize the machine by launching several C++ builds in parallel.

Rules:
- Ninja/CMake job count is controlled centrally;
- no simultaneous full debug + release + sanitizer + LTO builds;
- per-worktree build directories;
- cache build objects responsibly;
- clean only known-derived directories;
- monitor free disk before each build;
- do not generate huge compile databases repeatedly;
- serialize linker-heavy stages when memory pressure is non-green.

## Worktree and artifact hygiene

A cleanup daemon may delete only items proven to be:
- derived;
- no longer referenced;
- older than policy threshold;
- not open by a current job;
- not a checkpoint;
- not user source/data.

Examples:
- orphan build directories;
- abandoned worktrees already merged/closed;
- stale benchmark scratch output;
- processed temporary conversions;
- old caches outside protected release sets.

Deletion has a dry-run report and audit log.

## Dataset/training safety

Large datasets should be shard-streamed:
- never unpack the whole corpus if not required;
- content-addressed cache;
- bounded prefetch;
- fixed maximum number of decoded samples;
- clean processed intermediates only after checksum/manifest confirms final shard;
- checkpoint training frequently;
- keep base model immutable;
- adapter writes are atomic.

## Fault injection tests

Guardian is not complete until tested under deliberate failure:
- memory reservation denied;
- worker allocation failure;
- worker crash mid-transaction;
- solver hang;
- corrupted checkpoint;
- disk-full simulation;
- network/SearXNG timeout;
- malformed STEP;
- kernel exception;
- GPU task timeout/cancel;
- child process does not exit;
- concurrent-agent merge conflict.

Expected result: UI and project state remain recoverable.

## Soak gate

Before calling Forge “stable,” run 8–24 hour local soak scenarios combining:
- repeated open/edit/save/export;
- large-assembly camera navigation;
- inference requests;
- progressive tessellation;
- background DFM;
- periodic CAE previews;
- worktree/build activity.

Acceptance is not “didn’t crash once.” Track:
- peak memory;
- pressure-state transitions;
- cache growth;
- file descriptors;
- thread count;
- GPU allocations;
- latency;
- worker restarts;
- leaked temp files;
- journal recovery.

Trends must be bounded over time.
