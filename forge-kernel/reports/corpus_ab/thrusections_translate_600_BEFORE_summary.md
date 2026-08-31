# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 2400   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 309 | 0 | **258** | 33 | 51.5% | 94.5% | -43.0% [-47.0, -39.0] | 4.3e-78 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 309 | 0 | **291** | 0 | 51.5% | 100.0% | -48.5% [-52.5, -44.5] | 5.0e-88 | FAIL |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 407 | 0 | **193** | 0 | 67.8% | 100.0% | -32.2% [-35.9, -28.4] | 1.6e-58 | FAIL |
| PIPESHELL_RC | `?` | 600 | 309 | 0 | **289** | 2 | 51.5% | 99.7% | -48.2% [-52.2, -44.2] | 2.0e-87 | FAIL |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

## Per-family detail

### THRUSECTIONS — `FORGE_THRUSECTIONS_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:567 DEFER:33
- BRepCheck_Analyzer valid results: native 309, OCCT 567
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1032, ho104, ho1040, ho1041, ho1043

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 309, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 309 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1040

### THICKEN — `FORGE_THICKEN_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 407, OCCT 600
- inside `both`: 0 agree on the full observable vector, 407 agree up to solid orientation (|volume|), 407 disagree
- parts in the deletion bucket (first 12): ho1002, ho1005, ho1008, ho1019, ho1025, ho1030, ho1034, ho1039, ho1041, ho1060, ho1067, ho108

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 309, OCCT 567
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1040
