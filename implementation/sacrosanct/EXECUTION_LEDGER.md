# Sacrosanct execution ledger

Append-only. One entry per loop iteration. Records what was selected, what was actually run, what
it printed, what was attacked, and what the commit was. Status words follow `00_BASELINE.md` §10.

---

## Iteration 1 — 2026-08-28 00:35–01:10 · Wave 0

**Mode.** Lead session as Program Commander (Persona A). 8 parallel read-only auditors + 1
reconciler via one Workflow run (9 agents, 917k subagent tokens, 0 errors, 868s wall).
Health monitor armed for the whole iteration.

**Precondition.** Branch `k6-occtzero` @ `3589f26a`, working tree dirty: 37 modified + 48 untracked
files under `forge-kernel/`. Integration branch created **in place** so nothing moved.

### Selected and completed

| # | Task | Result | Commit |
| --- | --- | --- | --- |
| 1 | Remove Electron/Actions workflows (user request) | done | `50c512e4` |
| 2 | Commit Sacrosanct 3.1 as normative | done | `6b7b5aa8` |
| 3 | Define 9 execution personas as agent teams | done | `b3703dcc` |
| 4 | 8-way forensic baseline audit | done | `2f2718fe` |
| 5 | **Rebuild `forge-kernel.node` — unblock every gate** | **done** | (artifact, untracked) |
| 6 | Run physics gates | 16/16 rigor PASS; NAFEMS PARTIAL; CFD/EM running | this entry |

### Commands actually run, and what they printed

```
npm run forge:kernel                       -> EXIT_CODE=0, [100%] Built target forge_kernel
ls -la build/Release/forge-kernel.node     -> 8,926,736 bytes
otool -L … | grep -c libTK                 -> 8
node -e "require(...); Object.keys(f)"     -> 341 exported symbols
node forge-kernel/test/smoke.js            -> [smoke] ALL PASS, exit 0
node forge-kernel/test/physics_validation_harness.mjs
                                           -> === ALL RIGOR GATES PASS ===, exit 0
node forge-kernel/test/fea_nafems_gate.mjs -> exit 0, but "hardFail=false" (see attack below)
git ls-files '*.ts' | wc -l                -> 0
git worktree list -> 28 lines; verified on disk -> 2 exist, 26 phantom
git grep -i searxng -- (product code)      -> 0 matches
```

### Adversarial review — what I tried to falsify

| Claim | Attack | Outcome |
| --- | --- | --- |
| "124 `.ts` files → TypeScript to delete" | opened one; checked `git ls-files '*.ts'` | **REFUTED.** 0 tracked. They are CMake `compiler_depend.ts` stubs. Deleting `*.ts` would have hit build metadata and no product code. |
| "`FORGE_CPP_MIGRATION.md` rejects Qt" (summary) | read the document | **CONFIRMED and sharpened.** Headed "NOT Qt", 4 grounds. It also names its own flip condition — accessibility/printing/i18n — which is verbatim what §19.2 selects Qt *for*. They converge on capability; only **licensing** fails to resolve. |
| "27 worktrees" | tested every path with `-d` | **CORRECTED.** 28 listed, **2 exist, 26 phantom**. |
| "NAFEMS gate passes" | read the source, not the exit code | **REFUTED as PROVED.** `process.exitCode = hardFail ? 1 : 0`, and failing NAFEMS sub-cases never call `note()`, so a missed target cannot turn it red. Reclassified **PARTIAL**. |
| "otool 8 vs auditor's 10 — contradiction" | measured the freshly linked default build | **BOTH CORRECT.** default = 8 direct; `build-relational` = 10 (two feature flags add TKBO+TKG2d); closure = 14. Only closure is comparable. |

### Status changes

| Requirement | Was | Now | Evidence |
| --- | --- | --- | --- |
| §13 G5 physics rigor suite | UNPROVED | **PROVED** | 16/16, `ALL RIGOR GATES PASS`, exit 0 |
| §13 G5 NAFEMS correlation | UNPROVED | **PARTIAL** | patch test + thermoelastic exact to machine precision; curved-boundary σ targets missed |
| kernel binding buildable | UNPROVED | **PROVED** | exit 0, 341 symbols, smoke ALL PASS |
| OCCT direct link count | CONTRADICTED | **PROVED = 8** (default build) | `otool -L` on the fresh artifact |
| §3.2 TypeScript inventory | assumed 124 | **PROVED = 0** | `git ls-files '*.ts'` |
| §12 SearXNG client | — | **UNPROVED (absent)** | 0 matches in product code |
| §10.6 dependency plane | — | **UNPROVED (absent)** | no `deps.lock.json`, no presets, OCCT from global brew |

### Newly unblocked

Rebuilding the binding unblocks every `.mjs` kernel and physics gate, the 445-function
`window.forge` surface census needed for the zero-JS manifest, and any A/B measurement against
`forge::native`.

### Blocker discovered

**`forge-kernel/CMakeLists.txt` hard-fails without `node-addon-api`** — `FATAL_ERROR "node-addon-api
not found … Run npm install at repo root."` The C++ kernel therefore **cannot compile without Node
installed**, and 19,674 tracked lines of C++ across 5 files are N-API glue (`binding.cpp` alone is
**17,927 lines** — the largest tracked C++ file in the repo). This is the deepest zero-JS coupling
and it is in the C++ layer, not the JS layer. §3.2 cannot complete until the kernel has a non-N-API
entry point.

### Carried forward

- CFD/EM gates still executing — **not claimed** until they report.
- D-001 (Qt vs Dear ImGui) escalated to the user; blocks UI work.

---

## Iteration 2 — 2026-08-28 01:30–02:05 · Wave 1 integration

**Mode.** 9-track parallel fanout in isolated worktrees. 5 DELIVERED, 1 agent died, 3 carried over.

### Integrated

| Track | Commit | What |
| --- | --- | --- |
| F1 | `3deae91c` | Appendix B s0 tests — pass=6 fail=14, the failures ARE the deliverable |
| Z1 | `32e480da` | `FORGE_BUILD_NODE_ADDON` — the C++ kernel compiles with Node absent |
| S1 | `79412f40` | SearXNG C++ client, default-deny redaction, 129 tests × 2 phases |
| G1 | `d10a6148` | `deps.lock.json`, `CMakePresets.json`, `ForgeDeps.cmake` |
| — | `bc30a25b` | **fix:** `forge_all` depended on the target `NODE_ADDON=OFF` removes |

### Verified by running, not by reading

```
bash retrieval/run_retrieval_tests.sh
  -> 129 passed, 0 failed            (phase 1, fixtures)
  -> interposer aborts a real socket()
  -> 129 passed, 0 failed            (phase 2, NETWORK DENIED)   GATE PASSED exit 0

cmake -S forge-kernel -B /tmp/forge_fixed -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build /tmp/forge_fixed --target forge_all -j4
  -> [100%] Built target forge_all
  -> forge_all aggregates: forge_kernel_core;forge_foundation_probe;forge_verify;
                           forge_mesh_probe;forge_step_probe;forge_feature_probe
  -> grep -ril 'node-addon-api|napi' over generated build system = 0
```

### Defect I found in the delivered work

`forge_all` seeded `_forge_all_targets` with `forge_kernel` **unconditionally**, then appended
everything else conditionally. With the addon OFF that target is never created, so the §21.2
documented command failed:

```
make[3]: *** No rule to make target `forge_kernel', needed by `CMakeFiles/forge_all'.  Stop.
```

Configure had reported success and even printed `forge_all aggregates: forge_kernel;…` naming a
target it had not created — `add_custom_target(DEPENDS …)` treats an unknown name as a file
dependency, so nothing failed until the build. **Found by building the target rather than trusting
configure.** Fixed at `bc30a25b`; `forge_all` now builds clean with Node absent.

### Defect I found in my own merge

Restoring the parked in-flight `CMakeLists.txt` after merging G1 silently reverted G1's changes in
the working tree — committed but absent where a build would read them. Caught because the in-flight
delta moved from `578/11` to `591/**76**`; those 65 extra deletions were G1's lines. Reapplied from
the merge commit. Delta back to `578/11`, 37 modified, 0 conflict markers.

### Storage

`reap_worktrees.sh --apply` ×3: 26 phantom records pruned (`.git/worktrees` 19,876→2,564 KB), then
4 finished worktrees removed (~1.46 GiB). `align-op` refused every time — its HEAD is not an
ancestor of any other ref, so removing it would strand commits.

### Status changes

| Requirement | Was | Now |
| --- | --- | --- |
| §3.2 kernel compiles without Node | CONTRADICTED | **PROVED** |
| §21.2 `forge_all` in no-Node config | — | **PROVED** (after fixing) |
| §12 SearXNG client | UNPROVED (absent) | **PROVED** — 129 tests, network-denied phase |
| §12.4 fail-closed offline | UNPROVED | **PROVED** — full gate re-runs under denial |
| §10.6 dependency plane | UNPROVED (absent) | **PARTIAL** — 8 deps pinned by version, hashes null |
| §0.4/§0.5 parser conformance | assumed OK | **CONTRADICTED** — 14 real failures |
| §17.3 contamination firewall | assumed enforced | **CONTRADICTED** — 878 heldout_B rows pass |

### Carried into Wave 2
MFIX (scorer defect → re-score → resume training), SIM (SR-4 real-time motion animation), GUI
(make ImGui shell compile+run), KRN (OCCT drop with real measurement), APPB (fix the s0 parser
gaps), CONTAM (close the §17.3 hole).

---

## Iteration 3 — 2026-08-28 02:30–07:30 · waves 2+3 integrated, PR opened

**Integrated:** 12 tracks across two waves. Branch at **46 commits**, pushed, **PR #61** open
against `archdisc` for CodeRabbit review.

### Verified at HEAD in a clean detached worktree (not the working tree, which diverges)

```
bash ui/test/run_ui.sh                      -> ALL 6 UI GATES PASS, 2,421 checks
bash retrieval/run_retrieval_tests.sh       -> 129 passed x2 (phase 2 network-denied), GATE PASSED
bash forge-kernel/test/ft/s0_ratchet.sh     -> pass=42 fail=5, baseline=5, GREEN, exit 0
bash tools/deps/tests/offline_build_test.sh -> 14 passed / 0 failed, network kernel-denied
```

### Four tracks reported DELIVERED while leaving everything UNCOMMITTED

SHELL, TKOFF, OFFLINE and ARCHIE all returned success with their work sitting dirty in their
worktrees. The reaper refuses dirty trees so nothing was at risk of automated deletion, but
uncommitted work on one machine is not preserved work. Committed on their behalf by explicit path,
never `git add -A`. **Added to the wave-4 brief: COMMIT YOUR WORK BEFORE RETURNING.**

### The s0 ratchet, and what it measured

A permanently-red gate teaches people to ignore it, so CI now ratchets against a committed baseline:
red if failures rise, red if they fall (lower the baseline in the same commit), green at the known
count. It immediately quantified the reconciliation debt:

| | pass | fail | verdict |
| --- | ---: | ---: | --- |
| HEAD | 42 | 5 | GREEN |
| working tree | 33 | 14 | RED |

**Nine s0 conformance laws hold at HEAD and do not hold in the working tree.**

### My own errors this iteration

1. **Wired two OCCT-dependent gates onto bare `ubuntu-latest`.** Both went red on a PR that is green
   locally. Chasing it found a real portability bug: `build_s0_acceptance.sh` hardcoded
   `/opt/homebrew/include/opencascade` and printed that macOS path in a Linux failure. Now searches
   standard prefixes, as the simulation script already did correctly.
2. **Read `$?` after a pipeline** and reported the ratchet exiting 0 when it exited 1 — `$?` was
   `tail`'s status. Same class as counting your own grep.
3. **Overclaimed forge::ui.** I reported "2,421 checks" as a headline; the ZEROJS track showed
   2,053 of them (84.8%) are one synthetic virtualization gate and the registry ships **zero**
   product commands, so those checks map to zero shipped JS behavior.

### Corrections to earlier findings

- The "scorer failed to measure the reference" defect **does not exist**. M2 read ABSENT keys as
  NULL values; across all six arms `absent == build_failed + refused` exactly and present-but-null
  is zero. `score()` short-circuits on a candidate that produced no solid.
- The real cause, reached independently by M1 and MFIX: the expert LoRA was **never loaded** (config
  listed 0 of 72 switch keys), so the model emitted out-of-vocabulary ops and 35/36 tasks failed to
  build. A five-op rename recovers **85%** of the gap.
- The cmake `file(DOWNLOAD)` crash was a **deliberate negative control**, not a §10.6 violation.
- `DYLD_INSERT_LIBRARIES` alone would have produced a **false offline pass** — SIP strips it when
  exec'ing a protected binary and Make shells out through `/bin/sh`. Measured: rc=0 under the
  interposer via `/bin/sh`, rc=134 direct. The gate now also uses kernel-enforced `sandbox-exec`.

### Still UNPROVED
OCCT closure unchanged at 14 · NAFEMS PARTIAL (gate cannot fail) · zero JS files removed (all eight
candidates failed the §3.2 bar) · 7 of 8 deps hashes null · 7 files of reconciliation debt.

---

## 2026-08-28 — the C++ desktop app LAUNCHES and draws a kernel body

Not a scaffold check: built from a clean detached worktree at `ec476221` and run.

```
cmake -S forge-kernel -B <KB> -DCMAKE_BUILD_TYPE=Release \
      -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build <KB> -j10 --target forge_kernel_core          # -> libforge_kernel_core.dylib
cmake -S forge-desktop -B <AB> -DCMAKE_BUILD_TYPE=Release -DFORGE_KERNEL_BUILD_DIR=<KB>
cmake --build <AB> -j10 --target forge_desktop              # -> 1,453,824-byte binary
<AB>/run_forge.sh --frames 3 --screenshot shot.png
```

Measured output of the live run:

```
[forge] kernel body: 240 triangles, 10 faces  [forge-kernel (BOX -> CUT -> FILLET)]
[forge] GPU: Apple M4 Max (Vulkan 1.2 via MoltenVK)
[forge] swapchain 1680x1000, 2 images, format 44
[forge] registry: 31 commands (18 of them Part), 6 categories
[forge] first frame presented: 6850 vertices / 13719 indices of UI draw data, 240 viewport triangles
[forge] screenshot of the LIVE window -> shot.png (1680x1000)
```

Headless gate `forge_desktop_frame_gate`: **105 checks, 0 failures** — 240 triangles / 10 faces /
3 features from forge-kernel, 5310 vtx across 16 draw lists, 4 panels, a 14-row feature tree with
virtualization (14 materialized, peak 14, 14 fetches). No window, no swapchain, no MoltenVK.

The screenshot shows a real workstation shell: workspace ribbon (Part / Sketch / Assembly /
Surface / Manufacturing / Drawing / Simulation / Archie), the feature tree
`Bracket.fpart -> Plate 80x50x20 -> Through Bore d12 -> Corner Fillet r3 -> Face 1..10`, a shaded
viewport with the filleted, bored plate, a view cube, docked Mates/Interference/Properties and
BOM/Console panels, and a status bar carrying the input profile.

**Stated honestly:** the shell, docking, keymap persistence, command registry and viewport are
real; several panels render an explicit placeholder — *"content is not implemented in this
segment"*. The app is launchable and draws real kernel geometry; it is not yet feature-complete.

**Also found:** the in-flight working tree does NOT compile. `forge-kernel/src/Features.cpp` calls
`::forge::occtoffset::thickenShell(src, offset, tol, &why)` in two places — wrong namespace
(`occtthicken`) and a fourth argument the 3-parameter declaration does not take. HEAD is correct.
Recorded, not fixed: that file is in-flight and not mine to edit.


---

## 2026-08-28 — RELEASES: already done, and the draft had gone false by standing still

**The task as I had been carrying it was wrong.** My own loop prompt said "retire the 200 Electron
releases". Measured: `satvikOS/Forge` has **one** release (a draft, no assets) and **zero** tags.
The retirement was already performed in an earlier cycle -- **871** releases and tags, not 200 --
with `RELEASES_RETIRED.md` (1,077 lines) and `RELEASES_RETIRED_assets.tsv` (12,173 asset rows,
871 distinct releases) committed BEFORE the deletion, exactly as the manifest-first rule requires.

The 200-ish figure belongs to **other repositories**: `satvikOS/Studio` (838 releases) and
`satvikOS/humanovo` (186). Those are separate products. They are **out of scope** for this branch
and nothing here touches them -- acting on 838 releases in an unrelated repo on the strength of a
premise already proved wrong would be reckless.

**What was actually actionable.** The draft's notes had become materially FALSE by standing still,
the same failure as a claims register drifting behind its code. They stated:

> **No runnable application.** There is no application entry point ... first-party code contains no
> window-creation call (`glfwCreateWindow`, `SDL_CreateWindow`, `vkCreateSwapchain`,
> `CreateWindowEx`) anywhere ... **You cannot launch it, open a window, or interact with it.**

Measured at HEAD, all of that is now wrong: `SDL_CreateWindow` is called from first-party code at
`forge-desktop/src/main.cpp:359`, there is an application `main()` there, and the app was built and
run (1680x1000 swapchain, 240 triangles of real kernel geometry, 31 commands). The swapchain
itself is created by the vendored ImGui Vulkan helper driven from that first-party code -- stated
precisely rather than claimed as first-party.

**Corrected, still a draft.** The notes now describe what launches and what does not, keep the
retirement record and the version rationale, and carry the correction openly ("Both statements were
true when written and are now false"). The publish bar is restated: the old one -- *until an
application that actually launches exists* -- has been met, so the remaining bar is **a packaged,
signed binary a user can download and run without a toolchain**. No packaging, signing,
notarization or auto-update channel exists, and several panels still render a placeholder, so it
stays a draft and no binary is attached.


---

## 2026-08-28 session close-out: what is PROVEN, what is MEASURED, what is BLOCKED

### Proven and gated (each red-by-mutation with the failure count predicted)

| area | result | gate |
| --- | --- | --- |
| NAFEMS ratchet | a BLOCKED case is judged on its own axis before accuracy; one baseline is green in both the CI and workstation shapes | selftest 11 -> 18 cases |
| forge_verify | a malformed record no longer kills the batch (exit 134, 2/6 -> exit 0, 6/6) | new batch gate, red 3 ways (PR #62) |
| IR pipeline | a forge::ui program parses and compiles to an asserted SOLID, entirely in C++ | 18 checks, wired into CI |
| UI command layer | a handler that ran and refused no longer reports Ok (`EditRefused`) | CONTRACT 6, 51 -> 60 checks |
| retrieval redaction | the value scan is no longer evadable by `.5`, `47,625`, `4.7e1` | 174 -> 178, red 3/3 |
| retrieval transport | chunked decoder cannot be walked off the end; a truncated body is no longer reported complete; header CRLF injection refused; allow-list matches the connect path | 178 -> 189, red 6 and 2 as predicted |
| simulation | evidence a reader can confirm (5.05e-09, not "0.000000") | 187 checks unchanged |
| app surface | the 31 user-reachable commands are pinned; 20 carry a feature-IR op | drift gate, red 3 ways |
| desktop app | Measure and Archie Tools panels implemented; Measure computes real geometry (area 13405.325 mm2, volume 77278.139 mm3, watertight) | frame gate 105 -> 132 |
| contamination | R9 blocks an eval row the model was TRAINED on -- the mirror of R8, which nothing asked before | guard 70 -> 73 |
| eval set | 600 clean rows built, R9-verified 0/600, registered ACTIVE | three independent checks agreed |

### Measured, and the measurement is the finding

* **The holdout could not answer its own question.** At n=25 the paired 95% CI is about +-0.12 while every effect is under 0.07; 80% power at the observed v5cap-vs-floor effect needs **n=625**. Underpowered by ~24x. No adapter result at that n was a win or a loss.
* **v5cap undoes the v4a collapse** (paired 0.3576 vs v4a 0.2904, floor 0.3270, v1 0.3555) but does not beat v1 (+0.0020). With the LoRA confirmed loaded, that recovery is real and the non-difference is real.
* **Non-termination is bimodal**: median 19 ops against v1's 21, but 19% run away to 63-379 ops producing as few as 3 distinct shapes.
* **NoveltyStop is score-neutral BY MEASUREMENT** -- 31 of 32 rows identical, the one that moved went UP -- and 43.1% cheaper with the median untouched. It now defaults ON, and its docstring cites the numbers instead of asserting neutrality.
* **The NAFEMS gaps are a frozen mesh boundary.** `FeaTet.cpp:855` captures `ntri = triangles.size()` before the densification loop and `tryAdd` never appends to `triangles`, so boundary refinement is a single non-recursive pass. That is why error does not shrink under h-refinement (p=-0.057, -0.181). Confirmed in the source, not inferred.
* **Two pins by design, not one that drifted.** 24 of 24 provenance-bearing baselines assert 45e9ad9a; `tools/pinned` measures current capability. The default was the non-comparable instrument and said nothing -- it now warns, only in the silent case.
* **Storage: 47 -> 157 GiB free** (90% -> 65%), 105 worktrees and build dirs removed, ~40 kept for dirty or unpushed state, 3 branches pushed before removal so nothing was stranded.

### Blocked, and by what

* **NAFEMS fix** -- `FeaTet.cpp` is one of the 37 user-owned in-flight files (D-008).
* **TKOffset family H / CLOSURE 14 -> 13 by default** -- the native quadric offset's vertex re-meet is wrong (cylinder |dCOM|=4.00 with an exact bbox; sphere exact COM with a wrong bbox), and the fix is in kernel sources.
* **29 of 50 desktop panels** -- each waits on an absent subsystem (sketch solver, mates, BOM), not on effort.
* **PR #62** -- green, unmergeable until the in-flight `forge_verify.cpp` is resolved. Their diff does not overlap.

### Later on 2026-08-28: the 600-row eval was not one command away

Pre-flight on the scoring path, run while the emission was still generating, because
every one of these would have surfaced only after the 7-hour run finished.

* **The trace is sound.** All rows carry a non-empty `history[0].ir`, ids unique, no
  missing history -- checked, not assumed (the v4a trace caveat does not apply).
* **The scorer is honest about failures.** A candidate that produces no solid scores
  `composite 0.0` and STAYS in the mean; only instrument failures (timeout, verifier
  died) are refused and dropped. At a 20% compile rate that distinction is the whole
  number, so it was read in the source rather than trusted.
* **`prep_composite_anchor.py` could not see the new holdout at all** -- the task list
  was a module constant pinned to the 36-row file. All 600 prompts match a gold tree in
  the SAME gold sources (600/600 by exact prompt hash), so only the constant needed to
  become an argument. Default verified unchanged.
* **The prep step must carry `FORGE_PINNED_DIR` too.** It spawns CensusVerifier, which
  resolves the pin; run without it the references are built by `tools/pinned` (947b8644)
  while `composite_score` stamps and gates 45e9ad9a. On a 12-row slice the two binaries
  agreed exactly (0/12 differ), so no past number is implicated -- but references and
  scores must not come from different instruments, and now cannot.
* **A paired v1 comparison at n=600 is NOT available.** v1's emissions exist for 36 rows,
  of which **15** overlap the 600. Comparing v5cap against v1 on this set requires a
  second full emission run; comparing on the overlap would be weaker than the n=25 result
  already in hand. The box floor, by contrast, needs no model and is being built here.
* **The floor generator could not run on a text corpus.** `basename(None)` raised before
  the first row was written whenever `image` was null, so the bounding-box floor had never
  been measurable on the text holdouts; and this corpus's VERIFY line carries only
  `bbox.z=`, not the 6-tuple the regex needs, so the dimensions now come explicitly from
  the holdout's own kernel-measured `gt.bbox`.

### Compile rate does not fall with target complexity (2026-08-28)

Checked because the resumed emission's compile rate looked low (15.3% against 26%
over the first 415), and the resume is the first run under the patched verifier --
so the question was whether the patch had perturbed anything.

It had not. The two runs overlap in exactly one difficulty band, and there the
difference is inside the noise:

    gold_ops 20-25 : original 23.5% (n= 34)   resume 15.0% (n=120)
                     gap 8.5 points against a 95% interval of +-15.7

The apparent drop is a COMPOSITION effect: the resume is entirely inside the band
that was already the original's weakest, because the file is sorted hardest-first
and the resume is its tail.

The incidental result is the more useful one. Across the original 415, compile rate
by band is:

    ops 20-25  23.5%      ops 30-35  24.1%
    ops 25-30  28.5%      ops 35+    30.2%

**Flat, if anything rising.** Target complexity does not predict whether the model's
tree compiles. That is a sixth structural predictor measured flat or backwards, and
it points the same way as the kernel wedges: the two rows that defeated the verifier
were 53 and 11 ops, both small.

### The v5cap 600-row arm is complete (2026-08-28 22:55)

    valid (first run)   415 rows
    resume (patched)    185 rows      RESUME_RC=0 after 7500 s
    combined            600 rows, 600 unique ids, covers the holdout exactly,
                        0 duplicates, 0 empty IRs, compiled 147 (24.5%)

The resume survived 3 kernel wedges and 1 real SIGSEGV through the timeout+respawn
fix; without it the run would have ended at row 415 -- which, because the file is
sorted hardest-first, would have been a biased HARD subset rather than a short one.

**The v1 arm started and its adapter was checked, not assumed.** Its load line reads
`config declares 0 switch key(s); the loaded model holds 0 LoRASwitchLinear
module(s) (240 LoRA modules total)`, against v5cap's `36 / 36 (276 total)`. Zero
against zero is CONSISTENT: `adapters/archie-30b-expert3d-v1/adapter_config.json`
has no `expert_lora` key at all, so v1 is a plain LoRA and 240 modules did load.
The v4a collapse was the different shape -- 36 DECLARED against 0 loaded. The guard
separates the two correctly, and "0 switch keys" on v1 is not an alarm.

### The box floor, and the true paired n (2026-08-29)

Three of five round-robin box shards complete -- a stratified sample of the 600, not
a prefix, so this is a legitimate interim:

    BOX FLOOR, n=359 : composite 0.2350
                       shape 0.4185   interface 0.0000   topology 0.3381

    (n=240, two shards, was 0.2369 -- stable as the third landed)

**Refusals: exactly one in 360, or 0.28%**, projecting a paired **n of about 598**
out of 600. `vacuous=0` and `reference_null=0` across all three shards.

The one refusal is `ho625`, and it reports

    instrument failure, not a score: verifier timeout after 300s

which refines the earlier diagnosis. Its gold reference is an invalid solid ("not
consistently oriented"), and that reference measures fine in 11 s under a plain
census -- what it defeats is the grid-64 voxel IoU, which never returns. So the
invalid reference does not fail loudly at build time; it fails five minutes later,
inside the metric.

Two things are working exactly as designed, and both were read in the source before
being trusted:

* the scorer classifies this as an INSTRUMENT failure and REFUSES the row rather
  than scoring it 0, so a reference the kernel cannot measure is never charged to
  the model;
* the failure is a property of the REFERENCE, so it drops from every arm alike and
  `compare_arms_paired.py` pairs on the intersection. It costs n; it does not bias.

Stating it up front, as the plan required: the paired comparison will be over
roughly 598 rows, and the ~2 lost rows are lost identically for box, v5cap and v1.

### Load shed on measured criteria, and the two counting traps it exposed (2026-08-29 04:25)

An OOM tripwire at 03:22 was NOT acted on: free% held flat at 36% and pageouts moved
+35 in 30 s, so the swap figure alone was macOS growing its file. A second tripwire at
04:20 WAS acted on, because both pre-set criteria were met and sustained:

    free%     15-16% across three samples   (below the ~30 threshold)
    pageouts  ~245/min                      (up from 55-70/min: accelerating)

Cheapest-first shedding: stop `score_queue.sh` (a scheduler only -- its running
children reparent to init and CONTINUE, so no work in flight is lost), then kill the
single scorer at 3/120 rows rather than either of the two near completion. Total cost
two rows. `v5cap_SHARD1_RC=143` recorded the SIGTERM honestly in the progress log.

Recovery: swap 37.5 G -> 4.6 G, free% -> 35%, disk 143 -> 146 GiB.

**What actually caused it, which changes the operating rule.** The emission's verifier
was tiny at the time (0.02 GB, freshly respawned). The pressure came from a SCORER
child reaching 2.2 GB on one heavy row. Three scorers had run for hours without
trouble, so the level of concurrency was not the problem -- a single expensive row
was. The rule is therefore not "never run three" but "three is fine; watch free%".

**Two counting traps, both already in the notes, both hit again:**

1. `pgrep -f 'composite_score.py --tasks'` reported THREE scorers when two were
   running. The third was the diagnostic shell executing that very pgrep -- its own
   command line contains the pattern. The replacement queue now counts
   `MacOS/Python -u scripts/composite_score.py`, which no shell wrapper matches.

2. The reason `(N)` -- zsh's null-glob qualifier -- did not work earlier is now
   known: this session's shell snapshot sets `NO_BARE_GLOB_QUAL`, which disables bare
   glob qualifiers outright. So neither the glob nor its documented escape hatch is
   available here; iterating explicit names with `[ -f "$f" ] || continue` is the
   only reliable form.

The queue was relaunched as `score_queue2.sh` with the REMAINING work only. The
original list still named box shards 3 and 4, which are done or running; relaunching
it unedited would have redone about four hours of scoring.

### Concurrency is a property of the ARM, not a global constant (2026-08-29 04:31)

An earlier entry concluded "three scorers is fine; watch free%", on the evidence that
three had run for hours without trouble. That conclusion was drawn from the wrong
sample and is corrected here.

Those three were **box** shards. A box candidate is `%1 = BOX(...)`: it measures in
under a second and its verifier child stays under 60 MB. **v5cap** candidates are full
feature trees, and their children reach **2.2-2.5 GB** on heavy rows. Three of those
beside the 30B emission drove free% to 15-18% TWICE within an hour, with the swap file
taking disk from 155 GiB down to 127 GiB.

    box shards, 3 concurrent   : stable for ~4 hours, free% 35-44
    v5cap shards, 3 concurrent : free% 15-18 within 30 minutes, twice

So the cap is now MAX=2 for the v5cap arm (`score_queue3.sh`), and the rule is that
concurrency must be chosen from what the arm actually costs to score, not from a
number that happened to work on a cheaper arm.

Cost of the correction: v5cap shard1 killed twice at 2-3 rows each. Cheap, because
"kill the least-progressed shard" keeps the loss bounded no matter how often the
judgement has to be revised.

This is the second time tonight a rule derived from a stable period had to be narrowed
once the workload changed underneath it. The first was the memory baseline itself --
"swap alone is not the signal" held until a scorer child, rather than the emission,
became the consumer.

### The memory episodes were one heavy row at a time, and self-limiting (2026-08-29 04:40)

The verification sampler caught a full cycle:

    free=15%  swap=37.5G  disk=116Gi  biggest verifier child 1.52 GB
    free=15%  swap=42.7G  disk=111Gi  biggest verifier child 1.96 GB
    free=36%  swap= 1.6G  disk=150Gi  biggest verifier child 0.04 GB
    free=36%  swap= 1.6G  disk=150Gi  biggest verifier child 0.05 GB
    free=35%  swap= 1.6G  disk=150Gi  biggest verifier child 0.05 GB

**A single heavy row's verifier child was the whole episode.** It completed,
CensusVerifier recycled the child, and swap fell 42.7 -> 1.6 G with disk returning
111 -> 150 GiB, stable across five consecutive samples.

So the pressure is self-limiting in the same way the emission's leak turned out to
be: the thing that consumes memory also ends, and the wrapper that recycles reclaims
it. Nothing was ever at risk of running the disk out -- which is why extrapolating
that trend was wrong twice.

**MAX=2 is kept anyway, as a frequency argument rather than a necessity.** With three
v5cap scorers the chance that at least one is on a heavy row at any moment is higher,
and each such moment costs a 40 GB swap excursion. Two concurrent finishes the
remaining 480 rows in about 4.1 h against v1's remaining ~3.5 h, so the cap costs
essentially nothing on the critical path. Three would save roughly 1.3 h and buy
recurring excursions; that is a bad trade when the scoring is not the bottleneck.

## THE BOX FLOOR IS COMPLETE (2026-08-29 05:06)

The first arm of the 600-row evaluation is fully scored, all five round-robin shards,
every shard exiting RC=0.

    rows presented   600
    scored           598
    refused            2  (0.33%)  ho625, ho617 -- both "verifier timeout after 300s"
    vacuous            0
    reference_null     0

    composite   0.2344      sd 0.0691   SE 0.0028   95% CI +-0.0055
    shape       0.4180
    interface   0.0000
    topology    0.3360

**The interval is the point.** At n=25 this programme's paired 95% CI was about
+-0.12 and every effect it wanted to judge was under 0.07, so nothing was decidable.
The floor is now known to **+-0.0055** -- a 22x tightening, which is what the
enlargement was for.

Convergence across the shards, each a stratified sample rather than a prefix:

    n=240 -> 0.2369    n=359 -> 0.2350    n=479 -> 0.2358    n=598 -> 0.2344

Both refusals are REFERENCE-side (ho625's gold solid is invalid; ho617 behaves the
same way) and were reproduced under light load, so they are inherent, arm-symmetric,
and cost n without biasing anything. The projected paired n of "about 598" stated
hours ago from a 0.28% refusal rate landed exactly.

Note for reporting: this 0.2344 is the floor over the WHOLE set. It is not comparable
to the 0.3086 and 0.3270 figures quoted earlier in this programme, which came from
hard strata of a file sorted hardest-first, and it is not the number to compare a
model arm against unless that arm is paired row-by-row -- the floor itself varies with
target complexity (0.23 at gold_ops 20-35, 0.3076 above 35).

### First significant v5cap-vs-v1 result: compile rate (2026-08-29 05:40, interim)

v1 is still emitting (504 of 600), so this is paired on the rows BOTH arms have
produced. The naive form was computed first and discarded, because v1's 504 rows are
a PREFIX -- the hardest 84% of a file sorted hardest-first -- while v5cap's 24.5% is
over the whole set. Comparing those two is comparing different exams.

Paired on the 504 common rows:

    v1     compiled  55/504  = 10.9%
    v5cap  compiled 122/504  = 24.2%

    discordant pairs: v5cap-only 104, v1-only 37
    McNemar chi2 = 30.9 on 1 df   (p < 0.001)
    paired difference +13.3 pp, 95% CI [+8.7, +17.9]

**v5cap produces a compiling tree more than twice as often as v1**, and the interval
is nowhere near zero. This is the first v5cap-vs-v1 comparison in this programme that
is not swamped by its own error bars -- the n=25 run could not separate them at all.

Two honest qualifications:

* **Compile rate is not the composite.** A tree that compiles can still score 0 on
  shape, and the composite is 0.4 shape + 0.4 interface + 0.2 topology. This says
  v5cap more often emits something the kernel can build; it does not yet say the
  built thing is closer to the target. The scored comparison settles that.
* **The rate itself is stratum-specific.** These 504 rows are the hard end of the
  set, so 10.9% and 24.2% are rates ON THAT STRATUM. The paired DIFFERENCE is valid
  because both arms faced identical rows; the absolute rates will move when the
  remaining, easier 96 rows land.

Worth noting the method mattered less than usual here -- v5cap scores 24.2% on the
504 and 24.5% on all 600, so the prefix bias happened to be small. That could not
have been known in advance, which is the whole argument for doing it paired.
