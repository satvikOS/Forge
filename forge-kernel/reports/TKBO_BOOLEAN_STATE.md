# TKBO — the state of the boolean and defeature path

**Date:** 2026-07-31 · **Analysis + measurement only.** No file under `src/`, `include/`,
`test/` or `CMakeLists.txt` was modified. No drop was attempted. Everything below was
measured on this machine against the already-built
`build/Release/forge-kernel.node` (mtime 2026-07-31 08:54). Health was GREEN throughout;
never more than two concurrent subprocesses of mine (the truncation sweep was `SIGSTOP`ped
whenever a third measurement had to run, then `SIGCONT`ed).

> **Concurrent edits by other agents, reported not reverted.** During this session four files I
> did not touch changed under me: `CMakeLists.txt` (10:25), `src/Cam.cpp` (10:25),
> `src/ft/FeatureTreeCompiler.cpp` (10:47) and `src/native/geom/NativeNurbsConvert.cpp` (10:47).
> All measurements here were taken against the binary built at 08:54, which predates them, so the
> numbers are internally consistent. Line references were re-checked against the files as they
> stand now — `setForgeNativeBrepEnabled(false)` moved from line 1889 to **1928** in
> `FeatureTreeCompiler.cpp`, and the "face index is not an identity" note from 443 to **482**.
> Anyone re-deriving §3 should rebuild first.

**Closure before = closure after = unchanged, because nothing was changed:**

```
$ bash scripts/occt_closure_count.sh
  OCCT_DIRECT  = 8    (LC_LOAD_DYLIB records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ THE NUMBER
  OCCT_PHANTOM = 2    (TKBO, TKG2d — called with no link record)
```

**Required gates, all re-run under measurement, all green:**

| gate | result |
|---|---|
| `node test/ft/ft_unified_edit.mjs` | **20 passed** |
| `node test/directedit.mjs` | **9/9** |
| `node test/ft/ft_smoke.mjs` | **ALL PASS** |
| `node test/healing_smoke.js` | **ALL PASS** |
| `bash scripts/occt_closure_count.sh` | 8 / **14** / 2 |

---

## 0. Headline

Four findings, in descending order of consequence.

1. **The production feature-tree compiler switches the native boolean engine OFF.**
   `src/ft/FeatureTreeCompiler.cpp:1928` calls `setForgeNativeBrepEnabled(false)` for the
   duration of every build. `forge.ft.compile` is the ONE entry mandated by sacrosanct §1,
   so **100 % of the booleans in the whole corpus run on OCCT TKBO — not because the native
   engine failed, but because it is never asked.** Measured two ways: a native-ON and a
   native-OFF pass produced *byte-identical* OCCT call counts over the 241 trees both reached,
   and the full census (1,267 trees replayed) shows **25,672 TKBO boolean calls, 100 % of them
   OCCT**, with every final handle of kind `occt`.

2. **When the gate is honoured, the native boolean still never produces an exact B-rep.**
   On the first boolean of each tree — clean operands, no accumulated damage — the native
   engine produced an exact-topology result **0 % of the time**, in **all ten families**. 49 %
   closed natively but as a **130×-inflated facet soup** (1,078 faces where OCCT gives 9);
   51 % deferred to TKBO anyway after burning a **median 14.1 seconds** (OCCT alone: 10 ms).

3. **The deferrals are not spread, and they are not tangency.** **100 %** of analytic misses
   report one cause: `analytic stitch: edge not shared by exactly 2 faces`. The unmated-edge
   counts cluster on **exactly 128 and 256** — `nSeg` and `2·nSeg` of
   `PrimitiveOptions::nSeg = 128` (`include/forge/native/brep/Primitives.hpp:52`). The
   failures are the **sector seams of the 128-sector native curved primitive**. The
   tangent/near-tangent pathology named in the code produced **zero** events.

4. **`BRepAlgoAPI_Defeaturing` has no native counterpart at all**, and neither does anything
   else in `src/DirectEdit.cpp`. The entire edit half of the benchmark is unconditional TKBO.

**Consequence for the drop:** TKBO is not blocked on boolean robustness heuristics. It is
blocked on one structural fact — **native curved topology is sectorised, not periodic**. Fix
that and both the exactness gap and the stitch-failure gap close together. Nothing else in
this report is worth scheduling before it.

---

## 1. Method

### 1.1 The instrument

TKBO is a *phantom*: the `.node` has no link record for it, and every one of its 31 symbols is
`(dynamically looked up)` in the flat namespace. That makes it interposable. A 130-line shim
(`boolprobe.c`, in the session scratchpad) defines the same mangled symbols, counts each call,
records the caller's return address, and forwards to the real TKBO resolved through an explicit
`dlopen` handle. It is loaded with `DYLD_INSERT_LIBRARIES`; **nothing in the kernel is touched**.

Counted entry points: `BRepAlgoAPI_{Fuse,Cut,Common}` constructors, `BooleanOperation::Build`,
`Defeaturing::Build`, `Splitter::Build`, `Section::Build`, `BOPAlgo_Options::SetFuzzyValue`.

Validated before use: with the native gate ON a `box ∪ box` records **0** OCCT calls; with
`FORGE_NATIVE_BREP=0` it records exactly **1**. The instrument therefore distinguishes the two
backends exactly, per call.

Per-tree attribution: `node` sets `process.env.BOOLPROBE_TAG` before each compile, which reaches
`getenv(3)` in the shim through `setenv(3)`. Call-site attribution: the caller's offset within
its image, resolved offline against the binary's symbol table.

### 1.2 Separating "native was tried" from "native was never tried"

The call-site offset splits the TKBO load into two populations that must never be conflated:

| offset | function | class |
|---|---|---|
| `0x1cf918` | `runBoolean<BRepAlgoAPI_Fuse>` (`src/Booleans.cpp:193`) | **FUNNEL** — native tried first, this is a genuine deferral |
| `0x1d0cc8` | `runBoolean<BRepAlgoAPI_Cut>` | **FUNNEL** |
| `0x27cfd4`, `0x27d5cc`, `0x27e6bc`, `0x27ecb4` | `forge::part::{linear,circular}Pattern` region | **DIRECT** — unconditional OCCT, native never attempted |
| `0x1d4b60` | `forge::defeature` (`src/DirectEdit.cpp:226`) | **DIRECT** |
| `0x1d5c4c`, `0x1d5d00` | `forge::resizeBore` | **DIRECT** |
| `0x1d52a4` | `forge::pushPullFace` | **DIRECT** |

*Caveat, stated plainly:* `atos` and a hand-rolled `nm` lookup disagree by a constant `0x16E8`
on the four pattern-layer offsets, so which of them is `linearPattern` versus `circularPattern`
is not settled. It does not matter for any conclusion here: all four are non-funnel sites in the
`forge::part::*Pattern` region, and their aggregate count independently matches the pattern
expansion predicted structurally from the IR (§2.2). The two FUNNEL offsets are confirmed by
both resolvers, by the source, and by a direct single-call experiment.

### 1.3 The corpus, and a defect in it

`/Users/account_clawteam1/archdisc-Models/data/forge/complex_all.jsonl` — 1,613 trees,
31,239 IR ops, 10 families, mean 19.4 ops/tree.

> **`id` is not a key.** The file has 1,613 rows but only **1,035 distinct `id` values**; 578
> ids occur exactly twice, carrying *different* families and geometry (e.g. `cx_00007` is both
> a 16-op `stepped_shaft` and a 24-op `manifold_block`). It is two corpora concatenated with
> colliding id spaces. An id-keyed join silently mixes unrelated parts — it corrupted an
> earlier version of this analysis before being caught. **Everything below is keyed on the
> corpus line index.** Anything else joining on this file needs the same fix.

---

## 2. The production reality: `ft.compile` never asks the native engine

### 2.1 The gate override

```cpp
// src/ft/FeatureTreeCompiler.cpp:1927-1934
bool prevGate = forge::native::brep::forgeNativeBrepEnabled();
forge::native::brep::setForgeNativeBrepEnabled(false);
struct GateGuard { bool prev; ~GateGuard() { setForgeNativeBrepEnabled(prev); } } guard{prevGate};
```

Documented at `FeatureTreeCompiler.cpp:23` as forcing "the clean OCCT analytic backend … the
clean-B-rep path native_compile.mjs relies on (analytic 3-face cylinders, clean booleans,
working fillet/shell)". The parenthesis is the whole story: **the OCCT path is chosen because
its cylinder has 3 faces and the native one does not.**

This was proved empirically before it was read. Two passes over the corpus — one with
`FORGE_NATIVE_BREP` unset (native default ON), one with `FORGE_NATIVE_BREP=0` — produced
**identical** TKBO counts over the 241 trees both had reached: `cut` 2,037 vs 2,037; `fuse`
625 vs 625; direct 2,354 vs 2,354, and equal on every individual probe tag. (Because that run
tagged by `id`, tags covering a duplicated id aggregate two trees — see §1.3 — so this is
equality per tag group, not strictly per tree. The totals are exact either way, and the
subsequent index-keyed runs confirm the same conclusion.) The env var is inert inside
`ft.compile`.

### 2.2 Census of the TKBO load

Full-corpus replay through `forge.ft.compile` (the production path):

| | |
|---|---|
| trees compiled | **1,267 of 1,613**, **1,267/1,267 ok** (sweep still running at write time) |
| final handle kind | `occt` — **100 %** |
| volume vs corpus GT | median rel-dev **4.3e-13**, p95 3.8e-12 — exact |
| mean compile wall | 1,469 ms |
| **TKBO boolean calls** | **25,672** over 1,267 trees = **20.3 per tree** |

By class, measured, with the structural prediction computed independently from the IR:

| class | site | measured (1,267 trees) | share | linear extrapolation to 1,613 | IR prediction |
|---|---|---:|---:|---:|---:|
| **FUNNEL** — native tried, **100 % deferred** | `runBoolean<Cut>` | 10,355 | 40.3 % | 13,183 | `HOLE 6,666 + 2×CBORE 3,580 + CUT 2,814` = **13,060** |
| **FUNNEL** — native tried, **100 % deferred** | `runBoolean<Fuse>` | 3,554 | 13.8 % | 4,524 | `FUSE` = **4,334** |
| **DIRECT** — native **never** tried | pattern layer ×4 | 11,763 | **45.8 %** | 14,975 | `PATTERN` expansion = **14,652** |
| | **total** | **25,672** | | **32,682** | **32,046** |

Measurement and prediction agree to within 4 % on every row, from two completely independent
methods (dynamic-link interposition versus static IR arithmetic). That is the check that the
call-site classification in §1.2 is right.

The DIRECT row is the one that is easy to miss: **`PATTERN` alone is ~46 % of all TKBO boolean
calls in the corpus, and not one of them is ever offered to the native engine**, because
`forge::part::linearPattern` / `circularPattern` (`src/Features.cpp:2183,2233`) construct
`BRepAlgoAPI_Fuse` directly behind `forgeNativeFeaturesEnabled()`, which defaults **off**.
The remaining 54 % *are* offered — and, per §2.1, refused by the compiler's own gate override.

### 2.3 Every TKBO construction site in the kernel

40 sites. **6 try native first. 34 do not.**

| tries native (6) | file |
|---|---|
| `fuse` / `cut` / `common` | `src/Booleans.cpp:460,472,484` via `runBoolean` |
| `fuseFuzzy` / `cutFuzzy` / `commonFuzzy` | `src/BooleanTol.cpp:222,226,230` |

| unconditional OCCT (34) | file:line |
|---|---|
| `Defeaturing` ×1 | `src/DirectEdit.cpp:226` |
| `Fuse`/`Cut` ×4 | `src/DirectEdit.cpp:259,265,315,322,328` |
| `Fuse`/`Cut` ×8 | `src/Features.cpp:2013,2030,2053,2183,2233,2285,2381,2591` |
| `Fuse`/`Cut` ×4 | `src/DirectModeling.cpp:486,497,552,608` |
| `Fuse` ×2 | `src/SheetMetal.cpp:532,695` |
| `Fuse`/`Cut` ×4 | `src/SheetMetalExtended.cpp:379,483,757,859` |
| `Fuse` ×3 | `src/Weldments.cpp:387,437,490` |
| `Cut` ×2, `Splitter` ×1 | `src/Mold.cpp:345,393,315` |
| `Section` ×3 | `src/Drawings.cpp:810,1158`, `src/Nurbs.cpp:689` |
| `Common` ×1 | `src/InterferenceDetection.cpp:263` |

> **Correction to the task framing.** `BRepOffsetAPI_MakeFilling` is **not** one of TKBO's 31
> symbols. `nm -m` reports its four symbols as `(from libTKOffset)` — a real link record — and
> `libTKBO` exports zero `BRepOffsetAPI_MakeFilling` symbols while `libTKOffset` exports 23.
> It belongs to the TKOffset drop (`src/Healing.cpp:460`), not this one. The TKBO phantom set is
> exactly `BRepAlgoAPI_{Fuse,Cut,Common,Section,Splitter,Defeaturing,Algo,BuilderAlgo,BooleanOperation}`
> plus `BOPAlgo_{Algo,Options,RemoveFeatures}` — 31 symbols, all `(dynamically looked up)`.

---

## 3. What the native boolean actually does when it is allowed to run

### 3.1 Isolating it

`ft.compile` cannot be persuaded to honour the gate from outside. So: a **copy** of the
binding (`fk_gateon.node`) was made in the scratchpad and the four bytes at the entry of
`forge::native::brep::setForgeNativeBrepEnabled(bool)` (vmaddr `0x43f8ec`) replaced with
`ret` (`c0035fd6`), then re-signed. The override becomes a no-op, so the env gate rules and
the native engine is genuinely live inside the compiler. **The kernel build is untouched**;
this is a throwaway artefact in `/private/tmp/.../scratchpad`.

Verified: on the stock binding `setNativeBrep(false)` → `nativeBrepEnabled()==false`; on the
patched copy → `true`. Both binaries produce an identical `box − cylinder` (vol 3497.3452,
`kindOf == nativeSolid`).

### 3.2 Whole trees: it collapses

Three trees run end-to-end with the gate honoured:

| tree | native ON | native OFF (production) |
|---|---|---|
| `cx_00000` tube_sheet | 9,738 ms, vol 1,180,435.87 (**0.055 % low**) | 802 ms, vol 1,181,089.20 (exact) |
| `cx_00001` multilevel_housing | 42,491 ms, **FAILS** — `op %24: FILLET: kernel declined at every radius` | 536 ms, exact |

The mechanism is visible in the diagnostics: once one boolean takes the mesh fallback, the body
becomes a facet soup, and every *subsequent* "analytic" boolean runs face-pair SSI over
thousands of faces — the stitch reports grow to `faces=6900 verts=4208`. A full-corpus native-ON
pass was abandoned after measuring ≈4 hours of projected runtime versus 38 minutes for OCCT.

### 3.3 First boolean only — the clean measurement

To measure the engine rather than the cascade, each tree was **truncated after its first
boolean-producing op** (`CUT`/`FUSE`/`HOLE`/`CBORE`) and compiled twice: once on the patched
binding (native live) and once on the stock binding (pure OCCT). Same tree, same prefix, joined
on line index. Stratified sample, 15 trees per family.

**Outcome of the first boolean (n = 71 measured both ways, all ten families):**

| outcome | n | share |
|---|---:|---:|
| **A — native, exact topology** | **0** | **0.0 %** |
| **B — native, faceted (mesh fallback)** | 35 | 49.3 % |
| **C — deferred to TKBO** | 36 | 50.7 % |

| bucket | faces (native) | faces (OCCT) | blow-up | median wall (native) | median wall (OCCT) | volume rel-dev |
|---|---:|---:|---:|---:|---:|---:|
| B — native faceted | 1,078 | 9 | **130×** | 343 ms | 8 ms | 2.5e-05 |
| C — deferred | 9 | 9 | 1.0× | **14,114 ms** | 10 ms | 1.1e-15 |

Read the C row carefully: when the native path defers, the operation still costs **14.1 seconds**
before OCCT does it in 10 ms — a **~1,400× penalty for work that is thrown away**. The worst
observed was **48.1 s** for a single `BOX>CYL>FUSE`.

The deferrals are not exotic geometry. They are the simplest booleans in CAD:

```
k=474  bearing_housing  BOX>CYL>FUSE          native 48,081 ms → deferred   (OCCT: 8 ms)
k=121  bearing_housing  BOX>CYL>FUSE          native 45,561 ms → deferred   (OCCT: 7 ms)
k=466  bolted_cover     CYL>CYL>FUSE          native 20,809 ms → deferred   (OCCT: 10 ms)
k=610  stepped_shaft    CYL>CYL>FUSE          native 17,471 ms → deferred   (OCCT: 6 ms)
```

Per family, no family produced a single exact native result:

| family | n | exact | faceted | deferred |
|---|---:|---:|---:|---:|
| bearing_housing | 8 | 0 | 3 | 5 |
| bolted_cover | 9 | 0 | 0 | 9 |
| manifold_block | 11 | 0 | 11 | 0 |
| multilevel_housing | 7 | 0 | 7 | 0 |
| pump_housing | 1 | 0 | 1 | 0 |
| ribbed_bracket | 9 | 0 | 9 | 0 |
| sheet_chassis | 5 | 0 | 2 | 3 |
| stepped_shaft | 9 | 0 | 0 | 9 |
| tube_sheet | 10 | 0 | 0 | 10 |
| valve_body | 2 | 0 | 2 | 0 |

---

## 4. Characterising the deferrals by cause

`src/native/brep/Boolean.cpp:1909` prints the analytic-miss reason under `FORGE_BOOL_DIAG=1` —
a runtime hook that needs no rebuild. Across the sample:

| events | share | reason (verbatim) |
|---:|---:|---|
| **45** | **100 %** | `analytic stitch: edge not shared by exactly 2 faces` |
| 0 | 0 % | `analytic: A/B has non-quadric face` |
| 0 | 0 % | `analytic: a crossing pair has no closed-form SSI` |
| 0 | 0 % | `analytic: SSI returned a marched curve` |
| 0 | 0 % | `analytic: empty selection` |

(An earlier, larger but id-keyed sweep saw the same distribution with a 7 % tail of
`analytic: imprint of an A/B face failed (CDT)` — the same failure one stage upstream.)

**It is one situation, and it is identifiable exactly.** The `[bool-diag stitch]` line reports
the unmated-edge count on each failing stitch:

```
unmated edges per failing stitch:  128 ×25   256 ×9   264 ×1   344 ×1   358 ×1   376 ×1   390 ×1   400 ×1
```

`128` is not a coincidence. `include/forge/native/brep/Primitives.hpp:52`:

```cpp
struct PrimitiveOptions {
    int nSeg  = 128;   // angular sectors (theta) for cylinder/cone/sphere/torus/tube
    int nBand = 64;
};
```

and `src/native/brep/Primitives.cpp:177` builds the side of every cylinder/cone as

```cpp
// Side faces: one quad (or triangle to apex) per angular sector.
for (int i = 0; i < N; ++i) { ... }        // N == opt_.nSeg == 128
```

A native cylinder is **128 separate trimmed faces on a shared analytic surface**, not one
periodic cylindrical face. Therefore:

* the analytic boolean does `|F_A| × |F_B|` ≈ **130 × 130 ≈ 17,000** face-pair SSI tests with
  `sampleN = 256` for a single `CYL ∪ CYL` — the 13-to-48-second deferrals;
* the stitch must mate **128 sector-seam edges per cylinder**, and when it cannot, exactly
  `nSeg` or `2·nSeg` edges come back unmated — the 128/256 histogram;
* even on success the result carries ~1,110 faces where the B-rep answer is 9 — the 124× blow-up.

The pathological case the code names — tangent/near-tangent operands, `detectBooleanTangentPinch`,
`src/Booleans.cpp:421` — **did not fire once** in any measured run. The hang-guard
(`kPerCall 8 s`, `kBudget 20 s`, `src/Booleans.cpp:212-214`) also never tripped: the 13-48 s
costs are *native* time spent inside `tryNativeBoolean`, before OCCT is entered at all.

---

## 5. `BRepAlgoAPI_Defeaturing` specifically

**There is no native defeature. Not a partial one — none.** `src/native/brep/` contains 55
files; none implements feature removal. `forge::defeature` (`src/DirectEdit.cpp:216-236`) is
14 lines of unconditional OCCT with no `#ifdef FORGE_NATIVE_BREP` branch, no `kindOf` test, and
no deferral contract:

```cpp
BRepAlgoAPI_Defeaturing df;
df.SetShape(shape);
df.AddFacesToRemove(toRemove);
df.SetRunParallel(Standard_True);
df.Build();
```

The same is true of the other three DirectEdit primitives. Measured under the probe:

| gate | `Defeaturing::Build` | `Cut` | `Fuse` | native attempts |
|---|---:|---:|---:|---:|
| `test/ft/ft_unified_edit.mjs` (20 pass) | **10** | 69 | 1 | **0** |
| `test/directedit.mjs` (9/9) | **1** | 4 | 2 | **0** |

Attributed by call site: `forge::defeature` `0x1d4b60` ×10, `forge::resizeBore` `0x1d5c4c`/
`0x1d5d00` ×6, `forge::pushPullFace` `0x1d52a4` ×1. The 63 remaining cuts come from
`runBoolean<Cut>` building the fixtures' base bodies.

Per `docs`/memory the edit half is v18's strongest dimension (0.656) and maps 1:1 onto these four
primitives. **Every one of them is TKBO-only.** A native defeature is therefore a genuinely
independent win: it is the only one of the four whose OCCT dependency is not shared with the
generative path, and unlike the boolean it is *not* blocked on the sectorisation problem —
`BOPAlgo_RemoveFeatures` is a face-removal-plus-wound-heal algorithm that operates on the
existing shape's topology rather than constructing new curved intersections.

It is also the **only** TKBO symbol group with no native code behind it whatsoever, which makes
it the largest single unknown in the TKBO estimate. Everything else has an implementation whose
quality can be measured; defeature has nothing to measure.

---

## 6. What this means for the drop — evidence-backed plan

### 6.1 What the drop is worth

Per `reports/OCCT_CLOSURE_TRUTH.md:196`, routing TKBO native **alone changes the closure by 0**.
TKBO leaves only as part of `{TKBO, TKFillet, TKOffset}`, which takes closure **14 → 9** and
also retires TKBool and TKPrim. TKBO's own 31 symbols are 84 − 53 = 31 of that cut set's 84.

So TKBO must be scheduled *with* TKFillet and TKOffset, never scored alone. This report changes
nothing about that ranking. What it changes is the **cost estimate** and the **order of work
inside** the TKBO item.

### 6.2 The one capability that closes the largest share

**Periodic curved faces — one cylindrical/conical/spherical face per surface, not `nSeg` sectors.**

Evidence that this single change is the dominant lever:

| symptom | measured | attributable to sectorisation |
|---|---|---|
| analytic misses | 100 % are `stitch: edge not shared by exactly 2 faces` | unmated counts are exactly `nSeg`=128 and `2·nSeg`=256 |
| exact-topology results | 0 / 71, in all 10 families | a 128-sector operand cannot produce a 9-face answer |
| face blow-up on success | 130× (1,078 vs 9) | 6 planar + 128 sectors + splits ≈ 1,168 |
| deferral wall time | median 14.1 s, max 48.1 s | `O(nSeg²)` = ~17,000 SSI pairs per cyl∪cyl |
| whole-tree collapse | 12× slower, one tree fails at FILLET | facet soup propagates to every downstream op |
| why `ft.compile` disables native at all | source comment cites "analytic 3-face cylinders" | the compiler already diagnosed this |

Every one of the six independent symptoms has the same root. No second cause is visible in the
data: the quadric-envelope check, the closed-form SSI check, and the tangency detector each fired
**zero** times.

This is also the same root cause recorded for the K6/K7 faceted-`importOcctSolid` problem and for
the curved-export facets blocking TKShHealing and TKFillet. **It is one capability, and it is
shared by at least four remaining drops.** That is what makes it the correct next investment
rather than a TKBO-local fix.

### 6.3 What it would take

1. **Periodic face representation** in `native/brep/Topology.hpp` + `Primitives.cpp`: a face
   whose `u` range wraps 0..2π with a seam edge, replacing the `for (i < nSeg)` loops at
   `Primitives.cpp:155,223,302,443,580,742`. This is the load-bearing change; everything below
   depends on it.
2. **Seam-aware stitch** in `Boolean.cpp` (`analyticStitch`, ~line 1404-1570): edge mating must
   treat the periodic seam as a single edge with multiplicity 2, which is precisely the check
   that is failing today with 128 unmated edges.
3. **Imprint/CDT on a periodic domain** (`imprintFace`, `Boolean.cpp:~1090`): the trim-curve CDT
   must handle a `u`-wrapped parameter window. This is where the residual 7 % `imprint … (CDT)`
   tail lives.
4. **Then, and only then**, the remaining TKBO surface: `Section` (3 sites), `Splitter` (1 site),
   fuzzy booleans, and the 34 direct call sites that must be routed through `forge::fuse/cut/common`
   instead of constructing `BRepAlgoAPI_*` themselves.
5. **Native defeature** — independent of 1-3, can proceed in parallel, and is required regardless
   (§5).

### 6.4 Risk

**High blast radius, and the measurements say the current native path is not a safe fallback.**

* Changing primitive face topology changes *every* native op — tessellation, mass properties,
  fillet/chamfer, STEP write, the DirectEdit face-index contract (`faceInventory` indices are
  positional; 128→1 renumbers every face). `src/ft/FeatureTreeCompiler.cpp:482` already warns
  that "a face index is not an identity".
* The corpus currently compiles **1,267/1,267 with volume exact to 4.2e-13**. That is the bar.
  With native ON today, one of three sampled trees *fails outright* and another loses 0.055 % of
  its volume. Any flip must be gated on the full-corpus replay in §2.2, not on unit fixtures.
* The A/B gate suite reportedly passes 33/33 native-vs-OCCT. Those fixtures do not detect any of
  the six symptoms above. **A green native gate suite is currently not evidence that the native
  boolean works on real trees** — this report's §3.3 is the test that should gate the flip.
* `PATTERN`'s ~14,652 direct OCCT fuses (§2.2) are invisible to every native gate, because they
  never enter the funnel. Routing them is a prerequisite for any TKBO removal and is a behaviour
  change in its own right.

### 6.5 Recommended sequencing

1. **Do not attempt the TKBO drop now.** Confirmed: the enabling capability does not exist.
2. **Build periodic curved faces** as a shared keystone, scored by §3.3's three-bucket test —
   target: bucket A (exact) > 90 %, bucket C (deferred) → 0, face blow-up → 1.0×.
3. **Native defeature** in parallel; it is unblocked and independently valuable to the edit half.
4. **Route the 34 direct call sites** through the funnel, so the native engine is at least *asked*.
5. **Then** re-measure, and only then schedule `{TKBO, TKFillet, TKOffset}` as one closure cut
   14 → 9.

Until step 2 lands, the honest statement of the TKBO state is: **the native boolean engine is
present, is switched off in production by its own compiler, and on the evidence of 1,267 corpus
trees and 71 isolated first-boolean measurements it is not yet capable of replacing TKBO for a
single real CAD operation.**

---

## 7. Reproduction

All artefacts are in the session scratchpad
`/private/tmp/claude-501/-Users-account-clawteam1/d653c3c3-36e1-47f7-a422-af8248b8f360/scratchpad/`:

| file | what |
|---|---|
| `boolprobe.c` → `libboolprobe.dylib` | the TKBO call counter (`DYLD_INSERT_LIBRARIES`) |
| `run_corpus.cjs`, `drive.sh` | full-corpus `ft.compile` census |
| `run_trunc2.cjs`, `drive_t2.sh` | first-boolean truncation, index-keyed |
| `fk_gateon.node` | binding copy with `setForgeNativeBrepEnabled` patched to `ret` |
| `analyze.py`, `analyze2.py` | aggregation |
| `res_off.jsonl`, `trace_off.tsv` | census results + call trace |
| `t2nat_*`, `t2occt_*` | native vs OCCT truncation results, traces, `FORGE_BOOL_DIAG` log |

Key invocations:

```bash
# census (production path)
DYLD_INSERT_LIBRARIES=$D/libboolprobe.dylib BOOLPROBE_TRACE=$D/trace_off.tsv \
  node run_corpus.cjs 0 1613 res_off.jsonl

# native engine genuinely live, first boolean only, with miss reasons
FK=$D/fk_gateon.node FORGE_BOOL_DIAG=1 NBOOL=1 \
  DYLD_INSERT_LIBRARIES=$D/libboolprobe.dylib BOOLPROBE_TRACE=$D/t2nat_trace.tsv \
  node run_trunc2.cjs 0 150 t2nat_res.jsonl 2> t2nat_diag.log
```

### Final sweep counts

Both sweeps were stopped cleanly once the conclusions had stabilised (the machine was heavily
contended by other agents). The tables above are quoted at **census n = 1,267** and
**first-boolean n = 71**; the sweeps reached **n = 1,296** and **n = 82** before being stopped.
Re-running the aggregation at those final counts changes nothing that matters:

| | at n quoted | at n final |
|---|---|---|
| census compile ok / kind `occt` | 1,267 / 1,267 | **1,296 / 1,296** |
| first boolean — **exact** | **0 (0.0 %)** | **0 (0.0 %)** |
| first boolean — faceted | 49.3 % | 53.7 % |
| first boolean — deferred to TKBO | 50.7 % | 46.3 % |
| analytic-miss single cause | 100 % (45 events) | **100 % (52 events)** |

The two numbers that carry the argument — **0 % exact** and **100 % one cause** — are invariant
across every sample size measured (n = 17, 50, 57, 71, 82).

### Caveats

* §3.3 is a **stratified sample of 71 trees measured both ways** (15 per family drawn by line
  index), not the full 1,613. Every family that appears shows 0 exact results, and the cause
  distribution is 100 % single-valued, so the direction is not in doubt — but the exact 49/51
  split may move by a few points with more trees.
* The census in §2.2 is exact in aggregate. Its *per-tree* attribution is unreliable for the 578
  duplicated ids (§1.3), because the probe tag for that run was the `id`; the truncation runs
  (§3.3) were re-keyed on line index and are unaffected.
* The probe counts constructor entries. `BooleanOperation::Build` is reached through the vtable
  and is therefore under-counted; the constructor count is the operation count and is what is used.
* The four pattern-layer call sites are correctly classified as DIRECT (non-funnel); which one is
  `linearPattern` vs `circularPattern` is unresolved between `atos` and `nm` (§1.2).
