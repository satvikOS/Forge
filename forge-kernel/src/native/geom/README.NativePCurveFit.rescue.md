# State of the rescued native pcurve fit, measured 2026-09-02

This file exists only on `rescue/native-pcurve-fit-wip`. It records what was **measured**
about the three rescued files, so whoever picks them up does not have to re-derive it.

## It compiles — but the FIRST TWO measurements of that were both invalid

**The claim stands. The evidence I first published for it did not, and that is recorded
here rather than quietly replaced.**

The whole of `NativePCurveFit.hpp` (line 89) and the whole of `NativePCurveFit.cpp`
(line 20) sit inside `#ifdef FORGE_NATIVE_BREP`. **Without `-DFORGE_NATIVE_BREP` the
translation unit preprocesses to nothing**, and a compiler returns 0 on an empty file.

Positive control — count a real symbol after preprocessing, with the guard off and on:

```
occurrences of `cylinderPCurve` after -E :   guard OFF = 0    guard ON = 2
```

So two separate measurements of "it compiles" were worthless, for two different reasons:

| attempt | what it actually measured | why it was wrong |
|---|---|---|
| 1st | the exit status of `head` | `rc=$?` after a pipe captures the LAST command in the pipeline |
| 2nd | an EMPTY translation unit | no `-DFORGE_NATIVE_BREP`, so every line was `#ifdef`'d out |

**The valid measurement**, guard on, clang's own exit status, output redirected to a file:

```
clang++ -std=c++20 -fsyntax-only -DFORGE_NATIVE_BREP \
  -Iinclude -Isrc -I$(brew --prefix opencascade)/include/opencascade \
  src/native/geom/NativePCurveFit.cpp
-> rc=0, 0 errors, 0 warnings
```

It is complete, syntactically valid C++20 against the real OCCT headers — which is what
was claimed, reached by a route that can support it.

★**The lesson generalises past this file: a build gate for guarded code must PROVE THE
GUARD IS ON.** A CI step that compiles this TU without `-DFORGE_NATIVE_BREP` would be
green forever while compiling nothing — the same shape as the defect that let a dangling
`std::string` size byte ship, and the same shape as an unknown-op probe that cannot emit a
negative verdict. Whatever gate wires this in must assert on a preprocessed symbol count,
not on an exit status.

## What is missing — UPDATED 2026-09-02 after the gate was written

| | state |
|---|---|
| `forge-kernel/test/pcurve_fit_gate.cpp` — the differential check the header promises | **NOW EXISTS**, 89 checks, kernel-free |
| `forge-kernel/test/run_pcurve_fit_gate.sh` — driver, guard proof, differential, mutations | **NOW EXISTS**, 5/5 mutations caught |
| CI compiles `NativePCurveFit.cpp` | **the gate does it** (syntax-only, guard ON) — but see below |
| a `CMakeLists.txt` reference / the kernel actually LINKING this code | **DONE — wired, built and the symbols are exported; see below** |
| `cylinderPCurve` / `planeCylinderSection` exercised on real geometry | **DONE — 62 checks, 0 failed; see below** |
| a re-measured paired DRAFT pass rate on the 565-part corpus | **still nothing** |
| `DRAFT_NATIVE_ENGINE.md`, cited for the 73-part figure | **EXISTS — I was wrong; see below** |

★**CORRECTION, 2026-09-02: the report I twice said was missing is NOT missing.** I looked
for `reports/DRAFT_NATIVE_ENGINE.md` and it lives at **`forge-kernel/reports/DRAFT_NATIVE_ENGINE.md`**
— tracked, 450 lines, landed with #177 in `4080c2d8`. I searched the repo-root `reports/`
and reported an absence that was my own wrong path. The citation in
`NativePCurveFit.hpp` is accurate: line 298 of that report reads, verbatim, *"The entire
remaining gap to OCCT is 73 parts, and every one is a drafted plane"*, its section 5 is
*"What remains, and why it is not one more predicate"*, and its census line reads
`The 73 OCCT DOES draft, by kind set:   73  cylinder    (nothing else)`. **That owed item
is discharged, and it was never owed.** Three remain: CMake wiring, `cylinderPCurve`
exercised on real geometry, and a re-measured paired DRAFT pass rate.

★**WIRED INTO THE KERNEL BUILD, 2026-09-02 — and verified at three levels, not one.**
`src/native/geom/NativePCurveFit.cpp` is now listed in `forge-kernel/CMakeLists.txt` beside
`NativeNurbsConvert.cpp`, the file it was transcribed from. `_core_sources` is FILTERED from
`FORGE_KERNEL_SOURCES`, so the one entry covers both `forge_kernel` and `forge_kernel_core`.
`FORGE_NATIVE_BREP` is a CMake option defaulting **ON** and reaches the compiler as
`target_compile_definitions(... FORGE_NATIVE_BREP=1)` on `forge_kernel`, `forge_kernel_core`,
`forge_verify` and the probes — so the guard is genuinely on in a normal build.

Because "it built" is not "the symbols are there" — the same trap as the empty-TU compile —
all three levels were checked:

```
1. CMake lists it   [ 72%] Building CXX object .../src/native/geom/NativePCurveFit.cpp.o
2. it compiles      CONFIGURE_RC=0   BUILD_RC=0   0 errors   [100%] Built target forge_kernel_core
3. it is EXPORTED   nm -gU libforge_kernel_core.dylib | c++filt | grep pcurvefit::  ->  6 symbols, all T
     T forge::pcurvefit::pointsToBSpline2d(...)      T forge::pcurvefit::fitBSpline2dAt(...)
     T forge::pcurvefit::planeCylinderSection(...)   T forge::pcurvefit::sectionResidual(...)
     T forge::pcurvefit::cylinderPCurve(...)         T forge::pcurvefit::planePCurve(...)
   object file 49,600 bytes / 12 symbols — not an empty translation unit
```

★**It is no longer a file nothing compiles.** With `FORGE_NATIVE_BREP=OFF` the TU is empty,
which is safe ONLY because nothing calls into it yet; the moment a caller exists, an OFF
build needs an `#else` path or the option becomes a link landmine.

★**This still does not move `OCCT_CLOSURE`, and must not be reported as if it did.**

★**ITEM 2 OF 3 IS DONE: `cylinderPCurve` MEASURED ON THE ACTUAL BLOCKER GEOMETRY.**
`forge-kernel/test/pcurve_geometry_gate.cpp`, linked against the real
`libforge_kernel_core`: **62 checks, 0 failed.** It drives the drafted plane meeting a
cylinder across draft angles **1, 3, 5, 7, 10, 15 and 30 degrees** and asserts, for each:
the section is an ELLIPSE; `sectionResidual < 1e-9` (the curve lies on BOTH surfaces —
checked before the fit, because a wrong 3-D curve with a perfect pcurve is still a wrong
edge); the pcurve's **out-of-sample** `maxDev3d <= 1e-7`; and `maxDevU < 1e-9`, because
only `v` is approximated and a drifting `u` would be a wrong edge rather than a coarse one.

The deviation is genuinely out of sample: `cylinderPCurve` grades itself on an audit set
"deliberately OFFSET from every sample the fit sees", since a fit graded on its own sample
points is graded where a least-squares solution is guaranteed to look good.

The perpendicular case is included because the header claims the two exact arrangements
"fall out of the SAME code path with no special case to get wrong": a plane normal to the
axis sections in a circle, `exact == true`, deviation < 1e-9.

Five negative controls, all refusing BY NAME — a plane parallel to the axis, a parallel
plane that misses the cylinder, a null 3-D curve, a non-positive radius, an empty parameter
range. A function that never defers is one whose defer path is untested.

★★**AND THE BOUND THAT MATTERS: NOTHING CALLS IT.** `grep` for `cylinderPCurve` /
`pcurvefit::` across `src` and `include`, excluding its own translation unit, returns
**ZERO** callers; `src/native/brep/Draft.cpp` and `DraftAnalytic.cpp` do not reference it.
So this measures a CAPABILITY, not a part count: **the 73 parts are unaffected**, and item 3
— a paired DRAFT pass rate on the 565-part corpus — cannot move until the DRAFT engine is
wired to this. Reporting the 62 passing checks as progress on the 73 parts would be false.

★**What the gate covers and what it does NOT.** It covers the numerics UNDERNEATH the
pcurve fit — partition of unity, support and non-negativity, `findSpan` bracketing and
both clamped ends, exact reproduction of a straight line at degrees 1–6, a Cholesky
round-trip, and Cholesky REFUSING both a negative pivot and a singular matrix (the
rank-deficient path is what the fitter relies on to DEFER instead of emitting a wrong
pcurve, so a factoriser that never returns false would itself be a gate that cannot fail).
It does **not** touch `cylinderPCurve`, `planeCylinderSection` or `pointsToBSpline2d`;
those need OCCT types and a built kernel. **A green run of this gate is not evidence that
the pcurve fit works.**

## Provenance — verified, not trusted

`BSplineBasis.hpp` states its four numerics are transcribed unchanged from the private
anonymous-namespace copy in `src/native/geom/NativeNurbsConvert.cpp` (lines 132-190), and
warns that a silent second copy of a validated algorithm is how two engines start
disagreeing. Diffed against `origin`:

```
findSpan         IDENTICAL  (10 vs 10 lines)
basisFuns        IDENTICAL  (17 vs 17 lines)
choleskyFactor   IDENTICAL  (15 vs 15 lines)
choleskySolve    IDENTICAL  (12 vs 12 lines)
```

## ★ It does not, by itself, move OCCT_CLOSURE — and that must not be claimed

The translation unit includes `Geom2d_BSplineCurve.hxx`, `Geom2d_Circle.hxx`,
`Geom_Curve.hxx`, `TColgp_Array1OfPnt2d.hxx`, `gp_Ax3.hxx`, `gp_Dir.hxx`, `gp_Pnt.hxx`,
`ElSLib.hxx`. It is native **arithmetic** built on OCCT **interchange types**. What it
replaces is a call to `Geom2dAPI_PointsToBSpline` in TKGeomAlgo — and TKGeomAlgo and
TKGeomBase are already FREE RIDERS in the closure ledger, exporting zero symbols the
kernel still needs. Removing a call into a free rider changes no toolkit count.

Its value is the DRAFT capability it unblocks (73 parts, a drafted plane meeting a
cylinder, where the section is `v(u) = a + b·cos u + c·sin u` and no Geom2d conic
represents it), not a closure number. `scripts/occt_closure_count.sh` remains THE
AUTHORITY and reads **14, zero of 14 dropped**, and nothing here changes that.

## What has to happen before any of this is merged

1. Write `test/pcurve_fit_gate.cpp` and make it FAIL first — the header already names what
   it should check (partition of unity, correct support, a straight line reproduced
   exactly, and the differential against `NativeNurbsConvert.cpp`'s copy).
2. Wire all three files into `forge-kernel/CMakeLists.txt` and into CI. Until then nothing
   builds them, and **a gate that cannot build cannot fail** — this repository has already
   shipped a dangling `std::string` size byte for exactly that reason.
3. Measure the DRAFT native-vs-OCCT pass rate on the 565-part corpus again and report the
   73 parts as a paired result, not a projection.
