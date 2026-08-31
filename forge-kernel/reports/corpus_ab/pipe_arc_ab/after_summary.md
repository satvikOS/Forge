# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 2400   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 309 | 0 | **258** | 33 | 51.5% | 94.5% | -43.0% [-47.0, -39.0] | 4.3e-78 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 494 | 0 | **106** | 0 | 82.3% | 100.0% | -17.7% [-20.7, -14.6] | 2.5e-32 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 494 | 0 | **106** | 0 | 82.3% | 100.0% | -17.7% [-20.7, -14.6] | 2.5e-32 | FAIL |
| PIPESHELL_RC | `?` | 600 | 494 | 0 | **104** | 2 | 82.3% | 99.7% | -17.3% [-20.4, -14.3] | 9.9e-32 | FAIL |

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

### PIPE — `FORGE_PIPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:494 DEFER:106
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 494, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 494 disagree
- parts in the deletion bucket (first 12): ho1005, ho1014, ho1034, ho1040, ho1043, ho1051, ho1058, ho1080, ho1084, ho1087, ho109, ho1094

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:494 DEFER:106
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 494, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 494 disagree
- parts in the deletion bucket (first 12): ho1005, ho1014, ho1034, ho1040, ho1043, ho1051, ho1058, ho1080, ho1084, ho1087, ho109, ho1094

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:494 DEFER:106
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 494, OCCT 567
- inside `both`: 310 agree on the full observable vector, 310 agree up to solid orientation (|volume|), 184 disagree
- parts in the deletion bucket (first 12): ho1005, ho1014, ho1034, ho1040, ho1043, ho1051, ho1058, ho1080, ho1087, ho109, ho1094, ho1119
