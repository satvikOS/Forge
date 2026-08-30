# JS RETIREMENT LEDGER

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
| `forge-kernel/test` | 240 | 35,413 | **KEEP** | The OCCT kernel's entire acceptance harness. CI executes it and the job is **green** (see §4). CI's own comment: "MUST NOT be removed by extension alone". Blocked on **B1**. |
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

**Add CTest to `forge-kernel/CMakeLists.txt` and bring the 203 existing C++ tests under it**, copying
the `enable_testing()` / `add_test()` pattern already working in `forge-desktop/CMakeLists.txt:188`.

That is the single highest-leverage move available, because it is the *prerequisite* for the largest
deletion in the tree: 240 JS files and 35,413 LOC of kernel harness cannot go while they are the only
acceptance evidence the OCCT kernel has. No amount of JS analysis moves that; only a native harness
does. Nothing else on this list unblocks by being looked at harder.
