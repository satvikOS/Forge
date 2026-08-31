# The exact arc-swept lateral face — census, oracle, and coverage

Measured on the same 600 reference solids `test/run_corpus_ab_coverage.sh` uses
(`archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`),
with `forge-kernel/tools/run_pipe_profile_census.sh`. The census tool links **no
forge code and calls no forge engine**, so it cannot be made to agree with the
engine by changing the engine.

The face measured is exactly the one the corpus A/B feeds to
`forge::occtloft::pipe`: the largest planar face, ties broken by centroid.

---

## 1. What shape the profile actually is

`reports/corpus_ab/pipe_defer_audit` left family E at **249 / 600** and named the
351 remaining declines as needing "an exact arc-swept lateral face". This is the
census that says how many, and of what.

| count | outer ring | holes | native PIPE, before |
|---:|---|---|---|
| 247 | polygon | all full circles | OK |
| 141 | **arc chain** (lines + circular arcs) | all full circles | DEFER |
| 106 | **B-spline** | – | DEFER |
| 60 | polygon | **has an arc chain** (a slot / kidney pocket) | DEFER |
| 44 | **one full circle** | all full circles | DEFER |
| 2 | polygon | none | OK |

**494 of 600** profile faces have every ring a closed chain of LINE and CIRCULAR
ARC edges, every arc's axis parallel to the face normal. **106 carry a B-spline
edge on the outer boundary and no arc geometry reaches them** — that is a wall,
not a to-do, and it is what caps this family at 494/600 rather than 600/600.

The 141 arc-chain outer wires are not exotic. 80 of them are one word:

```
    80  CLCLCLCL          <- a rectangle with four filleted corners
    14  LLLLLCCCCCCCCCCC
    12  LLLLLCCCCCCCCC
    11  CLLLLLCCCCCCCC
    11  LLLLLCCCCCCCC
     3  LLLLCCCCCCCCL
     2  CLLLCC
     2  LLLLCL
   ... 13 distinct words in all
```

Across all 494 arc-chain faces there are **757 circular segments that bulge
OUTWARD** of their chord polygon and **519 that bulge INWARD**. Both directions
are real machined geometry; an engine that only handled convex fillets would
cover a little over half of them.

## 2. The decomposition is right — checked against OCCT, before any solid existed

The engine decomposes the region a ring bounds as

```
    region = chordPolygon  (+) every arc bulging AWAY from it
                           (-) every arc bulging INTO it
```

and then assembles the swept SOLID with that same boolean expression over swept
atoms. If the ADD/SUB decision were wrong on any arc, the region's area would be
wrong. So the census computes the area and centroid of every face in **closed
form** — chord-polygon shoelace, plus `(r²/2)(D − sin D)` per circular segment
with centroid `4 r sin³(D/2) / (3(D − sin D))` along the bisector — and compares
them to OCCT's own `BRepGProp::SurfaceProperties` on the same face:

| n | worst relative AREA disagreement | worst CENTROID disagreement | parts over 1e-9 | parts over 1e-12 |
|---:|---|---|---:|---:|
| 494 | **2.451e-14** (`ho1030`) | **1.182e-12 mm** | 0 | 0 |

That is the bulge decision correct on 1276 circular segments across 494 real
parts, established without building anything.

It is also the reason the engine's acceptance gate is what it is: the same two
closed forms are the right-hand side of

```
    vol(result) == A * L
```

where `L` is the mitred path length of the area centroid. Both sides are
independent of the B-rep being judged, which the earlier sum-of-tube-volumes gate
was not.

## 3. What the gate cannot see, and the guard that closes it

`BRepGProp::VolumeProperties` integrates the divergence theorem over the faces,
so **a shell that has folded through itself still reports exactly the signed
volume `A * L`** — the number the gate compares against. A section that a sharp
mitre carries BACKWARDS through a station plane therefore passes the gate while
being a self-intersecting solid.

Measured, with the fold preflight removed, on a 40×30 rectangle with one rounded
corner on the near side (so the far edge that folds is a straight LINE and the
per-segment arc check never looks at it), spine `(0,0,0)→(0,0,H)→(W,0,H)`:

| H = W | result | volume | `BRepCheck_Analyzer` |
|---:|---|---:|---|
| 40 / 25 | BUILT | 77209.51305 | valid |
| 5 | BUILT | 11634.42469 | **INVALID** |
| 8 | BUILT | 18788.07069 | **INVALID** |
| 12 | BUILT | 28326.26536 | **INVALID** |

Three plausible wrong shapes, every one of them past the `A*L` gate. With the
preflight in, those three decline with `arc_section_folds_at_mitre` and the valid
one still builds to the same `77209.51305`. Both halves are asserted in
`test/ab_native_loftpipe_occt.cpp`.

## 4. What the census predicted, and what was then measured

The census says the addressable set is `141 + 60 + 44 = 245` parts for family E
and `141 + 44 = 185` for family F (which is handed only the OUTER wire, so the 60
parts whose only arc is in a hole never blocked it). The paired corpus A/B in
`../pipe_arc_ab` measured exactly those numbers:

| family | before | after | Δ | predicted |
|---|---:|---:|---:|---:|
| PIPE | 249 / 600 = 41.5% | **494 / 600 = 82.3%** | +245 | +245 |
| PIPESHELL | 309 / 600 = 51.5% | **494 / 600 = 82.3%** | +185 | +185 |
| THRUSECTIONS (control, same file) | 309 / 600 = 51.5% | 309 / 600 = 51.5% | 0 | 0 |

Zero regressions in any family, and the volume of every part that already built
is unchanged to 0.000e+00 relative.

## 5. Reproduce

```
forge-kernel/tools/run_pipe_profile_census.sh out.jsonl
```

prints the two numbers above and writes one JSON row per part.
`profile_census_600.jsonl.gz` here is that output for the 600-part corpus.

Provenance: worktree of `origin/claude/sacrosanct-execution-20260828` @
`7e6b405c`, macOS 26.6.2, Apple clang 21.0.0, OCCT at
`/opt/homebrew/opt/opencascade`.
