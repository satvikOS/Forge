# THICKSOLID — what the flip gate's bar is actually made of

**One sentence.** `FORGE_THICKSOLID_DROP_NATIVE`'s coverage bar is **133 OCCT
answers of which ZERO are usable**: 123 have holes in their boundary, 94
self-intersect, every one of them fails `BRepCheck_Analyzer`, **not one is a
benign complaint**, and the ten whose shells do close are still 18.5–61.6% away
from the correct volume measured by an independent oracle that contains no
offset engine at all.

Measured 2026-09-03 on branch `work/thicksolid-honest-bar` off `ac0ca610`, over
the same 600 gold reference solids and the same derived operation
`test/corpus_ab_coverage.cpp` uses. Native at this HEAD answers **0 / 600**.

---

## 0. What was asked, and the three answers

| question | answer |
|---|---|
| How many of the invalid answers are invalid in a way that MATTERS? | **133 of 133.** 123 open shells, 94 self-intersecting, 84 both, 6 enclosing more volume than the body they hollowed, **0** with no structural fault. Not one tolerance- or flag-level `BRepCheck` status appears anywhere in the corpus. |
| What is the largest set for which a CORRECT answer is achievable, and what would it take? | **31 of 600** — and all 31 are inside the current 133. Every one of them needs the same missing capability: **offsetting a planar region with a real 2-D boolean, so boundary loops may merge and faces may vanish.** 24 of the 31 additionally need trimmed partial-revolution quadrics and arc edges. The other 102 of the 133 need a **topology-changing 3-D erosion**, which is not a bounded increment. |
| Quantify the crash. | **2 of the 133 move** — `ho317` and `ho377` — measured over all 133 parts × 20 fresh runs; the other 131 are bit-stable. Those two are 8 samples' worth of an event whose per-part rate is 13–22%: pooled over 400 runs each, `ho317` crashes **51/400 (12.8%)** and `ho377` **89/400 (22.2%)**, same binary, same input. The `SIGSEGV` is inside **`BRepCheck_Analyzer::IsValid()`**, on the shape OCCT's own thicksolid engine had just returned with `IsDone()` true — and that call is inside the flip gate, at `test/corpus_ab_coverage.cpp:284`. |

---

## 1. The instruments, and why there are three of them

`reports/corpus_ab/THICKSOLID_ATTRIBUTION.md` §4 established that OCCT's 133
successes are 133 invalid solids. "Invalid" is not a verdict: `BRepCheck_Status`
has 36 members and an `InvalidSameParameterFlag` is bookkeeping where a
self-intersection is not. Answering the question needs instruments that do not
share code with either engine under test.

| instrument | what it links | what it answers |
|---|---|---|
| `test/thicksolid_bar_census.cpp` | OCCT only, no forge source | per part: the full `BRepCheck` status histogram, the structural facts `BRepCheck` does **not** report (free edges, non-manifold edges, signed volume, identity return), `BOPAlgo_ArgumentAnalyzer`'s self-interference test, and a `ShapeFix_Shape` repair-and-re-measure |
| `test/thicksolid_truth_oracle.cpp` | **no offset engine at all** — the STEP reader, the mesher and `BRepGProp` | the CORRECT answer, from the definition: the erosion `C(t) = { p in int(S) : d(p, dS\F) > t }`, evaluated by Monte Carlo for volume and by voxels for topology |
| `test/thicksolid_bar_fixture_gate.cpp` | OCCT only | the same finding on six-face fixtures, so it survives without the corpus and runs in CI |

**Every one of the three refuses to emit a binary if its controls are red**, and
the controls are chosen so that the *believable* direction is pinned first — a
census that reported everything invalid would look exactly like a real result on
this corpus, so the valid direction is asserted before anything else.

### 1.1 The oracle is the load-bearing one, so it carries a control per part

The erosion definition is not an approximation of `MakeThickSolidByJoin`: it is
the convention `GeomAbs_Arc` implements (a convex corner stays sharp, a reflex
corner rounds at radius `t`). The box control proves it: hollowing a 20 mm box
by 1 mm with the top removed gives `8000 - 18*18*19` from OCCT and the same from
the oracle.

Every part additionally carries a **built-in control**: the SAME Monte-Carlo
sample that estimates the result also estimates `vol(S)`, which `BRepGProp` knows
exactly. Over the 600 parts the deviation is **median 0.78 SE, p90 2.15 SE, max
4.84 SE**, with 4 parts over 4 SE. A part whose mesh or ray cast is wrong reports
itself instead of producing a plausible number.

**That control fired twice during construction and both times the first answer
looked completely reasonable.**

* A sliver triangle has a small `|a|` in the Möller–Trumbore denominator for a
  reason that is *not* "parallel to the ray"; an absolute epsilon there drops it,
  which punches a hole in the surface and flips the parity of every ray behind it.
* The sample box was taken from the **vertex** bounds, mirroring the A/B's own
  derivation. A full circular edge carries **one** seam vertex, so a cylindrical
  part's vertex box excludes most of its own material. This cost up to **35.7%**
  of a part's volume on 41 of 600 parts **while the tessellated surface area was
  right to 0.2%** — an area check cannot see it, only a volume check can. The
  sample box is now the mesh box; the derivation still uses vertex bounds,
  because that is what the gate measures.

Both are now controls (`K4b` a cylinder, `K5` a thin plate) that fail if either
is reintroduced.

### 1.2 The topology measurement is resolution-checked, and proved in both directions

The cavity's Betti numbers are counted on a voxel raster at `h = wall/3`:
components `b0`, enclosed voids `b2`, Euler characteristic `X` of the cubical
complex, and handles `h = b0 + b2 - X`.

* **Both directions.** Control `K3`: a plate with two 5 mm holes 2 mm apart,
  eroded by 2 mm, must LOSE a handle. Control `K4`: the same two holes 18 mm
  apart must NOT. A merge detector that always fires would pass K3 and fail K4.
* **Resolution.** `ho1041` and `ho519` report the same 9 handles at `wall/3`,
  `wall/6` and `wall/10` (up to 35 M voxels). `ho317` reports 30 source handles
  and 1 cavity handle at `wall/3`, 31 and 0 at `wall/6` — the conclusion (a
  collapse from ~30 to ~0) does not move.
* A scanline ray that lands exactly on a mesh edge counts two crossings or none,
  and a box tessellated by midpoint splitting puts its vertices on exactly the
  coordinates a regular lattice samples. Measured on the K1 control that cost
  18.5% of the voxels and reported **29 components for a solid cube**. The
  scanline is offset inside its own voxel by an irrational fraction of `h`.

---

## 2. Answer 1 — how many of the 133 are invalid in a way that matters

Whole corpus, 600/600 parts, 0 part-level errors. All 600 source solids are
`BRepCheck` VALID with 0 free edges and 0 non-manifold edges.

### 2.1 The structural classes, measured directly

| | parts of 133 |
|---|---:|
| **open shell** — a non-degenerate edge with fewer than 2 face uses | **123** |
| **self-intersecting** — `BOPAlgo_ArgumentAnalyzer` `SelfInterMode` | **94** |
| both of the above | 84 |
| result volume **≥** the source volume | 6 |
| non-manifold edge (more than 2 face uses) | 0 |
| negative or zero volume | 0 |
| identity return (result observably equals the input) | 0 |
| **no structural fault at all** | **0** |

Joint distribution, and it partitions the 133 exactly:

| classes | parts |
|---|---:|
| open shell + self-intersecting | 81 |
| open shell only | 36 |
| self-intersecting only | 10 |
| open shell + volume ≥ source | 3 |
| open shell + self-intersecting + volume ≥ source | 3 |

Degenerate edges (a cone apex, a sphere pole) legitimately bound one face and are
excluded from the free-edge count — a term that reds a valid part is a wrong
gate, not a stricter one. The median part has **12 free edges out of 176**, and
the median self-intersecting part has **24 interfering pairs** (max 146).

**The volume column carries a caveat and it is stated rather than buried:** for
123 of the 133 the boundary is not closed, so `BRepGProp::VolumeProperties` is
evaluating the divergence theorem over a surface with holes in it. The "6 with
more volume than the source" is what the harness would compare; it is not a
meaningful volume.

### 2.2 The `BRepCheck` histogram — every status is structural

Parts affected / total occurrences over the 133:

| status | parts | occurrences |
|---|---:|---:|
| `NotClosed` | 128 | 267 |
| `BadOrientationOfSubshape` | 77 | 114 |
| `UnorientableShape` | 48 | 144 |
| `EnclosedRegion` | 33 | 33 |
| `SubshapeNotInShape` | 30 | 30 |
| `InvalidImbricationOfWires` | 21 | 21 |

**Not one tolerance or flag status appears anywhere** — no
`InvalidSameParameterFlag`, no `InvalidSameRangeFlag`, no `InvalidToleranceValue`,
no `InvalidCurveOnSurface`, no `No3DCurve`. The benign class is empty by
observation, not by argument.

### 2.3 The benign test, run rather than asserted

"Benign" is operationalised falsifiably: a complaint is benign iff a
tolerance-level repair clears it **without moving the geometry**. `ShapeFix_Shape`
(precision 1e-7, max tolerance 1e-3) was run on all 133 and every observable
re-measured.

| after `ShapeFix_Shape` | parts |
|---|---:|
| still INVALID | **116** |
| reports VALID | 17 |
| …of the 17, still carrying free edges | **17** (7 to 18 each) |
| …of the 17, free-edge count changed by the repair | **0** |
| …of the 17, volume changed by more than 1e-9 relative | **0** |
| …of the 17, face or shell count changed | 1 face count, 0 shell counts |

**The repair moved nothing.** Whatever it cleared for those 17, it was not the
holes in their boundary: the free-edge count is identical before and after on all
17. `BRepCheck_Analyzer::IsValid()` returning true on a shape with 18 free edges
is the reason the structural columns above are measured directly instead of read
off the checker. (The mechanism by which the checker changes its mind was not
determined and is not claimed.)

**So: 0 of 133 are benign, by three independent routes** — the structural
measurement, the status histogram, and the repair test.

---

## 3. Answer 2 — the largest set with an achievable correct answer

The correct answer always EXISTS (the erosion is defined for every part; **0 of
600** have an empty cavity at the derived wall). The question is which capability
produces it. The oracle answers that by measuring the correct cavity's topology
against the body's.

### 3.1 The sieve — 600 parts, each filter on top of the last

| filter | parts | of which OCCT built |
|---|---:|---:|
| all parts | 600 | 133 |
| + the correct cavity PRESERVES the body's component and handle count | **92** | 31 |
| + the body is a single lump | 47 | 31 |
| + every face is an analytic quadric or plane | **31** | **31** |
| + in scope for the native mixed path (`hybrid_admissible`) | 7 | 7 |

and the first binding reason a part is out of reach of an exact re-trim engine,
over all 600:

| first binding reason | parts |
|---|---:|
| a NURBS / other face is present | 223 |
| the body has more than one lump | 198 |
| **the correct cavity CHANGES TOPOLOGY at this wall** | **148** |
| an arc edge or a partial-revolution quadric | 24 |
| nothing — reachable | 7 |

Restricted to the **133 the flip gate counts** (all of which are single-lump and
all-analytic — that is the family the bar is made of):

| first binding reason | parts |
|---|---:|
| the correct cavity CHANGES TOPOLOGY at this wall | **102** |
| an arc edge or a partial-revolution quadric | 24 |
| nothing — reachable | 7 |

### 3.2 The capability, named

**The largest set of THICKSOLID parts for which a correct answer is achievable by
an exact analytic engine is 31 of 600, and all 31 are already inside the 133.**
Reaching them needs, in this order:

1. **Planar-region offsetting with a real 2-D boolean.** All 31 stop at the same
   wall: the offset of a planar face's boundary loops **merge**. The native
   engine's `circlesNest` guard names it exactly and declines rather than emit a
   crossing face (`cn_hole_escapes_rim_d23.81_rh4.685_Ro24.02_over4.474` on
   `ho1041`: a hole reaching 4.47 mm past the rim). An annulus built from circles
   that must nest cannot express a merged loop; a 2-D boolean in the offset plane
   can. This is the whole of the gap for 7 of the 31 and part of it for all 31.
2. **Trimmed partial-revolution quadrics and arc edges** — the remaining 24 of the
   31 also carry a planar wire mixing lines and arcs, or a quadric that is not a
   full revolution.

**Everything beyond those 31 is not a bounded increment**, and the reasons are
different in kind:

* **508 of 600 parts (148 of them otherwise in reach; 102 of the 133) need a
  topology-changing erosion.** The correct cavity has a different handle or
  component count from the body it is cut from: `ho317`'s body has 30 handles and
  its correct cavity has 1. No re-trim of the original faces can express a face
  that must disappear; that needs a genuine morphological erosion with
  self-intersection removal in the offset space.
* **271 parts are multi-lump.** OCCT builds on **0** of them, so this capability
  moves the deletion bucket by exactly zero — a cell with no reference
  implementation to check against.
* **223 parts carry a NURBS face.** OCCT declines every one of them too.

### 3.3 And the reachable ones are not reachable by copying OCCT

For the 31, OCCT's own answers are: **0 valid**, 21 with free edges, 29
self-intersecting, and a **median volume error of +58.4%** against the oracle
(min +15.9%, max +158.6%). Even on the ten of the 133 whose shells DO close, all
ten self-intersect and all ten are wrong:

| part | OCCT volume | correct volume | error |
|---|---:|---:|---:|
| `ho708` | 67455.2 | 56933.4 ± 278 | **+18.5%** |
| `ho519` | 33278.2 | 27865.5 ± 156 | +19.4% |
| `ho432` | 214510 | 165752 ± 734 | +29.4% |
| `ho20` | 66310.1 | 49596.9 ± 267 | +33.7% |
| `ho46` | 141912 | 106094 ± 551 | +33.8% |
| `ho614` | 48232.2 | 34649.1 ± 180 | +39.2% |
| `ho301` | 248806 | 163276 ± 918 | +52.4% |
| `ho471` | 146975 | 96035.2 ± 530 | +53.0% |
| `ho594` | 139365 | 88008.7 ± 416 | +58.4% |
| `ho320` | 45992.5 | 28453.1 ± 186 | **+61.6%** |

Over all 133 the median relative volume error is **0.879** and **132 of 133
remove too little material**. Not one is within 3 standard errors of the correct
answer; one is within 5%.

### 3.4 Thinning the wall does not rescue it — the derivation is not the problem

The derived wall (`0.05 * min bbox extent`) is a plausible suspect: too thick a
wall makes the operation ill-posed. It was tested rather than argued. The same
derived operation was re-run at `t/1 … t/128`, whole corpus:

| wall | `IsDone` | `BRepCheck` valid | closed (0 free edges) | **valid AND closed AND not the identity** |
|---|---:|---:|---:|---:|
| t | 133 | 0 | 10 | **0** |
| t/2 | 175 | 1 | 17 | 1 |
| t/4 | 165 | 2 | 18 | 2 |
| t/8 | 151 | 4 | 24 | 4 |
| t/16 | 147 | 4 | 24 | 4 |
| t/32 | 145 | 7 | 27 | 7 |
| t/64 | 146 | 7 | 30 | 7 |
| t/128 | 147 | 7 | 31 | **7** |

**A 128-fold thinner wall moves the usable count from 0 to 7 out of 600.** The
bar is not thick-wall degeneracy.

---

## 4. Answer 3 — quantifying the crash

### 4.1 Whole-corpus repetition: the verdict is nearly stable, and that is not reassuring

| instrument | passes over all 600 | parts whose verdict changed |
|---|---:|---:|
| `test/run_corpus_ab_coverage.sh` with `FAMILIES=THICKSOLID` | 4 | **0** |
| `test/thicksolid_bar_census.cpp` at the derived wall | 4 | **1** (`ho377`, `OK → CRASH_sig11` once) |

**Machine state, stated because a race is being measured:** a 14-core Apple
Silicon Mac running other agents' full ten-family A/B suites concurrently for
most of the session. That is the same condition
`reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md` §8 recorded its own observations
under. A ten-family repetition was started as a third instrument and **stopped
part-way rather than completed** — with three A/B suites sharing the machine the
20-second arm deadline becomes its own confound, and the eight dedicated passes
below plus §4.2b already answer the question.

Across the four A/B passes the OCCT arm was byte-identical on all 600 parts. In
the four census passes, **36 parts' volumes differ between passes** — at the 1e-15
relative level, i.e. summation-order noise, exactly the effect
`THICKSOLID_ATTRIBUTION.md` §1 already recorded for the centre of mass.

### 4.2 Single-part repetition: the rate is 13–22%, and eight passes was simply too few

Eight whole-corpus passes is eight samples of a rare event. Repeating **one part
in a fresh process, 100 times per block**, same binary, same input, on a 14-core
machine also running other jobs:

| part | wall | blocks of 100 | pooled | 95% CI |
|---|---|---|---:|---|
| `ho317` | derived `t` | 11, 14, 16, 10 | **51 / 400 = 12.8%** | 9.5–16.0% |
| `ho377` | derived `t` | 20, 19, 24, 26 | **89 / 400 = 22.2%** | 18.2–26.3% |
| `ho153` | `t/2` | 14 | **14 / 100 = 14.0%** | 7.2–20.8% |

The four blocks per part were taken with three successive builds of the probe
(the differences are added diagnostics, not changed calls), so the spread across
blocks is the event's own variance and machine load, not a change of instrument.

`ho317` and `ho377` are exactly the two parts
`reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md` §8 recorded crashing in the
ten-family runs. With ~2 parts at ~15%, a single 600-part pass has roughly a 74%
chance of showing **no** crash at all, and eight passes were expected to show
about one. One is what they showed. **The whole-corpus stability and the 15%
per-part rate are the same fact seen at two sample sizes**, and the smaller number
is the one that matters: the bar for this family contains parts that answer
differently on 1 run in 7.

### 4.2b How much of the bar moves: exactly two parts of the 133

Breadth, rather than depth: **all 133 parts the gate counts, 20 fresh runs each,
2660 evaluations.**

| | |
|---|---:|
| parts that crashed at least once | **2** — `ho317` and `ho377` |
| parts whose verdict differed across the 20 passes | **2** |
| total crashes | 3 / 2660 runs (0.11%) |
| P(a whole 133-part pass shows no crash at all), from those rates | **0.855** |

So the instability is **not** diffuse: **1.5% of the bar is nondeterministic and
the rest is bit-stable**, and the two parts are exactly the two
`FILLET_RIM_ATTRIBUTION.md` §8 named. The 0.855 is the whole reconciliation
between §4.1 and §4.2 — eight passes at that rate are expected to show about one
crash, and showed one.

### 4.3 What crashes, precisely — `BRepCheck_Analyzer::IsValid()`

The probe streams a marker before each measurement step, so the fault is
attributed rather than inferred. Over 200 further runs with the finer markers in
place:

| part | runs | crashes | last marker written |
|---|---:|---:|---|
| `ho317` | 100 | 10 | `obs_check` |
| `ho377` | 100 | 26 | `obs_check` |

`obs_check` is written immediately before `BRepCheck_Analyzer(s).IsValid()` and
after the volume, the area and every topology map have already been computed and
survived. So:

* the `SIGSEGV` is **not** in `BRepOffsetAPI_MakeThickSolid` — the child had
  already written `IsDone = 1` and the shape's volume, area and five topology
  counts before dying;
* it is in **OCCT's own validity checker, on the shape OCCT's own thicksolid
  engine had just produced**.

**That path is inside the flip gate.** `test/corpus_ab_coverage.cpp:284` runs
`BRepCheck_Analyzer an(s); r.valid = an.IsValid() ? 1 : 0;` on every arm result,
inside the arm's forked child — which is exactly the `OK -> CRASH` transition
`reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md` §8 recorded and could not explain.
A gate whose baseline is 133 shapes that OCCT itself cannot always finish
checking is a gate whose bar is not defined.

`ho153` also returns **six distinct volumes across 86 successful runs** at `t/2`
(span 1.16e-9 on 1.2e6), so the same input does not always produce the same
output either.

---

## 5. What was implemented

No bounded increment to the **engine** is licensed by this measurement: the 31
reachable parts all need a 2-D boolean in the offset plane, which is the same
class of work `THICKSOLID_ATTRIBUTION.md` §6.2 already declined to call bounded,
and the other 102 of the 133 need a topology-changing erosion. Emitting a shape
for them would be emitting a wrong shape, which is the one thing the engine's
contract forbids.

What **is** bounded, and is implemented here, is making the finding
non-forgettable without the corpus:

**`test/thicksolid_bar_fixture_gate.cpp`** (+ `build_` / `run_` scripts,
registered in `test/run_ab_all.sh` with `AB_BASELINE_thicksolid_bar_fixture=0`).
76 assertions over six fixtures, no corpus, no forge source. It pins:

1. **Positive control first.** A plain cylinder (R 26.4, H 40) with the whole top
   removed hollows to its closed form `pi R^2 H - pi (R-t)^2 (H-t)` at five walls
   from 0.166 to 5, closed and valid every time.
2. **The finding.** Split that one flat region into **two coplanar faces** —
   nothing else changes — remove one of them, and `MakeThickSolidByJoin` returns
   **the input**: `IsDone()` true, `BRepCheck` VALID, shell closed, and volume,
   area, face/edge/vertex/shell/solid counts and bounding box all **equal to the
   source's**, at every one of the five walls. The paired A/B scores that row
   `OCCT_ONLY` — a capability the drop deletes — with `occt.vol = 87582.57663`,
   which is the argument's own volume.
3. **And the identity is wrong**, proved with no offset engine: the ball of radius
   `20 - t` about `(0,0,H/2)` lies inside the solid and more than `t` from every
   retained face, so the cavity contains it and the correct volume is at most
   `vol(S) - (4/3)pi(20-t)^3` = 54897.8 at the derived wall. The oracle puts it at
   **1641.8 ± 24.5** — the shell `area x t` closed form gives 1643.
4. **The over-thick box**, so (2) is not a one-off: a wall larger than the half
   extent leaves no cavity and the engine hands the source back rather than
   declining.
5. **The corpus's dominant failure mode, hermetically.** `ho1041`'s own numbers
   (R 26.4, 8 holes r 2.304 at 23.808, t 2.3808 — the geometry `circlesNest`
   cites): removing the face the corpus derivation itself picks gives `IsDone`,
   an **invalid open shell**, counted as a success. Removing the **mirror face at
   z = H** on the *same solid at the same wall* makes OCCT **decline**. Pulling
   the holes clear of the rim makes it build a clean closed valid hollow.

**Mutation-proved:** making `splitTopCylinder` return the unsplit cylinder turns
**22 of the 76 red** and moves nothing else; restoring returns it to 76/0, stable
over three runs.

**And its BUILD/LINK-fail path is proved to fire**, which is the whole reason
`run_ab_all.sh` exists: run with `CXX=/nonexistent-compiler` the runner prints
`BUILD/LINK FAIL` and exits 2, and with the compiler restored the suite reports
`GREEN — all 10 harnesses BUILT, and each matched its baseline`.

---

## 6. What a reader should take from this

* **A success predicate that is `IsDone()` can be satisfied by the function's own
  argument, and on this family it is.** The fixture gate shows it on a six-face
  solid whose only unusual property is that one flat region is carried as two
  coplanar faces — which is what real STEP looks like.
* **"Invalid" needs a census before it is a verdict, and here the census makes the
  verdict stronger, not weaker.** 123 open shells and 94 self-intersections is a
  different sentence from "133 fail `BRepCheck`", and the empty benign class was
  measured three ways rather than argued once.
* **`BRepCheck_Analyzer::IsValid()` is not a closure test.** 17 of the 133 report
  VALID after a repair that did not close a single one of their 7-to-18 free
  edges.
* **An oracle that is the definition beats an oracle that is an implementation.**
  The erosion `{ p in int(S) : d(p, dS\F) > t }` needs no offset engine, agrees
  with OCCT to 1e-6 on the cases where OCCT is right, and carries a per-part
  control that caught two of its own defects — each of which produced a
  completely plausible number.
* **A bar that moves on 1 run in 7 on some of its parts is not a bar**, and eight
  whole-corpus passes were not enough to see it. When an event is rare, repeat the
  single case, not the sweep.

---

## 7. Artefacts

| what | where |
|---|---|
| per-part census (600 rows: `BRepCheck` histogram, free/non-manifold edges, self-interference, `ShapeFix` re-measure) | `reports/corpus_ab/thicksolid_bar/census_600.jsonl.gz` |
| the same, three independent repeat passes | `reports/corpus_ab/thicksolid_bar/census_600_rep{2,3,4}.jsonl.gz` |
| wall sweep `t … t/128`, 600 parts | `reports/corpus_ab/thicksolid_bar/sweep_600.jsonl.gz` |
| independent erosion oracle, 600 parts (MC volume + voxel Betti numbers) | `reports/corpus_ab/thicksolid_bar/truth_oracle_600.jsonl.gz` |
| input census (face/edge/wire classes), 600 parts | `reports/corpus_ab/thicksolid_bar/input_census_600.jsonl.gz` |
| 100-run repetition blocks for `ho317`, `ho377`, `ho153` (900 rows) | `reports/corpus_ab/thicksolid_bar/crash_reps.jsonl.gz` |
| all 133 bar parts × 20 fresh runs (2660 rows) | `reports/corpus_ab/thicksolid_bar/built133_x20.jsonl.gz` |
| four `FAMILIES=THICKSOLID` A/B passes (bucket summaries) | `reports/corpus_ab/thicksolid_bar/ab_rep_summaries.txt` |
| provenance (HEAD, corpus, OCCT version, settings) | `reports/corpus_ab/thicksolid_bar/manifest.json` |
| the two control logs, as run | `reports/corpus_ab/thicksolid_bar/{census,truth_oracle}_selftest.txt` |

### 7.1 How to re-make every number here

```sh
cd forge-kernel
# the two corpus-scale instruments (each builds itself and refuses to emit a
# binary if its controls are red)
test/run_thicksolid_bar_census.sh   /tmp/census.jsonl            # section 2
test/run_thicksolid_bar_census.sh   /tmp/sweep.jsonl  sweep      # section 3.4
test/run_thicksolid_truth_oracle.sh /tmp/oracle.jsonl            # section 3
test/run_thicksolid_input_census.sh /tmp/input.jsonl             # section 3.1

# the corpus-free gate (this one IS in run_ab_all.sh)
test/run_ab_native_thicksolid_bar_fixture.sh                          # section 5

# the crash rate: one part, 100 fresh processes
for i in $(seq 1 100); do
  .build-corpus-ab/thicksolid_bar_census "$CORPUS/ho317.step" --name=ho317
done | grep -c CRASH                                             # section 4.2
```

The census and the oracle both need the 600-part corpus, which is **not** in this
repository (`CORPUS=` overrides the path). The fixture gate needs nothing.
