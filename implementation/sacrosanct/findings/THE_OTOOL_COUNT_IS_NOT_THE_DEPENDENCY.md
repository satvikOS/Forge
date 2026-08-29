# The otool line count is not the OCCT dependency, and I was reporting the wrong number

**Measured 2026-08-29 by an independent census, then reproduced with the repo's own
`forge-kernel/scripts/occt_closure_count.sh`.**

I had been reporting `otool -L libforge_kernel_core.dylib | grep -c opencascade` as the
kernel's OCCT dependency, and tracking it as the drop metric. That number is not the
dependency, and the script that owns this measurement says so in its own output:

    closure (14): TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo
                  TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo

    2 phantom-direct librar(ies). A drop that only converts DIRECT -> PHANTOM
    leaves OCCT_CLOSURE unchanged and is worth ZERO. Rank drops by OCCT_CLOSURE.

## The three numbers, and why only one of them counts

    OCCT_DIRECT    8   link records in the shipped forge-kernel.node
    OCCT_CLOSURE  14   libraries that actually load
    OCCT_PHANTOM   2   called directly, with no direct record (TKBO, TKG2d)

**Direct and closure disagree by six libraries.** TKBO, TKBool, TKG2d, TKGeomAlgo,
TKGeomBase and TKPrim are in the closure with no direct record: they are pulled in by
their parents, so removing a *record* changes nothing about what loads. Chasing
11 -> 10 -> 8 on the direct count is worth zero.

Worse, the "10-11" I kept quoting came partly from `build-unified/`, an **Aug-6
artifact** that still names TKPrim -- a toolkit removed from `OCCT_LIBS` on 2026-08-07.
I was reading a stale build and calling it the current dependency.

## What that means for PR #64

PR #64 (`7 undefined BRepPrimAPI symbols -> 0`) remains correct and worth having, but it
is **not a toolkit drop and I should not have framed it under "dep drop progress"**.
What it fixed is a latent crash: with TKPrim off the link line, those symbols stayed
undefined, which `-undefined dynamic_lookup` permits at link time and turns into a
SIGSEGV on first call. `run_ir_pipeline.sh` was dying of exactly that. Removing a
crash is not the same as removing a dependency, and the closure was 14 before and 14
after.

## The real ladder

Ranked by closure, not by link records. The highest-leverage single cut is **TKFillet**:
it has the smallest blocking set in the build (16 symbol refs across just
`src/Features.cpp` and `src/VarFillet.cpp`), nothing else pulls it, and it is the sole
parent of a chain -- dropping it takes **TKBO, TKBool and TKPrim** with it, closure
13 -> 9 in one move.

That cut was blocked on one missing native capability: the TKFillet-free engine could
not round a CONCAVE (reflex) edge. `drop/occt-slice-b` has now implemented it
(+156/-26 in `NativeFilletChamfer.cpp`, verified against live OCCT by an adversarial
reviewer who rebuilt it from scratch), and `-DFORGE_FILLET_DROP_NATIVE=ON` configures
cleanly on that branch: *"TKFillet dropped; BRepFilletAPI fallback compiled out"*.

**Whether the closure actually falls is a measurement, not an inference, and it is
running.** The number to report is `occt_closure_count.sh`, not `otool | grep -c`.

## MEASURED: the TKFillet drop alone is worth ZERO, and the ordering is not optional

`drop/occt-slice-b` unblocked the concave-edge capability, so I built
`-DFORGE_FILLET_DROP_NATIVE=ON` (rc=0, 0 errors) and measured both numbers:

    DIRECT records:  TKFillet GONE  (10 records, no TKFillet)
    CLOSURE:         14  ->  14     UNCHANGED

TKFillet left the link line and **nothing stopped loading**, because `TKOffset` is
still directly linked and is a parent of the entire chain:

    TKBO        pulled by  TKBool TKFillet TKOffset
    TKBool      pulled by  TKFillet TKOffset
    TKPrim      pulled by  TKBO TKBool TKFillet TKOffset
    TKGeomAlgo  pulled by  TKBO TKBool TKFillet TKOffset TKPrim TKShHealing TKTopAlgo

So the fillet drop converted TKFillet from DIRECT to PHANTOM -- precisely the move
`occt_closure_count.sh` calls worth zero. The map's "TKFillet takes closure 13 -> 9"
is correct only *after* TKOffset is gone; read on its own it invites exactly the
mistake I just made and measured.

**TKOffset must go first.** It is the sole remaining direct parent of that chain, and
until it does, every TKFillet-side win is invisible to the number that matters. This
does not devalue slice-b's concave-edge engine -- that capability is a prerequisite for
the eventual cut and it is now built and adversarially verified. It just cannot be
banked yet.

## The rule

A dependency metric has to measure what LOADS, not what is NAMED. Before tracking any
count, check that moving it moves the thing you care about -- and check which artifact
you are reading it from. Two of my errors here were the same class as the A/B that
compared one binary against itself: a plausible number, measured off the wrong object.
