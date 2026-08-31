# FILLET — what the 117 that remained are, the rim blend that answers 59 of them, and the 21 wrong bodies that had exactly the right volume

**This continues `FILLET_ATTRIBUTION.md`.** That document took the FILLET row's
deletion bucket from 315 to 117 and left the remainder attributed by the engine's own
guard text. This one asks what those parts **are** — and then reports what happened
when the first version of the answer was measured instead of trusted.

The starting point, measured at `031b6886` and committed:

| family | N | both | nat only | **OCCT only** | neither | nat % | occt % |
|---|---:|---:|---:|---:|---:|---:|---:|
| FILLET | 600 | 344 | 0 | **117** | 139 | 57.3% | 76.8% |

| first guard that fired | parts |
|---|---:|
| `end face not planar` | 58 |
| `adjacent face has a non-straight outer boundary` | 21 |
| `adjacent face A is not planar` | 18 |
| `adjacent face B is not planar` | 11 |
| `adjacent face extent not measurable` | 7 |
| `vertex is not a simple 3-face corner` | 2 |

---

## 1. A guard name is not a diagnosis

Those six rows read like six problems. Measured per part over the same 600 — the face
types, the ring composition, the end faces, the wall structure and OCCT's own removed
volume — they are not:

| what the part actually is | parts | which guard it happened to hit |
|---|---:|---|
| a **cylinder at the ENDS** of the picked edge | **86** | `end face not planar` 58, `non-straight outer boundary` 21, `extent not measurable` 7 |
| a **cylinder ADJACENT** to the picked edge | 29 | `adjacent face A/B is not planar` |
| more than three faces at the vertex | 2 | `vertex is not a simple 3-face corner` |

**115 of the 117 fail directly ON a curved face — and the other two, which fail on
vertex valence, have a cylinder at that very vertex (their end-face signature is
`Plane, Plane, Cylinder`). Not one part in the deletion bucket is a fully planar
neighbourhood held back by a predicate.**

The 21 + 7 are the clearest case of the guard text misleading: both adjacent faces are
planar, perpendicular, at a dihedral of exactly 90°, and the ring guard that fires is
about **B-spline segments elsewhere on the ring** — but every one of those 28 parts
*also* has a cylindrical face at both ends of the edge (56/56 endpoints), so relaxing
the ring predicate would have moved them from one guard to the next and changed no
count at all. **The largest apparent win in the guard table was not a win.**

---

## 2. The 58 are one population, and the operation they name is not the edge

Every column is constant. There is no spread to characterise:

| observable | value on all 58 |
|---|---|
| cap face outer ring | `Circle,Line,Circle,Line,Circle,Line,Circle,Line` (a rounded rectangle) |
| worst tangent deviation across the eight junctions | **0.000e+00** (58/58 — the ring is exactly G1) |
| wall behind each straight segment | a planar prismatic face, ring `LLLL` (217) or `LLLLLL` (15), 0 inner wires |
| wall behind each arc | a quarter cylinder, axis ∥ the cap normal, ring `LCLC`, 0 inner wires (232/232) |
| holes in the cap | 4-10 inner wires |
| dihedral at the picked edge | exactly 90°, convex (58/58) |
| **OCCT's removed volume / the single-edge closed form** | **2.53x - 4.11x** |

That last row is the finding. `BRepFilletAPI_MakeFillet::Add` propagates a contour
across tangent junctions, so on these parts **OCCT is not blending the picked edge —
it is blending the whole rim.** A per-edge native blend would have been a *different
solid* reported as the same operation, which is precisely the class of false win that
the `NATIVE_ONLY` cell of this row turned out to be in the previous pass.

### The closed form, and how it was checked before any code was written

Removed material for a rim of straight runs and convex corner arcs:

```
|dV| = SUM over lines  (1 - pi/4) R^2 L
     + SUM over arcs   theta * [ R^2(2rho-R)/2 - R^3/3 - (rho-R) pi R^2/4 ]
```

The second term is Pappus applied to the same kite-minus-quarter-disc section swept
about the corner axis at major radius `rho-R`.

* Against **live OCCT on an exactly built rounded-rectangle prism** (a wire of four
  tangent quarter arcs and four lines, prismed): relative error **1.9e-15**, over
  three different size/radius combinations.
* Against **OCCT's answer on all 58 corpus parts**: **6.5e-4 to 7.6e-4**, always with
  the closed form slightly the larger. The corpus parts arrive from STEP as
  `Geom_SurfaceOfLinearExtrusion`, not canonical planes and cylinders, and OCCT
  approximates the blend on them; on the canonical synthetic prism the same comparison
  is exact to machine precision, which is what identifies the residual as OCCT's
  approximation rather than a missing term.

**The model was confirmed before a line of engine code was written.** That ordering is
the point: it made the implementation a transcription rather than a search.

---

## 3. What was built

`forge::occtfillet::filletTangentRim`, in `src/native/brep/NativeFilletChamfer.cpp`.
Every surface is analytic; nothing is fitted or approximated:

| piece | construction |
|---|---|
| the cap | its own outer ring offset inward by R — each line moves R along its in-plane inward normal, each arc keeps its centre and takes radius `rho-R`. Tangency makes the two agree at every junction, so the offset ring is exact; that identity is **asserted**, not assumed (every segment's offset end must meet the next segment's offset start). Inner wires are carried over verbatim. |
| each wall | pulled back R from the cap plane. Planar walls go through the existing ring machinery; cylindrical walls are rebuilt as the canonical uv patch they are, with an area identity (`rho * theta * height`) required of the original face before and the new face after, so a wall that is not that patch is declined rather than silently reshaped. |
| each straight rim segment | one `Geom_CylindricalSurface` patch (the engine's existing `filletCylinder`). |
| each arc rim segment | one `Geom_ToroidalSurface` patch: centre R below the cap, major radius `rho-R`, minor radius R, `v` in `[0, pi/2]` — tangent to the wall cylinder at `v=0` and to the offset cap at `v=pi/2`. |
| everything else | verbatim, then sewn by the existing `sewToSolid` (which already keeps every lump). |

**No new toolkit.** `Geom_ToroidalSurface` lives in TKG3d, the library the cylinder
patch already uses.

### Where it sits, and why it cannot move an existing answer

The rim path is tried **last** — only after the per-edge build and the corner-aware
batch have both declined — and only when the ring is a closed G1 loop carrying at
least one arc, which is exactly the condition under which OCCT propagates. A polygon
rim (a plain box lid) is not a propagating contour and is left to the per-edge path;
the A/B gate asserts that explicitly. Measured: **all 344 parts that passed before
pass now with a bit-identical volume, 344/344.**

---

## 4. The first version of this was measured, and the measurement found 21 wrong bodies

The A/B at `71df437a` scored the rim path as 80 successes: 58 `BOTH_OK` and 22
`NATIVE_ONLY`. `NATIVE_ONLY` is the cell this row has already been wrong about once,
so it was checked rather than counted, and the check found a defect.

**`BRepCheck_Analyzer` calls 21 of the 22 INVALID**, all with the same reading:
`IntersectingWires` on exactly one planar face, 21/21, with the shell flagged behind
it. Measured cause, not inferred:

| | the 21 invalid | the 59 valid |
|---|---|---|
| nearest hole-to-rim distance, in multiples of R | **0.104 - 1.000** | **1.000 - 10.59** |

The boundary sits exactly at 1.0, which is what the geometry predicts: the offset ring
moves the rim inward by exactly R, so a hole nearer than R is a hole the ring crosses.
The rebuilt cap is then a face whose outer wire runs through an inner one.

### And both checks it already had were blind to it

* the **volume** self-check matched the closed form to the last printed digit on all 21;
* the **cap-area** identity — introduced in the previous commit *specifically* to catch
  a hole, with a message that said so — passed on all 21 as well. **That claim was
  wrong and is corrected here.**

The reason is one line: volume and area are both computed as *(outer region) minus
(hole regions)*, the same subtraction whether or not the regions overlap. **Area was
not a different enough observable from volume.** This programme's standing lesson is
that a vector of observables is needed; this is that lesson one level on — two
integrals of the same region are one observable, and the observable that separates
these cases is **topological**.

**The guard is now that topological reading**: `BRepCheck_Analyzer` on the rebuilt cap
face (which names the condition exactly), plus a whole-body `BRepCheck` after the sew.
The rim path is new, so it is held to *returns a valid solid or declines* rather than
to the per-edge path's older contract — 91 of that path's 344 successes are
BRepCheck-invalid and are untouched here. The area identity is kept, with its claim
corrected to what it can do: catch an offset ring that closed onto the wrong region
without crossing a wire.

---

## 5. Re-measured

Same census, same 600 parts, stride 1, 0 part-level errors, at the committed SHA with
0 dirty files under `src`/`include`/`test`:

| | before | after | change |
|---|---:|---:|---|
| BOTH_OK | 344 | **402** | +58 |
| NATIVE_ONLY | 0 | **1** | +1 |
| **OCCT_ONLY (the deletion bucket)** | **117** | **59** | **−58** |
| NEITHER | 139 | 138 | −1 |
| native coverage | 57.3% | **67.2%** | **+9.8 pts** |
| OCCT coverage | 76.8% | 76.8% | unchanged |
| paired delta (95% CI) | −19.5% [−22.7, −16.3] | **−9.7% [−12.1, −7.3]** | |
| McNemar p | 1.2e-35 | 1.1e-16 | still FAIL |

Every part moved in exactly one of two ways, and no part moved in any other:

```
 58  OCCT_ONLY -> BOTH_OK        (the rim path, where OCCT also builds)
  1  NEITHER   -> NATIVE_ONLY    (the rim path, where OCCT does not)
344  BOTH_OK   -> BOTH_OK        (unchanged, and BIT-IDENTICAL: 344/344)
 59  OCCT_ONLY -> OCCT_ONLY      (unchanged)
138  NEITHER   -> NEITHER        (unchanged)
```

### Are the 59 new successes right?

* `native |dV| / independent closed form` = **1.000000000 on 59/59**, computed by the
  census probe from the cap ring, sharing no code with the engine.
* **All 59 are BRepCheck-VALID**, and on the 58 where OCCT also builds the two arms
  agree on **face, edge AND vertex counts, 58/58 on each**.
* The two arms' **total** volumes agree to **2.2e-6 - 5.0e-6** relative. That residual
  is OCCT's approximation of the blend on STEP extrusion surfaces (§2), of the same
  size and sign as the 7e-4 seen on the removed volume itself. It is larger than the
  A/B comparator's 1e-9 tolerance, so the harness records those 58 as *disagreeing on
  the full observable vector* — the disagreement is OCCT's approximation against the
  native arm's exact answer, in that direction.
* All 59 are a **4-line, 4-arc** rim — the population §2 characterises.

---

## 6. What is still in the 59 deferrals, and what this does not claim

`FORGE_FILLET_DROP_NATIVE` **still fails its flip gate** — 59 parts would turn from a
working operation into a thrown error. This is coverage, not a flip.

| guard | parts | what it needs |
|---|---:|---|
| `adjacent face has a non-straight outer boundary` | 21 | a blend that terminates on a cylindrical end face **and** a retrim that carries B-spline ring segments verbatim |
| `adjacent face A / B is not planar` | 29 | a plane-to-cylinder blend (a torus or general swept surface, not a cylinder) |
| `adjacent face extent not measurable` | 7 | the same cylindrical termination, on a D-shaped cap whose ring is two segments |
| `vertex is not a simple 3-face corner` | 2 | a corner surface for a vertex where more than three faces meet |

**Every one of the 59 has a curved face in the blend neighbourhood.** None is a
predicate that could be relaxed; each needs new surface geometry. That is the same
shape of answer family J (DRAFT) reached, and it is stated here so the next pass does
not spend itself re-deriving it.

Four limits, stated because they bound what the numbers above mean:

1. **One derived operation per part** (`CORPUS_AB_COVERAGE.md` §5.1). A different pick
   rule would give different counts.
2. **The rim path is FILLET only and single-edge only.** A rim CHAMFER is not authored,
   and a multi-edge request does not enter the path.
3. **A corner arc of half a turn or more is declined.** The offset ring is rebuilt
   through the existing minor-arc reconstruction, which is exact below `pi`, ambiguous
   at exactly `pi` (a stadium / slot rim) and wrong above it. Declining is the honest
   answer; every rim arc measured on this corpus is a quarter turn, so it costs no
   coverage here.
4. **A hole nearer than R to the rim is declined, and OCCT blends those.** §4 is why.
   Serving them needs the blend band to interact with the hole rather than merely
   avoid it — new geometry again, and 21 corpus parts' worth of it.

---

## 7. Gates

* `test/run_ab_native_fillet_concave.sh` — **114/114** assertions (was 75/75).
  Two RIM cases compare native to OCCT on the full observable vector (volume, centre
  of mass, all six bbox bounds, face/edge/vertex/shell counts, Euler + genus, BRepCheck
  validity), to the independent closed form, and on the face count (10 → 18). Five
  defer / boundary controls: a plain **BOX LID** must still be answered by the per-edge
  path and must NOT be taken by the rim path; `rho <= R` declines (**and OCCT succeeds
  there** — an honest gap, pinned rather than hidden); a wall shallower than R declines;
  a **hole 0.5R from the rim** declines (**this case FAILS with "engine DEFERS (got:
  ok)" against the engine at `71df437a`** — the defect of §4 is real and this is what
  stops it); and the same prism with the hole at 1.5R must still build, be valid, and
  match OCCT, so the guard is not a blanket refusal of holed caps.
  Compiled against the **pristine** engine the same file scores **90/96**, with six
  failures: both RIM build cases, the holed-prism build, and the three deferral-reason
  assertions. The gate is red before this work and green after.
* `test/build_fillet_defer_census.sh --selftest` — **5/5** controls (was 4/4). The new
  RIM control asserts, before any corpus number exists, that OCCT propagates
  (351.62 against 84.98 for one edge), that the closed form reproduces OCCT to
  **1.94e-15**, and that the engine agrees to **1.88e-14**. On the pristine engine the
  build refuses to emit a binary: `RIM CONTROL FAILED ... native ok=0`.
* `test/run_callsite_concave_fillet.sh` — 6/6 in the DEFAULT build and 6/6 in the
  `-DFORGE_FILLET_DROP_NATIVE=ON` build, 0 TKFillet symbol imports.
* `test/run_ab_all.sh` — the CI ratchet: `AB_BASELINE_fillet_concave=0`, unchanged and
  still met.

The op vocabulary is **not** affected: `gen_archie_op_vocabulary.py --check` is OK, and
none of the files changed here is one it hashes (`FeatureTree.hpp`,
`FeatureTreeCompiler.cpp`, `forge-kernel/CMakeLists.txt`, `ui/src/FeatureIr.cpp`,
`ui/src/PartCommands.cpp`, `ui/src/ForgeShell.cpp`, `forge-desktop/src/ForgeFrame.cpp`,
`docs/feature_tree_ir.md`).

---

## 8. Two things outside FILLET moved, and neither is this change

The re-measurement is the **full ten-family run**, not a FILLET slice, so a collateral
change would show. Diffed row by row against the committed baseline, **exactly three
arm statuses changed across 6600 paired trials**:

| rows | family | arm | change |
|---:|---|---|---|
| 59 | FILLET | native | `DEFER -> OK` — this change |
| 1 | THICKSOLID | **occt** | `OK -> CRASH` (`ho317`) |
| 1 | MAKEOFFSET | **occt** | `DEFER -> TIMEOUT` (`ho45`) |

Both of the others are on the **OCCT** arm of families this change does not touch, and
both are that arm's own nondeterminism:

* **The THICKSOLID crash lands on a DIFFERENT PART in two runs of the same binary** —
  `ho377` in the run at `71df437a`, `ho317` in the committed run — which is what makes
  it nondeterminism rather than a consequence of anything. `BRepOffsetAPI_MakeThickSolid`
  is not called by any code this change touches, and `OFFSETSHAPE`'s OCCT arm already
  crashes on 66 parts in the committed baseline. It moves that row's deletion bucket
  126 → 125 and its OCCT rate 22.2% → 22.0%.
* **The MAKEOFFSET timeout is the same part in both runs** (`ho45`), a 20 s arm
  deadline on a machine that was running three A/B jobs at once. It was already a
  failure (`DEFER`) in the baseline, so no count moves.

Both are recorded here rather than quietly absorbed.

---

## 9. A note on the census probe itself

The census now computes the rim closed form from the cap ring, so the artefact can
check the new path rather than only report it. Writing that column found a defect in
its own first version: without a tangency test it reported a rim prediction for **7
D-shaped caps** (one line and one arc meeting at a chord) that is **2.16x** OCCT's
actual removal there — a number that looks like a check and is not one. The tangency
test now runs first, and those 7 correctly report no prediction. The engine declines
them for the same reason.

---

## 10. Artefacts

| what | where |
|---|---|
| census probe (rim closed form + the RIM control) | `forge-kernel/test/fillet_defer_census.cpp` |
| census rows, BEFORE this change | `reports/corpus_ab/fillet_census_after_600.jsonl.gz` (the previous pass's after-state, pinned to `031b6886`) |
| census rows, AFTER | `reports/corpus_ab/fillet_census_rim_600.jsonl.gz` (+ `_manifest.json`) |
| A/B rows, AFTER (all ten families, 600 parts) | `reports/corpus_ab/full600_after_rim_results.jsonl.gz` |
| A/B summary + provenance, AFTER | `reports/corpus_ab/full600_after_rim_summary.md`, `_summary.json`, `_manifest.json` |

Re-run:

```sh
cd forge-kernel
test/build_fillet_defer_census.sh                            # the 5 controls first
JOBS=8 test/run_fillet_defer_census.sh all                   # the 600-part attribution
JOBS=8 test/run_corpus_ab_coverage.sh all                    # the coverage table
bash test/run_ab_native_fillet_concave.sh                    # 114/114
```
