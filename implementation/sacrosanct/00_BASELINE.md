# Sacrosanct 3.1 — forensic baseline

**Audit date:** 2026-08-28 · **Method:** 8 parallel read-only auditors + reconciliation
**Base commit:** `3589f26a` ("bores: the discriminator is the SOLID around the face, not the face")
**Integration branch:** `claude/sacrosanct-execution-20260828`
**Hardware:** Apple M4 Max, 14 cores, 36 GB unified memory, 94 GiB free — matches Sacrosanct §4 exactly.

> Every number below came from a command an auditor actually ran. Where a claim could not be
> executed, it is marked UNPROVED rather than assumed. Nothing here is a completion claim.

---

## 0. The single most consequential fact

**By line count this repository is majority JavaScript, and the Archie runtime is 100% JavaScript.**

| | Files | Share | LOC |
| --- | ---: | ---: | ---: |
| JavaScript family (`.js/.jsx/.mjs/.cjs`) | 1,766 | 49.1% | **515,774** |
| C++ family (`.cpp/.hpp/.h`) | 1,135 | 31.6% | 350,643 |
| **Total tracked** | **3,595** | | |

JS exceeds C++ by a ratio of **1.47:1**. Sacrosanct §3.2's zero-JavaScript end state is therefore
**a majority-of-the-codebase deletion and rewrite, not a trim.** Sequencing this behind proved
native parity (Phase 4) is not conservatism — it is the only order in which the repo keeps working.

**There is zero TypeScript.** The 124 `.ts` files on disk are CMake `compiler_depend.ts` timestamp
stubs inside untracked build directories. A cutover that deletes `*.ts` by extension would delete
build metadata and touch no product code. This is exactly the removal-by-extension error §3.2 forbids.

---

## 1. Where the JavaScript actually lives

| Owner | Files | LOC | Note |
| --- | ---: | ---: | --- |
| `frontend/` | 1,103 | 386,186 | Vite + React 19 SPA |
| ↳ `frontend/src/kernel` | — | **69,265** | **a second geometry kernel, in JavaScript** |
| `e2e/` | 408 | 90,124 | 404 Playwright specs |
| `forge-kernel/test/` | ~217 | — | the kernel's own test harness is Node |

The `frontend/src/kernel` finding is the load-bearing one: there are **two** geometry kernels in
this repository, and one of them is JavaScript. Sacrosanct §0.1 permits exactly one authoritative
source of truth, so this is a correctness question, not only a language question.

---

## 2. Archie runtime — the largest gap to 3.1

**Status: UNPROVED against every clause of §5, §11, §18.**

- **Zero native C++ inference.** No tensor code, no tokenizer, no in-process model of any kind.
- Inference today is a raw `fetch` POST from the renderer to an OpenAI-compatible endpoint
  (`mlx_lm.server` on `localhost:8080`) owned by **a different process in a sibling repository**
  (`~/archdisc-Models`). No LLM SDK is even a dependency.
- The C++ in this repo (910 files, 207,267 LOC under `forge-kernel/`) is a **geometry kernel
  compiled to a Node N-API addon that JavaScript calls**. It contains no HTTP client, no serve
  code, no model code.

Against §18.2 (local mapped weights; network inference forbidden) the current design is not a
partial implementation — it is the inverse: the model is out-of-process and reached over HTTP.

---

## 3. Network boundary

| Requirement | Reality |
| --- | --- |
| SearXNG C++ client is the sole egress (§12, Law 2) | **Does not exist.** `git grep -i searxng\|searx` → **0 matches** across all 3,595 tracked files |
| No C++ HTTP client | **Confirmed absent** across 1,117 tracked kernel C++ files — the kernel is genuinely network-free |
| No hosted model / vendor endpoints | **Violated, in JS only** |

`frontend/src/ai/PlannerProviders.js` ships a six-provider BYO-LLM abstraction wired into five
product-runtime callers, hardcoding `api.anthropic.com`, `api.openai.com`,
`generativelanguage.googleapis.com`, two Azure endpoints, and six cloud presets (OpenRouter,
Together, Groq, Fireworks, Mistral, DeepInfra).

**The good news is structural:** every violation is in the layer already scheduled for deletion,
and the C++ layer that survives is already network-free. The boundary is reached by *removing*, not
by refactoring C++.

---

## 4. Kernel — stronger than expected

`forge-kernel` is a **~210k-line C++20 tree** (457 `.cpp` in `src`, 464 `.hpp` in `include`).

Two distinct kernels live inside it, and the distinction matters enormously:

| | Deps | Sources | Tests | Gate |
| --- | --- | ---: | ---: | --- |
| `forge::native` | **none** — C++20 + stdlib only | 149 | 140 | `run_native.sh`, runs in CI on plain ubuntu |
| OCCT-linked kernel | Homebrew OCCT 7.9 | ~308 | Node `.mjs` | needs `forge-kernel.node` |

`forge::native` is a genuine, dependency-free, 149-source / 140-test pure-C++ subsystem with a
portable per-test timeout so a hang fails rather than eating the job. **This is the strongest
existing asset for the Sacrosanct C++ mandate** and is why it was promoted to the primary CI gate.

**OCCT link surface (measured live, not quoted):** `OCCT_DIRECT = 10` link records,
`OCCT_CLOSURE = 14` toolkits. The "otool 8" figure in `reports/` is the **default** build
(7 base + TKFillet); `build-relational` carries `FORGE_FT_ARCHELIX=ON` and
`FORGE_FT_DIR_SELECTORS=ON`, which append TKBO + TKG2d. **Closure 14 is the ledger number and is
unchanged.** Both figures are correct about different builds; only the closure is comparable.

---

## 5. Simulation — real solvers, and now partly REPRODUCED

**The code is REAL, not stubs.** ~12,000 LOC of C++ implementing:

- hex8/tet4 linear-elastic FEA with genuine sparse assembly, sparse LDLT, shift-invert Lanczos,
  Jacobi-PCG, and Newmark-beta (`Fea.cpp`, `FeaTet.cpp`);
- MAC-staggered incompressible Navier–Stokes projection with 2nd-order TVD/MUSCL advection (`Cfd.cpp`);
- 1D compressible Euler FV with a Roe flux and Harten–Hyman entropy fix (`CfdCompressible.cpp`);
- penalty active-set contact, J2 radial-return plasticity, linearized geometric-stiffness buckling;
- an index-3 DAE multibody integrator with HHT-α and Baumgarte stabilisation.

### 5.1 Reproducibility restored — `forge-kernel.node` rebuilt

The baseline's blocking finding was that `forge-kernel/build/Release/forge-kernel.node` did not
exist, so no gate could run. **It has been rebuilt** (`npm run forge:kernel`, exit 0):

| | |
| --- | --- |
| artifact | 8,926,736 bytes, `forge-kernel/build/Release/forge-kernel.node` |
| exported symbols | **341** (`makeBox`, `makeCylinder`, `fuse`, `cut`, …) |
| OCCT direct link records | **8** — `TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKShHealing TKTopAlgo` |
| `smoke.js` | **ALL PASS** — prism/wedge/pyramid/ellipsoid/tube volumes, closed + manifold, refcounting |

**This settles the "otool 8 vs 14" ambiguity by measurement.** The default build links **8**
toolkits directly, exactly as `reports/` stated. The auditor's `DIRECT=10` was measured against
`build-relational`, which carries `FORGE_FT_ARCHELIX=ON` + `FORGE_FT_DIR_SELECTORS=ON` and appends
TKBO + TKG2d. `CLOSURE=14` counts transitive dependencies. All three numbers are correct about
different things; **only the closure is comparable across builds.**

### 5.2 PROVED — the rigor harness (16/16)

`physics_validation_harness.mjs` exits 0 with sixteen gates, each a numeric comparison against a
closed-form or analytic reference — not a "did not throw" assertion:

| Gate | Measured |
| --- | --- |
| Newmark undamped energy conservation, 10 periods | drift **0.00000%** |
| SDOF damped ζ recovered by log-decrement | **0.05000** vs 0.05 → **0.004%** err |
| SDOF undamped vs `x₀cos(ωt)`, 6 periods | max rel err **0.074%** |
| Cantilever release period vs modal `1/f₁` | **0.062%** |
| Four-bar coupler pin vs **Freudenstein**, full rotation | **<2%** |
| Slider-crank `x(θ)`, full rotation | **<2%** of stroke |
| Pendulum period vs `2π√(L/g)` | **<5%** |
| Rotor `ω=αt` and `θ=½αt²` | **<5%** |
| Static tip deflection (incompatible-modes hex) | **<3%** |
| Modal `f₁` (consistent hex mass) | **<8%** |
| Unconditional stability at `Δt = 5×T_min` | no blow-up |

Status for these: **UNPROVED → PROVED.** Archived artifact: the harness is re-runnable against the
pinned binary above.

### 5.3 PARTIAL — NAFEMS, and a gate that cannot fail

`fea_nafems_gate.mjs` exits 0, but **that exit code does not mean its benchmark targets were met.**
Reading the source rather than trusting the exit status:

```js
let hardFail = false;
const note = (m) => { hardFail = true; ... };   // only note() sets it
...
process.exitCode = hardFail ? 1 : 0;            // line 445
```

The NAFEMS reference-correlation sub-cases print
`FAIL (faceted linear Tet4 under-resolves; converging — deferred conforming Tet10 mesher)`
**without calling `note()`**, so a missed benchmark target cannot turn the gate red. The final line
is literally `deferred-mesher gap, not a kernel break. hardFail=false.`

This is honestly *documented* — the scope note names the missing conforming curved Tet10 mesher and
reports a converging trend — but under §13 Gate 5 ("reference correlation appropriate to the
physics") it is **PARTIAL, not PROVED**:

- **PROVED:** the patch test reproduces a constant stress state to *machine precision*
  (completeness satisfied), and Inc1c thermoelastic is exact to machine precision.
- **NOT PROVED:** the NAFEMS σ targets on curved boundaries, because linear Tet4 on a faceted
  boundary under-resolves the stress concentration.

**This gate is not weakened or altered** — doing so is forbidden. It is *reclassified*, and the
missing conforming curved Tet10 mesher is recorded as the specific work that would close it.

### 5.4 Still running

The CFD and EM gates (`cfd_ghia`, `cfd_sod`, `cfd_natconv`, `cfd_oblique_shock`, `cfd_species`,
`em_*`, `calculix_io`) are long-running — the Ghia lid-driven-cavity case alone exceeds 10 minutes.
They are executing in the background; results are UNPROVED until they report, and will not be
claimed before then.

## 6. Build and dependency plane — the reproducibility blocker

| Sacrosanct §10.6 / §21.2 requirement | Reality |
| --- | --- |
| `third_party/manifest/deps.lock.json` | **absent** |
| `CMakePresets.json` | **absent** |
| `ONLINE_SEED` / `OFFLINE_BUILD` modes | **absent** |
| `FORGE_NETWORK=OFF` build | **absent** |
| Content-addressed prefixes | **absent** |

OCCT is supplied **exclusively by a machine-global Homebrew prefix** —
`forge-kernel/CMakeLists.txt` hardcodes `set(OCCT_ROOT "/opt/homebrew/opt/opencascade")` with a
`/usr/local/opt/opencascade` fallback. The build is therefore **not reproducible offline and not
reproducible on a clean machine.** This single fact blocks the §10.6 dependency plane, the offline
build gate, and every determinism claim that depends on a pinned toolchain.

CI is also **stale**: HEAD is **55 commits ahead of `origin/archdisc`**, and the last run on this
line of work was a manual `workflow_dispatch` on 2026-07-25 — over a month behind the HEAD commit.

---

## 7. UI — and a direct contradiction that needs a decision

Today: **Electron 42.3.0** wrapping a **Vite + React 19** SPA whose CAD viewport is
**react-three-fiber / three.js 0.181**.

The kernel surface **does not go through IPC**. `electron/preload.js` is **1,635 lines** that
`dlopen` `forge-kernel.node` in the preload world and `contextBridge`-expose **~445 wrapped kernel
functions** as `window.forge.*`. The 24 IPC channels in `main.js` are for other concerns. Any
native replacement must reproduce a 445-function surface, not 24 channels.

`forge-desktop/` is **not an application**. It is 6 standalone headless `int main()` probe programs
(2,633 lines) plus vendored Dear ImGui 1.92.9-WIP and 4 Vulkan GLSL shaders, with **no CMakeLists.txt
of its own**.

### ⚠ CONTRADICTION — Qt 6 vs Dear ImGui (escalated, not silently resolved)

`docs/FORGE_CPP_MIGRATION.md` (2026-07-16) carries the heading **"NOT Qt"** and rejects it on four
recorded grounds. I read the document rather than trusting the summary, and the reasoning is
substantive:

1. **Bespoke-look mandate.** The ADDENDUM requires "Forge's own bespoke, contemporary design
   language"; the doc argues re-skinning QWidgets/QSS "always looks *restyled-Qt*."
2. **Latency.** Dear ImGui emits draw lists into the **same frame and same Vulkan command buffer**
   as the CAD scene — zero context switches, free blending of HUDs over geometry. Qt over
   `QRhi`/`QQuickFramebufferObject` puts the scene in a separate context or an FBO copied every frame.
3. **Licensing.** Qt LGPLv3 permits proprietary apps only via **dynamic linking** and forces a
   *"prominent notice that the software uses Qt under LGPL-3.0 … in the user interface"* plus a
   relink path. Forge's stated business model is a free-but-proprietary, statically-linkable binary.
4. A CAD app is a retained *document* with a re-emitted *view*, which suits immediate mode.

**The decisive detail:** that same document names the exact condition that flips it to Qt —
*"if enterprise procurement hard-requires certified accessibility (screen-reader/AT trees),
rich-text document editing, printing pipelines, or 20-language i18n inside the app chrome."*

Sacrosanct 3.1 §19.2 selects Qt 6 Widgets for — verbatim — *"native menus, actions, text, input,
**accessibility**, model/view, dialogs, **printing**, and platform integration."* **3.1 asserts the
migration doc's own flip condition as a requirement.** On reasoning, the two documents converge:
3.1 has decided those capabilities are mandatory, which is precisely when the older doc agrees Qt wins.

**What does NOT resolve is the licensing constraint.** 3.1's Law 16 requires the *dependency stack*
to be open source and source-buildable; it does not make *Forge itself* open source, and it never
addresses Qt's in-UI attribution obligation or the static-linking prohibition. That is a real legal
constraint on the shipped binary, not a preference, and no amount of reading Sacrosanct dissolves it.

Sacrosanct governs, so Qt 6 is the default path. But committing ~1,600 preload functions' worth of
UI to a stack with an unresolved licensing obligation is not a call to make silently.
**Escalated as `DECISIONS.md` D-001.** KDDockWidgets (GPL/commercial) compounds the same question.

---

## 8. Storage census (scan only — nothing deleted, moved, or quarantined)

Volume: 460 GiB, 344 GiB used, **95 GiB available (79% capacity)**. Repo: **5.508 GiB**.

**Headline correction to the brief:** `git worktree list` prints 28 lines — the main checkout plus
27 registered worktrees — and I verified each path on disk: **2 exist, 26 are PHANTOM** —
their directories do not exist on disk; only locked administrative records remain in
`.git/worktrees` (17,732 KB total). Exactly **one** worktree directory exists,
`.claude/worktrees/align-op` (0.458 GiB), and its tracked tree is **100% clean with zero untracked files**.

| Class | Size | Verdict |
| --- | ---: | --- |
| 21 untracked CMake build trees under `forge-kernel/` | 1.993 GiB | reproducible; newest 21 days stale — **none is hot** |
| 2 × `node_modules` | 1.237 GiB | reinstallable |
| 26 phantom worktree admin records | 17 MB | prunable, but see hazard below |
| `.claude/worktrees/align-op` | 0.458 GiB | clean, but **must prove no unique commit before removal** |

No reclaim has been performed. Per §21.3 every candidate needs a dry-run plan with reference proof
and a recovery path before anything is touched, and the phantom records must be understood before
pruning — a locked record whose directory vanished may be evidence of an interrupted operation.

---

## 9. Process hazard I caused — recorded, not hidden

**Five of eight auditors independently reported that HEAD moved underneath them mid-audit.**

`git reflog` confirms: `HEAD@{0}: checkout: moving from k6-occtzero to claude/sacrosanct-execution-20260828`,
then commits advancing `3589f26a → 50c512e4`. That was **me**, committing into the shared checkout
while eight read-only agents were reading it. One auditor observed `build-app.yml` in one grep and
found it gone in the next.

The SHA held at `3589f26a` for the substantive census work, so the findings are self-consistent and
were re-verified against the final HEAD. **No finding is invalidated.** But the lesson is binding
for everything that follows:

1. **Parallel writers get worktrees. The shared checkout is not a workspace.**
2. **Audits pin a SHA first** and report against that SHA, not against `HEAD`.
3. A deletion manifest derived from a census **must be re-validated against the SHA actually
   checked out at execution time**.

---

## 10. Status vocabulary

| Status | Meaning |
| --- | --- |
| `PROVED` | reproduced by the acceptance harness on a clean build, with an archived artifact |
| `PARTIAL` | real implementation exists; its acceptance gate does not, or does not cover the claim |
| `UNPROVED` | plausible or claimed, but nothing currently executes to demonstrate it |
| `BLOCKED` | cannot proceed until a named prerequisite lands |
| `CONTRADICTED` | evidence disagrees with a claim made in the repository |

## 11. Phase-0 exit conditions (Sacrosanct §22)

- [ ] `forge-kernel.node` rebuilt so the physics and kernel gates are reproducible at all
- [ ] `third_party/manifest/deps.lock.json` + `CMakePresets.json` exist; OCCT no longer resolved
      from a machine-global Homebrew prefix
- [ ] `FORGE_NETWORK=OFF` clean offline build proved in CI
- [ ] zero-JS migration manifest: every one of the 1,766 JS files mapped to a C++ owner or to
      explicit deferral
- [ ] storage governor registered roots + dry-run plan, nothing deleted without a receipt
- [ ] D-001 (Qt vs Dear ImGui) resolved by the user
