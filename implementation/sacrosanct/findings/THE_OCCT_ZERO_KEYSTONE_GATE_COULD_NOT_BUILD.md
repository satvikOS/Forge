# The OCCT-zero keystone gate could not build, and underneath it the feature does not work

**Measured 2026-08-29 at HEAD `a70dd1da`.** `forge-kernel/test/build_fuse_mesh_operand_test.sh`
is the gate for what its own commit (ad207d50) calls the **OCCT-zero keystone**: proving a
`cut`/`fuse` whose operand is a `NativeMesh` routes through the native mesh boolean without
touching the OCCT bridge. It is not referenced by CI (`grep -c` in kernel-tests.yml = 0).

It has been failing to BUILD, in three separate ways, so none of its assertions ran.

## Three build failures, each hiding the next

**1. The OCCT-free partition went stale.** The script compiles every `src/native/**.cpp`
on a command line with NO OCCT include path -- and that omission IS the proof that the
native tree is OCCT-free. The tree outgrew it: **14 of 151** native sources have since
taken OCCT headers, so the gate died at

    include/forge/native/brep/NativeDraft.hpp:98:10:
      fatal error: 'TopoDS_Shape.hxx' file not found

Fixed by deciding the split PER FILE from what the file actually includes, so the
OCCT-free line is still ENFORCED for the 136 sources that genuinely are, instead of
handing `-I $OCCT_INC` to everything and fixing the build by deleting the proof. The gate
now prints the split it made: `136 compiled with NO OCCT include path, 15 on the OCCT line`.

**2. `src/OcctPrimBuilder.cpp` was not linked** -- `Undefined symbols: forge::occtBoxSolid,
occtConeSolid, occtTorusSolid`. This is the THIRD harness that day found missing the same
file; `run_ab_native_thicken.sh` and `run_ab_native_loftpipe.sh` had it too.

**3. `src/OcctNativeMesh.cpp` was not linked** -- `occtmesh::tessellateShapeToSoup`, which
`Booleans.cpp` calls on the very mesh-operand path this gate exercises.

## With it building, the feature is measurably NOT working

    [PASS] box is a NativeSolid (analytic primitive, gate ON)
    [PASS] box enumerates 12 sharp convex edges  got=12
    [PASS] filletEdges did NOT throw
    [PASS] filleted result is a NativeMesh (THE mesh operand)
    [PASS] filleted body has positive volume  v=7804.238617
    [PASS] cylinder cutter is a NativeSolid
    [PASS] translated cutter is still a NativeSolid
      cut threw: forge: boolean cut: native analytic/mesh boolean DEFERRED on an
      all-native operand pair. This operand class is NATIVE-ONLY -- the OCCT
      BRepAlgoAPI fallback was removed (K2) ... refusing rather than masking a
      native gap with OCCT.
    [FAIL] cut(filletedMesh, cylinder) did NOT throw
    [FAIL] cut returned a valid handle

**This is not a crash bug -- it is an HONEST DEFER, and that is the point.** The native
mesh boolean does not implement this intersection, the OCCT fallback was deliberately
removed under K2, so the operation has no path at all. The kernel refuses loudly instead
of silently falling back, exactly as designed; what was silent was the GATE.

Ruled out as a harness artefact: `ShapeRegistry::instance()` is declared in the header and
defined ONCE in `ShapeRegistry.cpp`, so the separately-compiled TUs share one registry. The
subsequent `Abort trap: 6` is a cascade -- the test continues past the failed step and calls
`kindOf(kInvalidHandle)`.

## What this means for the dependency drop

This is the same lesson as the twelve drop families, on a feature that was already
committed as done: **removing an OCCT fallback converts a native GAP into a hard failure**,
and the only thing standing between that and a user-visible break is a gate — which here
could not build, was not in CI, and therefore said nothing for however long it has been
broken.

**Not added to CI by this commit**, because it currently FAILS and a permanently-red gate
teaches its reader to ignore it. It wants the ratchet idiom (`run_ab_all.sh`,
`fea_nafems_ratchet.sh`): a committed baseline of the known-failing assertions, red if the
count rises AND red if it falls without the baseline being lowered in the same commit.
That is the recommended next step, together with implementing the missing native
mesh-boolean intersection.
