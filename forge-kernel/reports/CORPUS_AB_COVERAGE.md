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

## 3. Results

See `reports/corpus_ab/summary.md` for the committed table and
`reports/corpus_ab/summary.json` for the machine-readable form. The headline is
reproduced in §4 below.

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
