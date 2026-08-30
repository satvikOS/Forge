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

### 2.3 Derivation — the input distribution, stated in full

A coverage number is only as honest as the distribution it was measured over, so the
derivation is part of the result. All picks are deterministic (no RNG); ties break on
the candidate's centroid ordered lexicographically, so a part always yields the same
operation.

| family | derived operation |
|---|---|
| `FILLET` | longest LINE edge, radius `0.05 * min bbox extent` |
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

That leaves **ten families, all ten measured**.

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

### 2.6 Ten per-family positive controls — why the zeros are believable

Some families report a native success rate of **zero**. A zero is exactly what a
mis-wired arm also produces: wrong argument order, a profile the engine never looks
at, an engine that is not in the binary at all.

So `--selftest` additionally feeds **each of the ten native engines** an input its own
header documents as in-scope — built on a 10 mm box that the native ruled loft itself
constructs, so nothing in the control depends on an OCCT modelling call — and requires
`OK` back from every one. All ten are green (`.build-corpus-ab/selftest.log`).

**A family whose control is red would make that family's corpus number a harness
result, not an engine result.** None is red.

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

---

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
| THICKSOLID | `FORGE_THICKSOLID_DROP_NATIVE` | 600 | 7 | 0 | **126** | 467 | 1.2% | 22.2% | -21.0% [-24.3, -17.7] | 2.4e-38 | FAIL |
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
- **`THICKSOLID` 126 deleted on a 22.2% OCCT baseline.** Note the baseline: OCCT
  itself only manages 133/600 here. The native engine's 7 is still far behind, but
  this family is hard for both.
- **`OFFSETSHAPE` has the weakest OCCT baseline of all, 6.3%** — and the OCCT arm
  **CRASHED on 66 parts**. Without the per-arm fork those 66 SIGSEGVs would have
  killed the harness process, and a harness that dies produces silence, which reads
  exactly like a clean zero. This family also has the only `NATIVE_ONLY` majority:
  7 native successes against 0 shared, i.e. the native engine answers a set OCCT
  does not.
- **`MAKEOFFSET` is the closest miss: 94.5% against 99.0%, 27 parts deleted.** The
  `CMakeLists.txt:432` note records a 2026-07-31 measurement of 17/382 (4.5%) lost;
  this measures 27/600 (4.5%) on a different corpus. The two agree to the decimal.
- **`FILLET` 315 deleted, native 32.8%.** See §3.4 — this number moved sharply
  between two commits and should be read with that in mind.

  > **⚠ SUPERSEDED — 315 became 117 and the 51 `NATIVE_ONLY` became 0.** Both cells
  > were engine defects; see the supersede block after the table and
  > `reports/corpus_ab/FILLET_ATTRIBUTION.md`. The transferable half is the same
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

## 4. How to run it

```sh
cd forge-kernel

# build + containment self-test + ten per-family native controls
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
