# PIPE (TKOffset family E) defer audit — 2026-08-30

Measured against `origin/claude/sacrosanct-execution-20260828` @ `6a7f3aa3`, on the
same 600-part corpus and with the same `test/run_corpus_ab_coverage.sh` as
`reports/corpus_ab/full600_*`. `FAMILIES=PIPE,PIPESHELL`, 600/600 parts, 0
part-level errors on both runs.

| run | PIPE native | PIPESHELL native (untouched control) |
|---|---:|---:|
| `before_*` | **2 / 600 = 0.3%** | 309 / 600 = 51.5% |
| `after_*`  | **249 / 600 = 41.5%** | 309 / 600 = 51.5% |

`before_*` was measured with the defer-reason instrumentation already applied and
reproduces the committed `full600` baseline exactly (native DEFER 598 / OK 2, and
PIPESHELL OK 309 / DEFER 291). That identity is the proof the instrumentation is
behaviour-neutral. Both manifests record `dirty_files_in_src_include_test` > 0
because both were measured from a working tree carrying this change.

## Why it deferred, ranked (before, n = 598 defers)

| count | share | the FIRST predicate that declined |
|---:|---:|---|
| 581 | 97.2% | `prof_face_multi_wire` — the profile FACE had more than one wire |
| 17 | 2.8% | `prof_edge_not_line` — the outer wire was not a polygon |

The PIPESHELL family is the control that localises this: it is handed the SAME
spine and the SAME outer wire, only as a bare `TopoDS_Wire` instead of a
`TopoDS_Face`, so it never reaches the wire-count test. It built 309. The
cross-tab of the two families:

| count | PIPE reason | PIPESHELL |
|---:|---|---|
| 307 | `prof_face_multi_wire` | OK |
| 274 | `prof_face_multi_wire` | `prof_edge_not_line` |
| 17 | `prof_edge_not_line` | `prof_edge_not_line` |
| 2 | (built) | OK |

## The trap: removing the top bucket bought ZERO

Lifting the multi-wire rejection alone took `prof_face_multi_wire` from 581 to 0
and left the corpus number at **2 / 600, unchanged**. The bucket behind it was
100% co-occurrent. A per-wire curve census of the same 600 profile faces said why:
of **3426 hole wires, 3426 are circles and none is a polygon**.

| count | profile face |
|---:|---|
| 307 | outer POLYGON, every hole a CIRCLE |
| 274 | outer NOT a polygon, holes circles |
| 17 | outer NOT a polygon, no holes |
| 2 | outer POLYGON, no holes |

That census, not the defer label, is what named the fix.

## Why it still defers (after, n = 351 defers)

| count | the FIRST predicate that declined |
|---:|---|
| 307 | a hole wire that is neither a polygon nor ONE full circle — a slot or kidney pocket built from 2–5 distinct circles spanning 1.8–3.6 turns of arc |
| 44 | the outer wire is not a polygon (an arc chain) |

Of those 307, **60** are parts whose OUTER wire is a polygon (PIPESHELL builds
them): they are blocked by one multi-circle pocket and nothing else. The other
247 need a curved outer boundary as well.

Both remaining buckets need the SAME missing capability — an exact arc-swept
lateral face (a cylindrical patch per arc, mitre-trimmed) — so neither is a
bounded fix on top of this one.

## Corroboration of the 249 new successes, on the corpus itself

The harness spine is two equal legs of length L turned 30°. A mitred sweep whose
section centroid sits on the spine encloses `A * 2L`; `BRepOffsetAPI_MakePipe`
translates the section rigidly instead of mitring it, so its second leg
contributes `A * L * cos30`. The predicted ratio is therefore

    native / OCCT = 2 / (1 + cos 30°) = 1.071796769724

and the measured ratio matches it to better than **1e-9 relative on all 249 of
249** parts (worst deviation 7.2e-10). Since the ratio pins both volumes with the
same `A`, that is a corpus-wide confirmation that the native volume equals the
closed form `A * (spine length)` on every part it built — obtained without
computing `A` anywhere. All 249 are `BRepCheck_Analyzer` valid, one shell, one
solid.

It is also a quantitative restatement of what `NativeLoftPipe.cpp`'s banner
already recorded by hand: there the L-spine turned 90°, `cos 90 = 0`, and OCCT
returned exactly the first leg's volume.
