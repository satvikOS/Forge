# THICKSOLID — every deferral attributed, and what the OCCT baseline is actually made of

**The `CORPUS_AB_COVERAGE.md` §3 baseline reads**

| family | N | both | nat only | **OCCT only** | neither | nat % | occt % |
|---|---:|---:|---:|---:|---:|---:|---:|
| THICKSOLID | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% |

and §3.2 records it as "hard for both". That sentence is true and it is also the
whole of what was known: 593 native deferrals with no cause attached to any of
them, and a 22.2% OCCT baseline nobody had looked inside.

Both are now measured per part. **Two facts change what the row means.**

1. **The entire 126-part deletion bucket has ONE cause**, and it is not the one
   the engine header predicted. It is not NURBS, and it is not curvature: it is a
   rule that declines a PLANAR face unless every one of its wires is exactly one
   full circle. The corpus is polygonal plates with cylindrical holes.
2. **Every one of OCCT's 133 successes is an invalid solid**, on a corpus whose
   600 source solids are all valid, and six of them have MORE volume than the body
   they hollowed. `FORGE_THICKSOLID_DROP_NATIVE` deletes 126 shapes, and not one
   of them passes `BRepCheck_Analyzer`.

---

## 1. The instrument, and the proof that it is inert

`src/native/brep/NativeThickSolid.cpp` gained the same behaviour-neutral defer
channel `src/native/brep/NativeLoftPipe.cpp` already carries: a thread-local
string, an `FK_DEFER(label)` macro that records a label and then does *exactly*
what the bare `return kNull` did, and `forge::occtoffset::lastThickSolidDeferReason()`.
63 defer sites were labelled mechanically — every site keyed on (line, exact old
text), aborting on any mismatch, so no site could be patched by accident.
`test/corpus_ab_coverage.cpp` passes the accessor to `runArm`'s existing
`reasonFn` hook, which is read **only on a DEFER and only to fill `note`**.

**Proved inert on the full corpus, not asserted.** The 600-part THICKSOLID run
was made twice, before and after the channel, from the same build script and the
same corpus:

```
parts compared                                  : 600
1. native arm identical except `note`           : 600/600
   native notes newly filled (were empty)       : 593
2. bucket + top-level fields identical          : 600/600
3. OCCT arm byte-identical                      : 587/600
   OCCT arm differing only in com within 1e-13  : 13/600
VERDICT: INERT
```

The 13 are **not** an effect of the change, and that was measured rather than
argued: the *same binary* run three times on each of those 13 parts produces a
different `occt.com[1]` on 12 of them. It is pre-existing summation-order noise in
`BRepGProp::VolumeProperties` where the y centroid is exactly zero — ~1e-15
against `|com| ~ 1e2` — in an arm the change cannot reach.

A second instrument, `test/thicksolid_input_census.cpp`
(+ `build_`/`run_thicksolid_input_census.sh`), measures the corpus INPUT and links
**no forge source at all**, only OCCT — a probe sharing code with the engine under
test could report the engine's own bug back as a property of the corpus. Its
controls (a box, a cylinder, a box with a through-hole) assert every column it
reports, so a census that classified everything as "other" could not pass.

---

## 2. What the corpus is

600 parts, whole corpus, no sampling.

| | |
|---|---:|
| source solids that pass `BRepCheck_Analyzer` | **600 / 600** |
| all-planar solids (the engine's path A) | **0 / 600** |
| all-analytic solids (no NURBS face) | 377 / 600 |
| solids with more than one lump | 271 / 600 |
| median face count | 97 |

Two consequences, both load-bearing.

* **`planarThickSolid` is dead code on this corpus.** Zero parts are all-planar,
  so the dispatcher never reaches path A. Every deferral is path B's.
* **The input is sound.** "Both engines return an invalid solid" (§4) is therefore
  a fact about the operation, not an inherited defect.

---

## 3. The attribution — all 593 deferrals, two causes

| first binding guard | parts | of which `OCCT_ONLY` | of which `NEITHER` |
|---|---:|---:|---:|
| `q_planar_wire_edge_not_circle` | **370** | **126** | 244 |
| `q_surface_unsupported` | 223 | **0** | 223 |

Read the second column. **The entire deletion bucket is in the first row.** The
223 parts with a NURBS face — the explanation the engine header would have
predicted — cost the ledger **nothing**, because OCCT declines every one of them
too.

`q_planar_wire_edge_not_circle` is one line of the quadric path's structural
admissibility test: a PLANAR face is admissible only when every one of its wires
is exactly one full circle, i.e. the face is a disk or an annulus. It is why the
7 parts the engine does cover are exactly the 7 with `planar_not_admissible == 0`.

### 3.1 How far that rule alone is from the corpus

The input census measures the complete precondition set a mixed polygon/quadric
path would still impose — analytic surfaces, curved faces a full revolution with
one wire, every edge a line or a full circle, manifold, every LINE edge between
two planes — and counts the parts that already satisfy all of it:

| | parts |
|---|---:|
| in scope for a mixed polygon path (`hybrid_admissible`) | **235** |
| of which already covered | 7 |
| of which blocked ONLY by the one-full-circle rule | **228** |

and of the 370 blocked by that rule, the residue splits cleanly:

| still blocked, and by what | parts |
|---|---:|
| nothing — reachable by lifting the wire rule | **228** |
| arcs: `pw_mixed` + `curved_partial_u` + `edge_neither_line_nor_circle` + `line_edge_nonplanar_nb` | 138 |
| arcs, without the partial-revolution term | 4 |

The **deletion bucket** splits the same way, and this is the number that governs
the flip gate:

| deletion-bucket part is blocked by | parts |
|---|---:|
| the wire rule alone — reachable | **21** |
| the wire rule **and** arcs / partial-revolution surfaces | 105 |

So the bounded fix's ceiling on the ledger is 126 → 105. The other 105 need
trimmed (partial-revolution) quadrics, arc edges, and planar wires mixing lines
and arcs — a real 2-D trim, not a bounded change. **That is stated as a measured
bound, not a plan.**

---

## 4. Is the OCCT dependency buying anything here?

This family is the one where that question has a different answer from every
other row, so it is answered explicitly.

**What OCCT buys: 126 parts. What none of them is: a valid solid.**

| over OCCT's 133 successes | |
|---|---:|
| `BRepCheck_Analyzer` valid | **0 / 133** |
| result volume ≥ the source volume (not a hollow at all) | 6 |
| median result volume / source volume | 0.836 |

The validity number is not an artefact of a strict checker or a broken corpus, and
both alternatives were ruled out by measurement:

* the **sources** are valid, 600/600 (§2);
* the **same harness, same corpus, same run** reports OCCT valid on 600/600 for
  `PIPE`, 600/600 for `THICKEN`, 594/600 for `MAKEOFFSET` and 455/461 for
  `FILLET` — which, like THICKSOLID, rebuilds the whole solid.

THICKSOLID is the only family of the eleven measured where **every** success on
**both** arms fails validity — native 7/7 and OCCT 133/133 at the baseline.

That is a materially different shipping argument from the other nine rows. On
`PIPE` or `DRAFT`, dropping OCCT deletes work that OCCT does correctly. Here it
deletes 126 shapes that `BRepOffsetAPI_MakeThickSolid` reports `IsDone()` on and
that no downstream consumer should accept, six of which are larger than the body
they were cut from. **The flip gate as written — "native success rate >= the
measured OCCT baseline" — cannot see this, because it counts `IsDone()`.** Nothing
here is a reason to flip the option; it is a reason not to read this row's 22.2%
as capability.

---

## 5. The fix, and what it actually moved

Three changes to the quadric path, in the order the census forced them. Each was
made only after the census named the guard, and each is exact — no tolerance was
widened and no approximation was introduced.

**(C) Polygon wires.** A planar wire is now admissible as one full circle **or**
as a closed loop of LINE edges. This needs no new curve type: a LINE edge is
shared by two PLANES, so its cavity image is the meet of two offset planes, and
each vertex is the meet of the offset planes around it — the corner solve path A
has always used, applied to a mixed solid. The one new construction,
`planarLoopFace`, self-checks its own area against the closed form (shoelace for
polygons, `pi R^2` for circles) exactly as the all-circular builder does, and an
all-circular face still goes through the original builder **byte for byte**.

**(D) Coplanar face split, and the riser.** With (C) in, all 228 in-scope parts
stopped at one routine, in two shapes: a full circle shared by two planar faces
that BOTH contain it. That is not a geometric edge — it is a topological split of
one flat region, which real STEP carries constantly — so there is no dihedral for
the meridian meet to solve, and `offsetCircle` was being asked a question with no
answer. The offset circle is the same circle translated onto the cavity plane;
when one side is the MOUTH the two sides land on different planes and the wall is
closed across the step by an exact cylindrical **riser** of the circle's own
radius. When both sides are retained they land on the same plane and **no riser is
built**.

**(E) Rank-deficient polygon corners.** The same splits again: a polygon-wire
vertex on a split edge carries three or four incident faces but only two — or one
— distinct planes, so the least-squares meet of their offset planes is singular
however many faces are listed. Deduplicating first, a rank-2 corner's image is the
perpendicular projection onto the line where the two offset planes meet, and a
rank-1 corner's is the projection onto that single plane. Both are exact: the
original and offset lines are parallel, so one perpendicular translation carries
every vertex on the edge, and the polygon keeps its shape.

### 5.1 The gate

`test/thicksolid_mixed_closedform.cpp` (+ `build_thicksolid_mixed_closedform.sh`)
links the **same object archive** the 600-part A/B is built from, and asserts
CLOSED FORMS derived from the geometry — never borrowed from OCCT, which §4 shows
is not a valid oracle for this operation.

| case | what it pins |
|---|---|
| (A) plate 40×40×20, R=5 through hole, top removed, t=2 | volume `8672+382π`, area `8992+402π`, all three centre-of-mass components, the 12-planar/2-cylindrical face census, both cylinder radii **and** areas, `BRepCheck` valid |
| (B) cylinder R=10 H=30, top removed, t=2 | REGRESSION: the all-circular path still answers `1208π` |
| (C) top split at r=8, larger part removed | volume `8672+412π`, **exactly one** riser at radius 8 with area `32π` |
| (D) same split, a SIDE face removed | volume `10112+284π`, and **no** cylinder at radius 8 — a split of one flat region must be invisible |
| (E) top, bottom and both y-walls split at x=−10 | volume `10112+284π` through rank-2 corners, exactly two cylinders, valid |
| (N1) t deeper than the half extent | must DEFER |
| (N2) a planar wire mixing a line and an arc | must DEFER **and name** `q_planar_wire_not_circle_or_polygon` |
| (N3) a NURBS face | must DEFER **and name** `q_surface_unsupported` |

**Case E is proved falsifiable.** Mutating the rank-2 branch to `else if (false)`
makes E fail with `corner_fewer_than_two_distinct_planes|q_planar_mixed_loops_fail`
while every other case still passes; restoring it returns the gate to green.

**And the gate is RATCHETED, not just written.** `test/run_ab_native_thicksolid_mixed.sh`
puts it in `test/run_ab_all.sh`'s harness list with `AB_BASELINE_thicksolid_mixed=0`,
which is the CI step that exists because two harnesses once stopped LINKING and 541
assertions silently stopped running. Its BUILD/LINK-fail path is proved to fire:
running it with `CXX=/nonexistent-compiler` returns exit 2 and `run_ab_all.sh`
reports `RED thicksolid_mixed: DID NOT BUILD/LINK`, exit 2 — not "0 failures". With
the compiler restored all **8** harnesses are green, `39 passed, 0 failed` here.

### 5.2 The re-measurement — and it is not a large number

See §6 for the table. The honest summary is that the fix is **correct and nearly
inert on the ledger**, and the census says exactly why: each guard the fix removed
uncovered the next one, and they are all rooted in the same thing — this corpus's
flat regions are split into many coplanar faces, and its holes are spaced closer
than the derived wall.

The final residue, over the 235 in-scope parts:

| where an in-scope part now stops | parts | ledger effect |
|---|---:|---|
| `q_sew_shell_count` (+2 `q_sew_free_edges`) — the body has TWO lumps and the sew closes into two shells | 197 | **none**: all 198 multi-lump in-scope parts are `NEITHER`; OCCT fails on 271/271 multi-lump parts |
| `pcf_collapsed_…` — the offset boundary loops MERGE | 29 | 20 of the deletion bucket's reachable 21; the 21st (`ho1160`) now builds |

**Neither residue is a bounded fix, and the reasons differ.**

* The multi-lump one is bounded *work* — assemble one solid per shell — but its
  entire payoff is in the `NATIVE_ONLY` cell, because **OCCT declines all 271
  multi-lump parts**. `CORPUS_AB_COVERAGE.md` §3.2 records what that cell is worth:
  FILLET's 51 `NATIVE_ONLY` wins were the engine handing the caller's own shape
  back. A cell with no reference implementation to check against is the worst place
  to spend a capability claim, and it would move the deletion bucket by zero.
* The loop-merge one is **not** bounded. Measured on the deletion-bucket parts:
  an outer disk offsets to `Ro = 21.44` while its seven holes grow to
  `sum(Rh^2) = 469.2 > Ro^2 = 459.7` — the grown holes no longer fit. The cavity's
  boundary loops merge and faces disappear. No analytic re-trim of the original
  faces can express a topology change; expressing it needs a real 2-D boolean in
  the offset plane. The engine declines rather than emit a wrong shape, which is
  the contract.

---

## 6. Result

Full corpus, **600/600 parts, 0 part-level failures**, same corpus and same
derivation as the committed baseline, build stamp and HEAD in agreement.
Artefacts: `reports/corpus_ab/thicksolid_mixed_600_{summary.md,results.jsonl.gz,manifest.json}`
and `reports/corpus_ab/thicksolid_input_census_600.jsonl.gz`.

| family | N | both | nat only | **OCCT only** | neither | nat % | occt % | McNemar p | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| THICKSOLID — committed baseline | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% | 2.4e-38 | FAIL |
| THICKSOLID — after (C)+(D)+(E) | 600 | 8 | 0 | **125** | 467 | 1.3% | 22.2% | 4.7e-38 | FAIL |
| `OFFSETSHAPE` — **CONTROL** | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | 3.1e-6 | FAIL |

**Every part moved in exactly one way and no part moved in any other:** one
`OCCT_ONLY -> BOTH_OK` (`ho1160`), and 599 unmoved. The option still fails its flip
gate. **The number moved by one part.**

**The control did not move at all.** `OFFSETSHAPE` is family H, it lives in the same
file, and it shares `offsetCircle`, `planarCircularFace`, `intersectPlanes` and
`orderedRing` with the code that changed. It reproduces the committed baseline
`0 / 7 / 38 / 555`, `1.2% / 6.3%`, cell for cell — so nothing leaked out of family G
through the shared helpers, and the three labelling passes over those helpers are
confirmed inert a second time on a second family.

### 6.1 Where the 592 deferrals now stop

| first binding guard | parts | in the deletion bucket |
|---|---:|---:|
| `q_surface_unsupported` — a NURBS face | 223 | 0 |
| `q_sew_shell_count` — the sew closes into more than one shell | 195 | 0 |
| `q_planar_wire_not_circle_or_polygon` — an arc, or a wire mixing lines and arcs | 142 | **105** |
| `pcf_collapsed_…` — the offset boundary loops MERGE | 29 | **20** |
| `q_sew_free_edges` | 2 | 0 |
| `plf_offset_region_collapsed` | 1 | 0 |

and the 235 in-scope parts partition **exactly** by lump count, with no residue
unaccounted for:

| in-scope parts | n | outcome |
|---|---:|---|
| single-lump | 37 | **8 BUILD**, 29 loops merged |
| multi-lump | 198 | 195 sew into >1 shell, 2 free edges, 1 collapsed |

### 6.2 Why the ledger barely moved, in one line each

* **195 of the 198 in-scope parts that are still declined are two-lump bodies, and
  every one of them is already `NEITHER`.** All 271 multi-lump parts in the corpus
  are `NEITHER`: OCCT declines every one. Building them could not remove a single
  part from the deletion bucket.
* **All 20 remaining in-scope deletion-bucket parts hit the same wall**, and it is
  the one wall an exact analytic engine cannot climb: an outer disk offsets to
  `Ro = 21.44` while its seven holes grow to `sum(Rh^2) = 469.2 > Ro^2 = 459.7`. Seven
  disjoint circles of that size cannot fit in that disk, so the cavity's boundary
  loops have merged and faces have disappeared. That is a topology change, not a
  re-trim.
* **The other 105 of the deletion bucket were never in scope**: they carry arcs and
  partial-revolution quadrics, which §3.1 measured before any code was written.

## 7. What a reader should take from this

* **A success rate cannot say which of an engine's sixty preconditions bound it.**
  This row's 1.2% was read as "hard for both". It was one line, and that line held
  the whole deletion bucket. The census cost one afternoon.
* **The cheapest attribution is the engine's own guard text.** Not a
  re-implementation of its predicates — those drift — and not an inference from the
  header, which named NURBS as the likely cause and was measuring 0 of the
  deletion bucket.
* **A defer census pays even when the fix does not move the number.** The three
  fixes here are exact and gated, and they moved the ledger by one part. What they
  bought is the *next* question, stated in measured terms: 197 parts are one
  multi-lump assembly away with no oracle to check it (OCCT declines all 271
  multi-lump parts, so building them moves the deletion bucket by zero), and 29
  are behind a topology change no analytic engine can express. Before the census,
  none of that was distinguishable from "NURBS".
* **Check what a baseline is made of before treating it as capability.** OCCT's
  22.2% here is 133 invalid solids, six of them larger than the body they hollowed.
