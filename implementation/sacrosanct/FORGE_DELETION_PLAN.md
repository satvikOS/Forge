# FORGE DELETION PLAN — what "delete all old Forge versions" comprises, and the order it becomes safe

**Status: §1–§8 were PLAN ONLY. §9 is a SECOND PASS that measured again and retired three more
files.** The standing order is to delete all old Forge versions from the repo and locally. D-018
gated that on four conditions. This document supplies what D-018 deferred: the exact inventory,
the load-bearing analysis, what each deletion breaks *by name*, and the order in which each tier
becomes safe.

> **START HERE if you are the next pass.** §1–§8 were measured at `5adc26a0` and several of
> their numbers have since moved. **§9.7 lists every one that changed**, §9.6 is the current
> blocker list, and §9.0 names the tree §9 was measured on. Do not re-derive a plan from a §1–§8
> figure without checking it against §9.7 first.

## 0. Provenance — the tree every number below was measured on

| | |
|---|---|
| Tree | a clean worktree at `origin/claude/sacrosanct-execution-20260828` |
| Commit | `5adc26a0` — *"kernel: family J's 0/565 is a whole-shape precondition… (#90)"* |
| Date of measurement | 2026-08-30 |
| Method | `git ls-files` + `wc -l` + `du -ck` on tracked paths only, plus the live gate output quoted in §2 |

The shared checkout was **not** read. Every prior gate-3 number in this programme that was
measured on an in-flight tree has since been found stale (D-018 RE-VERIFIED), so the tree is
named rather than assumed. Where this document contradicts an earlier record, §7 says so
explicitly rather than quietly restating.

---

## 1. Gate status today

D-018 named four conditions. Their state at `5adc26a0`:

| # | Gate | State | Evidence |
|---|---|---|---|
| 1 | `forge_desktop` configures and builds clean from a cold tree | **MET — re-measured here** | §1.1 |
| 2 | The headless frame gate passes on that build | **MET — re-measured here, 137 checks / 0 failures** | §1.1 |
| 3 | The C++ UI covers the operations the JS app exposes | **NOT MET — 11.0% measured** | §2 |
| 4 | A Gatekeeper-acceptable bundle exists | **NOT MET — blocked on a credential** | `security find-identity -v -p codesigning` → `0 valid identities found`, re-run 2026-08-30 |

### 1.1 Gates 1 and 2 re-measured, because the standing evidence was three commits stale

D-018's gate-1/2 pass reported **135 checks**. Three commits have touched `forge-desktop` since
it was taken — `cb96e6e8` (#88), `8651d390` (#91) and `80a26e0d` (#89, which rewrote the
dispatch and the tree rows). A gate result on a tree that has since moved is exactly the trap
this programme has now hit five times, so it was re-run from scratch here rather than restated:

```
TREE=194fef9b (this branch, one doc commit on top of 5adc26a0)
KCONF_RC=0        cmake -S forge-kernel -B build-app -DFORGE_BUILD_NODE_ADDON=OFF
KCORE_RC=0                                           -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
CONFIGURE_RC=0    cmake -S forge-desktop -B forge-desktop/build
GATE_BUILD_RC=0   cmake --build forge-desktop/build -j4
      1/3 Test #1: forge_desktop_frame_gate ........ Passed  0.41 sec
      2/3 Test #2: forge_desktop_ir_pipeline_gate .. Passed  0.19 sec
      3/3 Test #3: forge_desktop_document_gate ..... Passed  3.36 sec
      100% tests passed, 0 tests failed out of 3
[gate] 137 checks, 0 failures
[gate] ALL FORGE DESKTOP FRAME GATES PASS (headless: no window, no swapchain, no MoltenVK)
```

**Gates 1 and 2 hold on this tree**, with 137 checks — two more than the 135 D-018 recorded, so
the gate grew rather than went quiet. The verdict is read from the printed line, not from `$?`:
the `ctest` invocation was piped through `tail | tee`, so its `$?` is `tee`'s and is worth
nothing. D-018's mutation proof of this gate (`80.0f → 81.0f` → exit 1) is inherited, not re-run.

Gate 4 is not a code problem. D-019 established it with a positive control: a trivial `.app`
with **one** Mach-O at `minos=14.0` and **zero** Homebrew dylibs is still `rejected, exit 3`,
ad-hoc signed and with hardened runtime. It needs a paid Developer ID plus notarization. Per
D-019 it does **not** depend on the OCCT drop.

---

## 2. GATE 3, RE-ASSESSED AGAINST MEASURED EVIDENCE

### 2.1 What the closure result actually says

The op vocabulary is closed. Verified on this tree:

```
$ python3 implementation/sacrosanct/tools/gen_archie_op_vocabulary.py --check
[op-vocabulary] OK -- archie_op_vocabulary.json matches the source
                (18 ops, 30 commands, 8 sources)
```

`value_kind_closure.gaps` is `[]` and `produced_by_allowed_ops` is `["PROFILE","SOLID","WIRE"]`.
That closes D-021's finding: from an empty document a legal program now exists, because the
allowed set contains its own profile and wire producers (`RECT`, `CIRCLE`, `RING`).

**Closure is not coverage.** Closure asks: *is the C++ vocabulary self-consistent — can a
program be written in it at all?* Gate 3 asks a different question: *does the C++ UI cover the
operations the JS app exposes?* The first is a necessary condition for the second and answers
none of it. Reading the closure result as gate 3 would be substituting a property of one
surface for a comparison between two.

### 2.2 Correction: reachability is 30/30, not 34/34

The 13 UI gates were run on this tree. Full pass, and the reachability numbers are:

```
$ JOBS=4 bash ui/test/run_ui.sh
  [reachability] live registry holds 30 commands in 5 categories
  [reachability] menu bar     reaches 30 / 30 commands
  [reachability] ribbon       reaches 30 / 30 commands
  [reachability] palette      reaches 30 / 30 commands
  [reachability] tool catalog reaches 30 / 30 commands
  [reachability] manifest     reaches 30 / 30 commands
  [reachability] ---- NEGATIVE CONTROL: the FAIL line below is EXPECTED …
  [reachability] (negative control -- one command removed) reaches 29 / 30 commands
[app_surface_reachability] 40 checks, 0 failures — PASS
  [info] dispatched 34 recorded examples through the live registry
[archie_op_vocabulary] 1500 checks, 0 failures — PASS
…
[ui] ALL 13 UI GATES PASS (forge::ui — headless, no ImGui, no GPU, no display)
```

The gate carries its own negative control and it fired, so the 30/30 is a result and not a
gate that cannot fail. **The "34" is a different quantity**: it is the count of recorded IR
emission examples the vocabulary test dispatches. A stale comment at
`ui/test/app_surface_reachability_test.cpp:9-10` also says *"the ribbon showed 13 of 34
commands"*, measured on revision `6a7f3aa3`. The registry holds 30 today — counted
independently from source: 10 ids in `ui/src/ForgeShell.cpp` + 20 in `ui/src/PartCommands.cpp`.

Reachability 30/30 means **every command the C++ registry holds is offered on all five
surfaces**. It says nothing about how large the registry is relative to the JS app.

**Where the 34 and the 35 come from, and why 30 is not a regression.** The manifest's row count
over its five revisions is `31 → 31 → 34 → 35 → 30`:

| commit | rows | |
|---|---:|---|
| `415b871c` | 31 | *"pin the app surface — the 31 commands a user can actually invoke"* |
| `ce7ead21` | 31 | one document, registry → viewport → `.fpart` |
| `6a7f3aa3` | 34 | RECT / CIRCLE / TRANSLATE close the empty language (#84) |
| `903cf338` | 35 | RING closes the last value-kind gap (#92) — the figure D-023 records |
| `80a26e0d` | **30** | *"desktop P0.3–P0.6 … one undo stack, no counter stubs"* (#89) |

`80a26e0d` is a descendant of `903cf338` (verified with `git merge-base --is-ancestor`), and the
five rows it removed are, exactly:

```
model.extrude   model.fillet   model.shell     <- D-021's "declare an op and emit nothing"
part.undo       part.redo                      <- duplicates of edit.undo / edit.redo
```

Across that commit `user_invocable_ops` stayed at **18**, `commands_emitting_ir` stayed at
**20**, and `derived_defects` fell **6 → 3**. So the registry shrank by removing three stubs
and two duplicates; **no capability was lost**, and the 11.0% coverage figure in §2.3 is
unaffected by it. Any future reader comparing 30 against a remembered 34 or 35 is comparing
against a count that included stubs.

### 2.3 The coverage measurement gate 3 actually asks for

> **CORRECTED 2026-09-01 (third pass, §10).** This section shipped with **30** registry
> commands and **18** user-invocable ops under the heading *"counted from source on this
> tree"*, and those two numbers fed the coverage percentage below. They went stale the moment
> #140 landed and stayed stale through #144 and #146 — twelve and eleven out respectively.
> Re-measured on the tree in §10.0 and restated here. **The stale figures were the FIRST-pass
> measurement retained under a heading that promises a live one**, which is D-027's lesson
> ("a count copied into a second place goes stale") for the third time in this document.

Two surfaces, both counted from source on this tree:

| Surface | Count | Was | Source |
|---|---:|---:|---|
| C++ `forge::ui` registry commands | **42** | ~~30~~ | `implementation/sacrosanct/APP_SURFACE_MANIFEST.tsv` (generated from the live registry) |
| C++ commands that emit IR | **31** | — | `archie_op_vocabulary.json` `counts.commands_emitting_ir` — the other 11 are `file.*`, `view.*`, `edit.undo/redo`, `workspace.next`, `app.command_palette` |
| C++ user-invocable IR ops | **29** | ~~18~~ | `archie_op_vocabulary.json` `emission_policy.allowed_ops` |
| C++ kernel ops (`opFromName`) | **47** | — | `forge-kernel/src/ft/FeatureTreeCompiler.cpp:121-167` |
| C++ ops FORBIDDEN (no command emits them) | **18** | — | `archie_op_vocabulary.json` `forbidden_ops` |
| JS app declared tool surface | **164** | 164 | `FORGE_TOOLS` in `frontend/src/ai/ForgeToolBridge.js` |
| JS kernel surface exposed to the renderer | **445** | 445 | `contextBridge` bindings in `electron/preload.js` — reproduced exactly on this tree as *function-valued* keys, which is the definition to use; counting every nested key at depth ≥ 2 gives 751 and is the wrong field |
| forge-v4 workbench components | **163** | 163 | `frontend/src/forge-v4/*Workbench.jsx` |
| forge-v4 panel components | **117** | 117 | `frontend/src/forge-v4/*Panel.jsx` |

Mapping the 164 JS tools onto the 42 C++ commands with a hand-written synonym table (the table
is in the plan's companion script and every pair is listed so any one can be rejected
individually — e.g. `part.fuse`→`part.boolean_union`, `part.translate`→`part.move`,
`sketch.add-circle`→`part.sketch_circle`):

```
JS FORGE_TOOLS total              : 164
C++ registry commands (manifest)  : 42        (was 30)
JS tools with a C++ counterpart   : 26        (was 18)
JS tools with NO C++ counterpart  : 138       (was 146)
COVERAGE                          : 15.9%     (was 11.0%)

Per discipline (covered / total):
  part          25 / 104      (was 17 / 104)
  simulate       0 /  29
  drawing        0 /  12
  assembly       0 /   8
  sketch         1 /   6
  manufacture    0 /   5
```

Four of the six disciplines are still at **zero**. **The primitive-creator half of this gap is
CLOSED** — #140 added ten commands and the eight `part.make-*` pairs are matched in §9.2 with
file:line on both sides. What remains of the named gap is five creators and the whole
constraint sketcher:

```
part.make-ellipsoid  part.make-pyramid  part.make-wedge  part.pipe  part.sweep
sketch.create   sketch.add-point   sketch.add-line
sketch.add-constraint               sketch.solve
```

The sketcher line is the sharper of the two, because the solver is **not missing**: planegcs is
vendored at `forge-kernel/3rdParty/planegcs`, is in `forge-kernel/CMakeLists.txt`, and is used
by `forge-kernel/src/Sketcher.cpp`. `sketch.*` sits at 1/6 because nothing in `forge::ui`
reaches a solver that is already built and linked — an exposure job, not a solver job (#147).

The relationship is not containment in either direction: **18** C++ commands have no JS tool
counterpart either — `app.command_palette`, `edit.delete`, `edit.redo`, `edit.undo`,
`file.new`, `file.open`, `file.save`, `part.counterbore`, `part.edit_feature`, `part.mirror`,
`part.section_curve`, `part.section_ring`, `part.sketch_polygon`, `part.sketch_rect`,
`part.sketch_rounded_rect`, `view.fit`, `view.wireframe`, `workspace.next`. So the C++ app is not a subset being grown
toward the JS app; it is a different, much smaller surface that overlaps it.

### 2.4 Verdict

**Gate 3 is NOT met, and the closure result does not move it.** **15.9%** of the JS tool
surface has a C++ counterpart (corrected 2026-09-01 from 11.0%, §2.3). On the wider surface the
renderer actually has — 445 bridged kernel functions — the ratio is **42/445**.

What *has* changed since D-018 is worth stating precisely, because it is real progress and it
changes the deletion **order** even though it does not clear the gate:

* D-021's blocker is gone. The C++ vocabulary is closed, so a user can build a part from an
  empty document. Gate 3 is now a *size* problem, not an *impossibility* problem.
* The C++ side has **no dependency on the JS side**. Measured: `git grep -lE "frontend/|electron/|\.jsx|node_modules"` over `forge-desktop ui orchestration simulation retrieval` returns **0 files** (positive control: the same grep over `forge-kernel` returns **29**). Deleting `frontend/` and `electron/` cannot break `forge_desktop`.
* CTest now exists. `forge-kernel/CMakeLists.txt` registers **45 C++ A/B gates** (corrected from 44, §9.7; every one's `.cpp` source verified present, with an absent-file negative control), the `run_native.sh` native suite (141 tracked `.cpp` under `test/native/`), the s0 ratchet, the CAPI smoke and the coaxial-bore guard. `ZERO_JS_MIGRATION_MANIFEST.md` §3 named the *absence* of `add_test`/`enable_testing` as "the true blocker on Z1". That blocker is cleared (see §7).

Gate 3 is therefore best re-stated as a measurable ratchet rather than a binary: **15.9%
today; the gate clears when the C++ registry covers the operations `e2e/forge` actually
exercises.** §5 gives that as tier T5's entry condition.

**The ratchet did not move between #140 and this pass, and that is the finding, not an
omission.** #144 (the Archie CoPilot panel), #146 (SURFACE as the fourth IR value kind) and
#165 (SECTION, the fourth OCCT Boolean) all landed in between. The first two added **zero**
registry commands; #165 added **one** (41 → 42 commands, 28 → 29 ops) and coverage **still did
not move**, because gate 3 measures OVERLAP WITH THE JS TOOL SURFACE, not absolute capability —
`part.section_curve` has no JS counterpart to overlap with. #146 in particular added six
kernel ops — `SKIN`, `FACES`, `SEW`, `THICKEN`, `CAP`, `SURFCHECK` — and **all six are in
`forbidden_ops`**, each with the same generated reason: *"no command in the forge::ui registry
emits it, so no user can produce it."* Surfacing is now a TYPE and a GRAMMAR with no door in the
app. See §10.2.

---

## 3. THE INVENTORY — what "old Forge versions" comprises

Measured on `5adc26a0`, tracked files only.

**Total candidate set: 1,802 files · 543,858 LOC · 23,628 KiB tracked**
(the repo tracks 3,905 files, so this is 46% of it by file count)

| ID | Path | Files | LOC | Tracked KiB | What it is |
|---|---|---:|---:|---:|---|
| **F1** | `frontend/src/forge-v4/**` | 605 | 250,558 | 10,432 | The Forge IDE. 547 flat components + 16 icon modules + sciviz(7)/theme(4)/pdm(4)/io(4)/ecad/plm/ml/rationale/drawing/assembly. 163 `*Workbench.jsx`, 117 `*Panel.jsx`. |
| **F2** | `frontend/src/kernel/**` | 239 | 69,265 | 2,827 | **A second geometry kernel, in JavaScript.** forge(63) brep(43) topology(26) atomic(19) production(11) features(8) export(8) rendering(6) math(6) manufacturing(6) … |
| **F3** | `frontend/src/foundation/**` | 171 | 43,231 | 1,891 | Engineering-domain libraries (bearings, mates, cost, blade cooling). Real logic, not UI. |
| **F4** | `frontend/src/ai/**` | 34 | 9,872 | 540 | `ForgeToolBridge.js` (164 tools) + prompt contract tests. The surface gate 3 is measured against. |
| **F5** | `frontend` — everything else | 81 | 21,164 | 714 | `systems`(20), `styles`(9), `tools`(7), `generators`(6), `occt-custom-build`(6), `utils`(4), `__tests__`(2), `App.jsx`, `main.jsx`, `vite.config.js`, `package.json`, `index.html` |
| | **`frontend/` total** | **1,130** | **394,090** | **16,404** | |
| **F6** | `e2e/*.spec.js` (root) | 160 | 49,870 | 2,297 | The `push-*` behavioural suite. 402 of the 404 tracked `*.spec.js` files call `_electron.launch`. |
| **F7** | `e2e/forge/**` | 250 | 40,436 | **1,842 tracked** | 244 `*.spec.js` + 4 helpers + 2 md. The behavioural reference D-018 measures gate 3 against. |
| **F8** | `electron/**` | 3 | 2,417 | 115 | `main.js` (lifecycle, **24** `ipcMain.handle/on` channels — measured), `preload.js` (**445** bridged kernel functions — measured, with a zero-returning negative control), `pdmVault.js`. |
| **F9** | `forge-kernel/src/binding*.cpp` + `src/ft/binding_ft.cpp` | 5 | 19,648 | 1,027 | The N-API layer. `binding.cpp` alone is **17,910 lines**. C++, but it exists only to serve JS. |
| **F10** | `forge-kernel/test/*.{js,mjs,cjs}` | 241 | 35,659 | 1,865 | The JS acceptance harness. **210 of 241** `require` the `.node` addon. |
| **F11** | `projects/**` | 11 | 1,606 | 73 | Sample project fixtures. |
| **F12** | `playwright.config.js`, `electron-builder.yml`, root `package.json` | 3 | 187 | 3 | The JS build/ship configuration. |
| **F13** | `scripts/forge_drawing.mjs`, `scripts/cadgen_mm_pipeline.mjs` | 2 | 1,019 | 44 | Utility scripts. |

**Explicitly NOT in this set** (they are the replacement, not the thing replaced):
`forge-desktop/` (36 C++ files, 69,492 LOC), `ui/` (24 files, 5,118 LOC + 5,167 LOC of gates),
`forge-kernel/test/**/*.cpp` (210 files, 75,276 LOC), `orchestration/`, `simulation/`,
`retrieval/`, and the 3 shell-driven CTests.

### 3.1 There is no forge-v1 / v2 / v3 in the tree

`git ls-files | grep -oE 'forge-v[0-9]+'` yields exactly two path prefixes: `forge-v4` (605
files) and `forge-v3` (2 files, both in `e2e/forge`). `frontend/src/forge-app/` — the v3 app —
is **already deleted**: 0 tracked files (positive control: `frontend/src/forge-v4*` → 605).

So the literal "old versions" in the repo amount to **residue of a deletion already done**, and
exactly one file is provably dead:

* `e2e/forge/forge-v3-shell.spec.js` — reads `frontend/src/forge-app/v3/tokens.css` at line 14,
  in `beforeAll`. That path does not exist; the only tracked `tokens.css` files are under
  `frontend/src/forge-v4/`. This spec cannot pass. **Safe today, gate-independent.**
  **[EXECUTED on `forge-js/retire-dead-v3-residue`, 2026-08-31.]** Re-verified at
  `origin/archdisc` = `32ee7485`: `frontend/src/forge-app` still has 0 tracked files, the
  `readFileSync` was *run* (not read) and throws `ENOENT`, and this file is the ONLY filesystem
  reference to `forge-app` left in `e2e/` — the other three matches
  (`v4-full-verify.spec.js:60`, `v4-full-verify-v2.spec.js:41`, `v4-exhaustive.spec.js:60`) are
  `data-testid` strings. Deleting it orphans **two** exports of `e2e/forge/_helpers.js`
  (`_helpers.js:71` exports `launchForge, shot, loadInlinePage, SHOTS_DIR`): after the deletion
  `loadInlinePage` and `launchForge` have no importer, and `forge-v3-live.spec.js:10` — the one
  remaining importer — takes only `shot`. **The helper file is deliberately NOT touched**: it is
  live, and pruning its exports is a code change, not a deletion of an old Forge version.
* `e2e/forge/forge-v3-live.spec.js` is *mislabelled*, not dead: it launches
  `electron/main.js` and screenshots whatever the app currently renders, which is v4. It dies
  with F6/F7, not before.

(36 e2e files match `forge-app`, but the other 35 are the live DOM selector
`[data-testid="forge-app"]` or the CSS class `.forge-app`, not a filesystem path. Every distinct
match context was enumerated, not sampled.)

**A second piece of v3 residue, inside a live CI gate.**
`frontend/src/__tests__/brand-guard.test.mjs` — which the default branch runs as `npm test` —
carries `const DEAD_FORGE_APP = join(SRC_ROOT, 'forge-app')` and skips it from the import scan,
with a comment explaining that a self-import inside the orphan "disappears when `forge-app/` is
deleted". `forge-app/` *is* deleted, so that skip is now vacuous: the gate spends a branch on a
path that cannot match. It is **not** proposed for change here — editing a live gate is outside
the scope of a plan — but it is recorded, because it is the second and last trace of an old
Forge version in the tree, and because a vacuous skip in a gate is the shape of a check that
quietly stops discriminating.

### 3.2 Local, non-tracked ("and locally")

| Path | Size | Note |
|---|---:|---|
| `<repo>/node_modules` | 674 MiB | electron, electron-builder, cmake-js, node-addon-api, playwright |
| `<repo>/frontend/node_modules` | 593 MiB | react, three, cesium, **`manifold-3d`**, **`opencascade.js`** — a *third* and *fourth* geometry kernel, in the browser |
| `<repo>/e2e/forge/shots` | **99 MiB** | Playwright screenshot residue. `.gitignore:51`. Not tracked — `git ls-files e2e/forge/shots` → 0 |
| `<repo>/e2e/screenshots` | 644 KiB | `.gitignore:66` |
| `<repo>/forge-kernel/build` | 56 MiB | cmake-js build tree for the `.node` |

`e2e/forge` is **101 MiB on disk in the shared checkout but 1,842 KiB of tracked content** —
99 MiB of it is untracked `shots/`. See §7.

> Sizes in §3 are byte-exact KiB (`os.path.getsize`, rounded up per file). Sizes in §3.2 are
> `du` block-allocated MiB, because there the question is disk reclaimed rather than content
> deleted. The two differ by roughly 10% on this tree; the plan does not mix them in one column.

---

## 4. WHAT EACH DELETION BREAKS — named consumers, not adjectives

### 4.1 The ship itself

> **CORRECTED 2026-09-01 (third pass, §10.3). BOTH HALVES OF THIS SECTION WERE FALSE, AND
> THEY WERE FALSE WHEN WRITTEN — not merely stale.** `.github/workflows/build-app.yml` **does
> not exist on `origin/archdisc`** and has not since commit `50c512e4` (2026-08-28, *"ci: drop
> the Electron desktop pipeline; make the pure-C++ kernel gate primary"*), which
> `git merge-base --is-ancestor 50c512e4 origin/archdisc` confirms is an ancestor of the default
> branch. `git ls-tree origin/archdisc --name-only .github/workflows/` returns exactly
> **`desktop-release.yml`** and **`kernel-tests.yml`**. The paragraph below was carried from the
> first pass unmeasured; the four places it is repeated are corrected in §10.3.

The **default branch** (`origin/archdisc`) once shipped the product from `frontend/` +
`electron/` via `.github/workflows/build-app.yml` (`npm install` → `npx vite build` →
`npx electron-builder`). `electron-builder.yml:9-11` still packages exactly `electron/**/*` and
`frontend/dist/**/*`, and `package.json:main` is still `electron/main.js` — **but no workflow
runs them any more.** The JS app is no longer built by CI on any branch.

**Deleting F1–F8 or F12 therefore no longer deletes a CI-built application** — it deletes the
sources of an application nothing builds. `desktop-release.yml`, which builds the C++
`Forge.app`, **is** on the default branch, so the C++ release path can be dispatched there. What
still gates T6 is gate 4 (a Gatekeeper-acceptable artifact, B10), **not** the retirement of
`build-app.yml`, which already happened.

### 4.2 CI jobs that would go red, by workflow and step name

**`kernel-tests.yml` (execution branch)**

| Job / step | Consumes | Breaks with |
|---|---|---|
| `ForgeCADScore self-tests` → `node forge-kernel/test/cadscore_v2_selftest.mjs` | F10 | F10 |
| … → `node forge-kernel/test/mechanism_axis_selftest.mjs` | F10 | F10 |
| `NAFEMS ratchet self-test` → `fea_nafems_ratchet_selftest.sh` | `node`, and `fea_nafems_ratchet.sh` which runs `node $NAFEMS_GATE` | the Node runtime. **Not** `fea_nafems_gate.mjs` itself: the self-test substitutes its own generated stub gates through `NAFEMS_GATE`, so the tracked gate is exercised by the ratchet, not by this CI job. |
| `OCCT kernel smoke` → `npm install` / `npm run forge:kernel` | F9, F12, `node_modules` | F9 or F12 |
| … → `npm run forge:kernel:test` (**25 chained `node` invocations**) | F10 | F10 |
| … → `npm run forge:coherence`, `native_binding_smoke.js`, `fea_tet4_convergence.mjs` | F10 | F10 |

**`kernel-tests.yml` (default branch `archdisc`)** additionally runs `npm test` →
`frontend/src/__tests__/brand-guard.test.mjs`, `deps-allowlist.test.mjs`,
`frontend/src/ai/__tests__/bridge-prompt-contract.test.mjs` — **breaks with F4/F5** — and
`npm run forge:bridge:test` → `bridge_smoke.js` — **breaks with F10**.

~~**`build-app.yml` (default branch)** — breaks with F1–F5, F8, F12.~~ **STRUCK 2026-09-01: the
workflow is not on the default branch and has not been since `50c512e4` (2026-08-28). Nothing in
CI builds the JS app, so F1–F5 / F8 / F12 break no workflow. §10.3.**

**Unaffected by every tier here:** `native C++ kernel gate`, `forge::ui workstation gates`,
`retrieval`, `simulation`, `s0 ratchet`. Verified: those trees contain **0** references to any
JS path (positive control above).

### 4.3 The e2e suite is a *manual* reference, not an automated one

`grep -rn "playwright\|e2e" .github/workflows/` on the execution branch returns **nothing**, and
the same grep on both default-branch workflows returns nothing. **No CI job on either branch
runs a single one of the 410 Playwright specs.** They are the behavioural reference by
convention and by hand-invocation (`npm run forge:e2e:features`, `npm run gate`) only.

That is not an argument for deleting them — it is the argument for *why they must be replaced
before they are deleted*, because nothing else in the tree currently observes the behaviour they
describe, and nothing would go red on the day they stop being true.

### 4.4 The N-API layer (F9) is the pin holding F10 in place

210 of the 241 JS test files `require('../build/Release/forge-kernel.node')`. Deleting F9
breaks all 210 at once and removes `npm run forge:kernel` entirely. Conversely F9 has **no
consumer other than JS**: `forge_kernel_core` already excludes `binding*.cpp`, and
`FORGE_BUILD_NODE_ADDON=OFF` makes the whole N-API discovery block — including its
`FATAL_ERROR` — vanish at configure time. `forge-desktop/CMakeLists.txt:27,62` documents that
OFF configure by name as its own prerequisite.

### 4.5 The evidence question

Of the 241 JS test files, **41 are reachable** (37 invoked by CI / npm scripts / CMake / shell,
plus 4 more imported by those: `cadscore_harness.mjs`, `cadgenbench_set.mjs`,
`cadgenbench_submission_packer.mjs`, `calculix_io.mjs`). **200 have no invocation and no
importer anywhere in the tree.**

That 200 is not licence to delete them blind — a file with no caller can still be the only
written record of a behaviour — but it does mean the *evidence* argument for keeping F10 applies
to 41 files, not 241, and the 41 are individually nameable.

---

## 5. THE ORDER — what becomes safe when

Each tier states its **entry condition**, and the entry condition is a thing that can be
measured, not a judgement.

### T0 — safe TODAY, gate-independent

| Item | Why |
|---|---|
| ~~`e2e/forge/forge-v3-shell.spec.js`~~ **— DONE, `forge-js/retire-dead-v3-residue` (2026-08-31)** | Reads `frontend/src/forge-app/v3/tokens.css`, which has 0 tracked files. The spec cannot pass. Re-verified by execution at `32ee7485`, not by re-reading. §3.1 carries the full check. |
| Local `e2e/forge/shots/` (99 MiB), `e2e/screenshots/` (644 KiB) | Untracked, gitignored regenerable residue. Reclaims 99.6 MiB. |
| Local `forge-kernel/build/` (56 MiB) | Regenerable cmake-js tree. |

**Entry condition:** none. **Do not** delete `node_modules` yet — CI's `OCCT kernel smoke` job
and the local `npm run forge:kernel` path still need it, and it is 1,267 MiB (674 + 593) of pure cache.

### T1 — the second, third and fourth kernels (F2) — *the highest-value deletion in the tree*

**Entry condition, all three:**
1. A per-op A/B oracle exists in the shape of the 44 registered `kernel.ab.*` CTests, asserting the JS-kernel result equals the `forge_kernel_core` result on a **vector** of observables (volume alone has been proved insufficient — four measured cases, one where no single observable caught the error).
2. `frontend/` no longer imports `src/kernel` — i.e. T1 lands *after* the renderer is repointed at the C++ kernel, or *with* F1.
3. The A/B is green and its arms are proved to differ by a positive control.

**Breaks:** `frontend/src/forge-v4` imports, `npm run forge:unit`.
**Does not break:** any CI job on either branch, any C++ gate.
**Reclaims:** 239 files / 69,265 LOC, plus (locally) the `manifold-3d` and `opencascade.js`
browser kernels in `frontend/node_modules`.

This tier is deliberately first because it is the only one that removes a **correctness
liability** rather than merely a maintenance cost: a second kernel that can silently disagree
with the shipped one.

### T2 — the orphan JS acceptance files (F10, the 200 with no caller)

**Entry condition:** for each file, either (a) a registered CTest asserts the same property, or
(b) the file is recorded as retired with its assertion transcribed into the C++ gate that
replaces it. The 44 C++ `kernel.ab.*` gates plus `kernel.native_suite` already discharge a large
share; each remaining file needs naming, not a bulk wave.

**Breaks:** nothing measurable — by construction these have no invoker and no importer.
**Risk, stated plainly:** "no caller" is a *reachability* fact, not a *value* fact. The honest
failure mode is deleting the only written statement of a behaviour nothing currently checks.
That is why the entry condition is per-file and not per-tier.

### T3 — the 41 reachable JS acceptance files + the N-API layer (F9, F10-reachable)

**Entry condition, all four:**
1. `ctest --test-dir <build> -N` lists a C++ test for each of the 41.
2. `forge_capi.h` reaches the 445-function surface, or the subset the 41 actually exercise, with `forge_capi_smoke.cpp` covering it.
3. `kernel-tests.yml` on **both** branches has its `node`-invoking steps replaced with `ctest` steps, and the replacement is proved to fail by mutation.
4. `npm run forge:kernel` is no longer referenced by any workflow.

**Breaks:** the whole `OCCT kernel smoke` job and `npm run forge:kernel*`, which is why (3) is
an entry condition and not a consequence.
**Reclaims:** 19,648 LOC of C++ glue + 35,659 LOC of JS harness.

Note the sequencing constraint: F9 must go **after** F10, never before — deleting the binding
first breaks 210 test files that are still the evidence base.

### T4 — the engineering libraries (F3) and the AI bridge (F4)

**Entry condition:** a C++ owner exists for each module with a numeric gate against the current
JS output, module by module. There is no C++ peer for most of F3 today. F4 additionally holds
`bridge-prompt-contract.test.mjs`, which the default branch's `npm test` runs — that gate must
move to the C++ side first.

### T5 — the IDE (F1) and its behavioural suite (F6, F7)

**Entry conditions, all four — this is the tier gate 3 actually governs:**
1. **Gate 3 clears on the ratchet defined in §2.4**: the C++ registry covers the operations `e2e/forge` exercises. Today 11.0% of the 164-tool surface. The ratchet is checkable each time `ui/test/run_ui.sh` runs and the manifest is regenerated.
2. **Gate 4 clears**: `security find-identity -v -p codesigning` returns ≥ 1 Developer ID, a notarized bundle passes `spctl -a -vvv`, and the positive control (a trivial `.app`) is re-run to prove the check discriminates.
3. `desktop-release.yml` is on the **default branch** and a `workflow_dispatch` dry run has produced an artifact.
4. A native UI-automation harness exists and re-authors the specs `e2e/forge` carries. Playwright drives a browser; against a native desktop app these specs do not port — they are re-authored, and that work has not started.

**Order within T5:** `e2e/forge` (F7) is deleted **last of all**, after F1. It is the reference
gate 3 is measured against; deleting the reference before the thing it measures is how a
regression becomes invisible.

**Making entry condition (1) countable.** "Covers the operations `e2e/forge` exercises" needs a
number or it is a judgement. Measured on this tree, `e2e/forge` exercises two surfaces and they
are very different sizes:

| what `e2e/forge` asserts | count | note |
|---|---:|---|
| distinct `forge.<fn>(` kernel calls | **9** | `isReady, loadError, makeBox, makeCylinder, makeSphere, massProps, tessellate, translate, version` — all 9 present in `preload.js` (negative control on an invented name returns 0) |
| distinct `data-testid="…"` selectors | **1,170** | the UI surface it actually gates |

So the *kernel* half of the reference is tiny and already almost within reach — 9 calls, of
which the C++ registry covers `makeBox`/`makeCylinder`/`makeSphere` **not at all** (they are
`part.make-*`, absent from the C++ surface) but `translate`/`massProps`/`tessellate` have C++
peers. The *UI* half is 1,170 assertions against 30 commands, and that is the real T5 cost.
Stating both stops the tier from being justified by whichever number is convenient.

*(Precision on the 445: `electron/preload.js` has 445 `name: (` binding lines resolving to
**351 distinct leaf names** — 14 names appear in more than one namespaced sub-object. Both
figures are correct for different questions; §2.3's 30/445 is the ratio against exposed
bindings.)*

### T6 — the tail

`electron/` (F8), `projects/` (F11), `playwright.config.js` + `electron-builder.yml` + the JS
half of the root `package.json` (F12), `scripts/*.mjs` (F13), then local `node_modules` (1.27
GiB) once no workflow or local path invokes `npm` in this repo.

**Entry condition:** ~~`build-app.yml` is retired from the default branch and~~
`desktop-release.yml` has published at least one Gatekeeper-acceptable artifact. This is the
point at which "delete all old Forge versions" is complete.
**The first half of this condition is already MET** — `build-app.yml` left the default branch at
`50c512e4` on 2026-08-28, before this plan was first written (§10.3). Only the artifact half
remains, and it is B10.

### 5.1 The dependency order, compactly

```
T0  (today)      dead v3 spec + local residue
 |
T1  needs: per-op A/B vs forge_kernel_core          -> F2   69,265 LOC
 |
T2  needs: per-file evidence transcription          -> F10 orphans (200 files)
 |
T3  needs: CAPI @445 + CI moved to ctest            -> F10 reachable (41) THEN F9  19,648 LOC
 |
T4  needs: C++ owner + numeric gate per module      -> F3, F4
 |
T5  needs: GATE 3 (11.0% -> covering) + GATE 4      -> F1 (250,558 LOC), then F6, then F7 LAST
 |
T6  needs: default branch switched to the C++ ship  -> F8, F11, F12, F13, node_modules
```

Gate 4 blocks only T5–T6. **T0–T4 are not gated on the Developer ID at all** — which is the
single most useful consequence of this analysis. T1–T3 alone account for **124,572 LOC**
(F2 69,265 + F10 35,659 + F9 19,648) that can be retired on engineering evidence while the
credential is being obtained; T4 adds a further 53,103 (F3 + F4).

---

## 6. What this plan deliberately does not do

* **It deletes nothing.** No file is removed by the PR carrying this document.
* It does not lower any gate. Gate 3 is re-stated as a measurable ratchet with a number
  (11.0%) attached; it is not relaxed to an inequality and no count is weakened.
* It does not schedule `*.ts` deletion: `git ls-files '*.ts' '*.tsx'` returns **0**.
* It does not propose deleting `forge-kernel/test/**/*.cpp` (210 files, 75,276 LOC), which is
  the replacement evidence base, not old Forge.
* It does not touch `frontend/occt-custom-build/` beyond noting it, since that is an OCCT build
  recipe rather than app code.

---

## 7. Corrections to the record

Each of these is a number in an existing document that this measurement contradicts. They are
listed so no future reader re-derives a plan from the stale figure.

| Record | Said | Measured at `5adc26a0` |
|---|---|---|
| D-018 | `e2e/forge` is "101M, 248 js/ts" | **101 MiB is the shared checkout's on-disk size, and 99 MiB of it is untracked `shots/`.** Tracked content is **1,842 KiB / 250 files** (248 `.js` + 2 `.md`; zero `.ts`). The deletion reclaims 1,842 KiB from the repo and 99 MiB from the disk, and those are different actions. |
| Task brief | "ribbon reachability is 34/34" | **30/30**, on a registry of 30. The 34 is the count of recorded IR examples the vocabulary test dispatches. §2.2. |
| `ZERO_JS_MIGRATION_MANIFEST.md` G3 | forge-v4 is "576 files, ~200k LOC" | **605 files / 250,558 LOC.** |
| `ZERO_JS_MIGRATION_MANIFEST.md` §0 | JS 1,766 files / 515,638 LOC; C++ 1,135 / 346,287 | JS **1,769 / 517,123**; C++ **1,262 / 390,670**; TS still **0**. Ratio 1.32:1, down from 1.49:1. |
| `ZERO_JS_MIGRATION_MANIFEST.md` §3 step 1 | "no `add_test`/`enable_testing` today… **the true blocker on Z1**" | **CLEARED.** `forge-kernel/CMakeLists.txt` now has `enable_testing()` + **7** `add_test` sites registering **44** A/B gates, the native suite, the s0 ratchet, the CAPI smoke and the coaxial guard; `forge-desktop/CMakeLists.txt` adds `enable_testing()` + **3** more. |
| `ZERO_JS_MIGRATION_MANIFEST.md` G6 | forge-kernel/test is "238 files / 34,174 LOC" of JS | **241 JS-family files / 35,659 LOC**, beside **210 `.cpp` / 75,276 LOC**. C++ acceptance code in that directory now outweighs the JS 2.1 : 1 by line count. |
| D-018 | forge-desktop is "51,468 LOC across 33 C++ files" | **69,492 LOC across 36 files.** |
| D-021 | `forge::ui` has 31 commands, 14 user-invocable ops | **30 commands, 18 ops** — RECT/CIRCLE/RING/TRANSLATE landed and closed the gap; three of D-021's named `derived_defects` (`model.extrude`/`fillet`/`shell` emitting nothing) were then deleted outright in #89, taking `derived_defects` 6 → 3. |
| D-023 | "34 → 35 commands" | **30 at `5adc26a0`.** `80a26e0d` (#89) landed after `903cf338` (#92) and removed 5 rows — 3 counter stubs and 2 duplicate undo/redo — with `user_invocable_ops` and `commands_emitting_ir` unchanged at 18 and 20. D-023's 35 was correct when written; it is not the current count. See §2.2. |

---

## 8. The one-line answer

**Nothing beyond a single dead spec and ~155 MiB of local build residue is safe to delete
today.** Gate 3 is not met at 11.0% and gate 4 is blocked on a credential that does not exist on
this machine. But the analysis moves the boundary: **T1–T3 — 124,572 LOC including the duplicate
JavaScript kernel — are gated on engineering evidence this programme can produce, not on the
Developer ID**, and the CTest wiring that the migration manifest called "the true blocker" is
already in place.

---

# 9. SECOND PASS — 2026-08-31, after #140 / #142 / #143

**Everything above §9 is the FIRST pass and its numbers were taken at `5adc26a0`.** Where §9
contradicts it, §9 is the later measurement and §9.7 says so by row. Read §9.6 for the blocker
list a third pass should start from.

## 9.0 Provenance

| | |
|---|---|
| Tree | a worktree branched from `origin/claude/sacrosanct-execution-20260828` (`d19a9d71`) with `origin/archdisc` (`7d92a709`) merged in |
| Merge commit | `12a09d37` |
| Why the merge was mandatory | the execution branch did **not** contain #138, #140, #142 or #143. Measured on it before the merge: `gen_archie_op_vocabulary.py --check` → *18 ops, 31 commands*. After the merge: *28 ops, 41 commands*. Regenerating either artefact on the pre-merge base would have silently deleted the ten ops #140 added. |
| Generated artefacts | both `--check`s pass **as merged**, with no regeneration needed: `archie_op_vocabulary.json` (28 ops, 41 commands, 8 sources) and `ui/include/forge/ui/ArchieOpVocabulary.hpp` (28 allowed ops, sha `7508d957f421`) |

## 9.1 What was retired this pass, and the citation for each

Three files, 122 lines. Every one is verified by execution, not by reading.

| File | Lines | Why it could go |
|---|---:|---|
| `e2e/forge/forge-v3-live.spec.js` | 33 | Its header says it mounts *"the v3 app"* and waits for *"the v3 grid"*. `frontend/src/forge-app` has **0 tracked files** (positive control: `frontend/src/forge-v4*` → 605). It carries **zero** `expect(` — measured — so its only outputs were a PNG named `99-v3-live` and a console dump of whatever `electron/main.js` rendered, which is v4. What it stood in for on the C++ side: `forge_desktop_frame_gate` and the new `forge_desktop_click_gate` (`forge-desktop/CMakeLists.txt:378,381`), which assert a rendered frame headlessly *and* assert it again after a real ImGui click. |
| `e2e/forge/_helpers.js` | 71 | After the row above it had **no importer anywhere in the tree**. The grep that says so carries its own positive control in the same output: the identical pattern over `e2e/forge/*.js` returns `cadgenbench-cua-helper.js` ×3, `demo-leap1a-full-process.spec.js` ×1, `forge-v4/skeleton.js` ×1 and `_helpers` ×1 — it is not a blind grep. Its own header states its purpose: tests *"must not require the React-mounted Forge app shell to exist (Forge-26 is in flight)"*. That shell shipped; this is the pre-shell harness. The two specs the README paired it with (`forge-bridge.spec.js`, `forge-viewport.spec.js`) had already left the tree. |
| `e2e/forge/demo-ge9x-full-process.spec.js` | 18 | A self-declared **"DEPRECATED SHIM → demo-leap1a-full-process"** whose entire body is `require('./demo-leap1a-full-process.spec.js')`. The replacement it names is present (54,157 bytes). Nothing referenced the shim, and under Playwright it registered the LEAP-1A tests a **second** time. This one's replacement is JS, not C++: it is the retirement of an older Forge *demo target* by a newer one, which is squarely "delete old Forge versions", and it is labelled as such rather than dressed up as a C++ citation. |

`e2e/forge/*.spec.js` goes **244 → 241**. `e2e/forge/README.md` was corrected in the same commit:
its file table had **two** rows naming specs that were already gone.

**The `forge-v3` path prefix is now gone from the repository.** §3.1 measured
`git ls-files | grep -oE 'forge-v[0-9]+'` as two prefixes — `forge-v4` (605) and `forge-v3` (2).
The same command on this tree returns **`605 forge-v4`** and nothing else. That closes the
literal reading of "delete all old Forge versions": no *named* old version remains. What remains
is the far larger thing the standing order actually means — the JavaScript Forge itself — and
§9.6 is its blocker list.

**What was examined and NOT deleted** — the honest half:

* The other four `e2e/forge` specs that assert no selector (`demo-ge9x…` was the fifth).
  `v4-console-debug.spec.js` and `_front20-diag.spec.js` still smoke the boot path and the FEA
  dispatch watchdog; `v4-199-sw.spec.js` and `v4-kernel-introspect.spec.js` assert addon
  lifecycle. None is dead.
* **All 201 orphaned `forge-kernel/test` JS files.** See §9.3 — the probe that was supposed to
  find dead ones among them found **zero**, and the ones with the most obvious-looking C++ twin
  turn out not to have one.
* `e2e/forge/playwright.headless.config.js` — still cited by `cadgenbench-cua.spec.js`.

## 9.2 GATE 3 was stuck at 11.0% because the instrument could not see #140

`forge_deletion_inventory.py` reported **11.0% both before and after** #140 took the registry
30 → 41 commands and 18 → 28 ops. The registry grew by ten and the measured coverage did not
move. The cause was the synonym table, not the app: the JS names are `part.make-*` and the new
C++ ids are `part.primitive_*`, so every new command landed in "C++ commands with NO JS
counterpart".

Eight pairs were checked on **both** sides — same primitive, same parameters, same units — and
added, each with its file:line in the table so any one can be rejected individually:

| JS tool | C++ command | evidence |
|---|---|---|
| `part.make-box` | `part.primitive_box` | `ForgeToolBridge.js:1009` (dx,dy,dz mm → `forge.makeBox`) vs `PartCommands.cpp:775` (dx,dy,dz → `BOX`, `requirePositive` on all three) |
| `part.make-cylinder` | `part.primitive_cylinder` | `:1016` vs `PartCommands.cpp:811` |
| `part.make-sphere` | `part.primitive_sphere` | `:1022` vs `PartCommands.cpp:901` |
| `part.make-cone` | `part.primitive_cone` | `:1027` (r1,r2,h) vs `PartCommands.cpp:853` |
| `part.make-torus` | `part.primitive_torus` | `:1034` (major,minor) vs `PartCommands.cpp:928` |
| `part.make-prism` | `part.primitive_prism` | `:1040` (nSides, circumRadius, height) vs `PartCommands.cpp:970` |
| `part.make-tube` | `part.primitive_tube` | `:1069` (rOuter, rInner, height, `rInner < rOuter`) vs `PartCommands.cpp:1011` — **the same `rInner < rOuter` guard on both sides** |
| `part.rotate` | `part.rotate` | `:1102` (axis + angle in radians) vs `PartCommands.cpp:1108` |

**Gate 3 is now 26 / 164 = 15.9%**, up from 11.0%. Nothing was relaxed and the denominator is
unchanged. Five JS primitives still have no C++ command at all — `part.make-ellipsoid`,
`part.make-pyramid`, `part.make-wedge`, `part.pipe`, `part.sweep` — and the per-discipline
picture is unmoved where it matters:

```
part          25 / 104        simulate       0 / 29
sketch         1 /   6        drawing        0 / 12
                              assembly       0 /  8
                              manufacture    0 /  5
```

Four of six disciplines are still at **zero**. Gate 3 is **NOT met**.

The lesson is the one this programme keeps paying for: *a stale instrument reports the same
number after a real change, and that steadiness reads exactly like a true negative.* The
synonym table is now dated and commented so the next capability landing is checked against it.

## 9.3 The 201 orphans: a probe that found nothing, and why that is the result

Two hypotheses were tested against `forge-kernel/test`'s 201 JS files that have no invoker and
no importer.

**(a) Are any of them dead — naming a file that is not in the tree?** A probe resolved every
relative module specifier and every literal path in all 201. **0 of 201.** The first run of that
probe said **66 of 201**, and it was wrong: it counted `../build/Release/forge-kernel.node` — the
cmake-js output, untracked and absent in a cold tree — as a missing dependency. *A build artifact
is not evidence of death.* The same probe over `e2e/` (407 files) also returns **0**, after two
corrections: its dependency pattern was newline-blind, and it counted `e2e-output/` directories
the specs `mkdirSync` themselves. Both versions only became trustworthy once the **positive
control** fired — the deleted `forge-v3-shell.spec.js`, restored from git into a temp name, must
be flagged, and it is. Its two remaining flags in `e2e/` are false positives on inspection: a
specifier inside a comment, and two `import()` calls inside `page.evaluate` that resolve in the
*renderer*, one of which is guarded by `.catch(() => null)` beside a comment reading
*"require() doesn't work in the renderer"*.

**(b) Do any have a C++ replacement already registered as a CTest?** The six `native_*` orphans
are the best-looking candidates. They do **not**:

* `native_vs_occt_fillet_prism.mjs` and `native_vs_occt_chamfer_prism.mjs` exercise
  `filletSolidStraightConvexEdgeAnalytic` on **non-orthogonal** dihedrals (n-gon prisms,
  δ ∈ {60°, 120°, 135°}) against a closed form *and* OCCT. `git grep -l
  filletSolidStraightConvexEdgeAnalytic` over `forge-kernel/{test,src,include}` returns the two
  `.mjs` files and three implementation files — **no C++ test**. The registered gates
  (`native_vs_occt_fillet`, `_curved`, `_ext`) cover the 90° box edge, the concave reflex edge
  and edge chains. Deleting these two would delete the only written statement of the general
  dihedral case.
* `native_vs_occt_varfillet_box.mjs` / `native_vs_occt_partvarfillet_box.mjs` *do* have a C++
  twin — `forge-kernel/test/native_vs_occt_fillet_var.cpp` — and it is **not in
  `FORGE_AB_GATES`**, because it is **RED on a real measured disagreement**: native matches the
  closed form to `4.6e-15` rel while OCCT differs by `4.444e-05`, over a `1e-6` threshold. It is
  an open engineering gap, so the twin exists but does not yet assert anything. §9.4.
* `native_vs_occt_features_gap1.mjs` covers `shell` / `rib` / `holeWizard` / the pattern trio
  with volume + COM + watertightness + Euler-χ/genus + a `kindOf()` check that the native path
  was actually taken. No registered gate asserts that set.

The ~120 `smoke-*.js` files are a different shape again: they test **C++ engineering solvers**
(`kernel.bearing`, `kernel.woodbeam`, …) against published reference values, reachable only
through the N-API layer. They are JS tests of C++ code, and there is no C++ test for them.

**So T2's entry condition still binds per file, and the honest count of T2 files retireable
today is zero.** "No caller" remains a reachability fact, not a value fact.

## 9.4 RETRACTED AND REPLACED: "27 C++ harnesses that no gate runs" was wrong

**This section first read: *"NEW BLOCKER FOUND: 27 C++ harnesses that no gate runs — 12,315
lines … registering `native_vs_occt_fillet_var` costs one line in `FORGE_AB_GATES` plus a green
run."* That is retracted.** It survives here as a retraction rather than a silent edit, because
the mistake is the exact one this programme keeps making and the correction is more useful than
the claim was.

**What was actually measured, and it is still true:** `forge-kernel/CMakeLists.txt` names **45**
gates in `FORGE_AB_GATES`; the top level of `forge-kernel/test/` holds **73** `.cpp` files; **27
of them are outside that list.** Negative control: a typo in `FORGE_AB_GATES` would surface as
*"listed but source ABSENT"*, and that count is **0**.

**What was inferred from it, and was wrong on two counts.**

1. **CTest is not the only runner.** `forge-kernel/test/run_ab_all.sh:37` drives eight A/B
   harnesses — `draft filling loftpipe offsetshape sweep fillet_concave thicken
   thicksolid_mixed` — through `run_ab_native_$t.sh`, a filename it **builds by variable
   expansion**. No grep for a script basename can see that edge, so a census that counts CMake
   membership reports harnesses as dark that CI runs on every push. `.github/workflows/kernel-tests.yml`
   invokes `run_ab_all.sh`, not `ctest`, for those eight.
2. **Eight of the 27 are deliberate, documented exclusions**, each with the measurement that
   excluded it recorded in the CMakeLists "2b" comment block — a block that says in its own
   words *"HOW THE LIST BELOW WAS CHOSEN — measured, not assumed. Every .cpp in test/ was
   compiled against forge_kernel_core + OCCT and RUN with a 180 s kill. Only the ones that
   COMPILED, RAN and EXITED 0 are listed."*

   | excluded | the measurement that excluded it |
   |---|---|
   | `native_hlr_perf`, `native_hlr_import_perf` | both end in an unconditional `return 0;` — timing instruments with no threshold. Registering them would add **a test that cannot fail**, which is worse than no test. |
   | `golden_corpus_measure` | a CLI tool, not a test: with no argv it prints a usage line and exits 2. |
   | **`native_vs_occt_fillet_var`** | **rc 1 — a REAL measured disagreement.** Native matches the closed form to `4.6e-15` rel; OCCT differs by `4.444e-05`, over a `1e-6` threshold. **An open engineering gap, not a wiring omission.** |
   | `native_vs_occt_iges` | rc 1, 11/16 — case C PARTIAL, a 128-entity property-flag-count divergence. |
   | `native_fuse_mesh_operand_test` | rc 134 = SIGABRT. |
   | `native_occt_import_test`, `native_occt_wire_activation_test` | rc 1. |

   The block ends *"Those six are NOT registered and NOT weakened. Nothing here lowers a
   threshold or widens a tolerance to go green; the red ones simply stay out until they are
   fixed."* **So the cheap unblock does not exist.** `native_vs_occt_fillet_var` cannot be
   registered until the OCCT-vs-closed-form disagreement is resolved, and the two variable-fillet
   JS orphans (§9.3) stay put behind that, not behind a missing line of CMake.

**The corrected census**, re-run by `forge_deletion_inventory.py` §5, splits the 27 three ways:

| bucket | n | |
|---|---:|---|
| (a) named by some shell harness or workflow in the tree | 24 | e.g. `ab_native_fillet_concave_occt` → `run_ab_native_fillet_concave.sh`; `thicksolid_mixed_closedform` → `run_ab_native_thicksolid_mixed.sh`, one of `run_ab_all.sh`'s eight |
| (b) deliberate exclusion, measurement recorded in the 2b note | 2 | `native_vs_occt_fillet_var`, `native_vs_occt_iges` — the other six of the eight above fall in (a) because a `build_*.sh` also names them |
| (c) **neither — no CMake entry, no shell harness, no recorded exclusion** | **1** | `tkoffset_gh_quality_probe`, 210 lines |

**(a) means SOMETHING NAMES IT, not that CI runs it**, and the tool says so in its own output:
`build_foo.sh` existing is not proof that anything invokes `build_foo.sh`. Turning (a) into
"covered" needs the runner graph followed by hand, and the `run_ab_native_$t.sh` expansion means
a mechanical version of that walk produces **false darkness** — it reported
`thicksolid_mixed_closedform` and `run_ab_native_sweep.sh` as unreachable when `run_ab_all.sh`
runs both.

**What is left of the blocker, honestly:** exactly **one** file, `tkoffset_gh_quality_probe`
(210 lines), is unaccounted for by every runner and by the exclusion note. That is a loose end
worth closing, not a 12,315-line finding. The real lesson is the one in the header: *a census of
CMake membership is a census of one runner*, and this repository has at least three (ctest,
`run_ab_all.sh`, `run_native.sh`).

## 9.5 The frontend bundle reaches 555 of 1,103 files — and only **5** of the 239 JS-kernel files

Vite has exactly one entry: `frontend/index.html` → `src/main.jsx`. `frontend/vite.config.js`
declares no additional `rollupOptions.input` (read, not assumed), and neither `electron/main.js`
nor `electron/preload.js` imports anything under `frontend/`. Walking static imports, dynamic
`import()`, `require()`, `export … from` and `import.meta.glob` from that entry:

| | files | reachable | unreachable |
|---|---:|---:|---:|
| all tracked `frontend/**` code | 1,103 | 555 | **548** |
| `frontend/src/forge-v4` (F1) | 597 | 534 | 63 |
| `frontend/src/kernel` (F2 — the JS kernel) | 239 | **5** | **234** |
| `frontend/src/foundation` (F3) | 171 | 7 | 164 |

The **five** reachable JS-kernel files are, in full:

```
frontend/src/kernel/forge/index.js               (a 67-line window.forge facade, NOT a barrel — read)
frontend/src/kernel/forge/RebuildEngine.js
frontend/src/kernel/forge/ReferenceGeometry.js
frontend/src/kernel/forge/Drawings.js
frontend/src/kernel/forge/drawings/TitleBlocks.js
```

Controls, because a reachability number is worthless without them:

* **Positive.** The `CommandBar → ForgeShellV4 → ForgeRunner → ForgeToolBridge → kernelDispatch`
  chain is proved live by `e2e/forge/cadgenbench-cua-helper.js:16-23`. All five are reached. Had
  the walk missed one, the 548 would be fiction.
* **Bound on the unknown.** Exactly one unresolvable dynamic import exists in the tree —
  `frontend/src/forge-v4/faiReportPdf.js:34`, `import(/* @vite-ignore */ specifier)` — and three
  lines above it the specifier is built as `'js' + 'pdf'`. It resolves to a **bare package**, so
  it cannot reach any tracked file and does not loosen the count.
* **`import.meta.glob` roots expanded: 0.** Vite's directory-pulling form is not used, so no
  subtree enters the graph invisibly.

**NOT REACHED IS NOT UNUSED, and this must not be misread as a licence to delete 548 files.**
`npm run forge:unit` runs `frontend/src/kernel/forge/__tests__/*.test.mjs` and the default
branch's `npm test` runs `frontend/src/__tests__/*.mjs` — both are outside the bundle graph and
both are live gates. What the number *does* establish is narrower and still large:

**T1's second entry condition — "`frontend/` no longer imports `src/kernel`" — is five files
away, not 239.** The duplicate JavaScript geometry kernel is 97.9% absent from the shipped
application already. That reorders the tier: the expensive part of T1 was never the unpicking,
it is entry condition 1, the per-op A/B oracle, and the 45 registered A/B gates compare
`forge_kernel_core` against **OCCT**, not against the JS kernel. No gate in the tree compares
the two kernels on anything.

## 9.6 THE BLOCKER LIST A THIRD PASS STARTS FROM

Ordered by cost, cheapest first. Each entry says what would have to be **built**, not what would
have to be decided.

| # | Blocker | Blocks | What has to be built | Gated on the Developer ID? |
|---|---|---|---|---|
| B1 | `native_vs_occt_fillet_var` is RED on a real disagreement (§9.4) | T2 (2 files) | resolve OCCT-vs-closed-form on the variable fillet: native is `4.6e-15` rel from the closed form, OCCT is `4.444e-05`, threshold `1e-6`. Until then `native_vs_occt_varfillet_box.mjs` and `native_vs_occt_partvarfillet_box.mjs` have no green C++ twin to retire against. **NOT the one-line CMake fix an earlier draft of §9.4 claimed** | **no** |
| B1b | One harness is unaccounted for by every runner (§9.4) | nothing yet | decide `tkoffset_gh_quality_probe` (210 lines): register it, fold it into a shell harness, or record the measurement that excludes it the way the 2b note does for the other eight | **no** |
| B2 | No gate compares the JS kernel to `forge_kernel_core` | T1 (cond. 1) | a per-op A/B asserting a **vector** of observables — volume alone has been proved insufficient — plus a positive control that the two arms differ | **no** |
| B3 | 5 files still couple the app to the JS kernel (§9.5) | T1 (cond. 2) | repoint `RebuildEngine` / `ReferenceGeometry` / `Drawings` / `TitleBlocks` at the C++ path, or move them out of `src/kernel` | **no** |
| B4 | 201 orphans have no per-file evidence transcription (§9.3) | T2 | for each, a registered CTest asserting the same property — 6 `native_*` and ~120 `smoke-*` are individually named above | **no** |
| B5 | `forge_capi.h` does not reach the 445-binding surface | T3 | CAPI coverage of the subset the 41 reachable JS tests exercise, plus `forge_capi_smoke.cpp` over it | **no** |
| B6 | `kernel-tests.yml` runs node in 18 places (§9.7 table) | T3 | replace each `node …` step with a `ctest` step and prove the replacement fails by mutation | **no** |
| B7 | No C++ owner for `frontend/src/foundation` (171 files) or the AI bridge | T4 | a C++ module + numeric gate per engineering domain; `bridge-prompt-contract.test.mjs` must move first — the default branch's `npm test` runs it | **no** |
| B8 | Gate 3 at **15.9%** (§9.2) | T5 | ~24 more C++ commands to cover `part`; **all** of `simulate` (29), `drawing` (12), `assembly` (8), `manufacture` (5); the constraint sketcher | **no** |
| B9 | 1,170 `data-testid` assertions have no native harness | T5 | a native UI-automation harness. `forge_desktop_click_gate` (450 lines, `forge-desktop/CMakeLists.txt:381`) is the **first real instalment** — it drives `io.AddMousePosEvent` / `io.AddMouseButtonEvent` headlessly and asserts on a **further** frame. It covers dock tabs and splitter drags, not the 1,170. | **no** |
| B10 | No Gatekeeper-acceptable bundle | T5, T6 | a paid Developer ID + notarization. D-019 established with a positive control that a trivial one-Mach-O `.app` is still `rejected, exit 3` ad-hoc signed. | **YES — and only B10** |
| B11 | `build-app.yml` on the default branch ships the JS app | T6 | retire it, after `desktop-release.yml` publishes an artifact | via B10 |

**Cleared since the first pass:** `desktop-release.yml` **is now on `origin/archdisc`** —
`git ls-tree origin/archdisc -- .github/workflows/` lists it beside `kernel-tests.yml`. §4.1 said
it was absent and that `workflow_dispatch` therefore could not even dry-run there. That half of
T5's third entry condition is met; the other half (a dispatched run that produced an artifact) is
not measured here.

**Still true, and worth restating because it is the most useful fact in this document:** of the
twelve blockers, **exactly one** (B10) needs the credential. Everything else is engineering this
programme can do without waiting on Apple.

## 9.7 Corrections to the first pass

| §  | Said at `5adc26a0` | Measured at `12a09d37` |
|---|---|---|
| §1 / §5 T5 cond. 3 | `desktop-release.yml` is **not** on the default branch | it **is** — `git ls-tree origin/archdisc -- .github/workflows/` lists `desktop-release.yml` and `kernel-tests.yml` |
| §1.1 | forge-desktop registers **3** CTests | **5** + mutation variants: `frame`, `ir_pipeline`, `document`, **`click`**, **`update`** (`forge-desktop/CMakeLists.txt:378-392`) |
| §2.3 / §2.4 | gate 3 coverage **11.0%**, registry **30** | **15.9%**, registry **41**, ops **28**. The 11.0% was correct for the tree it was taken on *and stayed 11.0% after #140 because the synonym table was stale* — §9.2 |
| §2.4 | forge-kernel registers **44** A/B gates | **45** in `FORGE_AB_GATES`; and **27** further `.cpp` harnesses are in no target at all (§9.4) |
| §3 | `e2e/forge` 250 files / 40,436 LOC | **246 files / 40,188 LOC** after #138's one deletion and this pass's three |
| §4.2 | *(no consolidated list)* | §9 adds one: **55** lines across `kernel-tests.yml` (18), `package.json` (22) and `forge-kernel/CMakeLists.txt` (15) name a node runtime. `desktop-release.yml` and `forge-desktop/CMakeLists.txt` name it **zero** times — the C++ ship path has no Node dependency to lose. |
| §5 T1 cond. 2 | *"`frontend/` no longer imports `src/kernel`"*, stated as if the whole 239 were coupled | **5 files**, named in §9.5 |
| — | *(not measured)* | 548 of 1,103 frontend code files cannot enter the Vite bundle (§9.5) |

## 9.8 The one-line answer, second pass

**Four files and ~155 MiB of local residue are now retired, and of the twelve blockers exactly
one needs the Developer ID.** The next tranche is not blocked on Apple; it is blocked on
engineering — an open OCCT-vs-closed-form disagreement on the variable fillet, and 201 JS files
whose behaviour has never been written down in C++. Gate 3 moved
11.0% → 15.9% — real progress from #140, invisible until the measuring instrument was repaired —
and the duplicate JavaScript kernel turns out to be 234/239 unreachable from the shipped bundle,
which makes T1 a question about building one A/B oracle rather than about unpicking a kernel.

---

# 10. THIRD PASS — 2026-09-01, after #144 / #146 / #154 / #157 / #160 / #165

Three more files retired, four false claims about the shipped CI struck, **B11 cleared**, and
one blocker (B8) shown to have **not moved** across two capability landings — which is the most
useful thing this pass measured.

## 10.0 Provenance

Measured on `forge-js/tranche-3`. This pass was measured **twice**, and the second time is the
one that counts — see the box below. Every number is from `forge_deletion_inventory.py`,
`gen_archie_op_vocabulary.py --check`, or a command quoted at its use site. The tree is pinned to
origin: nothing here was measured on a dirty or drifted checkout.

> ### THE BASE MOVED UNDER THIS PASS, AND THE FIRST MEASUREMENT SAID SO WRONGLY
>
> The pass first measured `b793ebe1` (`origin/archdisc` merged into the execution branch) and
> recorded, correctly for that tree, **46 kernel ops / 41 commands / 28 user-invocable ops**, and
> **"there is no `SECTION` op"**. Between that measurement and the PR, **#165 landed `SECTION` on
> the execution branch** — so the claim became false while the document was being written. It is
> corrected here rather than quietly overwritten, because the mechanism is reusable:
>
> **GitHub reported the drift as `mergeable=CONFLICTING`, and the symptom was that CI NEVER RAN.**
> `pull_request` workflows check out `refs/pull/<n>/merge`; when that ref cannot be computed there
> is no run at all — not a red run, *no run*. `gh pr checks` then showed exactly one green line,
> `CodeRabbit — pass`, whose *description* read **"Review skipped: reviews are disabled for this
> base branch."** A green bucket on a check that did nothing, and zero rows for the gate that
> matters. **READ THE DESCRIPTION, NEVER THE BUCKET — and treat "all checks settled" as a claim to
> verify, not a result, whenever the row count is suspiciously small.**
>
> Re-measured after merging the moved base. All figures in §10 below are the SECOND measurement.

**The vocabulary numbers, measured on the merged tree:**

```
kernel ops (opFromName)      47   = 40 original + 6 SURFACE (#146) + 1 SECTION (#165)
registry commands            42
commands emitting IR         31
user-invocable IR ops        29
forbidden_ops                18
gate 3 coverage           15.9%   <- UNMOVED by #144, #146 AND #165
```

Both #146 and #165 moved the op count from 40 on branches that never saw each other, so the merge
is **40+6+1 = 47** and not either side's figure. `ui/test/feature_ir_test.cpp` asserts that exact
number and was resolved to it by measurement, not by taking a side.

**How the briefing's figures resolved.** It carried `kernel_ops = 41`, `user_invocable = 29
after SECTION landed`, and a 12-name forbidden list. Each was re-measured rather than trusted:

| claim | first measurement (`b793ebe1`) | final (merged base) |
|---|---|---|
| `kernel_ops = 41` | **46** — 41 was this figure *minus* the six SURFACE ops | **47** — 41 was the execution branch's own count before #146 merged into it |
| `user_invocable = 29 "after SECTION landed"` | **28**, and `SECTION` was genuinely absent | **29**, and `SECTION` is genuinely present. **The briefing was right and the first measurement was right — about different trees.** #165 had landed on the execution branch but not on `archdisc`, and the first merge took `archdisc`'s side of the history |
| `forbidden = 12` | **18** | **18** — the 12 named plus #146's six SURFACE ops. `SECTION` is **not** among them: #165 made it user-invocable, which is the whole difference between #165 and #146 (§10.2) |

**The lesson is not "the briefing was stale".** It is that *a capability's presence is a property
of a REF, not of a repository*, and two long-lived branches can each be correct and disagree. Say
which ref, always. `ARC` is confirmed **genuinely absent** from `opFromName` on every ref checked.

## 10.1 What was retired this pass, and the citation for each

Three files, 528 lines. Every one verified by **execution** or by a **named, present**
replacement — never by extension, and never by "nothing calls it".

| File | Lines | Why it could go |
|---|---:|---|
| `frontend/src/forge-v4/assemblyBuilder.js` | 480 | **PROVED NON-EXECUTABLE BY RUNNING IT.** Line 18 is a *static* `import { MultiResolutionPart, buildInstancedAssembly, frustumGroupCull } from './MassiveAssembly.js'`. There is no `frontend/src/forge-v4/MassiveAssembly.js`; the module is at `frontend/src/foundation/MassiveAssembly.js`. Under a node resolve hook that stubs only *bare* specifiers (so `three` cannot mask the failure), importing it raises `ERR_MODULE_NOT_FOUND` on `.../forge-v4/MassiveAssembly.js` before line 1 of its 480 runs. **Negative control in the same harness: `frontend/src/foundation/MassiveAssembly.js` imports cleanly.** Its own first line calls it a `SCAFFOLD (workflow-designed, 2026-06-15) … wire + perf-verify before demo use`. Zero importers anywhere (the sole tree-wide hit is prose in `docs/SCOPE_2026-06-21/research/enterprise_uiux.md:209`). `frontend/vite.config.js` declares no alias and no second `rollupOptions.input`, so it cannot enter the bundle either. **No C++ citation is owed: a file that cannot execute has no behaviour to replace.** Same standard as `forge-v3-shell.spec.js` in T0 and `forge-v3-live.spec.js` in §9.1. |
| `forge-kernel/test/ge9x_shell_section_verify.mjs` | 26 | A self-declared **"SUPERSEDED SHIM"** whose whole body is `spawnSync(process.execPath, [LEAP])`. It names its own replacement — `forge-kernel/test/leap1a_shell_section_verify.mjs` — which is **present (165 lines)** and cited from the builder itself at `frontend/src/forge-v4/ge9xBuilder.js:48`. Its header states why: the flagship turbofan was re-targeted GE9X → CFM LEAP-1A, so *"the GE9X-specific assertions in the old version of this file … no longer describe the geometry."* Zero external references (positive control on the same grep: `leap1a_shell_section_verify` returns 7 hits across 3 files). **This is the node twin of `demo-ge9x-full-process.spec.js`, retired in #158 on the identical argument** — an old Forge *demo target* retired by a newer one, and labelled as such rather than dressed up as a C++ citation. |
| `forge-kernel/test/camx_gcode_peek.cjs` | 22 | A strict **subset** of its sibling `camx_smoke.cjs` §5: the same `square`, `pocketToolpath([square], 1, {depth:10, stepdown:5, stepover:5, direction:'climb'})` and `postProcess(…, {spindleRPM:10000, feed:1200, safeZ:10, toolId:1})` for the same three dialects — **byte-identical arguments on every call**. It records strictly *less*: `camx_smoke.cjs` keeps `fanucHasM30`, `heidHasBeginPgm`, `siemHasG54` and nine more named properties; the peek prints `.split('\n').slice(0,15)` and keeps nothing. And it carries **zero assertions of any kind** — measured, `0` hits for `assert\|expect(\|process.exit(1)\|throw` (positive control: `knit_surface_smoke.js` returns 8). By this repository's own `CMakeLists` **"2b"** standard — *"a test that cannot fail … is worse than no test"*, the measurement that excludes `native_hlr_perf` — it was never evidence. |

**Measured effect on the ledger:**

```
orphaned forge-kernel/test JS   201 -> 199
F1  frontend/src/forge-v4       605 -> 604 files   (250,558 -> 250,078 LOC)
F10 forge-kernel/test JS        242 -> 240 files   ( 35,785 ->  35,737 LOC)
candidate set total           1,799 -> 1,796 files (543,742 -> 543,214 LOC)
frontend files with an unresolvable relative import   1 -> 0
```

**Gates run, before AND after, all green:** the three frontend guards that are the whole of the
default branch's `npm test` — `brand-guard.test.mjs`, `deps-allowlist.test.mjs`,
`bridge-prompt-contract.test.mjs` (`102 prompt ids ⊆ 164 bridge verbs`). Plus the full
`ui/test/run_ui.sh` (**19/19**) and `ui/test/run_op_constraint_gate.sh` (**9/9 mutations
caught**) for the merge. No workflow, `package.json` script, `CMakeLists.txt` or shell harness
names any of the three deleted files — grep positive-controlled on `native_binding_smoke`,
which the same command finds in both `package.json` and `kernel-tests.yml`.

### What was examined and NOT deleted — the honest half

* **`frontend/src/kernel/features/**` — 8 files, 2,509 LOC, self-declared *"the DEAD PRE-OCCT
  DEMO KERNEL"*, quarantined 2026-05-23.** This is the single most literal "old Forge version"
  found in three passes, and it **cannot go**, because five files still import it. See §10.4.
* **`projects/ge9x/` (11 files, 1,606 LOC).** Zero references outside itself, and the flagship it
  targets was re-targeted to the LEAP-1A (which is why the shim above could go). But it is a
  self-contained *deliverable generator* with its own JS geometry library and no `forge-kernel`
  dependency at all, and there is **no `projects/leap1a/`** to supersede it. Retiring a demo
  target needs a replacement demo target, not a reachability fact. **Blocker, not a deletion.**
* **`forge-kernel/test/camx_smoke.cjs` (61 lines).** Also assertion-free, also hardcoding an
  absolute path. **Kept**, because unlike the peek it is the only *written statement* of which
  G-code markers each dialect must emit (`fanucHasO0001`, `heidHasToolCall`, `siemHasT1M6`, …).
  That list is worth transcribing into a C++ gate; it is not worth deleting first. Recorded as
  **B12**.
* **`forge-kernel/test/knit_surface_smoke.js`, `thicken_surface_smoke.js`,
  `trim_surface_smoke.js`.** These looked like the obvious harvest from #146, and they are not.
  See §10.2.
* **All 404 `e2e/` specs — a second probe that found nothing, reported because it did.** The
  assertion-count filter that retired `camx_gcode_peek.cjs` was run over the whole of `e2e/`:
  **13 of 404** files contain no `expect(`, `assert`, `throw` or `exit(1)`. **Ten of the thirteen
  assert anyway**, through `page.waitForSelector(..., {state:'visible', timeout})`, which *throws
  on timeout* — a real behavioural check that carries no assertion keyword. **A grep for
  assertion syntax is not a measure of whether a file asserts**, and this is the same shape as the
  §9.3 correction: the instrument's own blind spot has to be read out before its output means
  anything. One of the thirteen is `playwright.headless.config.js`, a config and not a spec. The
  remaining two — `v4-console-debug.spec.js` and `v4-kernel-introspect.spec.js` — are the two
  §9.1 already examined and kept, and re-reading `v4-kernel-introspect.spec.js` sharpens the
  reason: it is not a weak test, it is **an instrument**. It walks `window.forge` at runtime and
  writes the live binding surface to `/tmp/forge-kernel-surface.json` — the **runtime counterpart
  to B5's static 445-key `contextBridge` count**, and the only thing in the tree that can say what
  that surface contains when the app is actually running. Deleting it would delete the measuring
  device for the blocker it serves.
* **The 199 remaining orphans.** §9.3's finding survives re-measurement. My own dead-import
  probe, run independently over all five JS scopes, reproduces it exactly: `forge-kernel` **0**,
  `electron` **0**, `projects` **0**, and `e2e` **1** — which is
  `e2e/forge/v4-skeleton.spec.js`, and its two flags are the *same two false positives* §9.3
  documented (both specifiers sit inside `page.evaluate()` and resolve in the renderer; the
  second is `.catch(() => null)`-guarded). An independent instrument reproducing a prior result,
  including its false positives, is the strongest thing that can be said for either.

## 10.2 #146 SHIPPED A TYPE AND A GRAMMAR. IT SHIPPED NO DOOR. #165 SHIPPED THE DOOR.

The pass expected #146 (SURFACE as the fourth IR value kind) to retire the three surfacing JS
smokes. It retires none of them, and the reason is worth more than the deletion would have been.

**All six of #146's new kernel ops are FORBIDDEN.** `archie_op_vocabulary.json` `forbidden_ops`
went 12 → 18, and the six added are exactly `CAP`, `FACES`, `SEW`, `SKIN`, `SURFCHECK`,
`THICKEN` — each carrying the generated reason *"no command in the forge::ui registry emits it,
so no user can produce it."* The registry did not move at all across #144 and #146.

**#165 is the control that proves the point.** It landed `SECTION` the *other* way — an op **and**
a `forge::ui` command (`part.section_curve`), taking the registry 41 → 42 and user-invocable ops
28 → 29. `SECTION` is therefore **not** in `forbidden_ops`, while all six of #146's ops are. Two
capability PRs, one week, one difference: **whether a command emits the op.** That is the whole
of §10.2 in one comparison.

**And gate 3 is 15.9% after all three PRs**, including #165's — because coverage measures
*overlap with the JS tool surface*, and `part.section_curve` has no JS tool to overlap. A door
that opens onto ground the JS app never covered raises capability without raising coverage. Both
readings are correct and they answer different questions; do not use one as evidence for the
other.

**And the C++ tests #146 added are PARSE-level, by their own declaration.**
`forge-kernel/test/ft/surface_round_trip_test.cpp:12-16` says so in its header: it *"links
`FeatureTreeCompiler.cpp` for `parse()` and leaves `compile()`'s kernel symbols unresolved …
So this is a PARSE-level gate: it proves the grammar, the op table, the arities and the tolerant
repairs agree. **It does not build geometry and does not claim to.**"*

So the three surfacing JS smokes stand, and here is precisely what each still holds alone:

| JS file | What it asserts that no C++ gate does |
|---|---|
| `knit_surface_smoke.js` | two adjacent 100×60 patches → `surfacing.sew` → **area 12000** → `part.thickenSurface(4)` → **volume 48000** and **CoM x = 100**. A vector of observables on the knit→thicken *pipeline*. The nearest C++ harness, `native_vs_occt_sew.cpp`, asserts a **topology signature** (free-edge count, closed, F/E/V) on **box faces** — a different subject entirely. |
| `thicken_surface_smoke.js` | thicken geometry, against `ab_native_thicken_occt.cpp`'s different fixture set |
| `trim_surface_smoke.js` | trimmed-face behaviour, vs `native_vs_occt_trimmed_face.cpp` |

**The lesson, stated for the next pass:** a new *value kind* plus a new *op table entry* plus a
*parse gate* is three-quarters of a capability and zero of a deletion. Nothing becomes
retireable until a `forge::ui` command emits the op and a gate builds the geometry. This is the
same shape as D-021's original finding, one layer up.

## 10.3 B11 IS CLEARED — and the claim behind it was false when it was written

`.github/workflows/build-app.yml` is **not on the default branch**, and has not been since
`50c512e4` (2026-08-28, *"ci: drop the Electron desktop pipeline; make the pure-C++ kernel gate
primary"*).

```
$ git ls-tree origin/archdisc --name-only .github/workflows/
.github/workflows/desktop-release.yml
.github/workflows/kernel-tests.yml

$ git merge-base --is-ancestor 50c512e4 origin/archdisc && echo ancestor
ancestor
```

The plan asserted the opposite in **four** places (§4.1 twice, §4.2, §5 T6) plus B11 — including
the sentence *"`git ls-tree origin/archdisc -- .github` lists only `build-app.yml` and
`kernel-tests.yml`"*, which today returns the two files above and neither of the two named.
All four are struck in place.

**This is not staleness. `50c512e4` predates the first pass.** §9.6's *"Cleared since the first
pass"* note ran exactly this command to confirm `desktop-release.yml` had **arrived**, and did
not notice in the same output that `build-app.yml` had **left**. *A command run to confirm one
expectation will not volunteer the other half of its own answer.*

**Consequences:** B11 is cleared. T6's entry condition loses half. And §4.2's list of "CI jobs
that would go red" loses its only entry for F1–F5 / F8 / F12 — **nothing in CI builds the JS app
on any branch**, so the entire frontend and electron tree now breaks *no workflow*. What still
stops it going is B2/B3/B7 (no C++ owner, no A/B oracle) and B10 (the artifact) — never CI.

## 10.4 A NEW, PRECISE BLOCKER: Model C, the dead kernel inside the dead kernel

`frontend/src/kernel/index.js:39-75` carries a banner that names itself:

> *"@deprecated SP-1 S7 — Model C (kernel/features/\*) — QUARANTINED 2026-05-23. The classes
> below are the **DEAD PRE-OCCT DEMO KERNEL**. … Model C is NOT on that production path. These
> exports are KEPT FOR BACKWARD COMPATIBILITY ONLY."*

Eight files, **2,509 LOC**: `PrimitiveBuilder`, `ExtrudeFeature`, `RevolveFeature`,
`FeatureTree`, `BooleanEngine`, `FilletChamfer`, `LoftSweep`, `DirectEdit`. This is a *third*
geometry kernel — one inside the JS kernel that T1 is about — and it is the most literal
instance of "an old Forge version" in the repository.

**Its keep-justification was re-measured, and it is 5/6 still true.** The banner names six
consumers. Measured on `b793ebe1`:

| consumer named in the 2026-05-23 banner | still imports Model C? |
|---|---|
| `kernel/standards/FastenerLibrary.js` | **yes** — 4 imports (`PrimitiveBuilder`, `ExtrudeFeature`, `RevolveFeature`, `BooleanEngine`) |
| `kernel/standards/BearingLibrary.js` | **yes** — 2 |
| `kernel/turbomachinery/HollowBlade.js` | **yes** — 3 |
| `kernel/turbomachinery/TurbomachineryBlade.js` | **yes** — 1 (`LoftSweep`) |
| `kernel/agents/AgentBridge.js` | **yes** — 7 |
| `ToolExecutionEngine.js` *"one fallback path … Insert Component"* | **THE FILE DOES NOT EXIST.** `git ls-files` finds no `ToolExecutionEngine.js` anywhere in the tree; only prose references survive, including one inside Model C itself. |

So Model C is pinned by **five** files, all inside `frontend/src/kernel`, all named — a bounded
job that needs **no C++ at all**: it is JS-to-JS, decoupling five modules from an old JS kernel
in favour of the newer `kernel/brep/*` OCCT facade the banner already points at. Recorded as
**B13**. It is the cheapest genuine progress available on F2 that does not wait on B2's A/B
oracle.

## 10.5 THE BLOCKER LIST A FOURTH PASS STARTS FROM

Re-measured on `b793ebe1`. **Changed rows are marked.** Ordered by cost, cheapest first.

| # | Blocker | Blocks | What has to be built | Dev ID? |
|---|---|---|---|---|
| ~~B11~~ | ~~`build-app.yml` on the default branch ships the JS app~~ | — | **CLEARED §10.3.** Not on `origin/archdisc` since `50c512e4` (2026-08-28). Nothing in CI builds the JS app on any branch. | — |
| B1 | `native_vs_occt_fillet_var` is RED on a real disagreement | T2 (2 files) | **UNCHANGED.** Resolve OCCT-vs-closed-form on the variable fillet: native `4.6e-15` rel, OCCT `4.444e-05`, threshold `1e-6`. Still one of exactly **2** deliberate `FORGE_AB_GATES` exclusions (the other is `native_vs_occt_iges`) | no |
| B1b | One harness is unaccounted for by every runner | nothing | **NARROWED.** `tkoffset_gh_quality_probe` (210 lines) is not evidence-orphaned — `forge-kernel/reports/TKOFFSET_GH_DEFER_CENSUS.md:188` records a run of it over 142 parts. What is still missing is only the `CMakeLists` "2b" entry, and that entry needs an **rc measurement I did not take** (it links OCCT; the resource budget for this pass forbade the build). Do not close it without one. | no |
| B2 | No gate compares the JS kernel to `forge_kernel_core` | T1 (cond. 1) | **UNCHANGED.** A per-op A/B asserting a **vector** of observables, plus a positive control that the two arms differ. All 45 `FORGE_AB_GATES` compare `forge_kernel_core` against **OCCT**, never against the JS kernel | no |
| B3 | 5 files couple the app to the JS kernel | T1 (cond. 2) | **UNCHANGED at 5** — `kernel/forge/{index,RebuildEngine,ReferenceGeometry,Drawings}.js` + `kernel/forge/drawings/TitleBlocks.js`. #144/#146/#157 were all C++-side and touched no frontend file | no |
| B4 | Orphans have no per-file evidence transcription | T2 | **201 → 199** (§10.1). The two retired here were the only two that could be argued on their own contents; the ~120 `smoke-*.js` remain JS tests of **C++ engineering solvers** reachable only through the N-API layer, with no C++ test | no |
| B5 | `forge_capi.h` does not reach the 445-binding surface | T3 | **QUANTIFIED.** `forge-kernel/include/forge/capi/forge_capi.h` exports **27** `FG_API` functions; `forge-kernel/test/capi/forge_capi_smoke.cpp` exercises **20** of them — the seven untouched are `FgCopyBody`, `FgCreateCone`, `FgCreatePrism`, `FgCreateTorus`, `FgLastError`, `FgShell`, `FgVersion`. Against the renderer's 445 function-valued `contextBridge` keys that is **27/445 = 6.1%** | no |
| B6 | `kernel-tests.yml` runs node in 18 places | T3 | **RE-MEASURED, UNCHANGED: 18** in `kernel-tests.yml`, 22 in `package.json`, 15 in `forge-kernel/CMakeLists.txt` = **55** lines across 5 files. `desktop-release.yml` and `forge-desktop/CMakeLists.txt` still name node **zero** times | no |
| B7 | No C++ owner for `frontend/src/foundation` (171 files) or the AI bridge | T4 | **UNCHANGED.** `bridge-prompt-contract.test.mjs` must move first — it is one of the three files that are the whole of the default branch's `npm test` | no |
| B8 | Gate 3 at **15.9%** | T5 | **UNCHANGED, AND THAT IS THE FINDING (§10.2).** Three capability landings (#144, #146, #165) moved it by **zero** — even #165, which *did* add a registry command. Needs ~24 more `part` commands; **all** of `simulate` (29), `drawing` (12), `assembly` (8), `manufacture` (5); and the sketcher — where the solver is **already vendored, built and linked** (`3rdParty/planegcs`, `src/Sketcher.cpp`) and only the `forge::ui` door is missing | no |
| B9 | `data-testid` assertions have no native harness | T5 | **THE 1,170 FIGURE IS NOT REPRODUCIBLE, and this row does not pretend to correct it.** Four definitions were measured and none gives 1,170: occurrences across `e2e/` + `frontend/src` = **9,769**; `getByTestId`/`data-testid=` in `e2e/` = **5,279**; unique `data-testid` *values* declared in `frontend/src` = **3,720**; unique `[data-testid="…"]` selectors *used* in `e2e/` = **2,763**. The last is the number this blocker actually wants — distinct UI anchors an automated harness would have to reach — so **read B9 as ~2,763, and restate the blocker in those words.** MATCH THE FIELD, NOT THE LINE: an unreproducible figure is replaced by a defined one, not overwritten by a bigger one. `forge_desktop_click_gate` remains the first instalment; #157's `forge_desktop_isolation_gate` is crash survival, a different axis, not progress here | no |
| B10 | No Gatekeeper-acceptable bundle | T5, T6 | **UNCHANGED. Still the only blocker needing the credential.** | **YES** |
| **B12** | **NEW.** `camx_smoke.cjs` is the only written statement of the G-code dialect contract | T2 (1 file) | Transcribe its twelve named markers (`fanucHasPercent/O0001/M30`, `heidHasBeginPgm/EndPgm/ToolCall`, `siemHasG54/T1M6/Header`, plus the three line counts) into a C++ gate over `GcodePost.cpp`. `test/native/cam/cam_test.cpp` covers material removal, collision and probing — **not** toolpath generation or post-processing | no |
| **B13** | **NEW.** Model C, the quarantined pre-OCCT JS kernel, is pinned by 5 named importers | T1 (8 files, 2,509 LOC) | Decouple `FastenerLibrary`, `BearingLibrary`, `HollowBlade`, `TurbomachineryBlade` and `AgentBridge` from `kernel/features/*` onto `kernel/brep/*`, the facade the deprecation banner already names. **Needs no C++ and does not wait on B2** — see §10.4 | no |
| **B14** | **NEW.** `projects/ge9x/` has no successor demo target | T6 (11 files) | The flagship re-targeted GE9X → LEAP-1A, but there is no `projects/leap1a/`. Either port the deliverable generator or record the decision to drop the deliverable | no |

**Of the fourteen open blockers, exactly one — B10 — needs the Developer ID.** That was true at
the second pass and survives re-measurement with three blockers added and one cleared.

## 10.6 Corrections to the second pass

| § | Said at `12a09d37` | Measured at `b793ebe1` |
|---|---|---|
| §2.3 | registry **30**, user-invocable ops **18**, under the heading *"counted from source on this tree"* | **42** and **29** (and **41**/**28** before #165 merged in mid-pass). Stale by 12 and 11 since #140, and the two figures feed the coverage percentage. **Corrected in place** |
| §2.3 / §2.4 | coverage **11.0%**, ratio **30/445** | **15.9%**, **42/445**. §9.2 had already found the coverage figure; §2.3/§2.4 still stated the old one, which is D-027 for the third time in one document |
| §2.3 | C++ kernel ops — *(not stated)* | **47** = 40 + 6 (#146) + 1 (#165). Two branches each moved it from 40 without seeing each other; `ui/test/feature_ir_test.cpp` was resolved to the measured merge, not to either side |
| §2.3 | *"the gap … includes every primitive creator"* | **false since #140** — 8 of 13 creators are matched with file:line on both sides. Five remain |
| §2.3 | **14** C++ commands have no JS counterpart | **17**, listed in full |
| §2.4 | forge-kernel registers **44** A/B gates | **45** (§9.7 found this; §2.4 still said 44) |
| §4.1 ×2, §4.2, §5 T6, B11 | `build-app.yml` is on the default branch and ships the JS app | **It is not, and was not when written** (`50c512e4`, 2026-08-28). Four claims struck, B11 cleared — §10.3 |
| §9.4 | `tkoffset_gh_quality_probe` is *"unaccounted for by every runner"* | true of runners, but a **report records a run of it** over 142 parts (`TKOFFSET_GH_DEFER_CENSUS.md:188`). Narrowed, not cleared |
| §9.6 B9 | **1,170** `data-testid` assertions | **not reproducible under four definitions** (9,769 / 5,279 / 3,720 / **2,763**). The defined quantity the blocker wants is **2,763** unique `[data-testid="…"]` selectors used in `e2e/`. Recorded as a restatement, not a correction — the original field is unknown |
| — | *(not measured)* | Model C — 8 files, 2,509 LOC of self-declared **dead pre-OCCT kernel** — is pinned by 5 named importers, and the 6th named consumer no longer exists (§10.4) |
| — | *(not measured)* | all six of #146's SURFACE ops are **forbidden**; the registry did not grow across #144 or #146 (§10.2) |

## 10.7 The one-line answer, third pass

**Seven files are now retired across three passes, B11 is cleared, and the single most useful
measurement this pass made is a number that did not move: THREE capability landings (#144, #146,
#165) changed gate 3 by zero — #146 because SURFACE shipped as a type, a grammar and a parse gate
with no `forge::ui` command to emit it, and #165 because the command it DID add opens onto ground
the JS tool surface never covered.** The next tranche is still
not blocked on Apple — thirteen of fourteen blockers need no credential — and the cheapest real
progress left is **B13**: eight files of a self-declared *dead pre-OCCT kernel*, pinned by five
named JS importers, needing no C++ and waiting on no oracle.
