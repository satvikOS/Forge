# PIPESHELL (TKOffset family F) defer audit — 2026-08-30

Measured against `origin/claude/sacrosanct-execution-20260828` @ `7e6b405c`, on the
same 600-part corpus and with the same `test/run_corpus_ab_coverage.sh` as
`reports/corpus_ab/full600_*`. `FAMILIES=PIPESHELL,PIPE,THRUSECTIONS,FILLING`,
600/600 parts, 0 part-level errors on both runs. THRUSECTIONS and FILLING are
carried purely as CONTROLS: they must not move.

`before_summary.md` reproduces the committed `full600_after_filletfix` baseline
row for row (PIPESHELL native 309 OK / 291 DEFER, PIPE 249/351, THRUSECTIONS
309/291, FILLING 407/193), which is what makes it a baseline and not a second
opinion.

## What the 291 declines actually were

Every one of the 291 carried the SAME `FK_DEFER` label, `prof_edge_not_line`. A
single label over a whole deletion bucket is not an attribution: "an edge that is
not a line" is equally consistent with "these are free-form blobs no bounded
engine will ever sweep" and with "these are rounded outlines". The two readings
call for opposite engineering.

`test/pipeshell_defer_census.cpp` (driven by `test/run_pipeshell_defer_census.sh`)
settles it. It reproduces the A/B's OWN input — the same largest-planar-face pick
with the same centroid tie-break, the same `BRepTools::OuterWire`, the same
two-leg 30-degree spine — and names the exact curve type of every edge on it, so
a row here refers to the same geometry the A/B row refers to.

| count | class | mean edges | closes into a planar face |
|---:|---|---:|---:|
| 309 | `LINE_ONLY` (already covered) | 4.0 | 309/309 |
| 141 | `LINE_ARC` — lines and circular arcs | 10.3 | 141/141 |
| 106 | `HAS_BSPLINE` | 31.7 | 106/106 |
| 44 | `ARC_ONLY` — a SINGLE full circle | 1.0 | 44/44 |

**291/291 close into a planar face.** So the bucket was never "sections that are
not planar regions". It was one precondition — `polygonRing()` reading VERTICES —
applied to sections whose boundary happens to be curved.

The census carries its own two-direction control and `run_pipeshell_defer_census.sh`
treats a self-test failure as fatal before any corpus row exists: an all-line square
must classify `LINE_ONLY` AND build, and a rounded rectangle must classify
`LINE_ARC`. `FORGE_PS_CENSUS_EXPECT_ARC_SOLID=1` flips the arc expectation from
NULL to SOLID, so the same self-test is a live control on both sides of the fix
rather than a line to delete.

## The engine, and why it is exact

Write `Prism_j` for the INFINITE prism of leg j. The mitre plane `M_j` bisects
`d_{j-1}` and `d_j`, so the reflection `R_j` in `M_j` maps `d_{j-1}` to `-d_j` and
fixes `M_j` pointwise. An infinite prism is its section swept in BOTH senses,
hence

    R_j(Prism_{j-1}) = Prism_j        exactly,
    Prism_j          = g_j(Prism_0),  g_j = R_j o ... o R_1  a RIGID MOTION.

A rigid motion carries a circle to a circle and a B-spline to a congruent
B-spline. There is nothing to fit and nothing to tessellate. The leg solid is that
prism cut by its two station planes — `pipeCircleMitre`'s construction with the
circular-section restriction lifted — and the legs are fused and unified.

Three things this needed that "transform and cut" does not say by itself:

- **Every transform applied is PROPER.** `g_j` composes j reflections, so for odd
  j it is orientation-reversing, and a mirrored solid handed to
  `BRepAlgoAPI_Common` keeps the complement. `Prism_0` is invariant under the
  reflection `sigma` in the SECTION'S OWN plane, so `g_j o sigma` maps `Prism_0`
  to `Prism_j` just as `g_j` does and is proper whenever `g_j` is not — and
  `sigma` maps the section face onto itself, so the geometry is unchanged and only
  the handedness is. The volume sign is read anyway before any boolean.

- **A perpendicular station is not CUT, it is the prism's own END.** Station 0 is
  the section's plane and station k is normal to the last leg, so only interior
  MITRE stations are oblique. Measured: the raw `occtPrism` of an elliptical
  section equals the closed form at `rel = 0`, and trimming it with two redundant
  perpendicular half-space `Common`s moved it by `2e-5` relative — OCCT's boolean
  re-approximates the section curve. A straight spine now costs ZERO booleans.

- **The section must be a VALID FACE**, and that is load-bearing. `BRepGProp`
  returns an area for a face that bounds nothing, so without this gate the volume
  oracle would check a wrong answer against a wrong expectation and agree.
  Measured on a 40x40 outer square:

  | section | `BRepCheck_Analyzer` | area it reports |
  |---|---:|---:|
  | OPEN half-circle inner wire | 0 | 1574.87 |
  | two OVERLAPPING circular holes | 0 | 1373.81 |
  | a hole POKING THROUGH the wall | 0 | -363.50 |
  | CONTROL one legal circular hole | 1 | 1549.73 |
  | CONTROL no hole | 1 | 1600 |

  The first two were swept into plausible-looking solids before the gate existed.
  `test/run_ab_native_loftpipe.sh` caught them, which is what it is for.

## The oracle, and where its tolerance comes from

Over each leg the axial thickness between the two station planes is AFFINE on the
right cross-section, so its integral is `area x` its value at the section
CENTROID: `V = area x (length of the centroid's own mitre-transported path)`. A
leg trimmed on the wrong side of a station, a dropped fuse operand or an inverted
boolean operand are all percent-level effects.

The `1e-6` gate is ANCHORED: it is exactly the relative volume tolerance the
corpus A/B's own comparator uses to declare two solids to AGREE
(`test/corpus_ab_coverage.cpp`, `close_()`). Accepting a build whose volume misses
its closed form by more than that would be accepting a build the A/B could not
then call correct.

It is also MEASURED against the distribution it has to separate.
`FORGE_GEN_ORACLE_REPORT=1` prints the ratio for every build, accepted or
rejected; `oracle_ratios_600.txt.gz` is that channel over all 600 parts. Over the
291 curved sections:

| min | p50 | p90 | p99 | max |
|---:|---:|---:|---:|---:|
| 0 | 1.5e-10 | 1.0e-8 | 1.4e-7 | 1.46e-6 |

108 of 291 sit above `1e-9` and only 3 above `1e-7`. The entire spread is OCCT's
boolean re-approximating a mitre section curve. ONE part — `ho1190`, an 8-edge
all-B-spline outline — lands at `1.46e-6` and is DECLINED. That is a close call
and it is left as a decline rather than tuned away: a tolerance widened until the
last part fits is not a tolerance.

## An oracle that is NOT the engine's own closed form

The volume gate above is real but SELF-REFERENTIAL: it checks the construction
against the identity the construction was derived from. It cannot separate "the
engine built the mitred sweep" from "the engine built some other solid enclosing
the same volume", and this repository has four measured cases where volume alone
ratified a wrong solid.

`mitre_ratio_check.py` closes that. The A/B already runs OCCT's
`BRepOffsetAPI_MakePipeShell` twice on the same input — once at its DEFAULT
transition mode and once with `RightCorner`. Under the default, OCCT was measured
(`test/run_ab_pipeshell_transition.sh`, 45 synthetic cases) not to carry the
section through the corner, so it encloses `A*(L1 + L2*cos theta)` where the mitre
encloses `A*(L1 + L2)`. The A/B's spine is two EQUAL legs at exactly 30 degrees,
so if and only if the native engine is building the mitre,

    native_volume / occt_default_volume  =  2 / (1 + cos 30)  =  1.0717967697...

for every part, whatever its section's shape, area or edge types. Nothing in the
native engine computes that number and OCCT's default arm is a separate
implementation, so agreement is evidence rather than a tautology.

| class | n | median ratio | \|median − closed form\| |
|---|---:|---:|---:|
| `LINE_ONLY` (the already-proven control) | 309 | 1.0717967697 | 1.2e-11 |
| `LINE_ARC` (new) | 141 | 1.0717967697 | 7.4e-11 |
| `HAS_BSPLINE` (new) | 105 | 1.0717967695 | 2.2e-10 |
| `ARC_ONLY` (new) | 44 | 1.0717967579 | 1.2e-8 |

The newly covered classes match the closed form to the SAME precision as the
`LINE_ONLY` class the A/B has independently proved exact against
OCCT(`RightCorner`) on all 309 parts. The spread around each median is expected
and is present in the control too: the identity is exact only when the section
CENTROID sits on the spine start, and the harness starts its spine at the FACE
centroid while handing PIPESHELL the face's OUTER WIRE, so a part with holes
carries a small offset.

Running the same script on `before_results.jsonl.gz` is the negative control: only
`LINE_ONLY` appears at all, because the curved classes had no native build to
take a ratio of.

### Where OCCT's own `RightCorner` arm cannot be the oracle

Five parts (`ho1040`, `ho109`, `ho1154`, `ho116`, `ho126`) disagree with the
`PIPESHELL_RC` arm on volume by 20–24%. On all five, native is
`BRepCheck_Analyzer` **VALID** with 18/40/24 faces/edges/vertices and the OCCT
`RightCorner` arm is **INVALID** with 18/48/32 — it built a self-intersecting
shape whose measured volume and area are both inflated. On the very same parts the
DEFAULT-transition OCCT arm is valid, and native/default is `1.0718` to ten
decimals. This is the same class of OCCT failure the file banner already records
for `MakePipe` and `MakeThickSolid` on bent spines, and it is why the closed form
is the oracle here and OCCT is not.

## Result: the engine's own verdict, part by part

`census_before_600.tsv` and `census_after_600.tsv` are the same probe over the same
600 parts on either side of the change. Cross-tabbed:

| class | before | after | n |
|---|---|---|---:|
| `LINE_ONLY` | SOLID | SOLID | 309 |
| `LINE_ARC` | NULL | SOLID | 141 |
| `ARC_ONLY` | NULL | SOLID | 44 |
| `HAS_BSPLINE` | NULL | SOLID | 105 |
| `HAS_BSPLINE` | NULL | NULL | 1 |

Not one `LINE_ONLY` part changed verdict, and that is structural rather than
lucky: `pipeShell` reaches the curved path only when `allLineEdges(profile)` is
FALSE, so a polygon profile that declines on some OTHER precondition still
declines, on a byte-identical code path.

## Cost

The curved path is booleans where the polygon path was sewn quads. On this machine
the whole four-family A/B went from ~0.85 s/part to ~4.5 s/part with PIPE and
PIPESHELL both on the new path. No part exceeded the harness's 20 s per-arm
deadline. That is a real cost and it is stated rather than buried.

## Files

| file | what |
|---|---|
| `before_manifest.json`, `before_summary.md`, `before_results.jsonl.gz` | the A/B before, at `7e6b405c` |
| `after_manifest.json`, `after_summary.md`, `after_results.jsonl.gz` | the A/B after |
| `census_before_600.tsv`, `census_after_600.tsv` | `pipeshell_defer_census` over all 600 parts, both sides |
| `oracle_ratios_600.txt.gz` | `FORGE_GEN_ORACLE_REPORT` for every accepted and rejected build |
| `mitre_ratio_check.py` | the independent (non-self-referential) volume oracle above; run it on either `results.jsonl` |
