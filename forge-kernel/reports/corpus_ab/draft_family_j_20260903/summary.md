# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 600   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 497 | 2 | **0** | 66 | 88.3% | 88.0% | 497/497 (100.0%) | 0.4% [-0.1, 0.8] | 0.5000 | PASS (CI straddles 0) |

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

### DRAFT — `FORGE_DRAFT_DROP_NATIVE`
- applicable 565, not applicable 35 (no_planar_side_wall:35)
- native arm statuses: DEFER:66 OK:499
- OCCT arm statuses:   THREW:66 OK:497 DEFER:2
- BRepCheck_Analyzer valid results: native 447, OCCT 445
- inside `both`: 497 agree on the full observable vector, 497 agree up to solid orientation (|volume|), 0 disagree
