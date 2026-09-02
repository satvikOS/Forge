# State of the rescued native pcurve fit, measured 2026-09-02

This file exists only on `rescue/native-pcurve-fit-wip`. It records what was **measured**
about the three rescued files, so whoever picks them up does not have to re-derive it.

## It compiles

```
clang++ -std=c++20 -fsyntax-only \
  -Iinclude -Isrc -I$(brew --prefix opencascade)/include/opencascade \
  src/native/geom/NativePCurveFit.cpp
-> rc=0, 0 errors
```

(The first attempt at this reported `rc=0` for the wrong reason — the status captured
belonged to a `head` in the pipeline, not to the compiler. The number above is clang's own
exit status with output redirected to a file.)

So this is not half-written code. It is complete, syntactically valid C++20 against the
real OCCT headers, which was never wired into anything.

## What is missing, exactly

| | state |
|---|---|
| `forge-kernel/test/pcurve_fit_gate.cpp` — the differential check the header promises | **does not exist** |
| a `CMakeLists.txt` reference to any of the three files | **none — nothing compiles them in the build** |
| `reports/DRAFT_NATIVE_ENGINE.md`, cited for the 73-part figure | **not present in the worktree this came from** |

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
