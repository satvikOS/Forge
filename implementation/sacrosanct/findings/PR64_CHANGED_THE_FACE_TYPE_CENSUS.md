# PR #64 was NOT behaviour-preserving, and its own PR body says it was

**Measured 2026-08-29, after PR #64 had already merged.** The A/B harness
`run_ab_native_thicken.sh` is not run by CI, so nothing caught this at merge time.

## The claim, and the measurement that refutes it

PR #64 replaced three `BRepPrimAPI_MakePrism` sites in `NativeThickenShell.cpp` with
`forge::occtPrism`, and said:

> "Behaviour changes ONLY where the current behaviour is a SIGSEGV."

**That is false.** Positive control, same harness, same machine, only the engine file
swapped:

    pre-#64  (BRepPrimAPI_MakePrism)   227 passed,  0 failed   PASS
    post-#64 (forge::occtPrism)        208 passed, 19 failed   FAIL

## What actually differs, and what does not

All nineteen failures are the FACE-TYPE CENSUS. Nothing else moved:

    FAIL  case1 flat 20x10  planar-face count           got 2  want 6
    FAIL  case1 flat 20x10  other-surface-type count    got 4  want 0
    FAIL  case2 L shell     cylindrical-face count      got 0  want 1
    FAIL  case3 U shell     planar-face count           got 8  want 10

Volume, centre of mass, bounding box, topology counts and validity all PASS -- 208 of
227. **The solids are geometrically identical; their surfaces are TYPED differently.**
`occtPrism` emits `Geom_SurfaceOfLinearExtrusion` laterals where `BRepPrimAPI_MakePrism`
emitted canonical `Geom_Plane` and `Geom_CylindricalSurface`.

This is not a surprise to the codebase. `OcctPrimBuilder.hpp` warns about exactly it:
flipping the canonical form "would change the face-type census of every extrude,
push/pull, rib, parting slab and base flange in the product". It matters because
`faceInventory` reports non-canonical laterals as kind `"other"`, and any selector or
score component keyed on face type sees a different shape.

## The fix exists, and NOT at HEAD

`BRepPrimAPI_MakePrism`'s `Canonize` flag **defaults to TRUE**, and the in-flight tree's
`occtPrism` takes a third `canonize` parameter for precisely this. I tried to pass it:

    error: too many arguments to function call, expected 2, have 3

**At HEAD `occtPrism` has only two parameters.** The canonize capability exists ONLY in
the in-flight working tree. This is the THIRD time today I read an API from the
in-flight checkout and applied it to HEAD -- after the CMake option names and the
`FORGE_OFFSET_DROP_*` list. The rule I wrote down that morning is the one I keep
breaking.

## Kept, not reverted, and why

The standing rule is that a fix proven inadequate is reverted. Here reverting restores
seven UNDEFINED `BRepPrimAPI` symbols to the shipped dylib -- symbols that
`-undefined dynamic_lookup` permits at link time and that SIGSEGV on first call, which
is what made `run_ir_pipeline.sh` die with signal 11. So both directions are defects:

    revert  -> correct face types, and a hard crash the moment the path is taken
    keep    -> callable, geometrically identical solids, different face TYPES

Keeping is the lesser defect, and it is recorded as a defect rather than as a success.
**The PR body's claim is withdrawn.** The real fix is to port the `canonize` parameter
to HEAD's `occtPrism` and pass `true` at all three sites, which restores 227/0 AND keeps
the symbols out -- that belongs to whoever owns the in-flight `OcctPrimBuilder` work.

## Also fixed here

`run_ab_native_thicken.sh` could not even LINK after PR #64, because it compiles the
engine standalone and `occtPrism` lives in `src/OcctPrimBuilder.cpp`. It had an unused
`DEPS=` variable; that is now `DEPS=forge-kernel/src/OcctPrimBuilder.cpp` and is passed
to the compile line. Without this the harness reports `BUILD/LINK FAIL` and its 227
assertions never run at all -- a gate that cannot build is a gate that cannot fail.

## RESOLVED 2026-08-29 — canonize ported to HEAD, 227/0 restored

The fix this finding specified was carried out on branch `kernel/occtprism-canonize`.

`forge::occtPrism` now takes a third parameter, `bool canonize = false`. When set, a
lateral whose swept surface has an exact canonical form **with the identical (u,v)
parametrisation** is emitted as that form instead of a
`Geom_SurfaceOfLinearExtrusion`: a LINE swept perpendicular to itself becomes a
`Geom_Plane`, a CIRCLE swept along its own axis becomes a `Geom_CylindricalSurface`,
and everything else (oblique line sweeps, splines) is left alone. The point set is
never changed -- only the surface TYPE. The three `NativeThickenShell.cpp` sites pass
`/*canonize=*/true`, restoring what `MakePrism` did by default.

The default is **false**, so the other eleven `occtPrism` callers are on exactly the
path they were on before; the census-wide flip this file warns about is still NOT taken.

Measured, same harness, engine file the only variable:

    before this commit   208 passed, 19 failed   FAIL
    after  this commit   227 passed,  0 failed   PASS

227 = 208 + 19, so no assertion that passed before was traded away, and no assertion was
weakened or removed. The symbols stayed out, checked on the linked artifact rather than
on an object file:

    nm -u libforge_kernel_core.dylib | grep -c BRepPrimAPI   ->  0   (of 724 undefined)

That zero is not vacuous: the same check reports 2 on a positive-control TU that does
call `BRepPrimAPI_MakePrism`, and the dylib was confirmed present and genuinely relinked
(`Building CXX .../OcctPrimBuilder.cpp.o` and `.../NativeThickenShell.cpp.o` both appear
in the build log).

`AB_BASELINE_thicken` was lowered 19 -> 0 in the same commit, and
`forge-kernel/test/run_ab_all.sh` is GREEN on all seven harnesses.
