# JS RETIREMENT LEDGER

> ## UPDATE 2026-08-29 — **B1 IS CLOSED.** forge-kernel now has a CTest suite: **53 registered, 53 passing, 0 failing.**
>
> §6 below said the one thing that should happen next was to add CTest to
> `forge-kernel/CMakeLists.txt` and bring the existing C++ tests under it. That is done, on branch
> `kernel/ctest-suite`. **Still nothing deleted** — see the new **§7** for the suite, the measured
> results, and the short, evidence-backed list of JS files it actually unblocks (two), together with
> the larger list it does not and the reason for each.
>
> The suite's first run against this branch's base also **found a live defect**: the native thicken
> produces a solid with the right volume and the wrong faces (§7.4). That gate is withheld, not
> weakened.
>
> §0–§5 below are the prior pass and are **not** restated or re-derived here; where §7 revises one of
> their numbers it says so explicitly.

**Result of this pass: NOTHING WAS DELETED. Zero files removed, zero behaviour retired.**

This is the per-area evidence record so the next pass starts from measurement instead of from
appetite. Every number below was produced by a command run in a clean worktree on
`retire/js-safe-slice`, branched from `cde0c292` (`origin/claude/sacrosanct-execution-20260828`).
Nothing here is inherited on trust from a prior document; where a prior document is confirmed or
corrected, that is stated as such.

---

## 0. The bar a file must clear to be retired

A JS file is retirable only when **all three** clauses hold:

1. **A C++ owner exists** — some shipped native code performs the same behaviour.
2. **A C++ test asserts the same value** — not merely "a C++ test with a similar name exists".
3. **Deleting it breaks no live caller** — including callers that discover files by *glob*.

Clause 3 is the one that kills nearly everything, and clause 2 is the one that kills the survivors.

---

## 1. Headline finding — SAFE-TO-RETIRE-NOW is EMPTY (independently reproduced)

**Zero of the 1,768 tracked JS-family files clear the three-clause bar.** This pass reached that
conclusion by its own search rather than by accepting the map's, and the two agree.

### 1.1 How the search was run (not a spot check — the whole tree)

Every tracked JS file was tested for *any* name reference from *any* of the 3,566 tracked text files
(JS, JSON, HTML, MD, YAML, SH, CMake, C++, PY). 1,163 files are named by something. That leaves:

```
ORPHAN CANDIDATES (named by no tracked file): 605
  e2e                      353      frontend/src/systems       9
  forge-kernel/test        150      frontend/test              8
  frontend/src/foundation   32      frontend/src/tools         6
  frontend/src/forge-v4     19      frontend/src/ai            5
  frontend/src/kernel       18      (6 areas with 1 each)      6
```

**605 orphan candidates is not 605 retirable files, and the gap is the whole lesson.**

### 1.2 Why 605 collapses to 0

**(a) Glob discovery makes "unreferenced" a false reading — 366 files.**
`playwright.config.js` sets `testDir: './e2e'`. Playwright enumerates that directory by pattern, so
all **353** e2e "orphans" have a live caller that never names them. Likewise root `package.json`
has `forge:unit = node --test frontend/src/kernel/forge/__tests__/*.test.mjs` — a glob covering
**13** more. A name-reference search alone would have proposed deleting 366 files that are executed
today.

*(Checked and found clean: a grep for JS globs across all tracked shell scripts returns nothing — no
shell gate discovers JS by pattern. Shell scripts and `package.json` name their JS explicitly, so
those files were already caught as referenced.)*

**(b) Of the remainder, only TWO have even a name-matched C++ test — and both are false matches.**
All 605 orphans were matched against the 226 tracked C++ test files by normalised stem, with common
affixes (`test`/`smoke`/`gate`/`selftest`/`verify`) stripped. Two pairs surfaced. Both were opened
and read, and **both fail clauses 1 and 2**:

| Orphan | Name-matched C++ test | Verdict on reading both |
|---|---|---|
| `forge-kernel/test/smoke-frame.js` | `forge-desktop/test/frame_gate.cpp` | **Pure name collision.** The JS is *truss/frame FEA* — a fixed-end axial bar, asserting displacement `F*L/(E*A) = 0.05 mm`, axial force and reactions. The C++ is a *UI render frame* gate — ForgeFrame draw data, registry size, pick ray. Two different senses of the word "frame". No shared assertion whatsoever. |
| `frontend/test/sciviz/slice.test.js` | `forge-kernel/test/native/mesh/slice_test.cpp` | **Different problems that share a verb.** The JS slices a **scalar field** on a structured grid and on a hex8 FE mesh, asserting interpolated per-vertex values against `f = ax+by+cz` to `1e-10`, plus `isoContourOnSlice`. The C++ `slice()` signature takes `positions` + `Plane` only — **it has no scalar-field parameter at all** and returns closed `Contour` loops for CAM layers. The C++ cannot assert the JS's values because it never computes them. |

The `slice` pair additionally fails clause 3 from the other end: the module under test,
`frontend/src/forge-v4/sciviz/slice.js`, is **live** — `frontend/src/forge-v4/FeaResultViewer.jsx:22`
imports `buildSliceMesh` from it.

**Conclusion: no file in the repository clears the bar. Nothing was deleted, and that is the correct
outcome, not a stalled one.**

---

## 2. The two structural blockers

Everything below is blocked on one or both of these. Naming them is more useful than naming files.

### B1 — forge-kernel has NO CTest, so the JS harness is the kernel's only acceptance evidence

> **CLOSED 2026-08-29 — see §7.** The grep below is preserved as the measurement that was true when
> this section was written, and it was re-run at `a70dd1da` before the fix to confirm it still was.
> It now returns one `enable_testing()` and seven `add_test(NAME ...)` statements — three of them
> inside `foreach` loops, so the registered test count is 53, not 7.

A grep of `forge-kernel/CMakeLists.txt` for `add_test`, `enable_testing` or `include(CTest)` produces
no output and exits 1 — checked on the grep's own exit status, not a pipeline's.

Measured against that: **203 tracked C++ tests** under `forge-kernel/test`, driven by ad-hoc
`test/build_*.sh` scripts, versus **240 tracked JS test files** that CI actually executes. Until a
native harness runs the C++ tests, deleting the JS harness destroys the evidence base for every OCCT
drop already claimed. The pattern to copy already exists in-repo: `forge-desktop/CMakeLists.txt:188`
has `enable_testing()` and `:189` `add_test(NAME forge_desktop_frame_gate ...)`.

### B2 — the native app surface is 31 commands against a JS bridge of hundreds

`implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv` (generated from the live registry by
`ui/test/capability_manifest_test.cpp`) contains **31** commands: 18 Part, 3 Model, 3 File, 3 Edit,
2 View, 2 Application. *(Minor correction to the map: the split is 2 Application, not "1 workspace +
1 app"; there is no Workspace category in the file.)*

Against that, `electron/preload.js` (1,635 lines) exposes the kernel to the renderer, and
`electron/main.js` has **26** `ipcMain` references — so the bridge is not mediated by IPC and a
native replacement must reproduce the whole surface.

**The manifest's headline "445 bindings" does not reproduce, and no single number should be quoted
for it.** Measured here, a `name: (` pattern gives **560**; the map's stricter pattern gave 311/196.
The count is pattern-dependent. What is robust and sufficient for planning is the *ratio*: **hundreds
of JS bindings against 31 native commands.**

---

## 3. Per-area ledger

Status vocabulary: **KEEP** (shipped or currently-passing coverage — deleting it removes working
behaviour) · **BLOCKED** (would be retirable once a named blocker clears) · **RETIRED** (deleted;
none this pass).

| Area | Files | LOC | Status | Evidence / what unblocks it |
|---|---:|---:|---|---|
| `frontend/src/forge-v4` | 597 | 245,768 | **KEEP** | The shipped IDE. `package.json main = electron/main.js` loads it. Its native counterpart is an ImGui *probe*, not an app. Blocked on a real native IDE (B2). |
| `e2e` | 408 | 90,124 | **KEEP** | Live via `testDir: './e2e'` glob. Playwright drives a *browser*; if the IDE goes native these are **re-authored, not ported**. Blocked on a native UI-driver harness that does not exist. |
| `frontend/src/kernel` | 239 | 69,265 | **BLOCKED** | A second geometry kernel in JS — the largest correctness liability and the highest-value target. But live: `BrepBoolean`/`Tessellator` are imported by `brep/index.js`, `kernel/index.js` and directly by `forge-v4`. Needs a per-op A/B oracle (C++ == JS) before any cut. |
| `frontend/src/foundation` | 171 | 43,231 | **BLOCKED** | Engineering-domain logic. 32 files have no name reference, but **no C++ owner exists** for them, so clause 1 fails even where clause 3 holds. Deleting unreferenced-but-unreplaced logic is capability loss, not retirement. |
| `forge-kernel/test` | 240 | 35,413 | **KEEP** (238 of 240) · **2 UNBLOCKED** | The OCCT kernel's entire acceptance harness. CI executes it and the job is **green** (see §4). CI's own comment: "MUST NOT be removed by extension alone". **B1 is now closed (§7): a 53-test CTest suite runs green.** That clears the bar for exactly **two** files — `native_binding_smoke.js` and `native_engines_smoke.js` (§7.5) — and moves a further group from "sole evidence" to "partial" (§7.6). The other 238 stay **KEEP**, now blocked on the reasons in §7.7 rather than on B1. |
| `frontend/src/ai` | 34 | 9,872 | **KEEP** | `src/ai/__tests__/bridge-prompt-contract.test.mjs` is one of the three files in frontend's `guards` script. |
| `frontend/src/systems` | 20 | 6,885 | **BLOCKED** | No C++ owner mapped. |
| `electron` | 3 | 2,417 | **BLOCKED** | `main.js` is the app entry point (`package.json main`). `preload.js` is the kernel bridge. Blocked on **B2**; `pdmVault.js`'s on-disk format must additionally become C++-readable. |
| `frontend/src/tools` | 7 | 2,145 | **BLOCKED** | No C++ owner mapped. |
| `frontend/src/generators` | 6 | 2,039 | **BLOCKED** | No C++ owner mapped. |
| `projects` | 10 | 1,604 | **BLOCKED** | Sample-project data fixtures; should become declarative IR rather than be deleted. |
| `frontend/src/App.jsx` | 1 | 1,474 | **KEEP** | React app root. |
| `frontend/test` | 8 | 1,083 | **KEEP** | Includes `sciviz/slice.test.js` — the **only** coverage of a live module (§1.2). Unrun by CI, but deleting it removes the sole assertion on `slice.js`. Retire only *after* a C++ owner with a field-slicing test exists. |
| `scripts` | 2 | 1,019 | **BLOCKED** | Dev tooling; trivial tail, no leverage. |
| `frontend/src/{assets,services,utils,config,materials,contexts}` | 13 | 3,901 | **KEEP** | App-internal modules of the shipped frontend. |
| `frontend/src/__tests__` | 2 | 190 | **KEEP** | `brand-guard` + `deps-allowlist` — both named in frontend's `guards` script. |
| `frontend/verify_gdt_mate.mjs`, `tools`, `frontend/public`, configs, `main.jsx`, `playwright.config.js` | 7 | 447 | **KEEP** | Build/config entry points. `playwright.config.js` is what makes all 408 e2e specs live. |
| **TOTAL** | **1,768** | **516,877** | **0 retired** | |

---

## 4. Gate status verified during this pass

Per-job conclusions were read individually — never the run's summary bucket.

**CI, run `33269619580` at `97d265bd` (the commit immediately preceding this branch's base) — all 8
jobs `success`:** native C++ kernel gate · forge::ui workstation gates · SearXNG retrieval (incl.
network-denied phase) · simulation SR-4 · s0 conformance ratchet · NAFEMS ratchet self-test ·
ForgeCADScore self-tests · OCCT kernel smoke (TRANSITIONAL). The run at this branch's own base
`cde0c292` was still `in_progress` at the time of writing and is **not** claimed as evidence.

**Locally re-run in this clean worktree — `bash ui/test/run_ui.sh`, exit 0:**

```
[ui] ALL 11 UI GATES PASS (forge::ui - headless, no ImGui, no GPU, no display)
[feature_ir] 243 checks, 0 failures - PASS      [part_commands] 346 checks, 0 failures - PASS
[tool_catalog] 783 checks, 0 failures - PASS    [feature_tree_virtualization] 2065 checks, 0 failures
```

This **confirms the map's in-flight-desync diagnosis**. The map reported `feature_ir` RED (246
checks / 8 failures) in the *main working checkout*; at committed HEAD in a clean worktree it is
243/0 green. The redness is uncommitted `FeatureTree.hpp` work in the shared checkout desyncing from
`ui/src/FeatureIr.cpp`, not a defect in the tree — the gate reads the kernel header *as data*
precisely to catch that, and it worked. The main checkout was not touched.

---

## 5. Counts corrected, for whoever scopes the next pass

| Claim | Measured here | Note |
|---|---|---|
| Tracked JS-family files | **1,768** | `.js` + `.jsx` + `.mjs` + `.cjs`, 516,877 LOC |
| `.jsx` alone | **406** | 403 in `frontend/src/forge-v4`. **A scope that counts only `.js/.mjs/.cjs` omits the React IDE — the largest single target.** |
| Tracked TypeScript | **0** | A `git ls-files` for `*.ts`/`*.tsx` returns 0. The `.ts` files on disk are CMake `compiler_depend.ts` build residue. **Any rule scheduling `*.ts` for deletion describes a file set that does not exist.** |
| `forge-kernel` JS | **240 tracked** | A figure of 379 counts untracked build residue. |
| App surface | **31 commands** | 18 Part / 3 Model / 3 File / 3 Edit / 2 View / 2 Application. |
| "445 bindings" | **does not reproduce** | 560 by this pass's pattern, 311/196 by the map's. Quote the ratio, not the number. |

---

## 6. The one thing that should happen next

> **DONE 2026-08-29 — see §7.** Left verbatim because §7 is the answer to it and should be read
> against the question as it was asked. The one correction §7 owes this section: the prerequisite was
> real, but it was not *sufficient* — closing it retires two files, not 240. §7.6 says why.

**Add CTest to `forge-kernel/CMakeLists.txt` and bring the 203 existing C++ tests under it**, copying
the `enable_testing()` / `add_test()` pattern already working in `forge-desktop/CMakeLists.txt:188`.

That is the single highest-leverage move available, because it is the *prerequisite* for the largest
deletion in the tree: 240 JS files and 35,413 LOC of kernel harness cannot go while they are the only
acceptance evidence the OCCT kernel has. No amount of JS analysis moves that; only a native harness
does. Nothing else on this list unblocks by being looked at harder.

---

# 7. UPDATE 2026-08-29 — B1 closed: forge-kernel has a CTest suite

Branch `kernel/ctest-suite`, based on `a70dd1da` (`origin/claude/sacrosanct-execution-20260828`).
Two files changed: `forge-kernel/CMakeLists.txt` (**additive only** — 0 deletions) and this ledger.
**Nothing was deleted, and nothing here asks for a deletion.**

## 7.1 The measurement, before and after

```
$ git show a70dd1da:forge-kernel/CMakeLists.txt | grep -nE "add_test|enable_testing|include\(CTest\)"
$ echo $?
1                       # grep found nothing -- B1, confirmed still true at the branch base
```

```
$ ctest --test-dir <build> -N | tail -1
Total Tests: 53
```

## 7.2 What was added, and what was deliberately not

One additive block: `enable_testing()`, an option `FORGE_BUILD_TESTS` (default ON), 53
`add_test()` registrations, and 46 new CMake *targets* that compile **unmodified existing sources**
in `forge-kernel/test/` — with the same flags the hand-rolled shell scripts used, including the
`-Wall -Wextra -Werror` that `build_kernel_correctness_gate.sh` calls SR-3.

**No test was invented, weakened or rewritten.** Every registration points at a file that already
existed and already passed. The default build is unchanged: everything except the three shell suites
is gated behind `TARGET forge_kernel_core`, which exists only under
`-DFORGE_BUILD_DESKTOP_FOUNDATION=ON` (OFF by default), so the cmake-js / `forge-kernel.node` CI
build is byte-untouched and `forge_all` aggregates exactly what it did before.

### Not registered — with the measurement that excluded each

A test that cannot fail, or one that is red for a reason that is not the suite's business, damages a
suite more than its absence does. Every candidate `.cpp` in `forge-kernel/test/` was compiled against
`forge_kernel_core` + OCCT and RUN under a 180 s kill; only files that compiled, ran and exited 0
were registered.

| Excluded | Measurement |
|---|---|
| `native_hlr_perf.cpp`, `native_hlr_import_perf.cpp` | Both end in an unconditional `return 0;`. Timing instruments with no threshold — registering them would add **a test that cannot fail**. |
| `golden_corpus_measure.cpp` | Not a test but a CLI tool: with no argv it prints `usage: golden_corpus_measure --mode <occt\|native> --step <file.step>` and exits 2. |
| `test/ft/build_s0_acceptance.sh` | Exits **1 by design** (`TOTAL pass=42 fail=5`, and it prints *"These failures are the deliverable. Do not weaken them."*). Registered instead: `s0_ratchet.sh` — see §7.3. |
| **`ab_native_thicken_occt.cpp`** | **RED at this commit, and this suite is what found it — see §7.4.** |
| `native_vs_occt_fillet_var.cpp` | rc=1 — a **real measured disagreement**, not a harness fault: native matches its closed form to ~5e-15 rel, OCCT differs by **4.444e-05** rel, over the file's own 1e-6 threshold. Left open. |
| `native_vs_occt_iges.cpp` | rc=1 — 11/16; case C PARTIAL on a 128-entity property-flag-count divergence (native 4-flag vs OCCT 5-flag layout). |
| `native_fuse_mesh_operand_test.cpp` | rc=134 (SIGABRT). |
| `native_occt_import_test.cpp`, `native_occt_wire_activation_test.cpp` | rc=1. |

**Not one threshold was lowered and not one tolerance widened.** The red gates are named here so that
closing them stays owed rather than forgotten.

## 7.3 The suite, and its measured result

```
cmake -S forge-kernel -B <build> -DCMAKE_BUILD_TYPE=Release \
      -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build <build> -j8
ctest --test-dir <build> --output-on-failure
```

| CTest | What it asserts | Source |
|---|---|---|
| `kernel.foundation_probe`, `kernel.mesh_probe`, `kernel.step_probe`, `kernel.feature_probe` | Node-free C++ core drives box/cylinder/boolean + mass properties; tessellate→Mesh→binary-STL invariants; `exportStep`→`importStep` volume round-trip; `shell()` + `projectShape()` HLR drafting. | `forge-desktop/*_probe.cpp` — already CMake targets, never registered |
| `kernel.correctness_gate` | G1 export-failure honesty · G2 `shellMultiThickness` sign contract · G3 per-axis bore counting · G4 one weld-betti genus definition, each against a closed form or an independent second opinion. | `test/kernel_correctness_gate.cpp` |
| `kernel.capi_smoke` | The K7 opaque-handle C-API black box end to end, including error hygiene and lifecycle. It includes **only** the C header — that is the boundary proof. | `test/capi/forge_capi_smoke.cpp` |
| `kernel.ab.*` — **44 tests** | Standalone C++20 oracles: build the same case through the in-house `forge::native` engine **and** through live OCCT 7.9.3 and assert agreement, usually against a closed form as well. Several carry a negative control that rejects an equal-volume impostor on a vector of observables. | 44 files in `test/*.cpp` |
| `kernel.native_suite` | The pure-C++20 in-house kernel suite: compiles every `forge::native` source once, then builds and runs **138** tests under `test/native/<class>/`. No OCCT, no Node, no CMake. | `test/native/run_native.sh` |
| `kernel.ft_s0_ratchet` | SACROSANCT 3.1 Appendix B s0 acceptance (s0.4 graph cardinality, s0.5 opaque macros, s0.6 pattern occurrence, s0.11 chunk/hash chain) under the conformance ratchet. | `test/ft/s0_ratchet.sh` |
| `kernel.unify_coaxial_guard` | The mixed-representation coaxial-bore SIGSEGV guard: 3 crashers (rc=139 before the guard) and 6 must-not-move cases, each on a vector of observables (valid, volume, faces, edges, shells) against a closed form. Driven through this build's own `forge_verify`. | `test/unify_coaxial_guard_test.sh` |

**Why the s0 *ratchet* and not the raw s0 suite.** This is the one substitution in the table, and it
is a strengthening. `build_s0_acceptance.sh` deliberately asserts laws the implementation does not
yet satisfy, so its exit code is 1 by design and will stay 1 until those five gaps close; a
permanently-red test is how a suite gets ignored. `s0_ratchet.sh` runs the **identical, unmodified**
suite and compares its failure count with `s0_conformance_baseline.txt`
(`S0_EXPECTED_FAILURES=5`): red if conformance **regresses**, *and also* red if it **improves**
without the baseline being lowered in the same commit. That is strictly stronger than "exit 0".
Measured: `pass=42 fail=5 baseline=5 → GREEN`, with the five owed gaps printed on every run.

### Result

Measured 2026-08-29 on macOS arm64 (14 cores), OCCT 7.9.3, Unix Makefiles,
`CMAKE_BUILD_TYPE=Release`, `-DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON`,
from a **clean build directory** at branch base `a70dd1da`. The clean build compiled **473**
translation units and linked **53** targets — that run is also what measured the thicken gate of
§7.4; with that gate withheld, the committed `CMakeLists.txt` compiles 472 TUs and links **52**
targets (`grep -c "Built target"`), and all 53 registered tests were then re-run against exactly
that. No Node: this worktree has no `node_modules` anywhere
(`ls node_modules forge-kernel/node_modules` -> No such file or directory), the build log
contains zero `napi`/`node-addon` references, and `find <build> -name "*.node"` returns 0.

```
100% tests passed, 0 tests failed out of 53

Total Test time (real) = 335.75 sec
```

**Registered: 53. Passing: 53. Failing: 0.**

Full per-test output:

```
Test  #1: kernel.foundation_probe  Passed    0.03 sec
Test  #2: kernel.mesh_probe  Passed    0.04 sec
Test  #3: kernel.step_probe  Passed    0.03 sec
Test  #4: kernel.feature_probe  Passed    0.02 sec
Test  #5: kernel.correctness_gate  Passed    0.19 sec
Test  #6: kernel.capi_smoke  Passed    0.07 sec
Test  #7: kernel.ab.ab_native_draft_occt  Passed    0.08 sec
Test  #8: kernel.ab.ab_native_filling_occt  Passed    1.18 sec
Test  #9: kernel.ab.ab_native_loftpipe_occt  Passed    0.23 sec
Test #10: kernel.ab.ab_native_offsetshape_occt  Passed    0.08 sec
Test #11: kernel.ab.ab_native_sweep_occt  Passed    0.06 sec
Test #12: kernel.ab.io_stl_binary_solid_header  Passed    0.06 sec
Test #13: kernel.ab.matelib_quat_ab  Passed    0.06 sec
Test #14: kernel.ab.native_vs_occt_allbox  Passed    0.06 sec
Test #15: kernel.ab.native_vs_occt_chamfer  Passed    0.06 sec
Test #16: kernel.ab.native_vs_occt_chamfer_asym  Passed    0.06 sec
Test #17: kernel.ab.native_vs_occt_convexhull  Passed   53.28 sec
Test #18: kernel.ab.native_vs_occt_dataexchange_write  Passed    0.09 sec
Test #19: kernel.ab.native_vs_occt_draft  Passed    0.07 sec
Test #20: kernel.ab.native_vs_occt_exact_boolean  Passed    0.60 sec
Test #21: kernel.ab.native_vs_occt_fillet  Passed    0.07 sec
Test #22: kernel.ab.native_vs_occt_fillet_curved  Passed    0.07 sec
Test #23: kernel.ab.native_vs_occt_fillet_ext  Passed    0.07 sec
Test #24: kernel.ab.native_vs_occt_fuzzy_boolean  Passed    0.07 sec
Test #25: kernel.ab.native_vs_occt_gear  Passed    3.53 sec
Test #26: kernel.ab.native_vs_occt_gregory_nsided  Passed    1.97 sec
Test #27: kernel.ab.native_vs_occt_heal  Passed    0.07 sec
Test #28: kernel.ab.native_vs_occt_heal_ext  Passed    0.12 sec
Test #29: kernel.ab.native_vs_occt_helical  Passed    0.20 sec
Test #30: kernel.ab.native_vs_occt_hlr  Passed    0.07 sec
Test #31: kernel.ab.native_vs_occt_hlr_import  Passed    6.88 sec
Test #32: kernel.ab.native_vs_occt_hlr_persp  Passed    0.08 sec
Test #33: kernel.ab.native_vs_occt_import_surfaces  Passed    0.09 sec
Test #34: kernel.ab.native_vs_occt_interference  Passed    0.09 sec
Test #35: kernel.ab.native_vs_occt_loftsweep  Passed    0.07 sec
Test #36: kernel.ab.native_vs_occt_nurbs_ssi  Passed    0.20 sec
Test #37: kernel.ab.native_vs_occt_offset_shape  Passed    0.07 sec
Test #38: kernel.ab.native_vs_occt_pattern  Passed    0.24 sec
Test #39: kernel.ab.native_vs_occt_query  Passed    0.09 sec
Test #40: kernel.ab.native_vs_occt_section  Passed    0.07 sec
Test #41: kernel.ab.native_vs_occt_sew  Passed    0.06 sec
Test #42: kernel.ab.native_vs_occt_shell  Passed    0.16 sec
Test #43: kernel.ab.native_vs_occt_step_read  Passed    0.13 sec
Test #44: kernel.ab.native_vs_occt_stl  Passed    0.08 sec
Test #45: kernel.ab.native_vs_occt_surfacefill  Passed    0.12 sec
Test #46: kernel.ab.native_vs_occt_surfacefill_g2  Passed   94.50 sec
Test #47: kernel.ab.native_vs_occt_trimmed_face  Passed   16.66 sec
Test #48: kernel.ab.native_vs_occt_validator  Passed    0.07 sec
Test #49: kernel.ab.native_vs_occt_validator_ext  Passed    0.77 sec
Test #50: kernel.ab.step_read_occt_projection_gate  Passed    0.23 sec
Test #51: kernel.native_suite  Passed  148.99 sec
Test #52: kernel.ft_s0_ratchet  Passed    2.58 sec
Test #53: kernel.unify_coaxial_guard  Passed    0.94 sec
```

`kernel.native_suite` is one CTest that internally builds and runs **138** C++ tests, so the
assertion count behind these rows is far larger than the row count. `kernel.unify_coaxial_guard`
reported 9/9 cases.

### A green suite is not proof on its own — three controls

1. **It went red, for a real reason, and was not silenced.** The first full run was **8/9, with
   `kernel.ft_s0_acceptance` FAILING**. Diagnosed rather than patched: the raw s0 suite exits 1 by
   design. The *registration* was changed to the project's own ratchet — never the assertion.
2. **It caught a live regression on its first run against the current branch head.** See §7.4.
3. **Every registered test can fail.** Each gate's last `return` statement was read. The only two
   ending in an unconditional `return 0;` are the two perf instruments, excluded for exactly that
   reason. Every registered gate returns a failure-conditional expression
   (`g_fail == 0 ? 0 : 1`, `g_pass == g_total ? 0 : 1`, or equivalent).

## 7.4 FINDING — the thickened solid has the right volume and the wrong faces

The suite's first purpose was to make existing evidence citable. Its first *effect* was to find a
defect that nothing was watching.

`ab_native_thicken_occt` was measured **GREEN at `876b179a`** and is **RED at `a70dd1da`**, this
branch's base — same build type, same compiler, same OCCT 7.9.3, only the source commit differs:

```
[ab-thicken] 208 passed, 19 failed
  FAIL  case1 flat 20x10 t=2.000000 planar-face count      : got 2 want 6
  FAIL  case1 flat 20x10 t=2.000000 other-surface-type count: got 4 want 0
  FAIL  case2 L shell   t=-2.00000  cylindrical-face count  : got 0 want 1
  ...
  [case5] surface types  native plane/cyl/other = 0/0/6 ;  OCCT = 5/0/1
  [negctl] equal-volume impostor rejected on 12 observable(s)
```

**All 19 failures are surface-TYPE counts. Zero volume assertions fail.** The thickened solid has
the right volume and the wrong faces — every swept face that used to be an analytic
`GeomAbs_Plane` now classifies as *other*.

The only change to `src/native/brep/NativeThickenShell.cpp` between those two commits replaces
`BRepPrimAPI_MakePrism` with the in-house `forge::occtPrism`, as part of dropping TKPrim from the
link line. The prism's *volume* survived that substitution; its *surface classification* did not.

This is the failure mode this programme has already written down — *volume cannot validate
geometry* — reproduced exactly: a single observable was clean while the body was wrong, and only a
vector of observables (planar count, cylindrical count, other count) saw it. It also demonstrates
why the exclusion policy in §7.2 is not a way of hiding reds: the gate is **withheld, not weakened**
— not one `want` was changed — and it should be re-registered the moment `occtPrism`'s output
surfaces are canonized back to analytic.

## 7.5 What this UNBLOCKS

**The bar (§0, clause 2) is unchanged:** a JS file is retirable only when a registered,
currently-passing CTest asserts *the same value*, not when a C++ test with a similar name exists.
Coverage below was established by reading both sides and comparing assertions.

| JS file | Covering CTest | The C++ tests inside it that carry the assertions | What is still NOT covered |
|---|---|---|---|
| `forge-kernel/test/native_binding_smoke.js` | `kernel.native_suite` | `test/native/predicates_test.cpp` (orient2d / orient3d / incircle exact signs, incl. the collinear and coplanar zeros) · `test/native/geom/geom_test.cpp` (convexHull2D, interior-point rejection) · `test/native/brep/convex_hull_test.cpp` (convexHull3D, face count) · `test/native/implicit/sdflibrary_test.cpp` + `implicit/dualcontour_test.cpp` (sdfSphereVolume convergence) · `test/native/gdt/gdt_test.cpp` (gdtTruePosition, gdtFlatness) · `test/native/mesh/boolean_native_test.cpp` (meshBoolean, including the honest `ok=false` refusal) | Only that the addon **exposes** these as `forge.native.<op>` functions — an N-API surface assertion about the very layer group G1 exists to delete. No geometry claim is lost. |
| `forge-kernel/test/native_engines_smoke.js` | `kernel.native_suite` | `test/native/{tolstack,vvuq,materials,am,composites,surfit,cam}/*_test.cpp` — **the seven gates this file's own header says each of its assertions mirrors**: *"Cross-checks every NEWLY-BOUND forge::native engine op against the SAME deterministic known-answer its standalone native gate asserts (test/native/&lt;engine&gt;/&lt;engine&gt;_test.cpp). Each assertion mirrors a check() in the gate."* | The same N-API marshalling assertion, and nothing else. |

**Two files out of 1,768, and out of the 240 under `forge-kernel/test`.** That is deliberately not a
larger number. §0's clause 2 is the one that kills the survivors, and it still does; §7.7 is the
honest account of why.

## 7.6 What moved from "sole evidence" to PARTIAL

Not retirable — but no longer the only place the behaviour is asserted. Each row names the one claim
that is still uniquely the JS file's.

| JS file(s) | Covering CTest(s) | The claim still unique to the JS file |
|---|---|---|
| `native_vs_occt_core.mjs` | the 44 `kernel.ab.*` oracles (primitives, booleans, fillet, chamfer, draft, shell, offset, loft/sweep, pattern, section, sew, heal, HLR, STL/STEP/IGES, validator, exact + fuzzy boolean) | **Routing.** It flips `setNativeBrep(false/true)` and asserts `kindOf(result)` — that the *live public op* really rode the native backend. The C++ oracles call `forge::native::brep::*` directly, so they prove the algorithm, not the route. `test/native/brep/native_route_test.cpp` says so in its own header: *"the Node-level native_vs_occt_core.mjs gate is the actual native-vs-OCCT comparison."* Also per-op COM and inertia vectors. |
| `native_vs_occt_fillet_prism.mjs`, `native_vs_occt_chamfer_prism.mjs`, `native_vs_occt_varfillet_box.mjs`, `native_vs_occt_partvarfillet_box.mjs`, `native_vs_occt_aabb.mjs`, `native_vs_occt_features_gap1.mjs`, `native_analytic_offset_ab.mjs`, `native_analytic_chamfer_draft_ab.mjs` | `kernel.ab.native_vs_occt_{fillet,fillet_ext,fillet_curved,chamfer,chamfer_asym,draft,offset_shape,allbox}`, `kernel.ab.ab_native_offsetshape_occt` | The same routing claim (`kindOf(result) == 'nativeSolid'`, not `'nativeMesh'`, not `'occt'`), plus the non-90° regular-n-gon dihedral sweep (n ∈ {3,6,8}) that the C++ oracles do not cover. |
| `native_thicksolid_closedform.mjs` | *(none — see §7.4)* | Its C++ sibling `ab_native_thicken_occt` is **withheld as red**, so for thicken this `.mjs` remains the only runnable evidence. This is the clearest case in the ledger of a JS file that CANNOT go yet. |
| `ft/ft_bore_count.mjs` | `kernel.correctness_gate` (G3) | G3 asserts per-axis bore counting on **one** cross-drilled part, cross-checked against `forge_verify`'s independent axis-line measurement. `ft_bore_count.mjs` runs **seven** discriminator cases — including the fillet-over-hole case that made the old rule report 7 holes where there is 1, and four cases that exist specifically to catch *under*-counting. |
| `cadscore_harness.mjs` | `kernel.native_suite` (`brep/cadscore_gates_test.cpp`) | The C++ gate covers the in-kernel pre-submit gates (Betti, watertight-manifold, interface keep-in/keep-out IoU). The harness additionally computes the whole CADGenBench CAD Score: surface-distance F1 at 0.5 % of the GT bbox diagonal, Monte-Carlo volume IoU, the interface ramp, and the editing-fixture weighting. |
| `io_smoke.js`, `io_iges_smoke.js`, `drawings_smoke.js` | `kernel.step_probe`, `kernel.feature_probe`, `kernel.ab.native_vs_occt_{stl,step_read,dataexchange_write,hlr,hlr_import,hlr_persp,import_surfaces}`, `kernel.ab.io_stl_binary_solid_header` | Broader format and view coverage than any single probe: the probes assert one STEP round-trip and one HLR projection; these drive the full public IO and drafting surface. |

**And one change that retires no file but does change the evidence base.**
`forge-kernel/CMakeLists.txt` cites JS gates (`native_vs_occt_core.mjs`, `ft_smoke.mjs`,
`directedit.mjs`, `healing_smoke.js`) as the evidence for OCCT drops already shipped. Forty-four C++
native-vs-OCCT oracles are now runnable as one command and green, so those drop claims are no longer
evidenced *only* by JavaScript — even though, per the rows above, the JS files themselves stay.

## 7.7 Why closing B1 retires two files and not 240

Of the 240 JS-family files under `forge-kernel/test`, **207 load `forge-kernel.node`**
(`grep -lE "forge-kernel\.node|FORGE_KERNEL" forge-kernel/test/*.{js,mjs,cjs} | wc -l` → 207).
Three structural reasons, in order of how much they cost:

1. **The routing claim has no C++ owner.** Most `native_vs_occt_*.mjs` gates assert not only
   *native == OCCT* but *the live op actually took the native path*. The C++ oracles call the native
   engine directly, and `run_native.sh` cannot link OCCT at all, so neither can make that assertion.
   Closing this needs one C++ A/B that drives `forge::part::*` with `setNativeBrep()` toggled —
   `native_vs_occt_core.mjs`, in C++.
2. **The physics / CAE / domain smokes have no C++ owner at all.** The ~180 `*_smoke.js` /
   `*_gate.mjs` files (FEA, CFD, EM, thermal, CAM, sheet metal, assembly, drawings, PDM, structural
   codes) test `forge.*` surfaces implemented in `forge-kernel/src/*.cpp` that have **no C++ test**.
   A CTest suite cannot cite a test that does not exist. That is manifest group G4's problem, not
   B1's, and it is the reason §0 clause 2 keeps biting.
3. **B1 was necessary, not sufficient.** G1 (the 19,616-line N-API binding layer) and G2/B2 (the
   `preload.js` surface) still gate everything that goes through the addon — 207 of these 240 files.

## 7.8 The next blockers

1. **Fix the thicken surface classification** (§7.4) and re-register `ab_native_thicken_occt`. It is
   a live defect in shipped geometry, not just a red test.
2. **A C++ routing A/B.** One gate that drives the public `forge::part::*` ops with
   `setNativeBrep()` toggled and asserts which backend the handle rode. That single missing
   assertion is what holds every `native_vs_occt_*.mjs` file in §7.6 instead of §7.5, and it is now
   the cheapest remaining move — the suite to hang it on exists.
3. **C++ owners with tests for the ~180 domain smokes** (§7.7 item 2). Until they exist those files
   are live evidence and nothing else.

### Open reds this pass measured, which should not be lost

| Item | Measured | Where |
|---|---|---|
| `ab_native_thicken_occt` | 208 pass / 19 fail at `a70dd1da`, green at `876b179a`. All 19 are surface-type counts; zero volume failures. | `test/ab_native_thicken_occt.cpp`, cause in `src/native/brep/NativeThickenShell.cpp` |
| `native_vs_occt_fillet_var` | Native variable-radius fillet matches its closed form to ~5e-15 rel; OCCT disagrees by 4.444e-05 rel, over the file's own 1e-6 threshold. | `test/native_vs_occt_fillet_var.cpp` |
| `native_vs_occt_iges` | 11/16; case C PARTIAL — a 128-entity property-flag-count divergence. | `test/native_vs_occt_iges.cpp` |
| `native_fuse_mesh_operand_test` | SIGABRT (rc 134). | `test/native_fuse_mesh_operand_test.cpp` |
| `native_occt_import_test`, `native_occt_wire_activation_test` | rc 1. | `forge-kernel/test/` |
| s0 conformance | 5 known gaps, unchanged and owed (s0.6 pattern-occurrence addressing among them). | `test/ft/s0_conformance_baseline.txt` |

---

## 8. THIRD DELETION PASS — 2026-09-01 (`forge-js/tranche-3`, merge `b793ebe1`)

**Three files retired. Running total across all passes: seven.**

§0 sets the bar at three clauses, and clause 2 ("a C++ test asserts the same value") is the one
that kills the survivors. All three files below clear the bar **without needing clause 1 or 2**,
because each is a file that *asserts nothing to begin with* — which §0 did not anticipate as a
category and which is now recorded as one.

| File | Lines | Class | Evidence |
|---|---:|---|---|
| `frontend/src/forge-v4/assemblyBuilder.js` | 480 | **cannot execute** | static `import … from './MassiveAssembly.js'`; the module is at `frontend/src/foundation/`, not `frontend/src/forge-v4/`. `node` raises `ERR_MODULE_NOT_FOUND` before line 1 runs, under a resolve hook that stubs only bare specifiers so `three` cannot mask it. Negative control in the same harness: the real `MassiveAssembly.js` imports cleanly. Self-declared `SCAFFOLD … wire + perf-verify before demo use`. Zero importers. |
| `forge-kernel/test/ge9x_shell_section_verify.mjs` | 26 | **superseded shim** | body is `spawnSync(node, [leap1a_shell_section_verify.mjs])`; the named replacement is present (165 lines) and cited at `frontend/src/forge-v4/ge9xBuilder.js:48`. Node twin of `demo-ge9x-full-process.spec.js` (#158). |
| `forge-kernel/test/camx_gcode_peek.cjs` | 22 | **asserts nothing, and duplicates** | byte-identical arguments to `camx_smoke.cjs` §5 on every call, recording strictly less. **0** hits for `assert\|expect(\|process.exit(1)\|throw` (positive control: `knit_surface_smoke.js` → 8). |

### 8.1 A fourth clause, learned this pass

§0's three clauses assume the file under test *asserts something*. Two of the three files above
assert nothing at all, and for those the first two clauses are vacuous — there is no value for a
C++ test to match. The bar that actually applied is:

> **0.4 — A file that cannot execute, or that contains no assertion, has no behaviour to
> replace.** It is retired on proof of that fact alone, with the proof produced by *running* it
> (clause 3 still applies in full). This is the repository's own `CMakeLists` "2b" standard
> — *"a test that cannot fail is worse than no test"* — read from the JS side.

Clause 0.4 is **narrow on purpose**. It does not license deleting by reachability: `camx_smoke.cjs`
is equally assertion-free and was **kept**, because it is the only written statement of the G-code
dialect contract (twelve named markers) even though it checks none of them. *Recording an
expectation is not the same as having none.*

### 8.2 What this pass did NOT retire, and why

* **Model C** — `frontend/src/kernel/features/*`, 8 files / 2,509 LOC, self-declared *"the DEAD
  PRE-OCCT DEMO KERNEL"*, quarantined 2026-05-23. Pinned by **five** named importers
  (`FastenerLibrary`, `BearingLibrary`, `HollowBlade`, `TurbomachineryBlade`, `AgentBridge`).
  Its banner names a sixth, `ToolExecutionEngine.js`, which **no longer exists as a file**.
  → `FORGE_DELETION_PLAN.md` §10.4, blocker **B13**.
* **The three surfacing smokes** (`knit_`, `thicken_`, `trim_surface_smoke.js`). #146 added the
  SURFACE value kind and six kernel ops, but all six are **forbidden** (no `forge::ui` command
  emits them) and its C++ tests are **parse-level by their own declaration**. §7.6's entry for
  `native_thicksolid_closedform.mjs` — *"the clearest case in the ledger of a JS file that CANNOT
  go yet"* — now has three companions. → §10.2.
* **`projects/ge9x/`** — no successor demo target exists. → blocker **B14**.
* **The 199 remaining orphans** — §9.3's null result reproduced by an independent probe,
  including both of its false positives.

### 8.3 Gates run

Green before and after the deletions: `brand-guard.test.mjs`, `deps-allowlist.test.mjs`,
`bridge-prompt-contract.test.mjs` (the whole of the default branch's `npm test`).
Green for the merge: `ui/test/run_ui.sh` **19/19**, `ui/test/run_op_constraint_gate.sh`
**9/9 mutations caught**, `gen_archie_op_vocabulary.py --check`, `gen_op_constraint_table.py --check`.
No workflow, `package.json` script, `CMakeLists.txt` or shell harness names any deleted file
(grep positive-controlled on `native_binding_smoke`).
