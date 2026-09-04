# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 7796   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | coverage term | **verdict** |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 402 | 1 | **59** | 138 | 67.2% | 76.8% | 253/402 (62.9%) | -9.7% [-12.1, -7.3] | 1.1e-16 | FAIL | FAIL (coverage, validity, agreement, replaceability) |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 594 | 6 | **0** | 0 | 100.0% | 99.0% | 309/594 (52.0%) | 1.0% [0.2, 1.8] | 0.0313 | PASS | FAIL (agreement, replaceability) |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 0 | 0 | **132** | 468 | 0.0% | 22.0% | - | -22.0% [-25.3, -18.7] | 3.7e-40 | FAIL | FAIL (coverage) [VACUOUS: neither arm produced a valid shape] |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 24 | **38** | 538 | 4.0% | 6.3% | - | -2.3% [-4.9, 0.2] | 0.0980 | FAIL | FAIL (coverage, replaceability) |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 498 | 0 | **69** | 33 | 83.0% | 94.5% | 498/498 (100.0%) | -11.5% [-14.1, -8.9] | 3.4e-21 | FAIL | FAIL (coverage, validity, agreement, replaceability) |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 600 | 0 | **0** | 0 | 100.0% | 100.0% | 0/600 (0.0%) | 0.0% [0.0, 0.0] | 1.0000 | PASS | FAIL (agreement, replaceability) [0 discordant pairs] |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 600 | 0 | **0** | 0 | 100.0% | 100.0% | 0/600 (0.0%) | 0.0% [0.0, 0.0] | 1.0000 | PASS | FAIL (agreement, replaceability) [0 discordant pairs] |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 407/407 (100.0%) | 0.0% [0.0, 0.0] | 1.0000 | PASS | FAIL (agreement, replaceability) [0 discordant pairs] |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 600 | 0 | **0** | 0 | 100.0% | 100.0% | 0/600 (0.0%) | 0.0% [0.0, 0.0] | 1.0000 | PASS | FAIL (agreement, replaceability) [0 discordant pairs] |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0 | 0 | **497** | 68 | 0.0% | 88.0% | - | -88.0% [-90.6, -85.3] | 4.9e-150 | FAIL | FAIL (coverage, validity, replaceability) |
| PIPESHELL_RC | `?` | 600 | 598 | 2 | **0** | 0 | 100.0% | 99.7% | 325/598 (54.3%) | 0.3% [-0.1, 0.8] | 0.5000 | PASS | FAIL (agreement, replaceability) [coverage CI straddles 0] |
| PIPESHELL_XOR | `?` | 598 | 14 | 6 | **572** | 6 | 3.3% | 98.0% | 0/14 (0.0%) | -94.6% [-96.8, -92.5] | 1.0e-160 | FAIL | FAIL (coverage, validity, agreement, replaceability) |
| PIPESHELL_XOR_POS | `?` | 598 | 0 | 0 | **0** | 598 | 0.0% | 0.0% | - | 0.0% [0.0, 0.0] | 1.0000 | PASS | PASS [VACUOUS: neither arm produced a valid shape] [0 discordant pairs] |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

**agree** is how many of the `both` pairs match on the full observable vector
(volume, area, centre of mass, all six bbox bounds, face/edge/vertex/shell/solid
counts, and faces + edges binned by surface / curve kind). **THE VERDICT NOW READS IT.**
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
| MAKEOFFSET | 594 | 0 | **594** | 600 | 600 | 309 | **285** | 0 | 0 | 285 | 0/0 | 48.0% (<= 51.4%) |
| THICKSOLID | 132 | 132 | **0** | 0 | 0 | 0 | **0** | 0 | 0 | 0 | 0/0 | 0.0% (<= 100.0%) |
| OFFSETSHAPE | 38 | 33 | **5** | 24 | 24 | 0 | **5** | 5 | 0 | 0 | 0/0 | 100.0% (<= 100.0%) |
| THRUSECTIONS | 567 | 0 | **567** | 498 | 498 | 0 | **567** | 69 | 0 | 498 | 0/0 | 100.0% (<= 100.0%) |
| PIPE | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 0/0 | 100.0% (<= 100.0%) |
| PIPESHELL | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 0/0 | 100.0% (<= 100.0%) |
| FILLING | 407 | 0 | **407** | 407 | 407 | 0 | **407** | 0 | 0 | 407 | 0/0 | 100.0% (<= 100.0%) |
| THICKEN | 600 | 0 | **600** | 600 | 600 | 0 | **600** | 0 | 0 | 600 | 0/0 | 100.0% (<= 100.0%) |
| DRAFT | 497 | 52 | **445** | 0 | 0 | 0 | **445** | 445 | 0 | 0 | 0/0 | 100.0% (<= 100.0%) |
| PIPESHELL_RC | 598 | 31 | **567** | 600 | 600 | 309 | **258** | 0 | 0 | 258 | 0/0 | 45.5% (<= 49.0%) |
| PIPESHELL_XOR | 586 | 2 | **584** | 20 | 3 | 0 | **584** | 571 | 10 | 3 | 0/0 | 100.0% (<= 100.0%) |
| PIPESHELL_XOR_POS | 0 | 0 | **0** | 0 | 0 | 0 | **0** | 0 | 0 | 0 | 0/0 | 0.0% (<= 100.0%) |

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
- inside `both`: 253 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 253 on the STRICT vector the verdict reads (+ surface/curve kinds), 253 agree up to solid orientation (|volume|), 149 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (403 >= 461), validity FAIL (312 >= 455), agreement FAIL (58 valid pair(s) disagree), replaceability FAIL (deficit 202 of a valid bar of 455), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho1011, ho102, ho1024, ho1030, ho1032, ho1034, ho104, ho1043, ho1046, ho1051, ho1055, ho1058
- parts where both arms are VALID and the shapes DIFFER (first 12): ho1011, ho1032, ho104, ho1055, ho1092, ho1099, ho1124, ho1131, ho1139, ho1197, ho1219, ho1255
- parts in the deletion bucket (first 12): ho1005, ho1034, ho1043, ho1051, ho1058, ho1080, ho1087, ho1094, ho1119, ho1134, ho1149, ho1157

### MAKEOFFSET — `FORGE_OFFSET_DROP_MAKEOFFSET`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:594 TIMEOUT:5 DEFER:1
- BRepCheck_Analyzer valid results: native 600, OCCT 594
- of the answers each arm RETURNED: native 600 ok (600 valid, 0 invalid, 0 unknown), OCCT 594 ok (594 valid, 0 invalid, 0 unknown)
- inside `both`: 309 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 309 on the STRICT vector the verdict reads (+ surface/curve kinds), 309 agree up to solid orientation (|volume|), 285 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 44
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (600 >= 594), validity PASS (600 >= 594), agreement FAIL (285 valid pair(s) disagree), replaceability FAIL (deficit 285 of a valid bar of 594), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1041
- parts where both arms are VALID and the shapes DIFFER (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1041

### THICKSOLID — `FORGE_THICKSOLID_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:600
- OCCT arm statuses:   DEFER:467 OK:132 CRASH:1
- BRepCheck_Analyzer valid results: native 0, OCCT 0
- of the answers each arm RETURNED: native 0 ok (0 valid, 0 invalid, 0 unknown), OCCT 132 ok (0 valid, 132 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 0 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (0 >= 132), validity PASS (0 >= 0), agreement PASS (0 valid pair(s) disagree), replaceability PASS (deficit 0 of a valid bar of 0), sanity PASS (0 native COM fingerprint(s))
- parts in the deletion bucket (first 12): ho10, ho1008, ho1017, ho102, ho1024, ho1030, ho1041, ho107, ho1082, ho1089, ho1097, ho1104

### OFFSETSHAPE — `FORGE_OFFSETSHAPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:576 OK:24
- OCCT arm statuses:   DEFER:490 OK:38 CRASH:66 THREW:6
- BRepCheck_Analyzer valid results: native 24, OCCT 5
- of the answers each arm RETURNED: native 24 ok (24 valid, 0 invalid, 0 unknown), OCCT 38 ok (5 valid, 33 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 0 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 34
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (24 >= 38), validity PASS (24 >= 5), agreement PASS (0 valid pair(s) disagree), replaceability FAIL (deficit 5 of a valid bar of 5), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 5): ho10, ho1129, ho137, ho160, ho627
- parts in the deletion bucket (first 12): ho10, ho1055, ho1097, ho111, ho1129, ho1155, ho1160, ho119, ho1342, ho137, ho14, ho156

### THRUSECTIONS — `FORGE_THRUSECTIONS_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:498 DEFER:102
- OCCT arm statuses:   OK:567 DEFER:33
- BRepCheck_Analyzer valid results: native 498, OCCT 567
- of the answers each arm RETURNED: native 498 ok (498 valid, 0 invalid, 0 unknown), OCCT 567 ok (567 valid, 0 invalid, 0 unknown)
- inside `both`: 498 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 498 agree up to solid orientation (|volume|), 0 disagree on the loose vector
  - **498 pair(s) match on every scalar AND every count and are different B-Rep** — caught only by the kind histograms.
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 33, OCCT 53
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (498 >= 567), validity FAIL (498 >= 567), agreement FAIL (498 valid pair(s) disagree), replaceability FAIL (deficit 567 of a valid bar of 567), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019
- parts where both arms are VALID and the shapes DIFFER (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1008, ho1010, ho1017, ho1019, ho102, ho1020, ho1024
- parts in the deletion bucket (first 12): ho1005, ho1011, ho1014, ho1032, ho104, ho1043, ho1080, ho1092, ho1094, ho1134, ho1149, ho1155

### PIPE — `FORGE_PIPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 600, OCCT 600
- of the answers each arm RETURNED: native 600 ok (600 valid, 0 invalid, 0 unknown), OCCT 600 ok (600 valid, 0 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 600 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 6, OCCT 9
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (600 >= 600), validity PASS (600 >= 600), agreement FAIL (600 valid pair(s) disagree), replaceability FAIL (deficit 600 of a valid bar of 600), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019
- parts where both arms are VALID and the shapes DIFFER (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 600, OCCT 600
- of the answers each arm RETURNED: native 600 ok (600 valid, 0 invalid, 0 unknown), OCCT 600 ok (600 valid, 0 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 600 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 9, OCCT 44
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (600 >= 600), validity PASS (600 >= 600), agreement FAIL (600 valid pair(s) disagree), replaceability FAIL (deficit 600 of a valid bar of 600), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019
- parts where both arms are VALID and the shapes DIFFER (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### FILLING — `FORGE_FILLING_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:407 THREW:154 DEFER:39
- BRepCheck_Analyzer valid results: native 407, OCCT 407
- of the answers each arm RETURNED: native 407 ok (407 valid, 0 invalid, 0 unknown), OCCT 407 ok (407 valid, 0 invalid, 0 unknown)
- inside `both`: 407 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 407 agree up to solid orientation (|volume|), 0 disagree on the loose vector
  - **407 pair(s) match on every scalar AND every count and are different B-Rep** — caught only by the kind histograms.
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 1, OCCT 1
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (407 >= 407), validity PASS (407 >= 407), agreement FAIL (407 valid pair(s) disagree), replaceability FAIL (deficit 407 of a valid bar of 407), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1010, ho1011, ho1014, ho1017, ho102, ho1020, ho1024, ho103
- parts where both arms are VALID and the shapes DIFFER (first 12): ho0, ho1, ho10, ho1001, ho1010, ho1011, ho1014, ho1017, ho102, ho1020, ho1024, ho103

### THICKEN — `FORGE_THICKEN_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 600, OCCT 600
- of the answers each arm RETURNED: native 600 ok (600 valid, 0 invalid, 0 unknown), OCCT 600 ok (600 valid, 0 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 595 agree up to solid orientation (|volume|), 600 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 171, OCCT 167
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (600 >= 600), validity PASS (600 >= 600), agreement FAIL (600 valid pair(s) disagree), replaceability FAIL (deficit 600 of a valid bar of 600), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019
- parts where both arms are VALID and the shapes DIFFER (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### DRAFT — `FORGE_DRAFT_DROP_NATIVE`
- applicable 565, not applicable 35 (no_planar_side_wall:35)
- native arm statuses: DEFER:565
- OCCT arm statuses:   THREW:66 OK:497 DEFER:2
- BRepCheck_Analyzer valid results: native 0, OCCT 445
- of the answers each arm RETURNED: native 0 ok (0 valid, 0 invalid, 0 unknown), OCCT 497 ok (445 valid, 52 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 0 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (0 >= 497), validity FAIL (0 >= 445), agreement PASS (0 valid pair(s) disagree), replaceability FAIL (deficit 445 of a valid bar of 445), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019, ho102
- parts in the deletion bucket (first 12): ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019, ho102

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 600, OCCT 567
- of the answers each arm RETURNED: native 600 ok (600 valid, 0 invalid, 0 unknown), OCCT 598 ok (567 valid, 31 invalid, 0 unknown)
- inside `both`: 325 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 309 on the STRICT vector the verdict reads (+ surface/curve kinds), 325 agree up to solid orientation (|volume|), 273 disagree on the loose vector
  - **16 pair(s) match on every scalar AND every count and are different B-Rep** — caught only by the kind histograms.
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 9, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (600 >= 598), validity PASS (600 >= 567), agreement FAIL (258 valid pair(s) disagree), replaceability FAIL (deficit 258 of a valid bar of 567), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1041
- parts where both arms are VALID and the shapes DIFFER (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1041

### PIPESHELL_XOR — `?`
- applicable 598, not applicable 0 (none)
- native arm statuses: EMPTY:577 OK:20 TIMEOUT:1
- OCCT arm statuses:   OK:586 DEFER:1 EMPTY:11
- BRepCheck_Analyzer valid results: native 580, OCCT 595
- of the answers each arm RETURNED: native 20 ok (3 valid, 17 invalid, 0 unknown), OCCT 586 ok (584 valid, 2 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 14 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 6, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage FAIL (20 >= 586), validity FAIL (3 >= 584), agreement FAIL (3 valid pair(s) disagree), replaceability FAIL (deficit 584 of a valid bar of 584), sanity PASS (0 native COM fingerprint(s))
- parts in the VALID deficit (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019
- parts where both arms are VALID and the shapes DIFFER (first 3): ho109, ho670, ho69
- parts in the deletion bucket (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### PIPESHELL_XOR_POS — `?`
- applicable 598, not applicable 0 (none)
- native arm statuses: EMPTY:598
- OCCT arm statuses:   NOTRUN:598
- BRepCheck_Analyzer valid results: native 598, OCCT 0
- of the answers each arm RETURNED: native 0 ok (0 valid, 0 invalid, 0 unknown), OCCT 0 ok (0 valid, 0 invalid, 0 unknown)
- inside `both`: 0 agree on the LOOSE vector (volume, area, com, bbox, f/e/v/shell/solid counts), 0 on the STRICT vector the verdict reads (+ surface/curve kinds), 0 agree up to solid orientation (|volume|), 0 disagree on the loose vector
- centre-of-mass wrong-code-path fingerprint (COM more than 1000x the shape's own diagonal outside its own bbox): native 0, OCCT 0
- (reporting only, NOT a defect count) COM outside the VERTEX-derived bbox at all, which a curved face legitimately does: native 0, OCCT 0
- agreement observables: volume, area, com, bbox(6), f/e/v/shell/solid counts, faces+edges by surface/curve kind
- **terms**: coverage PASS (0 >= 0), validity PASS (0 >= 0), agreement PASS (0 valid pair(s) disagree), replaceability PASS (deficit 0 of a valid bar of 0), sanity PASS (0 native COM fingerprint(s))
