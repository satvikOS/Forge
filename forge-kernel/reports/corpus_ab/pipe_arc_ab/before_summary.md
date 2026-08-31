# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 2400   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 309 | 0 | **258** | 33 | 51.5% | 94.5% | -43.0% [-47.0, -39.0] | 4.3e-78 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 249 | 0 | **351** | 0 | 41.5% | 100.0% | -58.5% [-62.4, -54.6] | 4.4e-106 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 309 | 0 | **291** | 0 | 51.5% | 100.0% | -48.5% [-52.5, -44.5] | 5.0e-88 | FAIL |
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

### PIPE — `FORGE_PIPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:351 OK:249
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 249, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 249 disagree
- parts in the deletion bucket (first 12): ho0, ho10, ho1005, ho1008, ho1011, ho1014, ho102, ho1020, ho1024, ho1030, ho1032, ho1034

### PIPESHELL — `FORGE_PIPESHELL_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:600
- BRepCheck_Analyzer valid results: native 309, OCCT 600
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 309 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1040

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:309 DEFER:291
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 309, OCCT 567
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1005, ho1008, ho1011, ho1014, ho1020, ho1024, ho1030, ho1032, ho1034, ho104, ho1040
