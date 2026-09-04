# Families E and F: where `2/(1+cos 30°)` enters, twice — and which arm is a sweep

**Date:** 2026-09-04 · Measured from a worktree pinned to `origin/archdisc` (`ac0ca610`),
probe and A/B binaries both built at ``7cfb79e1`` with **0 dirty files** in
`src`/`include`/`test`.

> **Closure did not move, and it could not have.** Every file in this change set lives
> under `forge-kernel/test/` or `forge-kernel/reports/`. `FORGE_KERNEL_SOURCES`
> (`CMakeLists.txt`) has no entry in either, `CMakeLists.txt` is byte-identical, so
> `forge-kernel.node` is byte-identical and its load graph cannot differ.
> `OCCT_DIRECT = 9 · OCCT_CLOSURE = 14 · OCCT_PHANTOM = 2`, before and after. No
> `FORGE_*_DROP_*` option was flipped.

---

## 0. The question, and the answer in one line

`reports/TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` measured that the two arms of
`FORGE_PIPE_DROP_NATIVE` and `FORGE_PIPESHELL_DROP_NATIVE` disagree on **599 of 599**
parts at a volume ratio that is a closed form:

```
E PIPE       native/occt   min 1.071797  p50 1.071797  max 1.071798
F PIPESHELL  native/occt   min 1.055405  p50 1.071797  max 1.097498
2 / (1 + cos 30°) = 1.0717967697244908
```

It named the law behind the constant and then declined to say which arm is right,
calling it "a product decision". **It is not a product decision. Native is correct and
OCCT's arm is not a sweep**, and that is now measured rather than argued.

The constant enters **twice**, from the same piece of geometry — the mitre plane:

* once as the **ratio** between the two operations, which is what family E shows;
* once as the **offset coefficient inside the mitre's own closed form**, which is what
  family F's spread is, and which nothing in the repository had identified.

---

## 1. Where `2/(1+cos θ)` enters — derived, from the source

### 1.1 The input, verbatim

`test/corpus_ab_coverage.cpp:588-602` (`spineFromFace`) builds, for every part, a
**two-leg polyline of EQUAL legs with an exactly 30° turn**, starting at the largest
planar face's **centroid** and running along that face's **normal**:

```cpp
rot.SetRotation(gp_Ax1(origin, axis), 30.0 * kPi / 180.0);
const gp_Pnt p1 = origin.Translated(gp_Vec(n)  * len);   // len = 0.5 * part.diag
const gp_Pnt p2 = p1    .Translated(gp_Vec(n2) * len);   // n2 = n turned 30°
```

So `L1 = L2 = L` and `θ = 30°` are properties of the **harness**, not of either engine.

### 1.2 Native — the MITRE

`src/native/brep/NativeLoftPipe.cpp` carries a section point along `d_j` until it meets
the plane bisecting the incoming and outgoing legs, normal `n_j = normalize(d_j + d_{j+1})`
through the corner. Write `c = d1 · d2 = cos θ` and let `r` be a section point's offset
from the spine start (so `r · d1 = 0`, the section plane being ⟂ `d1`). Then

```
t1 = ((C - p0) · n) / (d1 · n) = L1 - (r · n)/(d1 · n)      C = corner
t2 = L2 + L1·c - r·d2 - c·t1                                final station ⟂ d2
```

With `n · d1 = sqrt((1+c)/2)` and `r · n = (r · d2)/sqrt(2(1+c))`, the awkward term
collapses to `(r · n)/(d1 · n) = (r · d2)/(1 + c)`, and the two lines add to

```
path(r) = L1 + L2 - 2 (r · d2) / (1 + cos θ)
```

**There is the constant.** The map is AFFINE in `r` (the engine's banner says so, and it
is why every lateral quad is planar), so integrating over the section replaces `r` by the
region's **area centroid** `r̄`:

> **(\*)  V_mitre = A · [ (L1 + L2) − 2 (r̄ · d2) / (1 + cos θ) ]**

### 1.3 OCCT — a TRANSLATION

`BRepOffsetAPI_MakePipe`'s law is pure translation by `spine(t) − spine(0)`: the section
is **not rotated onto leg 2**. Leg 1 is then a right prism of volume `A·L1`; leg 2 is the
same section (still ⟂ `d1`) translated along `d2`, an oblique prism whose volume is
`A · |L2 d2 · d1| = A·L2·cos θ`. The two are disjoint for `θ < 90°`, so

> **(\*\*)  V_transl = A · (L1 + L2 · cos θ)** — with no `r̄` in it at all.

### 1.4 The ratio, and why it is a constant for E and a spread for F

```
V_mitre / V_transl = [ (L1+L2) − 2(r̄·d2)/(1+c) ] / (L1 + L2·c)
                   = K · ( 1 − (r̄·d2) / (L·(1+c)) ),      K = 2/(1+cos θ),  L1 = L2 = L
```

`r̄` is the offset of **the swept region's centroid** from the spine start, and the spine
starts at the **FACE** centroid. So:

| | family E `PIPE` | family F `PIPESHELL` |
|---|---|---|
| what the harness sweeps | the **FACE** (`corpus_ab_coverage.cpp:1319`) | the face's **OUTER WIRE** (`:1339`) |
| swept region's centroid | = the face centroid | ≠ it whenever the face has holes |
| `r̄` | **identically 0** | `≠ 0` on 215 of the 581 holed parts |
| ratio | `K` **exactly, a constant** | `K·(1 − r̄·d2/(L(1+c)))`, **a spread** |

**That single line is the whole of the difference between "min = p50 = max = 1.071797"
and "1.055405 – 1.097498".** It is a property of the two INPUTS, not of the two engines.

---

## 2. Measured: the laws, on a grid, and both directions

`test/ab_pipe_sweep_law.cpp` (`test/run_ab_pipe_sweep_law.sh`) — three translation units,
one clang++ invocation, no CMake. **25 checks, 25 pass.** Over 5 turn angles × 3 leg
ratios, with the section a 10×10 square (`A = 100`) and `L = 50`:

| θ | L2/L1 | native | `A·(L1+L2)` | OCCT | `A·(L1+L2 cos θ)` | ratio |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 1.0 | 10000.000000 | 10000.000000 | 10000.000000 | 10000.000000 | 1.0000000000 |
| 15 | 1.0 | 10000.000000 | 10000.000000 | 9829.629131 | 9829.629131 | 1.0173323801 |
| **30** | **1.0** | **10000.000000** | **10000.000000** | **9330.127019** | **9330.127019** | **1.0717967697** |
| 45 | 1.0 | 10000.000000 | 10000.000000 | 8535.533906 | 8535.533906 | 1.1715728753 |
| 60 | 2.0 | 15000.000000 | 15000.000000 | 10000.000000 | 10000.000000 | 1.5000000000 |

*(the full 15-row grid is in the probe's own output)*

* native fits `A·(L1+L2)` on **15/15** at `1e-9`;
* OCCT fits `A·(L1+L2 cos θ)` on **15/15** at `1e-7`;
* **POSITIVE CONTROL** — at `θ = 0` the two laws coincide and the arms agree exactly
  (ratio `1.0000000000`). Without this a harness comparing one binary with itself would
  be indistinguishable from this result.

The ratio is not fitted to 30°; it tracks `(L1+L2)/(L1+L2 cos θ)` across the whole grid,
which is what makes the identification exact rather than a coincidence at one angle.

---

## 3. Which arm is geometrically correct — measured, not asserted

A sweep of a constant profile along a spine is defined by one property: **the solid's
cross-section perpendicular to the spine is the profile, everywhere**. That is measurable.
The probe clips each solid with a slab normal to leg 2 (TKBO booleans and a plain box —
neither TKOffset nor the native engine is in the instrument) and divides by the slab
thickness. Its own oracle control: on a straight prism the probe must read the profile
area, and it does (`100.000000` vs `100.000000`).

| | perpendicular section on leg 2 |
|---|---:|
| profile area `A` | 100.000000 |
| **native** | **100.000000** |
| **OCCT** | **86.602540** = `A·cos 30°` |

Two consequences follow, and either alone settles it:

**DEGENERACY.** At `θ = 90°` the translation law contributes *exactly zero* volume for
leg 2, because the section is displaced in its own plane:

```
θ=90   OCCT   vol 5000.000000  (= A·L1 exactly)   extent along leg 2  60.0000   BRepCheck valid=0
θ=90   native vol 10000.000000 (= A·(L1+L2))      extent along leg 2  55.0000   BRepCheck valid=1
```

OCCT's shape spans 60 mm of leg 2 and encloses none of it — it reports material it does
not contain, and fails its own validity check. *(This also explains the engine banner's
older note that OCCT "returns only the FIRST leg's contribution": every synthetic spine in
`test/ab_native_loftpipe_occt.cpp` turns 90°, and `cos 90° = 0`. One law, two observations.)*

**NON-MONOTONICITY.** At `θ = 120°`, lengthening leg 2 makes OCCT's solid **smaller**:

| L2 | OCCT | native |
|---:|---:|---:|
| 20 | 4000.0000 | 7000.0000 |
| 40 | 3000.0000 | 9000.0000 |
| 60 | 2000.0000 | 11000.0000 |

A sweep cannot lose volume when spine is added to it.

**And OCCT agrees with native the moment it is asked for the same operation.**
`MakePipeShell(RightCorner)` reproduces the mitre closed form — including the offset term
— to `1e-12`, on a face with an off-centre hole where the two engines share no code.

**Verdict: native implements the sweep; `MakePipe`/`MakePipeShell(Transformed)` implement
a translation.** `Transformed` is a documented OCCT mode and is not a bug in OCCT — but it
is not what `forge.part.sweep` means, and a drop that substituted it would change the
enclosed volume of every bent sweep in the product.

---

## 4. Q1 — family E's OCCT arm cannot be configured to the mitre

Family F repaired the same defect with one line, `SetTransitionMode(RightCorner)`.
`BRepOffsetAPI_MakePipe` has **no transition mode**. It has a `GeomFill_Trihedron`
argument that nothing in this repository had ever varied. Measured, all six non-guide
modes, on the same fixture:

| mode | volume | rel to mitre | rel to translation | valid |
|---|---:|---:|---:|---:|
| `IsCorrectedFrenet` *(the 2-arg ctor's default — `BRepFill_Pipe.hxx:53-57`)* | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |
| `IsFixed` | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |
| `IsFrenet` | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |
| `IsConstantNormal` | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |
| `IsDarboux` | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |
| `IsDiscreteTrihedron` | 9330.127019 | 6.699e-02 | 1.950e-16 | 1 |

**Bit for bit the translation law, on all six.** On a polyline spine the trihedron choice
is inert. The CONTROL in the same section shows the asymmetry is real and belongs to the
two OCCT APIs rather than to the fixture: `MakePipeShell(RightCorner)` on the same spine
and the same wire returns `10000.000000` — the mitre.

**So family E's flip gate cannot be repaired by configuring OCCT. The mitre has to be
built.**

---

## 5. Q3 — a correction to `NativeLoftPipe.cpp`'s banner

The banner states the closed form `V = area × (total spine length)` holds "with the
profile plane perpendicular to `d1` **and the profile centroid ON the spine start**". The
second hypothesis is real and load-bearing — measured, both directions:

| offset of the section centroid from the spine | native | `(*)` | rel | `A·(L1+L2)` | rel |
|---:|---:|---:|---:|---:|---:|
| 0 | 10000.000000 | 10000.000000 | 1.8e-16 | 10000.000000 | 1.8e-16 |
| 3 | 9839.230485 | 9839.230485 | 1.8e-16 | 10000.000000 | **1.608e-02** |
| 12 | 9356.921938 | 9356.921938 | 0.0 | 10000.000000 | **6.431e-02** |
| 40 | 7856.406461 | 7856.406461 | 1.2e-16 | 10000.000000 | **2.144e-01** |

`(*)` fits **4/4**; the uncorrected form fits **1/4** — only at offset 0. That is the
negative direction, and it is what makes the offset term a measurement rather than a
decoration. What is new is not that the hypothesis matters but that **it can be dropped**:
`(*)` carries it in closed form, and the coefficient is the same `2/(1+cos θ)`.

`test/pipe_closed_form_probe.cpp` previously declared itself "out of scope for family F"
for exactly this reason. It no longer is — see §6.

---

## 6. Q2 — the family-F spread, predicted in closed form on all 599

`test/pipe_closed_form_probe.cpp` now also emits the outer-wire region's area and
centroid, `r̄ · d2`, and `(*)`. Pure OCCT; the same STEP import, the same
largest-planar-face pick with the same centroid tie-break, and the same spine as the A/B.
Run over the whole corpus (600/600 parts, 0 errors, `fold_free` 600/600), then joined onto
the volumes measured by the §8 A/B run with **neither engine re-run**:

| | fits | of |
|---|---:|---:|
| **E** `PIPE` native vs the mitre `A_face·(L1+L2)` | **599** | 600 |
| **E** `PIPE` native vs the translation form | 0 | 600 |
| **E** `PIPE` OCCT vs the translation form | **600** | 600 |
| **F** `PIPESHELL` native vs the **offset-corrected** `(*)` | **599** | 600 |
| **F** `PIPESHELL` native vs the **uncorrected** `A_outer·(L1+L2)` | 384 | 600 ← negative direction |

and the ratio itself, against `K·(1 − r̄·d2/(L(1+c)))`, with nothing fitted:

```
|predicted − observed| / observed     min 1.18e-12 · p50 2.81e-10 · p99 2.51e-09 · max 1.45e-06
within 1e-6 : 599 / 600
observed ratio range   [1.055405, 1.097498]
predicted ratio range  [1.055405, 1.097498]
```

**The spread is reproduced end to end, both endpoints, on every part but one.**

**The one part is `ho1190`, and it is the same part in every row above.** It is the part
whose own build misses the engine's internal volume oracle by `1.46e-06` against a `1e-06`
bound — the residual `NativeLoftPipe.cpp:1564` records and `b51d14fc` later accepted with a
corrected integrator. That my independent closed form and the engine's own oracle single
out the *same* part, at the *same* magnitude, is a consistency check neither could give
alone; it is not a second defect.

The 384/599-equivalent row is what makes this a measurement: the two sets are
**identical, not merely equal in size** — the uncorrected form fits exactly the 384 parts
whose ratio is within `1e-6` of `K` and misses exactly the 216 that are not.

Those deviants are all holed, and holed is **necessary but not sufficient**, which is the
prediction `(*)` makes and a "holes cause the spread" story does not. Of the 600 parts,
**581** have a profile face with inner wires and **19** do not:

| | n | ratio |
|---|---:|---|
| single-wire face (`r̄ = 0` by construction) | 19 | `K` to 1.3e-9, **19/19** |
| holed, `r̄ · d2 ≈ 0` (symmetric hole placement) | 365 | `K` to 1e-6 |
| holed, `r̄ · d2 ≠ 0` | **215** | departs from `K`, and `(*)` predicts by how much |
| `ho1190` | 1 | the 1.46e-6 part above |

**Not one single-wire part is a deviant.**

A separate, engine-independent corroboration of the same 215: on **215 of 215**, native
equals `OCCT(RightCorner)` — a second engine asked for the mitre — to `1e-6`, and OCCT's
answer is `BRepCheck`-VALID on all 215. So the departure from `K` is the mitre's own offset
term and **not** a wobble in OCCT's default arm, which obeys `(**)` at `1.95e-16` throughout.

---

## 7. How the gate should express the equivalence, and what it measures

The flip gate asks whether OCCT can REPLACE native. For E and F the honest answer is
**no**, and today it is reached for the wrong reason (a one-part coverage gap, McNemar
`p = 1.0000`) while the right reason — the two arms compute different operations on 100%
of the corpus — is invisible to it. PR #224 added an agreement term, which now reads FAIL
for the right reason. What no gate could say was **which arm is right**, and therefore
whether the disagreement is a native defect or a convention the drop would destroy.

The proposal is one new row per family, scoring the SAME native arm against an OCCT arm
configured to — or built to — the SAME operation:

* **family F: already possible and already present.** `PIPESHELL_RC` differs from
  `PIPESHELL` by one line.
* **family E: not possible by configuration (§4), so the reference is BUILT.** New row
  **`PIPE_RC`**: sweep the profile's OUTER wire with `MakePipeShell(RightCorner)` and CUT
  one such shell per INNER wire. Legitimate because the mitre map is a boolean
  homomorphism — an affine per-leg station map, an extrusion and a slab clip each commute
  with union, intersection and difference. **Pure OCCT**: `MakePipeShell` and
  `BRepAlgoAPI_Cut`, no forge symbol, so the reference cannot be an artefact of the engine
  it judges.

`PIPE` and `PIPESHELL` are **untouched** and still mirror the production call sites
(`src/Features.cpp:700`, `:730`) verbatim, so the finding that they are two different
operations stays on the record rather than being quietly replaced by a favourable
comparison.

**The reference is proved BOTH directions before it is used** (`ab_pipe_sweep_law.cpp` §8,
a 10×10 face with an off-centre circular hole, where `(*)`'s offset term vanishes
identically because the spine starts at the face centroid, so the oracle is
`A_face·(L1+L2)` exactly):

| | volume | rel to oracle |
|---|---:|---:|
| oracle `A_face·(L1+L2)` | 7172.566612 | — |
| **(b) OUTER shell CUT by the hole shell** | **7172.566612** | **2.7e-12** |
| native `pipe(face)` | 7172.566612 | 1.7e-11 |
| (a) `MakePipeShell(RC)` handed the FACE | *nothing* | — ← NEGATIVE: the cut is load-bearing |
| OCCT `MakePipe` — the arm the gate uses TODAY | 6692.095754 | **6.699e-02** ← NEGATIVE: not a no-op |

The fixture itself is gated: the holed face must be `BRepCheck`-VALID. `BRepGProp` returns
an area for a face that bounds nothing, and without that gate the oracle would check a
wrong answer against a wrong expectation and agree. *(The first version of this fixture put
a radius-3 hole at x=3 in a 10-wide square — poking through the wall. The face was invalid,
native correctly declined it, and the reference read 4.2% high. The gate caught it.)*

---

## 7b. What this means for the drop

Both families' native paths are **OFF by default in the product today**:
`pipeNativeEnabled()` is `envOn("FORGE_PIPE_NATIVE")` and `pipeShellNativeEnabled()` is
`envOn("FORGE_PIPESHELL_NATIVE")` (`NativeLoftPipe.cpp:2888-2895` and `:633-641`), so all
three family-E call sites (`src/Features.cpp:700`, `:802`, `:977`) and the one family-F
call site (`:730`) currently ship OCCT's translation law. Checked, not inferred.

Flipping either `FORGE_*_DROP_NATIVE` makes the mitre the only path. That changes the
enclosed volume of every **bent** sweep in the product — by exactly `K = 1.071797` for
family E, and by `K·(1 − r̄·d2/(L(1+c)))` for family F. It changes **nothing** on a
straight spine, where the two laws coincide identically (§2, positive control).

`TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` §4 reads that change as a hazard: "a drop that
silently changes every existing sweep by 7.2% is not a tolerated representation". With
§3 measured, the sign flips: **the change is a CORRECTION**, and the hazard is not the
change but the silence. A coverage gate cannot report it, and even the new agreement term
only says the arms differ — not which one to keep. That is what the `PIPE_RC` /
`PIPESHELL_RC` pair adds: a row on which agreement is *achievable*, so a failing agreement
term on `PIPE` / `PIPESHELL` can be read as "different operation" rather than "native is
broken".

---

## 8. BEFORE and AFTER, full 600, one binary

`test/run_corpus_ab_coverage.sh all`, `FAMILIES=PIPE,PIPE_RC,PIPESHELL,PIPESHELL_RC`,
stride 1 (every part, never a prefix), **600 parts, 2400 rows, 0 part-level failures**.
One binary, one tree, `dirty_files_in_src_include_test: 0`. `PIPE` and `PIPESHELL` are the
BEFORE and are byte-identical code paths to `origin/archdisc`; `PIPE_RC` and
`PIPESHELL_RC` are the AFTER. They are in the SAME RUN, so no confound from a second build
or a second corpus pass.

| row | both | **volume agree (1e-6)** | COM agree (1e-7) | full-vector `agree` | native VALID | OCCT VALID |
|---|---:|---:|---:|---:|---:|---:|
| **BEFORE** `PIPE` | 600 | **0 / 600** | 0 | 0 | 600 / 600 | 600 |
| **AFTER** `PIPE_RC` | 598 | **567 / 598** | 567 | 2 | 600 / 600 | 567 |
| **BEFORE** `PIPESHELL` | 600 | **0 / 600** | 0 | 0 | 600 / 600 | 600 |
| **AFTER** `PIPESHELL_RC` | 598 | **567 / 598** | 567 | 325 | 600 / 600 | 567 |

```
BEFORE  PIPE       ratio  min 1.071796765  p50 1.071796770  max 1.071798486   599/600 within 1e-6 of K
BEFORE  PIPESHELL  ratio  min 1.055405144  p50 1.071796770  max 1.097498268   384/600 within 1e-6 of K
AFTER   PIPE_RC        ratio  p50 1.000000000
AFTER   PIPESHELL_RC   ratio  p50 1.000000000
```

**The one number that settles it.** Restricted to the pairs where OCCT's own arm is
`BRepCheck`-VALID:

| row | volume agree, OCCT-valid pairs only | worst residual |
|---|---:|---:|
| `PIPE` | **0 / 600** | 7.180e-02 |
| `PIPESHELL` | **0 / 600** | 9.750e-02 |
| **`PIPE_RC`** | **567 / 567 = 100.0%** | **3.485e-08** |
| **`PIPESHELL_RC`** | **567 / 567 = 100.0%** | **1.476e-09** |

**All 31 volume disagreements in both AFTER rows are exactly the 31 parts on which OCCT's
own reference is `BRepCheck`-INVALID** — 567 + 31 = 598 — and OCCT threw on 2 more
(`ho1084`, `ho684`, "BRep_API: command not done"). **Native is `OK` on 600/600 and
`BRepCheck`-VALID on 600/600 in every one of the four rows.** So on the operation both
engines are actually trying to compute, the two agree wherever OCCT produces a valid solid,
and where they do not it is OCCT's answer that is broken.

### Reading the two `agree` columns

The full-vector `agree` column stays low (2 and 325) even where every scalar matches,
because it includes face/edge/vertex counts and a vertex-derived bbox. Those are properties
of where the modeller put the SEAMS, not of the solid — the harness says so itself in the
`PIPESHELL_XOR` block, which exists precisely because "the disagreement count was an
INSTRUMENT ARTEFACT". `PIPE_RC` scores lowest of all on it for a mechanical reason: its
reference is assembled with `BRepAlgoAPI_Cut`, and the boolean splits faces the native
engine leaves whole (measured on `ho0`: native 22/57/37 vs reference 28/86/60, at a volume
residual of exactly `0.000e+00`).

**So the agreement term a repaired gate should read is the GEOMETRIC one — volume and
centre of mass — and the honest headline is `0/600 → 567/567 of the OCCT-valid pairs`.**
Reporting the full-vector column as if it were the geometry would understate the AFTER by
the same instrument artefact that the existing harness already refuses to trust.

### What did NOT move

`PIPE` and `PIPESHELL` reproduce the committed baseline exactly where the trees agree:
ratio `min 1.055405144 / p50 1.071796770 / max 1.097498268` for F is the committed
`full600` figure to the digit. The one difference is coverage — native reads **600/600**
here against the committed **599/600** — and that is not this change: `b51d14fc`
("the last corpus decline was the ORACLE'S INTEGRATOR, not the engine") landed on
`archdisc` after the `head600_2026-08-31` run's SHA `40c6073d`. **The one-part deletion
bucket that `TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` §2 and the pipeshell defer audit
both describe is already closed at `archdisc` HEAD**, and the coverage term for E and F now
reads 100.0% vs 100.0%.

---

## 9. Corrections to the record

1. **`NativeLoftPipe.cpp` banner** — the closed form's "centroid ON the spine start"
   hypothesis is correct and necessary, and can now be dropped: `(*)` carries it, with the
   same `2/(1+cos θ)` coefficient (§5).
2. **`pipe_closed_form_probe.cpp`** — "out of scope for family F" is no longer true. With
   the offset term the closed form predicts family F on **599/599** (§6).
3. **`TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` §1** — "for F the cosine law is
   `MakePipeShell`'s central tendency and not its identity" reads as a statement about
   OCCT. It is not: OCCT's default arm obeys `(**)` at `1.95e-16` on every part measured
   here. The spread belongs to the MITRE's offset term, i.e. to the native arm — which is
   nonetheless exactly right, because the offset is real (§6).
4. **`TKOFFSET_EF_PARITY_AND_THE_WRONG_GATE.md` §4** — "the choice is a product decision
   about what `sweep` means" is too generous. Under the translation law a 90° elbow
   encloses nothing past the corner and a 120° elbow shrinks as it is lengthened (§3).
   That is not a competing convention.

## 10. Files

| file | what |
|---|---|
| `test/ab_pipe_sweep_law.cpp`, `test/run_ab_pipe_sweep_law.sh` | the sweep-law probe: 25 checks, the trihedron sweep, the section probe, the offset term, and the mitre reference with its controls |
| `test/pipe_closed_form_probe.cpp` | extended with `outer_area`, `rbar_dot_d2`, `closed_form_F`, `ratio_pred_F` |
| `test/corpus_ab_coverage.cpp` | the new `PIPE_RC` row (`PIPE` and `PIPESHELL` untouched) |
| `reports/corpus_ab/efgate600_*` | the 600-part A/B carrying `PIPE`, `PIPE_RC`, `PIPESHELL`, `PIPESHELL_RC` from one binary |
