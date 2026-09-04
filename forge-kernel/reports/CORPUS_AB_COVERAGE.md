# Corpus A/B coverage — the flip gate for the OCCT drop options

**Status: the harness exists and has been run at full corpus scale.**
Built 2026-08-29. Harness `forge-kernel/test/corpus_ab_coverage.cpp`,
driver `test/run_corpus_ab_coverage.sh`, aggregator `test/corpus_ab_aggregate.mjs`,
committed baseline in `forge-kernel/reports/corpus_ab/`.

---

## 1. What was missing, precisely

Ten of the twelve `FORGE_*_DROP_*` options in `forge-kernel/CMakeLists.txt` default
**OFF**, and each one names the same flip condition:

> "native success rate >= the measured OCCT baseline"

(`reports/TKOFFSET_DECOMPOSITION.md` §5 step 6, quoted verbatim at
`CMakeLists.txt:432`, `:475` and `:555`.)

The tree already had **seven live-OCCT A/B harnesses** (`test/ab_native_*_occt.cpp`
plus their `run_ab_native_*.sh` drivers). Every one of them answers **correctness**:
*where both engines answer, do they answer the same thing* — asserted on hand-built
cases against closed forms, with negative controls. All seven pass except the
recorded thicken regression.

None of them answers **coverage**: *how often does the native engine DECLINE on a
real part where OCCT would have built something*. That is a different question with
a different answer, and it is the one the gate is written against, because a drop
option turns a decline into a **thrown error** at every call site. Correctness says
the native answer is right when it exists; coverage says how often it exists.

This document and the harness it describes close that gap.

---

## 2. Method

### 2.1 The paired measurement

For one STEP part and one family, one operation is derived from the part's own
geometry (§2.3) and **both** arms are run on **the same input** in one process:

| arm | what it calls | what counts as success |
|---|---|---|
| native | the `forge::occt*` engine the drop routes to | non-null `TopoDS_Shape` with a non-empty result |
| OCCT | the exact call `src/Features.cpp` / `src/Cam.cpp` / `src/Healing.cpp` makes today, same arguments, same sign conventions | `IsDone() && !Shape().IsNull()` with a non-empty result |

Every OCCT arm is quoted in the harness with the `file:line` it was copied from, so
the baseline is the kernel's own call and not a plausible-looking approximation of
it. The sign conventions matter and were copied, not guessed — `part::shell` passes
`+wall` to the native engine and `-wall` to `MakeThickSolidByJoin`, and inverting
that would have scored the entire family wrong.

The pair goes into one of five buckets:

- `BOTH_OK` — both engines built something the call site would accept
- `NATIVE_ONLY` — native built, OCCT did not (**a capability add**)
- `OCCT_ONLY` — OCCT built, native declined (**the capability the drop deletes**)
- `NEITHER` — neither built (says nothing about either engine)
- `NOT_APPLICABLE` — this part cannot furnish an input for this family

`NOT_APPLICABLE` parts are **excluded from the denominator and counted separately**.
A rate over an unstated denominator is not a measurement.

### 2.2 Success is the call site's acceptance test, not validity

Validity (`BRepCheck_Analyzer`) is deliberately **not** in the success predicate.
`reports/TKOFFSET_DECOMPOSITION.md` §4.2 measured `MakeThickSolid` returning the
*cavity* with `IsDone() == true`, and `NativeLoftPipe.hpp` records `MakePipeShell`
returning an **invalid** solid on a bent spine with `IsDone() == true`. Folding
validity into "success" would quietly re-score the OCCT baseline downward and
flatter the native side — the harness would be marking its own homework. Validity
is measured for both arms and reported in its own column, so the gate can be read
either way from the same run.

**That last sentence was true of the *report* and false of the *verdict* until
2026-09-03.** The validity column existed and nothing read it; the coverage bar
counted every OCCT answer including the invalid ones, and three families were being
asked to reproduce solids that fail `BRepCheck`. §2.9 is what the verdict reads now.
The success predicate itself is unchanged — validity is still not part of "success",
for exactly the reason above.

### 2.3 Derivation — the input distribution, stated in full

A coverage number is only as honest as the distribution it was measured over, so the
derivation is part of the result. All picks are deterministic (no RNG); ties break on
the candidate's centroid ordered lexicographically, so a part always yields the same
operation.

| family | derived operation |
|---|---|
| `FILLET` | longest LINE edge, radius `0.05 * min bbox extent` |
| `CHAMFER` | the **same** edge `FILLET` picks, symmetric setback `0.05 * min bbox extent` |
| `MAKEOFFSET` | outer wire of the largest PLANAR face, inward `0.05*sqrt(area)` |
| `THICKSOLID` | remove the largest PLANAR face, wall `0.05 * min extent` |
| `OFFSETSHAPE` | grow the whole solid by `0.02 * min extent` |
| `THRUSECTIONS` | loft the outer wires of the two largest planar faces that do **not** share a plane |
| `PIPE` | sweep the largest planar FACE along a 2-leg polyline from that face's centroid, along its normal `0.5*diag`, then turned 30° for another `0.5*diag` |
| `PIPESHELL` | the same spine, profile passed as the WIRE (what `part::sweep` passes `MakePipeShell`), no guides |
| `FILLING` | outer wire of the largest face of any type |
| `THICKEN` | the largest face, skinned by `0.05 * min extent` |
| `DRAFT` | the largest planar SIDE WALL (`abs(n.z) < 0.1`), pull `+Z`, neutral plane `z = zmin`, angle 3° |

**One deliberate departure, named because it changes a number.** Family A's native
path (`src/Cam.cpp:257 tryNativeInwardOffset`) projects the wire onto XY, because
every `Cam.cpp` call site feeds an XY-planar toolpath wire. The corpus's faces are
arbitrarily oriented, and an XY projection would make the native arm fail for a
reason that is about the *call site*, not the engine. The replication in the harness
therefore takes the wire into its own plane's frame, offsets, and maps back — same
engine (`PolygonOffset2D::offsetLoop`), same options, same inward-sign rule,
different frame.

### 2.4 Two of the twelve options are out of scope, and why

`FORGE_SHHEAL_DROP_NATIVE` and `FORGE_GEOM_DROP_NATIVE` both **default ON** and
already shipped. Neither is a single op with a defer contract: they replace
low-level routines (`ValueOfUV`, curve projection, free bounds, `ShapeFix_Solid`;
the R1/R2/R3 geom primitives) called from *inside* other ops. There is no "native
declined where OCCT would have built it" event to count, so the paired-coverage
question does not apply to them. They are governed by their own A/B gates.

That leaves ten in-scope options and **eleven families, all eleven measured** —
eleven rather than ten because `FORGE_FILLET_DROP_NATIVE` is the one option that
is not a single class. See §2.11.

### 2.5 Containment, and its positive control

Every arm runs in a **forked child** that writes a fixed-size POD back over a pipe
and `_exit()`s. A `SIGSEGV` or an infinite loop is therefore recorded as `CRASH` /
`TIMEOUT` for **that arm only**, and costs neither the other arm's answer nor the
rest of the corpus. OCCT's offset and thicken engines do die on real imported NURBS
parts, and a harness that died with them would produce silence — which reads exactly
like a clean zero.

Containment that silently swallowed everything would *also* look like a clean run,
so `corpus_ab_coverage --selftest` fires it on demand: a deliberate `SIGSEGV`, a
deliberate spin, a deliberate throw, a null return and a real solid must come back as
`CRASH`, `TIMEOUT`, `THREW`, `DEFER` and `OK` respectively. `build_corpus_ab_coverage.sh`
runs the self-test as part of the build and **refuses to emit a binary if it is red**.

### 2.6 Eleven per-family positive controls — why the zeros are believable

Some families report a native success rate of **zero**. A zero is exactly what a
mis-wired arm also produces: wrong argument order, a profile the engine never looks
at, an engine that is not in the binary at all.

So `--selftest` additionally feeds **each of the eleven native engines** an input its
own header documents as in-scope — built on a 10 mm box that the native ruled loft
itself constructs, so nothing in the control depends on an OCCT modelling call — and
requires `OK` back from every one. All eleven are green
(`.build-corpus-ab/selftest.log`).

**A family whose control is red would make that family's corpus number a harness
result, not an engine result.** None is red.

**`CHAMFER` carries two controls the other ten do not need**, because it is the only
family whose engine has a near-identical twin in the same namespace.
`forge::occtfillet::makeFillet` and `::makeChamfer` take almost the same call shape,
share a `Result` type, and **both return `ok == true` on the control edge** — so a
`CHAMFER` family accidentally wired to `makeFillet` would build, and would emit a
full column of plausible numbers that were a duplicate of the `FILLET` row. `ctl()`
cannot see that. Two added checks can:

- **It is the chamfer engine.** Both engines are run on the *same* edge with the
  *same* argument and are required to **disagree** on the strict observable vector.
  A flat bevel removes `d²H/2`; a rolling-ball blend removes `(1 − π/4)d²H`. They
  cannot be the same solid.
- **The native answer is right, not merely non-null.** `ctl()` only asks for
  `ARM_OK`, and this repo's standing lesson is that a built shape proves nothing.
  A 10 mm box chamfered 1 mm on one vertical edge has a **closed form in two
  independent observables** — `V = 1000 − d²H/2 = 995` and
  `A = 600 − 2dH + d√2H − d² = 593.142135623731` — and **both** are checked. The
  closed form is used rather than "the two arms agree" deliberately: it is
  independent of OCCT, so it survives the drop macro that deletes OCCT's chamfer,
  and it says the native answer is *correct* where agreement says only that two
  engines match.

All four `CHAMFER` checks were proved to fire by mutation, not assumed: miswiring the
arm to `makeFillet` reddens three of them, and a 0.1% wrong setback — far too small
for the distinctness check to see — reddens both closed forms.

### 2.7 Sampling

The full corpus of 600 parts was run, so no sampling question arises for the
committed baseline. The driver nevertheless samples by **stride over the `LC_ALL=C`
sorted list, never a prefix** — a prefix of a difficulty-ordered corpus is a biased
sample (this programme has measured a prefix reading 0.2423 where the full set read
0.3617), and this corpus's ordering is undocumented. Stride, offset and realised `n`
are written into `manifest.json` next to every run.

### 2.8 Statistics

Per family the aggregator reports the paired difference with a **95% CI** and
**McNemar's exact two-sided test** on the discordant pairs. A difference without an
interval is not a result, and the concordant pairs carry no information about which
engine is better — including them (a two-proportion z) would understate the
uncertainty. When the CI straddles zero the table says so next to the verdict:
"not significantly worse" is not "not worse".

### 2.9 The verdict: replaceability, not coverage (2026-09-03)

Until 2026-09-03 the per-family verdict was one line in `corpus_ab_aggregate.mjs`:

```js
const pass = natOk >= occtOk;        // natOk  = both + nat only
                                     // occtOk = both + OCCT only
```

It asks only **whether each arm returned a shape**. Three facts measured on this
same corpus say that is not the question the drop options are asking:

| | measured | what the coverage line did with it |
|---|---|---|
| **H OFFSETSHAPE** | OCCT answers on 38/600; **33 of those 38 fail `BRepCheck`** | set the native arm a bar of 38 |
| **G THICKSOLID** | OCCT answers on 133/600; **all 133 fail `BRepCheck`** (§4 of `reports/corpus_ab/THICKSOLID_ATTRIBUTION.md`, on a corpus whose 600 source solids are all valid, six of them with more volume than the body they hollowed) | set the native arm a bar of 133 |
| **E PIPE / F PIPESHELL** | 599/600 vs 600/600 — "one part from parity" — while **agreeing on 0 of 599**, at a constant volume ratio 2/(1+cos 30°) = 1.071797 | read as near-passing |

So a family could **fail** while being asked to reproduce invalid geometry, and
**pass** while computing a different operation. The verdict is now a conjunction of
five terms:

| term | assertion |
|---|---|
| 1 **coverage** | `natOk >= occtOk` — **the original line, verbatim and still binding** |
| 2 **validity** | native OK-and-`BRepCheck`-valid >= OCCT OK-and-valid |
| 3 **agreement** | of the parts where **both** arms return a **valid** shape, the number whose observable vectors **disagree** must be 0 |
| 4 **replaceability** | the deficit against the **valid** bar must be 0: every part where OCCT returns a valid shape is reproduced by a native shape that is itself valid **and** agrees |
| 5 **sanity** | the native arm returns no shape whose centre of mass lies more than 1000x its own diagonal outside its own bounding box |

**Every term is an addition; term 1 is untouched.** A family can therefore never
pass this gate that would not also have passed the old one, and that direction is
asserted mechanically rather than claimed — see §2.10.

**Term 5, and why its threshold is 1000x and not "outside the bbox".** A part 50 mm
across with a centre of mass at 1e33 is a wrong-code-path signature this repo has hit
twice — `FeatureTreeCompiler`'s test-only setter (mass properties 85.2% low, COM 1e34)
and the separately-filed `boss_on_plate` defect (COM 2e33, **volume exact**) — and both
times a volume check saw nothing. The first version of this term simply asked whether
the COM was outside the bbox, and **it fired on 12 of 61 real THICKEN rows and 1 of 45
real FILLING rows**. Those are not defects. `bb` is VERTEX-derived (deliberately, so
`Bnd_Box`'s tolerance inflation cannot blur a disagreement) and a curved face bulges
past its own vertex hull — a full cylinder's only vertices lie on its seam, so its
vertex bbox is a **line** and its centroid is legitimately outside it. A term that reds
a valid cylinder is not a stricter gate, it is a wrong one. The gate term is therefore
three orders clear of any curvature bulge and still ~28 orders inside the fingerprint;
the tight count is kept as **reporting only**, under a name that says so. Both
behaviours are fixtures (E1-E5 fire it, E6-E8 prove it does not fire on curvature).

**The valid bar is reported, never silently substituted.** Term 1 still measures the
native arm against *all* of OCCT's answers, invalid ones included, because dropping
the invalid ones would *lower* the bar and this change is not permitted to lower
anything. The corrected bar (`occt_ok_valid`) is printed **beside** the coverage bar
in its own table, with the invalid count spelled out, so that H's bar of 38 can be
seen to be a bar of 5 — and acted on as a deliberate decision about the ledger
rather than as a side effect of the aggregator.

**What "agree" means.** `agree_strict` from the harness: volume, area, centre of
mass, all six bbox bounds, face/edge/vertex/shell/solid counts, **and the faces and
edges binned by surface / curve kind** (`GeomAbs_SurfaceType` / `GeomAbs_CurveType`,
emitted as `fk[11]` / `ek[9]`). Volume alone has ratified a wrong solid four times in
this repo, and in one of them no single scalar observable caught it. Counts alone are
blind to the substitution these engines actually make: replacing an analytic quadric
with a spline or a tessellation **keeps the face count and changes every face's
type**. The histograms are read off the same `TopTools_IndexedMapOfShape` the counts
come from and are asserted to sum to them, so a face cannot fall out of every bin and
silently become unable to mismatch. `agree` itself is unchanged, byte for byte,
because reports already in `reports/corpus_ab/` quote it; `agree_strict` is additive
and can only ever be a subset of it.

A JSONL produced before `agree_strict` existed falls back to `agree` — the strongest
vector that run actually measured — and every such row is counted and the table
carries a banner saying so. The fallback is never silent.

### 2.10 The gate's own positive control

`test/corpus_ab_gate_selftest.mjs` — an added term that cannot fail is
indistinguishable from one that is not there. It invokes the aggregator **as a
subprocess** on real JSONL (nothing re-implements the gate) and:

- drives **each** of the four added terms to `FAIL` on a fixture built for it, then to `PASS` on
  the same fixture with the one offending field changed — a term stuck at `FAIL` is
  as useless as one stuck at `PASS`, and only the pair distinguishes them;
- proves the gate reads `agree_strict` and not `agree`: a pair the loose vector calls
  equal and the strict vector calls different is scored as a disagreement;
- proves an invalid OCCT answer is **reported as invalid, not discarded** — the
  coverage bar still counts it, the valid bar does not;
- asserts the direction of the whole change (**check M**): over every fixture, and
  over any real `results.jsonl` passed with `--corpus`, `verdict == PASS` must imply
  `coverage_only_verdict == PASS`. If a family ever passes the new gate that would
  have failed the old one, this goes red;
- with `--corpus`, **mutates real rows**: breaking one real part's agreement in a
  passing family must flip it to `FAIL` (R2), and repairing every offending real row
  of a family that fails only on the added terms must flip it to `PASS` (R3).

It runs in CI (`kernel-tests.yml`, job `kernel`, ~2 s, no build) and
`run_corpus_ab_coverage.sh` runs it **before** aggregating — a verdict table produced
by an untested gate is worse than no table — and again with `--corpus` on the rows
just measured, exiting 5 if either is red. The harness's own `--selftest` gained
matching controls on the C++ side: a box and an analytic cylinder must land in
different, named kind bins (a histogram that binned everything as "Other" would make
the kind comparison vacuously true), and two `ArmResult`s identical in every scalar
the old vector compares but with one face moved from the plane bin to the B-spline
bin must be `agree == true` and `agree_strict == false`.

---

### 2.11 One option, two families — why `CHAMFER` is a row of its own

Nine of the ten in-scope options map one-to-one onto a family.
`FORGE_FILLET_DROP_NATIVE` does not: it drops a **toolkit**, and that toolkit
contains **two** classes the kernel calls.

The per-toolkit symbol census of the pinned `forge-kernel.node`
(`reports/OCCT_TOOLKIT_SYMBOL_CENSUS_2026-09-04.md`) counts TKFillet's entire
contribution as **eleven called symbols**:

| class | called symbols |
|---|---|
| `BRepFilletAPI_MakeFillet` | 5 |
| `BRepFilletAPI_MakeChamfer` | 5 |
| `ChFi3d_Builder` | 1 |
| **total** | **11** |

`src/Features.cpp` guards **both** classes behind that one macro — the include pair
at `:69-75` and the chamfer dispatch at `:2040-2147` — which is correct, because
both live in TKFillet.

**But until 2026-09-04 this harness measured that seam on half of what it drops.**
The family list had ten entries and `BRepFilletAPI_MakeChamfer` was not among them:
`test/corpus_ab_coverage.cpp` included only `BRepFilletAPI_MakeFillet.hxx`. A
chamfer that declines where OCCT builds is a deletion the `FILLET` row cannot see,
and on the `FILLET` row alone the option could have been read as gated when half its
surface had never been measured.

`CHAMFER` is that other half. Three properties make the two rows comparable:

- **Same input.** It is derived from the *same* longest-line edge `FILLET` uses,
  with the same `0.05 * min extent` argument. Any gap between the rows is therefore
  a gap between the **engines**, not between two samples.
- **Same dispatch.** The native arm builds the same `ChamferSpec`
  `forge::part::chamferEdges` builds (`dist = distance`, `dist2 = 0`, `contact`
  null — `Features.cpp:2073-2075` for the symmetric request) and calls the same
  `forge::occtfillet::makeChamfer`. The OCCT arm is `Features.cpp:2129` verbatim.
- **A refusal is recorded as a refusal.** `makeChamfer` returns `ok == false` with a
  reason rather than faking (`NativeFilletChamfer.hpp`, "HONEST SCOPE"), and under
  the drop that decline becomes a **thrown refusal** at the call site
  (`Features.cpp:2087`). The arm flattens it to a null shape, which buckets as
  `DEFER` — a native failure — and `agree()`/`agreeStrict()` reject on their first
  line. There is no path on which a decline is scored as a match. The reason is
  carried into the row's `note`, so an `OCCT_ONLY` row names *which* documented
  scope limit refused it.

Its `option` column reads `FORGE_FILLET_DROP_NATIVE`, the same string `FILLET`
carries. It is the only entry in the table where the option column is not a unique
key, and it means **both rows must clear the gate before that flag may flip**: a
PASS on one of them is not a PASS for the option.

## 3. Results — full corpus, 600/600 parts, 0 part-level failures

Measured 2026-08-30 against branch HEAD `f71ed98b` (build stamp and run SHA agree,
0 dirty files under `src`/`include`/`test`), all 600 gold reference solids, 6000
paired trials, 573 s wall. Raw rows in `reports/corpus_ab/results.jsonl.gz`,
self-test in `reports/corpus_ab/selftest.log`, provenance in
`reports/corpus_ab/manifest.json`.

| family | option | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| FILLET | `FORGE_FILLET_DROP_NATIVE` | 600 | 146 | 51 | **315** | 88 | 32.8% | 76.8% | -44.0% [-49.2, -38.8] | 1.4e-47 | FAIL |
| MAKEOFFSET | `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 567 | 0 | **27** | 6 | 94.5% | 99.0% | -4.5% [-6.2, -2.8] | 1.5e-8 | FAIL |
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% | -21.0% [-24.3, -17.7] | 2.4e-38 | FAIL |  <!-- superseded 2026-08-30: 8 / 0 / 125 / 467, see the THICKSOLID block in 3.2 -->
| OFFSETSHAPE | `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | -5.2% [-7.3, -3.0] | 3.1e-6 | FAIL |
| THRUSECTIONS | `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 0 | 0 | **567** | 33 | 0.0% | 94.5% | -94.5% [-96.3, -92.7] | 4.1e-171 | FAIL |
| PIPE | `FORGE_PIPE_DROP_NATIVE` | 600 | 2 | 0 | **598** | 0 | 0.3% | 100.0% | -99.7% [-100.1, -99.2] | 1.9e-180 | FAIL |
| PIPESHELL | `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 309 | 0 | **291** | 0 | 51.5% | 100.0% | -48.5% [-52.5, -44.5] | 5.0e-88 | FAIL |
| FILLING | `FORGE_FILLING_DROP_NATIVE` | 600 | 407 | 0 | **0** | 193 | 67.8% | 67.8% | 0.0% [0.0, 0.0] | 1.0000 | **PASS** (0 discordant pairs) |
| THICKEN | `FORGE_THICKEN_DROP_NATIVE` | 600 | 407 | 0 | **193** | 0 | 67.8% | 100.0% | -32.2% [-35.9, -28.4] | 1.6e-58 | FAIL |
| DRAFT | `FORGE_DRAFT_DROP_NATIVE` | 565 | 0 | 0 | **497** | 68 | 0.0% | 88.0% | -88.0% [-90.6, -85.3] | 4.9e-150 | FAIL |

> ### ⚠ THE `THRUSECTIONS` ROW ABOVE IS SUPERSEDED
>
> The table is the `f71ed98b` baseline and is kept verbatim as the audit record.
> One row has since moved. The `THRUSECTIONS` 0.0% was **not** a fact about the
> corpus — it was a defect in the native engine, which paired the two section
> rings by raw `BRepTools_WireExplorer` index and so skipped the reorient /
> re-origin step `BRepOffsetAPI_ThruSections` performs (via
> `BRepFill_CompatibleWires`) before *its* index pairing. Fixed in
> `src/native/brep/NativeLoftPipe.cpp::canonicalRing`. Re-measured over the same
> 600 parts, stride 1, 0 part-level errors:
>
> | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
> |---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
> | THRUSECTIONS (re-measured) | 600 | 309 | 0 | **258** | 33 | 51.5% | 94.5% | -43.0% [-47.0, -39.0] | 4.3e-78 | FAIL |
>
> All 309 both-build parts agree with OCCT on the **full observable vector**
> (volume + centre of mass + bounding box + face/edge/vertex/shell counts +
> validity); **0 disagree**. The option still fails its flip gate, now by 258
> curved-section parts rather than 567. Artefacts:
> `reports/corpus_ab/thrusections_canonicalring_600_summary.md`, raw rows in
> the matching `_results.jsonl.gz`, provenance in `_manifest.json`.

> ### ⚠ AND THE RE-MEASURED `THRUSECTIONS` ROW IS ITSELF SUPERSEDED
>
> The paragraph above closed by calling the surviving 258 "curved-section parts",
> which reads as a property of the corpus. It was not. `thruSections` returned a
> bare null shape from twelve places, so the bucket was unattributable; every
> return now records a label (`FK_DEFER`) and
> `test/run_thrusections_engine_census.sh` reports the label the **engine** wrote
> rather than a replica of its predicates. Its answer, over the same 600 parts:
>
> | engine's own defer label | parts |
> |---|---:|
> | `prof_edge_not_line` | **291 of 291** |
>
> One cause, not a tail: a section was represented as a ring of **vertices**, so
> every section edge had to be a LINE. Faceting the arcs would have answered with
> the wrong solid. The fix is an identity instead — **when section B is section A
> translated by T, the ruled loft between them IS the linear extrusion of A along
> T**, exactly, for any edge geometry — and `forge::occtPrism` (already linked
> into that file) is that extrusion, `FACE` giving laterals plus both caps and
> `WIRE` the open lateral skin, which is exactly the `isSolid` distinction
> `BRepOffsetAPI_ThruSections` draws. Measured, **189 of the 258 deleted parts
> (73.3%) are exact translates**. Re-measured over the same 600 parts, stride 1,
> 0 part-level errors, arms proved to differ (binary 716320 → 716800 bytes,
> sha `17105475…` → `8875d28b…`):
>
> | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
> |---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
> | THRUSECTIONS (translate path) | 600 | 498 | 0 | **69** | 33 | 83.0% | 94.5% | -11.5% [-14.1, -8.9] | 3.4e-21 | FAIL |
>
> All **498** both-build parts agree with OCCT on the full observable vector, **0
> disagree**, and all 498 native results are `BRepCheck_Analyzer` VALID. The
> change is **strictly additive** and that is measured, not asserted: the 309
> parts the engine already covered are **byte-identical** between the two runs,
> the OCCT arm did not move on any part, and the only bucket transition anywhere
> is `OCCT_ONLY → BOTH_OK` ×189. Two **untouched control families** measured in
> the same two runs did not move: PIPESHELL 51.5% and THICKEN 67.8%, with **0**
> bucket changes and **0** native-payload changes per part.
>
> It adds **no OCCT toolkit**: the seven symbols the change introduces are all
> `BRepAdaptor_Curve` (the sampler) resolving to `libTKBRep` and `libTKG3d`,
> which that translation unit already reached (17 and 13 symbols before), and no
> symbol of the native path resolves to `libTKOffset` — the toolkit this option
> exists to remove.
>
> The option **still fails** its flip gate. The surviving 69 are pairs that are
> not translates: of the 102 remaining deferrals 81 are an edge-count mismatch
> between the two sections and 21 are a genuine non-translate. A non-translated
> pair of curved sections needs ruled surfaces built between the curves, which is
> a different engine, and this time the claim is the engine's own label rather
> than an inference from the corpus. Artefacts:
> `reports/corpus_ab/thrusections_translate_600_{BEFORE,AFTER}_summary.md`, raw
> rows in the matching `_results.jsonl.gz`, provenance in `_manifest.json`, and
> the per-part defer labels in
> `reports/corpus_ab/thrusections_engine_census_600_{BEFORE,AFTER}.tsv.gz`.

> ### ⚠ THE `FILLET` ROW ABOVE IS SUPERSEDED, AND SO IS ITS `NATIVE_ONLY` CELL
>
> Both unexplained cells of the FILLET row were defects in the native engine, not
> facts about the corpus. Attribution, artefacts and the re-measurement are in
> `reports/corpus_ab/FILLET_ATTRIBUTION.md`; the summary:
>
> **The 51 `NATIVE_ONLY` parts were not a capability.** All 51 pick the same kind of
> edge — the u-wrap SEAM of a full cylindrical face, where ONE face meets ITSELF, so
> an `Extent()==2` ancestor test reads it as two adjacent faces (`IsTangentFaces`
> true 51/51, `DefineConnectType` Tangential 51/51, OCCT opens 0 contours and throws
> 51/51). The engine detected the no-op and skipped it, but skipping the ONLY spec
> left `seq.ok == true` and the work shape equal to the input, so `makeFillet`
> returned **the caller's own shape unchanged with `ok == true`** — native result
> volume bit-identical to the input on all 51. The harness's success predicate is
> the call site's own, so it scored each as a native win: 8.5 of the 32.8 points.
>
> **198 of the 315 `OCCT_ONLY` deferrals were one defect.** Of the 344 parts that
> reach `sewToSolid` the sew closes perfectly on every one (0 free edges, 0 multiple
> edges) — into ONE shell on 146 and TWO on 198 — and the 198 are two-LUMP bodies.
> `sewToSolid` kept the FIRST shell and discarded the other lump; the volume
> self-check caught all 198 at 27x-273x the expected material and reported
> "volume disagrees", naming the symptom.
>
> Both fixed in `src/native/brep/NativeFilletChamfer.cpp`. Re-measured over the same
> 600 parts, stride 1, 0 part-level errors:
>
> | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
> |---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
> | FILLET (re-measured) | 600 | 344 | 0 | **117** | 139 | 57.3% | 76.8% | -19.5% [-22.7, -16.3] | 1.2e-35 | FAIL |
>
> Every part moved in exactly one of two ways and no part moved in any other: 198
> `OCCT_ONLY -> BOTH_OK`, 51 `NATIVE_ONLY -> NEITHER`; the other 351 did not move.
> All 198 new successes agree with OCCT on volume **exactly** (`|dV|/V = 0.000e+00`,
> 198/198) and 167 agree on the entire observable vector; the 31 that do not differ
> only in topology counts and BRepCheck validity, with no geometric observable
> differing. The 146 that already passed are bit-identical before and after. The
> option still fails its flip gate, now by 117 parts rather than 315, and the residue
> is now entirely the engine header's own scope statements.

> ### ⚠ AND SUPERSEDED AGAIN — 117 became 59
>
> The block above left the remainder attributed by the engine's own guard text.
> Attributed one level deeper — by what the parts ARE rather than which guard fired —
> six rows turn out to be two facts. Full working in
> `reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md`; the summary:
>
> **115 of the 117 fail directly ON a curved face**, and the other two, which fail on
> vertex valence, have a cylinder at that very vertex. 86 have a CYLINDER at the ends
> of the picked edge (the `end face not planar` 58, the `non-straight outer boundary`
> 21 and the `extent not measurable` 7 all do), 29 have one adjacent to it. **Not one
> part in the bucket is a fully planar neighbourhood held back by a predicate**, so
> relaxing the ring predicate — the largest apparent win in the guard table — would
> have moved 28 parts from one guard to the next and changed no count.
>
> **The 58 are one population and the operation they name is not the edge.** Cap outer
> ring `Circle,Line,Circle,Line,Circle,Line,Circle,Line`, G1 at all eight junctions
> (worst tangent deviation 0.000e+00, 58/58), a planar prismatic wall behind every line
> and a quarter cylinder behind every arc (232/232), dihedral exactly 90°, convex
> 58/58. `BRepFilletAPI` propagates a contour across tangent junctions, so OCCT blends
> the WHOLE RIM there: it removes **2.53x to 4.11x** the single-edge closed form. A
> per-edge native blend would have been a different solid reported as the same
> operation.
>
> `forge::occtfillet` gains a rim path — the cap re-trimmed to its own ring offset
> inward by R, every wall pulled back R, one `Geom_CylindricalSurface` patch per line
> segment and one `Geom_ToroidalSurface` patch per arc segment. Analytic throughout, no
> new toolkit (`Geom_ToroidalSurface` is TKG3d). It is tried LAST, after the per-edge
> and corner-aware builds have both declined, so it cannot change an answer either
> already gives — and the measurement confirms it: all 344 parts that passed before
> pass now with a BIT-IDENTICAL volume, 344/344.
>
> Re-measured over the same 600 parts, stride 1, 0 part-level errors:
>
> | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
> |---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
> | FILLET (rim) | 600 | 402 | 1 | **59** | 138 | 67.2% | 76.8% | -9.7% [-12.1, -7.3] | 1.1e-16 | FAIL |

> **⚠ SUPERSEDED FOR FILLET/CHAMFER 2026-09-04 — 67.2% became 52.0% and 91 BRepCheck-invalid
> answers became 0.** The row above is the run at `9f309b52` and is kept as that run's
> record, not rewritten. The minimum-clearance half of `setbackFitsFaces` now DEFERS the 91
> parts on which the engine returned a `BRepCheck`-INVALID solid whose volume, area and
> shell/solid counts all matched OCCT, so native coverage falls 403 -> 312 (FILLET) and
> 344 -> 253 (CHAMFER) while native INVALID falls 91 -> 0 in both. **COVERAGE DROPS,
> VALIDITY RISES — a refusal, not a repair, and the option's gate gets harder.** The
> deficit against the VALID bar is unchanged at 202 (FILLET) / 171 (CHAMFER): the deleted
> answers were never usable. Current table and both jsonl.gz in
> `reports/corpus_ab/setback_clearance_ab_{before,after}_600.*`; the guard is proved in
> both directions by `test/setback_clearance_gate.mjs`.
>
> Every part moved in exactly one of two ways: 58 `OCCT_ONLY -> BOTH_OK`, 1
> `NEITHER -> NATIVE_ONLY`; the other 541 did not move. All 59 are BRepCheck-VALID and
> their removed volume equals an INDEPENDENT closed form (Pappus on the corner sections)
> with ratio **1.000000000, 59/59**.
>
> **THE FIRST VERSION OF THAT PATH SCORED 80, AND 21 OF THEM WERE WRONG BODIES WITH
> EXACTLY THE RIGHT VOLUME.** BRepCheck called 21 of its 22 `NATIVE_ONLY` results
> invalid — `IntersectingWires` on one planar face, 21/21 — because the cap's nearest
> HOLE lay closer to the rim than R (measured 0.104-1.000 of R against 1.000-10.59 on
> the 59 that are fine, the boundary exactly where the geometry puts it). The volume
> self-check matched the closed form to the last printed digit on all 21, and so did
> the cap-AREA identity that had been added *specifically* to catch a hole: **both are
> computed as (outer region) minus (hole regions), the same subtraction whether or not
> the regions overlap. Area was not a different enough observable from volume.** The
> guard is now topological (`BRepCheck` on the rebuilt cap face and on the assembled
> body), and the A/B pins it with a prism whose hole sits 0.5R from the rim — a case
> that FAILS with "engine DEFERS (got: ok)" against the version that lacked the guard.
>
> This is §3.2's lesson in its third form: a `NATIVE_ONLY` cell is where an engine's
> own success predicate is least trustworthy, and the cheapest way to settle it is a
> per-part census with an observable the engine is not already using.
>
> The option still fails its flip gate, now by 59 parts. Every one of the 59 has a
> curved face in the blend neighbourhood and needs new surface geometry, not a relaxed
> predicate. Artefacts: `reports/corpus_ab/full600_after_rim_summary.md`, raw rows in
> the matching `_results.jsonl.gz`, provenance in `_manifest.json`, and the per-part
> census in `fillet_census_rim_600.jsonl.gz`.
> ### ⚠ THE `PIPESHELL` ROW ABOVE IS SUPERSEDED
>
> Every one of the 291 declines carried the SAME `FK_DEFER` label,
> `prof_edge_not_line`. **One label over a whole deletion bucket is not an
> attribution** — it names the precondition, not the input, and "an edge that is not
> a line" is equally consistent with "free-form blobs no bounded engine will sweep"
> and with "rounded outlines". `test/pipeshell_defer_census.cpp` reproduces the A/B's
> own input (same face pick, same outer wire, same spine) and names every edge's
> curve type:
>
> | count | the profile's outer boundary | closes into a planar face |
> |---:|---|---:|
> | 141 | LINES AND CIRCULAR ARCS (mean 10.3 edges) | 141/141 |
> | 106 | contains B-SPLINE edges (mean 31.7 edges) | 106/106 |
> | 44 | a SINGLE full circle (1 edge) | 44/44 |
>
> **291/291 close into a planar face**, so the bucket was never "sections that are
> not planar regions" — it was `polygonRing()` reading VERTICES. The mitre plane
> bisects the two legs, so the reflection in it maps one leg's direction to minus the
> other's and fixes the plane pointwise; an infinite prism is its section swept in
> both senses, so each leg's prism is a RIGID MOTION of the first and a rigid motion
> carries a circle to a circle and a B-spline to a congruent B-spline. Nothing is
> fitted and nothing is tessellated. Implemented as
> `src/native/brep/NativeLoftPipe.cpp::sweepFaceMitre`. Re-measured over the same 600
> parts, stride 1, 0 part-level errors, with THRUSECTIONS and FILLING carried as
> controls (both unmoved, 258 and 0 deleted exactly as before):
>
> | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | delta (95% CI) | McNemar p | verdict |
> |---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
> | PIPESHELL (re-measured) | 600 | 599 | 0 | **1** | 0 | 99.8% | 100.0% | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
>
> **The flip gate is still FAIL, missed by exactly one part.** The rule is the gate's
> own words, `native % >= occt %`; a CI that straddles zero is a different statement
> and is not made here. The one part is `ho1190`, an 8-edge all-B-spline outline
> whose volume misses its closed form by 1.46e-6 against a 1e-6 gate — the maximum of
> the whole 291-part deviation distribution (p50 1.5e-10, p99 1.4e-7), left declined
> rather than tuned away.
>
> **The added coverage is checked by an oracle that is not the engine's own closed
> form.** OCCT's default transition mode does not carry the section through the
> corner, so on this harness's equal-leg 30-degree spine `native / OCCT-default` must
> equal `2/(1+cos 30) = 1.0717967697` for every part whatever its section. Measured
> per class: `LINE_ONLY` 1.0717967697 (the already-proven control), `LINE_ARC`
> 1.0717967697, `HAS_BSPLINE` 1.0717967696, `ARC_ONLY` 1.0717967601. Of the 273 rows
> that do not match OCCT(`RightCorner`) on the full observable vector, **243 differ
> only in face counts or in the VERTEX-DERIVED bbox of a tube** — volume, area and
> centre of mass all agree, and OCCT is valid on all 243 — and **all 30 that differ
> geometrically are rows where OCCT's own arm is `BRepCheck`-INVALID** (native is
> valid on 599/599, OCCT(`RightCorner`) on 567/598). Artefacts, the census, the
> oracle-ratio distribution and the independent check script:
> `reports/corpus_ab/pipeshell_defer_audit/`.

### 3.1 The headline

**One family of ten passes the flip gate. `FORGE_FILLING_DROP_NATIVE` is the only
option this measurement clears, and it clears it perfectly:** 407 parts where both
engines built, 193 where neither did, **zero discordant pairs in 600 trials**, and
all 407 shared successes agree on the entire observable vector — volume, area,
centroid, all six bbox bounds, and every face/edge/vertex/shell/solid count. That
is not "not significantly worse"; the two engines made the same call on every
single part.

**The other nine fail, all with p < 1e-5.** These are not underpowered ties. The
deletion counts are large and the intervals are tight, which is the useful part:
each `OCCT only` cell is a count of real parts on which flipping that option turns
a working operation into a thrown error.

### 3.2 What each failure actually says

- **`PIPE` 598/600 and `THRUSECTIONS` 567/600 deleted.** Both native engines are
  documented as polygon-section / polyline-spine only, and this corpus's faces are
  overwhelmingly not polygons. The measurement agrees with the headers — it just
  puts a number on it. These are the two furthest from shippable.

  > **⚠ HALF OF THIS PARAGRAPH IS RETRACTED, AND IT IS THE MOST INSTRUCTIVE ERROR
  > IN THIS DOCUMENT.** "This corpus's faces are overwhelmingly not polygons" was
  > inferred from the zero, never measured. A per-part defer census
  > (`test/run_thrusections_defer_census.sh`, 600 rows in
  > `reports/corpus_ab/thrusections_defer_census_600.tsv`) measures the opposite:
  >
  > | first binding precondition | parts |
  > |---|---:|
  > | lateral quad non-planar under the raw index pairing | **309** |
  > | a section wire carries a non-line edge (circle 232 parts, B-spline 106) | 291 |
  >
  > The corpus is **51.5% polygonal** for this derivation — 309 parts present two
  > 4-vertex, all-line-edge sections — and on **every one of the 309** a
  > correspondence exists under which all four lateral quads are planar (measured
  > as the minimum over every rotation × reflection of the second ring, before
  > any code was changed). Those 309 were declined for a reason *inside the
  > engine*. Only the 291 curved-section parts were ever a scope statement.
  >
  > **The transferable lesson.** A success rate cannot distinguish "the corpus has
  > nothing this engine covers" from "the engine has a defect on the corpus's most
  > common input" — the two produce the same number. The zero was read as the
  > first because the header made it plausible. A family scoring *exactly* zero is
  > the case where that inference is least safe and a per-part cause census is
  > cheapest: it cost one afternoon and moved the row 51.5 points. Do the census
  > before quoting a zero as a capability bound. `PIPE` (0.3%) and `DRAFT` (0.0%)
  > have **not** had one and their explanations above are, as of now, the same
  > kind of unmeasured inference.
- **`DRAFT` 497/565 deleted, native 0/565.** `NativeDraft` declines any solid with
  a non-planar face, and essentially every part in this corpus has one. The engine
  is correct on what it accepts (its A/B proves that) and accepts almost nothing
  here.
- **`PIPESHELL` 291/600 deleted, but 309 built.** The best-covered of the sweep
  family, and the only one within sight of the gate.

  > **⚠ SUPERSEDED — 291 became 1 and 51.5% became 99.8%.** See the supersede block
  > after the table and `reports/corpus_ab/pipeshell_defer_audit/`. The transferable
  > lesson is the one `PIPE` recorded in its other direction: a deletion bucket in
  > which every part carries the SAME defer label is not yet attributed, because the
  > label names the precondition and not the input. Censusing the input is what
  > separated "sections no bounded engine can sweep" from "sections whose boundary
  > happens to be curved", and those call for opposite engineering.
- **`THICKSOLID` 126 deleted on a 22.2% OCCT baseline.** Note the baseline: OCCT
  itself only manages 133/600 here. The native engine's 7 is still far behind, but
  this family is hard for both.

  > **⚠ ATTRIBUTED 2026-08-30, and "hard for both" understates it in one direction
  > and overstates it in another.** Full per-part census in
  > `reports/corpus_ab/THICKSOLID_ATTRIBUTION.md`; the two findings that change how
  > this row should be read:
  >
  > **All 126 of the deletion bucket have ONE cause, and it is not NURBS.** The
  > 593 native deferrals split two ways and only two: 370 on a single line of the
  > quadric path — a PLANAR face is admissible only if every one of its wires is
  > exactly one full circle — and 223 on an unsupported surface type. The
  > deletion bucket is **126/126 in the first group and 0/126 in the second**. The
  > NURBS parts cost the ledger nothing, because OCCT declines every one of them
  > too. The corpus is polygonal plates with cylindrical holes, not curved parts:
  > 377/600 are wholly analytic and **0/600 are all-planar**, so `planarThickSolid`
  > is dead code here and every deferral is the quadric path's.
  >
  > **Every one of OCCT's 133 successes is an INVALID solid** — `BRepCheck_Analyzer`
  > 0/133 — on a corpus whose 600 source solids are valid 600/600, and six of them
  > have MORE volume than the body they hollowed. This is the only family of the
  > eleven measured where every success on both arms fails validity; the same
  > harness on the same run reports OCCT valid 600/600 on `PIPE` and 455/461 on
  > `FILLET`. **The flip gate counts `IsDone()`, so it cannot see this.** Nothing
  > here argues for flipping the option — it argues against reading this row's
  > 22.2% as capability.
  >
  > Three exact fixes followed the census (polygon planar wires; the coplanar face
  > split and its cylindrical riser; rank-deficient polygon corners), each gated by
  > closed forms in `test/thicksolid_mixed_closedform.cpp` and one of them
  > mutation-proved. **They moved the row by one part**, 7 → 8 and 126 → 125, and
  > the census says why: 195 of the parts they unblocked are two-lump bodies that
  > sew into two shells — and all 271 multi-lump parts in the corpus are `NEITHER`,
  > so finishing them would move the deletion bucket by zero — while the 20
  > remaining reachable deletion-bucket parts hit a genuine topology change, their
  > offset hole loops merging (measured: seven holes grow to `sum(Rh^2) = 469.2`
  > against an offset outer `Ro^2 = 459.7`, so they can no longer fit). Re-measured
  > over the same 600 parts, stride 1, 0 part-level errors:
  >
  > | family | N | both | nat only | **OCCT only** | neither | nat % | occt % | McNemar p | verdict |
  > |---|---:|---:|---:|---:|---:|---:|---:|---:|---|
  > | THICKSOLID (re-measured) | 600 | 8 | 0 | **125** | 467 | 1.3% | 22.2% | 4.7e-38 | FAIL |
  > | `OFFSETSHAPE` (CONTROL, same file, unchanged) | 600 | 0 | 7 | **38** | 555 | 1.2% | 6.3% | 3.1e-6 | FAIL |
  >
  > Every part moved in exactly one way: one `OCCT_ONLY -> BOTH_OK`, 599 unmoved.
  > The `OFFSETSHAPE` control shares this file and four of its helpers and
  > reproduces the baseline cell for cell. Artefacts:
  > `reports/corpus_ab/thicksolid_mixed_600_{summary.md,results.jsonl.gz,manifest.json}`,
  > input census in `reports/corpus_ab/thicksolid_input_census_600.jsonl.gz`.
- **`OFFSETSHAPE` has the weakest OCCT baseline of all, 6.3%** — and the OCCT arm
  **CRASHED on 66 parts**. Without the per-arm fork those 66 SIGSEGVs would have
  killed the harness process, and a harness that dies produces silence, which reads
  exactly like a clean zero. This family also has the only `NATIVE_ONLY` majority:
  7 native successes against 0 shared, i.e. the native engine answers a set OCCT
  does not.

  > ### ⚠ BOTH THICKSOLID ROWS HAVE NOW HAD THE CENSUS THIS SECTION ASKS FOR
  >
  > Taking this document's own advice — do the per-part cause census before
  > quoting a rate as a capability bound — `test/run_tkoffset_gh_defer_census.sh`
  > measures the FIRST BINDING PRECONDITION for families G and H over the same
  > 600 parts (600 rows, 0 control violations, verdicts matching this baseline on
  > all 1,200 pairs). Full write-up in `reports/TKOFFSET_GH_DEFER_CENSUS.md`;
  > raw rows in `reports/corpus_ab/tkoffset_gh_defer_census_600.tsv`. Three
  > corrections to the two paragraphs above:
  >
  > 1. **"Hard for both" understates it for THICKSOLID: OCCT's 133 successes are
  >    0/133 `BRepCheck_Analyzer`-VALID.** This table already says so
  >    ("valid results: native 0, OCCT 0") and the 22.2% was quoted as a baseline
  >    anyway. On re-measurement 18 of 87 have a volume above 90% of the source
  >    solid — barely hollowed. OCCT is not a working incumbent for family G.
  > 2. **The gap is ONE rule, not a NURBS gap.** All **126/126** THICKSOLID
  >    deletion-bucket parts, and **33 of 38** OFFSETSHAPE ones, are declined at
  >    `S2_planar_wire_edge_not_full_circle` — the mixed polygon+quadric planar
  >    face. All **133/133** of OCCT's THICKSOLID successes are on parts entirely
  >    inside the native engine's surface-type scope. **But lifting that one rule
  >    frees ZERO parts** — measured, with the rule suppressed in the ladder: 200
  >    of the 370 then bind at `S3_edge_not_full_circle`, because step 3 re-trims
  >    circle edges only and a prismatic body's edges are lines. The mixed planar
  >    FACE and the mixed planar EDGE are one increment, and its ceiling is
  >    **207/600 (34.5%)**, not the 39.8% the first-binding rung alone suggests.
  >    Still above OCCT's 22.2%.
  > 3. **The 7 native successes were seven INVALID solids** (one
  >    `IntersectingWires` face each: on ho1041 a hole reaching 4.47 mm past its
  >    own rim, because the wall exceeded the local feature size). The engine's
  >    area and volume self-checks are identities in the radii and are blind to
  >    containment — the face's area matched its closed form to 2e-7 relative.
  >    Fixed by `circlesNest` in `src/native/brep/NativeThickSolid.cpp`, gated by
  >    `test/run_thicksolid_nesting_gate.sh` (proved to fail against the pre-fix
  >    engine). **THICKSOLID native is now an honest 0.0%, not 1.2%**, and the
  >    deletion bucket is 133/600. OFFSETSHAPE is unchanged at 7 — the guard fires
  >    on every wrong answer and on nothing else.
- **`MAKEOFFSET` is the closest miss: 94.5% against 99.0%, 27 parts deleted.** The
  `CMakeLists.txt:432` note records a 2026-07-31 measurement of 17/382 (4.5%) lost;
  this measures 27/600 (4.5%) on a different corpus. The two agree to the decimal.
- **`FILLET` 315 deleted, native 32.8%.** See §3.4 — this number moved sharply
  between two commits and should be read with that in mind.

  > **⚠ SUPERSEDED TWICE — 315 became 117 (both cells were engine defects), and 117
  > then became 59 when the residue was attributed by what the parts ARE rather than
  > which guard fired.** See the two supersede blocks after the table,
  > `reports/corpus_ab/FILLET_ATTRIBUTION.md` and
  > `reports/corpus_ab/FILLET_RIM_ATTRIBUTION.md`. The transferable half is the same
  > lesson §3.2 already records for `THRUSECTIONS`, now in its other direction: a
  > `NATIVE_ONLY` cell cannot distinguish "a capability OCCT lacks" from "the engine
  > returned the input unchanged and the success predicate accepted it". A cell that
  > is a win over a reference implementation is exactly where that inference is
  > least safe, and a per-part cause census is the cheapest way to settle it.

### 3.3 Two findings that are not about coverage

These fall out of running both arms and are recorded because they are cheap to
observe and expensive to discover later. Neither is adjudicated here; both need
their own controlled follow-up.

1. **OCCT's thicken returns a negatively-oriented solid on all 407 shared
   successes.** `THICKEN` is the one family where every `BOTH_OK` pair disagrees on
   signed volume (407/407) and every pair agrees on |volume| (407/407), with
   centroid, bbox, area and all five topology counts identical. On the first part
   examined by hand the native engine returned +114690.606 and OCCT −114690.606.
   `src/Features.cpp:1219` registers `mk.Shape()` unmodified, so `part::thickenSurface`
   is handing the registry a reversed solid on every one of these parts today. The
   native engine is the one returning the conventional sign.
2. **`PIPESHELL` and OCCT disagree geometrically on all 309 shared successes** —
   not on orientation, on volume and extent. `NativeLoftPipe.hpp` already records
   the mechanism (OCCT's `MakePipeShell` mitre transport differs from the native
   rigid mitre, and OCCT's own answer is invalid on a bent spine in the recorded
   case). This measurement says it is not an edge case: it is every part.

The `agree` column elsewhere mixes genuine geometric differences with merely
**representational** ones — `MAKEOFFSET`'s 258 disagreements are largely the native
engine's segmented round joins against OCCT's true `GeomAbs_Arc` arcs, which change
edge counts and length without either being wrong. Do not read that column as a
defect count.

### 3.4 A warning the harness itself produced

`FILLET`'s native rate is **32.8%** at `a70dd1da`. An earlier full-corpus run of
the same harness over the same corpus, built from `876b179a`, measured **65.8%**.
The difference is `NativeFilletChamfer.cpp`, which is 184 lines longer at
`a70dd1da`; over the same 600 parts its `BOTH_OK` disagreements with OCCT fell from
258 to 60 while its agreements stayed at 86. The newer engine appears to have
**traded coverage for correctness** — declining ~200 cases it previously answered
differently from OCCT.

That earlier run's artifacts are **not** committed: it was built from one commit
and measured after the worktree had moved to another, which is exactly the mistake
the build stamp in §4 now makes impossible. The comparison above is stated as an
observation worth a controlled A/B between those two commits, not as a result.

> **RESOLVED 2026-08-30, and the guess above was wrong in an instructive way.** The
> "traded coverage for correctness" reading assumed the ~200 newly-declined cases
> were cases the newer engine had decided it should not answer. A per-part census
> says they were 198 two-lump bodies whose second lump `sewToSolid` was discarding,
> caught by the volume self-check the newer engine had just gained. The newer engine
> did not trade coverage away — it acquired a check that exposed a defect the older
> one shipped as a wrong answer. With the defect fixed the same engine measures
> **57.3%**, above both recorded numbers, and every one of its 344 successes moves
> exactly the closed-form volume (`|dV|/(1-pi/4)R^2 L = 1.000000`, min = max, 344/344).
> `reports/corpus_ab/FILLET_ATTRIBUTION.md`.

---

### 3.5 BEFORE / AFTER under the five terms (2026-09-03)

Full detail, with the failure-class decomposition and the proofs, is in
`reports/corpus_ab/FLIP_GATE_REPLACEABILITY_2026-09-03.md`. Both columns below come from
**one** corpus run at `9f309b52` (600 parts, 7,796 rows, 0 part-level failures) aggregated
twice: BEFORE with `corpus_ab_aggregate.mjs` exactly as it stands at `26db603e`, AFTER
with the five terms. **The denominators are not merely comparable, they are the same
rows.** A clean-tree BEFORE run at `26db603e` reproduces the BEFORE column family for
family.

| option | N | nat % | occt % | BEFORE (coverage only) | AFTER (five terms) | failing terms |
|---|---:|---:|---:|---|---|---|
| `FORGE_FILLET_DROP_NATIVE` | 600 | 67.2% | 76.8% | FAIL | **FAIL** | coverage, validity, agreement, replaceability |
| `FORGE_OFFSET_DROP_MAKEOFFSET` | 600 | 100.0% | 99.0% | PASS | **FAIL** | agreement, replaceability |
| `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 0.0% | 22.0% | FAIL | **FAIL** | coverage |
| `FORGE_OFFSETSHAPE_DROP_NATIVE` | 600 | 4.0% | 6.3% | FAIL | **FAIL** | coverage, replaceability |
| `FORGE_THRUSECTIONS_DROP_NATIVE` | 600 | 83.0% | 94.5% | FAIL | **FAIL** | coverage, validity, agreement, replaceability |
| `FORGE_PIPE_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | agreement, replaceability |
| `FORGE_PIPESHELL_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | agreement, replaceability |
| `FORGE_FILLING_DROP_NATIVE` | 600 | 67.8% | 67.8% | PASS | **FAIL** | agreement, replaceability |
| `FORGE_THICKEN_DROP_NATIVE` | 600 | 100.0% | 100.0% | PASS | **FAIL** | agreement, replaceability |
| `FORGE_DRAFT_DROP_NATIVE` | 565 | 0.0% | 88.0% | FAIL | **FAIL** | coverage, validity, replaceability |

**Five of the ten drop options passed the coverage gate; none passes the five-term gate.**
The four that changed are not marginal: PIPE and PIPESHELL differ from OCCT on 600 of 600
parts at a constant volume ratio 2/(1+cos 30°); THICKEN differs on 600 of 600 by exactly
one sign bit on the solid (595 agree up to orientation); FILLING and MAKEOFFSET differ on
407 of 407 and 285 of 594 respectively. **That is the finding, and it is not a
regression** — the geometry was always like this and the verdict could not see it.

And the bar the failing families are held to is not what it looked like either:

| option | OCCT ok | of which INVALID | valid bar | native ok | native ok+valid | deficit vs the valid bar |
|---|---:|---:|---:|---:|---:|---:|
| `FORGE_THICKSOLID_DROP_NATIVE` | 132 | **132** | **0** | 0 | 0 | 0 |
| `FORGE_OFFSETSHAPE_DROP_NATIVE` | 38 | **33** | **5** | 24 | 24 | 5 |
| `FORGE_DRAFT_DROP_NATIVE` | 497 | 52 | 445 | 0 | 0 | 445 |
| `FORGE_FILLET_DROP_NATIVE` | 461 | 6 | 455 | 403 | 312 | 202 |

> **⚠ THE FILLET ROWS OF BOTH TABLES ARE SUPERSEDED, 2026-09-04.** They are the run at
> `9f309b52` and stay as its record. Since the minimum-clearance setback guard the FILLET
> row reads `600 | 52.0% | 76.8% | FAIL | FAIL | coverage, validity, agreement,
> replaceability` and the replaceability row reads `461 | 6 | 455 | 312 | 312 | 202` —
> native ok 403 -> 312, native INVALID 91 -> 0, and **the deficit against the valid bar
> unchanged at 202**, because every answer the guard deletes was one `BRepCheck` rejected.
> The verdict and every failing term are the same before and after; nothing was flipped.
> CHAMFER moves the same way (344 -> 253 answered, 91 -> 0 invalid, deficit 171 unchanged).

THICKSOLID's entire 132-answer baseline fails `BRepCheck`, so its valid bar is zero — and
its coverage bar is not even stable run to run: `MakeThickSolidByJoin` returned `OK` on
`ho317` in one 600-part run and SIGSEGV'd on it in the next, with the same binary
returning `OK` five times out of five on re-run. OFFSETSHAPE's 24 native answers are all
valid and comfortably exceed its valid bar of 5, yet it reproduces **none** of those 5,
because it declines on exactly those parts. **Neither observation is a licence to flip an
option**, and none was flipped: the coverage bar is still term 1 and both families still
fail it.

---

## 4. How to run it

```sh
cd forge-kernel

# build + containment self-test + eleven per-family native controls
test/build_corpus_ab_coverage.sh

# a quick 20-part stride sample
test/run_corpus_ab_coverage.sh 20

# the full corpus (the committed baseline)
test/run_corpus_ab_coverage.sh all

# one part, all families, straight to stdout as JSONL
.build-corpus-ab/corpus_ab_coverage /path/to/part.step --arm-timeout=20

# one family only
FAMILIES=THICKSOLID,OFFSETSHAPE test/run_corpus_ab_coverage.sh 100

# re-aggregate an existing results file
node test/corpus_ab_aggregate.mjs <results.jsonl> --md out.md --json out.json
```

Environment: `CORPUS=<dir>` (default is the 600 expert3d v5cap e600 gold reference
solids), `ARM_TIMEOUT` (default 20 s per arm), `PART_TIMEOUT` (default 300 s per
part, enforced by the binary's own `alarm()`), `OFFSET`, `FAMILIES`, `JOBS`,
`FORCE=1` to wipe the object cache.

**The run is pinned to the tree the binary was compiled from — by two checks, and
both have been seen to fire.** The build writes `.build-corpus-ab/build_stamp.json`
with the git HEAD it compiled at and how many files under `src`/`include`/`test`
were dirty; the driver copies that into every manifest.

- **Check 1, before the run:** the stamp's SHA against HEAD; **exit 3**.
- **Check 2, after the run:** HEAD at the end against HEAD at the start; **exit 4**,
  and an `INVALID.json` is written into the output directory.

This is not decoration. The first full-corpus run of this harness was compiled from
`876b179a` and measured after the worktree had moved to `a70dd1da`, where three of
the ten engines under test differ (`NativeFilletChamfer` +184 lines,
`NativeLoftPipe` +81, `NativeThickenShell` +39). That run was discarded. A coverage
number measured against the wrong tree is worse than no number, because it looks
exactly like a right one.

**Check 2 is the one that catches what actually happened**, and it exists because
check 1 alone did not. As first written, check 1 sat after an *unconditional*
rebuild that re-stamps with the current HEAD — so it could never disagree with it.
Poisoning the stamp and running produced **exit 0**: a guard that could not fire,
which is the same thing as no guard. Check 1 is now reachable (via `SKIP_BUILD=1`,
the only path where the stamp is not refreshed first) and check 2 was added for the
real failure mode, which no pre-run check can see: the tree moving *while* an
already-loaded binary is still producing numbers.

```sh
test/run_corpus_ab_coverage.sh --selftest-guard
#   build-SHA-vs-HEAD guard    exit 3  ok
#   head-moved-during-run gate exit 4  ok (INVALID.json written)
#   PASS: both tree guards fire
```

A guard that has never been seen to fire is indistinguishable from one that cannot,
so this is part of the harness rather than a claim in a comment.

Each run writes `results.jsonl`, `manifest.json`, `summary.md`, `summary.json`,
`corpus.list`, `sample.list` and `run.log` into its output directory.

**The harness binary is not a drop build and must never be read as one.** It is
built with **no** `FORGE_*_DROP_*` macro defined, precisely so both branches exist
and both can be called. It proves nothing about the closure or the symbol census;
`scripts/occt_closure_count.sh` and `tools/occt_symbol_census.sh` measure those.

---

## 5. Limits of this measurement — read before quoting a number

1. **The operations are derived, not observed.** No feature-tree log of "what
   operations real users ran on these parts" exists, so the harness synthesises one
   operation per part per family from the part's own geometry (§2.3). The
   distribution is deterministic and fully stated, but it is the harness's
   distribution, not a production trace. A family's number can move if the
   derivation moves.
2. **One operation per part per family.** A part contributes one paired trial, not
   one per candidate edge/face. This keeps parts independent (so the CI and the
   McNemar test are valid) at the cost of resolution within a part.
3. **`NEITHER` is not evidence about either engine.** Where the derived operation
   is geometrically unreasonable for a part, both arms fail and the row lands in
   `NEITHER`. Those rows are in the denominator (both engines had the same chance)
   but they carry no signal about the comparison; the discordant pairs do.
4. **The agreement column is not a correctness gate.** It is a free by-product of
   running both arms, reported separately from coverage. The dedicated correctness
   gates are the seven `test/run_ab_native_*.sh` harnesses.
5. **This measures the engines, not the wiring.** It calls each native engine
   directly rather than through `part::shell` / `part::loft` / etc. A call site that
   fails to route to the engine would not show up here — `test/part_features_smoke.js`
   and the per-family A/B scripts cover that.
6. **A `SUCCESS` in this table is `IsDone()`, and on THICKSOLID that predicate is
   satisfied by the function's own argument.** §2.2 states the deliberate choice
   to keep validity out of the success predicate, and that choice is still right —
   folding validity in would let the harness mark its own homework. But the
   THICKSOLID row's 22.2% has since been opened up part by part, and it contains
   **zero usable answers**: of its 133, 123 have holes in their boundary, 94
   self-intersect, 0 pass `BRepCheck`, **0 are a benign complaint**, and against an
   independent oracle that links no offset engine the median volume error is +88%.
   Six-face fixtures now pin the same thing without the corpus — split one flat
   region into two coplanar faces, remove one of them, and
   `MakeThickSolidByJoin` returns the input with `IsDone()` true and `BRepCheck`
   VALID, which this table scores `OCCT_ONLY`. That fixture set is
   `test/thicksolid_bar_fixture_gate.cpp`, ratcheted by `test/run_ab_all.sh`.
   Full measurement, including what a correct answer would take and a 14–20%
   per-part crash rate in OCCT's own measurement of its own output:
   **`reports/corpus_ab/THICKSOLID_HONEST_BAR.md`**.
