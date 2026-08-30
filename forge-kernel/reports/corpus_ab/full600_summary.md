# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 6000   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 146 | 51 | **315** | 88 | 32.8% | 76.8% | -44.0% [-49.2, -38.8] | 1.4e-47 | FAIL |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 567 | 0 | **27** | 6 | 94.5% | 99.0% | -4.5% [-6.2, -2.8] | 1.5e-8 | FAIL |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% | -21.0% [-24.3, -17.7] | 2.4e-38 | FAIL |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | -5.2% [-7.3, -3.0] | 3.1e-6 | FAIL |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 0 | 0 | **567** | 33 | 0.0% | 94.5% | -94.5% [-96.3, -92.7] | 4.1e-171 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 2 | 0 | **598** | 0 | 0.3% | 100.0% | -99.7% [-100.1, -99.2] | 1.9e-180 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 309 | 0 | **291** | 0 | 51.5% | 100.0% | -48.5% [-52.5, -44.5] | 5.0e-88 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | PASS (CI straddles 0) |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 407 | 0 | **193** | 0 | 67.8% | 100.0% | -32.2% [-35.9, -28.4] | 1.6e-58 | FAIL |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0 | 0 | **497** | 68 | 0.0% | 88.0% | -88.0% [-90.6, -85.3] | 4.9e-150 | FAIL |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

## Per-family detail

### FILLET — `FORGE_FILLET_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:403 OK:197
- OCCT arm statuses:   THREW:116 OK:461 DEFER:23
- BRepCheck_Analyzer valid results: native 137, OCCT 455
- inside `both`: 86 agree on the full observable vector, 86 agree up to solid orientation (|volume|), 60 disagree
- parts in the deletion bucket (first 12): ho1, ho1002, ho1005, ho1010, ho1011, ho1019, ho1025, ho103, ho1031, ho1032, ho1034, ho1039

### MAKEOFFSET — `FORGE_OFFSET_DROP_MAKEOFFSET`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:567 DEFER:33
- OCCT arm statuses:   OK:594 TIMEOUT:6
- BRepCheck_Analyzer valid results: native 567, OCCT 594
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 258 disagree
- parts in the deletion bucket (first 12): ho1084, ho109, ho1154, ho116, ho1190, ho126, ho1292, ho13, ho1309, ho133, ho306, ho448

### THICKSOLID — `FORGE_THICKSOLID_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:593 OK:7
- OCCT arm statuses:   DEFER:467 OK:133
- BRepCheck_Analyzer valid results: native 0, OCCT 0
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 7 disagree
- parts in the deletion bucket (first 12): ho10, ho1008, ho1017, ho102, ho1024, ho1030, ho107, ho1082, ho1089, ho1097, ho1104, ho111

### OFFSETSHAPE — `FORGE_OFFSETSHAPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:593 OK:7
- OCCT arm statuses:   DEFER:490 OK:38 CRASH:66 THREW:6
- BRepCheck_Analyzer valid results: native 7, OCCT 5
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1055, ho1097, ho111, ho1129, ho1155, ho1160, ho119, ho1342, ho137, ho14, ho156

### THRUSECTIONS — `FORGE_THRUSECTIONS_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:600
- OCCT arm statuses:   OK:567 DEFER:33
- BRepCheck_Analyzer valid results: native 0, OCCT 567
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### PIPE — `FORGE_PIPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:598 OK:2
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 2, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 2 disagree
- parts in the deletion bucket (first 12): ho0, ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 309, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 309 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1040

### FILLING — `FORGE_FILLING_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:407 THREW:154 DEFER:39
- BRepCheck_Analyzer valid results: native 407, OCCT 407
- inside `both`: 407 agree on the full observable vector, 407 agree up to solid orientation (|volume|), 0 disagree

### THICKEN — `FORGE_THICKEN_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 407, OCCT 600
- inside `both`: 0 agree on the full observable vector, 407 agree up to solid orientation (|volume|), 407 disagree
- parts in the deletion bucket (first 12): ho1002, ho1005, ho1008, ho1019, ho1025, ho1030, ho1034, ho1039, ho1041, ho1060, ho1067, ho108

### DRAFT — `FORGE_DRAFT_DROP_NATIVE`
- applicable 565, not applicable 35 (no_planar_side_wall:35)
- native arm statuses: DEFER:565
- OCCT arm statuses:   THREW:66 OK:497 DEFER:2
- BRepCheck_Analyzer valid results: native 0, OCCT 445
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho1, ho10, ho1001, ho1002, ho1005, ho1008, ho1010, ho1011, ho1014, ho1017, ho1019, ho102
