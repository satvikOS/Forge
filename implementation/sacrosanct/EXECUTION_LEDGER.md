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
