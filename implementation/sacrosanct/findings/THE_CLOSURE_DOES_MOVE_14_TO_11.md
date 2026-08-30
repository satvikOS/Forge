# The OCCT closure DOES move, 14 -> 11, and my earlier "14 -> 14" was my own naming error

**Measured 2026-08-29 at HEAD `be7ed999`, in a clean worktree.** This CORRECTS
`TKOFFSET_WITH_ALL_NINE_FAMILIES_ON.md`, which reported that turning on every TKOffset
family left the closure unchanged. That finding was wrong, and the reason is worth more
than the result.

## The error: I took option names from the wrong tree

I built with `-DFORGE_OFFSET_DROP_MAKEPIPE=ON -DFORGE_OFFSET_DROP_DRAFT=ON` and seven
more of that shape. **Those names exist only in the IN-FLIGHT working tree.** At HEAD
the same flags are named `FORGE_PIPE_DROP_NATIVE`, `FORGE_DRAFT_DROP_NATIVE`, and so on
-- the in-flight work renamed them.

**CMake accepts an unknown `-D` variable silently.** It caches it, prints nothing, and
carries on. So my "all nine families ON" build enabled exactly TWO of them -- the two
whose names happen to be identical in both trees (`FORGE_THRUSECTIONS_DROP_NATIVE`,
`FORGE_PIPESHELL_DROP_NATIVE`). The configure log said "7 compiled out"; the real
all-options configure says **18**.

This is the same rule that caught a survey agent earlier in the day, turned on me:
**say which tree every claim is measured against.** I wrote that rule down and then
took a list of option names from the in-flight tree into a HEAD worktree.

The tell was available and I did not look: `grep -oE "^option\(FORGE_[A-Z0-9_]+"` on the
tree I was actually building lists 17 options, and not one of them is
`FORGE_OFFSET_DROP_*`.

## The corrected measurement

With the twelve drop options that ACTUALLY EXIST at HEAD all ON:

    build                              CLOSURE   direct   undefined BRepOffset* refs
    baseline (defaults)                  14        10               38
    "all nine" (my error: 2 real)        14        10               25
    ALL TWELVE REAL OPTIONS ON           11         9                0

    gone from the closure: TKFillet, TKBool, TKOffset

Build rc=0, 421 TUs, zero errors. **This is the first movement on the number that
counts in this programme's OCCT work.**

## What this does NOT establish

Both integration gates available to me stay green on the drop build:

    unify_coaxial_guard_test.sh   GREEN (3 crashers recovered, 6 untouched unchanged)
    run_ir_pipeline.sh            18 checks, 0 failures -- PASS

**That is not the question those defaults are guarding.** Every one of these families is
OFF by default for COVERAGE, not correctness: the native engines are exact on what they
accept and DEFER on shapes OCCT handles, and with the fallback compiled out a defer
becomes a thrown error rather than an answer. The CMakeLists says so in its own words --
"shipping it ON would delete capability OCCT performs" -- and names the flip gate as a
corpus A/B, "native success rate >= the measured OCCT baseline".

Two gates passing on a handful of shapes is not that corpus A/B. **Closure 11 is
achievable; whether it is SHIPPABLE is unmeasured**, and the honest status of the
dependency drop remains: the ladder is real, a 3-library step is now demonstrated to
build and pass what gates exist, and the coverage question that decides the flip has not
been run.

## Every A/B harness, run: the native engines ARE correctness-clean

Coverage is still unmeasured, but CORRECTNESS is not. All seven live-OCCT A/B harnesses,
each asserting on a vector of observables with negative and defer controls:

    draft            114 / 0      PASS
    filling           80 / 80     PASS
    loftpipe         314 / 314    PASS   (after fixing its link -- see below)
    offsetshape      206 / 206    PASS
    sweep             14 / 14     PASS
    fillet_concave    66 / 66     PASS
    thicken          208 / 19     FAIL   <- MY regression, face-type census only

Six of seven pass outright. The single failure is the one I introduced in PR #64 and it
is confined to surface TYPING, not geometry (`PR64_CHANGED_THE_FACE_TYPE_CENSUS.md`).

**Two of these harnesses could not even LINK**, both because of PR #64, and CI runs
neither: `run_ab_native_thicken.sh` and `run_ab_native_loftpipe.sh` compile their engine
standalone and did not link `src/OcctPrimBuilder.cpp`, which now supplies `occtPrism` and
`occtCylinderSolid`. From the moment that PR merged, 541 assertions stopped running and
nothing said so. A gate that cannot build is a gate that cannot fail, and it fails
silently.

Once loftpipe linked it passed 314/314 -- so the `MakeCylinder -> occtCylinderSolid` and
`MakeHalfSpace -> bounded slab` half of PR #64 IS behaviour-preserving. Only the
`MakePrism -> occtPrism` half is not.

**What this changes about closure 11:** the engines behind the drop are not speculative
-- they are exact on what they accept, measured against live OCCT. What remains open is
how OFTEN they decline on real parts, which is the corpus A/B, which does not exist as a
harness. That is now the single named blocker between closure 11 and shipping it.

## Why the correction matters more than the number

The previous finding was measured carefully -- fresh worktree, real build, closure read
with the repo's own authority script -- and it was still wrong, because the INPUT to all
that care was a list of names copied across a tree boundary. Rigour downstream of a
wrong premise produces a confident wrong answer, which is worse than an uncertain one.
