# Benchmarks, Acceptance and Release Gates

## Principle

A CAD system is not “solved” because one impressive engine model appears on screen.

Every release must score across generation, editing, repair, assemblies, drawings, CAE setup, manufacturability, interoperability, performance and resilience.

## Benchmark families

### A. Structured generation

Levels:
- L0 primitive;
- L1 sketch+single feature;
- L2 multi-feature part;
- L3 advanced part;
- L4 freeform/surface-heavy;
- L5 multi-part system.

Metrics:
- IR schema validity;
- kernel build success;
- B-Rep validity;
- dimensional error;
- volume/area/bbox error;
- topology/geometric similarity;
- feature-tree compactness;
- parameter editability;
- recompute success.

### B. Drawing-to-CAD

Inputs:
- clean vector drawings;
- raster scans;
- noisy photos;
- incomplete views;
- toleranced/GD&T drawings.

Metrics:
- dimension extraction;
- cross-view correspondence;
- feature reconstruction;
- reprojection error;
- exact geometry error;
- uncertainty calibration.

### C. Semantic editing

Test requests modify:
- dimensions;
- holes;
- patterns;
- fillets;
- thickness;
- interfaces;
- local geometry;
- assembly parts.

Metrics:
- requested delta satisfied;
- invariant preservation;
- unintended geometry delta;
- topology-reference survival;
- number of operations;
- rollback/recovery success.

CADGenBench should remain one external reference because it explicitly evaluates both generation and editing through STEP/BREP outputs.

### D. Repair

Inject:
- invalid references;
- oversized fillets;
- overconstraints;
- degenerate booleans;
- self-intersections;
- import defects;
- impossible mates.

Metrics:
- diagnosis class accuracy;
- minimality of repair;
- retries;
- final validity;
- preserved intent.

### E. Assemblies

Metrics:
- correct part count;
- instance reuse;
- transform accuracy;
- joint/DOF correctness;
- required motion range;
- interference;
- BOM;
- performance at increasing instance counts.

### F. Large assembly

Synthetic scales:
- 1k parts;
- 10k instances;
- 100k lightweight instances;
- progressively larger loaded detail.

Measure:
- project open time;
- time-to-first-frame;
- frame time p50/p95/p99;
- selection latency;
- exact-part activation latency;
- peak memory;
- tessellation-cache growth;
- tree search latency.

### G. CAE

Do not benchmark by asking an LLM “does this look right?”

For each solver class:
- analytical solutions where available;
- published reference problems;
- mesh-convergence studies;
- conservation/residual checks;
- comparison against trusted solver results.

The AI is benchmarked on setup correctness separately from numerical solver accuracy.

### H. Manufacturability

Per process, curate known pass/fail geometries:
- draft;
- thin walls;
- deep pockets;
- tool access;
- undercuts;
- bend constraints;
- additive supports;
- hole ratios.

Metric includes location accuracy of the finding, not only classification.

### I. CAM

Measure:
- toolpath validity;
- stock removal;
- gouge;
- holder/machine collision;
- residual stock;
- path length/time estimate;
- post-processor parse;
- safe start/end state.

### J. Interoperability

For each supported format:
- export;
- fresh-process re-import;
- geometry compare;
- structure compare;
- metadata compare;
- warning report.

### K. Resource resilience

Fault-injection:
- memory pressure;
- disk full;
- worker crash;
- solver hang;
- malformed file;
- network timeout;
- cancelled job;
- bad adapter;
- merge conflict.

Pass if project state and UI remain recoverable.

## Required release evidence

Each release produces a machine-readable scorecard with:
- commit;
- dependency versions;
- model hash;
- adapter hash;
- platform;
- test set version;
- pass/fail counts;
- latency distribution;
- peak memory;
- crashes;
- resource-pressure events;
- known regressions.

## Stretch targets, not current claims

The following are useful release goals to drive engineering; they are not statements that the current product already meets them:

- 100% parser/schema validity for emitted IR after constrained decoding.
- 100% no-commit on invalid B-Rep.
- >99% pass on core primitive/feature construction corpus.
- >95% successful invariant-preserving edits on the mature L1/L2 edit set.
- zero unrecovered project corruption in fault-injection suite.
- zero UI-process deaths during defined soak test.
- bounded memory/cache growth across long sessions.
- deterministic replay for committed transactions.
- STEP round-trip verification on all release fixtures.
- statistically significant improvement before promoting a new Archie adapter.

Advanced freeform, large assemblies, nonlinear CAE and multi-axis CAM get their own staged gates rather than being hidden inside one aggregate score.

## Competitive benchmark philosophy

External benchmarks tell you where the ecosystem is. Forge’s proprietary benchmark must be harder:
- generation;
- editing;
- repair;
- parametric recompute;
- topology stability;
- assemblies;
- DFM;
- CAE setup;
- CAM verification;
- resource resilience.

The true “Astra-class” proof is not a marketing adjective. It is the system repeatedly completing hard engineering tasks with lower intervention and stronger verifiable correctness than competing agentic CAD pipelines.
