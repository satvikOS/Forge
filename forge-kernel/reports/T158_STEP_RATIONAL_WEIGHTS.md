# T-158 — the native analytic STEP writer discarded every rational NURBS weight

**Branch** `work/T-158-step-rational` · **base** `origin/archdisc` @ `1e49a56b` · **date** 2026-09-18
**Files changed** `forge-kernel/src/native/brep/StepAnalytic.cpp`,
`forge-kernel/include/forge/native/brep/StepAnalytic.hpp`,
`forge-kernel/test/step_rational_roundtrip_gate.cpp` (new, the OCCT oracle),
`forge-kernel/test/native/brep/step_rational_weights_test.cpp` (new, the in-CI half),
`forge-kernel/CMakeLists.txt` (gate registration only),
`forge-kernel/test/gate_registration_ratchet.sh` (ALLOW entry + reason — **a deviation from the
task's file boundary**, explained in §6), this report.
**Not touched**: `Nurbs.cpp`, `NurbsCalculus.cpp`, `Primitives.cpp`, `Topology.cpp`,
`src/native/linalg/**`, `.github/workflows/kernel-tests.yml`, `src/Cam.cpp`, `src/IoExchange.cpp`.
**No route changed.** `exportStep`'s three routes (`StepAnalytic::write` at
`IoExchange.cpp:157`, `StepFaceted::write` at `:174`, `StepWriteOcct::write` at `:192`) are
byte-untouched; native Solid still goes to the analytic writer.

---

## 1. Headline

| | before | after |
|---|---|---|
| rational surfaces whose weights survived the round trip | **0 / 4 701** | **4 667 / 4 667** |
| worst deviation, RATIONAL surfaces | **46.036966282 mm** | **0.000000000 mm** |
| worst deviation, NON-RATIONAL surfaces (control) | 0.000000000 mm | 0.000000000 mm |

**Denominator.** 126 ISO-10303-21 files in the tree (`cadgenbench_deliverables/**` +
`data/cadgenbench_edit_out/**`), all 126 read by `readForeignStep`. 67 of them contain at least
one valid `SurfaceKind::Nurbs` face and were written by `StepAnalytic::write`; OCCT read all 67
back. That yielded **7 242 matched B-spline surfaces before (4 701 rational + 2 541 non-rational)
and 7 208 after (4 667 + 2 541)**, each sampled at **169 (u,v) points** (13×13 grid over the full
knot span).

The non-rational arm is **exactly 2 541 in both runs** — that is the control that says the
harness itself did not move. The rational arm dropped by 34 because those surfaces are now
*different geometry*: OCCT's shape-healing groups the corrected faces slightly differently on
re-read. 22 B-spline surfaces were unmatched in both runs (a surface OCCT reconstructed whose
pole grid does not equal any native net — unchanged by this work, and excluded from both sides).

---

## 2. Surface census — what is rational, and how much of the corpus it is

`StepAnalytic::emitSurface` handles six of the seven `SurfaceKind` values. Five of them
(`Plane`, `Cylinder`, `Cone`, `Sphere`, `Torus`) map to exact analytic STEP entities that have no
weights and need none. **Exactly one kind can be rational: `SurfaceKind::Nurbs`.**
(`SurfaceKind::EllipseExtrusion` is not in the switch at all — it returns 0 and the face is
faceted. That is pre-existing and out of scope here.)

Census over the same 126 parts (`census.cpp`, `readForeignStep` → count faces by kind):

```
SURFACE CENSUS over 37983 faces of 126 readable parts:
  Cone                    868  (2.29%)
  Cylinder              13005  (34.24%)
  Nurbs                  6882  (18.12%)
  Plane                 10342  (27.23%)
  Sphere                 1567  (4.13%)
  Torus                  5319  (14.00%)
NURBS faces: 4433 rational (non-unit weights), 2449 genuinely non-rational
parts containing at least one rational NURBS face: 60 of 126 readable
most-extreme weight seen: 0.06327339783068
```

**64.4 % of NURBS faces are rational; 11.7 % of all faces in the corpus are.** 60 of 126 parts
carry at least one. This is not a corner case.

**Where rational surfaces come from in production** (all of these feed
`exportStep` → `StepAnalytic::write`):

| producer | what makes it rational |
|---|---|
| `StepRead.cpp` `buildEllipseNurbs` (:850) | the 9-point circle/ellipse form, corner weights `sqrt(2)/2` |
| `StepRead.cpp` `revolveCurveToNurbs` (:868) | `SURFACE_OF_REVOLUTION` → circle ⊗ generatrix, weights `cw * wj` |
| `StepRead.cpp` (:1921) | rational profile swept by a linear extrusion |
| `StepRead.cpp` (:263) | a foreign `RATIONAL_B_SPLINE_SURFACE` read straight in |
| `IgesRead.cpp` (:647) | IGES entity 128 weight array |
| `FilletAnalytic.cpp` (:2674) | the analytic fillet valley: weights `{1, sqrt2/2, 1}` |
| `NurbsSurfaceIntersect.cpp` (:604/:625/:656) | circle→NURBS conversions |

So the headline production data-loss path was: **import a foreign STEP part → every rational
surface survives the import exactly → export it again → every weight is silently dropped.**

---

## 3. The defect, proved before anything was changed

`B_SPLINE_SURFACE_WITH_KNOTS` is the **non-rational** STEP entity: it has no field in which a
control weight can be written. Before this change, `StepAnalytic.cpp:210` emitted it for every
NURBS surface, and the strings `weight`, `rational` and `RATIONAL_B_SPLINE_SURFACE` appeared
nowhere in the file. A rational surface emitted that way is a **different surface**, not a
rounded one.

Positive control (`probe.cpp`), a pie-wedge solid whose curved wall is the *exact* rational
quadratic quarter cylinder of radius 1.5 mm, weights `(1, sqrt(2)/2, 1)`:

```
SOURCE rational quarter-cylinder: R=1.500000 H=2.000000  weights = 1 1 0.707106781186548 0.707106781186548 1 1
NATIVE  max | |P|-R | over 21x5 grid = 4.440892e-16 mm
write ok=1 reason='' bytes=5449
file contains 'RATIONAL_B_SPLINE_SURFACE' : NO
EMITTED: B_SPLINE_SURFACE_WITH_KNOTS('',2,1,((#110,#111),(#112,#113),(#114,#115)),.UNSPECIFIED.,.F.,.F.,.F.,(3,3),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);
OCCT TransferRoots -> 1 roots
OCCT BSpline surface: degU=2 degV=1 nPolesU=3 nPolesV=2 IsURational=0 IsVRational=0
  OCCT weights: 1 1 1 1 1 1
  OCCT mid-parameter radius = 1.5909903  (exact 1.5000000)
RESULT closed-form  max | |P_occt|-R | = 0.0909903 mm  (denominator: 105 samples on 1 surface)
RESULT vs-native    max |P_occt-P_native| = 0.1048235 mm
```

The control fires. The native evaluator is exact to 4.4e-16 mm; the file comes back with every
weight 1.0 and a mid-parameter radius of **1.5909903 mm for a 1.5 mm feature**. That is not a
coincidence of this fixture — it is the closed form of the defect: dropping the weights of a
rational quadratic quarter circle turns it into the plain quadratic Bézier through the same three
poles, whose midpoint is at `3*sqrt(2)/4 * R = 1.0606602 * R`.

---

## 4. The oracle is NOT our own reader

`StepAnalytic::read` does not reconstruct B-spline surfaces at all — its own branch says so and
returns `ok=false`. A `write → StepAnalytic::read → compare` acceptance test would therefore have
compared the writer with itself and stayed green on a shared misunderstanding.

**Every round-trip number in this report was read back by Open CASCADE 7.9.3's
`STEPControl_Reader`** (`ReadStream` + `TransferRoots` + `OneShape`), with the geometry read off
the reconstructed `Geom_BSplineSurface` via `Pole(i,j)`, `Weight(i,j)` and `Value(u,v)`. OCCT is a
separately authored, standards-conformant implementation and is already linked into this tree's
test targets (`FORGE_TEST_OCCT_LIBS`, `CMakeLists.txt:3247`).

For fixture R1 there is a **third** judge that is neither kernel: the closed form
`|P(u,v)| == R`, since the patch is an exact circular cylinder.

A second, *non*-independent check was also run — Forge's own foreign reader must not choke on
Forge's own output:

```
# after the fix
write ok=1
readForeignStep ok=1 reason='' faces=5
NURBS faces recovered=1  max weight error=0.000e+00  max | |P|-R | = 0.000000000 mm
StepAnalytic::read ok=0 reason='StepAnalytic.read: unsupported COMPLEX surface instance (e.g. the rational B_SPLINE_SURFACE form) — use readForeignStep'

# before the fix, same fixture
NURBS faces recovered=1  max weight error=2.929e-01  max | |P|-R | = 0.090990258 mm
StepAnalytic::read ok=0 reason='StepAnalytic.read: unsupported analytic surface entity 'B_SPLINE_SURFACE_WITH_KNOTS''
```

Export→re-import through Forge is now lossless too. `StepAnalytic::read` still declines B-spline
surfaces — it always did — but now says so by name instead of quoting an empty type string.

---

## 5. The fix

`StepAnalytic.cpp`, the `SurfaceKind::Nurbs` arm of `emitSurface`:

* A surface is **rational iff at least one control weight is not exactly 1.0**. The predicate is
  the same exact `w != 1.0` test `IgesWrite.cpp:266` already uses for its IGES-128 PROP3
  "polynomial" flag, so the two Forge writers classify the identical surface identically.
* **Non-rational** → the simple `B_SPLINE_SURFACE_WITH_KNOTS` instance, **byte-for-byte as
  before**. Always emitting the rational form would be the same geometry with five extra
  sub-records and a whole weight grid on every surface in every file.
* **Rational** → the AP242 COMPLEX instance, which is the only STEP form that can carry the
  weights, with the sub-records in the ISO-10303-21 alphabetical order OCCT's own exporter uses
  and which **both** Forge readers already parse (`StepRead.cpp:1257`, `StepReadOcct.cpp:583`):

```
#87=( BOUNDED_SURFACE() B_SPLINE_SURFACE(2,1,((#110,#111),(#112,#113),(#114,#115)),.UNSPECIFIED.,.F.,.F.,.F.)
      B_SPLINE_SURFACE_WITH_KNOTS((3,3),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)
      GEOMETRIC_REPRESENTATION_ITEM()
      RATIONAL_B_SPLINE_SURFACE(((1.,1.),(0.70710678118654757,0.70710678118654757),(1.,1.)))
      REPRESENTATION_ITEM('') SURFACE() );
```

Weights are written with `p21::stepFmt` (`%.17g`), so each one round-trips bit-exactly. After the
fix the same probe reports `OCCT mid-parameter radius = 1.5000000` and
`max | |P_occt|-R | = 0.0000000 mm`.

---

## 6. The gates, and their mutation proofs

There are **two**, and the split is forced rather than chosen.

* **`forge-kernel/test/step_rational_roundtrip_gate.cpp`** →
  `kernel.ab.step_rational_roundtrip_gate` in `FORGE_AB_GATES`. The **independent-oracle**
  half: it reads the file back with OCCT. It *cannot* live under `test/native/brep/`, because
  `test/native/run_native.sh:126` globs that directory and compiles each file with **no OCCT on
  the line** — an OCCT-linked file there breaks the whole native suite. But `FORGE_AB_GATES` is
  reached only through `ctest`, **and no workflow in this repository invokes `ctest`**
  (`kernel-tests.yml:106`, `:1519`, `:1653` all say so). So on its own it would have compiled,
  committed, stayed green and never executed once.
* **`forge-kernel/test/native/brep/step_rational_weights_test.cpp`** — the **in-CI** half, added
  for exactly that reason. `run_native.sh` globs `test/native/<class>/*.cpp`, so it runs on every
  PR **by construction**, in the `native C++ kernel gate (pure C++20, no deps)` job. It asserts
  the emitted **bytes** (no reader involved, so nothing can agree with itself), then re-reads them
  with `readForeignStep` — a different translation unit — against the **closed form** `|P| == R`,
  and carries the same sensitivity control.

`gate_registration_ratchet.sh` is what forced this to be discovered rather than shipped: adding
the OCCT gate to `FORGE_AB_GATES` turned it **RED** ("a NEW CMake-registered gate is not wired
into CI"), and CI agreed — the check *every forge-kernel gate is executed, not merely built*
failed on the first push. The OCCT gate is now pinned in that script's `ALLOW_CPP` and
`ALLOW_CMAKE` with the reason written out; the ratchet was re-proved to still fire (a phantom
entry added to `FORGE_AB_GATES` → RED, removed → GREEN). **This is a deviation from the task's
file boundary** — `forge-kernel/test/gate_registration_ratchet.sh` was not on the may-write list —
taken because the only other remedies the ratchet offers touch `.github/workflows/`, and
`kernel-tests.yml` is owned by another task.

### The OCCT oracle gate

`forge-kernel/test/step_rational_roundtrip_gate.cpp`, registered as
`kernel.ab.step_rational_roundtrip_gate` in `FORGE_AB_GATES`.

Three fixtures / three B-spline surfaces:

* **R1** rational quarter cylinder, R = 1.5 mm, weights `(1, sqrt2/2, 1)` — carries the closed
  form `|P| == R`.
* **R2** rational (2,2) cap on a box, 3×3 net whose four boundary control triples are collinear
  (so the four boundary curves *are* the box's top rim segments and the solid stays geometrically
  consistent), with **nine distinct weights that are not symmetric under transpose**.
* **N1** non-rational bilinear cap, every weight exactly 1.0.

It asserts at two altitudes on purpose, because no single altitude catches every mutation:

* **per-surface** — every OCCT weight equals the native weight to 1e-12, and
  `max |P_occt - P_native| <= 1e-9 mm`.
* **aggregate** — OCCT must return exactly 3 B-spline surfaces, exactly 2 of them rational, 2/2
  weights must survive, corpus-wide worst deviation `<= 1e-9 mm`. The *count* bars exist because
  a writer that stopped emitting the rational record makes OCCT report a non-rational surface, and
  a check phrased "for each rational surface…" would then examine nothing and stay green.
* **negative control** — N1 must **not** gain a `RATIONAL_B_SPLINE_SURFACE` record.
* **sensitivity control, which must FIRE** — the same R1 control net evaluated with unit weights
  must move the closed form by `>= 0.05 mm`. A tolerance widened far enough to pass anything would
  fail this, so the gate cannot be made vacuous by loosening it.

### Mutation transcripts

**Mutant A — weights forced to 1.0** (`E.data += stepFmt(1.0)`). This is precisely the "write
`RATIONAL_B_SPLINE_SURFACE` with all weights 1.0 and call it done" failure:

```
  [PASS] R1: the file carries a RATIONAL_B_SPLINE_SURFACE record        <-- substring check alone is NOT enough
  [FAIL] R1 [per-surface]: every OCCT weight == the native weight (max err 0.292893)
  [FAIL] R1 [per-surface]: max |P_occt - P_native| <= 1e-9 mm (got 0.104749)
  R1 mid-parameter radius from OCCT = 1.5909903 (exact 1.5000000)
  [FAIL] R1 [closed form]: max | |P_occt| - R | <= 1e-9 mm over 165 samples (got 0.090990)
  [FAIL] R2 [per-surface]: every one of the 9 OCCT weights == the native weight (max err 0.550000)
  [FAIL] R2 [per-surface]: max |P_occt - P_native| <= 1e-9 mm (got 0.157563)
  [PASS] aggregate: OCCT returned exactly 3 B-spline surfaces (got 3)
  [FAIL] aggregate: exactly 2 of them came back RATIONAL ... (got 0 — 0 means every weight was lost)
  [FAIL] aggregate: rational surfaces whose weights SURVIVED the round trip = 0 / 2
  [FAIL] aggregate: corpus-wide worst |P_occt - P_native| <= 1e-9 mm (got 0.157563)
step_rational_roundtrip_gate RESULT: 12/20 passed -> RED
```

**Mutant B — silent revert to the non-rational entity** (`rational` forced false):

```
  [FAIL] R1: the file carries a RATIONAL_B_SPLINE_SURFACE record
  [FAIL] R1 [per-surface]: every OCCT weight == the native weight (max err 0.292893)
  [FAIL] R1 [closed form]: max | |P_occt| - R | <= 1e-9 mm over 165 samples (got 0.090990)
  [FAIL] R2 [per-surface]: every one of the 9 OCCT weights == the native weight (max err 0.550000)
  [FAIL] aggregate: exactly 2 of them came back RATIONAL ... (got 0 ...)
  [FAIL] aggregate: rational surfaces whose weights SURVIVED the round trip = 0 / 2
  [FAIL] aggregate: corpus-wide worst |P_occt - P_native| <= 1e-9 mm (got 0.157563)
step_rational_roundtrip_gate RESULT: 10/20 passed -> RED
```

**Mutant C — weight grid transposed.** This one keeps the aggregate *rational-count* bar green
(the weights are all there, just in the wrong cells); only the per-surface equality catches it —
which is why the gate carries both:

```
  [FAIL] R1 [per-surface]: every OCCT weight == the native weight (max err 0.292893)
  [FAIL] R1 [closed form]: max | |P_occt| - R | <= 1e-9 mm over 165 samples (got 0.090990)
  [FAIL] R2 [per-surface]: every one of the 9 OCCT weights == the native weight (max err 0.200000)
  [FAIL] aggregate: rational surfaces whose weights SURVIVED the round trip = 0 / 2
  [FAIL] aggregate: corpus-wide worst |P_occt - P_native| <= 1e-9 mm (got 0.201893)
step_rational_roundtrip_gate RESULT: 13/20 passed -> RED
```

**Restored** — source byte-identical to the fixed version (`diff` reports IDENTICAL):

```
step_rational_roundtrip_gate RESULT: 20/20 passed -> GREEN
```

### The in-CI native test, mutation-proved on the same two mutants

`ONLY=brep/step_rational_weights bash forge-kernel/test/native/run_native.sh`

```
MUTANT A: weights forced to 1.0
  [FAIL] rational [per-weight]: inside the weight record the exact %.17g text "0.70710678118654757" appears once per non-unit control point (expected 2, got 0)
  [FAIL] rational [per-surface]: the FULL 3x2 weight grid is present verbatim ...
  [FAIL] rational [per-weight]: every recovered weight equals the written weight (max err 0.292893)
  [FAIL] rational [CLOSED FORM]: max | |P|-R | <= 1e-9 mm over 75 samples (got 0.090990)
step_rational_weights_test RESULT: 11/15 passed -> RED

MUTANT B: silent revert to the non-rational entity
  [FAIL] rational: the file carries a RATIONAL_B_SPLINE_SURFACE record
  [FAIL] rational: it is the AP242 COMPLEX instance form
  [FAIL] rational: the weight record is locatable
  [FAIL] rational [per-surface]: the FULL 3x2 weight grid is present verbatim ...
  [FAIL] rational [per-weight]: every recovered weight equals the written weight (max err 0.292893)
  [FAIL] rational [CLOSED FORM]: max | |P|-R | <= 1e-9 mm over 75 samples (got 0.090990)
step_rational_weights_test RESULT: 8/14 passed -> RED

RESTORED (source diff-identical)
step_rational_weights_test RESULT: 15/15 passed -> GREEN
```

**A defect this test found in itself, worth recording.** Its first version counted the `%.17g`
weight text over the *whole file* and expected 2; it measured **6** and went red. The fixture's
chord edge `A->B` has unit direction `(-sqrt2/2, sqrt2/2, 0)`, so the same digits appear in four
`DIRECTION` components that have nothing to do with weights. The assertion was mis-specified, not
the writer; it now counts inside the `RATIONAL_B_SPLINE_SURFACE` record only. A whole-file
substring count would have stayed green on a writer that put the right digits in the wrong place.

---

## 7. Byte-identity control on non-rational output

Both writers were compiled into the same harness (`hash.cpp`) — one linking
`git show origin/archdisc:.../StepAnalytic.cpp`, one linking the fixed file — and each was run
over all 126 parts, hashing `StepAnalytic::write(...).text`. (The two harness binaries were
`cmp`-checked to differ first, so the comparison is not a binary against itself.)

```
=== parts with NO rational NURBS: output must be BYTE-IDENTICAL ===
  non-rational parts byte-identical: 66   changed: 0
=== parts WITH rational NURBS: output MUST change ===
  rational parts changed: 60   unchanged (would be a BUG): 0
```

Of the 66 unchanged parts, **7 genuinely exercise the non-rational NURBS emit path** (they have
`SurfaceKind::Nurbs` faces with every weight 1.0) and 59 have no NURBS face at all. The
per-part volume OCCT computes agrees: part 101 (no rational surface) is `338884.739` on both
sides; parts 111 and 212 (rational) move, because their geometry was wrong before.

---

## 8. The pcurve prerequisite — NOT needed here, and what stays blocked

**The briefing's premise is confirmed.** `Coedge::pcurve` is assigned in exactly **5 places
across 4 TEST files and ZERO production translation units**
(`test/native/brep/k0_topology_test.cpp:323,348`, `test/native/brep/validator_test.cpp:169`,
`test/native_vs_occt_validator.cpp:188`, `test/native_vs_occt_validator_ext.cpp:243`). Production
only reads it, and `Check.cpp:921` and `:1069` both `if (c->pcurve == nullptr) continue;`.

**Conclusion: the analytic writer does NOT need pcurves, and this task is not blocked.**

`StepAnalytic.cpp` contains zero occurrences of `PCURVE`, `SURFACE_CURVE`, `SEAM_CURVE` or
`DEFINITIONAL_REPRESENTATION` — it never emitted them, before or after this change. (For
contrast, `StepWriteOcct.cpp` does, at `:914` and `:936`.) In ISO 10303-42 an `EDGE_CURVE` may
reference a plain 3D `curve`; the `SURFACE_CURVE`/`PCURVE` parametric representation is
*optional*, and a conformant reader is expected to recover the 2D trim itself. Measured, that is
exactly what happens:

```
=== T-158 pcurve prerequisite: does OCCT accept a file with NO pcurves? ===
.../111/output.step file has PCURVE=NO SURFACE_CURVE=NO | OCCT: faces=26  edge-uses=5840  edge-uses WITH a pcurve=5840  | BRepCheck valid=YES | |volume|=78184.0904
.../212/output.step file has PCURVE=NO SURFACE_CURVE=NO | OCCT: faces=360 edge-uses=29384 edge-uses WITH a pcurve=29384 | BRepCheck valid=no  | |volume|=610759.933
.../101/output.step file has PCURVE=NO SURFACE_CURVE=NO | OCCT: faces=26  edge-uses=3534  edge-uses WITH a pcurve=3534  | BRepCheck valid=YES | |volume|=338884.739
```

OCCT synthesised a pcurve for **100 % of edge-uses** (5840/5840, 29384/29384, 3534/3534) from the
3D curves alone, and `BRepCheck_Analyzer` calls the result valid. Part 212 is `valid=no`, but it
is `valid=no` with the **pre-fix** writer too (same probe, base `StepAnalytic.cpp`) — a
pre-existing defect in that part's write, not a regression and not a weight problem.

**What genuinely stays blocked** (recorded here so it is not quietly forgotten, and deliberately
NOT worked around — no pcurves were invented to make anything pass):

1. **Validator checks G5 `PCurveMatches3DEdge` and G9 `EdgeSameParameter` never execute in a
   production build.** Both skip every coedge, because nothing in production ever sets
   `Coedge::pcurve`. They are exercised only by the four test files that set it by hand. Until a
   production path produces pcurves, those two checks are structurally green and prove nothing.
2. **Forge's analytic STEP export carries no parametric trim.** Every consumer must re-derive it.
   OCCT does so perfectly here, but a reader that requires `SURFACE_CURVE`/`PCURVE` would not.
   Closing that is a separate task, in `StepWriteOcct.cpp`'s image, and it needs (1) first.
3. `SurfaceKind::EllipseExtrusion` is absent from `emitSurface`'s switch, so such a face is
   faceted rather than written analytically. Pre-existing; out of this task's scope.

---

## 9. Regression — the whole kernel suite

```
64/64 Test #62: kernel.native_suite ...........................   Passed  119.79 sec
100% tests passed, 0 tests failed out of 64
Total Test time (real) = 137.73 sec
```

That is every registered kernel test, including all `FORGE_AB_GATES` and `kernel.native_suite`.

The pure-C++20 native suite, run directly and in full:

```
[native] ALL 143 NATIVE GATES PASS (forge::native — pure C++, no deps, no WASM)
```

143, one more than before — the new `test/native/brep/step_rational_weights_test.cpp`, picked up
by `run_native.sh`'s glob.

Both registration ratchets are green:

```
[gate-registration] shell gates (*_gate.sh) measured=8  pinned=8
[gate-registration] C++ gates (*_gate.cpp) measured=9  pinned=9
[gate-registration] CMake-registered (add_test) measured=36  pinned=36
[gate-registration] GREEN — no unwired gate beyond those pinned.
[shell-gate-registration] measured=4  pinned=4
[shell-gate-registration] GREEN — no unwired shell gate beyond the 4 pinned.
```

and the kernel ratchet was re-proved to still fire after the ALLOW entries were added — a phantom
`phantom_unwired_gate` in `FORGE_AB_GATES` gives `measured=37 pinned=36 … RED`, removing it gives
`36/36 … GREEN`.

---

## 10. Reproduce

```sh
# configure + build (node-free core so the AB gates register)
cmake -S forge-kernel -B forge-kernel/build -DCMAKE_BUILD_TYPE=Release \
      -DFORGE_BUILD_TESTS=ON -DFORGE_BUILD_NODE_ADDON=OFF -DFORGE_BUILD_DESKTOP_FOUNDATION=ON
cmake --build forge-kernel/build -j "$(forge-nproc)"

# the gate
./forge-kernel/build/forge_gate_step_rational_roundtrip_gate
ctest --test-dir forge-kernel/build -R kernel.ab.step_rational_roundtrip_gate --output-on-failure
```

The corpus harnesses used for §1/§2/§7 (`census.cpp`, `measure.cpp`, `hash.cpp`, `probe.cpp`,
`pcurve_probe.cpp`, `selfread.cpp`) are one-shot measurement tools, not shipped tests; their
compile lines are the ones quoted in this report and in the gate's header comment. The shipped,
CI-registered evidence is `kernel.ab.step_rational_roundtrip_gate`.
