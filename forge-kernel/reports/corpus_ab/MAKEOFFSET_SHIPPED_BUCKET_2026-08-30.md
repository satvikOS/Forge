# MAKEOFFSET — the last two parts in the SHIPPED deletion bucket, attributed and closed

Continues `MAKEOFFSET_PARITY_2026-08-30.md` (PR #110), which closed the 27-part
corpus-A/B bucket and left **two** parts — `ho13`, `ho133` — still deferring on
the SHIPPED `forge::cam::inwardOffset`, where OCCT builds. Those two are what
kept `FORGE_OFFSET_DROP_MAKEOFFSET`'s Law 9 clause at FAIL. Both are now closed.

Measured from a tree pinned to `origin/claude/makeoffset-parity-20260830`
@ `22ce7f05` merged with `origin/claude/sacrosanct-execution-20260828`
@ `7e6b405c`, OCCT 7.x from `/opt/homebrew/opt/opencascade`, corpus
`archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`
(600 parts, the whole set).

## 1. Headline

| measurement (`test/run_cam_inwardoffset_coverage_ab.sh`) | before | after |
|---|---|---|
| stock arm — OCCT `BRepOffsetAPI_MakeOffset` (the baseline) | 594/600 = 99.0% | **byte-identical**, 594/600 |
| drop arm — native `PolygonOffset2D` only | 598/600 = 99.7% | **600/600 = 100.0%** |
| **deletion bucket** (OCCT builds, native declines) | **2** (`ho13`, `ho133`) | **0** |
| capability add (native builds, OCCT does not) | 6 | 6 |
| rate clause | PASS | **PASS** |
| Law 9 clause (bucket empty) | **FAIL** | **PASS** |

The arms are proved to differ before any number is believed: `cmp` says the two
binaries differ, and `nm -u` reports **4** `BRepOffsetAPI_MakeOffset` symbols in
the stock arm and **0** in the drop arm.

`FORGE_OFFSET_DROP_MAKEOFFSET` IS STILL NOT FLIPPED and this does not ask for it
— see §6. It remains `OFF`.

## 2. Attribution — 2 of 2 to ONE cause, and it is not the one the retry fixes

`test/cam_inwardoffset_ring_probe.cpp` reproduces the coverage harness's face
selection exactly and replays the ring `tryNativeInwardOffset` builds (the same
sampler and deflection, taken from the INCLUDED `src/Cam.cpp`, never re-typed):

```
ho13   edges=8 allLines=0 n=278 area=25889.18 d=7.8387 ccw=1 ext=243.9  dropped=1 relaxed=0
ho133  edges=8 allLines=0 n=278 area=19476.32 d=6.8055 ccw=1 ext=220.2  dropped=1 relaxed=0
```

Both are one cause and it is inside `cleanRawLoop`, not the offset:

```
[attempt] srcN=278 rawN=556 rawArea=20775.009693          <- the RIGHT area
  [clean] R=3074 nodes=1815 H=3074 kept=310 unbalanced=14
  [clean] chained loops=0                                  <- reported as a total collapse
```

`rawOffset` produces a ring of exactly the right area (20775.01, against the
20775.04 the fixed code finally returns). The whole of the loss is the
arrangement cleanup leaving the kept edge set unbalanced at **14 nodes**, in
7 pairs of `in=2 out=0` / `in=0 out=2`, after which every chain walk dead-ends.

Ruled out by measurement, not by argument — the arrangement is COMPLETE:
0 `PROPER_CROSS` survive the split on the refined ring, **0** `COLLINEAR_OVERLAP`
anywhere, and `ENDPOINT_TOUCH` is 556 on 556 segments, i.e. exactly the ring
adjacency count. There are no missed crossings and no T-junctions.

**The 14 unbalanced nodes are the interior vertices of 7 closed sub-chains.** The
refined ring around the first of them reads

```
  ring[756] node=444 (-54.74422782053733, 45.59656420672818)   X
  ring[757] node=445 (-54.74424124941723, 45.596564206752085)  P
  ring[758] node=446 (-54.74421438904722, 45.596564206750294)  Q
  ring[759] node=444 (-54.74422782053733, 45.59656420672818)   X again
```

with `|X-P| = 1.34289e-5`, `|P-Q| = 2.68604e-5`, `|Q-X| = 1.34315e-5` — the two
halves sum to the whole, so X is the MIDPOINT of PQ and the three are collinear.

This is the overshoot ear of a convergent corner: an inward offset of a convex
vertex pushes the current edge's offset end P past the corner and the next
edge's offset start Q back before it, and X is where the two offset lines cross.
At a well-conditioned corner the ear is a TRIANGLE and the winding test prunes
it correctly. Here the source corner turns by ~3.4 microradians — what a ring
sampled off a near-straight spline is made of — so the ear encloses nothing, all
three of its sub-edges lie ON the region's true boundary, and each is
independently classified as a boundary edge:

```
   he756 X->P  len=1.34289e-05  wL=1 wR=0  kept
   he757 P->Q  len=2.68604e-05  wL=0 wR=1  kept (flipped)
   he758 Q->X  len=1.34315e-05  wL=1 wR=0  kept
```

so `kept` holds `X->P`, `Q->P` and `Q->X` — the SAME piece of boundary three
times — giving P `in=2 out=0` and Q `in=0 out=2`. That is the whole defect.

**Why the existing sub-tolerance retry cannot reach it.** The retry decimates the
SOURCE ring (278 -> 131 at `arcTol = 7.84e-3`) and re-offsets. The defect is a
property of the ARRANGEMENT, not of the sampling density, so it simply
reappears: 1 flat ear, 2 unbalanced nodes, 0 chained loops. That is also why a
coarser retry tolerance was correctly rejected as non-monotone by PR #110 — it
was aimed at the wrong layer.

## 3. The fix — excise what the arrangement cannot resolve

`cleanRawLoop` gains one step between node assignment and half-edge
construction: every closed sub-chain of the refined ring — a walk that returns
to a node it has already visited — is excised iff **every one of its vertices
lies within `snapDist` of one straight line**, `snapDist` being the very
distance at which `nodeOf` two lines above already welds two points into ONE
node. No new constant is introduced.

A chain that flat cannot separate any two points this arrangement can tell
apart, so it contributes nothing to the winding number that matters and its
sub-edges only duplicate boundary the surrounding long edges already carry.

Three deliberate choices:

* **Flatness, not signed area.** A figure-eight sub-chain has |signed area| ≈ 0
  with real geometry on both lobes; an area test would excise it. Flatness
  cannot cancel.
* **`rawClosed` is NOT rebuilt.** The winding reference stays the full refined
  ring, so the region `{winding == expectedSign}` is bit-for-bit the one this
  function has always extracted. Only the set of sub-edges offered as boundary
  candidates changes.
* **The walk starts at a node visited exactly once**, so no sub-chain can
  straddle the ring's seam. If every node repeats, the ring is left untouched.

Measured separation of the threshold, over the four failing arrangements:

| | flatness | vs `snapDist` |
|---|---|---|
| least flat chain that IS excised | 1.71e-9 | **134x below** |
| flattest chain that is KEPT | 2.04e-4 | **987x above** |

The band the threshold sits in is empty over five orders of magnitude.

## 4. Evidence

* **`test/native/geom/polygonoffset2d_test.cpp`** — the printed-seed gate,
  including (d) "an inward offset past the inradius collapses honestly":
  **17/17 PASS**.
* **The shipped coverage A/B, row by row.** The OCCT stock arm is
  **byte-identical** pre- and post-fix. In the drop arm **exactly two rows
  changed**, both `DEFER -> OK`: `ho13`, `ho133`. Nothing else moved.
* **The recovered geometry is right, not merely non-null.**
  `test/cam_inwardoffset_geom_probe.cpp` runs OCCT's `inwardOffset` and
  `tryNativeInwardOffset` on the same wire in the same process:

  | part | wires (occt/native) | length rel | bbox rel | centroid rel |
  |---|---|---|---|---|
  | `ho13`  | 1 closed / 1 closed | 7.56e-6 | 1.67e-6 | 3.14e-7 |
  | `ho133` | 1 closed / 1 closed | 7.26e-6 | 7.74e-6 | 3.46e-7 |

* **The full 600-part native observable delta**
  (`test/run_cam_inwardoffset_native_delta.sh`, which builds the probe twice —
  once from the working tree and once from `HEAD~1` — and refuses to report a
  number unless `cmp` shows BOTH the two `PolygonOffset2D` objects and the two
  binaries differ):

  ```
  rows whose ok/wires/closed changed:                    2   (ho13, ho133: 0 -> 1)
  rows still OK in both but with a MOVED observable:    27
    max length_rel 4.08e-05   max bbox_rel 2.42e-05   max centroid_rel 5.99e-06
    length grew on 27, shrank on 0
  ```

  **Those 27 moved TOWARD OCCT.** On the 21 of them OCCT can do (the other 6 are
  the parts OCCT itself times out on at 20 s) the same probe measures each arm
  against OCCT: **19 moved closer, 2 moved further by 6e-8**, and the worst-case
  disagreement with OCCT improves on all three observables:

  | vs OCCT, worst of the 21 | before | after |
  |---|---|---|
  | length rel | 4.773e-5 | **3.197e-5** |
  | bbox rel | 3.792e-5 | **1.845e-5** |
  | centroid rel | 6.068e-6 | **7.812e-7** |

* **Causality, with a control.** Replaying 66 dumped rings through a build
  instrumented to count excisions: the excision fired on **27 of the 27** moved
  parts and on **0 of the 39** parts that did not move. No part moved without an
  excision and no excision happened without a move.
* **Why those 27 moved, exactly.** The same 66 rings, counting how many were
  answered by PR #110's sub-tolerance retry rather than on the first attempt:

  ```
  pre-fix : 27 of 66 rings answered BY THE RETRY
  post-fix:  0 of 66
  ```

  The retry answers from a DECIMATED ring (it removes the sub-`arcTolerance`
  vertices and re-offsets). Removing the arrangement defect the retry was
  working around means those 27 rings now succeed on the FIRST attempt, at FULL
  input resolution — which is why their contours moved, and why they moved
  toward OCCT. The 27 that moved, the 27 the excision fires on, and the 27 that
  used to need the retry are the SAME 27.
* **The corpus A/B, the family the shipped path is not.** `FAMILIES=MAKEOFFSET,FILLING`
  over all 600 parts, against the committed post-#110 baseline
  (`reports/corpus_ab/makeoffset_postfix_600_results.jsonl.gz`):

  | | baseline | this tree |
  |---|---|---|
  | MAKEOFFSET both / nat-only / **OCCT-only** / neither | 594 / 6 / **0** / 0 | **identical** |
  | MAKEOFFSET native %, OCCT %, verdict | 100.0%, 99.0%, PASS | **identical** |
  | MAKEOFFSET `BRepCheck_Analyzer` valid, native | 600 | **600** |
  | MAKEOFFSET agree / agree-up-to-orientation / disagree | 309 / 309 / 285 | **identical** |
  | FILLING (untouched CONTROL) both / OCCT-only / neither | 407 / 0 / 193 | **identical** |
  | rows differing in STATUS or BUCKET, either family | — | **0** |

  32 MAKEOFFSET rows do move geometrically, and it is the same mechanism: the
  edge count RISES on 32 of 32 (e.g. 114 -> 253, 100 -> 252), which is a
  full-resolution ring replacing a decimated one. Against OCCT the worst case
  over the 26 comparable rows is a wash on length (6.521e-5 -> 6.520e-5), 1.6x
  worse on bbox (1.27e-6 -> 2.01e-6) and **45x better on centre of mass**
  (4.52e-6 -> 1.01e-7); no row crosses the agree/disagree boundary in either
  direction.

## 5. What this does NOT change

* **The DEFAULT build's behaviour, at all.** `PolygonOffset2D` has exactly one
  consumer in the tree — `tryNativeInwardOffset`, called from
  `forge::cam::inwardOffset` — and in a stock build that call sits behind
  `native::brep::forgeNativeFeaturesEnabled()`, which is env-only opt-in and
  defaults **OFF** (`src/native/brep/NativeRoute.cpp:74-80`). The code changed
  here is reached only with `FORGE_NATIVE_FEATURES=1` set at runtime or with
  `FORGE_OFFSET_DROP_MAKEOFFSET` compiled in. That is the blast radius.
* **Runtime.** Timed over the same 66 rings with no OCCT in the loop: pre-fix
  0.32 s user, post-fix 0.27 s. The excision is O(1) amortised per excised
  chain and it removes a whole second offset+cleanup on every ring that used to
  need the sub-tolerance retry, so it pays for itself.
* **The OCCT link ledger.** `src/native/geom/PolygonOffset2D.cpp` contains **0**
  OCCT identifiers and the added lines use only `std::fabs`, `std::hypot`,
  `std::max`, `std::move`, `std::size_t`, `std::vector`, all already used in that
  translation unit. The ledger cannot move. It is NOT re-measured here:
  `scripts/occt_closure_count.sh` and `scripts/tkoffset_ledger_gate.sh` both
  need `build/Release/forge-kernel.node`, which is not in the tree and cannot be
  built here (`ninja`, the conforming generator, is not installed).

## 6. Does `FORGE_OFFSET_DROP_MAKEOFFSET` pass its flip gate now? Still no, and this does not claim it does

`CMakeLists.txt:520-528` names four pieces of evidence. On this tree:

1. *"re-run the 382-part sweep with the option ON and show native defers <= the
   OCCT baseline rate"* — `data/forge/complex_all.jsonl` **is not in the tree**.
   PR #110's substitute — the SHIPPED `forge::cam::inwardOffset` over the 600
   parts that ARE — now reads **native 600/600 vs the OCCT baseline 594/600,
   deletion bucket 0**. Both halves of the clause (the rate, and Law 9's empty
   bucket) are satisfied on the substitute. **This is the only one of the four
   that is now met.**
2. *"`test/cam_native_offset_ab.mjs` ALL PASS"* — **that file is not in the tree.**
3. *"the five cam smokes byte-identical"* — they `require`
   `forge-kernel/build/Release/forge-kernel.node`, **not built here**.
4. *"the four mandated gates green"* — not run here.

Independently of all four, per the same CMake block flipping this option leaves
`OCCT_DIRECT` at 8 and `OCCT_CLOSURE` at **14** (TKOffset stays linked for the
other 8 families). It is blocking-set reduction 42 -> 38 symbols, not a drop, and
the goal is `OCCT_CLOSURE == 0`.

## 7. The archived artefacts

| file | what it is |
|---|---|
| `makeoffset_shipped_cam_bucketfixed_600.txt` | the shipped coverage A/B's paired table, post-fix |
| `makeoffset_shipped_cam_drop_bucketfixed_600.txt` | its drop arm, row by row (diff against `makeoffset_shipped_cam_dropfixed_600.txt` from PR #110 to see the 2 rows) |
| `makeoffset_shipped_bucket_600_{results.jsonl.gz,manifest.json,summary.md}` | the 600-part corpus A/B control |
| `makeoffset_native_observable_{base,head}_600.txt` | the full native observable vector per part, both revisions |

The corpus A/B manifest records `git_head 81d6a85b` with
`dirty_files_in_src_include_test: 0`. The only later change to
`PolygonOffset2D.cpp` is two explanatory comments; the compiled object is
**byte-identical** (`cmp` on the two `-O2` objects), so the archived numbers
describe this tree's code exactly.

## 8. Reproduce

```
forge-kernel/test/build_corpus_ab_coverage.sh
forge-kernel/test/run_cam_inwardoffset_coverage_ab.sh <outdir>          # the coverage clause
BASE_REV=HEAD~1 forge-kernel/test/run_cam_inwardoffset_native_delta.sh  # what else moved
forge-kernel/test/build_cam_inwardoffset_geom_probe.sh                  # native vs OCCT geometry
forge-kernel/test/build_cam_inwardoffset_ring_probe.sh                  # DUMP_RING=1 to replay a defer

clang++ -std=c++20 -O2 -Wall -Wextra -I forge-kernel/include \
    forge-kernel/src/native/geom/PolygonOffset2D.cpp \
    forge-kernel/src/native/Predicates.cpp \
    forge-kernel/src/native/geom/Geom.cpp \
    forge-kernel/test/native/geom/polygonoffset2d_test.cpp -o /tmp/k4 && /tmp/k4
```
