# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 600   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 594 | 6 | **0** | 0 | 100.0% | 99.0% | 324/594 (54.5%) | 1.0% [0.2, 1.8] | 0.0313 | PASS |

**OCCT only** is the capability the drop deletes: OCCT built a result the call site
would have accepted and the native engine declined, on the same input. Under the drop
option that decline becomes a thrown error at every one of those call sites.

**agree** is how many of the `both` pairs match on the full observable vector
(volume, bbox, face/edge/vertex/shell/solid counts, centre of mass). THE VERDICT DOES
NOT READ IT. A family can be one part from a green coverage gate and still return
different geometry on every part it builds — measured for E and F, which agree on 0 of
599 while reading 99.8% vs 100.0%. A LOW agree COLUMN NEXT TO A NEAR-PASS VERDICT MEANS
THE TWO ARMS ARE COMPUTING DIFFERENT OPERATIONS, and the coverage number is not a
statement about how close the drop is.

## Per-family detail

### MAKEOFFSET — `FORGE_OFFSET_DROP_MAKEOFFSET`
- applicable 600, not applicable 0 (none)
- native arm statuses: OK:600
- OCCT arm statuses:   OK:594 TIMEOUT:5 DEFER:1
- BRepCheck_Analyzer valid results: native 600, OCCT 594
- inside `both`: 324 agree on the full observable vector, 324 agree up to solid orientation (|volume|), 270 disagree
