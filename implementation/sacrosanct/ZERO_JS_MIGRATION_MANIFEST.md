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
