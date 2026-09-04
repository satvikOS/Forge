# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 1200   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | **strict** | **equiv** | delta (95% CI) | McNemar p | coverage term | **verdict** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 402 | 1 | **59** | 138 | 67.2% | 76.8% | 253/402 (62.9%) | 253/402 | 253/402 | -9.7% [-12.1, -7.3] | 1.1e-16 | FAIL | FAIL (coverage, validity, agreement, replaceability) |
| CHAMFER | `FORGE_FILLET_DROP_NATIVE` | 600 | 328 | 16 | **104** | 152 | 57.3% | 72.0% | 253/328 (77.1%) | 253/328 | 253/328 | -14.7% [-18.0, -11.3] | 5.5e-17 | FAIL | FAIL (coverage, validity, replaceability) |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

**agree / strict / equiv** are the same pairs scored on three nested vectors.
`agree` = volume, area, centre of mass, all six bbox bounds and the five topology
counts. `strict` = that, plus faces and edges binned by surface / curve KIND — i.e.
bit-identical B-Rep representation. `equiv` = `strict`, with an exact Plane allowed
to stand for a surface PROVED, by sampling its own geometry, to be that same plane
to the same 1e-6-relative tolerance every other term uses. `(+n)` is how many pairs
the plane rule alone rescued. **THE VERDICT READS `equiv`**, and
`strict` stays on the row so the relaxation is always visible beside it.
The chain `strict => equiv => agree` is checked on every row and any violation is
bannered above as a harness defect. **THE VERDICT NOW READS AGREEMENT AT ALL.**
It did not use to: a family could be one part from a green coverage gate and still
return different geometry on every part it built — measured for E and F, which agree
on 0 of 599 while reading 99.8% vs 100.0%. A LOW agree COLUMN MEANS THE TWO ARMS ARE
COMPUTING DIFFERENT OPERATIONS, and a coverage number over two different operations is
not a statement about how close the drop is.

**coverage term** is the verdict this gate used to print, and nothing else: `natOk >=
occtOk`. It is retained verbatim as term 1 of the conjunction, so **verdict** is a
strict subset of it — a family can never pass here that would not have passed before.

## Replaceability — can the native arm actually stand in for OCCT?

The coverage bar counts every OCCT answer, INCLUDING the ones that fail `BRepCheck`.
That is deliberate and it is not lowered here: term 1 still measures against it. What
this table adds is the bar a caller could actually rely on — OCCT answers that are
VALID — and the deficit against it, decomposed by why each part is not reproduced.
An OCCT answer that fails BRepCheck is shown as invalid rather than deleted, so the
difference between the two bars is visible instead of assumed.

| family | OCCT ok | of which INVALID | **valid bar** | native ok | native ok+valid | replaced | **deficit** | native absent | native invalid | disagree | COM fingerprint nat/occt | deficit rate (95% upper) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| FILLET | 461 | 6 | **455** | 403 | 312 | 253 | **202** | 53 | 91 | 58 | 0/0 | 44.4% (<= 48.4%) |
| CHAMFER | 432 | 8 | **424** | 344 | 253 | 253 | **171** | 96 | 75 | 0 | 0/0 | 40.3% (<= 44.4%) |

**deficit** = valid bar - replaced. `replaced` requires all three of: the native arm
returned a shape, that shape passes BRepCheck, and it AGREES with OCCT on the full
observable vector. A deficit of 0 over a small bar is not the same statement as a
deficit of 0 over a large one, so every rate carries an exact one-sided 95% upper
bound: 0 of 7 is consistent with a true deficit rate of 35%.

**COM fingerprint** counts answers whose centre of mass lies more than 1000x the
shape's own diagonal outside its own bounding box — the wrong-code-path signature
this repo has hit twice (COM 1e34 and 2e33 with the volume clean or exact). It is
term 5, and it constrains the NATIVE arm only; the OCCT count is reported beside it
and does not shrink the bar. The threshold is 1000x and not "outside the bbox"
because `bb` is VERTEX-derived, and a full cylinder's vertices lie on its seam, so
its vertex bbox is a LINE and its centroid is legitimately outside it. The tight
count is in the per-family detail, labelled as reporting only.

## Per-family detail

### FILLET — `FORGE_FILLET_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:197 OK:403
- OCCT arm statuses:   THREW:116 OK:461 DEFER:23
- BRepCheck_Analyzer valid results: native 312, OCCT 455
- of the answers each arm RETURNED: native 403 ok (312 valid, 91 invalid, 0 unknown), OCCT 461 ok (455 valid, 6 invalid, 0 unknown)
- inside `both`: 253 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 253 on the STRICT vector (+ surface/curve kinds, bit-identical representation), 253 on the EQUIVALENCE vector the verdict reads (strict, with an exact Plane allowed to stand for a surface PROVED to be that same plane), 253 agree up to solid orientation (|volume|), 149 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, edges by curve kind, faces by surface kind WITH proved-plane equivalence
- **terms**: coverage FAIL (403 >= 461), validity FAIL (312 >= 455), agreement FAIL (58 valid pair(s) disagree), replaceability FAIL (deficit 202 of a valid bar of 455), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho1011, ho102, ho1024, ho1030, ho1032, ho1034, ho104, ho1043, ho1046, ho1051, ho1055, ho1058
- parts where both arms are VALID and the shapes DIFFER (first 12): ho1011, ho1032, ho104, ho1055, ho1092, ho1099, ho1124, ho1131, ho1139, ho1197, ho1219, ho1255
- parts in the deletion bucket (first 12): ho1005, ho1034, ho1043, ho1051, ho1058, ho1080, ho1087, ho1094, ho1119, ho1134, ho1149, ho1157

### CHAMFER — `FORGE_FILLET_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:256 OK:344
- OCCT arm statuses:   THREW:116 OK:432 DEFER:52
- BRepCheck_Analyzer valid results: native 253, OCCT 424
- of the answers each arm RETURNED: native 344 ok (253 valid, 91 invalid, 0 unknown), OCCT 432 ok (424 valid, 8 invalid, 0 unknown)
- inside `both`: 253 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 253 on the STRICT vector (+ surface/curve kinds, bit-identical representation), 253 on the EQUIVALENCE vector the verdict reads (strict, with an exact Plane allowed to stand for a surface PROVED to be that same plane), 253 agree up to solid orientation (|volume|), 75 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, edges by curve kind, faces by surface kind WITH proved-plane equivalence
- **terms**: coverage FAIL (344 >= 432), validity FAIL (253 >= 424), agreement PASS (0 valid pair(s) disagree), replaceability FAIL (deficit 171 of a valid bar of 424), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho1011, ho102, ho1030, ho1032, ho1034, ho104, ho1043, ho1046, ho1055, ho1058, ho1077, ho1080
- parts in the deletion bucket (first 12): ho1011, ho1032, ho1034, ho104, ho1043, ho1055, ho1058, ho1077, ho1080, ho1087, ho1092, ho1094
