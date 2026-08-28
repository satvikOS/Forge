# ZERO-JS MIGRATION MANIFEST — Track Z1

Authored 2026-08-28. Every number below is `git ls-files` + `wc -l` on this worktree at the
commit under review, or the literal output of a command quoted in-line. Nothing is estimated.

---

## 0. The measured ground truth

| Language | Tracked files | LOC |
|---|---:|---:|
| JS family (`.js .jsx .mjs .cjs`) | **1,766** | **515,638** |
| C++ family (`.cpp .hpp .h .cc .hxx`) | 1,135 | 346,287 |
| TypeScript (`.ts .tsx`) | **0** | 0 |

JS exceeds C++ **1.49 : 1** by line count. This is a majority-of-codebase rewrite, not a trim.

**THERE IS ZERO TYPESCRIPT.** `git ls-files '*.ts' '*.tsx'` returns **0**. The 124 `.ts` paths seen
on disk are CMake `compiler_depend.ts` timestamp stubs in build trees — untracked build residue.
Any manifest that schedules `*.ts` for deletion is describing a file set that does not exist.

### Complete file accounting (sums to 1,766 — no group is unlisted)

```
frontend                         files=1103   loc=386186   (of which frontend/src/kernel = 239 / 69265)
e2e                              files=408    loc=90124
forge-kernel/test                files=238    loc=34174
projects                         files=10     loc=1604
electron                         files=3      loc=2417
scripts                          files=2      loc=1019
tools                            files=1      loc=82
playwright.config.js             files=1
                                 -----------------------
                                 1766
```

---

## 1. Behavior-group migration table

Status vocabulary: **ALREADY-NATIVE** (a C++ owner exists and is proven today) · **MAPPED** (owner
named, acceptance test named, not yet built) · **UNMAPPED** (no C++ owner exists; design work
outstanding) · **DEFERRED** (deliberately last).

| # | Path / group | Files | LOC | What it DOES | Callers | Native C++ owner that must exist FIRST | C++ acceptance test that must exist FIRST | Data migration | Status |
|---|---|---:|---:|---|---|---|---|---|---|
| G1 | `forge-kernel/src/binding*.cpp` + `src/ft/binding_ft.cpp` | 5 | **19,616** | N-API translation layer: marshals JS values to/from OCCT and native types for ~445 kernel entry points. `binding.cpp` alone is **17,878 lines** — the largest tracked C++ file in the repo. | `electron/preload.js` via `dlopen` | *None needed* — this is glue to DELETE, not to port. Its callees are already C++. The replacement surface is the existing `include/forge/capi/forge_capi.h` (K7 opaque-handle C ABI). | `test/capi/forge_capi_smoke.cpp` (exists) extended to the 445-function surface | none | **MAPPED** — deletion is gated on G3/G7, not on new geometry work |
| G2 | `frontend/src/kernel/**` | **239** | **69,265** | **A SECOND, INDEPENDENT GEOMETRY KERNEL WRITTEN IN JAVASCRIPT.** Subdirs: `forge`(63) `brep`(43) `topology`(26) `atomic`(19) `production`(11) `features`(8) `export`(8) `rendering`(6) `math`(6) `manufacturing`(6) `simulation`(5) `pdm`(4) `standards`(3) `realworld`(3) `bridge`(3), plus turbomachinery/thermodynamics/tessellation/sketch/history. Directly duplicates shipped C++: `brep/BrepBoolean.js`, `features/BooleanEngine.js`, `features/FilletChamfer.js`, `tessellation/Tessellator.js`. | `frontend/src/forge-v4` UI | `forge_kernel_core` (**exists and links — see §2**) reached through `forge_capi.h`. Per-file owners are `src/native/brep/*`, `src/native/csg/*`, `src/native/mesh/*`. | An A/B oracle per duplicated op, in the shape of the existing `test/native_vs_occt_core` gate, asserting JS-kernel result == C++ result before the JS is cut | none (stateless compute) | **MAPPED** — highest-value deletion: 69k LOC of *duplicate kernel*, the single largest correctness liability in the tree |
| G3 | `frontend/src/forge-v4/**` | **576** | ~200k | The Forge IDE itself: viewport, model tree, property panels, 16 icon modules, workbenches (`WormGearWorkbench.jsx`, …), sciviz(7), theme(4), pdm(4), io(4), drawing, assembly, ecad, plm, ml, rationale. | Electron renderer | `forge_ui_probe` (Dear ImGui + Vulkan/MoltenVK, `FORGE_BUILD_DESKTOP_UI`) — **scaffold only**: it renders a *representative* IDE to an offscreen PNG; it is not the app. | A headed UI gate replacing the 404 Playwright specs (G5) | user layouts / theme prefs | **UNMAPPED** — the largest genuine rewrite. ImGui probe is not a shipped IDE. |
| G4 | `frontend/src/foundation/**` | **171** | — | Engineering-domain libraries: `AssemblyCost`, `AssemblyMate`, `AssemblySequence`, `Bearing(s)`, `BladeCooling`, … Real engineering logic, not UI. | forge-v4, `frontend/src/kernel` | No C++ owner exists for most of these. Nearest peers are the `src/native/*` analysis modules. | Per-module numeric gates against current JS output | standards / material tables become C++ data or an embedded resource | **UNMAPPED** |
| G5 | `e2e/**` (404 Playwright specs) | **408** | **90,124** | The entire end-to-end behavioral gate for the product. | CI, `playwright.config.js` | Playwright drives a *browser*. If G3 becomes a native desktop app these do not port — they must be **re-authored** against a native UI-automation harness. | A native UI-driver harness, which does not exist today | none | **DEFERRED** — cannot start before G3 lands; re-authoring, not porting |
| G6 | `forge-kernel/test/**` (162 `.js` + 71 `.mjs` + 5 `.cjs`) | **238** | **34,174** | The C++ kernel's **entire** acceptance harness — every OCCT-drop gate, `native_vs_occt_core` A/B, `ft_smoke`, `directedit`, `healing_smoke` cited throughout `CMakeLists.txt` as the evidence for shipped drops. | `BUILD_AND_VERIFY_RIGOR.sh`, CI | 193 `.cpp` tests already exist beside them: `test/native`(142), `milestones`(37), `ft`(4), `capi`(1). | **PREREQUISITE, MISSING:** `grep -n "add_test\|enable_testing\|ctest" forge-kernel/CMakeLists.txt` returns **nothing**. The 193 C++ tests are built by ad-hoc per-test shell scripts (`test/build_*.sh`). There is no CTest driver. | golden fixtures (`test/fixtures`, 3) already file-based | **MAPPED** — *the correct next deliverable after §2*, and the most dangerous group: deleting it removes the evidence base for every OCCT drop already claimed |
| G7 | `electron/preload.js` | 1 | 1,635 | `dlopen`s `forge-kernel.node` and `contextBridge`-exposes **445 wrapped kernel functions** as `window.forge.*` (measured: 445 `name: (` bindings). **The kernel surface bypasses IPC entirely** — only 24 `ipcMain` channels exist (measured), so a native replacement must reproduce a 445-function surface, not 24. | renderer | `forge_capi.h` (K7) — already the right shape (opaque handles, strict `extern "C"`) | `forge_capi_smoke.cpp` at 445-function coverage | none | **MAPPED** |
| G8 | `electron/main.js`, `electron/pdmVault.js` | 2 | 782 | App lifecycle, window management, the 24 IPC channels; PDM vault file I/O. | Electron | `forge-desktop/` app shell (`FORGE_BUILD_DESKTOP_FOUNDATION` / `_RENDERER` / `_UI`) | foundation / renderer / ui probes (exist, scaffold-level) | **PDM vault on-disk format must become readable by C++** | **MAPPED** |
| G9 | `scripts`(2/1019), `tools`(1/82), `projects`(10/1604), `playwright.config.js` | 14 | ~2,705 | Build/utility scripts and sample project fixtures. | dev tooling | shell or a small C++ CLI; `projects/*` are data fixtures | n/a | `projects/*.js` fixtures become declarative IR | **DEFERRED** — trivial tail, no leverage |

### What is ALREADY-NATIVE today (proven in §2, not asserted)

`forge_kernel_core` (414 TUs, 21.8 MB dylib), `forge_foundation_probe`, `forge_verify`,
`forge_mesh_probe`, `forge_step_probe`, `forge_feature_probe`. `forge_verify` in particular already
**replaces a Node worker inside the verification path**, and is exercised node-free in §2.4.

---

## 2. THE LOAD-BEARING QUESTION — how does forge-kernel stop requiring node-addon-api to compile?

### 2.1 What was already there, and why it was not enough

The brief asks whether `FORGE_NATIVE_BREP` already excludes `binding.cpp`. **It does not** — that
option gates the in-house B-rep *code path*, not the N-API layer. The target that actually excludes
the binding TUs is **`forge_kernel_core`**, added under `FORGE_BUILD_DESKTOP_FOUNDATION` (OFF by
default). It filters `binding*.cpp` out of the source list and links no `CMAKE_JS_LIB`.

**But it could not be configured without Node, and it had never linked.** Two defects:

**Defect 1 — the FATAL_ERROR is unconditional.** `CMakeLists.txt:101` aborts *configure* before any
target is considered. Measured baseline in this worktree (which has no `node_modules`), asking for
**only** the node-free target:

```
$ cmake -S forge-kernel -B bl -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
CMake Error at CMakeLists.txt:101 (message):
  node-addon-api not found at .../forge-kernel/../node_modules/node-addon-api.
  Run `npm install` at repo root.
-- Configuring incomplete, errors occurred!
```

So `npm install` was a hard prerequisite of compiling **any C++ at all**, including the one target
whose entire purpose is to have no Node.

**Defect 2 — `forge_kernel_core` derived its sources from the `forge_kernel` target**
(`get_target_property(... forge_kernel SOURCES)`), so the node-free library could not exist unless
the `.node` target was declared.

### 2.2 Recommendation (implemented)

Of the three options offered — a CMake option for a pure library target, splitting `binding.cpp` out
of the core target, or a C ABI — **the correct answer is the first, and the other two are already
done.** `binding.cpp` is *already* out of `forge_kernel_core`, and the C ABI *already* exists
(`include/forge/capi/forge_capi.h`, K7). The only missing piece was making the N-API layer genuinely
**optional at configure time**. Adding a C ABI would have been redundant; splitting `binding.cpp`
again would have duplicated existing work.

Implemented in `forge-kernel/CMakeLists.txt` (+45 lines; no source file touched):

1. **`option(FORGE_BUILD_NODE_ADDON ... ON)`** — ON by default, so the cmake-js / CI build is unchanged.
2. The **entire N-API discovery block, including the FATAL_ERROR, is wrapped in it**. With it OFF,
   `node-addon-api`, `node`, and `node_modules` are never looked for.
3. The source list became a **variable** `FORGE_KERNEL_SOURCES` (contents byte-unchanged);
   `add_library(forge_kernel SHARED ${FORGE_KERNEL_SOURCES})` and every `forge_kernel` `target_*`
   command moved inside `if(FORGE_BUILD_NODE_ADDON)`. The `.node` is now an **optional add-on target**.
4. `forge_kernel_core` reads the variable instead of the target, so it exists independently.
5. `FORGE_BUILD_NODE_ADDON=OFF` forces `FORGE_BUILD_DESKTOP_FOUNDATION=ON`, since otherwise nothing
   would be built at all.

### 2.3 A real defect this uncovered — `forge_kernel_core` had never linked

With configure fixed, all **414 TUs compiled with 0 errors**, and then `ld` failed with **40 undefined
symbols**. Classification of every one:

```
napi / node_api / v8:: / uv_ references : 0
Geom2d_*                (TKG2d) : Geom2d_{BSplineCurve,TrimmedCurve,Line,Circle,Ellipse,BezierCurve}
BRepAlgoAPI_* / BOPAlgo_* (TKBO) : Fuse, Cut, Common, Section, Splitter, Defeaturing, BuilderAlgo
```

**Not one Node symbol.** The cause is documented in `CMakeLists.txt` itself (the note at lines
212-227, "the direct-link count UNDERSTATES the closure"): TKBO and TKG2d reach the `.node` *only
transitively through TKFillet* and are not named on its link line. The `.node` survives this because
Darwin links it with `-undefined dynamic_lookup`, which **silently tolerates unresolved symbols**.
`forge_kernel_core` deliberately has no such flag — so it fails loud, and had been failing since the
K5.1 TKG2d drop.

Fix: `TKBO TKG2d` appended to **`forge_kernel_core` only**. The `.node`'s `OCCT_LIBS` is untouched,
so the `otool -L` direct-link series and every OCCT drop gate keep counting exactly what they counted
before — verified in §2.5.

### 2.4 PROOF — the core kernel configures, builds, and RUNS with node-addon-api absent

This worktree has **no `node_modules`** (`ls node_modules` gives `No such file or directory`), so the
absence is real, not simulated.

```
$ cmake -S forge-kernel -B nojs -DFORGE_BUILD_NODE_ADDON=OFF
-- Forge kernel: OCCT 7.9.3 at /opt/homebrew/opt/opencascade (pinned to 7.9.x)
-- Configuring done (0.2s)  /  -- Generating done (0.1s)

$ cmake --build nojs --target forge_kernel_core forge_foundation_probe forge_verify -j4
[100%] Built target forge_kernel_core / forge_foundation_probe / forge_verify
EXIT=0
  libforge_kernel_core.dylib  21,846,072 bytes
```

Targets offered by the generated build system — **`forge_kernel` (the `.node`) is absent**:
`forge_kernel_core, forge_foundation_probe, forge_verify, forge_mesh_probe, forge_step_probe,
forge_feature_probe`.

Node-freeness, measured on the artifact rather than asserted:

```
grep -ril 'node-addon-api|napi' over the whole generated build system : 0 files
otool -L libforge_kernel_core.dylib | grep -ci 'node|napi'            : 0
nm -u    libforge_kernel_core.dylib | grep -ci 'napi|node_api'        : 0
```

A binary that exists is not a passing gate, so both binaries were **run**:

```
$ ./forge_foundation_probe
  linked library : forge_kernel_core  (N-API binding EXCLUDED)
  [1] makeBox(10,10,10)       volume = 1000.000000000    (expected 1000)
  [2] makeCylinder(r=5,h=10)  volume = 785.398163397     (expected pi*25*10)
  [3] cut(box, cyl r=2)       volume = 874.336293856     (expected 1000 - pi*4*10)
=== ALL 12 CHECKS PASSED — PASS ===
```

```
$ echo '{"id":"cut","ir":"%1 = BOX(40,30,20)\n%2 = CYL(5,20)\n%3 = CUT(%1,%2)\n"}' | ./forge_verify
{"id":"cut","ok":true,"valid":true,"volume":22429.203673,"faceCount":7,"edgeCount":15,
 "genus":1,"shellCount":1,"bores":[{"r":5,"span":20,"axis":[0,0,1],"faces":1}]}
python3: expected vol = 22429.203673205102
```

Volume agrees to 10 significant figures, genus 1 confirms the through-hole is topologically real, and
the bore is detected at r=5 span=20 — the verifier is fully functional with Node absent.

### 2.5 PROOF — the default (CI) build is byte-identical

The original `CMakeLists.txt` was restored from `HEAD`, configured, and the generated `.node` build
compared against the patched tree's default configure (build-dir paths normalised):

```
CMakeFiles/forge_kernel.dir/build.make   diff_lines=0
CMakeFiles/forge_kernel.dir/link.txt     diff_lines=0
CMakeFiles/forge_kernel.dir/flags.make   diff_lines=0
target sets                              IDENTICAL
```

`.node` OCCT link line, unchanged — TKBO/TKG2d correctly **absent**:
`-lTKernel -lTKMath -lTKG3d -lTKBRep -lTKTopAlgo -lTKShHealing -lTKOffset -lTKFillet`

---

## 3. Ordered next steps

1. **Wire CTest into `forge-kernel/CMakeLists.txt`** (G6). There is no `add_test` / `enable_testing`
   today; the 193 C++ tests are built by hand-rolled `build_*.sh`. Until a native harness runs them,
   the 238-file JS test harness *cannot* be deleted without destroying the evidence for every OCCT
   drop already claimed. This is the true blocker on Z1, and it is now the cheapest one.
2. **Delete G2** (`frontend/src/kernel`, 239 files / 69,265 LOC) behind per-op A/B gates against
   `forge_kernel_core`. Largest correctness win available: a second kernel that can silently disagree
   with the first.
3. **Raise `forge_capi.h` to the full 445-function surface** (G7), then delete G1's 19,616 lines.
4. G3/G4 (the IDE and the engineering libraries) are the genuine multi-quarter rewrite. G5 follows G3.

## 4. Honest limitations

- The `.node` target was proven byte-identical at **configure** level; it was not compiled, because
  load average was ~20 on 14 cores (other agents active) and a second 414-TU build would have
  violated the one-heavy-job rule. The generated `build.make` / `link.txt` / `flags.make` diffs are
  zero, so a differing compile is not possible without a differing input — but the compile itself is
  UNVERIFIED.
- No benchmark numbers are reported here; the machine was loaded and any figure would be invalid.
- LOC totals differ slightly from the task brief (515,638 vs 515,774; 346,287 vs 350,643) because the
  brief's C++ extension set differs. The JS figure and all file counts reproduce exactly.

---

## 5. Z1 first-removal attempt — 2026-08-28. RESULT: ZERO FILES REMOVED.

The kernel now configures and builds with Node absent (§2), so the first `git rm` under s3.2 became
*possible*. Every candidate was carried to the s3.2 bar — **JS symbol → C++ symbol → C++ test that
asserts the same value** — and **every one of them failed it**. Nothing was deleted. What follows is
the per-candidate evidence, so the next pass starts from a measurement rather than a re-scan.

### 5.1 The bar actually applied

A row is removable only when **all three** hold. The third is the one every candidate died on:

1. A native C++ owner exists for the behavior.
2. A C++ test asserts the **same value** the JS asserted (not merely "a test exists nearby").
3. Deleting the JS breaks no live caller — the C++ is the shipped path, or the JS has no caller.

### 5.2 Candidate ledger

| Candidate JS | C++ owner considered | C++ test considered | Verdict and the measured reason |
|---|---|---|---|
| `frontend/src/forge-v4/ForgeShellV4.jsx` (3,657 lines) and the rest of G3 | `forge::ui` — `CommandRegistry` / `SelectionService` / `Keymap` / `DockLayout` / `WorkspaceProfile` / `ForgeShell` | `ui/test/*_test.cpp`, **6 gates / 2,421 checks, all PASS (run below)** | **NOT READY — no behavior overlap at all.** `grep -nE "registerCommand\|builtin\|Builtin" ui/src/CommandRegistry.cpp` returns **nothing**: the registry ships **zero product commands**. It is an empty mechanism whose gates register their own fixtures. And the JS shell has no command registry to compare against — `grep -oE "id: '[a-zA-Z0-9_.:-]+'" ForgeShellV4.jsx` returns **0** IDs; it is React with 40+ live imports and inline handlers. There is no JS symbol whose value a `forge::ui` check asserts. |
| `frontend/src/forge-v4/surfaceFairingMath.js` (1,127 lines) | `forge::native::mesh::taubinSmooth` (`src/native/mesh/Smooth.cpp`) | `test/native/mesh/smooth_test.cpp` (377 lines, randomized, strong) | **NOT READY — different algorithm, and a live caller.** `grep -c cotan src/native/mesh/Smooth.cpp` = **0**; the C++ is a *uniform umbrella* Laplacian (`Smooth.cpp:190`, "full uniform 1-ring umbrella Laplacian"). The JS assembles a **cotangent** Laplacian and adds a **bi-Laplace conjugate-gradient** solver: `assembleCotangentLaplacian`, `assembleSymmetricCotangentLaplacian`, `conjugateGradient`, `runBiLaplace`, `bendingEnergy` — none of which have a C++ owner. Different weights give different vertex positions, so `smooth_test.cpp` cannot assert what the JS asserts. Independently blocking: `SurfaceFairingPanel.jsx` imports it, so it is live product code. |
| `frontend/src/foundation/CompositeLaminate.js` (258 lines) — **verified zero callers repo-wide** | `forge::native::composites` — `reducedStiffness`, `rotatedQ`, `buildClt` (`src/native/composites/Composites.cpp`) | `test/native/composites/composites_test.cpp` (411 lines, closed-form oracles for Q̄(0/45/90), B==0 for `[0/90]s`, Ex==Ey balanced) | **NOT READY — 3 of 6 exports covered.** Covered: `plyStiffnessMaterialAxes`→`reducedStiffness`, `rotateStiffness`→`rotatedQ`, `laminateABD`→`buildClt`. **Uncovered:** `solveLaminate(stack,N,M)` — `CltResult` carries A/B/D and effective constants but **no ABD-inverse load→strain solve**; `tsaiWu` and `laminateFirstPlyFailure` — **no Tsai-Wu exists anywhere in the kernel**. The kernel says so itself, `include/forge/native/materials/Materials.hpp:53-56`: *"(b) FULL TSAI-WU / TSAI-HILL directional FAILURE INDEX … A 2D Tsai-Wu already exists in JS (frontend/src/forge-v4/compositesMath.js); the 3D native version is queued."* That sibling file has **3 live importers** (`compositeFea.js`, `CompositeFeaPanel.jsx`, `CompositesLayupPanel.jsx`). Deleting `CompositeLaminate.js` would delete the repo's only first-ply-failure criterion. |
| `frontend/src/forge-v4/topologyMap.js` (215 lines) — **verified zero callers repo-wide** | `forge::ft` `OpCode::Tag` (L4 TAG/@name, `include/forge/ft/FeatureTree.hpp:131`) | `test/ft/s0_acceptance_test.cpp` (761 lines) | **NOT READY — the C++ solves a different problem, by design.** TAG binds a persistent name to a **whole feature** at declaration time; `s0_acceptance_test.cpp` only asserts TAG **parses and is never counted as an orphan** (lines 106/115/123/718-723). It never re-resolves an entity across a rebuild. `topologyMap.js::resolveEntity` does **per-entity geometric re-identification** — exact content hash, then centroid-within-1 mm + adjacency-count match, then nearest-centroid-with-matching-adjacency. The C++ test at line 454 explicitly contrasts TAG *against* face-index selection, i.e. the kernel deliberately does **not** implement this. No owner, no test. |
| `frontend/src/foundation/NURBSStepExport.js` — zero callers | `exportStep` / `importStep` (exercised by `forge-desktop/step_probe.cpp`) | `step_probe.cpp` — AP242 write → import → re-export idempotence | **NOT READY — disjoint entity sets.** `step_probe` round-trips a **solid body**. The JS emits free-standing `B_SPLINE_CURVE_WITH_KNOTS` / surface collections (`exportNURBSCurve`, `exportNURBSSurface`, `exportNURBSCollection`). No C++ check asserts a bare NURBS-entity STEP export. |
| `electron/pdmVault.js` (G8) | — | — | **NOT READY — no owner exists.** `grep -rilE 'pdmvault\|pdm_vault\|PdmVault'` over `forge-kernel/ ui/ forge-desktop/` returns **nothing**. |
| `forge-kernel/test/**` (G6) | 193 `.cpp` tests | — | **NOT READY — blocker unchanged and re-verified.** `grep -nE "add_test\|enable_testing\|include\(CTest\)" forge-kernel/CMakeLists.txt` still **exits 1 with no output**. The directory holds 162 `.js` + 65 `.mjs` at top level. Also explicitly retained as transitional per the track brief. |
| `tools/push-210-smoke.mjs` (G9, 82 lines) | — | — | **NOT READY — it is a test, not a behavior.** It asserts against `surfaceFairingMath.js`, which stays (row 2). Deleting a gate whose subject remains is weakening a test. |

### 5.3 Supporting measurement — an unreferenced-JS scan, and why it authorizes nothing

To be sure no easy row was being missed, every tracked JS file was checked for **any** textual
reference anywhere in the repo. Method: concatenate all 3,468 tracked text files (54,598,273 bytes),
tokenize once (`tr -cs`, both dot-preserving and dot-splitting, 359,619 + 259,256 tokens), and keep
a file only when **both** its basename-with-extension and its stem are absent from the token set.

Result: **352 of 1,766 JS files carry no textual reference.** That number is *not* a deletion list:

- **184 are live gates reached by a runner glob, not by name** — 158 `e2e/**` Playwright specs
  (`playwright.config.js` `testDir`) and 26 `__tests__/*.test.mjs` suites. Unreferenced by name,
  fully alive. Deleting any of them is weakening a test.
- **124 are under `forge-kernel/test/`** — retained transitional OCCT coverage, off-limits.
- 1 is `frontend/eslint.config.js`, found by the linter by convention, not by import.
- The genuine remainder is **43 dead files** in `frontend/src/{foundation,tools,systems,utils,ai}`
  (`BladeRow`, `BoltedJoint`, `BucklingAnalysis`, `FrameFEM`, `PlateFEM`, `SpringCoil`,
  `StressConcentration`, `WeldFatigue`, `MaterialSystem`, `ModifierSystem`, `*Tools.js`,
  `layoutManager`, `CertificationMatrix`, `coherenceGate`, `panelMethodMath`, `topologyMap`, …).
  Spot-checked with a full-tree `grep`: `topologyMap`, `coherenceGate`, `panelMethodMath` and
  `CertificationMatrix` have **literally zero** occurrences outside their own file.

**None of these were deleted, and that is the correct outcome.** s3.2 authorizes removal only through
a mapping to a C++ symbol and a C++ test. These files have **no** C++ owner — deleting them would be
an *unmapped* deletion dressed up as migration progress, which is precisely the failure mode the
"removal by extension is forbidden" clause exists to prevent. Dead-code removal may well be correct;
it is simply **not this manifest's authority**, and it must not be smuggled through this track.
Recorded here so the list is not re-derived.

### 5.4 Evidence commands and their output

```
$ git ls-files '*.js' '*.jsx' '*.mjs' '*.cjs' | wc -l          → 1766
$ git ls-files '*.ts' '*.tsx' | wc -l                          → 0      (unchanged; no *.ts rule is valid)

$ JOBS=3 bash ui/test/run_ui.sh
[check_includes] OK (22 files) / [check_includes_ui] OK (23 files)
[dock_layout]                   97 checks, 0 failures — PASS
[feature_tree_virtualization] 2053 checks, 0 failures — PASS
[command_registry]              51 checks, 0 failures — PASS
[selection_service]             70 checks, 0 failures — PASS
[input_profile_parity]          61 checks, 0 failures — PASS
[forge_shell]                   89 checks, 0 failures — PASS
[ui] ALL 6 UI GATES PASS (forge::ui — headless, no ImGui, no GPU, no display)
```

`forge::ui` is green and its 2,421 checks are real — but **2,053 of them (84.8%) are the synthetic
100,101-row feature-tree virtualization gate**. The gates that touch product-shaped behavior total
**368 checks**, and none of them asserts a value produced by any shipped JS. A large check count is
not migration coverage; this is the distinction that decided row 1.

### 5.5 Correction to §3's ordering

§3 step 2 proposed deleting G2 (`frontend/src/kernel`, 69,265 LOC) second. On this evidence that is
still right in *value* but wrong in *sequence*: the per-op A/B oracle it depends on has the same
shape as the four failures above — a C++ test that asserts a **different value** than the JS. Build
one A/B oracle end-to-end for a single op and prove it can go red before scheduling 239 files behind
the pattern.

**Net Z1 state: the node-free build (§2) landed; the first deletion did not, and should not have.**

---

## 6. TRACK UICMD — the registry now owns product commands. 2026-08-28.

§5.2 row 1 refused to retire any of G3 for a reason that was correct and specific:

```
$ grep -nE 'registerCommand|builtin|Builtin' ui/src/CommandRegistry.cpp
(no output)
```

The registry was an empty mechanism, 2,053 of its 2,421 checks were one synthetic
100,101-row virtualization gate, and no JS behavior could be retired against a registry that
owned nothing. This section records the first slice of real content, the census that says how
big the remaining surface is, and the mapping from each new C++ command to the JS symbol it is
positioned to retire. **No JS was deleted in this track, and none is yet deletable — §6.4 says
exactly what is still missing.**

### 6.1 Census of `electron/preload.js` — the 445-function surface, grouped

Measured: `445` bindings of the form `name: (` (unchanged from §1's G7 figure). Every one is
attributed to exactly one family below; the buckets sum to 445 with nothing unlisted.

| # | Family | Fns | Namespaces (count) |
|---|---|---:|---|
| A | modelling core — primitives, booleans, transforms | 10 | root: `makeBox makeCylinder makeSphere makeCone makeTorus fuse cut common translate rotate` |
| B | **part features** | **84** | `part`(23) `direct`(9) `surfacing`(8) `sheetMetal`(13) `sheetmetal`(3) `weldments`(7) `stdparts`(7) `heal`(6) `meshrepair`(6) `nurbsfit`(1) `loftguide`(1) |
| C | sketch | 12 | `sketcher`(11) `sketchdof`(1) |
| D | assembly | 8 | `assembly`(7) `matelib`(1) |
| E | drawing | 6 | `drawings`(4) `dxf`(2) |
| F | view / tessellation / picking | 30 | root(15: tessellate·LOD·BVH·massProps·ray/frustum/AABB) `gltf`(2) `pathtrace`(1) `lighting`(3) `animation`(3) `video`(1) `terrain`(2) `sun`(3) |
| G | document / file / PDM / app | 41 | `io`(7) `pdm`(12) `variants`(2) `trace`(1) `webhook`(4) `updater`(3) `win`(3) `dialog`(3) unattributed(6)\* |
| H | shape + instance lifecycle | 13 | root: `isReady loadError version retain release liveCount addInstance removeInstance updateTransform instanceCount instanceExists reserveInstances instanceBytesUsed` |
| I | CAM / manufacturing / mould | 26 | `cam`(5) `camx`(6) `machining`(3) `mold`(6) `casting`(1) `welding`(1) `tolerance`(1) `cost`(2) `carbon`(1) |
| J | simulation + named solvers | 32 | `fea`(11) `native`(17) `cfd`(1) `acoustics`(1) `thermal`(1) `simulate`(1) |
| K | one-function engineering-formula namespaces (the long tail) | **183** | 110 namespaces, ≈1.7 fns each: `boltjoint buckling vbelt fatigue hxc mohr windload pumphead refrig seismic weir threephase symcomp cable battery solarpv hydrology …` |
| | **TOTAL** | **445** | |

\* The 6 unattributed entries are `isReady loadError openFile saveFile writeBlob
transcodeWebmToMp4`. `preload.js` declares its bridge surface twice — the object literal at
line 62 and a second structurally identical block at ~1610 that repeats `dialog`/`video` — so a
line-oriented namespace walk cannot assign these six. They are counted exactly once; only their
family label is approximate (`transcodeWebmToMp4` arguably belongs to F, not G).

Two facts this census establishes that the flat "445 functions" number hid:

- **The command-shaped surface is small.** Families A+B+C+D+E — everything a Part/Sketch/Assembly
  workspace command would ever invoke — is **120 functions, 27 %**. Family K alone is **183
  functions, 41 %**, and it is not UI at all: it is a library of closed-form engineering formulas
  reachable from panels, with no selection, no undo and no feature history.
- **A command layer and a kernel ABI are different jobs.** G7 in §1 schedules the 445 for
  `forge_capi.h`. That is the right target for K and J. It is the *wrong* target for A–E, which
  need a command with a selection signature, an undo contract and a feature-IR op — not a
  function pointer.

### 6.2 What was built

| File | LOC | What it is |
|---|---:|---|
| `ui/include/forge/ui/FeatureIr.hpp` | 102 | the emitted-statement value type + the kernel op table + its validator |
| `ui/src/FeatureIr.cpp` | 186 | 40-op table transcribed from `forge/ft/FeatureTree.hpp`, arg formatting, validation |
| `ui/include/forge/ui/PartCommands.hpp` | 165 | `PartDocument` (receiver), `UndoableEdit`/`AppendFeatureEdit` (command), `UndoStack` (caretaker), `registerPartCommands` |
| `ui/src/PartCommands.cpp` | 696 | the 18 Part workspace commands |
| `ui/test/feature_ir_test.cpp` | 349 | 243 checks — the kernel-header cross-check |
| `ui/test/part_commands_test.cpp` | 451 | 304 checks — behaviour, not registration |

**The pattern is named, not improvised.** GoF *Design Patterns* (Gamma, Helm, Johnson &
Vlissides, 1994) COMMAND (p.233) with the MEMENTO variant (p.283) for undo, which that chapter
prescribes exactly when the receiver's inverse is not derivable from the request's arguments —
which is this case, because a boolean **absorbs** its tool body's name binding. Roles:
`CommandDescriptor` = Command, `PartDocument` = Receiver, `AppendFeatureEdit` = ConcreteCommand,
`UndoStack` = Caretaker with the linear-undo rule (a new edit clears the redo stack).

**A command emits one line of feature-IR; it does not call the kernel.** That is the s19.2.1
seam. `part.fillet` produces `%5 = FILLET(%4, 4, ALL)`, and the gate asserts that text. The
value of doing it this way is that the same command object is reachable from a menu, a keystroke,
a macro and an Archie tool call, and is assertable with no display, no GPU and no OCCT.

**The op table is checked against the kernel, not against itself.** `feature_ir_test.cpp` reads
`forge-kernel/include/forge/ft/FeatureTree.hpp` *as data*, re-derives all four columns (op name,
required-arg count, required+optional count, whether the first argument is a `%ref`) by parsing
the documented argument lists in the `enum class OpCode` table, and diffs them against
`ui/src/FeatureIr.cpp`. All 40 ops reconcile. Change `HOLE`'s optional list in the kernel and the
UI gate goes red until the UI follows (proved in §6.5).

### 6.3 THE MAPPING — C++ command → JS symbol it would retire → C++ test

Every row's C++ test is `ui/test/part_commands_test.cpp`, which asserts the emitted statement
text, the enabled predicate, and the selection signature for that command. `preload.js` line
numbers are from this worktree's commit.

| C++ command ID (stable) | C++ symbol | Feature-IR op emitted | JS symbol retired | preload.js | Status |
|---|---|---|---|---:|---|
| `part.extrude` | `forge::ui::registerPartCommands` → `EXTRUDE` handler | `EXTRUDE(%profile, d [, dir])` | `window.forge.part.extrudeProfile` | 1342 | MAPPED |
| `part.revolve` | ” | `REVOLVE(%profile, a [, axis])` | `window.forge.part.revolveProfile` | 1349 | MAPPED |
| `part.loft` | ” | `LOFT(%p0, %p1, … [, RULED][, OPEN])` | `window.forge.part.loft` | 1353 | MAPPED |
| `part.hole` | ” | `HOLE(%b, dia, x, y, z [, axis, depth])` | `window.forge.part.holeWizard` | 1379 | MAPPED |
| `part.counterbore` | ” | `CBORE(%b, dia, cd, cdep, x, y, z)` | `window.forge.part.holeWizard` (`type`/`spec` args) | 1379 | MAPPED |
| `part.fillet` | ” | `FILLET(%b, r [, sel])` | `window.forge.part.filletEdges` | 1371 | MAPPED |
| `part.chamfer` | ” | `CHAMFER(%b, d [, sel])` | `window.forge.part.chamferEdges` | 1375 | MAPPED |
| `part.variable_fillet` | ” | `BLEND(%b, r0, r1 [, sel][, SMOOTH])` | `window.forge.part.variableFilletEdge` | 1373 | MAPPED |
| `part.shell` | ” | `SHELL(%b, t [, openAxis])` | `window.forge.part.shell` | 1355 | MAPPED |
| `part.pattern_linear` | ” | `PATTERN(%b, LINEAR, n, dx [, dy, dz])` | `window.forge.part.linearPattern` | 1383 | MAPPED |
| `part.pattern_circular` | ” | `PATTERN(%b, POLAR, n, a)` | `window.forge.part.circularPattern` | 1385 | MAPPED |
| `part.pattern_grid` | ” | `PATTERN(%b, GRID, nx, ny, dx, dy)` | **none** — no preload binding exists for a 2-D grid pattern | — | NEW CAPABILITY |
| `part.mirror` | ” | `MIRROR(%b, PLANE)` | `window.forge.part.mirrorPattern` | 1387 | MAPPED |
| `part.boolean_union` | ” | `FUSE(%a, %b)` | `window.forge.fuse` | 74 | MAPPED |
| `part.boolean_subtract` | ” | `CUT(%a, %b)` | `window.forge.cut` | 75 | MAPPED |
| `part.boolean_intersect` | ” | `COMMON(%a, %b)` | `window.forge.common` | 76 | MAPPED |
| `part.undo` | `forge::ui::UndoStack::undo` | — (moves the program, does not extend it) | no preload symbol — undo lives in `frontend/src/forge-v4` React state | — | MAPPED |
| `part.redo` | `forge::ui::UndoStack::redo` | — | as above | — | MAPPED |

Coverage against the census: **11 of family B's 84** distinct part-feature bindings and **3 of
family A's 10** modelling-core bindings now have a C++ command with a behavioural test (18
commands map onto 14 distinct JS symbols — `part.hole` and `part.counterbore` are two commands
over one overloaded `holeWizard`, and `part.pattern_grid`, `part.undo` and `part.redo` have no
preload symbol at all). The remaining **73** of family B are `direct`(9), `surfacing`(8),
`sheetMetal`(13), `sheetmetal`(3), `weldments`(7), `stdparts`(7), `heal`(6), `meshrepair`(6),
`nurbsfit`(1), `loftguide`(1), plus `part`'s 12 uncovered entries: `extrudeProfileOnPlane`,
`sweep`, `thickenSurface`, `pipeFromPolyline`, `profileWire`, `sweepPolyline`, `draftFaces`,
`rib`, `onCurvePattern`, `sweepWithGuides`, `loftWithGuides`, `shellMultiThickness`. Three of
those need feature-IR vocabulary the kernel's `OpCode` table does not have in the form a UI
command needs: `SWEEP` takes an explicit point ring rather than a selected path sketch, and there
is **no `RIB` and no `DRAFT` op at all**. That is a kernel gap, and surfacing it is exactly why
the mapping is built before the deletion rather than after.

### 6.4 Why this still authorizes ZERO deletion

The s3.2 bar is JS symbol → C++ symbol → **C++ test that asserts the same value**. Rows above
clear the first two and half of the third: the C++ test asserts the *statement the kernel would
be given*, not the *solid the kernel returns*. Three things are missing, in order of cost:

1. **No runtime path from a dispatched command to `forge::ft::compile()`.** `PartDocument` holds
   the IR text; nothing in a shipped binary feeds it to the compiler. Until it does, `part.fillet`
   cannot replace `filletEdges` — it can only describe it. The fix is small and it is the next
   deliverable: a `forge_ui_ir_probe` that pipes `PartDocument::irProgram()` into `forge_verify`
   (which already parses and compiles IR, node-free — §2.4) and asserts volume/genus, giving each
   row a value-for-value oracle.
2. **`ForgeShell` does not own these commands.** `registerPartCommands` is standalone. Wiring it
   into the shell costs a `PartDocument` member and updates to `forge_shell_test`'s hard-coded
   `registry().size() == 13` plus the `model.extrude|fillet|shell` stubs the keymap binds in four
   input profiles (`ui/src/Keymap.cpp:252-297`). Deliberately not done in this track: it is a
   behaviour change to a green gate and belongs in its own commit.
3. **The JS side has no command registry to diff against.** Re-measured, unchanged from §5.2:
   `grep -oE "id: '[a-zA-Z0-9_.:-]+'" frontend/src/forge-v4/ForgeShellV4.jsx` returns **0** IDs.
   The JS shell dispatches through inline React handlers, so the retirement of G3 is a rewrite
   with a mapping, never a symbol-for-symbol swap. This table is that mapping for the Part core.

### 6.5 Measured gate output

Before this track (§5.4), and after, both from `JOBS=4 bash ui/test/run_ui.sh`, exit 0:

```
BEFORE                                    AFTER
[dock_layout]                   97        [dock_layout]                   97
[feature_tree_virtualization] 2053        [feature_tree_virtualization] 2053
[command_registry]              51        [command_registry]              51
[selection_service]             70        [selection_service]             70
[input_profile_parity]          61        [input_profile_parity]          61
[forge_shell]                   89        [forge_shell]                   89
                                          [feature_ir]                   243   <- new
                                          [part_commands]                304   <- new
ALL 6 UI GATES PASS — 2,421               ALL 8 UI GATES PASS — 2,968
```

The number that matters is not 2,968. It is the **non-virtualization** total: **368 → 915**, and
the synthetic virtualization gate's share of the suite falls from **84.8 % to 69.2 %**. 547 new
checks, every one of them on a command's behaviour or on agreement with the kernel's grammar.

**SR-3 — every gate proved able to fail.** Five mutations of the code under test, each run and
each red, then reverted (full suite green again afterwards, exit 0):

| # | Mutation | Result |
|---|---|---|
| 1 | `FeatureIr.cpp`: `{"HOLE", 5, 9}` → `{"HOLE", 5, 8}` | `feature_ir` FAIL 1/243 — *"got 8, want 9"*, i.e. the kernel header disagreed. `part_commands` also FAIL (22) — the 9-arg HOLE stopped being emittable |
| 2 | `PartCommands.cpp`: `part.fillet` enabled predicate drops `radius > 0` | `part_commands` FAIL 24/304 — *"statusOf(dispatch(part.fillet, radius=0)) got 0, want 3"*; a zero-radius fillet then mutated the document |
| 3 | boolean signature `exactly(Body,2)` → `atLeast(Body,1)` | `part_commands` FAIL 2/304 — one body and three bodies both stopped being refused |
| 4 | `UndoStack::perform` no longer clears the redo stack | `part_commands` FAIL 5/304 — the redo branch survived a new edit |
| 5 | `part.hole` emits 4 args instead of 5 (below the kernel minimum) | `part_commands` FAIL — the document **refused the statement**, `lastLine` stayed on the previous feature |

Mutation 1 is the load-bearing one: it proves the UI's op table is checked against the kernel's
header and not against a copy of itself. Mutation 5 proves an emission the kernel would reject
never reaches the document.

### 6.6 Ordered next steps for UICMD

1. `forge_ui_ir_probe` — pipe `PartDocument::irProgram()` into the existing node-free
   `forge_verify` and assert volume/genus per command. That converts every row in §6.3 from
   "asserts the statement" to "asserts the solid", which is the s3.2 bar.
2. Wire `registerPartCommands` into `ForgeShell`, retire the three `model.*` stubs, and re-bind
   the four input profiles' shortcuts to the `part.*` IDs.
3. Next command slices, in descending census weight: `direct`(9) → `PUSHFACE`/`DEFEATURE`/
   `RESIZEBORE` (the kernel ops already exist and are tested); `sheetMetal`(16) → `FOLD`;
   `sketcher`(12) → the sketch workspace. `surfacing`, `weldments` and `stdparts` need kernel op
   vocabulary that does not exist yet — file those as kernel work, not UI work.
4. Do **not** schedule families J and K (215 functions, 48 % of the surface) through the command
   registry. They are stateless solvers and belong behind `forge_capi.h` per §1's G7.
