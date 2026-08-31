# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 2400   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 309 | 0 | **258** | 33 | 51.5% | 94.5% | -43.0% [-47.0, -39.0] | 4.3e-78 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 599 | 0 | **1** | 0 | 99.8% | 100.0% | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | PASS (0 discordant pairs) |
| PIPESHELL_RC | `?` | 600 | 597 | 2 | **1** | 0 | 99.8% | 99.7% | 0.2% [-0.4, 0.7] | 1.0000 | PASS (CI straddles 0) |

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

### PIPESHELL_RC — `?`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:599 DEFER:1
- OCCT arm statuses:   OK:598 THREW:2
- BRepCheck_Analyzer valid results: native 599, OCCT 567
- inside `both`: 324 agree on the full observable vector, 324 agree up to solid orientation (|volume|), 273 disagree
- parts in the deletion bucket (first 1): ho1190
