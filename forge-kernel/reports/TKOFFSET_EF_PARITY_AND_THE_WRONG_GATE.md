# TKOffset families E and F: the flip gate is comparing two different operations

**Date:** 2026-08-31 · Measured from a worktree pinned to `origin/archdisc`
(`7d92a709`, 0 ahead / 0 behind at the start of the run). Corpus A/B binary built at
that SHA with 0 dirty files in `src`/`include`/`test`; every corpus number below comes
from a single binary and a single tree.

> **Closure did not move, and it could not have.** `CMakeLists.txt:1053-1081` removes
> TKOffset from `OCCT_LIBS` only when all nine families A,C,D,E,F,G,H,I,J are compiled
> out, and seven of the nine fail their flip gate at this commit. No option was flipped
> and no toolkit was retired; the whole diff lives under `test/`, `tools/` and
> `reports/`, none of it a compiled kernel source, so the binary is byte-identical and
> its load graph cannot differ.
>
> **Measured, from this tree, at `-j2` after a memory check:**
> `OCCT_DIRECT = 9 · OCCT_CLOSURE = 14 · OCCT_PHANTOM = 2`, before and after. The full
> verbatim output is in §6. This report is distance travelled toward the drop and is
> scored as nothing else.

---

## 0. Headline

The programme's ledger records families **E (PIPE)** and **F (PIPESHELL)** at
**99.8% native vs 100.0% OCCT, a deletion bucket of ONE part** — by a wide margin the
closest any TKOffset family has come to parity, and the obvious place to push.

Re-measured at HEAD over all 600 parts, that reading is confirmed to the digit and is
**not what it appears to be**. Two things are true at once:

1. **The one-part gap is a deliberate tolerance decline, not a capability gap.** The
   single part is `ho1190`, and the native engine *builds a solid for it*. It then
   rejects its own result because the volume misses its closed-form oracle by
   **1.60e-06** against a bound of **1.0e-06**. `NativeLoftPipe.cpp:1561-1566` records
   that decision and refuses to tune it: *"a tolerance widened until the last part fits
   is not a tolerance."* That judgement is correct and this report does not overturn it.

2. **The two arms the gate compares are computing different operations, on 100% of the
   corpus.** Over the 599 parts where both build:

   ```
   E PIPE       native_vol / occt_vol   min 1.071797   p50 1.071797   max 1.071797
   F PIPESHELL  native_vol / occt_vol   min 1.055405   p50 1.071797   max 1.097498
   ```

   and `2 / (1 + cos 30°) = 1.071797`. The A/B's spine turns by 30°; native implements
   the MITRE, OCCT's default `BRepBuilderAPI_Transformed` does not carry the section
   through the corner. **`agree` is 0 out of 599, for both families.**

   For **E the ratio is a constant to six decimals** — min, median and max identical —
   so `MakePipe`'s answer is the transformed-transition law *exactly*, on every part.
   For **F it is not constant**: the median is the same figure but the spread runs
   1.0554–1.0975, so the cosine law is `MakePipeShell`'s central tendency and not its
   identity. That distinction is stated because the constant is a much stronger claim
   than the spread, and only E earns it.

   The gate reads "one part short of parity" while the two arms disagree on every single
   part — because it only counts *whether an arm returned a shape*.

   **Prior art, and what is new.** `CMakeLists.txt:800-804` already records for F that
   "on ALL 309 parts where F and OCCT both build, the two solids DISAGREE on volume and
   extent". That finding stands and is not being re-discovered. New here: the same is
   now true of **E**, which had no such record; coverage has grown 309 → 599 so the
   disagreement is measured on twice the corpus; the E ratio is shown to be a **single
   exact law** rather than an observed difference; and §3 measures which arm is right.

**When OCCT is asked for the same operation the native engine implements
(`SetTransitionMode(RightCorner)`), the native arm already wins**, and it is the OCCT
arm that produces broken geometry — see §3.

---

## 1. The measurement, at HEAD

`test/run_corpus_ab_coverage.sh all`, families PIPE and PIPESHELL, stride 1 (every part,
never a prefix), 600 parts, 1800 rows, **0 part-level failures**.

| family | N | both | nat only | **OCCT only** | native | occt | **agree** | delta (95% CI) | McNemar p | verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| E PIPE | 600 | 599 | 0 | **1** | 99.8% | 100.0% | **0/599 (0.0%)** | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
| F PIPESHELL | 600 | 599 | 0 | **1** | 99.8% | 100.0% | **0/599 (0.0%)** | -0.2% [-0.5, 0.2] | 1.0000 | FAIL |
| F PIPESHELL_RC | 600 | 597 | **2** | 1 | 99.8% | 99.7% | 325/597 (54.4%) | +0.2% [-0.4, 0.7] | 1.0000 | **PASS** |

The deletion bucket is the same single part in all three rows: **`ho1190`**.

**The gate is simultaneously underpowered on what it measures and blind to what
matters.** The FAIL for E and F is decided by a *single* discordant pair: McNemar
**p = 1.0000**, and the 95% CI on the difference, **[-0.5%, +0.2%]**, straddles zero. On
its own terms the A/B cannot distinguish the two arms at n=600. Meanwhile the agree
column — which the verdict does not read — says they differ on **every one of the 599
parts they both build**. The one number the gate is confident about is the one that is
not true, and the number it is not confident about is the one it acts on.

The `agree` column is new in this change set (`test/corpus_ab_aggregate.mjs`); the
quantity was already computed and reported in the per-family detail, but never on the
row that carries the verdict. No verdict logic was touched.

This settles the question that prompted the work: PIPESHELL was on record at both 99.8%
and 82.3% from two different SHAs, and the brief asked for a re-measurement at HEAD
rather than a choice between them. **Measured here: 99.8%, deletion bucket 1.**

On where 82.3% came from, the credit is PR #154's and not this report's: it found the
figure was the *committed ledger row for family **E***, which "inherited the PIPESHELL
mitre transport at the merge and had never been measured to completion". This run is
consistent with that — **E and F both measure 99.8 / 1 at HEAD**, independently and on
the full corpus.

## 2. `ho1190`, the entire deletion bucket

Measured directly with the engine's own `FORGE_GEN_ORACLE_REPORT` channel:

```
gen_oracle rel=1.60118e-06  actual=1977962.14755  expected=1977958.98048
native note: prof_edge_not_line|holes_wire_neither_poly_nor_circle|circ_not_circle
             |arc_edge_not_line_or_circle|gen_volume_oracle
```

The native engine builds a solid whose volume is within **1.6 parts per million** of the
exact closed form and declines it, because its oracle is set at 1.0e-06. The part is an
8-edge all-B-spline outline; the residual is OCCT's boolean re-approximating the mitre
section curve, which is why a straight spine measures exactly 0.

**Correction to the record.** `NativeLoftPipe.cpp:1564` records this part at `1.46e-6`.
At HEAD it measures **1.60118e-06**. Both are above the bound, so the decline stands and
nothing about the verdict changes — but the number in the comment is from an earlier SHA
and has drifted. A number in a comment is not a measurement.

**This is the only thing standing between families E and F and a green coverage gate.**
It is one part, and closing it means either widening a tolerance the programme has
already refused to widen once, or reducing OCCT's own boolean error. Neither is a
bounded engine fix, and the first is forbidden.

## 3. What the gate cannot see

`PIPESHELL_RC` is the same native arm against the same OCCT call with one line added —
`SetTransitionMode(BRepBuilderAPI_RightCorner)`, which asks OCCT for the mitre the native
engine implements. Over the 597 parts where both build:

| | count |
|---|---:|
| native BRepCheck_Analyzer **VALID** | **597 / 597** |
| OCCT BRepCheck_Analyzer **VALID** | 567 / 597 — **30 INVALID** |
| OCCT threw where native built | **2** (`ho1084`, `ho684`) |
| agree outright | 325 |
| OCCT-valid but disagree | 242 — **volume equal to 1e-6 on 242 / 242** |

So on the operation both engines are actually trying to compute:

* their **volumes agree on 567 of 567** OCCT-valid pairs;
* the residual disagreement is **topology only** (same solid, different face count — the
  face counts match on just 44 of the 242);
* **native returns zero invalid solids and zero throws; OCCT returns 30 and 2.**

The coverage flip gate scores all 30 of those invalid OCCT solids as OCCT successes,
because `IsDone()` is true and a shape came back.

## 4. The consequence for the drop, stated precisely

`src/Features.cpp:730` — the production `forge.part.sweep` call site — constructs
`BRepOffsetAPI_MakePipeShell`, calls `Add`/`Build`/`MakeSolid`, and **never calls
`SetTransitionMode`**, so it runs OCCT's default `Transformed`.

The native path directly above it is gated on `pipeShellNativeEnabled()`, which is
`envOn("FORGE_PIPESHELL_NATIVE")` and **OFF by default**
(`NativeLoftPipe.cpp:633-641`). So there is **no inconsistency in the product today** —
every shipped sweep is OCCT's `Transformed` result. This report checked that rather than
inferring it.

What flipping `FORGE_PIPESHELL_DROP_NATIVE` would do is make the native mitre the *only*
path. Measured: that changes the enclosed volume of every sweep by the constant factor
**1.071797** on all 599 corpus parts, silently — no error, no defer, both arms "OK".
**The flip gate is structurally incapable of reporting that**, because it compares
coverage and the geometry difference is not a coverage event.

This is the owner's constraint pointing the same way: REPRESENT / REPAIR / TOLERATE,
never refuse. A drop that silently changes every existing sweep by 7.2% is not a
tolerated representation, and the gate that would have waved it through is measuring the
wrong quantity.

**The honest recommendation for E and F is therefore not "close the last part".** It is
to settle the transition convention first, and only then ask about coverage.

To be fair to OCCT: `Transformed` is a documented mode, not a bug, and this report does
not call its answer wrong. What can be said from measurement is narrower and enough:

* a **constant-cross-section** sweep — which is what `forge.part.sweep` and the mitre
  both mean, and what `RightCorner` asks OCCT for — encloses `A x (spine length)`, and
  the native engine hits that closed form on the corpus (§5, and the `--selftest`
  straight-spine control pins the oracle itself);
* under `Transformed` OCCT encloses less, by a cosine, because the section is not
  carried through the corner;
* when OCCT is asked for the **same** operation, native is BRepCheck-valid on 597/597
  where OCCT is valid on 567/597 and throws on 2 more.

So the choice is a product decision about what `sweep` means, not a race to one part.
Once it is made, the flip gate needs an **agreement term**; a coverage-only gate cannot
represent a convention change at all, which is why it read 99.8-vs-100.0 on a pair of
arms that agree on nothing. The `agree` column added here is the smallest honest step:
it puts the fact on the row that carries the verdict without changing the verdict.

## 5. Is OCCT an oracle here at all?

`NativeLoftPipe.cpp:1130-1133` states that on a bent spine OCCT "returns a shape whose
volume is only the FIRST leg's contribution", or is invalid. `test/pipe_closed_form_probe.cpp`
(pure OCCT, links no forge object) tests that on the harness's own 30° spine:

```
straight spine: occt vol=2500          closed form=2500  rel=0.000e+00  valid=1
bent spine    : occt vol=4665.063509   closed form=5000  rel=6.699e-02  valid=1
first-leg-only would be 2500                                    (rel 5.000e-01)
A*(L1 + L2*cos 30) = 4665.063509                                 rel 1.950e-16
```

**The engine note generalises a special case.** OCCT is not truncating the second leg
and the result is not invalid: it is failing to carry the section through the corner,
and the shortfall is a **cosine**. The note reads as it does because every synthetic
spine in `test/ab_native_loftpipe_occt.cpp` turns by 90°, and `cos 90° = 0` — at which
point `A*(L1 + L2*cos θ)` *is* first-leg-only. One law explains both observations.

The probe's `--selftest` is a positive control in both directions: OCCT must MATCH the
closed form on a straight spine (if it does not, the probe — not OCCT — is broken, and
the build fails before any corpus number exists) and must be able to MISS on the bent
one.

### The same law, over all 600 corpus parts

`test/run_pipe_closed_form_probe.sh`, 600 parts, **0 errors, 0 not-applicable**, and the
fold test says the oracle applies everywhere (`fold_free` **600 / 600**), so nothing is
excluded:

| OCCT `MakePipe` volume fits … | parts | of 600 |
|---|---:|---:|
| the MITRE closed form `A*(L1+L2)` | **0** | 0.0% |
| the TRANSFORMED form `A*(L1+L2*cos30)` | **600** | **100.0%** |
| FIRST LEG ONLY `A*L1` | **0** | 0.0% |
| none of the three | 0 | 0.0% |

```
OCCT residual vs TRANSFORMED : min 0.000e+00 · median 7.318e-16 · max 6.726e-09
OCCT residual vs MITRE       : min 6.699e-02 · median 6.699e-02 · max 6.699e-02
OCCT BRepCheck_Analyzer      : valid 600 · invalid 0 · threw 0
```

**OCCT obeys the transformed-transition law at machine precision on every part, and the
first-leg-only reading is 0 for 600.** The threshold is not doing the work: MITRE fits 0
parts at *every* tolerance from 1e-9 to 1e-2, while TRANSFORMED fits 578 at 1e-9 and 600
from 1e-7 outward. And **OCCT is BRepCheck-valid on all 600** — so the note's other
clause, that OCCT "fails `BRepCheck_Analyzer` outright" on a bent spine, is also not what
this corpus shows.

Joining the A/B's own recorded volumes onto the same parts (neither engine re-run):

| family | arm | fits MITRE | fits TRANSFORMED | n |
|---|---|---:|---:|---:|
| E PIPE | **native** | **599 (100.0%)** | 0 | 599 |
| E PIPE | occt | 0 | **600 (100.0%)** | 600 |
| F PIPESHELL | native | 19 (3.2%) | 0 | 599 |
| F PIPESHELL | occt | 0 | 19 (3.2%) | 600 |

**For family E both engines are exact — at different operations.** Native computes
`A*(L1+L2)` on 599 of 599; OCCT computes `A*(L1+L2*cos30)` on 600 of 600. Neither is
approximating; they disagree because they are answering different questions.

**Family F's 19 is not a defect, it is the oracle's own scope, and it checks out
exactly.** The harness feeds PIPESHELL the profile's outer **WIRE** where PIPE gets the
**FACE** (`corpus_ab_coverage.cpp:1303-1348`), so F sweeps a region that *includes* the
holes while `closed_form` is built from the face area, which *excludes* them. Prediction:
the only parts where the two coincide are those whose profile face has a single wire.
Measured — **19 parts have one wire, and the 19 matches are exactly those 19, with 0 of
the 581 holed parts among them.** So the closed form is a valid oracle for E and is out
of scope for F, and this report does not use it on F.

## 6. Closure

### The link-record block's own verdict at HEAD

A CMake **configure** compiles nothing, and it makes the gate say out loud where TKOffset
stands. Verbatim from `cmake -S forge-kernel -B build -DCMAKE_BUILD_TYPE=Release
-DFORGE_NATIVE_BREP=ON` at this commit:

```
-- TKOffset KEPT on the link line — still called by: FORGE_OFFSET_DROP_MAKEOFFSET;
   FORGE_FILLING_DROP_NATIVE;FORGE_THRUSECTIONS_DROP_NATIVE;FORGE_PIPE_DROP_NATIVE;
   FORGE_PIPESHELL_DROP_NATIVE;FORGE_THICKSOLID_DROP_NATIVE;FORGE_OFFSETSHAPE_DROP_NATIVE;
   FORGE_THICKEN_DROP_NATIVE;FORGE_DRAFT_DROP_NATIVE
-- FORGE_SHHEAL_DROP_NATIVE=ON — ... (TKShHealing 20 -> 12 symbols;
   OCCT_CLOSURE UNCHANGED at 14 — see reports/OCCT_CLOSURE_TRUTH.md)
```

**All nine families are open. Not one is flipped.** This is the gate reporting its own
state rather than a report asserting it, and it corroborates §9 from the other direction:
§9 proves the nine-family list is *complete*, and this proves none of the nine is *set*.

(The configure also warns that OCCT and Boost resolve from the machine-global system
prefix as `[system-fallback]` rather than the pinned local dependency plane, so the build
is "NOT reproducible on a clean machine". That is pre-existing and untouched here, but it
is a real caveat on any number taken from a local build.)

### Why the count itself cannot have moved

**`OCCT_CLOSURE` did not move, and it could not have.** The proof does not need a build:

* `FORGE_KERNEL_SOURCES` (`CMakeLists.txt:1277-1801`, 364 translation units) contains no
  `test/`, `tools/` or `reports/` entry — verified, the grep is empty;
* every file in this change set lives under `forge-kernel/test/`, `forge-kernel/tools/`
  or `forge-kernel/reports/` — `git diff --name-only origin/archdisc HEAD`. The only
  `.cpp` among them, `test/pipe_closed_form_probe.cpp`, is a standalone probe built by
  its own script and is not in any library target;
* `CMakeLists.txt` is untouched, so `OCCT_LIBS` is untouched;
* therefore `forge-kernel.node` is **byte-identical** before and after, and a binary that
  does not change cannot change its load graph.

No `FORGE_*_DROP_*` option was flipped. No toolkit was retired, so there is **no
`--assert-closure` ratchet to lower** — and worth recording separately: that ratchet
(`--assert-closure 14 --assert-direct 9`) lives on
`origin/claude/sacrosanct-execution-20260828`, **not on `archdisc`**. There is no closure
assertion in `.github/workflows/kernel-tests.yml` at the branch point this work is based
on; `grep -rn "assert-closure" .github/workflows/` is **empty** here and matches at
**line 323** of that file on the sacrosanct branch. A future drop landing on `archdisc`
would have no ratchet to trip — worth fixing before, not after, the first real drop.

### The verbatim reading, taken from this tree

The build needed one thing the plain `cmake` path does not supply: without cmake-js,
`CMAKE_JS_INC` is undefined and nothing adds the **Node C headers**, so `src/binding.cpp`
died on a missing `<node_api.h>` (node-addon-api's `napi.h` includes it, and it ships with
Node, not with the npm package). Supplying exactly that one include directory —
`-DCMAKE_JS_INC=/opt/homebrew/include/node` — fixes it. **This does not change the link
line**, which is the thing being measured: `CMAKE_JS_LIB` stays undefined, so the Darwin
branch still applies `-undefined dynamic_lookup` (checked in `link.txt`, present), and
`OCCT_LIBS` is untouched. Measuring a binary linked any other way would be measuring a
different thing, since `-undefined dynamic_lookup` is exactly what `OCCT_PHANTOM` exists to
detect.

Built `-j2` after a memory check (`swap=375M free=78%`), 364 TUs, `build rc=0`.

```
== OCCT link accounting: forge-kernel.node ==

  OCCT_DIRECT  = 9   (LC_LOAD_DYLIB/DT_NEEDED records — gameable, NOT the ledger number)
  OCCT_CLOSURE = 14   ★ libraries that actually LOAD at run time — THE LEDGER NUMBER
  OCCT_PHANTOM = 2   (closure libs whose symbols the binary CALLS with no link record)

  direct  (9): TKBRep TKernel TKFillet TKG3d TKMath TKOffset TKPrim TKShHealing TKTopAlgo
  closure (14): TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase
                TKMath TKOffset TKPrim TKShHealing TKTopAlgo

  HIDDEN — in the closure, no direct record:
    TKBO           pulled by: TKBool TKFillet TKOffset  ← CALLED DIRECTLY (32 symbols, masked)
    TKBool         pulled by: TKFillet TKOffset
    TKG2d          pulled by: TKBO TKBool TKBRep TKFillet TKG3d TKGeomAlgo TKGeomBase
                              TKOffset TKPrim TKShHealing TKTopAlgo
                              ← CALLED DIRECTLY (24 symbols, masked)
    TKGeomAlgo     pulled by: TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo
    TKGeomBase     pulled by: TKBO TKBool TKBRep TKFillet TKGeomAlgo TKOffset TKPrim
                              TKShHealing TKTopAlgo

  ⚠ 2 phantom-direct librar(ies). A drop that only converts DIRECT → PHANTOM
    leaves OCCT_CLOSURE unchanged and is worth ZERO. Rank drops by OCCT_CLOSURE.
```

**BEFORE = AFTER = `OCCT_DIRECT 9 / OCCT_CLOSURE 14 / OCCT_PHANTOM 2`.** One reading serves
both, and that is a statement about the binary rather than a shortcut: the compiled source
set is identical between `origin/archdisc` and this branch (the whole diff is `test/`,
`tools/`, `reports/`; `FORGE_KERNEL_SOURCES` has no entry in any of them; `CMakeLists.txt`
is byte-identical), so the two builds cannot differ.

This independently reproduces PR #154's `9 / 14 / 2` — measured here from a tree pinned to
`origin/archdisc`, rather than inherited.

The output also re-states the lattice from the binary's side and agrees with §8: **TKBO,
TKBool, TKG2d, TKGeomAlgo and TKGeomBase are all pulled by TKOffset**, among others. Nothing
below TKOffset can stop loading until TKOffset does.

## 7. What still blocks TKOffset

TKOffset leaves the link line only when **all nine** families are compiled out. Two pass
(A MAKEOFFSET 100.0%, C FILLING 67.8% vs 67.8%). Seven do not:

| family | native | occt | deletion bucket | why it is blocked |
|---|---:|---:|---:|---|
| D THRUSECTIONS | 83.0% | — | 69 | needs a ruled-surface engine (PR #154: 0 of 81 are splits) |
| E PIPE | 99.8% | 100.0% | **1** | one part, `gen_volume_oracle` at 1.60e-6 vs a 1e-6 bound |
| F PIPESHELL | 99.8% | 100.0% | **1** | same part; and the convention question in §4 |
| G THICKSOLID | 0.0% | — | 131 | OCCT's own result is BRepCheck **VALID on ZERO** of the 131; the gate counts `IsDone()` |
| H OFFSETSHAPE | 4.0% | — | 38 | no bounded target identified |
| I THICKEN | 96.2% | — | 23 | 21 of 23 need a ruled offset side wall (PR #154) |
| J DRAFT | 0.0% | 88.0% | 497 | p = 4.9e-150, no bounded fix; gates the whole ladder |

Per-family figures other than E and F are PR #154's, whose measurement SHA `32ee7485`
is an ancestor of HEAD with **byte-identical** `src/native`, `include/forge/native`,
`src/OcctPrimBuilder.cpp` and `test/corpus_ab_coverage.cpp` — verified with
`git diff --stat`, empty. E and F were re-measured here rather than inherited.

## 8. The lattice, re-derived independently

From the installed OCCT dylibs alone (`otool -l` over
`/opt/homebrew/opt/opencascade/lib`, no report and no forge binary in the loop):

```
TKOffset       <<< NO PARENT — droppable on its own
TKFillet       TKOffset
TKBool         TKFillet TKOffset
TKBO           TKBool TKFillet TKOffset
TKPrim         TKBO TKBool TKFillet TKOffset
TKShHealing    TKBO TKBool TKFillet TKOffset
TKTopAlgo      TKPrim TKBO TKBool TKShHealing TKFillet TKOffset
TKBRep         TKGeomAlgo TKTopAlgo TKPrim TKBO TKBool TKShHealing TKFillet TKOffset
...            (every remaining toolkit has a parent)
```

**TKOffset is the only one of the fourteen with no parent.** The rest form a chain, so
there is no second front: nothing else can be dropped first, and no amount of parallelism
changes the order. This independently confirms PR #154's headline.

## 9. A new gate: is the nine-family list complete?

`CMakeLists.txt` says of `_FORGE_TKOFFSET_FAMILIES`: *"adding one to this list is what
keeps the drop honest."* Nothing checked it. A TKOffset call site guarded by none of the
nine would survive all nine flips, and because the `.node` links `-undefined
dynamic_lookup` it would not even fail to link — TKOffset would keep loading and the drop
would register as a **phantom**, the exact failure the link-record block claims to refuse.

`tools/tkoffset_callsite_gate.py`, measured at HEAD over 926 files: 150 TKOffset
references — 101 comment-only, 13 `#include`, **36 code**. All 36 sit inside a block
controlled by one of the nine.

```
D THRUSECTIONS 11 · E PIPE 6 · F PIPESHELL 6 · G THICKSOLID 5
H OFFSETSHAPE 2 · I THICKEN 2 · J DRAFT 2 · A MAKEOFFSET 1 · C FILLING 1
```

**The list is complete at this commit.** The gate is preprocessor-aware, because file
granularity is not an answer — `src/Features.cpp` mentions seven family macros, so a
per-file check scores all 25 of its references "guarded" regardless of where they sit.
`--selftest` proves it can go RED on three mutants written to a copy of the tree: an
unguarded call, a call under a non-family macro, and a call *after* a balanced family
`#ifdef/#endif` — the last being exactly the bug a scanner that forgets to pop its
condition stack has. All three killed; the real tree stays green.

It is a call-site census, not a closure measurement, and it says so in its own output.
