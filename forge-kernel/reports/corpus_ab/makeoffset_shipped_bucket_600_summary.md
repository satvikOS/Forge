# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 1200   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 594 | 6 | **0** | 0 | 100.0% | 99.0% | 1.0% [0.2, 1.8] | 0.0313 | PASS |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | PASS (0 discordant pairs) |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

## Per-family detail

### MAKEOFFSET — `FORGE_OFFSET_DROP_MAKEOFFSET`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:594 TIMEOUT:6
- BRepCheck_Analyzer valid results: native 600, OCCT 594
- inside `both`: 309 agree on the full observable vector, 309 agree up to solid orientation (|volume|), 285 disagree

### FILLING — `FORGE_FILLING_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:407 DEFER:193
- OCCT arm statuses:   OK:407 THREW:154 DEFER:39
- BRepCheck_Analyzer valid results: native 407, OCCT 407
- inside `both`: 407 agree on the full observable vector, 407 agree up to solid orientation (|volume|), 0 disagree
