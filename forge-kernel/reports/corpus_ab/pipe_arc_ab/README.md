# The exact arc-swept lateral face — paired corpus A/B

One tree, one harness, one corpus, **only `src/native/brep/NativeLoftPipe.cpp`
differing between the arms**. 600 reference solids
(`archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`),
`test/run_corpus_ab_coverage.sh`, stride 1, 600/600 realised, 0 part-level errors
on both arms.

The arms are PROVED to differ, not assumed to: 61 114 vs 100 422 bytes of source,
and the string `arc_section_folds_at_mitre` occurs **0** times in the BEFORE
binary and **1** in the AFTER binary — the paired script refuses to measure
otherwise.

| family | option | before | after | Δ | regressions |
|---|---|---:|---:|---:|---:|
| **THRUSECTIONS** (control) | `FORGE_THRUSECTIONS_DROP_NATIVE` | 309 / 600 = 51.5% | 309 / 600 = 51.5% | **0** | 0 |
| **PIPE** | `FORGE_PIPE_DROP_NATIVE` | 249 / 600 = 41.5% | **494 / 600 = 82.3%** | **+245** | 0 |
| **PIPESHELL** | `FORGE_PIPESHELL_DROP_NATIVE` | 309 / 600 = 51.5% | **494 / 600 = 82.3%** | **+185** | 0 |
| **PIPESHELL_RC** | (same native arm, OCCT mitred) | 309 / 600 = 51.5% | **494 / 600 = 82.3%** | **+185** | 0 |

**THRUSECTIONS is the control and it is the right one**: it is family D, and it
lives in the SAME TRANSLATION UNIT this change edits, so if it moved the change
would not be localised. It did not move — and not merely in the percentage:
**0 of its 600 rows differ between the arms on any observable**.

Nor did anything that already worked. Of the parts each family built BEFORE, the
worst relative volume change is **0.000e+00** — not "within tolerance", bit for
bit the same number — and **no part went OK → DEFER** in any family.

`+245` and `+185` are exactly the sets the census predicted:
`141` arc-chain outer wires `+ 60` slot/kidney holes `+ 44` full-circle outer
wires for family E, and `141 + 44` for family F, which is handed only the OUTER
wire and so was never blocked by the 60 parts whose only arc is in a hole.

## What the 106 remaining declines are

The same 106 parts in every family: their profile's outer boundary contains a
**B-spline edge**. No arc geometry reaches them; see `../pipe_arc_census`. That
is the number that caps this family at 82.3% and not 100%, and it is a wall
rather than a to-do.

## How close the answers are to OCCT

`PIPESHELL_RC` is the row to read for that, because it is the only one where
OCCT is configured with the SAME transition convention this engine implements
(`SetTransitionMode(RightCorner)`; PR #97 established that OCCT's *default*
`Transformed` mode does not carry the section through a corner at all, so the
PIPE and PIPESHELL rows disagree with OCCT by construction and always did).

Over the 494 parts both arms build:

| observable | native == OCCT(RightCorner) |
|---|---|
| volume (1e-9 relative) | **494 / 494** — worst 7.6e-10 |
| centre of mass (1e-7 mm, componentwise) | **494 / 494** |
| face / edge / vertex / shell counts | 310 / 494 |
| the harness's `bb` field | 450 / 494 |

The geometry agrees on every part. The two count columns are worth reading
carefully rather than as failures:

* **The topology differences are native carrying FEWER faces**, never more:
  the commonest deltas are `(dF,dE,dV) = (-2,-2,0)` on 80 parts and
  `(0,-3,-3)` on 42. `ShapeUpgrade_UnifySameDomain` merges co-domain faces that
  OCCT leaves split at a seam. This is the same class of difference PR #64's
  `Canonize` finding recorded, and it is a representation choice, not a shape.

* **The 44 `bb` differences are an artefact of the metric, and are fully
  explained.** `test/corpus_ab_coverage.cpp` computes its `bb` field from the
  shape's VERTICES — its own comment says `// vertex-derived, not Bnd_Box` — and
  a curved solid's vertex set is its seams, not its extent. All 44 have
  `outer_types == "C"` (a full-circle outer wire), all 44 have IDENTICAL face
  counts to OCCT, and in 42 of them native has 3 vertices where OCCT has 6.
  A cylinder with one seam vertex reports a degenerate box; so does OCCT's, in
  the PIPESHELL row where its shape also has 3. Checked directly with
  `BRepBndLib::Add`: the engine's mitred-cylinder elbow reports the correct box
  `(-10.055, -10, 0)-(28.66, 10, 79.641)` for r=10, with and without
  triangulation. Nothing is wrong with the solids; the harness's `bb` is simply
  not a bounding box for curved geometry.

## Files

| file | what |
|---|---|
| `before_summary.md`, `before_results.jsonl.gz`, `before_manifest.json` | the arm with `NativeLoftPipe.cpp` at `HEAD` |
| `after_summary.md`, `after_results.jsonl.gz`, `after_manifest.json` | the arm with the arc-swept lateral face |

Both manifests record `dirty_files_in_src_include_test > 0`, because both were
measured from a working tree carrying this change — the BEFORE arm differs from
HEAD only in that one file being restored to HEAD.
