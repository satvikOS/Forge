# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 6600   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 402 | 1 | **59** | 138 | 67.2% | 76.8% | -9.7% [-12.1, -7.3] | 1.1e-16 | FAIL |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 594 | 6 | **0** | 0 | 100.0% | 99.0% | 1.0% [0.2, 1.8] | 0.0313 | PASS |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 0 | 0 | **131** | 469 | 0.0% | 21.8% | -21.8% [-25.1, -18.5] | 7.3e-40 | FAIL |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 24 | **38** | 538 | 4.0% | 6.3% | -2.3% [-4.9, 0.2] | 0.0980 | FAIL |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 498 | 0 | **69** | 33 | 83.0% | 94.5% | -11.5% [-14.1, -8.9] | 3.4e-21 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 599 | 0 | **1** | 0 | 99.8% | 100.0% | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 599 | 0 | **1** | 0 | 99.8% | 100.0% | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | PASS (0 discordant pairs) |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 577 | 0 | **23** | 0 | 96.2% | 100.0% | -3.8% [-5.4, -2.3] | 2.4e-7 | FAIL |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0 | 0 | **497** | 68 | 0.0% | 88.0% | -88.0% [-90.6, -85.3] | 4.9e-150 | FAIL |
| PIPESHELL_RC | `?` | 600 | 597 | 2 | **1** | 0 | 99.8% | 99.7% | 0.2% [-0.4, 0.7] | 1.0000 | PASS (CI straddles 0) |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

## Per-family detail

### FILLET — `FORGE_FILLET_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:197 OK:403
- OCCT arm statuses:   THREW:116 OK:461 DEFER:23
- BRepCheck_Analyzer valid results: native 312, OCCT 455
- inside `both`: 253 agree on the full observable vector, 253 agree up to solid orientation (|volume|), 149 disagree
- parts in the deletion bucket (first 12): ho1005, ho1034, ho1043, ho1051, ho1058, ho1080, ho1087, ho1094, ho1119, ho1134, ho1149, ho1157

### MAKEOFFSET — `FORGE_OFFSET_DROP_MAKEOFFSET`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:594 TIMEOUT:6
- BRepCheck_Analyzer valid results: native 600, OCCT 594
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 285 disagree

### THICKSOLID — `FORGE_THICKSOLID_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:600
- OCCT arm statuses:   DEFER:467 OK:131 CRASH:2
- BRepCheck_Analyzer valid results: native 0, OCCT 0
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1008, ho1017, ho102, ho1024, ho1030, ho1041, ho107, ho1082, ho1089, ho1097, ho1104

### OFFSETSHAPE — `FORGE_OFFSETSHAPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:576 OK:24
- OCCT arm statuses:   DEFER:490 OK:38 CRASH:66 THREW:6
- BRepCheck_Analyzer valid results: native 24, OCCT 5
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1055, ho1097, ho111, ho1129, ho1155, ho1160, ho119, ho1342, ho137, ho14, ho156

### THRUSECTIONS — `FORGE_THRUSECTIONS_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:498 DEFER:102
- OCCT arm statuses:   OK:567 DEFER:33
- BRepCheck_Analyzer valid results: native 498, OCCT 567
- inside `both`: 498 agree on the full observable vector, 498 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho1005, ho1011, ho1014, ho1032, ho104, ho1043, ho1080, ho1092, ho1094, ho1134, ho1149, ho1155

### PIPE — `FORGE_PIPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:599 DEFER:1
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 599, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 599 disagree
- parts in the deletion bucket (first 1): ho1190

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:599 DEFER:1
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 599, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 599 disagree
- parts in the deletion bucket (first 1): ho1190

### FILLING — `FORGE_FILLING_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:407 THREW:154 DEFER:39
- BRepCheck_Analyzer valid results: native 407, OCCT 407
- inside `both`: 407 agree on the full observable vector, 407 agree up to solid orientation (|volume|), 0 disagree

### THICKEN — `FORGE_THICKEN_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:577 DEFER:23
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 577, OCCT 600
- inside `both`: 0 agree on the full observable vector, 572 agree up to solid orientation (|volume|), 577 disagree
- parts in the deletion bucket (first 12): ho1005, ho1034, ho1087, ho1119, ho1200, ho1234, ho1250, ho1278, ho1298, ho1327, ho1359, ho602

### DRAFT — `FORGE_DRAFT_DROP_NATIVE`
- applicable 565, not applicable 35 (no_planar_side_wall:35)
- native arm statuses: DEFER:565
- OCCT arm statuses:   THREW:66 OK:497 DEFER:2
- BRepCheck_Analyzer valid results: native 0, OCCT 445
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019, ho102

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:599 DEFER:1
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 599, OCCT 567
- inside `both`: 325 agree on the full observable vector, 325 agree up to solid orientation (|volume|), 272 disagree
- parts in the deletion bucket (first 1): ho1190
