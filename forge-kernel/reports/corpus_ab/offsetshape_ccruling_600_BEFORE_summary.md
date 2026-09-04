# Corpus A/B coverage — native vs OCCT, per dropped family

parts: 600   rows: 600   part-level errors: 0

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | **agree** | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 24 | **38** | 538 | 4.0% | 6.3% | - | -2.3% [-4.9, 0.2] | 0.0980 | FAIL |

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

### OFFSETSHAPE — `FORGE_OFFSETSHAPE_DROP_NATIVE`
- applicable 600, not applicable 0 (none)
- native arm statuses: DEFER:576 OK:24
- OCCT arm statuses:   DEFER:490 OK:38 CRASH:66 THREW:6
- BRepCheck_Analyzer valid results: native 24, OCCT 5
- inside `both`: 0 agree on the full observable vector, 0 agree up to solid orientation (|volume|), 0 disagree
- parts in the deletion bucket (first 12): ho10, ho1055, ho1097, ho111, ho1129, ho1155, ho1160, ho119, ho1342, ho137, ho14, ho156
