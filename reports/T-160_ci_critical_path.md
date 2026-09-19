# T-160 — the CI critical path: where the 100 job-minutes actually go

## Result, up front

| | before (measured on CI) | after |
|---|---:|---:|
| `forge::ui workstation gates` | **47.63 min** (2,858 s) | **6.65 min** (399 s) — ★ MEASURED ON CI, green |
| `OCCT kernel smoke` | **52.92 min** (3,175 s) | ~37.7 min — projected (see section 5) |
| sum of all 17 jobs (runner-pool pressure) | 168.7 job-min | ~127 job-min |
| workflow wall clock, one PR | 59.2 min | ~44 min |

**The `forge::ui` job is no longer a projection.** This branch's own CI run
(job `105810680781`, `00:57:18Z -> 01:03:59Z`, **all steps success**) measured it at
**399 s**. That is **7.2x**, and it beat the projection in this report (~11.1 min)
by a wide margin — because the local *after* arm ran at `JOBS=2` where the runner
has 4, exactly the conservatism flagged in section 0.

Locally, both arms measured end to end on the same box: the `ui` job's nine steps
go **854.0 s -> 180.8 s** (21.2% of before) and the two changed kernel steps go
**632.5 s -> 219.7 s** (34.7%). **Every mutation proof still turns red** — section 6
is the transcript, and section 7 deliberately breaks the cache to show the gates
catch it.

---

**Scope.** The two jobs that dominate the runner pool: `forge::ui workstation gates`
and `OCCT kernel smoke`. This report gives the measured before profile of both,
the count of repeated compiles inside each, what was changed, the measured after
profile, and the transcript proving every mutation proof still turns red.

**The standing hypothesis was: "uncached, single-threaded recompilation inside
mutation proofs". IT IS CORRECT, and it is the single largest line in both jobs.**
It is not, however, the *whole* of the kernel job — see §2.

---

## 0. Method, and which numbers are which

Two independent measurements are reported and they are never mixed.

| label | what it is | how |
|---|---|---|
| **CI** | the real runner, exact | GitHub Actions per-step `started_at`/`completed_at` for run **35404083651**, jobs `105790087612` (ui) and `105790087650` (kernel), on merged head **29070823**. Every step of both jobs was `success`. |
| **local** | Apple M4 Max, 36 GB | the same gate scripts, run from a pinned worktree of `origin/archdisc` (before) and of this branch (after), wrapped in `forge-job … --need orange`. |

★ **The CI *after* figures in §5 are a PROJECTION**, computed from the measured CI
before figure and the measured local before/after ratio for the same step. They are
not measurements of a runner. Local timings on an M4 Max do not transfer.

★ One number matters for the projection and is **measured, not assumed**: the ubuntu
runner's core count. `run_ui.sh` prints it, and the CI log for this very job says
`[ui] CXX=clang++ JOBS=4`. The local *after* arm ran at `JOBS=2` — Guardian was at
ORANGE with `build_jobs_max: 2` for the whole session — so the local arm had **half
the runner's parallelism**, and the projection is conservative in the compile term.

---

## 1. `forge::ui workstation gates` — the before profile

**Denominator: 2,858 s = 47.63 min**, the job's own wall clock, and the rows below
sum to it exactly.

| step | s | % of 2,858 |
|---|---:|---:|
| what a USER reads (13 mutations) | **1,203** | **42.1** |
| how many docked tabs still show nothing (5 mutations + 1 control) | **585** | **20.5** |
| what the Model and Sketch tabs SHOW (4 mutations) | **416** | **14.6** |
| forge-desktop still TYPE-CHECKS (4 mutations) | **290** | **10.1** |
| forge::ui gates (`run_ui.sh`) | 127 | 4.4 |
| op-constraint bridge (drift check + 9 mutations) | 86 | 3.0 |
| two-path differential, tier 1 (+ 9 mutations) | 78 | 2.7 |
| run_ui.sh self-protection contracts | 64 | 2.2 |
| checkout + setup + vocabulary + post + complete | 9 | 0.3 |
| **total** | **2,858** | **100.0** |

**The four `--mutations` steps are 2,494 s — 87.3% of the job.**

## 2. `OCCT kernel smoke` — the before profile

**Denominator: 3,175 s = 52.92 min.** 60 steps; the ten largest are named and the
remaining 48 are one row, and the rows sum to the whole.

| step | s | % of 3,175 |
|---|---:|---:|
| Desktop CRASH-ISOLATION gate (8 mutations) | **1,091** | **34.4** |
| the six OCCT-free native-tree builders | 376 | 11.8 |
| Desktop CLICK gate | 270 | 8.5 |
| live-OCCT A/B harnesses | 261 | 8.2 |
| Configure + build native kernel (.node) | 178 | 5.6 |
| NAFEMS known-answer accuracy ratchet | 153 | 4.8 |
| native gate guard | 152 | 4.8 |
| Build forge_kernel_core (build-verify) | 119 | 3.7 |
| two-path differential, tier 2 | 114 | 3.6 |
| coaxial-circle loft mutation gate | 84 | 2.6 |
| the other 48 steps (≤ 40 s each) | 377 | 11.9 |
| **total** | **3,175** | **100.0** |

★ **Here the hypothesis is only PARTLY right, and this is the part of the brief that
was wrong.** One mutation proof is a third of the job — but the next three lines
(1,013 s, 31.9%) are *not* mutation proofs at all:

* **the six native-tree builders (376 s)** each compile the same 156 `src/native`
  translation units from scratch into their own `mktemp` directory, already in
  parallel. Six identical passes, ~62 s each. The waste is real but it is
  *cross-script* repetition, not a mutation sweep.
* **live-OCCT A/B (261 s)** is almost entirely **OCCT runtime, not compilation**:
  from the step's own log, `sweep` 105.9 s and `thicksolid_mixed` 94.3 s are 77% of
  it. The ten harnesses run as separate processes, serially.
* **NAFEMS (153 s)** and **tier-2 differential (114 s)** are solver and kernel
  runtime.

So for the kernel job the accurate statement is: **compilation inside one mutation
proof is 34.4%; repeated compilation across six unrelated scripts is another 11.8%;
and roughly a fifth of the job is OCCT/solver execution that no build change can
touch.**

### 2a. Inside the 1,091 s crash-isolation step

From the step's own timestamps in the CI log:

| phase | s |
|---|---:|
| base build (`build_pair`) + clean run | 174 |
| S1 … S6, six **source** mutations, each a full rebuild | 897 |
| G1 + G2, two **gate-side** mutations that reuse the base binary | 19 |
| wiring check + control | 1 |
| **total** | **1,091** |

Each source mutation costs ~150 s; the two that need no rebuild cost **9.5 s each**.
That 16× ratio is the entire finding, stated by the gate's own log.

---

## 3. How many times does each gate compile, and how much is repeated?

A "unit" below is one translation unit passed to `clang++`. Every figure is counted
from the scripts and confirmed against the `compiled N, reused M` accounting the
changed scripts now print.

### `forge::ui` job

| gate | builds | units per build | total units | **unique inputs** | **repeated** |
|---|---:|---:|---:|---:|---:|
| what a USER reads | 14 (clean + 13) | 47 | 658 | 54 | **604 (91.8%)** |
| docked-tab pin | 7 (clean + 5 + control) | 47 | 329 | 51 | **278 (84.5%)** |
| model/sketch tabs | 5 (clean + 4) | 47 | 235 | 51 | **184 (78.3%)** |
| op-constraint bridge | 1 | 47 | 47 | 47 | 0 |
| two-path differential t1 | 1 | 47 | 47 | 47 | 0 |
| **subtotal** | **28** | | **1,316** | **250** | **1,066 (81.0%)** |

All 1,316 were compiled by **one `clang++` invocation per build**, which the driver
runs strictly serially however many cores the runner has.

`forge-desktop still TYPE-CHECKS` is a different shape: 12 `-fsyntax-only` parses,
run **five times** (clean plus four `--mutate` re-invocations of the same script) =
**60 parses**, in a serial `for` loop. `-fsyntax-only` writes no artefact, so there is
nothing to cache — only parallelism applies.

`run_ui.sh self-protection contracts` (64 s) spent essentially all of it on case C,
which runs the **whole** of `run_ui.sh` under `ONLY=__no_such_gate__` — 48 header
checks and 46 source compiles — to prove a refusal that depends on no build at all.
100% repeated, and also 100% unnecessary.

### `OCCT kernel smoke` job

| gate | builds | units per build | total units | **unique** | **repeated** |
|---|---:|---:|---:|---:|---:|
| crash-isolation, worker (unsanitized) | 7 | 50 | 350 | 56 | **294 (84.0%)** |
| crash-isolation, gate (ASan) | 7 | 51 | 357 | 56 | **301 (84.3%)** |
| click gate, ImGui | 1 | 4 | 4 | 4 | 0 |
| click gate, main | 1 | 58 | 58 | 58 | 0 |
| **subtotal** | **16** | | **769** | **174** | **595 (77.4%)** |

Again all 769 in 16 serial `clang++` invocations. The crash-isolation figures are
**confirmed by the gate's own new accounting**: its base build reports `compiled 101`
(50 worker + 51 gate) and its six mutations report `compiled 2, 2, 1, 2, 2, 2` — 112
distinct inputs where 707 compiles were being paid for. S3 is the 1, because
`kernel_worker_main.cpp` is in the worker's source list and not the gate's.

---

## 4. What changed, each labelled SAFE or UNSAFE

The rule applied throughout: **a second removed must not have been buying
falsifiability.** Nothing below lets a mutation round run a binary built before the
mutation; §6 proves it rather than asserting it.

### New: `tools/gates/forge_cxx_cache.sh` — a content-addressed, parallel compile

Sourced by the six gate scripts below. An object is reused only when the
translation unit's **bytes**, its **path**, the **exact compile flags in order**, the
**compiler's `--version` banner**, and an **epoch over every includable file in every
in-tree `-I` directory** are all identical.

* **SAFE — the key is content, never a timestamp.** The named failure in this repo
  (`run_step_unit_decline_gate.sh`) was an *mtime* decision losing a second-boundary
  race. There is no mtime anywhere in this cache; case 8 of the selftest makes the
  point by stamping a rewritten source **older than its own cached object** and
  requiring a recompile anyway.
* **SAFE — the epoch over-invalidates.** It does not ask which headers a TU included;
  any in-tree header change moves the epoch and invalidates *every* key. `.cpp` files
  are excluded from the epoch (a source directory is usually also an `-I` root, so
  including them would mean one mutation invalidated all fifty objects) — and that
  exclusion is only sound while no TU `#include`s another, so **the helper checks
  that premise on every call** and falls back to hashing everything if it is ever
  violated.
* **SAFE — the cache is per-run.** Every caller puts it inside its own `mktemp -d`,
  so it starts empty and dies with the work tree. Nothing survives from a previous
  checkout, branch or sweep.
* **SAFE — parallelism only.** Compiling N independent translation units under
  `forge-nproc` (falling back to `nproc`/`sysctl`, which is the idiom `run_ui.sh`
  already uses) changes nothing about what is compiled or with what flags. This is
  *not* the OCCT threading result from the program ledger: that is about one
  process-wide `NCollection_BaseAllocator` inside an OCCT runtime loop, and
  compilation has no such serialisation.

### New: `tools/gates/forge_cxx_cache_selftest.sh` — nine cases, ~5 s

Wired into `ui/test/run_ui_contract_test.sh` as case **D**, so it runs on every push
without any workflow edit. It proves a source edit, a header edit and a flag change
each reach the binary; that identical bytes at different paths do not collide; and
that a source stamped older than its object still recompiles.

### Changed gates

| file | change | label | why it is safe |
|---|---|---|---|
| `ui/test/run_user_prose_gate.sh` | one tree at a **constant path**, restored between mutations, objects cached on content, compiles parallel | **SAFE** | The per-mutation tree path used to appear in `-I` and `-D`, so no two of the 14 builds could share an object. With a fixed path the flags are identical and only the mutated file recompiles. The restore is *checked* (`diff -rq` against the pristine copy) and a mutation that wrote nothing is now a named failure, not a silent pass. |
| `ui/test/run_panel_ratchet_gate.sh` | same | **SAFE** | same |
| `ui/test/run_model_tree_gate.sh` | same | **SAFE** | same |
| `ui/test/run_op_constraint_gate.sh` | the single build compiles in parallel | **SAFE** | All nine mutations are `--mutate N` switches *inside* the binary; there is one build and nothing about the proof depends on how units reach the linker. |
| `ui/test/run_differential_gate.sh` | same | **SAFE** | same |
| `forge-desktop/test/run_click_gate.sh` | ImGui's four objects and the ~57-unit main build compile in parallel | **SAFE** | All twelve mutations are `--mutate N` switches inside the binary. Same sources, same flags, same link order. |
| `forge-desktop/test/run_isolation_gate.sh` | one source tree at a constant path, restored and checked between mutations; objects cached on content; parallel | **SAFE** | Each mutation edits ONE file of ~50. The base build now compiles from the same copy the mutations do, so the two share one flag set — `fcc_reset_tree` proves the copy is byte-identical to the checkout before anything is built from it. |
| `forge-desktop/test/run_syntax_gate.sh` | the 12 `-fsyntax-only` parses and the OCCT-skip probes run in parallel; output order preserved | **SAFE** | `-fsyntax-only` writes no object and no binary; each unit's verdict depends on nothing but its own text and the include path. It also **fixes a latent bug**: every unit wrote its errors to one shared path, which a parallel run would have raced. |
| `ui/test/run_ui.sh` | `ONLY=<typo>` is refused **before** anything is compiled | **SAFE** | The refusal is the contract ("a filter that matches nothing must never report success"); it depends on no build. Same exit code, same words. A filter that *does* match still builds everything. |

**Nothing was deleted, skipped or sampled. No mutation count was reduced. No
tolerance was changed. No assertion was touched.** `.github/workflows/` was read and
**not edited** (PR #279 owns `kernel-tests.yml`); `forge-kernel/src/native/**` and
`forge-kernel/src/native/linalg/**` were read and not edited.

---

## 5. The after profile

### `forge::ui` job — local, same method, both arms run

`bash reports/../<each step>` in workflow order, from a worktree pinned to
`origin/archdisc` (before) and to this branch (after). Both arms ran at `JOBS=2`
(Guardian ORANGE), both green.

| step | before (s) | after (s) | ratio |
|---|---:|---:|---:|
| `run_ui.sh` | 21.7 | 21.0 | 0.97 |
| `run_ui_contract_test.sh` | 14.0 | **2.5** | 0.18 |
| vocabulary `--check` | 0.3 | 0.3 | 1.00 |
| `run_op_constraint_gate.sh` | 26.9 | 16.1 | 0.60 |
| `run_differential_gate.sh` | 24.2 | 14.3 | 0.59 |
| `run_user_prose_gate.sh --mutations` | 379.6 | **35.1** | 0.09 |
| `run_panel_ratchet_gate.sh --mutations` | 180.0 | **24.2** | 0.13 |
| `run_model_tree_gate.sh --mutations` | 125.8 | **22.1** | 0.18 |
| `run_syntax_gate.sh --mutations` | 81.5 | 45.2 | 0.55 |
| **total (local)** | **854.0** | **180.8** | **0.212** |

The `ui_contract` row **includes the new 5-second cache selftest**; it still falls
from 14.0 s to 2.5 s because the `ONLY=` short-circuit removed a whole redundant
build.

### ★ `forge::ui` job — MEASURED ON CI, this branch

Job `105810680781` on `869d581f`, every step `success`. Same job, same workflow
file, same runner image as the before profile in section 1 — so these two columns
are directly comparable.

| step | before (s) | **after (s)** | ratio |
|---|---:|---:|---:|
| checkout | 7 | 7 | 1.00 |
| forge::ui gates (`run_ui.sh`) | 127 | 92 | 0.72 † |
| run_ui.sh self-protection contracts | 64 | **2** | **0.03** |
| Archie op vocabulary | 1 | 0 | — |
| op-constraint bridge (+ 9 mutations) | 86 | **34** | 0.40 |
| two-path differential t1 (+ 9 mutations) | 78 | **30** | 0.38 |
| what a USER reads (13 mutations) | 1,203 | **56** | **0.047** |
| docked-tab pin (5 + control) | 585 | **43** | **0.074** |
| model/sketch tabs (4 mutations) | 416 | **42** | **0.101** |
| forge-desktop TYPE-CHECKS (4 mutations) | 290 | **93** | 0.32 |
| setup + post + complete | 1 | 0 | — |
| **total** | **2,858 (47.63 min)** | **399 (6.65 min)** | **0.140** |

**-2,459 s = -41.0 minutes, measured.**

† `run_ui.sh` is the one row whose *code path* did not change (the `ONLY=` guard
only fires on a filter that matches nothing). Its 127 -> 92 s is **runner variance,
not this change** — it should be read as "no regression", and the honest saving is
therefore about **2,424 s** rather than 2,459 s.

The three biggest steps in the job fell by **21.5x, 13.6x and 9.9x** respectively,
and all four mutation sweeps reported every mutation red — the job is green.

**The projection this report made before the run, for comparison:**

| step | CI before (s) | × local ratio | CI after (projected, s) |
|---|---:|---:|---:|
| what a USER reads | 1,203 | 0.092 | 111 |
| docked-tab pin | 585 | 0.134 | 79 |
| model/sketch tabs | 416 | 0.176 | 73 |
| forge-desktop TYPE-CHECKS | 290 | 0.555 | 161 |
| `run_ui.sh` | 127 | 0.968 | 123 |
| op-constraint | 86 | 0.599 | 51 |
| differential t1 | 78 | 0.591 | 46 |
| self-protection contracts | 64 | 0.179 | 11 |
| fixed overhead | 9 | 1.0 | 9 |
| **total** | **2,858 (47.6 min)** | | **≈ 664 s (≈ 11.1 min)** |

The projection was **1.7x too pessimistic** (664 s projected, 399 s measured), and
for the stated reason: the local *after* arm ran at `JOBS=2` under an ORANGE
Guardian while the runner has 4, so every parallel term was understated. Recorded
here rather than deleted, because a projection that is only shown when it was right
is not a method.

### `OCCT kernel smoke` job — local, the two steps that were changed

Both arms run on the same box, against the same `forge-kernel/build-verify`
(`FORGE_KERNEL_BUILD_DIR` pinned to one build for both), both at `JOBS=2`
(Guardian ORANGE), both green.

| step | before (s) | after (s) | ratio |
|---|---:|---:|---:|
| `run_click_gate.sh` | 127.6 | 115.0 | 0.90 |
| `run_isolation_gate.sh` | **504.9** | **104.7** | **0.21** |
| **total (local)** | **632.5** | **219.7** | **0.35** |

**CI projection for the two changed kernel steps — a projection, not a measurement.**
The two steps need different treatments and the difference is worth stating, because
one ratio applied to both would be misleading:

* **crash-isolation.** Its saving is *structural* — six full rebuilds become six
  relinks — so the local ratio transfers. Two independent derivations:
  * from the measured local ratio: 1,091 x 0.207 = **226 s**;
  * from the CI log's own phase split: the base build at a conservative 2x is
    ~87 s, plus six mutations at ~28 s each (the CI log already measures a
    *no-rebuild* mutation at 9.5 s; add two relinks and a checked tree reset),
    plus the 19 s of gate-side mutations = **274 s**.

  Call it **~230-275 s, from 1,091 s** — 18.2 min down to about 4.5 min.
* **click gate.** Its saving is *purely parallelism*, so it depends on a number this
  report does **not** measure: the core count of `macos-26-arm64`. The local ratio
  does NOT transfer here, because the compile/runtime split differs (on CI, 138 s of
  the 270 s is compile; locally it is a much smaller share). At the conservative
  floor of 2x on the compile term the step goes **270 -> ~201 s**; at 3x, ~178 s.

| | CI before | CI after (projected) |
|---|---:|---:|
| crash-isolation | 1,091 s | ~250 s |
| click gate | 270 s | ~200 s |
| the other 58 steps (unchanged) | 1,814 s | 1,814 s |
| **OCCT kernel smoke total** | **3,175 s (52.9 min)** | **~2,264 s (~37.7 min)** |

About **-15 minutes**, and the remaining ~37.7 min is then dominated by work no
build change reaches: 376 s of cross-script repeated compiles (section 8.1), 261 s
of OCCT A/B runtime (section 8.2), and roughly 900 s of solver and kernel execution
spread over 55 small steps.

---

## 6. ★ The acceptance criterion: every mutation still goes RED

Every gate below was re-run **after** the change, on this branch, and every
mutation still turns it red. The verdicts are identical to the before arm — same
mutations, same failed-check counts, same wording — which is the point: the only
thing that changed is how long it took to get there.

The `[compiled N, reused M]` suffix is new, and it is the accounting that makes the
cache auditable from the CI log alone: a mutation that edits a **compiled** source
recompiles exactly that unit; one that edits a file the gate reads **as data at run
time** recompiles nothing and is relinked.

### `run_user_prose_gate.sh --mutations` — 13 / 13 RED

```
[prose] CXX=clang++ JOBS=2  one tree at a constant path, objects cached on content
[prose] clean build: compiled 47 translation unit(s), reused 0
[fcc] cache epoch hashes: /tmp/forge_prose.lgNwLR/tree/ui/include /tmp/forge_prose.lgNwLR/tree/ui/test /tmp/forge_prose.lgNwLR/tree/ui/src 
[user_facing_text] 20036 checks, 0 failures — PASS
[user_facing_text] 51 panels in the shipped workspaces, 2 still planned
[user_facing_text] 44 sources, 916 text calls, 1095 drawn literals, 65 log messages scanned
[user_facing_text] 942 live surface strings scanned
[prose] clean run GREEN
[prose] mutation 1: RED (as required) [compiled 0, reused 47]
[prose] mutation 2: RED (as required) [compiled 0, reused 47]
[prose] mutation 3: RED (as required) [compiled 1, reused 46]
[prose] mutation 4: RED (as required) [compiled 1, reused 46]
[prose] mutation 5: RED (as required) [compiled 1, reused 46]
[prose] mutation 6: RED (as required) [compiled 1, reused 46]
[prose] mutation 7: RED (as required) [compiled 1, reused 46]
[prose] mutation 8: RED (as required) [compiled 1, reused 46]
[prose] mutation 9: RED (as required) [compiled 0, reused 47]
[prose] mutation 10: RED (as required) [compiled 0, reused 47]
[prose] mutation 11: RED (as required) [compiled 0, reused 47]
[prose] mutation 12: RED (as required) [compiled 0, reused 47]
[prose] mutation 13: RED (as required) [compiled 1, reused 46]
[prose] GREEN -- clean run passes and all 13 mutations proved red
```

### `run_panel_ratchet_gate.sh --mutations` — 5 / 5 RED, control GREEN

```
[panel-ratchet] CXX=clang++ JOBS=2  one tree at a constant path, objects cached on content
[panel-ratchet] clean build: compiled 47 translation unit(s), reused 0
[fcc] cache epoch hashes: /tmp/forge_panel_ratchet.hAPNL3/tree/ui/include /tmp/forge_panel_ratchet.hAPNL3/tree/ui/test /tmp/forge_panel_ratchet.hAPNL3/tree/ui/src 
[panel-ratchet] 51 panels in the eight default workspaces, 2 still empty (pinned at 2)
[panel_content_ratchet] 23 checks, 0 failures — PASS
[panel-ratchet] clean run GREEN
[panel-ratchet] mutation 1: RED (as required) [compiled 1, reused 46]
          RED: "flange_wizard" shows no content and is not pinned. A workspace tab that draws nothing is not a feature; write its content, or say here why it cannot be written yet.
[panel-ratchet] mutation 2: RED (as required) [compiled 1, reused 46]
          RED ON AN IMPROVEMENT: "convergence" now has content. Delete it from kPinnedEmptyPanels in this file. A pin left above the truth can silently re-admit a regression it has already been lowered past.
[panel-ratchet] mutation 3: RED (as required) [compiled 0, reused 47]
          panel "curve_list": the frame builder and the catalogue disagree about whether it has content
          FAIL /tmp/forge_panel_ratchet.hAPNL3/tree/ui/test/panel_content_ratchet_test.cpp:298  disagreements.size() == 0
          RED: "curve_list" shows no content and is not pinned. A workspace tab that draws nothing is not a feature; write its content, or say here why it cannot be written yet.
[panel-ratchet] mutation 4: RED (as required) [compiled 0, reused 47]
          panel "convergence": the frame builder and the catalogue disagree about whether it has content
          FAIL /tmp/forge_panel_ratchet.hAPNL3/tree/ui/test/panel_content_ratchet_test.cpp:298  disagreements.size() == 0
[panel-ratchet] mutation 5: RED (as required) [compiled 1, reused 46]
          RED ON AN IMPROVEMENT: "annotation" now has content. Delete it from kPinnedEmptyPanels in this file. A pin left above the truth can silently re-admit a regression it has already been lowered past.
[panel-ratchet] control: GREEN (as required) -- the gate reacts to panels, not to edits
[panel-ratchet] GREEN -- clean run passes, all 5 mutations red, control green
```

### `run_model_tree_gate.sh --mutations` — 4 / 4 RED

```
[model-tree] CXX=clang++ JOBS=2  one tree at a constant path, objects cached on content
[model-tree] clean build: compiled 47 translation unit(s), reused 0
[fcc] cache epoch hashes: /tmp/forge_model_tree.oeummQ/tree/ui/include /tmp/forge_model_tree.oeummQ/tree/ui/test /tmp/forge_model_tree.oeummQ/tree/ui/src 
[model_tree] 183 checks, 0 failures — PASS
[model-tree] clean run GREEN
[model-tree] mutation 1: RED (as required) [compiled 1, reused 46]
[model-tree] mutation 2: RED (as required) [compiled 1, reused 46]
[model-tree] mutation 3: RED (as required) [compiled 1, reused 46]
[model-tree] mutation 4: RED (as required) [compiled 1, reused 46]
[model-tree] GREEN -- clean run passes and all 4 mutations proved red
```

### `run_syntax_gate.sh --mutations` — 4 / 4 RED

```
[syntax] clean run GREEN; proving the gate can fail
[syntax] mutation 1: RED (as required)
[syntax] mutation 2: RED (as required)
[syntax] mutation 3: RED (as required)
[syntax] mutation 4: RED (as required)
[syntax] GREEN -- gate passes clean and all 4 mutations proved red
```

### `run_isolation_gate.sh` — 8 / 8 caught (6 source mutations + 2 gate-side)

```
[isolation] kernel core: /Users/account_clawteam1/.archdisc-wt/t160-ci/forge-kernel/build-verify/libforge_kernel_core.dylib
[isolation] compiling the worker (unsanitized) and the gate (sanitized), JOBS=2
[isolation] base build: compiled 101 translation unit(s), reused 0
[fcc] cache epoch hashes: /var/folders/7x/rvqdyxh94jq5hk4s4rzf5rrr0000gn/T//isolation_gate.yaxesK/src/ui/include /Users/account_clawteam1/.archdisc-wt/t160-ci/forge-kernel/include /var/folders/7x/rvqdyxh94jq5hk4s4rzf5rrr0000gn/T//isolation_gate.yaxesK/src/forge-desktop/src /var/folders/7x/rvqdyxh94jq5hk4s4rzf5rrr0000gn/T//isolation_gate.yaxesK/src/ui/src /var/folders/7x/rvqdyxh94jq5hk4s4rzf5rrr0000gn/T//isolation_gate.yaxesK/src/forge-desktop/test 
[fcc] NOT hashed (toolchain, pinned by the compiler banner and the job's install step): /opt/homebrew/opt/opencascade/include/opencascade /opt/homebrew/opt/eigen/include/eigen3 
[isolation] worker: /var/folders/7x/rvqdyxh94jq5hk4s4rzf5rrr0000gn/T//isolation_gate.yaxesK/base/forge_kernel_worker

[isolation] 93 checks, 0 failures
[isolation] ★ THE APPLICATION SURVIVES A KERNEL SEGFAULT, A HANG, A REFUSAL,
[isolation]   A PROTOCOL BREACH AND A MISSING WORKER — and refuses nothing.
[isolation] wiring: main.cpp installs a host pump -- a rebuild stays answerable
[isolation] wiring control: the check goes RED when the call is removed

[isolation] mutation proof -- each injected defect MUST turn the gate red:
  S1: RED (28 checks failed) <- the isolated path is bypassed, so every build runs in process  [compiled 2, reused 99]
        first: one build was served out of process                            g
  S2: RED (3 checks failed) <- ★ a QUARANTINE appears: submit() declines a program that crashed before  [compiled 2, reused 99]
        first: ★ but it WAS SUBMITTED AGAIN — no quarantine, no refusal   got 2
  S3: RED (8 checks failed) <- the worker stops announcing its ops, so a crash names nothing  [compiled 1, reused 100]
        first: the op trail names the LAST statement announced                g
  S4: RED (1 checks failed) <- the vertex-length check is weakened from != to <, so an over-long stream renders  [compiled 2, reused 99]
        first: an OVER-LONG vertex stream is refused too                      
  S5: RED (5 checks failed) <- a crashed build reports SUCCESS  [compiled 2, reused 99]
        first: a crashing program does not report success                     
  S6: RED (1 checks failed) <- the unbounded-uninterruptible-wait guard is removed, so the app HANGS on rebuild  [compiled 2, reused 99]
        first: and it fell back rather than entering a wait nothing can end   g
  G1: RED <- ★ null dereference IN THE PARENT (what an UNISOLATED fault does)
        SUMMARY: AddressSanitizer: SEGV isolation_gate.cpp:243 in main
  G2: RED <- the host pump never cancels, so the deadline ends the job instead
        ★ the user's cancel ended it                                 got

[isolation] GREEN -- the gate passes and all 8 mutations were caught.
```

### `run_click_gate.sh` — 12 / 12 RED (tail)

```
[gate] ALL FORGE DESKTOP CLICK GATES PASS (headless: no window, no swapchain, no MoltenVK; -fsanitize=address)

[click-gate] mutation proof (each injected defect must turn the gate red):
  mutation 1: RED (exit 1, 68 checks failed) <- the clicked tab is the active tab                         got 0 want 1   [part {0}[1] model_browser]
  mutation 2: RED (exit 1, 98 checks failed) <- the frame after the click produced draw data              part {0}[0] feature_tree
  mutation 3: RED (exit 1, 0 checks failed) <- SUMMARY: AddressSanitizer: heap-use-after-free click_gate.cpp:323 in main
  mutation 4: RED (exit 1, 1 checks failed) <- every workspace was exercised                             got 1 want 8   []
  mutation 5: RED (exit 1, 24 checks failed) <- the drag moved the ratio in the dock TREE                 0.180000 -> 0.180000
  mutation 6: RED (exit 1, 1 checks failed) <- EVERY registered command was invoked                      got 1 want 104   []
  mutation 7: RED (exit 1, 105 checks failed) <- a frame was drawn after invoking                          app.command_palette
  mutation 8: RED (exit 1, 6 checks failed) <- view.top MOVED the camera                                 
  mutation 9: RED (exit 1, 3 checks failed) <- and the feature it recorded is a TRANSLATE                
  mutation 10: RED (exit 1, 3 checks failed) <- one body selected put the drag handles up                 
  mutation 11: RED (exit 1, 4 checks failed) <- the finished drag emitted once                            got 0 want 1   []
  mutation 12: RED (exit 1, 3 checks failed) <- and what it picked is a BODY                              
```

### `run_op_constraint_gate.sh` — 9 / 9 caught (tail)

```

[op_constraint_bridge] 1874 checks, 0 failures — PASS
[op-constraint] mutation 1 caught: [op_constraint_bridge] 1758 checks, 54 failures — FAIL
[op-constraint] mutation 2 caught: [op_constraint_bridge] 1888 checks, 9 failures — FAIL
[op-constraint] mutation 3 caught: [op_constraint_bridge] 1872 checks, 4 failures — FAIL
[op-constraint] mutation 4 caught: [op_constraint_bridge] 1874 checks, 4 failures — FAIL
[op-constraint] mutation 5 caught: [op_constraint_bridge] 1872 checks, 2 failures — FAIL
[op-constraint] mutation 6 caught: [op_constraint_bridge] 1874 checks, 28 failures — FAIL
[op-constraint] mutation 7 caught: [op_constraint_bridge] 1866 checks, 2 failures — FAIL
[op-constraint] mutation 8 caught: [op_constraint_bridge] 1874 checks, 3 failures — FAIL
[op-constraint] mutation 9 caught: [op_constraint_bridge] 1884 checks, 10 failures — FAIL
[op-constraint] VERDICT: PASS — drift check green and mutation-proved, gate green, 9/9 gate mutations caught
```

### `run_differential_gate.sh` — 9 / 9 caught (tail)

```
[differential] forge_verify transcript reader: checked against a CAPTURED line
[differential] 157 checks, 0 failures — PASS
[differential] mutation 1 caught: app-drops-last-step — [differential] 148 checks, 9 failures — FAIL
[differential] mutation 2 caught: app-swaps-boolean-operand-order — [differential] 146 checks, 3 failures — FAIL
[differential] mutation 3 caught: app-perturbs-one-number — [differential] 142 checks, 9 failures — FAIL
[differential] mutation 4 caught: headless-drops-a-statement — [differential] 157 checks, 11 failures — FAIL
[differential] mutation 5 caught: headless-perturbs-one-number — [differential] 157 checks, 11 failures — FAIL
[differential] mutation 6 caught: headless-reorders-two-ops — [differential] 157 checks, 11 failures — FAIL
[differential] mutation 7 caught: app-hands-the-bridge-an-op-no-command-emits — [differential] 157 checks, 9 failures — FAIL
[differential] mutation 8 caught: copilot-applies-one-step-short — [differential] 148 checks, 2 failures — FAIL
[differential] mutation 9 caught: copilot-picks-nothing-and-keeps-the-selection — [differential] 115 checks, 10 failures — FAIL
[differential] VERDICT: PASS — clean run green, 9/9 injected divergences caught
```

### `run_ui_contract_test.sh` — the three original contracts plus the new case D

```
ui/test/run_ui_contract_test.sh: line 46: cd: /forge/no/such/directory/anywhere/../..: No such file or directory
  PASS  A: an unresolvable repo root exits nonzero instead of continuing (rc=1)
  PASS  B: cleanup reports the directory it failed to remove
  PASS  C: ONLY matching no gate exits 1 and refuses to report success
  PASS  D: the gate compile cache cannot serve a stale object (9 passed, 0 failed)

[ui-contract] 4 passed, 0 failed
```


---

## 7. ★ And the proof that these gates would CATCH a broken cache

A speedup that quietly disarmed the sweeps would be worse than the 52 minutes, and
"all mutations are still red" is not by itself evidence of that — a gate can be red
for the wrong reason. So the cache was **deliberately sabotaged** and the gates were
re-run. The sabotage is one line: drop the source-content hash out of the object key,
which is exactly the classic stale-object bug.

The single-line sabotage, applied to `tools/gates/forge_cxx_cache.sh`:

```diff
-    key="$(printf '%s|%s|%s\n' "$base" "$s" "$h" | fcc__sha)"
+    key="$(printf '%s|%s\n'    "$base" "$s"      | fcc__sha)"   # SABOTAGE
```

`$h` is the source file's content hash. Dropping it is exactly "reuse the object
whatever the file now says".

**The cache selftest, against the sabotaged cache** — 2 of 9 fail, and they are the
two that exist for this:

```
  PASS  1a: a cold build compiles all 3 units and the program answers 111
  PASS  1b: an unchanged rebuild reuses all 3 objects and still answers 111
  FAIL  2: * STALE OBJECT RISK - after editing a.cpp the program said [111] (want 117), compiled=0 reused=3 (want 1 / 2)
  PASS  3: * editing a header invalidates every object and the answer moves 117 -> 127
  PASS  4: changing a -D recompiles all 3 units rather than reusing the old flags' objects
  PASS  5: switching the flags back reuses the objects built under them, and only those
  PASS  6: reverting both edits restores 111 (compiled=0 reused=3) - the key is content, not history
  PASS  7: two sources with identical bytes at different paths get 2 distinct objects
  FAIL  8: * a source stamped older than its object gave [111] (want 511), compiled=0 (want 1) - THE MUTATION DID NOT REACH THE BINARY

[fcc-selftest] 7 passed, 2 failed
```

**And the prose gate itself, against the sabotaged cache:**

```
[prose] clean run GREEN
[prose] mutation 1: RED (as required) [compiled 0, reused 47]
[prose] mutation 2: RED (as required) [compiled 0, reused 47]
[prose] mutation 3 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 4 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 5 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 6 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 7 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 8 STAYED GREEN -- the check it targets is unfalsifiable
[prose] mutation 9: RED (as required) [compiled 0, reused 47]
[prose] mutation 10: RED (as required) [compiled 0, reused 47]
[prose] mutation 11: RED (as required) [compiled 0, reused 47]
[prose] mutation 12: RED (as required) [compiled 0, reused 47]
[prose] mutation 13 STAYED GREEN -- the check it targets is unfalsifiable
[prose] RED: 7 of 13 mutations did not prove the gate can fail
```

The gate names **precisely the seven mutations that edit a compiled source**, and
leaves red the six that edit `forge-desktop/src`, which this gate reads as data at
run time and never compiles. That is the correct answer, and it is the strongest
statement available: **the mutation sweeps are the cache's detector, and they work.**

The helper was then restored from a byte-compared backup (not `git checkout --`) and
the selftest re-run to 9/9.

---

## 8. Follow-ups, costed, deliberately NOT done here

1. **The six OCCT-free native-tree builders — 376 s, 11.8% of the kernel job.**
   Six scripts each compile the same 156 `src/native` units into their own `mktemp`
   directory: ~62 s apiece, five of them pure repetition. A shared content-keyed
   cache would take this to roughly one pass. It is not done here because each script
   carries a **positive control** that counts `*.o` in its own object directory and
   `nm`s them (it exists because a guard-off compile can be green over an empty
   translation unit), so the cache would have to publish objects back under their
   original names into a per-script directory. That is doable and safe, and it is
   six scripts' worth of change that deserves its own review rather than riding this
   one.
2. **`run_ab_all.sh` — 261 s, 8.2%.** Ten independent harness *processes*, run
   serially; `sweep` (106 s) and `thicksolid_mixed` (94 s) are 77% of it. Running
   them as parallel processes is the sanctioned pattern for OCCT work (threads give
   ~2× and go negative past 4; processes give ~9×), so the floor is the slowest
   harness, ≈ 110 s. Not done here: ten concurrent OCCT processes on a 14 GB
   `macos-latest` runner needs a memory measurement first, and a gate that starts
   OOM-killing is a worse outcome than 261 s.
3. **Workflow-level changes, which this task may not make** (PR #279 owns
   `kernel-tests.yml`):
   * `Build forge_kernel_core` uses a hardcoded `-j3`; the runner's own core count
     should decide.
   * The `ui` job's four mutation proofs are independent and could be a matrix —
     the file's own comment already calls this "★ THE STRUCTURALLY BETTER FIX".
     After this change they are ≈ 424 projected seconds of a ≈ 664-second job, so
     splitting them would put the `ui` job under 5 minutes.
   * A `~/.cache` action for the Homebrew OCCT install (22 s) and `npm install`
     (14 s) is small change by comparison and not worth the cache-poisoning surface.

---

## 9. WHAT I GOT WRONG

The briefing asked for every claim in it that turned out to be false, and every
wrong turn taken here. Each was verified rather than assumed.

### Claims in the briefing that HELD

* **"52 / 47 / 26 / 10 minutes on `29070823`".** All four check out against the
  GitHub check-run timestamps: OCCT kernel smoke **52m59s**, forge::ui **47m40s**,
  forge-desktop **26m28s**, Forge Guardian **10m53s**.
* **"Two jobs are 99 of ~161 job-minutes."** Very nearly: 53.0 + 47.7 = **100.6**
  job-minutes, but of **168.7**, not 161 — the 17 check-runs on this SHA sum to
  168.7 min. So the two jobs are 59.7% of the pool rather than 62%. The conclusion
  is unaffected.
* **The main hypothesis — "uncached, single-threaded recompilation inside mutation
  proofs".** Correct, and it is the largest line in both jobs: 87.3% of the ui job
  and 34.4% of the kernel job. Both halves of the phrase are literally true: one
  `clang++` invocation naming 47-51 units compiles them serially, and no two builds
  shared a single object because the mutation index was baked into `-I` and `-D`.
* **The file boundaries.** `.github/workflows/kernel-tests.yml` was read and not
  edited. `forge-kernel/src/native/**` and `forge-kernel/src/native/linalg/**` were
  read and not edited. Nothing outside `ui/test/`, `forge-desktop/test/`,
  `tools/gates/` and `reports/` was written.
* **"There is no `timeout` command"** — correct, and every gate here already carries
  its own `run_with_timeout`.
* **`${PIPESTATUS[0]}` is empty in zsh** — correct; every verdict in this report was
  read from a gate's own RED/GREEN text or from an explicit `rc=$?` in bash.

### Claims in the briefing that were WRONG

1. **"the product itself compiles in about 2 minutes".** No artefact in either job
   compiles the product in 2 minutes, and the nearest things to it are both slower:
   `Configure + build native kernel (.node)` is **178 s** and `Build
   forge_kernel_core` is **119 s** — and neither is the desktop application, which
   the `desktop` job takes 26m28s to build and gate. The claim is roughly right in
   *spirit* (a full 47-unit gate build is ~86 s on the runner, so a mutation sweep
   costs 14x a single build) but the literal figure is not in the tree.
2. **"a gate that mutates a source, rebuilds, runs, restores, rebuilds, for each of
   N mutations".** There is no restore-and-rebuild cycle anywhere here. Every one of
   these gates mutates a **copy** of the tree and never writes to the checkout — the
   prose, panel-ratchet, model-tree and isolation gates all `cp -R` first. (The one
   gate that does mutate the real tree, `run_op_constraint_gate.sh`, mutates a
   generated *header*, checks the restore with `cmp`, and builds afterwards.) So the
   cost was N full builds, not 2N.
3. **"the other 13 jobs: <= 6 each".** Two of the thirteen exceed it —
   RESOURCE_RESILIENCE at **6m57s** and the native C++ kernel gate at **6m26s**.
   Immaterial to the conclusion, but it is not true as written.
4. **The framing "99 of ~161 job-minutes" measures the wrong thing for "five PRs
   queued".** Both numbers are worth having and they are different:
   * **runner-pool pressure** (what a queue actually consumes) is the **sum**:
     168.7 job-minutes, going to ~117 after this change (-31%);
   * **time to a verdict on one PR** is the **wall clock**: the 17 jobs run
     concurrently, so the workflow takes `23:02:26 -> 00:01:37` = **59.2 min**, and
     the critical path is the kernel job alone — which does not even start until
     23:08:38, six minutes after the rest, because a `macos-latest` runner has to
     become free. Neither job `needs:` the other.

   The consequence matters: **cutting the ui job alone would have moved the wall
   clock by zero.** It is entirely inside the kernel job's shadow. That is why this
   change had to move both, and why the binding number afterwards is the kernel
   job's projected ~37.7 min (+ its ~6 min queue wait) rather than anything about
   the ui job.
5. **"the time is somewhere else entirely" was partly true for the kernel job.**
   After the crash-isolation step (34.4%), the next three lines are 376 s of
   cross-script repeated compiles, 261 s of OCCT **runtime**, and 153 s of solver
   runtime. A reader who applied the hypothesis to the whole kernel job would have
   gone looking for mutation proofs in steps that have none.

### Wrong turns I took

1. **My first epoch design would have made the cache useless, and I nearly shipped
   it.** The cache key includes a hash of every file under each in-tree `-I`
   directory. A source directory is usually *also* an include root
   (`forge-desktop/src`, `ui/test`), so mutating one `.cpp` moved the epoch and
   invalidated all fifty objects. It would have been *correct* and bought nothing,
   and I would have reported a speedup that was entirely parallelism while claiming
   caching. Caught by reasoning through the isolation gate's flag list before
   running it; fixed by excluding translation units from the epoch and **checking**
   the premise that makes that sound (no TU `#include`s another) on every call.
2. **I introduced a trap-clobbering bug in `run_syntax_gate.sh` and had to find it
   by reading, not by running.** My parallel type-check installed `trap syn_cleanup
   EXIT`, which silently **replaced** the existing `trap cleanup EXIT` — so the
   mutation scratch tree would have leaked on every mutated run, and nothing would
   have said so. The gate would have stayed green. Fixed by extending the one
   existing `cleanup()` instead of adding a second trap.
3. **I used `git checkout --` to undo a bad edit to this report**, which is the exact
   thing the program's own lesson says not to do (`undo-a-mutation-from-a-backup`).
   It happened to be safe because the file was staged at a known-good revision, but
   it was luck, not method. The sabotage experiment in section 7 was undone the right
   way: a `cp` from a backup, then `cmp -s` to prove the restore.
4. **I lost content to an unquoted heredoc.** `python3 - <<PY` let zsh expand `$`,
   backticks and `[...]` inside a 60-line report fragment; the script "succeeded" and
   wrote corrupted text. This is the program's own
   `backticks-in-a-shell-string-eat-your-content` lesson, hit again, in the same
   session in which I read it. Fixed by writing the generator to a file and running
   it.
5. **I assumed the runner core count instead of measuring it, twice.** The ubuntu
   figure turned out to be printed in the job's own log (`[ui] ... JOBS=4`) — I
   should have looked there first. The macOS figure I still do not have, which is
   why the click-gate projection in section 5 is given as a floor with its assumption
   named, rather than as a number.
6. **I shipped a macOS-only `sed -i ''` into a script that runs on ubuntu, and CI
   caught it before I did.** The new cache selftest is wired into
   `run_ui_contract_test.sh`, which runs in the **ubuntu** `ui` job, and I wrote its
   five mutations in the BSD spelling that every macOS-only gate around it uses. GNU
   sed reads the `''` as the script and the expression as a filename: the file would
   not have been edited, and every case would have reported "THE MUTATION DID NOT
   REACH THE BINARY" — a red gate blaming the cache for a defect in the test. It
   fails loud rather than silently, which is the right direction, but I wrote it
   because I had been reading macOS-only gates for an hour and stopped noticing which
   runner each script lands on. Replaced with a portable `subst()`.
7. **My local *after* arm ran at `JOBS=2`, not the runner's 4.** Guardian held ORANGE
   with `build_jobs_max: 2` for the whole session. I did not override it, so the
   local measurements understate the parallel component and the projections are
   conservative — but it does mean the local arms are **not** a like-for-like model
   of the runner, and I have said so everywhere the numbers appear rather than
   quietly scaling them.
