# FILLET — what the 51 NATIVE_ONLY parts have in common, and what the 315 deferrals were

**Both cells of the FILLET row are now attributed per part, and both turned out to
be defects in the native engine rather than facts about the corpus.**

The `CORPUS_AB_COVERAGE.md` §3 baseline reads

| family | N | both | nat only | **OCCT only** | neither | nat % | occt % |
|---|---:|---:|---:|---:|---:|---:|---:|
| FILLET | 600 | 146 | **51** | **315** | 88 | 32.8% | 76.8% |

and the two starred cells point in opposite directions. `51 NATIVE_ONLY` was read as
a capability OCCT lacks. `315 OCCT_ONLY` is the deletion `FORGE_FILLET_DROP_NATIVE`
would cause, and a count cannot say whether it is a capability gap or a predicate.

Neither reading survived measurement.

---

## 1. The instrument

`test/fillet_defer_census.cpp` + `test/run_fillet_defer_census.sh`, one JSON row per
part over the same 600-part corpus, the same derived operation (longest LINE edge,
`R = 0.05 * min bbox extent`) copied verbatim from `test/corpus_ab_coverage.cpp`.

It records the **engine's own** `Result::reason` — not a re-implementation of its
guards — and, on the OCCT side, two observables the A/B does not keep:

* **`NbContours()` after `Add(r,e)` and before `Build()`.**
  `BRepFilletAPI_MakeFillet::Add` silently declines to open a contour for an edge it
  will not blend, and `Build()` then raises
  `StdFail_NotDone("There are no suitable edges for chamfer or fillet")`. Zero
  contours separates *OCCT refused the EDGE* from *OCCT accepted the edge and the
  BUILD failed* — two different facts the A/B recorded as one `THREW`.
* **`ChFi3d::IsTangentFaces` and `ChFi3d::DefineConnectType`**, the predicates `Add`
  itself consults.

`--selftest` runs four controls before any corpus number exists, and
`build_fillet_defer_census.sh` refuses to emit a binary if any is red: a box edge
where both arms must build and both must move `(1-π/4)R²L` to within 3%; a
cylinder-adjacent edge the native engine must decline; a pre-rounded box seam where
OCCT must open **zero** contours and throw; and a cylinder seam where the native
engine must not hand back its input as a success.

**Replication check.** The census's own bucket verdicts reproduce the committed A/B
row on **600/600 parts, 0 mismatches**. The two harnesses are independent code
paths, so the attribution below is anchored to the same measurement the coverage
table reports.

---

## 2. The 51 NATIVE_ONLY parts — one population, and not a capability

Every column is constant across all 51. There is no spread to characterise:

| observable | value on all 51 |
|---|---|
| faces adjacent to the picked edge | 2 entries, and they are the **SAME FACE** |
| surface types of those entries | `Cylinder` / `Cylinder` |
| `ChFi3d::IsTangentFaces` | **true** (51/51) |
| `ChFi3d::DefineConnectType` | **Tangential** (51/51) |
| OCCT contours opened by `Add` | **0** (51/51) |
| OCCT verdict | `THREW: There are no suitable edges for chamfer or fillet` (51/51) |
| native verdict | `OK`, reason `native fillet (prismatic straight edges)` (51/51) |
| **native result volume vs input volume** | **bit-identical, ΔV = 0 on all 51** |

The common property is a single sentence: **the part's longest LINE edge is the
u-wrap SEAM of a full 360° cylindrical face**, where one face meets itself.
`TopExp::MapShapesAndAncestors` lists that one face twice, so an `Extent() == 2`
test reads it as two adjacent faces.

There is genuinely no material at such an edge, and OCCT is right to refuse. The
native engine detected it too — `edgeIsTangentNoOp` — and `continue`d past it. But
`continue` past the *only* spec left `seq.ok == true` and `work` still equal to the
untouched input, so `makeFillet` returned **the caller's own shape, unchanged, with
`ok == true` and the reason "native fillet (prismatic straight edges)"**.

So the 51 are not a capability OCCT lacks. They are 51 parts on which the engine
performed no operation and reported success, and the A/B — whose success predicate
is the call site's own ("a non-null shape with a non-empty result") — scored each
one as a native win. **8.5 of the 32.8 points credited to this engine were the input
handed back.** Under `FORGE_FILLET_DROP_NATIVE` the same path would silently discard
a user's fillet where OCCT raises an error.

Reproduced with no corpus at all, in three lines: `BRepPrimAPI_MakeCylinder(5, 20)`,
longest line edge, `R = 0.5` → before the fix, `ok == true` and
`1570.796327 → 1570.796327`.

**Fix.** `makeFillet` / `makeChamfer` now count the specs actually applied and defer
when the count is zero (`"every requested fillet edge is a tangent no-op (a periodic
seam or a coplanar artefact edge) — nothing to blend"`). Skipping a no-op inside a
**mixed** request is still right — one seam edge must not kill the real edges beside
it — and that behaviour is unchanged.

---

## 3. The 315 OCCT_ONLY deferrals — attributed, and 198 were one defect

The engine's own guard text, per part:

| first guard that fired | parts | what it is |
|---|---:|---|
| `fillet volume disagrees with (1-π/4)R²L self-check` | **198** | §3.1 — a defect, now fixed |
| `end face not planar` | 58 | scope: the end-plane section would not be a circular arc |
| `adjacent face has a non-straight outer boundary` | 21 | scope: ellipse / B-spline ring, not retrimmable |
| `adjacent face A is not planar` | 18 | scope: curved adjacent face → torus blend |
| `adjacent face B is not planar` | 11 | same |
| `adjacent face extent not measurable — deferring` | 7 | ring unreadable |
| `vertex is not a simple 3-face corner` | 2 | scope: corner surface not authored |

The 88 `NEITHER` parts split the same way (65 non-planar B, 22 non-planar end face,
1 non-planar A) — those are inputs neither engine serves.

### 3.1 The 198: a two-lump body with one lump deleted

Of the 344 parts that reach `sewToSolid`, the sew closes **perfectly on every one** —
`NbFreeEdges() == 0` and `NbMultipleEdges() == 0`, 344/344. The split is elsewhere,
and it is total:

| | parts | shells the sew produced | outcome |
|---|---:|---:|---|
| single-lump bodies | 146 | **1** | build, and `\|ΔV\| / (1-π/4)R²L == 1.000` on all 146 |
| two-lump bodies | 198 | **2** | rejected by the volume self-check, all 198 |

`sewToSolid` took `TopExp_Explorer`'s **first** shell and made a solid of it,
discarding the other lump. On `ho1274` that kept 15 of 89 faces and returned
326199.6 for a body of 337988.1 — and 326199.6 + 11788.5 = 337988.1, the two lumps'
volumes. The corpus's STEP files carry these parts as **compounds of two disjoint
solids** (`nsolids == nshells == 2`, measured).

The self-check caught every one, which is why this shipped as a deferral and not as
a wrong answer — the removed-to-expected material ratio ran from **27× to 273×**
(median 86×) — but its message named the symptom and hid the cause. The OCCT arm
moves exactly the closed-form amount on the same 198 parts (`|ΔV| / (1-π/4)R²L = 1.000`
on 198/198), so the disagreement was entirely the native side.

**Fix.** `sewToSolid` keeps every shell the sew produced, and assembles them the way
the input assembles its own: it requires the input to have as many SOLIDs as SHELLs
(no internal void, whose sign is opposite) and as many shells as were just sewn, then
returns a compound of one positively-oriented solid per shell. An input carrying a
void, or a shell count the blend changed, is declined rather than guessed at. Two
further guards are added on the same path: a non-zero `NbFreeEdges()` now declines
instead of forcing `Closed(true)` on an open shell (which still yields a volume, and
a wrong one), and every face handed in must survive into some shell.

---

## 4. Re-measured, same harness, same 600 parts

`FAMILIES=FILLET test/run_corpus_ab_coverage.sh all`, stride 1, 0 part-level errors:

| | before | after | change |
|---|---:|---:|---|
| BOTH_OK | 146 | **344** | +198 |
| NATIVE_ONLY | 51 | **0** | −51 |
| **OCCT_ONLY (the deletion bucket)** | **315** | **117** | **−198** |
| NEITHER | 88 | 139 | +51 |
| native coverage | 32.8% | **57.3%** | **+24.5 pts** |
| OCCT coverage | 76.8% | 76.8% | unchanged |
| paired delta | −44.0% [−49.2, −38.8] | **−19.5% [−22.7, −16.3]** | |
| McNemar p | 1.4e-47 | 1.2e-35 | still FAIL |

Every part moved in exactly one of two ways, and no part moved in any other:

```
198  OCCT_ONLY   -> BOTH_OK      (the two-lump fix)
 51  NATIVE_ONLY -> NEITHER      (the no-op fix: false wins removed)
146  BOTH_OK     -> BOTH_OK      (unchanged)
117  OCCT_ONLY   -> OCCT_ONLY    (unchanged)
 88  NEITHER     -> NEITHER      (unchanged)
```

### Are the 198 new successes right?

* **`|V_native − V_OCCT| / V_OCCT == 0.000e+00` on all 198.** Exact volume agreement.
* **167 of 198 agree with OCCT on the entire observable vector** — volume, centre of
  mass, all six bbox bounds, face/edge/vertex/shell/solid counts and BRepCheck
  validity.
* The remaining **31 differ only in topology counts and validity** (e.g. 89 vs 91
  faces, 186 vs 193 edges, native `BRepCheck` invalid where OCCT is valid). No
  geometric observable differs on any of them. That is the same character the engine
  already had on 60 of its original 146 successes; it is **not** improved here and is
  named as an open item in §5.

### Regression check on the 146 that already passed

* native volume **bit-identical before and after on 146/146**;
* full-vector agreement count **86 before, 86 after**.

The fix adds parts and changes nothing that already worked.

### Gates

* `test/run_ab_native_fillet_concave.sh` — **75/75** assertions (was 66/66; nine new,
  see below).
* `test/run_callsite_concave_fillet.sh` — 6/6 in the DEFAULT build and 6/6 in the
  `-DFORGE_FILLET_DROP_NATIVE=ON` build, with 0 TKFillet symbol imports in the drop
  build.
* `test/build_fillet_defer_census.sh --selftest` — 4/4 controls.

Two new A/B cases pin both defects, and **both were red before the fix**:

* **TANGENT SEAM** — a cylinder's u-wrap edge: the engine must decline, OCCT must
  decline, and the engine must not hand back the input as a success. Before the fix
  it returned `ok` with `v0 == v1 == 1570.796327`.
* **MULTI-LUMP** — two disjoint boxes in one compound, blended on an edge of lump 1:
  the engine must build, remove exactly `(1-π/4)R²L`, keep **both** lumps (6+6 faces
  → 7+6), and match OCCT on the full observable vector. Before the fix the same
  request deferred.

---

## 5. What is still in the 117, and what this does *not* claim

`FORGE_FILLET_DROP_NATIVE` **still fails its flip gate** — 117 parts would turn from
a working operation into a thrown error, p = 1.2e-35. This is a coverage improvement,
not a flip. The residue is now dominated by genuine scope statements in the engine's
own header — non-planar end faces (58), non-straight adjacent rings (21), curved
adjacent faces (29), unreadable ring extents (7), non-trihedral corners (2) — every
one of which needs new geometry (a torus or a swept blend surface), not a relaxed
predicate.

Three limits, stated because they bound what the numbers above mean:

1. **One derived operation per part.** The distribution is the harness's, not a
   production trace (`CORPUS_AB_COVERAGE.md` §5.1). A different pick rule would
   give different counts — in particular, the seam-edge population in §2 exists
   *because* the rule takes the longest LINE edge.
2. **31 of the 198 new successes are BRepCheck-invalid** while OCCT's answer is
   valid, with every geometric observable identical. That is a real open defect in
   the retrim's topology, unrelated to the two fixed here, and it is unmeasured
   beyond the count.
3. **The multi-shell assembly mirrors the input rather than classifying it.** A body
   with a genuine internal void still declines at the sew. That is a deliberate
   deferral, not coverage: the void assembles with the opposite sign and guessing it
   is exactly the kind of unmeasured inference this document exists to remove.

## 6. Artefacts

| what | where |
|---|---|
| census probe | `forge-kernel/test/fillet_defer_census.cpp` |
| census build (runs the 4 controls, refuses a red binary) | `forge-kernel/test/build_fillet_defer_census.sh` |
| census driver (per-part process, HEAD-moved gate) | `forge-kernel/test/run_fillet_defer_census.sh` |
| census rows, BEFORE the fix | `reports/corpus_ab/fillet_census_before_600.jsonl.gz` (+ `_manifest.json`) |
| census rows, AFTER the fix | `reports/corpus_ab/fillet_census_after_600.jsonl.gz` |
| A/B rows, AFTER the fix | `reports/corpus_ab/fillet_after_600_results.jsonl.gz` |
| A/B summary + provenance, AFTER | `reports/corpus_ab/fillet_after_600_summary.md`, `_manifest.json` |

Re-run:

**On the BEFORE artefact.** It was produced by this same probe at an earlier revision
of itself, before the `same_face` / `closed_edge` / `nshells` / `nsolids` /
`native_noop` columns and the SEAM control were added; those five columns are absent
from its rows. It could not be regenerated with the current probe, because the SEAM
control is red by construction on the pre-fix engine and the build refuses to emit a
binary when a control is red — which is the point of the control. Its own manifest
pins it to `5adc26a0` with `src/` and `include/` clean, and its bucket verdicts
reproduce the committed A/B FILLET row on 600/600 parts.

```sh
cd forge-kernel
test/build_fillet_defer_census.sh                  # controls first
JOBS=8 test/run_fillet_defer_census.sh all         # the 600-part attribution
JOBS=8 FAMILIES=FILLET test/run_corpus_ab_coverage.sh all   # the coverage row
```
