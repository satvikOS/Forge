# THICKEN's orientation flip: the native engine was right, and the A/B was measuring half the block

**Date** 2026-09-03 · **Corpus** 600 gold reference solids, stride 1, whole corpus
`/Users/account_clawteam1/archdisc-Models/runs/composite_anchor/expert3d_v5cap_e600/gold_ref_steps`
**Harness** `FAMILIES=THICKEN forge-kernel/test/run_corpus_ab_coverage.sh all` — the SAME
invocation before and after · **BEFORE tree** `ac0ca610c7606e98b72636ac3959d85ca97ff1d6` · **AFTER tree** `0e443577009a78942d3cf65860dfa9ae54289a39`

---

## 1. The one-line answer

The native thicken was **never** reversed. **OCCT's raw `BRepOffset_MakeOffset` output is**,
production had **always** normalised it, and the corpus A/B's OCCT arm was a hand-copy of only
the **first half** of the block `FORGE_THICKEN_DROP_NATIVE=ON` deletes — the
`BRepOffset_MakeOffset` call **without** the `Reverse()` that follows it. Every one of the
600 signed-volume disagreements was that missing half.

Native is **not** changed to match the incumbent.

## 2. Which convention is correct — the deciding evidence is OCCT's own classifier

`BRepClass3d_SolidClassifier`, on a point strictly **inside the wall** of the thickened plate
(the fixture is an 80x50 face skinned by t=2, so the query point sits 1 mm clear of every face):

| solid under test | signed volume | classifier says its own interior is |
|---|---:|---|
| raw `BRepOffset_MakeOffset` output | **−8000.000000** | **`TopAbs_OUT`** |
| `forge::occtthicken::thickenShell` (native) | +8000.000000 | `TopAbs_IN` |
| `forge::part::occtThickenBaseline` (the whole deleted block) | +8000.000000 | `TopAbs_IN` |
| `forge::part::thickenSurface` (production, either branch) | +8000.000000 | `TopAbs_IN` |

A solid that reports its own interior as OUTSIDE denotes the **unbounded complement** of the
plate. That is a wrong answer to a question with one right answer, not a second convention.
Three further independent reasons point the same way:

- `BRepLib::OrientClosedSolid` — OCCT's own normaliser — orients a closed shell **outward**, and
  outward normals are exactly what makes `BRepGProp::VolumeProperties` **positive**. Every OCCT
  primitive (`BRepPrimAPI_MakeBox` and friends) is positive.
- The kernel already keeps positive at six independent sites: `OcctPrimBuilder.cpp:76,106,315`
  and `NativeOcctBridge.cpp:120,296,695`.
- A real consumer breaks on negative: `SheetMetalExtended.cpp:327` `isDownstream()` tests
  `Mass() <= kEps`, which a **negative** volume PASSES, silently dropping a good solid into the
  bounding-box-centre fallback and answering from the wrong geometry.

## 3. BEFORE and AFTER, same 600, same denominator

| | BEFORE | AFTER |
|---|---|---|
| parts, both arms OK | 600 / 600 | 600 / 600 |
| BRepCheck-valid, both arms | 600 / 600 | 600 / 600 |
| **agree on the full observable vector** | **0 / 600 (0.0%)** | **595 / 600 (99.2%)** |
| agree up to orientation | 595 / 600 | 595 / 600 |
| native signed volume | **+ on 600/600** | + on 600/600 |
| OCCT-arm signed volume | **− on 600/600** | **+ on 600/600** |

### The signed-volume ratio distribution, native / OCCT

| | min | p50 | max | `|r−1|≤1e-9` | `|r+1|≤1e-9` | r > 0 | r < 0 |
|---|---:|---:|---:|---:|---:|---:|---:|
| BEFORE | −1.000000774 | **−1.000000000** | −0.999999755 | 0/600 | 556/600 | 0/600 | **600/600** |
| AFTER  | +0.999999755 | **+1.000000000** | +1.000000774 | 556/600 | 0/600 | **600/600** | 0/600 |
| AFTER, `THICKEN_RAWOCCT` | −1.000000774 | −1.000000000 | −0.999999755 | 0/600 | 556/600 | 0/600 | 600/600 |

The distribution is **the same distribution, mirrored about zero**. It is not tightened, not
re-toleranced, and no bound anywhere in the harness was touched: the 44 parts outside 1e-9 sit
at the same `BRepGProp` summation-order noise before and after (all 600 are inside 1e-6 in both
runs). **Only the sign moved.**

### The native arm is bit-for-bit untouched by this change

Compared part by part across all 600 common rows, BEFORE against AFTER:

```
max |Δ|volume||                 0
max |Δarea|                     0
F/E/V differences               0
native signed-volume sign flips 0
```

Nothing was "fixed" into agreement. The native engine emits exactly what it emitted.

### The 5 that still disagree, and why they are not orientation

| part | native F/E/V | OCCT F/E/V | signed volume | area |
|---|---|---|---|---|
| ho1008 | 4/6/4 | 6/13/8 | 32867.610570 both | 15943.933950 both |
| ho1030 | 4/6/4 | 6/13/8 | 31669.320520 both | 14855.869560 both |
| ho1272 | 4/6/4 | 8/19/12 | 41943.081630 both | 19443.812680 both |
| ho279  | 4/6/4 | 10/25/16 | 34574.221880 both | 17905.269040 both |
| ho660  | 4/6/4 | 6/13/8 | 47789.713610 both | 20951.648970 both |

Identical volume, identical area, **different face decomposition**: these are path-C
(cylindrical) parts on which OCCT splits the cylindrical wall into extra faces. They predate
this work, are unchanged by it, and are a *different decomposition* question — the class PR #224
names for MAKEOFFSET — not an orientation one.

## 4. Nothing is hidden by the correction

The corrected OCCT arm calls `forge::part::occtThickenBaseline`, the same inline function
`Features.cpp` calls. The **raw, un-normalised** answer is still measured in full, every run,
and still emitted — under the family name **`THICKEN_RAWOCCT`**, whose row in the table above
reproduces the BEFORE reading exactly (0/600 agree, p50 −1.000000). The raw sign stays on the
permanent record; it simply stops being scored as a geometric disagreement, which it never was.

## 5. What was actually wrong in the kernel — the sign bit was hiding two real holes

1. **`thickenSurface`'s orientation post-condition lived INSIDE
   `#ifndef FORGE_THICKEN_DROP_NATIVE`.** With the drop ON, production had **no orientation
   post-condition at all**. A post-condition a build flag can delete is not a post-condition.
   It is now hoisted out and applies to whichever engine answered.
2. **`occtthicken::thickenShell` had none either**, and held positive on only two of its four
   paths by accident:

   | path | orientation before |
   |---|---|
   | A coplanar prism | normalised — but three call levels away, inside `OcctPrimBuilder`'s `sewSweptToSolid` (`OcctPrimBuilder.cpp:312-315`) |
   | B folded fuse | **not normalised** — its final self-check reads `std::fabs(p.Mass())` |
   | C full-rectangle cylinder | **not normalised** — same, `std::fabs(vp.Mass())` |
   | D trimmed cylinder | normalised in place at its own tail |

   The four paths are now an anonymous-namespace impl behind **one** public exit that normalises
   and then **asserts** a positive volume, deferring rather than shipping if it cannot. The
   reference corpus only reaches paths A and C-via-D, so B and C were never measured for sign.

**A sign bit is invisible to `std::fabs`.** Every self-check in the engine, and the A/B's own
volume comparison, read magnitudes. That is why this survived a harness that was otherwise
thorough, and it is the same defect class this programme has been bitten by before.

## 6. The gate proves both directions

`forge-kernel/test/thicken_orientation_gate.cpp` — **19 checks, run twice** (OCCT branch, then
`FORGE_THICKEN_NATIVE=1`, because the post-condition used to be branch-local). Clean transcript:
`thicken_orientation_gate_clean.txt`. Mutation transcript: `thicken_orientation_gate_mutations.txt`.

**Positive direction** — RAW is negative and classifies OUT; NATIVE, BASELINE and PRODUCTION are
positive and classify IN; the native/baseline SIGNED ratio is +1; `|volume|` is unchanged by the
normalisation and equals `area x thickness` everywhere.

**Negative direction** — six controls fire every predicate against a deliberately reversed copy
of a known-good solid, plus two source mutations:

| mutation | site | result |
|---|---|---|
| 1 — neuter `orientedPositiveSolid` (the normaliser becomes a no-op) | `OcctThickenBaseline.hpp` | **RED, 7 checks**, and the `NATIVE/BASELINE` ratio reads **−1.000000** — the corpus finding, reproduced inside the gate |
| 2 — re-inject the original defect at the registration point | `Features.cpp` | **RED on BOTH production branches** (`FORGE_THICKEN_NATIVE=0` and `=1`) |

Restores are from a **backup copy** verified with `cmp`, never `git checkout -- <file>`, and a
mutation that cannot be applied is reported as such rather than skipped.

**Stated rather than implied:** mutation 2 does *not* prove the hoisted call is individually
load-bearing, and no single-site mutation on this fixture can — the fixture is a single planar
face, which the native engine answers on path A, and that path is positive by three independent
mechanisms. The hoist is defence in depth for paths B and C, and it is the only thing between a
caller and an un-normalised result when the drop deletes the other branch.

## 7. Drop hygiene, measured at the object level

`occtThickenBaseline` and its `BRepOffset_MakeOffset` include are guarded by
`#ifndef FORGE_THICKEN_DROP_NATIVE` exactly as the inline block in `Features.cpp` was.
Compiling `src/Features.cpp` both ways and counting undefined symbols:

```
normal build   BRepOffset_MakeOffset symbols in Features.o : 5
drop build     BRepOffset_MakeOffset symbols in Features.o : 0
```

`run_ab_native_thicken.sh` still reports `NativeThickenShell.o TKOffset imports: 0` and
**338 passed, 0 failed**.

## 8. What did NOT change

- **No tolerance, bound or assertion anywhere was widened, and none was removed.** The harness's
  `close_()` bound is untouched at 1e-6; the observable vector is untouched.
- **No `FORGE_*_DROP_NATIVE` default was flipped.** `FORGE_THICKEN_DROP_NATIVE` stays OFF.
- **THICKEN's flip verdict is not settled by this.** Coverage was already 600/600 = 600/600 and
  still is. This change removes **one** of the reasons the family fails PR #224's five-term
  verdict — the agreement term — and touches none of the others. THICKEN's remaining
  disagreement is the 5-part decomposition difference in §3.
- **`OCCT_CLOSURE`, `OCCT_DIRECT` and the release condition are untouched**;
  `forge-kernel/CMakeLists.txt` is not modified, so no generated artefact needed regeneration
  (verified: both `--check` modes pass, 84/53/57/3 and sha `3d3c6d76bd91` unchanged).
