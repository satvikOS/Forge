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
