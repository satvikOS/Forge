# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 1200   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 8 | 0 | **125** | 467 | 1.3% | 22.2% | -20.8% [-24.1, -17.6] | 4.7e-38 | FAIL |
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | -5.2% [-7.3, -3.0] | 3.1e-6 | FAIL |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

## Per-family detail

### THICKSOLID — `FORGE_THICKSOLID_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:592 OK:8
- OCCT arm statuses:   DEFER:467 OK:133
- BRepCheck_Analyzer valid results: native 0, OCCT 0
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 8 disagree
- parts in the deletion bucket (first 12): ho10, ho1008, ho1017, ho102, ho1024, ho1030, ho107, ho1082, ho1089, ho1097, ho1104, ho111

### OFFSETSHAPE — `FORGE_OFFSETSHAPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:593 OK:7
- OCCT arm statuses:   DEFER:490 OK:38 CRASH:66 THREW:6
- BRepCheck_Analyzer valid results: native 7, OCCT 5
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1055, ho1097, ho111, ho1129, ho1155, ho1160, ho119, ho1342, ho137, ho14, ho156
