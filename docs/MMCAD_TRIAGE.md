# MM-CAD triage — what is downloadable, what is clean, and what translates

Status: **MM-CAD:A is downloadable and measures CLEAN against every ACTIVE holdout.
MM-CAD:B — the half that motivated the request — DOES NOT EXIST as an artifact yet.**

Everything below is measured. Where something was not measured it says so.

---

## 1. What is actually downloadable today

| part | repo | status |
|---|---|---|
| MM-CAD:A | `exanos/MMCAD` (HF dataset) | **LIVE**, public, not gated |
| MM-CAD:B | *the same repo, per the authors* | **ABSENT** |

MM-CAD:B is not a separate repo. Both the project page and the code README say the
upload "will appear in the same dataset repository". It has not. Measured against the
repo, not the website:

* `GET /api/datasets/exanos/MMCAD/refs` → branches: `main` only (`e78ce7ee354f9a…`),
  `tags: []`, `converts: []`.
* Full recursive tree = 4,405 entries / 4,391 files. Top-level: `archives/`,
  `sketches/`, `metadata.csv`, `metadata.parquet`, `README.md`, `LICENSES.md`,
  `.gitattributes`. **Zero** paths matching
  `step|brep|construction|taxonom|faiss|photoreal`.

So none of MM-CAD:B's six advertised components — STEP B-Rep, construction-sequence
captions, the 4,862-node taxonomy, the FAISS graph, contour sketches, photoreal
images — is on disk anywhere. There is no partial upload to sample.

**License:** CC BY-NC 4.0 on the aggregation. **Non-commercial.** The underlying
geometry keeps each source benchmark's own terms, and `LICENSES.md` flags DeepCAD and
Fusion360 as "research use — check terms". `MODEL_DATA.md` already carries the same
flag for Onshape/ABC-derived data ("redistribution terms UNVERIFIED"). Nothing here
clears that.

## 2. Measured size, against measured free disk

Free space measured with `df /Users/account_clawteam1` (the data volume, not the APFS
container): **86 GiB** at the start of this triage, 90 GiB at the end.

| what | measured |
|---|---|
| MM-CAD:A **download** (sum of 4,391 LFS blobs) | **21,106,968,087 B = 19.657 GiB** |
| ├ `archives/meshes` (10 zips) | 9.301 GiB |
| ├ `archives/point_clouds` (10 zips) | 5.409 GiB |
| ├ `archives/renders` (3 zips) | 3.063 GiB |
| ├ `archives/sketches` (2 zips) | 1.704 GiB |
| ├ `sketches/look_n_drawn` (3,265 raw PNG) | 0.107 GiB |
| ├ `sketches/traced` (1,096 raw PNG) | 0.037 GiB |
| └ `metadata.csv` + `metadata.parquet` | 0.037 GiB |
| **uncompressed** (dataset card, not measured by us) | ≈44 GB ≈ 41 GiB |
| **peak if downloaded then extracted in place** | **≈60.7 GiB** |

60.7 GiB against 86 GiB free leaves ~25 GiB while eight peer agents and a live 600-row
evaluation share this Mac. It *fits*, but not with headroom worth taking.

**So only metadata was fetched: 38 MB** (`metadata.csv` 30,046,323 B +
`metadata.parquet` 9,746,069 B + the two doc files), into
`archdisc-Models/data/external/mmcad/` — a `data/`-gitignored path, so it can never be
committed. The archives were deliberately not fetched; nothing about the contamination
question needs them, because identity lives in `metadata.csv`.

## 3. Contamination — VERBATIM

Scanned with the existing `archdisc-Models/scripts/contamination_guard.py`, per split,
never pooled. `scripts/mmcad_to_scan_jsonl.py` renders `metadata.csv` into the strict
training-row schema first, deliberately over-sensitively (see its docstring): the
provenance goes into `image`, `id`, `source`, `stem`, the user turn AND the assistant
turn, so the guard gets more identity surface than a real training row would carry.

```
   clean data/external/mmcad/scan/mmcad_a_train.jsonl: 27048 rows
[guard] 0 contaminated row(s) across 1 file(s)

   clean data/external/mmcad/scan/mmcad_a_val.jsonl: 3376 rows
[guard] 0 contaminated row(s) across 1 file(s)

   clean data/external/mmcad/scan/mmcad_a_test.jsonl: 3392 rows
[guard] 0 contaminated row(s) across 1 file(s)
```

All 33,816 rows, exit code 0 on each.

### The zero is falsifiable — positive control

A zero that arrives that cleanly is the exact shape of a harness that never looked, so
`scripts/mmcad_scan_positive_control.py` plants one row per rule into real MM-CAD
carrier rows and re-scans. **7 planted, 7 caught:**

```
** CONTAMINATED data/external/mmcad/scan/positive_control.jsonl: 7/7 rows
     by rule: {'R1': 1, 'R3': 1, 'R4': 1, 'R6': 3, 'R8': 1}
     line 1: R1 path references banned collection 'cadgenbench-data': data/cadgenbench-data/101/drawing.png
     line 2: R3 stated envelope [45.0, 146.0, 232.0] matches eval part 101 [45.0, 146.0, 232.0] within 0.5%
     line 3: R4 text names eval collection 'cadgenbench_submissions'
     line 4: R6 references part 'ball_knob_000330_s20260505' of ACTIVE eval/holdout split 'benchcad_canonical_42'
     line 5: R6 references part 'hinge_000013_s20260506' of ACTIVE eval/holdout split 'famgap_heldout_B'
     line 6: R6 references part 'muse_bookshelf' of ACTIVE eval/holdout split 'bench_tasks_muse'
     ... 1 more
```

The 7th is **R8 — a verbatim `holdout_enlarged_600` prompt (`id=ho23`)**, which is the
rule that protects the 600-row split specifically: its rows carry no stem, so its
identity rests on prompt text alone.

### Two more mechanisms, same answer

1. **Direct id intersection.** All 33,816 `source_id`s (raw and `norm_stem`-normalised)
   against the guard's 5,864 ACTIVE stems: **0 hits, in every one of the 11 benchmarks**
   — DeepCAD 0/3,557, Fusion360 0/2,026, CADParser 0/1,561, MCB 0/14,399, and so on.
2. **Envelope probe against the 600-row holdout's own bboxes**, which the guard's R3
   does *not* cover (R3 fingerprints only the 81 CADGenBench parts): **0 matches** at
   0.5% on all three sorted extents.

### Why it is clean — this matters more than the zero

The premise that MM-CAD:A "unifies DeepCAD/Fusion360/ABC so it plausibly overlaps the
holdout" turns out to be **false for our splits**, and for a structural reason:

* Our ACTIVE holdout parts are **procedurally generated BenchCAD-family geometry**
  (`ball_knob_000330_s20260505`, `hinge_000013_s20260506`) or MUSE task ids
  (`muse_bookshelf`). None is a raw benchmark model.
* `holdout_enlarged_600` is built from `ft_decomp_gt`, whose rows are kernel-measured
  face censuses of generated trees. Its identity is prompt text; its parts have no
  upstream benchmark id at all.
* MM-CAD:A carries raw benchmark models under MM-CAD `uid`s.

The two collections do not share an id space, and — per the envelope probe — do not
share stated geometry either. That is a stronger result than a coincidental zero, but
note its limit: **it is an identity and envelope argument, not a shape-equality proof.**
If a future split is ever drawn from raw DeepCAD/Fusion360/ABC ids, this conclusion
expires and the scan must be re-run at that training launch, not inherited from here.

## 4. Do MM-CAD:B's captions carry a real operation sequence?

**Cannot be answered from MM-CAD:B — it does not exist to sample.** Not asserting either
way about the shipped artifact. What *can* be established, and was:

**(a) What MM-CAD:B claims to ship is PROSE, not a sequence.** The paper abstract says
the pipeline "conditions caption generation on parsed construction sequences rather than
rendered views alone, producing three-level text descriptions". Conditioning caption
generation *on* a sequence produces a caption. Nothing in the abstract, the project page
or the README claims the parsed sequence itself is released as a field.

**(b) The upstream FeatureScript IS a real feature tree — quoted.** MM-CAD:B parses
ABC's `ofs` format ("Original FeatureScript definition of the CAD model from Onshape.
Represents the generation process"). That is downloadable today. From ABC's own published
sample `00000050_80d90bfdd2e74e709956122a_featurescript_000.yml`, feature 2 of 12:

```yaml
    featureType: extrude
    name: Extrude 1
    parameters:
    - message:
        enumName: NewBodyOperationType
        parameterId: operationType
        value: NEW
    - message:
        enumName: BoundingType
        parameterId: endBound
        value: SYMMETRIC
    - message:
        expression: 0.125*in
        parameterId: depth
        units: ''
        value: 0.0
```

and the file's ordered tree is
`newSketch → extrude → newSketch → extrude → circularPattern → newSketch → extrude →
newSketch → extrude → extrude → newSketch → extrude` (`rollbackIndex: 12`).

That is an operation sequence with typed parameters and a symbolic expression
(`0.125*in`) — a feature tree, not prose about one.

**(c) The strategic consequence.** If what we want is real human construction sequences,
**MM-CAD:B is not the shortest path to them — ABC's `ofs` chunks are, and they are
downloadable now.** One chunk (`abc_0000_ofs_v00.7z`) measures **183,525,641 B = 175 MiB
for 10,000 models**, so all 100 chunks ≈ 17 GiB — comparable to MM-CAD:A and readable
with `bsdtar` (no 7z binary on this Mac). MM-CAD:B's value-add over raw ABC is curation
(MAAS neighbourhoods, taxonomy, hard negatives), not sequence access.

## 5. FeatureScript → Forge IR: the translation gap

Grounded in a census of **9,849 real human models** (every model carrying an `ofs` file
in ABC chunk 0000), **154,637 user feature instances** — not from memory. Target is the
40-op emission vocabulary in `implementation/sacrosanct/archie_op_vocabulary.json`.

Median tree is **8 user features** (mean 15.7, max 484).

### Direct (12 featureTypes, 55.08% of instances)

| FeatureScript | n | Forge IR |
|---|---:|---|
| `extrude` | 48,641 | `EXTRUDE` + `CUT`/`FUSE`/`COMMON` for `operationType` |
| `fillet` | 13,645 | `FILLET` / `BLEND` |
| `booleanBodies` | 4,560 | `FUSE` / `CUT` / `COMMON` |
| `chamfer` | 4,541 | `CHAMFER` |
| `revolve` | 4,184 | `REVOLVE` |
| `transform` | 3,369 | `TRANSLATE` / `ROTATE` |
| `mirror` | 2,165 | `MIRROR` |
| `circularPattern` | 1,350 | `PATTERN(…, POLAR, …)` |
| `shell` | 1,032 | `SHELL` |
| `linearPattern` | 971 | `PATTERN(…, LINEAR, …)` |
| `loft` | 469 | `LOFT` |
| `hole` | 248 | `HOLE` / `CBORE` |

"Direct" means an op exists, not that the mapping is free — see the caveats below.

### Partial (39.55% of instances), dominated by one thing

| FeatureScript | n | what is missing |
|---|---:|---|
| `newSketch` | 49,903 | **Forge has no sketch entity.** Profiles are 5 canned producers (`CIRCLE`, `RECT`, `RRECT`, `REGPOLY`, `POLY`) plus `WIRE`/`RING`. An arbitrary profile must collapse into one of those or be tessellated by `POLY`. |
| `cPlane` / `cPoint` | 5,825 | no datum entity; must be constant-folded into op args |
| `moveFace` | 1,807 | `PUSHFACE` is a normal offset; `moveFace` also translates/rotates |
| `deleteBodies` | 1,609 | structural — drop the `%ref`, no op |
| `sweep` | 1,102 | `SWEEP(r, [x y z; …])` is a **circular profile along a polyline only**; arbitrary profile+path has no equivalent |
| `deleteFace` | 510 | `DEFEATURE` |
| `assignVariable` | 365 | IR has no variables; constant-fold only |
| `sheetMetal*` (5 kinds) | 35 | `FOLD` covers a flange, not the sheet-metal model |

### No equivalent (8,306 instances, 5.37%) — and these BLOCK a whole model

| FeatureScript | n | note |
|---|---:|---|
| `importForeign` | 2,258 | an imported external body — **the construction history is absent by definition**; unfixable, not a vocabulary gap |
| `mateConnector` | 2,196 | assembly reference frame; no IR concept |
| `thicken` | 1,118 | `THICKEN` is in `forbidden_ops` — explicitly not user-invocable |
| `draft` | 898 | no draft op in the 40 |
| `splitPart` | 672 | `SECTION` yields a `WIRE`, not a split solid |
| `helix` | 445 | no helical curve producer; `RING`/`WIRE` are planar/polyline |
| `copyPart` / `importDerived` | 381 | cross-document derivation |
| `replaceFace` | 170 | — |
| `modifyFillet` | 96 | — |
| `threadCreator` | 17 | — |
| everything else | 55 over 25 distinct types | mostly **custom FeatureScript features** — `Beam` 9, `rib` 5, `SpurGear` 4, `dcSphere` 4, `brickFeature` 3, `lighten` 3, `beamProfile` 3, `HexInfill` 2, `overcut` 2, `cycloid`, `waveSpring`, `beltFeature`, `Elbow`, `portFeature`, `hexPocket`, … — **arbitrary user code from the Onshape app store, unmappable in principle** since each has whatever semantics its author wrote; plus 6 surface ops (`offsetSurface` 2, `fill`, `enclose`, `fitSpline`, `surfaceText`) against which `CAP`/`SEW`/`SKIN`/`THICKEN` are all forbidden |

### Two facts that decide feasibility

**Good news — the sketches are already solved.** Real sketches are constraint systems
(1,195,996 `BTMSketchConstraint` instances in this chunk; median 57 constraints per
usable model), which would normally mean translation requires a 2D constraint solver.
It does not: `ofs` carries the **evaluated** geometry alongside the constraints —

```yaml
        geometry:
          message:
            dirX: 1.0
            dirY: 0.0
            pntX: 0.0
            pntY: 0.023788901859956878
          typeName: BTCurveGeometryLine
        startParam: -0.00966046850049173
        endParam: 0.00966046850049173
```

— literal solved coordinates in **metres** (0.0237889 m = 23.79 mm). Drop the
constraints, read the geometry, convert m→mm. No solver needed.

**Bad news — the profile alphabet does not match.** Sketch entity census, 452,961
entities total:

| entity | n | Forge |
|---|---:|---|
| `BTCurveGeometryLine` | 334,104 | `POLY` |
| `BTCurveGeometryCircle` | 109,542 | `CIRCLE` if a full circle; **an arc has no exact form** — `POLY` must tessellate it (`RRECT` covers only the rounded-rectangle case) |
| `BTCurveGeometrySpline` + `Interpolated` | 8,700 | **none** |
| `BTCurveGeometryEllipse` | 612 | **none** |
| `BTCurveGeometryConic` | 3 | **none** |

Lines + circles/arcs are **97.94%** of entities; splines/ellipses/conics **2.06%** have
no representation. Of 391,112 *bounded* segments, 334,104 are lines, leaving **57,008
bounded curved segments** — arcs, plus the bounded share of the splines — that `POLY`
can only approximate.

### The yield number

| gate | models | share of 9,849 |
|---|---:|---:|
| blocked by ≥1 unmappable featureType | 3,938 | 39.98% |
| contains a spline/ellipse/conic sketch | 882 | 8.96% |
| **clear on BOTH gates** | **5,437** | **55.20%** |

and, computed separately: **0.00%** of models translate with *only* direct ops, because
every model with an extrude also has a `newSketch`, and no real sketch reduces to a
canned profile for free.

So the honest headline for a FeatureScript ingest: **about 55% of real ABC models are
expressible at all, none of them trivially, and the binding constraint is that Forge's
IR has no sketch — not that it is missing exotic ops.**

Adding the three cheapest missing ops (`draft`, `splitPart`, `helix`) recovers **745 of
the 3,938 blocked models — measured, not the 2,015 their instance counts suggest**,
because most models that use one of them also use `importForeign`, `mateConnector` or
`thicken`. And `importForeign` (2,258 instances, the single largest blocker) cannot be
recovered by adding any op at all: those models never had a parseable history, they
imported a finished body. Op-vocabulary work has a low ceiling here; the sketch
representation is where the yield is.

---

## Reproduce

```bash
# metadata only (38 MB) — not the 19.657 GiB of archives
curl -sL -o metadata.csv \
  https://huggingface.co/datasets/exanos/MMCAD/resolve/main/metadata.csv

python3 scripts/mmcad_to_scan_jsonl.py --csv <dir>/metadata.csv \
        --out-dir <dir>/scan --by-split
python3 <models>/scripts/contamination_guard.py --scan <dir>/scan/mmcad_a_train.jsonl
python3 <models>/scripts/contamination_guard.py --scan <dir>/scan/mmcad_a_val.jsonl
python3 <models>/scripts/contamination_guard.py --scan <dir>/scan/mmcad_a_test.jsonl

# prove the zero is falsifiable before believing it
python3 scripts/mmcad_scan_positive_control.py \
        --real <dir>/scan/mmcad_a_val.jsonl --out <dir>/scan/positive_control.jsonl
python3 <models>/scripts/contamination_guard.py --scan <dir>/scan/positive_control.jsonl
```

Downloaded data lives under `archdisc-Models/data/external/` — a gitignored path. No
dataset bytes are committed here.
